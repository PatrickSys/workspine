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

const EVALUATOR_FILES = [
  'tests/evals/phase16-real-agent.cjs',
  'tests/evals/phase16-codex-recorder.cjs',
  'tests/evals/phase16-core-flows.cjs',
  'tests/evals/phase16-itsdangerous-observer.cjs',
];

function currentEvaluatorLedger() {
  return Object.fromEntries(EVALUATOR_FILES.map((relative) => {
    const file = path.join(REPO, ...relative.split('/'));
    const bytes = fs.readFileSync(file);
    return [relative, { bytes: bytes.length, sha256: sha(bytes) }];
  }));
}

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

function nativeCodex(thread, turn, turnTokens, verdict = null) {
  const item = { type: 'agent_message', id: `item-${turn}`, text: verdict ? JSON.stringify({ workflow_verdict: verdict }) : 'bounded response' };
  return [
    { type: 'thread.started', thread_id: thread },
    { type: 'turn.started', thread_id: thread, turn_id: turn },
    { type: 'item.started', thread_id: thread, turn_id: turn, item },
    { type: 'item.completed', thread_id: thread, turn_id: turn, item },
    { type: 'turn.completed', thread_id: thread, turn_id: turn, usage: { input_tokens: turnTokens - 4, output_tokens: 4 } },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function nativeCodexItems(thread, turn, turnTokens, kinds) {
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
    { type: 'turn.completed', thread_id: thread, turn_id: turn, usage: { input_tokens: turnTokens - 4, output_tokens: 4 } },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function rootedRunFixture(root, { mutation = null, planMutation = null, planFailure = null, verdict = null, usageByTurn = null, initialTotalUsage = 0 } = {}) {
  const consumerRoot = path.join(root, 'consumer_root');
  const receiptDir = path.join(root, 'receipts');
  fs.mkdirSync(path.join(consumerRoot, '.agents', 'skills'), { recursive: true });
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.mkdirSync(path.join(consumerRoot, '.work', 'brownfield-change'), { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, '.work', 'brownfield-change', 'CHANGE.md'), '# bounded brownfield plan\n', { flag: 'wx' });
  for (const skill of [...new Set(LIVE.TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))]) {
    const directory = path.join(consumerRoot, '.agents', 'skills', skill);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), `# ${skill}\n`, { flag: 'wx' });
  }
  if (['checkpoint-consume', 'checkpoint-mutate'].includes(planMutation)) {
    fs.mkdirSync(path.join(consumerRoot, '.work'), { recursive: true });
    fs.writeFileSync(path.join(consumerRoot, '.work', '.continue-here.md'), 'Current task: pre-existing checkpoint\nEvidence: baseline\nNext action: plan\n', { flag: 'wx' });
  }
  const freeze = {
    contract: 'phase16-rooted-codex-freeze-v1', case_id: 'itsdangerous-fips-sha1', workflow_verdict: 'not_evaluated', provider_sandbox: 'not_claimed',
    auth: { copied_to_consumer_root: false },
    bundle: { sha256: 'bundle' }, controls: { sha256: 'controls' }, candidate: { sha256: 'candidate', member_sha256: 'candidate-members', members: [], package: { name: 'workspine', version: '0.0.0' } },
    case: { sha256: 'case', input_bundle: { sha256: 'inputs' } }, source: { main: 'head', origin_main: 'head', files: {} },
    toolchain: { node: { sha256: 'node' }, npm: { sha256: 'npm' }, git: { sha256: 'git' } },
    runtime: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high', cli_contract: { version: 'codex-cli 0.149.1', resume_help_sha256: 'a'.repeat(64) }, executable: { source_sha256: 'provider', target_sha256: 'provider-target' }, python: { sha256: 'python' } },
    budgets: { turns: LIVE.TURN_PLAN.map((turn) => ({ id: turn.id, role: turn.role, skill: turn.skill, skills: turn.skills, wall_minutes: turn.minutes, native_tokens: turn.tokens, session: turn.session, initial: turn.initial })) },
    evaluator: { contract: 'phase16-evaluator-ledger-v1', files: currentEvaluatorLedger() },
    skills: Object.fromEntries([...new Set(LIVE.TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))].map((skill) => [skill, sha(fs.readFileSync(path.join(consumerRoot, '.agents', 'skills', skill, 'SKILL.md')))])),
    root_map: { consumer_root: '<RUN_ROOT>/consumer_root' }, sessions: { count: 3, turns: 5 },
  };
  freeze.budgets.total_wall_minutes = LIVE.TURN_TOTAL_MINUTES; freeze.budgets.total_native_tokens = LIVE.TURN_TOTAL_TOKENS; freeze.budgets.retained_output_bytes = LIVE.RETAINED_OUTPUT_BYTES;
  const freezeFile = path.join(root, 'freeze.json'); fs.writeFileSync(freezeFile, JSON.stringify(freeze));
  let calls = 0;
  const sessionTurns = { A: 0, B: 0, C: 0 };
  const context = { freeze, consumerRoot, runRoot: root, receiptDir, provider: { command: 'codex', prefix: [] }, env: {}, totalUsage: initialTotalUsage, sessions: {}, data: {}, sourceBefore: {}, providerInvocations: 0 };
  context.approvePlan = (_context, request) => {
    const state = { schema_version: 1, status: 'active', current_state: 'execute', workflow: { plan: { approved: true, path: request.plan, identity: request.plan }, execution: { status: 'in_progress' }, verification: { status: 'not_started' }, audit: { status: 'not_started' }, dogfood: { status: 'not_started' }, authority: request.authority, current_state: 'execute', approval_ref: request.approvalRef } };
    fs.mkdirSync(path.join(consumerRoot, '.work'), { recursive: true });
    fs.writeFileSync(path.join(consumerRoot, '.work', 'state.json'), `${JSON.stringify(state)}\n`, { flag: 'wx' });
    return { status: 0, stdout: JSON.stringify({ schema_version: 1, operation: 'lifecycle-transition', target: 'approve', status: 'ok', changed: true, state }), stderr: '' };
  };
  const prepareRun = () => context;
  const spawn = (_command, _argv, spawnOptions) => {
    const turn = LIVE.TURN_PLAN[calls]; const session = `native-${turn.session}`; calls += 1;
    const sessionTurn = ++sessionTurns[turn.session];
    if (turn.id === 'turn-a-pause') {
      fs.mkdirSync(path.join(consumerRoot, '.work'), { recursive: true });
      fs.writeFileSync(path.join(consumerRoot, '.work', '.continue-here.md'), 'Current task: bounded brownfield route\nEvidence: native pause receipt\nNext action: fresh resume\n', { flag: 'wx' });
    }
    if (turn.id === 'turn-a-plan' && planMutation) {
      fs.mkdirSync(path.join(consumerRoot, '.work'), { recursive: true });
      if (planMutation === 'checkpoint-create') fs.writeFileSync(path.join(consumerRoot, '.work', '.continue-here.md'), 'Current task: plan was incorrectly paused\nEvidence: invalid plan checkpoint\nNext action: execute\n', { flag: 'wx' });
      if (planMutation === 'checkpoint-mutate') fs.writeFileSync(path.join(consumerRoot, '.work', '.continue-here.md'), 'Current task: plan modified the checkpoint\nEvidence: invalid plan checkpoint\nNext action: execute\n');
      if (planMutation === 'checkpoint-consume') fs.rmSync(path.join(consumerRoot, '.work', '.continue-here.md'));
      if (planMutation === 'plan-artifact-missing-before-approval') fs.rmSync(path.join(consumerRoot, '.work', 'brownfield-change', 'CHANGE.md'));
      if (planMutation === 'plan-artifact-symlink-before-approval') {
        const planArtifact = path.join(consumerRoot, '.work', 'brownfield-change', 'CHANGE.md');
        const replacement = path.join(root, 'pre-approval-replacement.md');
        fs.writeFileSync(replacement, '# replacement plan artifact\n', { flag: 'wx' });
        fs.rmSync(planArtifact);
        fs.symlinkSync(replacement, planArtifact, 'file');
      }
      if (planMutation === 'state-execute') fs.writeFileSync(path.join(consumerRoot, '.work', 'state.json'), JSON.stringify({ current_state: 'execute', workflow: { plan: { approved: false } } }) + '\n', { flag: 'wx' });
      if (planMutation === 'state-workflow-execute') fs.writeFileSync(path.join(consumerRoot, '.work', 'state.json'), JSON.stringify({ current_state: 'plan', workflow: { current_state: 'execute', plan: { approved: false } } }) + '\n', { flag: 'wx' });
      if (planMutation === 'state-approval') fs.writeFileSync(path.join(consumerRoot, '.work', 'state.json'), JSON.stringify({ current_state: 'plan', workflow: { plan: { approved: true } } }) + '\n', { flag: 'wx' });
      if (planMutation === 'state-approval-ref') fs.writeFileSync(path.join(consumerRoot, '.work', 'state.json'), JSON.stringify({ current_state: 'plan', workflow: { approval_ref: 'owner-self-asserted', plan: { approved: false } } }) + '\n', { flag: 'wx' });
    }
    if (mutation === turn.id) fs.writeFileSync(path.join(consumerRoot, 'product.txt'), 'unexpected\n', { flag: 'wx' });
    const usage = typeof usageByTurn === 'function' ? usageByTurn(turn, calls) : sessionTurn * 10;
    return { status: 0, pid: 1000 + calls, stdout: nativeCodex(session, `${turn.id}-native`, usage, mutation === 'provider-verdict' ? 'passed' : verdict), stderr: '', timed_out: planFailure === 'timeout' && turn.id === 'turn-a-plan' };
  };
  return { freezeFile, receiptDir, context, prepareRun, spawn, get calls() { return calls; } };
}

function observerFreezeFixture(root) {
  const fixture = rootedRunFixture(root);
  const data = JSON.parse(fs.readFileSync(CASE, 'utf8'));
  const freeze = JSON.parse(fs.readFileSync(fixture.freezeFile, 'utf8'));
  freeze.schema_version = 1;
  freeze.case = { sha256: sha(fs.readFileSync(CASE)), oracle: data.oracle, input_bundle: { contract: data.input_bundle.contract, sha256: 'a'.repeat(64) } };
  freeze.source = { repository: data.source.repository, revision: data.source.revision, main: data.source.revision, origin_main: data.source.revision, files: {} };
  freeze.bundle = { sha256: 'b'.repeat(64), manifest_sha256: 'c'.repeat(64) };
  freeze.controls = { sha256: 'd'.repeat(64) };
  freeze.candidate = { sha256: 'e'.repeat(64), member_sha256: OBSERVER.stableHash([]), members: [], package: { name: 'workspine', version: '0.0.0' } };
  freeze.runtime = { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high', cli_contract: { version: 'codex-cli 0.149.1', resume_help_sha256: 'f'.repeat(64) }, executable: { source_sha256: '1'.repeat(64), target_sha256: '2'.repeat(64) }, python: { path: '<PYTHON>', identity: '<PYTHON>', sha256: '3'.repeat(64) }, auth_posture: 'authenticated-native-CODEX_HOME; ignore-user-config; credentials-not-copied' };
  freeze.toolchain = { node: { sha256: '4'.repeat(64) }, npm: { sha256: '5'.repeat(64) }, git: { sha256: '6'.repeat(64) } };
  freeze.root_map = { run_root: '<RUN_ROOT>', consumer_root: '<RUN_ROOT>/consumer_root', tool_root: '<RUN_ROOT>/tool_root', receipts: '<RECEIPTS>' };
  freeze.sessions = { count: 3, turns: 5 };
  freeze.auth = { copied_to_consumer_root: false };
  freeze.budgets.total_wall_minutes = 72;
  freeze.budgets.total_native_tokens = 8500000;
  freeze.budgets.retained_output_bytes = 1048576;
  return { ...fixture, freeze };
}

function observerHandoffFixture(root, mutateArgv = null) {
  const fixture = observerFreezeFixture(root);
  fs.writeFileSync(fixture.freezeFile, JSON.stringify(fixture.freeze));
  const preparation = {
    record_type: 'phase16_preparation_receipt', case_id: 'itsdangerous-fips-sha1',
    bundle_sha256: fixture.freeze.bundle.sha256, controls_sha256: fixture.freeze.controls.sha256,
    candidate_sha256: fixture.freeze.candidate.sha256, python: { sha256: fixture.freeze.runtime.python.sha256 },
    characterization_only: false, workflow_verdict: 'not_evaluated',
  };
  fs.writeFileSync(path.join(fixture.receiptDir, 'preparation.json'), JSON.stringify(preparation));
  const sessions = { A: 'native-A', B: 'native-B', C: 'native-C' };
  const argv = (turn) => turn.initial
    ? ['exec', '--approve-for-me', '-C', '<REDACTED_PATH>', '--ignore-user-config', '--json', '--color', 'never', '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="high"', '-']
    : ['exec', '--approve-for-me', 'resume', sessions[turn.session], '--ignore-user-config', '--json', '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="high"', '-'];
  const turns = LIVE.TURN_PLAN.map((turn, index) => {
    const receiptArgv = argv(turn);
    if (mutateArgv) mutateArgv(receiptArgv, turn, index, sessions);
    const receipt = {
      record_type: 'phase16_codex_turn_receipt', characterization_only: false, workflow_verdict: 'not_evaluated',
      terminal: { status: 'provider_complete' }, native: { thread_id: sessions[turn.session], turn_id: `native-turn-${index}` },
      turn: { id: turn.id, role: turn.role, skill: turn.skill, skills: turn.skills, session: turn.session, initial: turn.initial, ...(turn.id === 'turn-a-pause' ? { checkpoint: { path: '<CONSUMER_ROOT>/.work/.continue-here.md' } } : {}) },
      invocation: { argv: receiptArgv },
    };
    const file = path.join(fixture.receiptDir, `${turn.id}.json`);
    fs.writeFileSync(file, JSON.stringify(receipt));
    return { id: turn.id, sha256: sha(fs.readFileSync(file)) };
  });
  const terminal = { record_type: 'phase16_terminal_receipt', terminal: { status: 'provider_complete' }, turn_count: 5, workflow_verdict: 'not_evaluated', provider_invoked: true };
  const terminalSha = sha(Buffer.from(`${JSON.stringify(terminal, null, 2)}\n`));
  const handoff = { record_type: 'phase16_codex_handoff', case_id: 'itsdangerous-fips-sha1', workflow_verdict: 'not_evaluated', characterization_only: false, retained_root: '<CONSUMER_ROOT>', sessions, turns, terminal_sha256: terminalSha };
  return { ...fixture, terminal, handoff };
}

test('Task 16-08-02S keeps exact initial/resume grammar and per-turn usage', () => {
  const context = { cwd: '<CONSUMER_ROOT>', model: 'gpt-5.6-luna', effort: 'high' };
  const initial = LIVE.codexTurnArgv(context);
  const resumed = LIVE.codexTurnArgv({ ...context, sessionId: 'native-A' });
  assert.deepEqual(initial, [
    'exec', '--approve-for-me', '-C', '<CONSUMER_ROOT>',
    '--ignore-user-config', '--json', '--color', 'never',
    '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="high"', '-',
  ]);
  assert.equal(initial.at(-1), '-');
  assert.deepEqual(resumed, [
    'exec', '--approve-for-me', 'resume', 'native-A',
    '--ignore-user-config', '--json',
    '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="high"', '-',
  ]);
  assert.equal(initial[1], '--approve-for-me');
  assert.equal(resumed[1], '--approve-for-me');
  assert.equal(resumed.includes('-C'), false);
  assert.equal(initial.includes('--sandbox'), false);
  assert.equal(resumed.includes('--sandbox'), false);
  assert.equal(initial.includes('workspace-write'), false);
  assert.equal(resumed.includes('workspace-write'), false);
  assert.equal(initial.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(resumed.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(initial.includes('--ephemeral'), false);
  assert.equal(resumed.includes('--ephemeral'), false);
  assert.throws(() => LIVE.readFreeze(path.join(os.tmpdir(), 'missing-16-08-freeze.json')), (error) => error.code === 'case_file_invalid');
});

test('native token calibration applies the fixed 25x multiplier without changing wall/output caps', () => {
  assert.equal(LIVE.NATIVE_TOKEN_MULTIPLIER, 25);
  assert.equal(LIVE.CAPABILITY_MAX_TOKENS, 500000);
  assert.equal(LIVE.PLAN_TOKEN_CEILING, 3000000);
  assert.equal(LIVE.PAUSE_TOKEN_CEILING, 1000000);
  assert.deepEqual(LIVE.TURN_PLAN.map((turn) => turn.tokens), [3000000, 1000000, 2500000, 1500000, 500000]);
  assert.equal(LIVE.TURN_TOTAL_TOKENS, 8500000);
  assert.equal(LIVE.TURN_TOTAL_TOKENS, LIVE.TURN_PLAN.reduce((sum, turn) => sum + turn.tokens, 0));
  assert.equal(OBSERVER.PAUSE_TOKEN_CEILING, 1000000);
  assert.deepEqual(OBSERVER.TURN_CONTRACT.map((turn) => turn[5]), [3000000, 1000000, 2500000, 1500000, 500000]);
  assert.equal(OBSERVER.PLAN_TOKEN_CEILING, 3000000);
  assert.equal(OBSERVER.TURN_TOTAL_NATIVE_TOKENS, 8500000);
  assert.equal(OBSERVER.TURN_TOTAL_WALL_MINUTES, 72);
  assert.deepEqual(LIVE.TURN_PLAN.map((turn) => turn.minutes), [30, 5, 20, 12, 5]);
  assert.equal(LIVE.TURN_TOTAL_MINUTES, 72);
  assert.equal(LIVE.RETAINED_OUTPUT_BYTES, 1024 * 1024);
});

test('pause measurement admits both retained observations and rejects overage before B/C', () => {
  for (const observedPauseUsage of [646668, 892765]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-pause-calibration-${observedPauseUsage}-`));
    const fixture = rootedRunFixture(root, { usageByTurn: (turn) => turn.id === 'turn-a-pause' ? observedPauseUsage : 10 });
    try {
      const result = LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true });
      assert.equal(result.turns[1].usage.turn_tokens, observedPauseUsage);
      assert.equal(fixture.calls, 5);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-pause-calibration-overage-'));
  const fixture = rootedRunFixture(root, { usageByTurn: (turn) => turn.id === 'turn-a-pause' ? 1000001 : 10 });
  try {
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'usage_excess');
    assert.equal(fixture.calls, 2);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-pause.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-b-resume-execute.json')), false);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-c-verify.json')), false);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-c-progress.json')), false);
    const pause = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'turn-a-pause.json'), 'utf8'));
    assert.equal(pause.usage.turn_tokens, 1000001);
    assert.equal(pause.terminal.failure_code, 'usage_excess');
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json'), 'utf8'));
    assert.equal(terminal.terminal.failure_code, 'usage_excess');
    assert.equal(terminal.terminal.sealed_turn.turn, 'turn-a-pause');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('plan turn has a bounded composite envelope after the grounded 15-minute boundary', () => {
  // The prior run was still running its required independent checker when the
  // 15-minute wall expired. Preserve a bounded composite envelope without
  // changing any token ceiling or product measurement.
  assert.equal(LIVE.TURN_PLAN[0].minutes, 30);
  assert.equal(LIVE.TURN_TOTAL_MINUTES, 72);
  assert.equal(OBSERVER.TURN_CONTRACT[0][4], 30);
  assert.equal(OBSERVER.TURN_TOTAL_WALL_MINUTES, 72);
});

test('fresh freezes bind evaluator bytes and reject missing or mutated ledger entries before provider', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-evaluator-freeze-'));
  const fixture = rootedRunFixture(root);
  const observer = observerFreezeFixture(`${root}-observer`);
  try {
    const accepted = LIVE.readFreeze(fixture.freezeFile);
    assert.deepEqual(Object.keys(accepted.evaluator.files).sort(), EVALUATOR_FILES.slice().sort());
    assert.deepEqual(accepted.evaluator.files, currentEvaluatorLedger());
    assert.doesNotThrow(() => OBSERVER.validateEvaluatorLedger(accepted.evaluator));
    assert.doesNotThrow(() => OBSERVER.validateFreeze(JSON.parse(fs.readFileSync(CASE, 'utf8')), observer.freeze, CASE));
    const observerBroken = structuredClone(observer.freeze);
    delete observerBroken.evaluator.files[EVALUATOR_FILES[0]];
    assert.throws(() => OBSERVER.validateFreeze(JSON.parse(fs.readFileSync(CASE, 'utf8')), observerBroken, CASE), (error) => error.code === 'evaluator_binding_mismatch');

    const baseline = JSON.parse(fs.readFileSync(fixture.freezeFile, 'utf8'));
    for (const mutation of ['missing', 'mutated']) {
      const broken = structuredClone(baseline);
      if (mutation === 'missing') delete broken.evaluator.files[EVALUATOR_FILES[0]];
      else broken.evaluator.files[EVALUATOR_FILES[0]].sha256 = '0'.repeat(64);
      fs.writeFileSync(fixture.freezeFile, JSON.stringify(broken));
      assert.throws(
        () => LIVE.prepareRun(CASE, path.join(root, 'missing-cache'), broken, { provider: { command: 'must-not-run' } }),
        (error) => error.code === 'evaluator_binding_mismatch',
        `${mutation} evaluator ledger was not checked by prepareRun`,
      );
      assert.throws(
        () => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, {
          prepareRun: () => { throw new Error('provider boundary reached'); },
          spawn: fixture.spawn,
          characterizationOnly: true,
        }),
        (error) => error.code === 'evaluator_binding_mismatch',
        mutation,
      );
      assert.equal(fixture.calls, 0, `${mutation} evaluator ledger reached provider`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(`${root}-observer`, { recursive: true, force: true }); }
});

test('each rooted turn receives an exact stage-specific lifecycle prompt', () => {
  const expected = [
    '$work-plan\nUse the owner TASK.md and BRIEF.md in inputs. Plan only: read the bounded brownfield context and create the plan artifacts required by $work-plan, then stop. Do not modify product or source files. Do not create, consume, delete, or modify the pause checkpoint at .work/.continue-here.md. Do not approve the plan or transition lifecycle state to execute. Do not run $work-pause, $work-resume, $work-execute, $work-verify, or $work-progress. Leave workflow_verdict untouched. Do not inspect evaluator internals or oracle material.',
    '$work-pause\nUse the owner TASK.md and BRIEF.md in inputs. Pause only: write the canonical .work/.continue-here.md checkpoint for the completed plan, then stop. Do not plan, approve, resume, execute, verify, or report progress in this turn. Leave product and source files unchanged. Leave workflow_verdict untouched. Do not inspect evaluator internals or oracle material.',
    '$work-resume and $work-execute\nUse the owner TASK.md and BRIEF.md in inputs. This is fresh process B: resume the retained workspace and execute only the already-approved plan, then stop. Do not plan, pause, approve, verify, or report progress in this turn. Leave workflow_verdict untouched. Do not inspect evaluator internals or oracle material.',
    '$work-verify\nUse the owner TASK.md and BRIEF.md in inputs. This is fresh process C: verify only the completed implementation and record the required verification evidence, then stop. Do not plan, pause, approve, resume, execute, or report progress in this turn. Leave workflow_verdict untouched. Do not inspect evaluator internals or oracle material.',
    '$work-progress\nUse the owner TASK.md and BRIEF.md in inputs. Progress only: perform the read-only progress report and stop. Do not plan, pause, approve, resume, execute, or verify; do not modify any file or lifecycle state. Leave workflow_verdict untouched. Do not inspect evaluator internals or oracle material.',
  ];
  assert.deepEqual(LIVE.TURN_PLAN.map((turn) => LIVE.turnPrompt({}, turn)), expected);
});

test('plan product mutation fails immediately after one provider call without a separate pause receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-plan-product-mutation-'));
  const fixture = rootedRunFixture(root, { mutation: 'turn-a-plan' });
  try {
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'plan_product_mutation');
    assert.equal(fixture.calls, 1);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-plan.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-pause.json')), false);
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json')));
    assert.equal(terminal.terminal.failure_code, 'plan_product_mutation');
    assert.equal(terminal.workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('plan checkpoint creation, consumption, or mutation fails immediately before handoff', () => {
  for (const planMutation of ['checkpoint-create', 'checkpoint-consume', 'checkpoint-mutate']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-plan-checkpoint-${planMutation}-`));
    const fixture = rootedRunFixture(root, { planMutation });
    try {
      assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'plan_checkpoint_mutation');
      assert.equal(fixture.calls, 1);
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-pause.json')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('plan lifecycle transition to execute fails immediately for root and workflow state', () => {
  for (const planMutation of ['state-execute', 'state-workflow-execute']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-plan-state-transition-${planMutation}-`));
    const fixture = rootedRunFixture(root, { planMutation });
    try {
      assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'plan_state_transition');
      assert.equal(fixture.calls, 1);
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-pause.json')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('plan cannot self-assert owner approval or approval_ref', () => {
  for (const planMutation of ['state-approval', 'state-approval-ref']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-plan-owner-approval-${planMutation}-`));
    const fixture = rootedRunFixture(root, { planMutation });
    try {
      assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'plan_owner_approval');
      assert.equal(fixture.calls, 1);
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-pause.json')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('plan mutation still wins over a failed native recorder receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-plan-failed-product-mutation-'));
  const fixture = rootedRunFixture(root, { mutation: 'turn-a-plan', planFailure: 'timeout' });
  try {
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'plan_product_mutation');
    assert.equal(fixture.calls, 1);
    const turn = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'turn-a-plan.json')));
    assert.equal(turn.terminal.failure_code, 'timeout');
    assert.equal(turn.process.timed_out, true);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'turn-a-pause.json')), false);
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json')));
    assert.equal(terminal.terminal.failure_code, 'plan_product_mutation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function capabilityFixture(root, { mutate = false, itemKinds = ['agent_message'], usage = 12 } = {}) {
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
    return { status: 0, pid: 4444, parent_pid: 4443, stdout: nativeCodexItems('native-capability', 'capability-native', usage, itemKinds), stderr: '', timed_out: false };
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

test('capability probe rejects native usage above the calibrated 500000 ceiling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-capability-budget-'));
  const fixture = capabilityFixture(root, { usage: LIVE.CAPABILITY_MAX_TOKENS + 1 });
  try {
    assert.throws(() => LIVE.runCapability(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, gitText: (args) => args[0] === 'rev-parse' ? CAPABILITY_REVISION : '', characterizationOnly: true }), (error) => error.code === 'usage_excess');
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'capability.json'), 'utf8'));
    assert.equal(receipt.turn.usage.turn_tokens, LIVE.CAPABILITY_MAX_TOKENS + 1);
    assert.equal(receipt.terminal.failure_code, 'usage_excess');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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

test('provider-free coordinator runs production-shaped five-turn handoff with three sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-five-turn-'));
  const fixture = rootedRunFixture(root);
  const approvalOrder = [];
  const approvePlan = fixture.context.approvePlan;
  fixture.context.approvePlan = (context, request) => {
    approvalOrder.push({ planReceipt: fs.existsSync(path.join(fixture.receiptDir, 'turn-a-plan.json')), request });
    return approvePlan(context, request);
  };
  try {
    const result = LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true });
    assert.equal(fixture.calls, 5);
    assert.equal(approvalOrder.length, 1);
    assert.equal(approvalOrder[0].planReceipt, true);
    assert.deepEqual(approvalOrder[0].request, { plan: LIVE.APPROVAL_PLAN, authority: 'owner', approvalRef: LIVE.APPROVAL_REF });
    assert.deepEqual(result.turns.map((item) => item.turn.id), LIVE.TURN_PLAN.map((item) => item.id));
    assert.deepEqual(result.turns.map((item) => item.usage.turn_tokens), [10, 20, 10, 10, 20]);
    assert.deepEqual(result.handoff.sessions, { A: 'native-A', B: 'native-B', C: 'native-C' });
    assert.equal(result.turns[1].turn.checkpoint.path, '<CONSUMER_ROOT>/.work/.continue-here.md');
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'handoff.json')), true);
    const approval = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'approval.json')));
    assert.deepEqual(Object.keys(approval).sort(), ['approval_ref', 'authority', 'case_id', 'changed_paths', 'characterization_only', 'command', 'contract', 'plan', 'plan_artifact', 'plan_receipt', 'record_type', 'result', 'schema_version', 'state', 'target', 'workflow_verdict'].sort());
    assert.equal(approval.command.shell, false);
    assert.deepEqual(approval.command.argv.slice(1), ['lifecycle-transition', 'approve', '--plan', LIVE.APPROVAL_PLAN, '--authority', 'owner', '--approval-ref', LIVE.APPROVAL_REF, '--json']);
    assert.equal(approval.result.status, 0);
    assert.equal(approval.result.output_status, 'ok');
    assert.equal(approval.result.changed, true);
    assert.equal(approval.state.after.workflow_plan_approved, true);
    assert.equal(approval.state.after.workflow_approval_ref, LIVE.APPROVAL_REF);
    assert.equal(approval.plan_receipt.expected_sha256, sha(fs.readFileSync(path.join(fixture.receiptDir, 'turn-a-plan.json'))));
    assert.equal(approval.plan_receipt.observed_sha256, approval.plan_receipt.expected_sha256);
    assert.equal(approval.plan_artifact.expected_sha256, sha(fs.readFileSync(path.join(fixture.context.consumerRoot, '.work', 'brownfield-change', 'CHANGE.md'))));
    assert.equal(approval.plan_artifact.observed_sha256, approval.plan_artifact.expected_sha256);
    assert.equal(approval.workflow_verdict, 'not_evaluated');
    assert.equal(result.handoff.approval_sha256, sha(fs.readFileSync(path.join(fixture.receiptDir, 'approval.json'))));
    for (const turn of LIVE.TURN_PLAN) assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, `${turn.id}.json`))).workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('coordinator approval fails closed before handoff on malformed, replayed, mismatched, or mutating handoffs', () => {
  const cases = [
    ['malformed', (_context) => ({ status: 0, stdout: '{', stderr: '' }), 'approval_output_malformed'],
    ['replayed', (context, request) => ({ status: 0, stdout: JSON.stringify({ operation: 'lifecycle-transition', target: 'approve', status: 'replayed', changed: false, state: {} }), stderr: '' }), 'approval_result_invalid'],
    ['mismatched', (context, request, fallback) => {
      const result = fallback(context, request);
      const value = JSON.parse(result.stdout); value.state.workflow.approval_ref = 'wrong-ref';
      fs.writeFileSync(path.join(context.consumerRoot, '.work', 'state.json'), `${JSON.stringify(value.state)}\n`);
      return result;
    }, 'approval_state_mismatch'],
    ['execution-status-mismatch', (context, request, fallback) => {
      const result = fallback(context, request);
      const value = JSON.parse(result.stdout); value.state.workflow.execution.status = 'complete';
      return { ...result, stdout: JSON.stringify(value) };
    }, 'approval_state_mismatch'],
    ['plan-identity-mismatch', (context, request, fallback) => {
      const result = fallback(context, request);
      const value = JSON.parse(result.stdout); value.state.workflow.plan.identity = '.work/other-change/CHANGE.md';
      return { ...result, stdout: JSON.stringify(value) };
    }, 'approval_state_mismatch'],
    ['plan-receipt', (context, request, fallback) => {
      const result = fallback(context, request);
      context.approvalPlanReceiptExpected = sha(fs.readFileSync(path.join(context.receiptDir, 'turn-a-plan.json')));
      fs.writeFileSync(path.join(context.receiptDir, 'turn-a-plan.json'), 'rewritten plan receipt\n');
      return result;
    }, 'approval_plan_receipt_mutation'],
    ['plan-artifact', (context, request, fallback) => {
      const result = fallback(context, request);
      fs.appendFileSync(path.join(context.consumerRoot, '.work', 'brownfield-change', 'CHANGE.md'), 'rewritten plan artifact\n');
      return result;
    }, 'approval_plan_artifact_mutation'],
    ['plan-artifact-substitution', (context, request, fallback) => {
      const result = fallback(context, request);
      fs.writeFileSync(path.join(context.consumerRoot, '.work', 'brownfield-change', 'CHANGE.md'), '# substituted plan artifact\n');
      return result;
    }, 'approval_plan_artifact_mutation'],
    ['plan-artifact-deletion', (context, request, fallback) => {
      const result = fallback(context, request);
      fs.rmSync(path.join(context.consumerRoot, '.work', 'brownfield-change', 'CHANGE.md'));
      return result;
    }, 'approval_plan_artifact_mutation'],
    ['product', (context, request, fallback) => {
      const result = fallback(context, request);
      fs.writeFileSync(path.join(context.consumerRoot, 'unexpected.txt'), 'unexpected\n', { flag: 'wx' });
      return result;
    }, 'approval_product_mutation'],
    ['checkpoint', (context, request, fallback) => {
      const result = fallback(context, request);
      fs.writeFileSync(path.join(context.consumerRoot, '.work', '.continue-here.md'), 'unexpected checkpoint\n', { flag: 'wx' });
      return result;
    }, 'approval_checkpoint_mutation'],
    ['provider', (context, request, fallback) => {
      context.providerInvocations += 1;
      return fallback(context, request);
    }, 'approval_provider_invoked'],
  ];
  for (const [name, approvePlan, code] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-approval-${name}-`));
    const fixture = rootedRunFixture(root);
    try {
      const defaultApprovePlan = fixture.context.approvePlan;
      fixture.context.approvePlan = (context, request) => approvePlan(context, request, defaultApprovePlan);
      assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === code);
      const approval = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'approval.json')));
      assert.equal(approval.workflow_verdict, 'not_evaluated');
      assert.equal(approval.result.failure_code, code);
      assert.equal(typeof approval.plan_artifact.expected_sha256, 'string');
      if (name === 'plan-receipt') {
        assert.equal(approval.plan_receipt.expected_sha256, fixture.context.approvalPlanReceiptExpected);
        assert.equal(approval.plan_receipt.observed_sha256, sha(Buffer.from('rewritten plan receipt\n')));
      }
      if (name === 'plan-artifact') assert.notEqual(approval.plan_artifact.observed_sha256, approval.plan_artifact.expected_sha256);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('coordinator approval fails closed when the generated plan artifact becomes a symlink', { skip: (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-symlink-probe-'));
  const target = path.join(root, 'target.md'); const link = path.join(root, 'link.md');
  try {
    fs.writeFileSync(target, 'probe\n');
    fs.symlinkSync(target, link, 'file');
    return false;
  } catch (error) {
    return true;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-approval-plan-symlink-'));
  const fixture = rootedRunFixture(root);
  const planArtifact = path.join(fixture.context.consumerRoot, '.work', 'brownfield-change', 'CHANGE.md');
  const replacement = path.join(root, 'replacement.md');
  try {
    fs.writeFileSync(replacement, '# replacement\n');
    const fallback = fixture.context.approvePlan;
    fixture.context.approvePlan = (context, request) => {
      const result = fallback(context, request);
      fs.rmSync(planArtifact);
      fs.symlinkSync(replacement, planArtifact, 'file');
      return result;
    };
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'approval_plan_artifact_mutation');
    const approval = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'approval.json')));
    assert.equal(approval.result.failure_code, 'approval_plan_artifact_mutation');
    assert.equal(approval.plan_artifact.observed_sha256, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pre-approval missing plan artifact seals redacted evidence and never runs B/C', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-approval-plan-missing-before-approval-'));
  const fixture = rootedRunFixture(root, { planMutation: 'plan-artifact-missing-before-approval' });
  try {
    let thrown;
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => {
      thrown = error;
      return error.code === 'approval_plan_artifact_missing';
    });
    assert.equal(fixture.calls, 1);
    const approval = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'approval.json'), 'utf8'));
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json'), 'utf8'));
    assert.equal(thrown.evidence.path, '<CONSUMER_ROOT>/.work/brownfield-change/CHANGE.md');
    assert.equal(approval.result.failure_code, 'approval_plan_artifact_missing');
    assert.equal(terminal.terminal.failure_code, 'approval_plan_artifact_missing');
    assert.equal(JSON.stringify(approval).includes(fixture.context.consumerRoot), false);
    assert.equal(JSON.stringify(terminal).includes(fixture.context.consumerRoot), false);
    for (const dependent of ['turn-a-pause.json', 'turn-b-resume-execute.json', 'turn-c-verify.json', 'turn-c-progress.json']) {
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, dependent)), false, dependent);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pre-approval symlinked plan artifact seals redacted evidence and never runs B/C', { skip: (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-pre-approval-symlink-probe-'));
  const target = path.join(root, 'target.md'); const link = path.join(root, 'link.md');
  try {
    fs.writeFileSync(target, 'probe\n');
    fs.symlinkSync(target, link, 'file');
    return false;
  } catch (error) {
    return true;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-approval-plan-symlink-before-approval-'));
  const fixture = rootedRunFixture(root, { planMutation: 'plan-artifact-symlink-before-approval' });
  try {
    let thrown;
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => {
      thrown = error;
      return error.code === 'approval_plan_artifact_missing';
    });
    assert.equal(fixture.calls, 1);
    const approval = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'approval.json'), 'utf8'));
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json'), 'utf8'));
    assert.equal(thrown.evidence.path, '<CONSUMER_ROOT>/.work/brownfield-change/CHANGE.md');
    assert.equal(approval.result.failure_code, 'approval_plan_artifact_missing');
    assert.equal(terminal.terminal.failure_code, 'approval_plan_artifact_missing');
    assert.equal(JSON.stringify(approval).includes(fixture.context.consumerRoot), false);
    assert.equal(JSON.stringify(terminal).includes(fixture.context.consumerRoot), false);
    for (const dependent of ['turn-a-pause.json', 'turn-b-resume-execute.json', 'turn-c-verify.json', 'turn-c-progress.json']) {
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, dependent)), false, dependent);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('five-turn coordinator accepts the sealed plan usage below the calibrated 3000000 ceiling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-five-turn-plan-usage-'));
  const observedPlanUsage = 2460932;
  const fixture = rootedRunFixture(root, { usageByTurn: (turn) => {
    if (turn.id === 'turn-a-plan') return observedPlanUsage;
    if (turn.id === 'turn-a-pause') return 10;
    return turn.id === 'turn-b-resume-execute' ? 10 : turn.id === 'turn-c-verify' ? 20 : 30;
  } });
  try {
    const result = LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true });
    assert.equal(result.turns[0].usage.turn_tokens, observedPlanUsage);
    assert.deepEqual(result.turns.map((item) => item.usage.turn_tokens), [observedPlanUsage, 10, 10, 20, 30]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('five-turn coordinator refuses plan usage above the calibrated 3000000 ceiling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-five-turn-budget-'));
  const fixture = rootedRunFixture(root, { usageByTurn: (turn) => turn.id === 'turn-a-plan' ? LIVE.PLAN_TOKEN_CEILING + 1 : 10 });
  try {
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'usage_excess');
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, `${LIVE.TURN_PLAN[0].id}.json`), 'utf8'));
    assert.equal(receipt.usage.turn_tokens, LIVE.PLAN_TOKEN_CEILING + 1);
    assert.equal(receipt.terminal.failure_code, 'usage_excess');
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json'), 'utf8'));
    assert.equal(terminal.terminal.failure_code, 'usage_excess');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('five-turn coordinator rejects aggregate turn usage above the fixed total ceiling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-five-turn-total-budget-'));
  const fixture = rootedRunFixture(root, {
    initialTotalUsage: LIVE.TURN_TOTAL_TOKENS - 5,
    usageByTurn: () => 10,
  });
  try {
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'total_token_excess');
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, `${LIVE.TURN_PLAN[0].id}.json`), 'utf8'));
    assert.equal(receipt.usage.turn_tokens, 10);
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json'), 'utf8'));
    assert.equal(terminal.terminal.failure_code, 'total_token_excess');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('injected coordinator seams are rejected unless explicitly characterization-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-injection-'));
  const fixture = rootedRunFixture(root);
  try { assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn }), (error) => error.code === 'characterization_only_required'); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pause scope refusal seals a terminal and never hands off', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-refusal-turn-a-pause-'));
  const fixture = rootedRunFixture(root, { mutation: 'turn-a-pause' });
  try {
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => ['pause_product_mutation', 'provider_authored_verdict'].includes(error.code));
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'terminal.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'handoff.json')), false);
    const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json')));
    assert.equal(terminal.workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fresh verifier identity is retained for progress and provider verdict stays unevaluated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-verification-progress-'));
  const fixture = rootedRunFixture(root, { verdict: 'passed' });
  try {
    const result = LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true });
    assert.equal(fixture.calls, 5);
    assert.deepEqual(result.handoff.sessions, { A: 'native-A', B: 'native-B', C: 'native-C' });
    assert.equal(result.turns[3].native.thread_id, 'native-C');
    assert.equal(result.turns[4].native.thread_id, 'native-C');
    for (const turn of result.turns) assert.equal(turn.workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('top-level identity collisions seal the failing receipt before dependent turns', () => {
  for (const [label, targetIndex, sealedTurn] of [['B', 2, 'turn-b-resume-execute'], ['C', 3, 'turn-c-verify']]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-identity-collision-${label}-`));
    const fixture = rootedRunFixture(root);
    const normalSpawn = fixture.spawn;
    fixture.spawn = (...args) => {
      const result = normalSpawn(...args);
      return fixture.calls - 1 === targetIndex ? { ...result, stdout: nativeCodex('native-A', 'collision', 10) } : result;
    };
    try {
      assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), fixture.freezeFile, fixture.receiptDir, { prepareRun: fixture.prepareRun, spawn: fixture.spawn, characterizationOnly: true }), (error) => error.code === 'session_identity_collision');
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, `${sealedTurn}.json`)), true);
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, 'terminal.json')), true);
      const terminal = JSON.parse(fs.readFileSync(path.join(fixture.receiptDir, 'terminal.json')));
      assert.equal(terminal.terminal.failure_code, 'session_identity_collision');
      assert.equal(terminal.terminal.sealed_turn.turn, sealedTurn);
      assert.equal(fs.existsSync(path.join(fixture.receiptDir, targetIndex === 2 ? 'turn-c-verify.json' : 'turn-c-progress.json')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('wrong fresh identity, wrong resume identity, and native order fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-native-refusal-'));
  const fixture = rootedRunFixture(root);
  try {
    const noCheckpoint = rootedRunFixture(root + '-checkpoint');
    noCheckpoint.spawn = (_command, _argv, options) => ({ status: 0, pid: 1, stdout: nativeCodex('native-A', 'x', 10), stderr: '', timed_out: false });
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), noCheckpoint.freezeFile, noCheckpoint.receiptDir, { prepareRun: noCheckpoint.prepareRun, spawn: noCheckpoint.spawn, characterizationOnly: true }), (error) => String(error.code).startsWith('checkpoint_'));
    const wrongFreshIdentity = rootedRunFixture(root + '-fresh-identity');
    const normalSpawn = wrongFreshIdentity.spawn;
    wrongFreshIdentity.spawn = (command, argv, options) => { const result = normalSpawn(command, argv, options); return { ...result, stdout: nativeCodex('native-A', 'x', 10) }; };
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), wrongFreshIdentity.freezeFile, wrongFreshIdentity.receiptDir, { prepareRun: wrongFreshIdentity.prepareRun, spawn: wrongFreshIdentity.spawn, characterizationOnly: true }), (error) => ['session_identity_collision', 'session_identity_invalid'].includes(error.code));
    const wrongResumeIdentity = rootedRunFixture(root + '-resume-mismatch');
    const resumeSpawn = wrongResumeIdentity.spawn;
    wrongResumeIdentity.spawn = (...args) => {
      const result = resumeSpawn(...args);
      return wrongResumeIdentity.calls === 2 ? { ...result, stdout: nativeCodex('native-B', 'wrong-resume', 10) } : result;
    };
    assert.throws(() => LIVE.runFrozen(CASE, path.join(root, 'unused-cache'), wrongResumeIdentity.freezeFile, wrongResumeIdentity.receiptDir, { prepareRun: wrongResumeIdentity.prepareRun, spawn: wrongResumeIdentity.spawn, characterizationOnly: true }), (error) => error.code === 'identity_mismatch');
    assert.equal(wrongResumeIdentity.calls, 2);
    const failedResume = JSON.parse(fs.readFileSync(path.join(wrongResumeIdentity.receiptDir, 'turn-a-pause.json')));
    assert.equal(failedResume.terminal.failure_code, 'identity_mismatch');
    const failedTerminal = JSON.parse(fs.readFileSync(path.join(wrongResumeIdentity.receiptDir, 'terminal.json')));
    assert.equal(failedTerminal.terminal.sealed_turn.turn, 'turn-a-pause');
    assert.equal(fs.existsSync(path.join(wrongResumeIdentity.receiptDir, 'turn-b-resume-execute.json')), false);
    assert.throws(() => LIVE.runTurn(fixture.context, LIVE.TURN_PLAN[0], null, { spawn: () => ({ status: 0, pid: 1, stdout: '{}\n', stderr: '', timed_out: false }) }), (error) => error.code === 'native_sequence_invalid');
    fixture.context.totalUsage = 20;
    assert.doesNotThrow(() => LIVE.runTurn(fixture.context, LIVE.TURN_PLAN[0], null, { spawn: () => ({ status: 0, pid: 1, stdout: nativeCodex('native-A', 'x', 10), stderr: '', timed_out: false }) }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(root + '-checkpoint', { recursive: true, force: true }); fs.rmSync(root + '-fresh-identity', { recursive: true, force: true }); fs.rmSync(root + '-resume-mismatch', { recursive: true, force: true }); }
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

test('observer rejects every wrong native initial or resumed argv grammar', () => {
  const validRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-observer-argv-valid-'));
  const valid = observerHandoffFixture(validRoot);
  try {
    assert.throws(() => OBSERVER.completeHandoff({ caseFile: CASE, freezeFile: valid.freezeFile, receiptDir: valid.receiptDir, consumerRoot: valid.consumerRoot, terminalValue: valid.terminal, handoffValue: valid.handoff }), (error) => error.code === 'upstream_origin_mismatch');
  } finally { fs.rmSync(validRoot, { recursive: true, force: true }); }
  const cases = [
    ['a-plan', (argv) => { argv[2] = 'resume'; argv[3] = 'native-A'; }],
    ['a-pause', (argv) => { argv[3] = 'native-B'; }],
    ['b-resume-execute', (argv) => { argv[2] = 'resume'; argv[3] = 'native-A'; }],
    ['c-verify', (argv) => { argv[2] = 'resume'; argv[3] = 'native-B'; }],
    ['c-progress', (argv) => { argv[3] = 'native-A'; }],
  ];
  for (const [name, mutateArgv] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-observer-argv-${name}-`));
    const fixture = observerHandoffFixture(root, (argv, turn) => { if (turn.id === `turn-${name}`) mutateArgv(argv); });
    try {
      assert.throws(() => OBSERVER.completeHandoff({ caseFile: CASE, freezeFile: fixture.freezeFile, receiptDir: fixture.receiptDir, consumerRoot: fixture.consumerRoot, terminalValue: fixture.terminal, handoffValue: fixture.handoff }), (error) => error.code === 'turn_argv_invalid');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

function syntheticObservation(root, checks = {}) {
  const observationFile = path.join(root, 'observation.json');
  const merged = { import_with_sha1_unavailable: true, explicit_sha256_signer: true, default_sha1_rejected: true, upstream_tests_pass: true, ...checks };
  const observation = {
    record_type: 'phase16_itsdangerous_observation', contract: 'phase16-itsdangerous-observation-v1', case_id: 'itsdangerous-fips-sha1',
    freeze_sha256: 'd'.repeat(64), terminal_sha256: 'e'.repeat(64), handoff_sha256: 'f'.repeat(64),
    retained_root: '<RETAINED_ROOT>', case: { revision: '93ae366874bbd4f69d90495c45b2cd336387496c', sha256: 'e77f420a8036a80b1ff96f9c6a96ffb3f9e4d32e724d4a33604a24119bb97c3f', oracle_sha256: '21a66bfd5b2d00c0199a5b4fbba75af507c112ff4f8717f7f13e3ee498ca1a11' },
    git: { top_level: '<RETAINED_ROOT>', head: '93ae366874bbd4f69d90495c45b2cd336387496c', scope: { forbidden: [], product: ['src/itsdangerous/signer.py'] }, candidate_sha256: 'a'.repeat(64) },
    turns: OBSERVER.WORKFLOW_STEPS.map((id, index) => ({ id, thread_id: index < 2 ? 'native-A' : index === 2 ? 'native-B' : 'native-C', turn_id: `turn-${index}`, sha256: String(index + 1).repeat(64) })), sessions: { count: 3, turns: 5 },
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

test('observer projects a valid partial plan terminal as product red without workflow or oracle claims', { skip: !process.env.PHASE16_REAL_CACHE }, () => {
  const root = makePartialPlanFixture();
  try {
    const result = OBSERVER.observePartialPlan({ caseFile: CASE, freezeFile: root.freezeFile, receiptDir: root.receiptDir, consumerRoot: root.consumerRoot });
    assert.equal(result.disposition, 'product_red');
    assert.equal(result.projection.disposition, 'product_red');
    assert.deepEqual(result.projection.workflow, { sessions: 1, turns: 1, steps: [{ id: 'turn-a-plan', disposition: 'partial' }] });
    assert.equal(result.projection.oracle.status, 'not_produced_due_to_partial_terminal');
    assert.equal(result.projection.terminal_fact, 'timeout');
    assert.equal(result.projection.runtime.model, 'not_claimed');
    assert.match(result.projection.claim_limit, /one partial rooted plan observation/i);
    assert.doesNotMatch(JSON.stringify(result.projection), /C:\\Users|prompt|transcript|session_id/i);
    assert.equal(fs.existsSync(root.observationFile), true);
    assert.equal(fs.existsSync(root.gradeFile), true);
    assert.throws(() => OBSERVER.observePartialPlan({ caseFile: CASE, freezeFile: root.freezeFile, receiptDir: root.receiptDir, consumerRoot: root.consumerRoot }), (error) => error.code === 'receipt_exists');
  } finally { fs.rmSync(root.root, { recursive: true, force: true }); }
});

test('partial plan observation fails closed for no-product, setup-only, predecessor, and unbound evidence', { skip: !process.env.PHASE16_REAL_CACHE }, () => {
  const cases = [
    ['no-product', (fixture) => {
      const baseline = cp.spawnSync('git', ['show', 'HEAD:src/itsdangerous/signer.py'], { cwd: fixture.consumerRoot, encoding: 'utf8', windowsHide: true });
      assert.equal(baseline.status, 0, baseline.stderr);
      fs.writeFileSync(path.join(fixture.consumerRoot, 'src', 'itsdangerous', 'signer.py'), baseline.stdout);
    }],
    ['setup-only', (fixture) => fs.writeFileSync(path.join(fixture.consumerRoot, 'setup-only.txt'), 'setup\n')],
    ['extra-plan-artifact', (fixture) => fs.writeFileSync(path.join(fixture.consumerRoot, '.work', 'brownfield-change', 'EXTRA.md'), 'unapproved plan output\n')],
    ['predecessor', (fixture) => fs.writeFileSync(path.join(fixture.receiptDir, 'turn-b-resume-execute.json'), '{}\n')],
    ['wrong-work-plan', (fixture) => fs.appendFileSync(fixture.workPlanFile, '\nchanged\n')],
  ];
  for (const [name, mutate] of cases) {
    const root = makePartialPlanFixture();
    try {
      mutate(root);
      rewritePartialReceiptFiles(root);
      const result = OBSERVER.observePartialPlan({ caseFile: CASE, freezeFile: root.freezeFile, receiptDir: root.receiptDir, consumerRoot: root.consumerRoot });
      assert.fail(`${name} unexpectedly projected: ${JSON.stringify(result)}`);
    } catch (error) {
      assert.ok(['candidate_missing', 'git_scope_invalid', 'partial_predecessor', 'skill_hash_mismatch', 'partial_terminal_invalid', 'receipt_invalid'].includes(error.code), `${name}: ${error.code}`);
    } finally { fs.rmSync(root.root, { recursive: true, force: true }); }
  }
});

function makePartialPlanFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-partial-plan-'));
  const consumerRoot = path.join(root, 'consumer_root');
  const receiptDir = path.join(root, 'receipts');
  const cache = process.env.PHASE16_REAL_CACHE;
  assert.ok(cache, 'PHASE16_REAL_CACHE is required for partial observer tests');
  const bundle = path.join(cache, 'itsdangerous-fips-sha1', 'source.bundle');
  const cloned = cp.spawnSync('git', ['clone', '--quiet', bundle, consumerRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(cloned.status, 0, cloned.stderr);
  const checkout = cp.spawnSync('git', ['checkout', '--quiet', '--detach', CAPABILITY_REVISION], { cwd: consumerRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(checkout.status, 0, checkout.stderr);
  cp.spawnSync('git', ['remote', 'set-url', 'origin', 'https://github.com/pallets/itsdangerous.git'], { cwd: consumerRoot, encoding: 'utf8', windowsHide: true });
  fs.mkdirSync(path.join(consumerRoot, '.agents', 'skills', 'work-plan'), { recursive: true });
  const workPlanFile = path.join(consumerRoot, '.agents', 'skills', 'work-plan', 'SKILL.md');
  fs.writeFileSync(workPlanFile, '## completion\n**Planning stops here:** `work-plan` ends after the plan artifact is written. Do not start implementation in this same run, and do not treat imperative handoff text as execution authorization.\n');
  const brownfieldDir = path.join(consumerRoot, '.work', 'brownfield-change');
  fs.mkdirSync(brownfieldDir, { recursive: true });
  fs.writeFileSync(path.join(brownfieldDir, 'CHANGE.md'), `---\nchange: CHANGE-001\nstatus: active\ntype: medium_scope_brownfield\n---\n\n# Brownfield Change\n\n## Goal\nMake importing itsdangerous succeed while preserving explicit signing.\n\n## Why This Exists\nImporting itsdangerous must remain safe when the default digest is unavailable.\n\n## In Scope\n- Modify only src/itsdangerous/signer.py.\n\n## Out of Scope\n- Unrelated cryptographic and workflow changes.\n\n## Structural Promotion Triggers\nPromote only if the bounded signer change widens.\n\n## Done When\nThe signer imports and explicit SHA-256 signing remains successful.\n\n## Current Status\nThe plan is active and implementation has not started.\n\n## Next Action\nExecute the approved signer change after the handoff boundary.\n\n## PR Slice Ownership\nThe signer compatibility slice owns src/itsdangerous/signer.py.\n`);
  fs.writeFileSync(path.join(brownfieldDir, 'HANDOFF.md'), `---\nchange: CHANGE-001\nupdated: 2026-08-28\nruntime: codex-cli\n---\n\n# Brownfield Change Handoff\n\nCHANGE.md is the only operational authority for this plan.\n\n## Active Constraints\nKeep product scope to src/itsdangerous/signer.py.\n\n## Unresolved Uncertainty\nThe exact unavailable-digest error follows the module style.\n\n## Decision Posture\nUse the smallest lazy default-resolution change.\n\n## Anti-Regression\nPreserve explicit SHA-256 behavior and import safety.\n\n## Next Action\nResume from the checkpoint and execute only the active plan.\n`);
  fs.writeFileSync(path.join(brownfieldDir, 'VERIFICATION.md'), `---\nchange: CHANGE-001\nverified: 2026-08-28\nstatus: pending\ndelivery_posture: repo_only\n---\n\n# Brownfield Change Verification\n\n## Goal Verification\nThe goal is to make importing itsdangerous succeed and preserve explicit signing.\n\n## Evidence\nNo closeout evidence has been collected.\n\n## Artifact Checks\nThe signer artifact exists and remains in scope.\n\n## Gaps\nImplementation and tests are pending.\n\n## Widening Reuse\nPreserve this partial proof if the change widens.\n\n## Human Verification\nNone required unless deterministic checks expose uncertainty.\n\n## Closeout Decision\nPending until every plan condition is evaluated.\n`);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.appendFileSync(path.join(consumerRoot, 'src', 'itsdangerous', 'signer.py'), '\n# partial plan product change\n');
  const workPlanHash = sha(fs.readFileSync(workPlanFile));
  const freeze = {
    schema_version: 1, contract: 'phase16-rooted-codex-freeze-v1', case_id: 'itsdangerous-fips-sha1', provider_sandbox: 'not_claimed', workflow_verdict: 'not_evaluated',
    case: { sha256: sha(fs.readFileSync(CASE)), oracle: { path: 'tests/evals/cases/itsdangerous-fips-sha1-oracle.py', sha256: JSON.parse(fs.readFileSync(CASE)).oracle.sha256 }, input_bundle: { contract: 'phase16-public-input-bundle-v1', sha256: 'a'.repeat(64) } },
    source: { repository: 'https://github.com/pallets/itsdangerous.git', revision: CAPABILITY_REVISION, main: CAPABILITY_REVISION, origin_main: CAPABILITY_REVISION }, evaluator: { contract: 'phase16-evaluator-ledger-v1', files: currentEvaluatorLedger() },
    bundle: { sha256: 'b'.repeat(64) }, controls: { sha256: 'c'.repeat(64) }, candidate: { sha256: 'd'.repeat(64) }, runtime: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high', python: { sha256: 'e'.repeat(64) } }, skills: { 'work-plan': workPlanHash }, root_map: { consumer_root: '<RUN_ROOT>/consumer_root' },
  };
  const freezeFile = path.join(root, 'freeze.json'); fs.writeFileSync(freezeFile, JSON.stringify(freeze));
  const preparation = { schema_version: 1, record_type: 'phase16_preparation_receipt', case_id: 'itsdangerous-fips-sha1', bundle_sha256: freeze.bundle.sha256, controls_sha256: freeze.controls.sha256, candidate_sha256: freeze.candidate.sha256, python: { sha256: freeze.runtime.python.sha256 }, characterization_only: false, workflow_verdict: 'not_evaluated' };
  const turn = { schema_version: 1, record_type: 'phase16_codex_turn_receipt', provider_invoked: true, characterization_only: false, invocation: { argv: ['exec', '-m', 'gpt-5.6-luna'] }, native: { thread_id: null, turn_id: null }, process: { status: 'exited', timed_out: true }, terminal: { status: 'failed', failure_code: 'turn_timeout' }, turn: { id: 'turn-a-plan', role: 'a-plan', skill: 'work-plan', skills: ['work-plan'], session: 'A', initial: true }, workflow_verdict: 'not_evaluated' };
  const terminal = { schema_version: 1, record_type: 'phase16_terminal_receipt', case_id: 'itsdangerous-fips-sha1', turn_count: 1, provider_invoked: true, workflow_verdict: 'not_evaluated', terminal: { status: 'failed', failure_code: 'turn_timeout', sealed_turn: { turn: 'turn-a-plan' } } };
  const capability = {
    schema_version: 1, record_type: 'phase16_capability_receipt', contract: 'phase16-native-capability-v1', case_id: 'itsdangerous-fips-sha1', capability: 'native-codex-workspace-write', provider_invoked: true, characterization_only: false, workflow_verdict: 'not_evaluated',
    turn: { provider_invoked: true, characterization_only: false, native: { thread_id: 'capability-thread', parse_error: null }, terminal: { status: 'provider_complete' } },
    terminal: { status: 'passed', failure_code: null }, marker: { path: '<CONSUMER_ROOT>/.work/eval-capability.json', bytes: 145, sha256: '8f87a7ebd28bfb07868d117a023622405be9eceb23a091cb8e3fe1e3ee38b11c', exact: true },
    git: { expected_head: CAPABILITY_REVISION, head: CAPABILITY_REVISION, status: '?? .agents/skills/work-plan/SKILL.md\n?? .work/eval-capability.json' }, snapshots: { pre_sha256: 'f'.repeat(64), post_sha256: 'e'.repeat(64), changed_paths: ['.work/eval-capability.json'] },
  };
  const files = { capability, preparation, turn, terminal };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(receiptDir, `${name === 'turn' ? 'turn-a-plan' : name}.json`), JSON.stringify(value));
  return { root, consumerRoot, receiptDir, freezeFile, workPlanFile, observationFile: path.join(receiptDir, 'partial-observation.json'), gradeFile: path.join(receiptDir, 'partial-grade.json'), capability, preparation, turn, terminal };
}

function rewritePartialReceiptFiles(fixture) {
  fs.writeFileSync(path.join(fixture.receiptDir, 'capability.json'), JSON.stringify(fixture.capability));
  fs.writeFileSync(path.join(fixture.receiptDir, 'preparation.json'), JSON.stringify(fixture.preparation));
  fs.writeFileSync(path.join(fixture.receiptDir, 'turn-a-plan.json'), JSON.stringify(fixture.turn));
  fs.writeFileSync(path.join(fixture.receiptDir, 'terminal.json'), JSON.stringify(fixture.terminal));
}
