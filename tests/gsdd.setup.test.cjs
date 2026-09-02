const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { cleanup, createTempProject, runCliAsMain, withEnv } = require('./gsdd.helpers.cjs');

const ROOT = path.join(__dirname, '..');
const NPM = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const NPM_PREFIX = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function snapshotTree(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return [{ path: `${relative}/`, directory: true }, ...snapshotTree(absolute, relative)];
    if (entry.isSymbolicLink()) return [{ path: relative, link: fs.readlinkSync(absolute) }];
    return [{ path: relative, bytes: fs.readFileSync(absolute).toString('base64') }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function runInstalled(entryPath, cwd, args, env = {}) {
  return spawnSync(process.execPath, [entryPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', ...env },
  });
}

function installPackedEntry() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-packed-'));
  const pack = path.join(root, 'pack');
  const install = path.join(root, 'install');
  fs.mkdirSync(pack, { recursive: true });
  fs.mkdirSync(install, { recursive: true });
  const packed = JSON.parse(execFileSync(NPM, [...NPM_PREFIX, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', pack], { cwd: ROOT, encoding: 'utf8' }));
  assert.strictEqual(packed.length, 1);
  const tarball = path.join(pack, packed[0].filename);
  writeFile(path.join(install, 'package.json'), '{"name":"packed-setup-consumer","private":true}\n');
  execFileSync(NPM, [...NPM_PREFIX, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', tarball], { cwd: install, stdio: 'pipe' });
  const packageName = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
  const packageRoot = path.join(install, 'node_modules', packageName);
  return { root, install, entry: fs.realpathSync(path.join(packageRoot, 'bin', 'gsdd.mjs')) };
}

async function runPromptedSetup(root, args, setupPromptApi) {
  const [{ createCliContext }, { createCmdSetup }] = await Promise.all([
    import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'cli-context.mjs')).href}?t=${Date.now()}-${Math.random()}`),
    import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'setup.mjs')).href}?t=${Date.now()}-${Math.random()}`),
  ]);
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const lines = [];
  const previousLog = console.log;
  const previousError = console.error;
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  process.chdir(root);
  console.log = (...parts) => lines.push(parts.join(' '));
  console.error = (...parts) => lines.push(parts.join(' '));
  try {
    process.exitCode = 0;
    await createCmdSetup({ ...createCliContext(root), setupPromptApi })(...args);
    return { exitCode: process.exitCode ?? 0, output: lines.join('\n') };
  } finally {
    console.log = previousLog;
    console.error = previousError;
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
    else delete process.stdin.isTTY;
  }
}

describe('gsdd setup facade', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('defaults to project scope, creates portable skills, and reruns without writes', async () => {
    const first = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(first.exitCode, 0, first.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'config.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-quick', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')), 'generic governance is opt-in');
    const before = fs.readFileSync(path.join(tmpDir, '.work', 'generation-manifest.json'));
    const second = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(second.exitCode, 0, second.output);
    assert.match(second.output, /state already exists/);
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.work', 'generation-manifest.json')), before);
  });

  test('dry run is zero-write and hidden --dry remains compatible', async () => {
    const before = fs.readdirSync(tmpDir);
    const result = await runCliAsMain(tmpDir, ['setup', '--dry-run']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /dry run/);
    assert.deepStrictEqual(fs.readdirSync(tmpDir), before);
    const hidden = await runCliAsMain(tmpDir, ['setup', '--dry']);
    assert.strictEqual(hidden.exitCode, 0, hidden.output);
  });

  test('headless setup without consent fails closed', async () => {
    const result = await runCliAsMain(tmpDir, ['setup']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /Non-interactive setup requires/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
  });

  test('strict setup grammar rejects U/D/M/P errors without writing', async () => {
    for (const args of [
      ['setup', '--auto'],
      ['setup', '-y', '-y'],
      ['setup', '--agent'],
      ['setup', 'unexpected'],
    ]) {
      const before = snapshotTree(tmpDir);
      const result = await runCliAsMain(tmpDir, args);
      assert.strictEqual(result.exitCode, 1, `${args.join(' ')}\n${result.output}`);
      assert.deepStrictEqual(snapshotTree(tmpDir), before, `${args.join(' ')} wrote bytes`);
    }
  });

  test('partial current state is zero-write and routes to update/health', async () => {
    writeFile(path.join(tmpDir, '.work', 'config.json'), '{"initVersion":"v1.1"}\n');
    const before = snapshotTree(tmpDir);
    const result = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /update/);
    assert.match(result.output, /health/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
  });

  test('migration is explicit in headless mode and accepted migration continues setup', async () => {
    writeFile(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const before = snapshotTree(tmpDir);
    const refused = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(refused.exitCode, 1);
    assert.match(refused.output, /setup --migrate/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
    const accepted = await runCliAsMain(tmpDir, ['setup', '--migrate', '-y']);
    assert.strictEqual(accepted.exitCode, 0, accepted.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'migration-receipt.json')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
  });

  test('bare interactive setup defaults to this repo and recommended portable skills with one consent', async () => {
    let consentPrompts = 0;
    const result = await runPromptedSetup(tmpDir, [], {
      chooseSetupScope: async () => { throw new Error('bare setup must not ask for scope'); },
      chooseProjectMode: async () => { throw new Error('bare setup must not ask for a project mode'); },
      selectProjectTargets: async () => { throw new Error('bare setup must not ask for native targets'); },
      confirmSetup: async ({ details }) => {
        consentPrompts += 1;
        assert.match(details.join(' '), /Bounded write set: \.work\//);
        assert.match(details.join(' '), /portable selected project surfaces/);
        return true;
      },
    });

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(consentPrompts, 1);
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex')), 'native targets stay explicit');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')), 'root governance stays explicit');
    assert.doesNotMatch(result.output, /Config summary:/);
    assert.match(result.output, /Configuration: medium rigor, balanced models, tracked \.work\/ documents\./);
    assert.match(result.output, /Start with one small planned change/i);
    assert.match(result.output, /work-plan[\s\S]*owner approval[\s\S]*work-execute[\s\S]*work-verify/i);
    assert.ok(result.output.indexOf('work-plan') < result.output.indexOf('work-quick'), 'the trustworthy loop must appear before the shortcut');
  });

  test('interactive explicit target, consent, and migration decline are bounded', async () => {
    const customizedRoot = path.join(tmpDir, 'customized');
    fs.mkdirSync(customizedRoot);
    const declined = await runPromptedSetup(customizedRoot, ['--agent', 'codex'], {
      confirmSetup: async () => false,
    });
    assert.strictEqual(declined.exitCode, 1);
    assert.ok(!fs.existsSync(path.join(customizedRoot, '.work')));

    const accepted = await runPromptedSetup(customizedRoot, ['--agent', 'codex'], {
      confirmSetup: async () => true,
    });
    assert.strictEqual(accepted.exitCode, 0, accepted.output);
    assert.ok(fs.existsSync(path.join(customizedRoot, '.codex', 'agents')));

    const legacyRoot = path.join(tmpDir, 'legacy-interactive');
    writeFile(path.join(legacyRoot, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const legacyBefore = snapshotTree(legacyRoot);
    const migrationDeclined = await runPromptedSetup(legacyRoot, [], {
      confirmLegacyMigration: async () => false,
    });
    assert.strictEqual(migrationDeclined.exitCode, 1);
    assert.deepStrictEqual(snapshotTree(legacyRoot), legacyBefore);

    const migrationConsentRoot = path.join(tmpDir, 'legacy-consent');
    writeFile(path.join(migrationConsentRoot, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const migrationConsentBefore = snapshotTree(migrationConsentRoot);
    let migrationPrompts = 0;
    const migrationConsentDeclined = await runPromptedSetup(migrationConsentRoot, [], {
      confirmLegacyMigration: async () => {
        migrationPrompts += 1;
        return true;
      },
      confirmSetup: async ({ details }) => {
        migrationPrompts += 1;
        assert.match(details.join(' '), /Bounded write set: \.work\//);
        return false;
      },
    });
    assert.strictEqual(migrationConsentDeclined.exitCode, 1);
    assert.strictEqual(migrationPrompts, 2, 'migration approval and final write consent are separate prompts');
    assert.deepStrictEqual(snapshotTree(migrationConsentRoot), migrationConsentBefore);
  });

  test('taxonomy, collision refusal, Gitless containment, and global isolation hold', async () => {
    const invalidAgent = await runCliAsMain(tmpDir, ['setup', '--agent', 'copilot', '-y']);
    assert.strictEqual(invalidAgent.exitCode, 1);
    const collisionRoot = path.join(tmpDir, 'collision');
    fs.mkdirSync(collisionRoot, { recursive: true });
    writeFile(path.join(collisionRoot, '.agents', 'skills', 'work-quick', 'SKILL.md'), 'user-owned\n');
    const beforeCollision = snapshotTree(collisionRoot);
    const collision = await runCliAsMain(tmpDir, ['setup', '--workspace-root', collisionRoot, '-y']);
    assert.strictEqual(collision.exitCode, 1, collision.output);
    assert.deepStrictEqual(snapshotTree(collisionRoot), beforeCollision);

    const parent = path.join(tmpDir, 'parent');
    const child = path.join(parent, 'child');
    fs.mkdirSync(child, { recursive: true });
    writeFile(path.join(parent, '.work', 'config.json'), '{"user":"ancestor"}\n');
    const isolated = await runCliAsMain(child, ['setup', '-y']);
    assert.strictEqual(isolated.exitCode, 0, isolated.output);
    assert.ok(fs.existsSync(path.join(child, '.work')));
    assert.deepStrictEqual(fs.readFileSync(path.join(parent, '.work', 'config.json'), 'utf8'), '{"user":"ancestor"}\n');
    assert.ok(!fs.existsSync(path.join(child, '.git')), 'setup must not run git init');

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-home-'));
    try {
      const globalResult = await withEnv({ GSDD_TEST_HOME: home }, () => runCliAsMain(tmpDir, ['setup', '--global', '--agent', 'codex', '-y']));
      assert.strictEqual(globalResult.exitCode, 0, globalResult.output);
      assert.ok(fs.existsSync(path.join(home, '.codex', 'agents')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.agents')));
    } finally {
      cleanup(home);
    }
  });

  test('global detection auto-selects one home and fails closed on zero or many with -y', async () => {
    const oneHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-one-home-'));
    try {
      fs.mkdirSync(path.join(oneHome, '.claude'));
      const one = await withEnv({ GSDD_TEST_HOME: oneHome }, () => runCliAsMain(tmpDir, ['setup', '--global', '-y']));
      assert.strictEqual(one.exitCode, 0, one.output);
      assert.ok(fs.existsSync(path.join(oneHome, '.claude', 'skills')));
    } finally {
      cleanup(oneHome);
    }
    const manyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-many-home-'));
    try {
      fs.mkdirSync(path.join(manyHome, '.claude'));
      fs.mkdirSync(path.join(manyHome, '.codex'));
      const many = await withEnv({ GSDD_TEST_HOME: manyHome }, () => runCliAsMain(tmpDir, ['setup', '--global', '-y']));
      assert.strictEqual(many.exitCode, 1);
      assert.match(many.output, /Multiple agent homes detected/);
    } finally {
      cleanup(manyHome);
    }
  });

  test('offline packed installed entry covers the setup matrix in one install', () => {
    const packed = installPackedEntry();
    try {
      const repo = path.join(packed.root, 'repo');
      fs.mkdirSync(repo);
      const first = runInstalled(packed.entry, repo, ['setup', '-y']);
      assert.strictEqual(first.status, 0, first.stderr || first.stdout);
      assert.ok(fs.existsSync(path.join(repo, '.agents', 'skills', 'work-quick', 'SKILL.md')));
      const repoBeforeRerun = snapshotTree(repo);
      const second = runInstalled(packed.entry, repo, ['setup', '--yes']);
      assert.strictEqual(second.status, 0, second.stderr || second.stdout);
      assert.match(second.stdout, /state already exists/);
      assert.deepStrictEqual(snapshotTree(repo), repoBeforeRerun);

      const projectCodex = path.join(packed.root, 'project-codex');
      fs.mkdirSync(projectCodex);
      const codex = runInstalled(packed.entry, projectCodex, ['setup', '--agent', 'codex', '--yes']);
      assert.strictEqual(codex.status, 0, codex.stderr || codex.stdout);
      assert.ok(fs.existsSync(path.join(projectCodex, '.codex', 'agents')));

      const projectAll = path.join(packed.root, 'project-all');
      fs.mkdirSync(projectAll);
      const all = runInstalled(packed.entry, projectAll, ['setup', '--all', '-y']);
      assert.strictEqual(all.status, 0, all.stderr || all.stdout);
      assert.ok(fs.existsSync(path.join(projectAll, 'AGENTS.md')));
      assert.ok(fs.existsSync(path.join(projectAll, '.claude')));
      assert.ok(fs.existsSync(path.join(projectAll, '.opencode')));
      assert.ok(fs.existsSync(path.join(projectAll, '.codex')));

      for (const [index, args] of [
        ['--auto'],
        ['-y', '-y'],
        ['--agent'],
        ['unexpected'],
      ].entries()) {
        const grammarRoot = path.join(packed.root, `grammar-${index}`);
        fs.mkdirSync(grammarRoot);
        const before = snapshotTree(grammarRoot);
        const invalid = runInstalled(packed.entry, grammarRoot, ['setup', ...args]);
        assert.notStrictEqual(invalid.status, 0, args.join(' '));
        assert.deepStrictEqual(snapshotTree(grammarRoot), before, `${args.join(' ')} wrote bytes`);
      }

      const dryRunRoot = path.join(packed.root, 'dry-run');
      fs.mkdirSync(dryRunRoot);
      const dryBefore = snapshotTree(dryRunRoot);
      for (const flag of ['--dry-run', '--dry']) {
        const dry = runInstalled(packed.entry, dryRunRoot, ['setup', flag]);
        assert.strictEqual(dry.status, 0, dry.stderr || dry.stdout);
        assert.deepStrictEqual(snapshotTree(dryRunRoot), dryBefore, `${flag} wrote bytes`);
      }

      const consentRoot = path.join(packed.root, 'consent');
      fs.mkdirSync(consentRoot);
      const consentBefore = snapshotTree(consentRoot);
      const noConsent = runInstalled(packed.entry, consentRoot, ['setup']);
      assert.notStrictEqual(noConsent.status, 0);
      assert.match(noConsent.stdout + noConsent.stderr, /requires -y/);
      assert.deepStrictEqual(snapshotTree(consentRoot), consentBefore);

      const legacyRoot = path.join(packed.root, 'legacy');
      writeFile(path.join(legacyRoot, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      const legacyBefore = snapshotTree(legacyRoot);
      const legacyRefused = runInstalled(packed.entry, legacyRoot, ['setup', '-y']);
      assert.notStrictEqual(legacyRefused.status, 0);
      assert.match(legacyRefused.stdout + legacyRefused.stderr, /setup --migrate/);
      assert.deepStrictEqual(snapshotTree(legacyRoot), legacyBefore);
      const migrateWithoutConsent = runInstalled(packed.entry, legacyRoot, ['setup', '--migrate']);
      assert.notStrictEqual(migrateWithoutConsent.status, 0);
      assert.deepStrictEqual(snapshotTree(legacyRoot), legacyBefore);
      const migrated = runInstalled(packed.entry, legacyRoot, ['setup', '--migrate', '-y']);
      assert.strictEqual(migrated.status, 0, migrated.stderr || migrated.stdout);
      assert.ok(fs.existsSync(path.join(legacyRoot, '.work', 'migration-receipt.json')));
      assert.ok(!fs.existsSync(path.join(legacyRoot, '.planning')));

      const partialRoot = path.join(packed.root, 'partial');
      writeFile(path.join(partialRoot, '.work', 'config.json'), '{"initVersion":"v1.1"}\n');
      const partialBefore = snapshotTree(partialRoot);
      const partial = runInstalled(packed.entry, partialRoot, ['setup', '-y']);
      assert.strictEqual(partial.status, 0, partial.stderr || partial.stdout);
      assert.match(partial.stdout, /update/);
      assert.match(partial.stdout, /health/);
      assert.deepStrictEqual(snapshotTree(partialRoot), partialBefore);

      const ancestor = path.join(packed.root, 'ancestor');
      const exactCwd = path.join(ancestor, 'exact-cwd');
      const explicitRoot = path.join(ancestor, 'explicit-root');
      fs.mkdirSync(exactCwd, { recursive: true });
      writeFile(path.join(ancestor, '.work', 'config.json'), '{"user":"ancestor"}\n');
      const exact = runInstalled(packed.entry, exactCwd, ['setup', '-y']);
      assert.strictEqual(exact.status, 0, exact.stderr || exact.stdout);
      assert.ok(fs.existsSync(path.join(exactCwd, '.work')));
      assert.ok(!fs.existsSync(path.join(exactCwd, '.git')));
      fs.mkdirSync(explicitRoot, { recursive: true });
      fs.mkdirSync(path.join(packed.root, 'launcher'));
      const explicit = runInstalled(packed.entry, path.join(packed.root, 'launcher'), ['setup', '--workspace-root', explicitRoot, '--yes']);
      assert.strictEqual(explicit.status, 0, explicit.stderr || explicit.stdout);
      assert.ok(fs.existsSync(path.join(explicitRoot, '.work')));
      assert.ok(!fs.existsSync(path.join(explicitRoot, '.git')));
      assert.strictEqual(fs.readFileSync(path.join(ancestor, '.work', 'config.json'), 'utf8'), '{"user":"ancestor"}\n');

      const collisionRoot = path.join(packed.root, 'collision');
      writeFile(path.join(collisionRoot, '.agents', 'skills', 'work-quick', 'SKILL.md'), 'user-owned\n');
      const collisionBefore = snapshotTree(collisionRoot);
      const collision = runInstalled(packed.entry, collisionRoot, ['setup', '-y']);
      assert.notStrictEqual(collision.status, 0);
      assert.deepStrictEqual(snapshotTree(collisionRoot), collisionBefore);

      const globalHome = path.join(packed.root, 'global-agent');
      fs.mkdirSync(globalHome);
      const globalBeforeRepo = snapshotTree(repo);
      const globalAgent = runInstalled(packed.entry, repo, ['setup', '-g', '--agent', 'codex', '--yes'], { GSDD_TEST_HOME: globalHome });
      assert.strictEqual(globalAgent.status, 0, globalAgent.stderr || globalAgent.stdout);
      assert.ok(fs.existsSync(path.join(globalHome, '.codex')));
      assert.ok(fs.existsSync(path.join(globalHome, '.agents', 'skills', 'work-plan', 'SKILL.md')));
      assert.deepStrictEqual(snapshotTree(repo), globalBeforeRepo);
      const globalBeforeAll = snapshotTree(globalHome);
      const globalAll = runInstalled(packed.entry, repo, ['setup', '--global', '--all', '-y'], { GSDD_TEST_HOME: path.join(packed.root, 'global-all') });
      assert.strictEqual(globalAll.status, 0, globalAll.stderr || globalAll.stdout);
      assert.ok(fs.existsSync(path.join(packed.root, 'global-all', '.claude')));
      assert.ok(fs.existsSync(path.join(packed.root, 'global-all', '.copilot')));
      assert.deepStrictEqual(snapshotTree(globalHome), globalBeforeAll);
    } finally {
      cleanup(packed.root);
    }
  });
});
