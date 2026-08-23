const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const {
  cleanup,
  createTempProject,
  readJson,
  runCliAsMain,
  setNonInteractiveStdin,
  withEnv,
} = require('./gsdd.helpers.cjs');

const ROOT = path.join(__dirname, '..');
const ENDPOINT = 'https://registry.npmjs.org/workspine/latest';
const CACHE_RELATIVE = path.join('.work', '.local', 'update-awareness.json');

function runGeneratedHelper(cwd, args) {
  const result = spawnSync(process.execPath, [path.join(cwd, '.work', 'bin', 'gsdd.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GSDD_UPDATE_AWARENESS: '0' },
  });
  return { exitCode: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

async function loadUpdateAwareness() {
  try {
    return await import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'update-awareness.mjs')).href}?t=${Date.now()}-${Math.random()}`);
  } catch (error) {
    assert.fail(`update-awareness module must be importable: ${error.message}`);
  }
}

function fakeResponse(body, { status = 200, url = ENDPOINT, contentLength = null } = {}) {
  const bytes = Buffer.from(body);
  return {
    status,
    url,
    headers: { get(name) { return name.toLowerCase() === 'content-length' ? contentLength : null; } },
    body: {
      getReader() {
        let consumed = false;
        return {
          async read() {
            if (consumed) return { done: true };
            consumed = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
    async arrayBuffer() { return bytes; },
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function captureProcessSeams() {
  const previous = {
    cwd: process.cwd(),
    argv: process.argv.slice(),
    env: { ...process.env },
    fetch: globalThis.fetch,
    log: console.log,
    error: console.error,
    exitCode: process.exitCode,
  };
  const stdout = [];
  const stderr = [];
  console.log = (...parts) => stdout.push(parts.join(' '));
  console.error = (...parts) => stderr.push(parts.join(' '));
  return {
    stdout,
    stderr,
    previous,
    restore() {
      process.chdir(previous.cwd);
      process.argv = previous.argv;
      process.env = previous.env;
      globalThis.fetch = previous.fetch;
      console.log = previous.log;
      console.error = previous.error;
      process.exitCode = previous.exitCode;
    },
  };
}

function makeHangingIteratorResponse({ returnNeverSettles = true } = {}) {
  let nextCalls = 0;
  let returnCalls = 0;
  const response = {
    status: 200,
    url: ENDPOINT,
    headers: { get: () => null },
    body: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            nextCalls += 1;
            return new Promise(() => {});
          },
          return() {
            returnCalls += 1;
            return returnNeverSettles ? new Promise(() => {}) : Promise.resolve({ done: true });
          },
        };
      },
    },
  };
  return { response, get nextCalls() { return nextCalls; }, get returnCalls() { return returnCalls; } };
}

function makeHangingResponse({ cancel = false } = {}) {
  let cancelCalls = 0;
  const response = {
    status: 200,
    url: ENDPOINT,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          read: () => new Promise(() => {}),
          cancel: () => {
            cancelCalls += 1;
            return cancel ? new Promise(() => {}) : Promise.resolve();
          },
        };
      },
    },
  };
  return { response, get cancelCalls() { return cancelCalls; } };
}

describe('bounded update awareness', () => {
  let tmpDir;
  let workDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    workDir = path.join(tmpDir, '.work');
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => cleanup(tmpDir));

  function cachePath() {
    return path.join(tmpDir, CACHE_RELATIVE);
  }

  function options(overrides = {}) {
    const lines = [];
    return {
      cwd: tmpDir,
      command: 'remember',
      args: [],
      packageVersion: '0.32.0',
      source: 'public-cli',
      now: () => new Date('2026-08-13T12:00:00.000Z'),
      output: (line) => lines.push(line),
      ...overrides,
      lines,
    };
  }

  test('cold cache creates contained .work/.local, checks once, and emits only a newer notice', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    let requests = 0;
    const opts = options({
      fetchImpl: async (url) => {
        requests += 1;
        assert.equal(url, ENDPOINT);
        return fakeResponse(JSON.stringify({ version: '0.33.0' }));
      },
    });

    const result = await maybeShowUpdateNotice(opts);

    assert.equal(requests, 1);
    assert.deepEqual(result.args, []);
    assert.equal(fs.realpathSync(path.dirname(cachePath())), fs.realpathSync(path.join(workDir, '.local')));
    assert.deepEqual(readJson(cachePath()), {
      schema: 1,
      checkedAt: '2026-08-13T12:00:00.000Z',
      status: 'available',
      latestVersion: '0.33.0',
      error: null,
    });
    assert.deepEqual(opts.lines, ['Update available: workspine 0.33.0 (current 0.32.0). Run `npx -y workspine update` to repair/refresh generated surfaces.']);
  });

  test('fresh cache is silent, while corrupt cache is stale and permits one check', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), '{not-json');
    let requests = 0;
    const opts = options({
      fetchImpl: async () => {
        requests += 1;
        return fakeResponse(JSON.stringify({ version: '0.32.0' }));
      },
    });
    await maybeShowUpdateNotice(opts);
    assert.equal(requests, 1);
    assert.deepEqual(opts.lines, []);

    const fresh = options({ fetchImpl: async () => { throw new Error('fresh cache must not fetch'); } });
    await maybeShowUpdateNotice(fresh);
    assert.deepEqual(fresh.lines, []);
  });

  test('mkdir and atomic-write failures are nonblocking, preserve prior cache, and leave no owned temp', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    const previous = Buffer.from(JSON.stringify({
      schema: 1,
      checkedAt: '2026-08-12T12:00:00.000Z',
      status: 'available',
      latestVersion: '0.32.0',
      error: null,
    }));
    fs.writeFileSync(cachePath(), previous);
    let tempPath;
    const opts = options({
      fetchImpl: async () => fakeResponse(JSON.stringify({ version: '0.33.0' })),
      atomic: {
        writeFileAtomic: () => { throw new Error('injected rename failure'); },
        createTempPath: (target) => { tempPath = `${target}.owned-temp`; return tempPath; },
      },
    });
    await maybeShowUpdateNotice(opts);
    assert.deepEqual(fs.readFileSync(cachePath()), previous);
    assert.ok(!tempPath || !fs.existsSync(tempPath));
    assert.deepEqual(opts.lines, ['Update available: workspine 0.33.0 (current 0.32.0). Run `npx -y workspine update` to repair/refresh generated surfaces.']);
  });

  test('health and update are silent and never invoke checker network or cache I/O', async () => {
    const { maybeShowUpdateNotice, isCheckerEligible } = await loadUpdateAwareness();
    assert.equal(isCheckerEligible('health', 'public-cli'), false);
    assert.equal(isCheckerEligible('update', 'public-cli'), false);
    for (const command of ['health', 'update']) {
      let requests = 0;
      const opts = options({
        command,
        fetchImpl: async () => { requests += 1; throw new Error('must not fetch'); },
        atomic: { writeFileAtomic: () => { throw new Error('must not write'); } },
      });
      const result = await maybeShowUpdateNotice(opts);
      assert.equal(requests, 0);
      assert.deepEqual(result.args, []);
      assert.deepEqual(opts.lines, []);
      assert.ok(!fs.existsSync(cachePath()));
    }
  });

  test('opt-out suppresses newer notice and checker I/O while still stripping its flag', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    let requests = 0;
    const opts = options({
      args: ['--json', '--no-update-notice', '--sentinel'],
      env: { ...process.env, GSDD_UPDATE_AWARENESS: '0' },
      fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '9.9.9' })); },
    });
    const result = await maybeShowUpdateNotice(opts);
    assert.deepEqual(result.args, ['--json', '--sentinel']);
    assert.equal(requests, 0);
    assert.deepEqual(opts.lines, []);
  });

  test('newer-version baseline emits notice while named opt-out suppresses it', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const baseline = options({
      args: ['--json', '--sentinel'],
      env: { ...process.env, GSDD_UPDATE_AWARENESS: '1' },
      fetchImpl: async () => fakeResponse(JSON.stringify({ version: '9.9.9' })),
    });
    const baselineResult = await maybeShowUpdateNotice(baseline);
    assert.equal(baselineResult.checked, true);
    assert.equal(baseline.lines.length, 1);
    const optedOut = options({
      args: ['--json', '--no-update-notice', '--sentinel'],
      env: { ...process.env, GSDD_UPDATE_AWARENESS: '0' },
      fetchImpl: async () => { throw new Error('named opt-out must not fetch'); },
    });
    const optedOutResult = await maybeShowUpdateNotice(optedOut);
    assert.deepEqual(optedOutResult.args, ['--json', '--sentinel']);
    assert.deepEqual(optedOut.lines, []);
  });

  test('fresh equal-version baseline and opt-out preserve argv and observable output', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const baseline = options({
      args: ['--json', '--sentinel'],
      env: { ...process.env, GSDD_UPDATE_AWARENESS: '1' },
      fetchImpl: async () => fakeResponse(JSON.stringify({ version: '0.32.0' })),
    });
    const baselineResult = await maybeShowUpdateNotice(baseline);
    const optedOut = options({
      args: ['--json', '--no-update-notice', '--sentinel'],
      env: { ...process.env, GSDD_UPDATE_AWARENESS: '0' },
      fetchImpl: async () => { throw new Error('opt-out must not fetch'); },
    });
    const optedOutResult = await maybeShowUpdateNotice(optedOut);
    assert.deepEqual(baselineResult.args, ['--json', '--sentinel']);
    assert.deepEqual(optedOutResult.args, baselineResult.args);
    assert.deepEqual(optedOut.lines, baseline.lines);
    assert.deepEqual(optedOut.lines, []);
  });

  test('WORKSPINE_UPDATE_AWARENESS=0 suppresses newer notice and checker I/O the same as the legacy variable', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    let requests = 0;
    const opts = options({
      args: ['--json', '--sentinel'],
      env: { ...process.env, WORKSPINE_UPDATE_AWARENESS: '0' },
      fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '9.9.9' })); },
    });
    const result = await maybeShowUpdateNotice(opts);
    assert.equal(requests, 0);
    assert.deepEqual(result.args, ['--json', '--sentinel']);
    assert.equal(result.checked, false);
    assert.deepEqual(opts.lines, []);
    assert.ok(!fs.existsSync(cachePath()));
  });

  test('either update-awareness opt-out variable disables the checker; the legacy name still works alone', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const cases = [
      { WORKSPINE_UPDATE_AWARENESS: '0' },
      { GSDD_UPDATE_AWARENESS: '0' },
      { WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '1' },
      { WORKSPINE_UPDATE_AWARENESS: '1', GSDD_UPDATE_AWARENESS: '0' },
    ];
    for (const envOverrides of cases) {
      const isolated = createTempProject();
      fs.mkdirSync(path.join(isolated, '.work'), { recursive: true });
      try {
        let requests = 0;
        const opts = {
          ...options({
            env: { ...process.env, ...envOverrides },
            fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '9.9.9' })); },
          }),
          cwd: isolated,
        };
        const result = await maybeShowUpdateNotice(opts);
        assert.equal(requests, 0, JSON.stringify(envOverrides));
        assert.equal(result.checked, false, JSON.stringify(envOverrides));
        assert.deepEqual(opts.lines, [], JSON.stringify(envOverrides));
      } finally {
        cleanup(isolated);
      }
    }
  });

  test('bounded reader cancels streamed oversize bodies before retaining more than 64 KiB', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    let cancelled = false;
    const chunks = [Buffer.alloc(60 * 1024, 65), Buffer.alloc(8 * 1024, 66)];
    const opts = options({
      fetchImpl: async () => ({
        status: 200,
        url: ENDPOINT,
        headers: { get: () => null },
        body: {
          getReader() {
            return {
              async read() { return chunks.length ? { done: false, value: chunks.shift() } : { done: true }; },
              async cancel() { cancelled = true; },
            };
          },
        },
      }),
    });
    const result = await maybeShowUpdateNotice(opts);
    assert.equal(result.cache.error, 'oversize');
    assert.equal(cancelled, true);
    assert.deepEqual(opts.lines, []);
  });

  test('real atomic writer failure preserves prior cache and cleans its owned temp', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const { createAtomicFileWriter } = await import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'atomic-write.mjs')).href}?atomic=${Date.now()}`);
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    const previous = Buffer.from('{"schema":1,"checkedAt":"2026-08-12T12:00:00.000Z","status":"available","latestVersion":"0.32.0","error":null}\n');
    fs.writeFileSync(cachePath(), previous);
    const tempPath = `${cachePath()}.owned-temp`;
    const writer = createAtomicFileWriter({
      createTempPath: () => tempPath,
      operations: { openSync: fs.openSync, writeFileSync: () => { throw new Error('write failed'); }, fsyncSync: fs.fsyncSync, closeSync: fs.closeSync, renameSync: fs.renameSync, unlinkSync: fs.unlinkSync },
    });
    const result = await maybeShowUpdateNotice(options({
      fetchImpl: async () => fakeResponse(JSON.stringify({ version: '0.33.0' })),
      atomic: { writeFileAtomic: writer },
    }));
    assert.equal(result.checked, true);
    assert.deepEqual(fs.readFileSync(cachePath()), previous);
    assert.equal(fs.existsSync(tempPath), false);
  });

  test('public dispatch uses injected fake fetch and restores process seams', async () => {
    const previousCwd = process.cwd();
    const previousFetch = globalThis.fetch;
    const previousError = console.error;
    const previousExitCode = process.exitCode;
    const lines = [];
    try {
      process.chdir(tmpDir);
      globalThis.fetch = async (url) => { assert.equal(url, ENDPOINT); return fakeResponse(JSON.stringify({ version: '0.33.0' })); };
      console.error = (line) => lines.push(line);
      const cli = await import(`${pathToFileURL(path.join(ROOT, 'bin', 'gsdd.mjs')).href}?dispatch=${Date.now()}-${Math.random()}`);
      await cli.runCli('remember');
      assert.equal(lines.filter((line) => String(line).includes('Update available')).length, 1);
    } finally {
      process.chdir(previousCwd);
      globalThis.fetch = previousFetch;
      console.error = previousError;
      process.exitCode = previousExitCode;
    }
  });

  test('only workspace-mutating commands are eligible; every read-only command is silent', async () => {
    const { PUBLIC_COMMAND_POLICY, GENERATED_HELPER_COMMAND_POLICY } = await loadUpdateAwareness();
    for (const [command, policy] of Object.entries(PUBLIC_COMMAND_POLICY)) {
      assert.equal(policy, ['phase-status', 'scaffold', 'remember'].includes(command) ? 'eligible' : 'silent', command);
    }
    for (const [command, policy] of Object.entries(GENERATED_HELPER_COMMAND_POLICY)) {
      assert.equal(policy, ['phase-status', 'remember'].includes(command) ? 'eligible' : 'silent', command);
    }
    for (const command of ['next', 'verify', 'find-phase', 'journey', 'decisions', 'git-identity']) {
      assert.equal(PUBLIC_COMMAND_POLICY[command], 'silent', `${command} is documented read-only and must never write the cache`);
    }
    for (const command of ['next', 'verify', 'decisions', 'git-identity']) {
      assert.equal(GENERATED_HELPER_COMMAND_POLICY[command], 'silent', `generated ${command} is read-only and must never write the cache`);
    }
  });

  test('every public row strips only the policy flag and preserves the frozen 18-row table', async () => {
    const { PUBLIC_COMMAND_POLICY, stripUpdateNoticeFlag } = await loadUpdateAwareness();
    const eligible = ['phase-status', 'scaffold', 'remember'];
    const silent = ['init', 'install', 'health', 'update', 'help', 'models', 'rigor', 'file-op', 'lifecycle-preflight', 'next', 'verify', 'find-phase', 'journey', 'decisions', 'git-identity'];
    assert.deepEqual(Object.keys(PUBLIC_COMMAND_POLICY).sort(), [...eligible, ...silent].sort());
    assert.deepEqual(eligible.filter((command) => PUBLIC_COMMAND_POLICY[command] !== 'eligible'), []);
    assert.deepEqual(silent.filter((command) => PUBLIC_COMMAND_POLICY[command] !== 'silent'), []);
    const sentinel = ['--json', '--no-update-notice', 'alpha', '--no-update-notice', 'omega'];
    for (const command of [...eligible, ...silent]) {
      assert.deepEqual(stripUpdateNoticeFlag(sentinel), ['--json', 'alpha', 'omega'], command);
    }
  });

  test('generated helper strips policy flag on every row while preserving resolver-added workspace root', async () => {
    const { GENERATED_HELPER_COMMAND_POLICY, stripUpdateNoticeFlag } = await loadUpdateAwareness();
    const commands = ['control-map', 'decisions', 'file-op', 'git-identity', 'lifecycle-preflight', 'phase-status', 'remember', 'verify', 'next'];
    assert.deepEqual(Object.keys(GENERATED_HELPER_COMMAND_POLICY).sort(), commands.slice().sort());
    const sentinel = ['--json', '--no-update-notice', 'alpha', '--no-update-notice', 'omega'];
    for (const command of commands) {
      const stripped = stripUpdateNoticeFlag(sentinel);
      const baseline = ['--json', 'alpha', 'omega', '--workspace-root', tmpDir];
      assert.deepEqual([...stripped, '--workspace-root', tmpDir], baseline, command);
    }
  });

  test('authority refusal happens before cache or fetch work', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    let requests = 0;
    let writes = 0;
    const result = await maybeShowUpdateNotice(options({
      fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '0.33.0' })); },
      atomic: { mkdirSync: () => { writes += 1; throw new Error('must not mkdir'); }, writeFileAtomic: () => { writes += 1; throw new Error('must not write'); } },
    }));
    assert.equal(result.checked, false);
    assert.equal(requests, 0);
    assert.equal(writes, 0);
  });

  test('missing bounded response stream fails closed without calling arrayBuffer', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    let arrayBufferCalls = 0;
    const result = await maybeShowUpdateNotice(options({
      fetchImpl: async () => ({
        status: 200,
        url: ENDPOINT,
        headers: { get: () => null },
        async arrayBuffer() { arrayBufferCalls += 1; return Buffer.from('{"version":"0.33.0"}'); },
      }),
    }));
    assert.equal(arrayBufferCalls, 0);
    assert.equal(result.cache.error, 'invalid');
    assert.deepEqual(options({}).lines, []);
  });

  test('cache schema rejects missing and extra keys', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    for (const value of [
      { schema: 1, checkedAt: '2026-08-13T11:00:00.000Z', status: 'available', latestVersion: '0.32.0' },
      { schema: 1, checkedAt: '2026-08-13T11:00:00.000Z', status: 'available', latestVersion: '0.32.0', error: null, extra: true },
    ]) {
      fs.writeFileSync(cachePath(), JSON.stringify(value));
      let requests = 0;
      await maybeShowUpdateNotice(options({ fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '0.32.0' })); } }));
      assert.equal(requests, 1);
    }
  });

  test('init copies update-awareness bytes, owns the manifest hash, embeds version, and update repairs removal', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.equal(initialized.exitCode, 0, initialized.output);
    const sourcePath = path.join(ROOT, 'bin', 'lib', 'update-awareness.mjs');
    const helperPath = path.join(tmpDir, '.work', 'bin', 'lib', 'update-awareness.mjs');
    const launcherPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const sourceBytes = fs.readFileSync(sourcePath);
    assert.deepEqual(fs.readFileSync(helperPath), sourceBytes);
    assert.equal(readJson(manifestPath).runtimeHelpers['bin/lib/update-awareness.mjs'], sha256(sourceBytes));
    assert.match(fs.readFileSync(launcherPath, 'utf8'), /const PACKAGE_VERSION = "0\.32\.0";/);
    assert.match(fs.readFileSync(launcherPath, 'utf8'), /--no-update-notice/);
    fs.rmSync(helperPath);
    const repaired = await runCliAsMain(tmpDir, ['update']);
    assert.equal(repaired.exitCode, 0, repaired.output);
    assert.deepEqual(fs.readFileSync(helperPath), sourceBytes);
    assert.equal(readJson(manifestPath).runtimeHelpers['bin/lib/update-awareness.mjs'], sha256(sourceBytes));
  });

  test('generated helper uses the copied module for eligible and silent commands alike', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.equal(initialized.exitCode, 0, initialized.output);
    const help = runGeneratedHelper(tmpDir, ['help']);
    assert.equal(help.exitCode, 0, help.output);
    assert.match(help.output, /--no-update-notice/);
    const silent = runGeneratedHelper(tmpDir, ['control-map', '--json']);
    assert.notEqual(silent.exitCode, 1, silent.output);
    const readOnly = runGeneratedHelper(tmpDir, ['next', '--json', '--no-update-notice']);
    assert.equal(readOnly.exitCode, 0, readOnly.output);
    const eligible = runGeneratedHelper(tmpDir, ['remember', '--no-update-notice']);
    assert.notEqual(eligible.exitCode, null, eligible.output);
  });

  test('one absolute deadline bounds a stalled read and stalled cancellation', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const hanging = makeHangingResponse({ cancel: true });
    const started = Date.now();
    const result = await maybeShowUpdateNotice(options({
      fetchImpl: async () => hanging.response,
    }));
    const elapsed = Date.now() - started;
    assert.equal(result.cache.error, 'timeout');
    assert.equal(hanging.cancelCalls, 1);
    assert.ok(elapsed < 2500, `returned after ${elapsed}ms`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process._getActiveHandles().filter((handle) => handle?.constructor?.name === 'Timeout').length, 0);
  });

  test('one absolute deadline bounds async-iterator next and never-settling return', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const hanging = makeHangingIteratorResponse();
    const started = Date.now();
    const result = await maybeShowUpdateNotice(options({ fetchImpl: async () => hanging.response }));
    const elapsed = Date.now() - started;
    assert.equal(result.cache.error, 'timeout');
    assert.equal(hanging.nextCalls, 1);
    assert.equal(hanging.returnCalls, 1);
    assert.ok(elapsed < 2500, `iterator returned after ${elapsed}ms`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process._getActiveHandles().filter((handle) => handle?.constructor?.name === 'Timeout').length, 0);
  });

  test('real links refuse cache escape and leave an external canary untouched', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const external = createTempProject();
    const canary = path.join(external, 'canary.txt');
    fs.writeFileSync(canary, 'outside');
    const localDir = path.join(workDir, '.local');
    fs.symlinkSync(external, localDir, process.platform === 'win32' ? 'junction' : 'dir');
    let requests = 0;
    try {
      const result = await maybeShowUpdateNotice(options({
        fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '9.9.9' })); },
      }));
      assert.equal(result.checked, false);
      assert.equal(requests, 0);
      assert.equal(fs.readFileSync(canary, 'utf8'), 'outside');
      assert.equal(fs.existsSync(path.join(external, 'update-awareness.json')), false);
      fs.rmSync(localDir, { recursive: true, force: true });
      fs.mkdirSync(localDir, { recursive: true });
      const externalCache = path.join(external, 'linked-cache.json');
      fs.writeFileSync(externalCache, '{"schema":1}');
      fs.symlinkSync(externalCache, cachePath(), 'file');
      const linked = await maybeShowUpdateNotice(options({ fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '9.9.9' })); } }));
      assert.equal(linked.checked, false);
      assert.equal(requests, 0);
      assert.equal(fs.readFileSync(externalCache, 'utf8'), '{"schema":1}');
    } finally {
      cleanup(external);
    }
  });

  test('junction capability is explicit and never substituted for symlink containment proof', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const external = createTempProject();
    const junction = path.join(workDir, '.local-junction');
    let outcome = 'available';
    try {
      try {
        fs.symlinkSync(external, junction, 'junction');
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error?.code)) outcome = 'junction_unavailable';
        else throw error;
      }
      assert.match(outcome, /^(available|junction_unavailable)$/);
      if (outcome === 'available') {
        fs.rmSync(path.join(workDir, '.local'), { recursive: true, force: true });
        fs.renameSync(junction, path.join(workDir, '.local'));
        const result = await maybeShowUpdateNotice(options({ fetchImpl: async () => fakeResponse(JSON.stringify({ version: '9.9.9' })) }));
        assert.equal(result.checked, false);
        assert.equal(fs.existsSync(path.join(external, 'update-awareness.json')), false);
      }
    } finally {
      if (fs.existsSync(junction)) fs.rmSync(junction, { recursive: true, force: true });
      cleanup(external);
    }
  });

  test('mkdir failure is nonblocking before fetch and preserves the external canary', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    let requests = 0;
    const result = await maybeShowUpdateNotice(options({
      fetchImpl: async () => { requests += 1; return fakeResponse(JSON.stringify({ version: '9.9.9' })); },
      atomic: { mkdirSync: () => { throw new Error('injected mkdir failure'); } },
    }));
    assert.equal(result.checked, false);
    assert.equal(requests, 0);
    assert.equal(fs.existsSync(cachePath()), false);
  });

  test('redirect, non-2xx, timeout, declared oversize, and malformed responses fail closed', async () => {
    const { maybeShowUpdateNotice } = await loadUpdateAwareness();
    const cases = [
      [{ status: 200, url: 'https://registry.npmjs.org/redirected', body: fakeResponse('{}').body }, 'invalid'],
      [{ status: 503, url: ENDPOINT, body: fakeResponse('{}').body }, 'http'],
      [{ status: 200, url: ENDPOINT, headers: { get: () => String(65 * 1024) }, body: fakeResponse('{}').body }, 'oversize'],
      [{ status: 200, url: ENDPOINT, headers: { get: () => null }, body: fakeResponse('{"version":"bad"}').body }, 'invalid'],
    ];
    for (const [response, expected] of cases) {
      const isolated = createTempProject();
      fs.mkdirSync(path.join(isolated, '.work'), { recursive: true });
      try {
        const result = await maybeShowUpdateNotice({ ...options({ fetchImpl: async () => response }), cwd: isolated });
        assert.equal(result.cache.error, expected);
      } finally {
        cleanup(isolated);
      }
    }
    const timeoutRoot = createTempProject();
    fs.mkdirSync(path.join(timeoutRoot, '.work'), { recursive: true });
    const timeout = await maybeShowUpdateNotice({ ...options({ fetchImpl: () => new Promise(() => {}) }), cwd: timeoutRoot });
    cleanup(timeoutRoot);
    assert.equal(timeout.cache.error, 'timeout');
  });

  test('public dispatch matrix proves enabled and opt-out parity with restoration', async () => {
    const rows = {
      init: ['--tools'], install: ['--tools'], health: ['--json'], update: ['--dry'], help: [],
      models: ['show'], rigor: ['show'], 'file-op': ['unknown'], 'lifecycle-preflight': [],
      next: ['--json'], verify: ['999999'], 'phase-status': [], scaffold: [], 'find-phase': [],
      journey: ['--json'], remember: [], decisions: [], 'git-identity': [],
    };
    for (const [command, args] of Object.entries(rows)) {
      const fixture = createTempProject();
      fs.mkdirSync(path.join(fixture, '.work'), { recursive: true });
      try {
        const observations = {};
        for (const [mode, awareness] of [['baseline', '1'], ['opt-out', '0']]) {
          const capture = captureProcessSeams();
          let fetchCalls = 0;
          try {
            process.chdir(fixture);
            process.argv = [process.execPath, path.join(ROOT, 'bin', 'gsdd.mjs')];
            process.env.GSDD_TEST_HOME = fixture;
            process.env.HOME = fixture;
            process.env.USERPROFILE = fixture;
            process.env.GSDD_UPDATE_AWARENESS = awareness;
            delete process.env.GSDD_WORKSPACE_ROOT;
            globalThis.fetch = async () => {
              fetchCalls += 1;
              return fakeResponse(JSON.stringify({ version: '0.32.0' }));
            };
            const cli = await import(`${pathToFileURL(path.join(ROOT, 'bin', 'gsdd.mjs')).href}?matrix=${mode}-${Date.now()}-${Math.random()}`);
            await cli.runCli(command, ...args);
            assert.equal(typeof process.exitCode, 'number', `${command} ${mode} must set an exit code`);
            const cacheFile = path.join(fixture, CACHE_RELATIVE);
            const cacheExists = fs.existsSync(cacheFile);
            const cacheRelative = cacheExists
              ? path.relative(fs.realpathSync(path.join(fixture, '.work')), fs.realpathSync(cacheFile))
              : null;
            observations[mode] = {
              stdout: capture.stdout.slice(),
              stderr: capture.stderr.slice(),
              argv: process.argv.slice(),
              exitCode: process.exitCode,
              fetchCalls,
              cacheExists,
              cacheRelative,
            };
            const eligible = ['phase-status', 'scaffold', 'remember'].includes(command);
            if (mode === 'baseline') {
              assert.equal(fetchCalls, eligible ? 1 : 0, `${command} baseline fetch eligibility`);
              assert.equal(cacheExists, eligible, `${command} baseline cache eligibility`);
              if (eligible) assert.equal(cacheRelative, path.join('.local', 'update-awareness.json'), `${command} baseline cache containment`);
            } else {
              assert.equal(fetchCalls, 0, `${command} opt-out fetch suppression`);
              assert.equal(cacheExists, false, `${command} opt-out cache suppression`);
            }
            if (observations.baseline && observations['opt-out']) {
              assert.deepEqual(observations['opt-out'].stdout, observations.baseline.stdout, `${command} stdout parity`);
              assert.deepEqual(observations['opt-out'].stderr, observations.baseline.stderr, `${command} stderr parity`);
              assert.deepEqual(observations['opt-out'].argv, observations.baseline.argv, `${command} argv parity`);
              assert.equal(observations['opt-out'].exitCode, observations.baseline.exitCode, `${command} exit-code parity`);
            }
          } finally {
            capture.restore();
            assert.equal(process.cwd(), capture.previous.cwd, `${command} ${mode} restores cwd`);
            assert.deepEqual(process.argv, capture.previous.argv, `${command} ${mode} restores argv`);
            assert.deepEqual({ ...process.env }, capture.previous.env, `${command} ${mode} restores environment`);
            assert.equal(Object.prototype.hasOwnProperty.call(process.env, 'GSDD_UPDATE_AWARENESS'), Object.prototype.hasOwnProperty.call(capture.previous.env, 'GSDD_UPDATE_AWARENESS'), `${command} ${mode} restores environment presence`);
            assert.equal(process.env.GSDD_UPDATE_AWARENESS, capture.previous.env.GSDD_UPDATE_AWARENESS, `${command} ${mode} restores environment value`);
            assert.equal(globalThis.fetch, capture.previous.fetch, `${command} ${mode} restores fetch`);
            assert.equal(console.log, capture.previous.log, `${command} ${mode} restores stdout seam`);
            assert.equal(console.error, capture.previous.error, `${command} ${mode} restores stderr seam`);
            assert.equal(process.exitCode, capture.previous.exitCode, `${command} ${mode} restores exitCode`);
          }
          if (mode === 'baseline') {
            cleanup(fixture);
            fs.mkdirSync(path.join(fixture, '.work'), { recursive: true });
          }
        }
      } finally {
        cleanup(fixture);
      }
    }
  });

  test('generated helper matrix proves enabled and opt-out parity with restoration', async () => {
    const rows = {
      'control-map': ['--json'], decisions: [], 'file-op': ['unknown'], 'git-identity': [],
      'lifecycle-preflight': [], 'phase-status': [], remember: [], verify: ['999999'], next: ['--json'],
    };
    for (const [command, args] of Object.entries(rows)) {
      const fixture = createTempProject();
      try {
        const observations = {};
        for (const [mode, awareness] of [['baseline', '1'], ['opt-out', '0']]) {
          if (mode === 'opt-out') {
            cleanup(fixture);
            fs.mkdirSync(fixture, { recursive: true });
          }
          const initialized = await runCliAsMain(fixture, ['init', '--auto', '--tools', 'agents']);
          assert.equal(initialized.exitCode, 0, initialized.output);
          const capture = captureProcessSeams();
          let fetchCalls = 0;
          try {
            process.chdir(fixture);
            process.argv = [process.execPath, path.join(fixture, '.work', 'bin', 'gsdd.mjs'), command, ...args];
            process.env.GSDD_TEST_HOME = fixture;
            process.env.HOME = fixture;
            process.env.USERPROFILE = fixture;
            process.env.GSDD_UPDATE_AWARENESS = awareness;
            delete process.env.GSDD_WORKSPACE_ROOT;
            globalThis.fetch = async () => {
              fetchCalls += 1;
              return fakeResponse(JSON.stringify({ version: '0.32.0' }));
            };
            const helperPath = path.join(fixture, '.work', 'bin', 'gsdd.mjs');
            const helperSource = fs.readFileSync(helperPath, 'utf8');
            assert.match(helperSource, /withWorkspaceAuthority\(command, update\.args\)/);
            const handlerCall = '  await handler(...withWorkspaceAuthority(command, update.args));';
            assert.equal(helperSource.includes(handlerCall), true, `${command} helper handler seam`);
            fs.writeFileSync(helperPath, helperSource.replace(handlerCall, '  globalThis.__gsddObservedHandlerArgs = withWorkspaceAuthority(command, update.args);\n  await handler(...globalThis.__gsddObservedHandlerArgs);'));
            globalThis.__gsddObservedHandlerArgs = null;
            await import(`${pathToFileURL(helperPath).href}?helper-matrix=${mode}-${Date.now()}-${Math.random()}`);
            const cacheFile = path.join(fixture, CACHE_RELATIVE);
            const cacheExists = fs.existsSync(cacheFile);
            const cacheRelative = cacheExists
              ? path.relative(fs.realpathSync(path.join(fixture, '.work')), fs.realpathSync(cacheFile))
              : null;
            const handlerArgs = globalThis.__gsddObservedHandlerArgs;
            observations[mode] = {
              stdout: capture.stdout.slice(),
              stderr: capture.stderr.slice(),
              argv: process.argv.slice(),
              handlerArgs: Array.isArray(handlerArgs) ? handlerArgs.slice() : handlerArgs,
              exitCode: process.exitCode,
              fetchCalls,
              cacheExists,
              cacheRelative,
            };
            if (['decisions', 'file-op', 'lifecycle-preflight', 'phase-status', 'remember', 'verify'].includes(command)) {
              assert.ok(Array.isArray(handlerArgs), `${command} helper handler argv capture`);
              const workspaceRootIndex = handlerArgs.indexOf('--workspace-root');
              assert.ok(workspaceRootIndex >= 0, `${command} helper handler argv workspace-root flag`);
              assert.equal(handlerArgs[workspaceRootIndex + 1], fixture, `${command} helper handler argv workspace-root value`);
            }
            const eligible = ['phase-status', 'remember'].includes(command);
            if (mode === 'baseline') {
              assert.equal(fetchCalls, eligible ? 1 : 0, `${command} helper baseline fetch eligibility`);
              assert.equal(cacheExists, eligible, `${command} helper baseline cache eligibility`);
              if (eligible) assert.equal(cacheRelative, path.join('.local', 'update-awareness.json'), `${command} helper baseline cache containment`);
            } else {
              assert.equal(fetchCalls, 0, `${command} helper opt-out fetch suppression`);
              assert.equal(cacheExists, false, `${command} helper opt-out cache suppression`);
            }
            if (observations.baseline && observations['opt-out']) {
              const normalizeStdout = (stdout) => {
                if (command === 'control-map') {
                  const parsed = JSON.parse(stdout.join(''));
                  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'generated_at'), true, `${command} helper generated_at field`);
                  assert.equal(typeof parsed.generated_at, 'string', `${command} helper generated_at type`);
                  assert.equal(new Date(parsed.generated_at).toISOString(), parsed.generated_at, `${command} helper generated_at ISO timestamp`);
                  const { generated_at: _generatedAt, ...normalized } = parsed;
                  return normalized;
                }
                if (command !== 'next') return stdout;
                const parsed = JSON.parse(stdout.join(''));
                assert.equal(Array.isArray(parsed.trace_refs), true, `${command} helper trace_refs array`);
                const { trace_refs: _traceRefs, ...normalized } = parsed;
                return normalized;
              };
              assert.deepEqual(
                normalizeStdout(observations['opt-out'].stdout),
                normalizeStdout(observations.baseline.stdout),
                `${command} helper stdout parity`,
              );
              assert.deepEqual(observations['opt-out'].stderr, observations.baseline.stderr, `${command} helper stderr parity`);
              assert.deepEqual(observations['opt-out'].argv, observations.baseline.argv, `${command} helper argv parity`);
              assert.equal(observations['opt-out'].exitCode, observations.baseline.exitCode, `${command} helper exit-code parity`);
            }
          } finally {
            delete globalThis.__gsddObservedHandlerArgs;
            capture.restore();
            assert.equal(process.cwd(), capture.previous.cwd, `${command} helper ${mode} restores cwd`);
            assert.deepEqual(process.argv, capture.previous.argv, `${command} helper ${mode} restores argv`);
            assert.deepEqual({ ...process.env }, capture.previous.env, `${command} helper ${mode} restores environment`);
            assert.equal(Object.prototype.hasOwnProperty.call(process.env, 'GSDD_UPDATE_AWARENESS'), Object.prototype.hasOwnProperty.call(capture.previous.env, 'GSDD_UPDATE_AWARENESS'), `${command} helper ${mode} restores environment presence`);
            assert.equal(process.env.GSDD_UPDATE_AWARENESS, capture.previous.env.GSDD_UPDATE_AWARENESS, `${command} helper ${mode} restores environment value`);
            assert.equal(globalThis.fetch, capture.previous.fetch, `${command} helper ${mode} restores fetch`);
            assert.equal(console.log, capture.previous.log, `${command} helper ${mode} restores stdout seam`);
            assert.equal(console.error, capture.previous.error, `${command} helper ${mode} restores stderr seam`);
            assert.equal(process.exitCode, capture.previous.exitCode, `${command} helper ${mode} restores exitCode`);
          }
        }
      } finally {
        cleanup(fixture);
      }
    }
  });

  test('cadence wording is sequential and best-effort, never an absolute once-per-day guarantee', async () => {
    const update = await loadUpdateAwareness();
    const launcher = (await import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'rendering.mjs')).href}?cadence=${Date.now()}`)).renderPlanningCliLauncher({ packageName: 'workspine', packageVersion: '0.32.0' });
    assert.match(launcher, /sequential|best-effort/i);
    assert.match(launcher, /no lock|no concurrency guarantee/i);
    for (const file of ['README.md', 'docs/RUNTIME-SUPPORT.md', 'docs/USER-GUIDE.md']) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.match(content, /sequential|best-effort/i);
      assert.match(content, /no lock|no concurrency guarantee/i);
      assert.doesNotMatch(content, /at most once per 24 hours/i);
    }
    assert.ok(update.NOTICE_TEXT.includes('repair'));
  });
});
