'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const zlib = require('node:zlib');
const test = require('node:test');

const REPO = path.resolve(__dirname, '..', '..');
const EVAL = path.join(REPO, 'tests', 'evals', 'phase16-real-agent.cjs');
const CASE = path.join(REPO, 'tests', 'evals', 'cases', 'itsdangerous-fips-sha1.json');
const LIVE = require(EVAL);

function run(args) {
  return cp.spawnSync(process.execPath, [EVAL, ...args], { cwd: REPO, encoding: 'utf8', windowsHide: true });
}

function parse(result) {
  assert.equal(result.stdout.trim().startsWith('{'), true, result.stderr);
  return JSON.parse(result.stdout);
}

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

test('catalog is provider-free and names the exact public case/workflow limits', () => {
  const result = run(['--catalog']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = parse(result);
  assert.equal(receipt.provider_invoked, false);
  assert.equal(receipt.case.id, 'itsdangerous-fips-sha1');
  assert.equal(receipt.case.revision, '93ae366874bbd4f69d90495c45b2cd336387496c');
  assert.deepEqual(receipt.workflows, ['plan', 'pause', 'resume', 'execute', 'verify', 'progress']);
  assert.match(receipt.claim_limit, /no provider/i);
});

test('mode and offline boundaries reject ambiguous or networked checks', () => {
  for (const args of [
    ['--check', '--case', CASE, '--cache', path.join(os.tmpdir(), 'missing-phase16-cache')],
    ['--prepare', '--offline', '--case', CASE, '--cache', path.join(os.tmpdir(), 'phase16-cache')],
    ['--catalog', '--case', CASE],
    ['--prepare', '--case', CASE, '--cache', path.join(os.tmpdir(), 'phase16-cache'), '--unknown'],
  ]) {
    const result = run(args);
    assert.notEqual(result.status, 0, args.join(' '));
    const receipt = parse(result);
    assert.equal(receipt.provider_invoked, false);
  }
});

test('offline check refuses missing cache, links, and nested traversal roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-real-agent-'));
  try {
    const missing = run(['--check', '--offline', '--case', CASE, '--cache', path.join(root, 'missing')]);
    assert.notEqual(missing.status, 0);
    assert.equal(parse(missing).terminal.failure_code, 'cache_missing');
    const linked = path.join(root, 'linked');
    fs.symlinkSync(root, linked, 'junction');
    const linkedResult = run(['--check', '--offline', '--case', CASE, '--cache', linked]);
    assert.notEqual(linkedResult.status, 0);
    assert.equal(parse(linkedResult).terminal.failure_code, 'cache_unsafe');
    assert.throws(() => LIVE.archiveLedger([{ member: '../outside', directory: false, body: Buffer.from('x') }], 'root'), (error) => error.code === 'source_empty');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('archive traversal and special-file controls are enforced by the reused case seam', () => {
  const header = Buffer.alloc(1024);
  Buffer.from('../outside').copy(header, 0);
  Buffer.from('0000777\0').copy(header, 100);
  Buffer.from('0000000\0').copy(header, 108);
  Buffer.from('0000000\0').copy(header, 116);
  Buffer.from('00000000000\0').copy(header, 124);
  Buffer.from('00000000000\0').copy(header, 136);
  header[156] = 48;
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) checksum += index >= 148 && index < 156 ? 32 : header[index];
  Buffer.from(`${checksum.toString(8).padStart(6, '0')}\0 `).copy(header, 148);
  assert.throws(() => require('./phase16-core-flows.cjs').caseTarEntries(zlib.gzipSync(header)), (error) => error.code === 'case_archive_traversal');
});

test('fake local upstream behavior is characterization_only and cannot be promoted to a public case', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-fake-upstream-'));
  try {
    const fakeCase = path.join(root, 'case.json');
    const data = JSON.parse(fs.readFileSync(CASE, 'utf8'));
    data.source.repository = 'file:///fake-upstream';
    fs.writeFileSync(fakeCase, JSON.stringify(data));
    const result = run(['--prepare', '--case', fakeCase, '--cache', path.join(root, 'cache')]);
    assert.notEqual(result.status, 0);
    assert.equal(parse(result).terminal.failure_code, 'case_pin_mismatch');
    // characterization_only: this fixture proves refusal construction only;
    // it cannot emit a prepared/public or live result.
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prepared/cache and private receipt writes are create-exclusive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-overwrite-'));
  try {
    const cache = path.join(root, 'cache');
    fs.mkdirSync(path.join(cache, 'itsdangerous-fips-sha1'), { recursive: true });
    const result = run(['--prepare', '--case', CASE, '--cache', cache]);
    assert.notEqual(result.status, 0);
    assert.equal(parse(result).terminal.failure_code, 'cache_exists');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('controls receipt writer refuses a second write and cleanup failure is terminal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-exclusive-'));
  const receipt = path.join(root, 'controls.json');
  const disposable = path.join(root, 'disposable');
  fs.mkdirSync(disposable);
  try {
    LIVE.writeExclusive(receipt, { schema_version: 1 });
    assert.throws(() => LIVE.writeExclusive(receipt, { schema_version: 1 }), (error) => error.code === 'receipt_exists');
    assert.throws(() => LIVE.removeDisposableRoot(disposable, { removeDisposableRoot: () => false }), (error) => error.code === 'check_root_cleanup_failed');
    assert.equal(fs.existsSync(disposable), true);
    assert.deepEqual(LIVE.removeDisposableRoot(disposable), { attempted: true, removed: true });
    assert.equal(fs.existsSync(disposable), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('controls receipt semantics bind oracle, isolation, and red/green/red results', () => {
  const controlsPath = path.join(REPO, '.work', 'phases', '16-safe-cohesive-first-run', '16-08-receipts', 'controls.json');
  if (!fs.existsSync(controlsPath)) return;
  const data = JSON.parse(fs.readFileSync(CASE, 'utf8'));
  const controls = JSON.parse(fs.readFileSync(controlsPath, 'utf8'));
  const prepared = { control_results: { results: controls.results } };
  assert.deepEqual(LIVE.validateControlsReceipt(controlsPath, data, prepared, CASE), controls);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-controls-'));
  const tampered = path.join(root, 'controls.json');
  try {
    const changed = { ...controls, mount_policy: 'live-agent-root' };
    fs.writeFileSync(tampered, JSON.stringify(changed));
    assert.throws(() => LIVE.validateControlsReceipt(tampered, data, prepared, CASE), (error) => error.code === 'controls_mismatch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('injected post-CORE binding failure removes only its owned destination', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-owned-cleanup-'));
  const cache = path.join(root, 'cache');
  const unrelated = path.join(root, 'unrelated');
  const destination = path.join(cache, 'itsdangerous-fips-sha1');
  fs.mkdirSync(unrelated, { recursive: true });
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep\n');
  const fakeCorePrepare = async (file, cacheRoot) => {
    fs.mkdirSync(destination, { recursive: true });
    return { case_sha256: sha(fs.readFileSync(file)) };
  };
  try {
    await assert.rejects(() => LIVE.preparePublicCase(CASE, cache, {
      corePrepare: fakeCorePrepare,
      archiveLedger: () => ({ sha256: 'archive', members: [] }),
      postCoreBinding: () => { throw new LIVE.RunnerFailure('injected_binding_failure', 'injected post-CORE binding failure'); },
    }), (error) => error.code === 'injected_binding_failure');
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.existsSync(path.join(unrelated, 'keep.txt')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('injected preparation cleanup failure is terminal and preserves original context', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-cleanup-failure-'));
  const cache = path.join(root, 'cache');
  const destination = path.join(cache, 'itsdangerous-fips-sha1');
  const fakeCorePrepare = async (file) => {
    fs.mkdirSync(destination, { recursive: true });
    return { case_sha256: sha(fs.readFileSync(file)) };
  };
  try {
    await assert.rejects(() => LIVE.preparePublicCase(CASE, cache, {
      corePrepare: fakeCorePrepare,
      archiveLedger: () => ({ sha256: 'archive', members: [] }),
      postCoreBinding: () => { throw new LIVE.RunnerFailure('injected_binding_failure', 'injected post-CORE binding failure'); },
      removePreparationPath: () => false,
    }), (error) => error.code === 'prepare_cleanup_failed' && error.evidence.original_failure.code === 'injected_binding_failure');
    assert.equal(fs.existsSync(destination), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('public case and oracle pins remain stable', () => {
  const data = JSON.parse(fs.readFileSync(CASE, 'utf8'));
  const oracle = path.join(REPO, data.oracle.path);
  assert.equal(sha(fs.readFileSync(oracle)), data.oracle.sha256);
  assert.equal(data.controls.variants.map((item) => item.expected).join(','), 'red,green,red');
});
