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
    ['--run', '--case', CASE, '--cache', path.join(os.tmpdir(), 'phase16-cache'), '--freeze', path.join(os.tmpdir(), 'freeze.json'), '--receipts', path.join(os.tmpdir(), 'receipts')],
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

function nativeCodex(thread, turn, cumulative, verdict = null) {
  const item = { type: 'agent_message', id: `item-${turn}`, text: verdict ? JSON.stringify({ workflow_verdict: verdict }) : 'bounded response' };
  return [
    { type: 'thread.started', thread_id: thread },
    { type: 'turn.started', thread_id: thread, turn_id: turn },
    { type: 'item.started', thread_id: thread, turn_id: turn, item },
    { type: 'item.completed', thread_id: thread, turn_id: turn, item },
    { type: 'turn.completed', thread_id: thread, turn_id: turn, usage: { input_tokens: cumulative - 4, output_tokens: 4 } },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function rootedRunFixture(root, { mutation = null, verdict = null } = {}) {
  const consumerRoot = path.join(root, 'consumer_root');
  const receiptDir = path.join(root, 'receipts');
  fs.mkdirSync(path.join(consumerRoot, '.agents', 'skills'), { recursive: true });
  fs.mkdirSync(receiptDir, { recursive: true });
  for (const skill of [...new Set(LIVE.TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))]) {
    const directory = path.join(consumerRoot, '.agents', 'skills', skill);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), `# ${skill}\n`, { flag: 'wx' });
  }
  const freeze = {
    contract: 'phase16-rooted-codex-freeze-v1', case_id: 'itsdangerous-fips-sha1', workflow_verdict: 'not_evaluated', provider_sandbox: 'not_claimed',
    auth: { copied_to_consumer_root: false },
    bundle: { sha256: 'bundle' }, controls: { sha256: 'controls' }, candidate: { sha256: 'candidate', member_sha256: 'candidate-members', members: [], package: { name: 'workspine', version: '0.0.0' } },
    case: { sha256: 'case', input_bundle: { sha256: 'inputs' } }, source: { main: 'head', origin_main: 'head', files: {} },
    toolchain: { node: { sha256: 'node' }, npm: { sha256: 'npm' }, git: { sha256: 'git' } },
    runtime: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high', cli_contract: { version: 'codex-cli 0.149.1', resume_help_sha256: 'a'.repeat(64) }, executable: { source_sha256: 'provider', target_sha256: 'provider-target' }, python: { sha256: 'python' } },
    budgets: { turns: LIVE.TURN_PLAN.map((turn) => ({ id: turn.id, role: turn.role, skill: turn.skill, skills: turn.skills, wall_minutes: turn.minutes, native_tokens: turn.tokens, session: turn.session, initial: turn.initial })) },
    skills: Object.fromEntries([...new Set(LIVE.TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))].map((skill) => [skill, sha(fs.readFileSync(path.join(consumerRoot, '.agents', 'skills', skill, 'SKILL.md')))])),
    root_map: { consumer_root: '<RUN_ROOT>/consumer_root' }, sessions: { count: 2, turns: 5 },
  };
  freeze.budgets.total_wall_minutes = 54; freeze.budgets.total_native_tokens = 260000; freeze.budgets.retained_output_bytes = 1024 * 1024;
  const freezeFile = path.join(root, 'freeze.json'); fs.writeFileSync(freezeFile, JSON.stringify(freeze));
  let calls = 0;
  const context = { freeze, consumerRoot, runRoot: root, receiptDir, provider: { command: 'codex', prefix: [] }, env: {}, cumulative: {}, sessions: {}, data: {}, sourceBefore: {} };
  const prepareRun = () => context;
  const spawn = (_command, _argv, spawnOptions) => {
    const turn = LIVE.TURN_PLAN[calls]; const session = turn.session === 'A' ? 'native-A' : 'native-B'; calls += 1;
    const sessionTurn = turn.session === 'A' ? (turn.id === 'turn-a-plan' ? 1 : 2) : (turn.id === 'turn-b-resume-execute' ? 1 : turn.id === 'turn-b-verify' ? 2 : 3);
    if (turn.id === 'turn-a-pause') {
      fs.mkdirSync(path.join(consumerRoot, '.work'), { recursive: true });
      fs.writeFileSync(path.join(consumerRoot, '.work', '.continue-here.md'), 'Current task: bounded brownfield route\nEvidence: native pause receipt\nNext action: fresh resume\n', { flag: 'wx' });
    }
    if (mutation === turn.id) fs.writeFileSync(path.join(consumerRoot, 'product.txt'), 'unexpected\n', { flag: 'wx' });
    return { status: 0, pid: 1000 + calls, stdout: nativeCodex(session, `${turn.id}-native`, sessionTurn * 10, mutation === 'provider-verdict' ? 'passed' : verdict), stderr: '', timed_out: false };
  };
  return { freezeFile, receiptDir, context, prepareRun, spawn, get calls() { return calls; } };
}

test('Task 16-08-02S keeps exact initial/resume grammar and cumulative usage deltas', () => {
  const context = { cwd: '<CONSUMER_ROOT>', model: 'gpt-5.6-luna', effort: 'high' };
  const initial = LIVE.codexTurnArgv(context);
  const resumed = LIVE.codexTurnArgv({ ...context, sessionId: 'native-A' });
  assert.equal(initial[0], 'exec');
  assert.equal(initial.includes('--ignore-user-config'), true);
  assert.deepEqual(initial.slice(initial.indexOf('-C'), initial.indexOf('-C') + 2), ['-C', '<CONSUMER_ROOT>']);
  assert.equal(initial.at(-1), '-');
  assert.deepEqual(resumed.slice(0, 3), ['exec', 'resume', 'native-A']);
  assert.equal(resumed.includes('-C'), false);
  assert.equal(resumed.includes('--sandbox'), false);
  assert.equal(resumed.includes('--ephemeral'), false);
  assert.throws(() => LIVE.readFreeze(path.join(os.tmpdir(), 'missing-16-08-freeze.json')), (error) => error.code === 'case_file_invalid');
});

test('provider-free coordinator runs production-shaped five-turn handoff with two sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-five-turn-'));
  const fixture = rootedRunFixture(root);
  try {
    const result = LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true });
    assert.equal(fixture.calls, 5);
    assert.deepEqual(result.turns.map((item) => item.turn.id), LIVE.TURN_PLAN.map((item) => item.id));
    assert.equal(result.turns[1].turn.checkpoint.path, '<CONSUMER_ROOT>/.work/.continue-here.md');
    assert.deepEqual(result.turns.map((item) => item.usage.delta_tokens), [10, 10, 10, 10, 10]);
    assert.deepEqual(result.handoff.sessions, { A: 'native-A', B: 'native-B' });
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'handoff.json')), true);
    for (const turn of LIVE.TURN_PLAN) assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, `${turn.id}.json`))).workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('injected coordinator seams are rejected unless explicitly characterization-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-injection-'));
  const fixture = rootedRunFixture(root);
  try { assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn }), (error) => error.code === 'characterization_only_required'); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pause scope refusal seals a terminal and never hands off', () => {
  for (const mutation of ['turn-a-pause']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-refusal-${mutation}-`));
    const fixture = rootedRunFixture(root, { mutation });
    try {
      assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => ['pause_product_mutation', 'provider_authored_verdict'].includes(error.code));
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'terminal.json')), true);
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'handoff.json')), false);
      const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json')));
      assert.equal(terminal.workflow_verdict, 'not_evaluated');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('missing checkpoint, wrong resume identity, native order, and usage regression fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-native-refusal-'));
  const fixture = rootedRunFixture(root);
  try {
    const noCheckpoint = rootedRunFixture(root + '-checkpoint');
    noCheckpoint.spawn = (_command, _argv, options) => ({ status: 0, pid: 1, stdout: nativeCodex('native-A', 'x', 10), stderr: '', timed_out: false });
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), noCheckpoint.freezeFile, noCheckpoint.receiptDir, { prepareRun: noCheckpoint.prepareRun, spawn: noCheckpoint.spawn, characterizationOnly: true }), (error) => String(error.code).startsWith('checkpoint_'));
    assert.throws(() => LIVE.runTurn(fixture.context, LIVE.TURN_PLAN[0], null, { spawn: () => ({ status: 0, pid: 1, stdout: '{}\n', stderr: '', timed_out: false }) }), (error) => error.code === 'native_sequence_invalid');
    fixture.context.cumulative.A = 20;
    assert.throws(() => LIVE.runTurn(fixture.context, LIVE.TURN_PLAN[0], null, { spawn: () => ({ status: 0, pid: 1, stdout: nativeCodex('native-A', 'x', 10), stderr: '', timed_out: false }) }), (error) => error.code === 'usage_regression');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(root + '-checkpoint', { recursive: true, force: true }); }
});

test('real Python resolver rejects WindowsApps aliases and requires executable identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-python-'));
  const alias = path.join(root, 'WindowsApps', 'python.exe'); fs.mkdirSync(path.dirname(alias), { recursive: true }); fs.writeFileSync(alias, 'alias');
  try { assert.throws(() => LIVE.resolvePython({ entries: [alias] }), (error) => error.code === 'python_resolution_failure'); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real cached provider-free preparation (PHASE16_REAL_CACHE)', () => {
  const cache = process.env.PHASE16_REAL_CACHE;
  if (!cache) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-real-cache-'));
  const freeze = path.join(root, 'freeze.json');
  try {
    const frozen = run(['--freeze', freeze, '--case', CASE, '--cache', cache, '--controls', process.env.PHASE16_REAL_CONTROLS || path.join(REPO, '.work', 'phases', '16-safe-cohesive-first-run', '16-08-receipts', 'controls.json')]);
    assert.equal(frozen.status, 0, frozen.stderr || frozen.stdout);
    const receipt = parse(frozen);
    assert.equal(receipt.provider_invoked, false);
    assert.equal(Object.keys(receipt.preparation.skills || {}).length, 6);
    const checked = LIVE.checkPublicCase(CASE, cache, { offline: true, controls: process.env.PHASE16_REAL_CONTROLS });
    assert.equal(checked.git.clean, true);
    assert.equal(checked.terminal.status, 'passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
