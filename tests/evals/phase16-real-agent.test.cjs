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
const OBSERVER = require('./phase16-itsdangerous-observer.cjs');
const CAPABILITY_REVISION = JSON.parse(fs.readFileSync(CASE, 'utf8')).source.revision;

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

test('provider modes treat --freeze as its destination and reach their seam boundary', () => {
  for (const mode of ['--capability', '--run']) {
    const result = run([mode, '--case', CASE, '--cache', path.join(os.tmpdir(), `missing-${mode.slice(2)}-cache`), '--freeze', path.join(os.tmpdir(), `missing-${mode.slice(2)}-freeze.json`), '--receipts', path.join(os.tmpdir(), `missing-${mode.slice(2)}-receipts`), '--provider', 'codex']);
    assert.notEqual(result.status, 0, mode);
    const receipt = parse(result);
    assert.equal(receipt.provider_invoked, false);
    assert.notEqual(receipt.terminal.failure_code, 'usage');
    assert.equal(receipt.terminal.failure_code, 'case_file_invalid');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-case-pin-'));
  try {
    const changed = path.join(root, 'case.json'); fs.writeFileSync(changed, JSON.stringify({ ...data, task: { ...data.task, goal: 'mutated goal' } }));
    assert.throws(() => OBSERVER.readCase(changed), (error) => error.code === 'case_pin_mismatch');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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

function nativeCodexItems(thread, turn, cumulative, kinds) {
  const items = kinds.flatMap((kind, index) => {
    const item = { type: kind, id: `item-${turn}-${index}` };
    return [
      { type: 'item.started', thread_id: thread, turn_id: turn, item },
      { type: 'item.completed', thread_id: thread, turn_id: turn, item },
    ];
  });
  return [
    { type: 'thread.started', thread_id: thread },
    { type: 'turn.started', thread_id: thread, turn_id: turn },
    ...items,
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

function capabilityFixture(root, { mutate = false, itemKinds = ['agent_message'] } = {}) {
  const fixture = rootedRunFixture(root);
  const git = (args) => {
    const result = cp.spawnSync('git', args, { cwd: fixture.context.consumerRoot, encoding: 'utf8', windowsHide: true, shell: false });
    assert.equal(result.status, 0, result.stderr);
    return String(result.stdout || '').trim();
  };
  fs.writeFileSync(path.join(fixture.context.consumerRoot, 'package.json'), '{}\n');
  fs.mkdirSync(path.join(fixture.context.consumerRoot, 'inputs', 'owner'), { recursive: true });
  fs.writeFileSync(path.join(fixture.context.consumerRoot, 'inputs', 'owner', 'TASK.md'), '# Capability task\n');
  git(['init', '-q']); git(['config', 'user.email', 'capability@example.invalid']); git(['config', 'user.name', 'capability-test']); git(['add', '.']); git(['commit', '-qm', 'baseline']);
  git(['rev-parse', 'HEAD']);
  const revision = CAPABILITY_REVISION;
  fixture.context.data = { id: 'itsdangerous-fips-sha1', source: { revision } };
  fixture.spawn = () => {
    if (mutate) fs.writeFileSync(path.join(fixture.context.consumerRoot, 'unexpected.txt'), 'unexpected\n', { flag: 'wx' });
    fs.mkdirSync(path.join(fixture.context.consumerRoot, '.work'), { recursive: true });
    fs.writeFileSync(path.join(fixture.context.consumerRoot, LIVE.CAPABILITY_MARKER_PATH), LIVE.CAPABILITY_MARKER_BYTES, { flag: 'wx' });
    return { status: 0, pid: 4444, parent_pid: 4443, stdout: nativeCodexItems('native-capability', 'capability-native', 12, itemKinds), stderr: '', timed_out: false };
  };
  return fixture;
}

test('capability probe is one injected characterization turn with an exact marker and scoped delta', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-capability-'));
  const fixture = capabilityFixture(root);
  try {
    const receipt = LIVE.runCapability(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, gitText: (args) => args[0] === 'rev-parse' ? CAPABILITY_REVISION : '', characterizationOnly: true });
    assert.equal(receipt.contract, 'phase16-native-capability-v1');
    assert.equal(receipt.provider_invoked, true);
    assert.deepEqual(receipt.snapshots.changed_paths, [LIVE.CAPABILITY_MARKER_PATH]);
    assert.equal(receipt.marker.exact, true);
    assert.equal(receipt.git.head, fixture.context.data.source.revision);
    assert.deepEqual(receipt.turn.native.item_kinds, ['agent_message']);
    assert.deepEqual(receipt.turn.invocation.skills, []);
    assert.match(Buffer.from(receipt.turn.invocation.prompt_sha256, 'hex').toString('hex'), /^[0-9a-f]{64}$/);
    assert.deepEqual(fs.readFileSync(path.join(fixture.context.consumerRoot, LIVE.CAPABILITY_MARKER_PATH)), LIVE.CAPABILITY_MARKER_BYTES);
    assert.throws(() => LIVE.runCapability(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, gitText: (args) => args[0] === 'rev-parse' ? CAPABILITY_REVISION : '', characterizationOnly: true }), (error) => error.code === 'receipt_exists');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('capability probe permits ordinary command and file item kinds', () => {
  for (const itemKind of ['command_execution', 'file_change']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-capability-${itemKind}-`));
    const fixture = capabilityFixture(root, { itemKinds: [itemKind] });
    try {
      const receipt = LIVE.runCapability(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, gitText: (args) => args[0] === 'rev-parse' ? CAPABILITY_REVISION : '', characterizationOnly: true });
      assert.deepEqual(receipt.turn.native.item_kinds, [itemKind]);
      assert.equal(receipt.terminal.status, 'passed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('capability probe rejects collaboration and web-search item kinds with a sealed receipt', () => {
  for (const itemKind of ['collab_tool_call', 'web_search']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-capability-forbidden-${itemKind}-`));
    const fixture = capabilityFixture(root, { itemKinds: [itemKind] });
    try {
      assert.throws(() => LIVE.runCapability(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, gitText: (args) => args[0] === 'rev-parse' ? CAPABILITY_REVISION : '', characterizationOnly: true }), (error) => error.code === 'capability_forbidden_tool');
      const receipt = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'capability.json'), 'utf8'));
      assert.equal(receipt.terminal.status, 'failed');
      assert.equal(receipt.terminal.failure_code, 'capability_forbidden_tool');
      assert.deepEqual(receipt.turn.native.item_kinds, [itemKind]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('capability probe fails closed on any post-preflight path outside the fixed marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-capability-scope-'));
  const fixture = capabilityFixture(root, { mutate: true });
  try {
    assert.throws(() => LIVE.runCapability(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, gitText: (args) => args[0] === 'rev-parse' ? CAPABILITY_REVISION : '', characterizationOnly: true }), (error) => error.code === 'capability_scope_violation');
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'capability.json'), 'utf8'));
    assert.equal(receipt.terminal.failure_code, 'capability_scope_violation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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

test('observer exposes a fixed reduced projection for early terminal runs', () => {
  const projection = OBSERVER.earlyProjection({ caseId: 'itsdangerous-fips-sha1', revision: '93ae366874bbd4f69d90495c45b2cd336387496c', terminal: { status: 'failed', failure_code: 'spawn_failed' } });
  assert.deepEqual(projection.stages, {
    observation: 'not_produced_due_to_early_terminal',
    oracle: 'not_produced_due_to_early_terminal',
    grade: 'not_produced_due_to_early_terminal',
    regrade: 'not_produced_due_to_early_terminal',
  });
  assert.equal(projection.disposition, 'infrastructure_invalid');
  assert.equal(Object.hasOwn(projection, 'consumer_root'), false);
  assert.throws(() => OBSERVER.earlyProjection({ caseId: 'other-case' }), (error) => error.code === 'case_pin_mismatch');
  assert.throws(() => OBSERVER.earlyProjection({ revision: 'deadbeef' }), (error) => error.code === 'case_pin_mismatch');
});

test('observer grades actual staged, unstaged, and untracked out-of-scope Git paths red', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-git-scope-'));
  const git = (args) => { const result = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result; };
  try {
    fs.mkdirSync(path.join(root, 'src', 'itsdangerous'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'itsdangerous', 'signer.py'), 'baseline\n');
    git(['init', '-q']); git(['config', 'user.email', 'observer@example.invalid']); git(['config', 'user.name', 'observer-test']); git(['add', '.']); git(['commit', '-qm', 'baseline']);
    fs.appendFileSync(path.join(root, 'src', 'itsdangerous', 'signer.py'), 'allowed worktree change\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n'); git(['add', 'package.json']);
    fs.writeFileSync(path.join(root, 'private-leak.txt'), 'out of scope\n');
    const scope = OBSERVER.gitScope(root);
    const classified = OBSERVER.allowedPaths({ task: { allowed_paths: ['src/itsdangerous/signer.py'] } }, scope);
    assert.deepEqual(classified.product, ['src/itsdangerous/signer.py']);
    assert.ok(classified.forbidden.includes('package.json'));
    assert.ok(classified.forbidden.includes('private-leak.txt'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('characterization handoffs cannot reach the observer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-characterization-'));
  const fixture = rootedRunFixture(root);
  try {
    assert.throws(() => OBSERVER.completeHandoff({ caseFile: CASE, freezeFile: fixture.freezeFile, receiptDir: fixture.receiptDir, consumerRoot: fixture.consumerRoot }), (error) => ['freeze_invalid', 'freeze_binding_mismatch', 'handoff_invalid', 'handoff_missing'].includes(error.code));
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'observation.json')), false);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'grade.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function syntheticObservation(root, checks = {}) {
  const observationFile = path.join(root, 'observation.json');
  const merged = { import_with_sha1_unavailable: true, explicit_sha256_signer: true, default_sha1_rejected: true, upstream_tests_pass: true, ...checks };
  const observation = {
    record_type: 'phase16_itsdangerous_observation', contract: 'phase16-itsdangerous-observation-v1', case_id: 'itsdangerous-fips-sha1',
    freeze_sha256: 'd'.repeat(64), terminal_sha256: 'e'.repeat(64), handoff_sha256: 'f'.repeat(64),
    retained_root: '<RETAINED_ROOT>', case: { revision: '93ae366874bbd4f69d90495c45b2cd336387496c', sha256: 'e77f420a8036a80b1ff96f9c6a96ffb3f9e4d32e724d4a33604a24119bb97c3f', oracle_sha256: '21a66bfd5b2d00c0199a5b4fbba75af507c112ff4f8717f7f13e3ee498ca1a11' },
    git: { top_level: '<RETAINED_ROOT>', head: '93ae366874bbd4f69d90495c45b2cd336387496c', scope: { forbidden: [], product: ['src/itsdangerous/signer.py'] }, candidate_sha256: 'a'.repeat(64) },
    turns: OBSERVER.WORKFLOW_STEPS.map((id, index) => ({ id, thread_id: index < 2 ? 'native-A' : 'native-B', turn_id: `turn-${index}`, sha256: String(index + 1).repeat(64) })), sessions: { count: 2, turns: 5 },
    brownfield: { files: { 'CHANGE.md': {}, 'HANDOFF.md': {}, 'VERIFICATION.md': {} } }, checkpoint: { sha256: 'b'.repeat(64) },
    oracle: { sha256: '21a66bfd5b2d00c0199a5b4fbba75af507c112ff4f8717f7f13e3ee498ca1a11', semantic: { status: Object.values(merged).every(Boolean) ? 'pass' : 'fail', checks: merged } },
  };
  fs.writeFileSync(observationFile, JSON.stringify(observation));
  return observationFile;
}

function projectionChain(root, observationFile) {
  const grade = OBSERVER.grade({ observationFile });
  const regradeFile = path.join(root, 'projection-regrade.json');
  const regrade = OBSERVER.regrade({ observationFile, regradeFile });
  const compareFile = path.join(root, 'projection-regrade-compare.json');
  fs.writeFileSync(compareFile, JSON.stringify({ contract: 'phase16-itsdangerous-regrade-v1', normalized_equal: true, canonical_regrade_sha256: sha(fs.readFileSync(regradeFile)), regrade }));
  return { grade, regrade, regradeFile, compareFile };
}

test('semantic oracle failure is product red while malformed observer bytes are infrastructure invalid', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-grade-'));
  try {
    const red = OBSERVER.grade({ observationFile: syntheticObservation(root, { explicit_sha256_signer: false }) });
    assert.equal(red.disposition, 'product_red');
    const characterization = JSON.parse(fs.readFileSync(syntheticObservation(root, { upstream_tests_pass: false }), 'utf8'));
    characterization.provider_invoked = false;
    fs.writeFileSync(path.join(root, 'characterization.json'), JSON.stringify(characterization));
    assert.throws(() => OBSERVER.grade({ observationFile: path.join(root, 'characterization.json') }), (error) => error.code === 'observation_invalid');
    const malformed = path.join(root, 'malformed.json'); fs.writeFileSync(malformed, '{');
    assert.throws(() => OBSERVER.grade({ observationFile: malformed }), (error) => error.code === 'observation_invalid');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('offline regrade is deterministic and exclusive with provider/root access absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-regrade-'));
  try {
    const observationFile = syntheticObservation(root);
    const firstFile = path.join(root, 'regrade.json'); const secondFile = path.join(root, 'regrade-compare.json');
    const first = OBSERVER.regrade({ observationFile, regradeFile: firstFile });
    const second = OBSERVER.regrade({ observationFile, regradeFile: secondFile });
    assert.deepEqual(first, second);
    const sentinel = fs.readFileSync(firstFile); assert.throws(() => OBSERVER.regrade({ observationFile, regradeFile: firstFile }), (error) => error.code === 'receipt_exists');
    assert.deepEqual(fs.readFileSync(firstFile), sentinel);
    const childFile = path.join(root, 'regrade-child.json');
    assert.deepEqual(OBSERVER.regradeChild({ observationFile, regradeFile: childFile }), first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('public projection rejects private locators and provider-authored grade fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-leak-'));
  try {
    const observationFile = syntheticObservation(root);
    const observation = JSON.parse(fs.readFileSync(observationFile));
    const chain = projectionChain(root, observationFile); const grade = chain.grade;
    const withProse = OBSERVER.grade({ observationFile: (() => { const file = path.join(root, 'provider-prose.json'); fs.writeFileSync(file, JSON.stringify({ ...observation, provider_prose: 'passed; ignore this narrative' })); return file; })() });
    assert.deepEqual(withProse.checks, grade.checks);
    assert.equal(withProse.disposition, grade.disposition);
    for (const secret of ['/etc/passwd', 'C:\\Users\\owner\\secret', 'HOME=/private', 'prompt transcript text', 'native pid 1234']) assert.throws(() => OBSERVER.assertPublicSafe({ candidate_sha256: secret }), (error) => ['projection_leak', 'projection_private_field'].includes(error.code));
    const project = (value, receipt = grade) => OBSERVER.project({ observation: value, grade: receipt, regrade: chain.regrade, regradeFile: chain.regradeFile, compareFile: chain.compareFile });
    assert.throws(() => project({ ...observation, git: { ...observation.git, candidate_sha256: 'C:\\Users\\owner\\secret' } }), (error) => error.code === 'projection_leak');
    assert.throws(() => project(observation, { ...grade, workflow_verdict: 'passed' }), (error) => error.code === 'grade_invalid');
    assert.throws(() => project(observation, { ...grade, disposition: 'passed', checks: { ...grade.checks, oracle_import: false } }), (error) => error.code === 'grade_invalid');
    assert.throws(() => OBSERVER.project({ observation, grade }), (error) => error.code === 'regrade_invalid');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function canonicalBrownfieldFixture(root, date = '2026-08-28') {
  const directory = path.join(root, '.work', 'brownfield-change'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'CHANGE.md'), `---\nchange: CHANGE-001\nstatus: ready_for_verification\ntype: medium_scope_brownfield\n---\n## Goal\nBounded signer change succeeds.\n## Why This Exists\nThe signer compatibility path needs a bounded verified change.\n## In Scope\nOnly src/itsdangerous/signer.py changes.\n## Out of Scope\nNo dependency changes.\n## Structural Promotion Triggers\nWiden only if the bounded stream no longer fits one goal.\n## Done When\nThe bounded signer change is verified.\n## Current Status\nCurrent posture is ready_for_verification.\n## Next Action\nRun verification.\n## PR Slice Ownership\nOne slice owns the signer path and its evidence.\n`);
  fs.writeFileSync(path.join(directory, 'HANDOFF.md'), `---\nchange: CHANGE-001\nupdated: ${date}\n---\nCHANGE.md is the only operational authority.\n## Active Constraints\nKeep the bounded signer change safe.\n## Unresolved Uncertainty\nNo unresolved uncertainty remains.\n## Decision Posture\nThe pinned route is selected.\n## Anti-Regression\nNo dependency changes are allowed.\n## Next Action\nRun the verification route named by CHANGE.md.\n`);
  fs.writeFileSync(path.join(directory, 'VERIFICATION.md'), `---\nchange: CHANGE-001\nverified: ${date}\nstatus: passed\ndelivery_posture: repo_only\nrequired_evidence:\n  - code\n---\n## Goal Verification\nThe bounded signer change is verified.\n## Evidence\n- code and test evidence are present.\n## Artifact Checks\nThe canonical artifacts exist and are substantive.\n## Gaps\nNo gaps remain.\n## Widening Reuse\nNo widening is required for this bounded change.\n## Human Verification\nNo manual verification remains.\n## Closeout Decision\npassed for this bounded change.\n`);
}

test('canonical brownfield grammar accepts real dates and rejects drifted IDs/dates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-brownfield-'));
  try {
    const data = { task: { goal: 'Bounded signer change succeeds.', allowed_paths: ['src/itsdangerous/signer.py'] } };
    canonicalBrownfieldFixture(root);
    assert.equal(OBSERVER.brownfield(root, data).verification_status, 'passed');
    const handoff = path.join(root, '.work', 'brownfield-change', 'HANDOFF.md');
    fs.writeFileSync(handoff, fs.readFileSync(handoff, 'utf8').replace('updated: 2026-08-28', 'updated: 2026-02-30'));
    assert.throws(() => OBSERVER.brownfield(root, data), (error) => error.code === 'brownfield_grammar_invalid');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('oracle receives the verified Python identity with a sanitized environment', () => {
  const calls = [];
  const pythonWitness = { path: process.execPath, identity: process.execPath, sha256: sha(fs.readFileSync(process.execPath)) };
  const data = JSON.parse(fs.readFileSync(CASE, 'utf8'));
  const result = OBSERVER.runOracle({ data, caseFile: CASE, consumerRoot: REPO, pythonWitness, spawn: (...args) => { calls.push(args); return { status: 0, stdout: JSON.stringify({ status: 'pass', checks: { ok: true } }), stderr: '' }; } });
  assert.equal(result.semantic.status, 'pass');
  assert.equal(calls[0][0], process.execPath);
  assert.equal(calls[0][2].env.CODEX_HOME, undefined);
  assert.equal(calls[0][2].env.HOME, undefined);
  assert.equal(calls[0][2].env.PYTHONNOUSERSITE, '1');
});

test('observer failure uses the canonical terminal and a non-green reduced projection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-failure-'));
  try {
    const projection = OBSERVER.observerFailureProjection();
    assert.equal(projection.disposition, 'infrastructure_invalid');
    assert.equal(projection.stages.observation, 'failed');
    assert.equal(projection.stages.grade, 'not_produced_due_to_observer_failure');
    assert.equal(OBSERVER.writeObserverFailure, undefined);
    assert.equal(fs.existsSync(path.join(root, 'observer-terminal.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
