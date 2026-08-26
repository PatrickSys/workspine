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
const EVAL = path.join(REPO, 'tests', 'evals', 'phase16-core-flows.cjs');
const CAMPAIGN = path.join(REPO, 'tests', 'evals', 'phase16-core-flows.json');
const CALIBRATION = path.join(REPO, 'tests', 'evals', 'phase16-calibration.cjs');
const CALIBRATION_CASES = path.join(REPO, 'tests', 'evals', 'phase16-calibration-cases.json');
const PROOF = path.join(REPO, 'tests', 'proof', 'phase16-first-run.cjs');
const HISTORICAL = path.join(REPO, 'tests', 'evals', 'historical', 'phase16-04A-scenarios.json');
const HISTORICAL_SHA256 = 'D66601B028C92CB520011DFE9DC669190FD45F3AE435BC722D2AF395DDDA4504';
const LIVE = require(EVAL);

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function stableHash(value) { return crypto.createHash('sha256').update(stableStringify(value)).digest('hex'); }
function run(argv) { return cp.spawnSync(process.execPath, [EVAL, ...argv], { cwd: REPO, encoding: 'utf8', windowsHide: true }); }
function runCalibration(argv) { return cp.spawnSync(process.execPath, [CALIBRATION, ...argv], { cwd: REPO, encoding: 'utf8', windowsHide: true }); }
function parse(stdout) { return JSON.parse(stdout); }

function bytesHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function runWithEnv(argv, env) { return cp.spawnSync(process.execPath, [EVAL, ...argv], { cwd: REPO, env, encoding: 'utf8', windowsHide: true }); }

// A small local-only provider fixture. It is intentionally outside the
// checkout and is never used by the normal campaign tests.
function liveFixture({ output, exitCode = 0, runtime = 'codex', sleepMs = 0, secretValue = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-00b-'));
  const source = path.join(root, 'source');
  const packageRoot = path.join(source, 'package');
  const providerRoot = path.join(root, 'provider');
  const providerBin = providerRoot;
  const targetRelative = runtime === 'claude'
    ? path.join('node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
    : path.join('node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const providerTarget = path.join(providerRoot, targetRelative);
  const configFile = path.join(providerRoot, 'fixture-config.json');
  const authFile = path.join(providerRoot, 'fixture-auth.json');
  fs.mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.dirname(providerTarget), { recursive: true });
  fs.mkdirSync(providerBin, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'bin', 'gsdd.mjs'), 'export default true;\n');
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  fs.writeFileSync(configFile, '{"fixture":true}\n');
  fs.writeFileSync(authFile, '{"auth":"fixture-only"}\n');
  const version = runtime === 'claude' ? 'fixture-claude-1' : 'fixture-codex-1';
  const lines = Array.isArray(output) ? output : runtime === 'claude' ? [
    { type: 'system', subtype: 'init', session_id: 'session-fixture' },
    { type: 'assistant', session_id: 'session-fixture', message: { model: 'claude-sonnet-5' } },
    { type: 'result', session_id: 'session-fixture', modelUsage: { 'claude-sonnet-5': { inputTokens: 1 } } },
  ] : [
    { type: 'thread.started', thread_id: 'thread-fixture' },
    { type: 'turn.started', thread_id: 'thread-fixture', turn_id: 'turn-fixture' },
    { type: 'item.started', thread_id: 'thread-fixture', turn_id: 'turn-fixture', item_id: 'item-fixture' },
    { type: 'item.completed', thread_id: 'thread-fixture', turn_id: 'turn-fixture', item_id: 'item-fixture' },
    { type: 'turn.completed', thread_id: 'thread-fixture', turn_id: 'turn-fixture' },
  ];
  const encodedOutput = lines.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') + '\n';
  fs.writeFileSync(providerTarget, `if (process.argv.includes('--version')) { process.stdout.write(${JSON.stringify(`${version}\n`)}); process.exitCode=0; } else if (${Number(sleepMs)} > 0) { setTimeout(() => { process.stdout.write(${JSON.stringify(encodedOutput)}); process.exitCode=${exitCode}; }, ${Number(sleepMs)}); } else { process.stdout.write(${JSON.stringify(encodedOutput)}); process.exitCode=${exitCode}; }\n`);
  const command = runtime === 'claude' ? 'claude' : 'codex';
  const shim = path.join(providerBin, `${command}.cmd`);
  fs.writeFileSync(shim, `@echo off\r\n"%~dp0\\${targetRelative.replaceAll('/', '\\')}" %*\r\n`);
  const artifact = path.join(root, 'candidate.tgz');
  const packed = cp.spawnSync('tar', ['-czf', artifact, '-C', source, 'package'], { encoding: 'utf8', windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr);
  const entryPath = 'package/bin/gsdd.mjs';
  const sourceHashes = {
    [entryPath]: bytesHash(fs.readFileSync(path.join(packageRoot, 'bin', 'gsdd.mjs'))),
    'package/package.json': bytesHash(fs.readFileSync(path.join(packageRoot, 'package.json'))),
  };
  const members = Object.entries(sourceHashes).map(([memberPath, memberHash]) => ({ path: memberPath, sha256: memberHash }));
  const selectedPin = { version, version_sha256: bytesHash(Buffer.from(`${version}${String.fromCharCode(10)}`)), executable_path: providerTarget, executable_sha256: bytesHash(fs.readFileSync(providerTarget)), shim_path: shim, shim_sha256: bytesHash(fs.readFileSync(shim)), target_path: providerTarget, target_sha256: bytesHash(fs.readFileSync(providerTarget)), config_path: configFile, config_sha256: bytesHash(fs.readFileSync(configFile)) };
  const unusedPin = (name) => ({ version: `fixture-${name}-1`, version_sha256: bytesHash(Buffer.from(`fixture-${name}-1${String.fromCharCode(10)}`)), executable_sha256: bytesHash(fs.readFileSync(providerTarget)), shim_sha256: bytesHash(fs.readFileSync(shim)), target_sha256: bytesHash(fs.readFileSync(providerTarget)), config_path: configFile, config_sha256: bytesHash(fs.readFileSync(configFile)) });
  const runtimes = {
    codex: runtime === 'codex' ? selectedPin : unusedPin('codex'),
    claude: runtime === 'claude' ? selectedPin : unusedPin('claude'),
    opencode: unusedPin('opencode'),
  };
  const revision = {
    schema_version: 1, contract: 'phase16-live-campaign-revision.v1', revision_id: `fixture-${process.pid}`,
    candidate: { commit: '0123456789012345678901234567890123456789', artifact_path: artifact, artifact_sha256: bytesHash(fs.readFileSync(artifact)), members, entry: { path: entryPath, sha256: sourceHashes[entryPath] }, source_hashes: sourceHashes },
    runtimes, raw_output_limit_bytes: 65536, retained_event_limit_bytes: 65536, auth_config_files: [{ path: authFile, sha256: bytesHash(fs.readFileSync(authFile)), destination: 'fixture-auth.json' }], secret_env: secretValue ? [{ name: 'PHASE16_TEST_SECRET', sha256: bytesHash(Buffer.from(secretValue)) }] : [],
  };
  const revisionFile = path.join(root, 'revision.json');
  fs.writeFileSync(revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
  return { root, source, revisionFile, receiptFile: path.join(root, 'receipt.json'), configFile, authFile, providerTarget, shim, artifact, env: { ...process.env, PATH: `${providerBin}${path.delimiter}${process.env.PATH || ''}`, ...(secretValue ? { PHASE16_TEST_SECRET: secretValue } : {}) }, runtime };
}

test('campaign has exactly three journeys and the retained 21-binding matrix', () => {
  const campaign = JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8'));
  assert.equal(campaign.contract, 'phase16-core-flows.v2');
  assert.deepEqual(campaign.calibration, {
    contract: 'phase16-calibration.v1',
    case_file: 'tests/evals/phase16-calibration-cases.json',
    case_ids: ['treesnap-greenfield', 'itsdangerous-fips-sha1', 'chi-bodyless-charset', 'packed-readme-install', 'scripted-owner-broker', 'docusaurus-browser'],
  });
  assert.equal(campaign.journeys.length, 3);
  assert.equal(campaign.bindings.length, 21);
  const retainedAuxiliary = ['owner-scripted-plan-check', 'packed-readme-codex', 'docusaurus-browser-codex'];
  const removedAuxiliary = [
    'owner-scripted-pause-resume', 'owner-scripted-verify',
    'packed-readme-claude', 'packed-readme-opencode',
    'docusaurus-browser-claude', 'docusaurus-browser-opencode',
  ];
  assert.deepEqual(campaign.bindings.filter((binding) => binding.kind !== 'core').map((binding) => binding.run_id), retainedAuxiliary);
  const expectedCore = [
    'core-treesnap-codex-1', 'core-treesnap-codex-2', 'core-treesnap-claude-1', 'core-treesnap-claude-2', 'core-treesnap-opencode-1', 'core-treesnap-opencode-2',
    'core-brownfield-plan-codex-1', 'core-brownfield-plan-codex-2', 'core-brownfield-plan-claude-1', 'core-brownfield-plan-claude-2', 'core-brownfield-plan-opencode-1', 'core-brownfield-plan-opencode-2',
    'core-brownfield-quick-codex-1', 'core-brownfield-quick-codex-2', 'core-brownfield-quick-claude-1', 'core-brownfield-quick-claude-2', 'core-brownfield-quick-opencode-1', 'core-brownfield-quick-opencode-2',
  ];
  assert.deepEqual(campaign.bindings.filter((binding) => binding.kind === 'core').map((binding) => binding.run_id), expectedCore);
  const calibration = JSON.parse(fs.readFileSync(CALIBRATION_CASES, 'utf8'));
  assert.deepEqual(calibration.cases.filter((item) => item.admission !== 'admitted-core').flatMap((item) => item.campaign_refs).sort(), [...retainedAuxiliary].sort());
  assert.ok(removedAuxiliary.every((runId) => !campaign.bindings.some((binding) => binding.run_id === runId)));
  assert.ok(removedAuxiliary.every((runId) => !calibration.cases.some((item) => item.campaign_refs.includes(runId))));
  const freshRuns = campaign.bindings.filter((binding) => binding.critical_witnesses.includes('fresh-pause-resume')).map((binding) => binding.run_id);
  assert.deepEqual(freshRuns, [
    'core-brownfield-plan-codex-1', 'core-brownfield-plan-codex-2', 'core-brownfield-plan-claude-1',
    'core-brownfield-plan-claude-2', 'core-brownfield-plan-opencode-1', 'core-brownfield-plan-opencode-2',
  ]);
  assert.ok(campaign.bindings.every((binding) => binding.critical_witnesses.length === (binding.required_skills.length > 0 ? 9 : 8) + (freshRuns.includes(binding.run_id) ? 1 : 0)));
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'core-treesnap-codex-1').required_skills, ['work-new-project', 'work-plan', 'work-execute', 'work-verify']);
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'core-brownfield-plan-codex-1').required_skills, ['work-plan', 'work-pause', 'work-resume', 'work-execute', 'work-verify', 'work-progress']);
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'owner-scripted-plan-check').required_skills, ['work-plan']);
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'packed-readme-codex').required_skills, []);
  const expectedJourneyTimeout = 3300;
  const expectedBudgets = {
    core: { timeout_seconds: 3300, role_budgets_seconds: { plan_check: 900, execute: 1800, independent_verify: 600 } },
    'scripted-owner': { timeout_seconds: 2400, role_budgets_seconds: { plan_check: 600, execute: 1200, independent_verify: 600 } },
    'packed-readme': { timeout_seconds: 2400, role_budgets_seconds: { plan_check: 600, execute: 1200, independent_verify: 600 } },
    'docusaurus-browser': { timeout_seconds: 6300, role_budgets_seconds: { plan_check: 900, execute: 4500, independent_verify: 900 } },
  };
  for (const journey of campaign.journeys) assert.equal(journey.timeout_seconds, expectedJourneyTimeout, `${journey.id} journey timeout drifted`);
  for (const binding of campaign.bindings) {
    assert.deepEqual({ timeout_seconds: binding.timeout_seconds, role_budgets_seconds: binding.role_budgets_seconds }, expectedBudgets[binding.kind], `${binding.run_id} budget drifted`);
  }
  assert.equal(campaign.bindings.filter((binding) => binding.kind === 'core').length, 18);
  for (const kind of ['scripted-owner', 'packed-readme', 'docusaurus-browser']) assert.equal(campaign.bindings.filter((binding) => binding.kind === kind).length, 1);
});

test('live run consumes a frozen artifact and emits only a non-verdict provider receipt', () => {
  const fixture = liveFixture();
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.record_type, 'provider_execution_receipt');
    assert.equal(receipt.provider_invoked, true);
    assert.equal(receipt.workflow_verdict, 'not_evaluated');
    assert.equal(receipt.terminal.status, 'completed');
    assert.deepEqual(receipt.cleanup, { attempted: true, removed: true });
    assert.equal(receipt.roles.length, 3);
    assert.deepEqual(receipt.roles.map((role) => role.role), ['plan-check', 'execute', 'independent-verify']);
    assert.deepEqual(receipt.roles.map((role) => role.invocation.budget_seconds), [900, 1800, 600]);
    assert.equal(new Set(receipt.roles.map((role) => role.invocation.argv.at(-1))).size, 3);
    assert.equal(new Set(receipt.roles.map((role) => role.context)).size, 3);
    assert.ok(receipt.roles.every((role) => role.terminal.status === 'completed'));
    assert.ok(receipt.roles.every((role) => role.invocation.config_files.some((item) => item.path.endsWith('/fixture-auth.json'))));
    assert.ok(!JSON.stringify(receipt).includes(process.env.USERPROFILE || '___owner_profile_not_set___'));
    assert.equal(receipt.provider.identity_claim, 'requested/native identity only');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live Claude binding captures native session, assistant model, and result linkage', () => {
  const fixture = liveFixture({ runtime: 'claude' });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-claude-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, true);
    assert.equal(receipt.provider.runtime_version, 'fixture-claude-1');
    assert.equal(receipt.roles.length, 3);
    assert.ok(receipt.roles.every((role) => role.native.parser === 'claude-stream-json' && role.native.assistant_model === 'claude-sonnet-5'));
    assert.equal(receipt.workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live run ignores mutable checkout/source drift after the frozen artifact is sealed', () => {
  const fixture = liveFixture();
  try {
    fs.writeFileSync(path.join(fixture.source, 'package', 'bin', 'gsdd.mjs'), 'export default false;\n');
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.candidate.entry_sha256, bytesHash(Buffer.from('export default true;\n')));
    assert.equal(receipt.workflow_verdict, 'not_evaluated');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live native parser failures remain provider-invoked red receipts', () => {
  const cases = [
    { name: 'malformed', output: ['not-json'], code: 'native_parse_invalid' },
    { name: 'reroute', output: [{ type: 'thread.started' }, { type: 'turn.started' }, { type: 'reroute' }, { type: 'turn.completed' }], code: 'provider_reroute' },
    { name: 'nonzero', output: [{ type: 'thread.started' }, { type: 'turn.started' }, { type: 'turn.completed' }], exitCode: 9, code: 'provider_nonzero' },
  ];
  for (const item of cases) {
    const fixture = liveFixture(item);
    try {
      const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
      assert.notEqual(result.status, 0, item.name);
      const receipt = parse(result.stdout);
      assert.equal(receipt.provider_invoked, true, item.name);
      assert.equal(receipt.workflow_verdict, 'not_evaluated', item.name);
      assert.equal(receipt.terminal.failure_code, item.code, item.name);
      assert.equal(receipt.terminal.status, 'failed', item.name);
      assert.equal(receipt.terminal.receipt_count, 1, item.name);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('synthetic native matrix accepts only complete Codex, Claude, and OpenCode evidence', () => {
  const codex = [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1' },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item_id: 'item-1' },
    { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' },
  ].map(JSON.stringify).join('\n');
  assert.equal(LIVE.liveParseCodex(codex, 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']).identity, 'requested-model-accepted');

  const claude = [
    { type: 'system', subtype: 'init', session_id: 'session-1' },
    { type: 'assistant', session_id: 'session-1', message: { model: 'claude-sonnet-5' } },
    { type: 'result', session_id: 'session-1', modelUsage: { 'claude-sonnet-5': { inputTokens: 1 } } },
  ].map(JSON.stringify).join('\n');
  assert.equal(LIVE.liveParseClaude(claude, 'claude-sonnet-5').identity, 'served-model-matched');

  const opencode = [
    { type: 'step_start', sessionID: 'session-1', part: { id: 'part-1', messageID: 'assistant-1', sessionID: 'session-1' } },
    { type: 'text', sessionID: 'session-1', part: { id: 'part-2', messageID: 'assistant-1', sessionID: 'session-1', text: 'done' } },
    { type: 'step_finish', sessionID: 'session-1', part: { id: 'part-3', messageID: 'assistant-1', sessionID: 'session-1', reason: 'stop' } },
  ].map(JSON.stringify).join('\n');
  const parsed = LIVE.liveParseOpenCode(opencode, 'openai/gpt-5.6-luna');
  assert.equal(parsed.identity, 'pending-sanitized-export');
  const exported = LIVE.liveParseOpenCodeExport(JSON.stringify({ info: { id: 'session-1' }, messages: [
    { info: { sessionID: 'session-1', id: 'user-1', role: 'user' }, parts: [] },
    { info: { sessionID: 'session-1', id: 'assistant-1', role: 'assistant', parentID: 'user-1', providerID: 'openai', modelID: 'gpt-5.6-luna' }, parts: [] },
  ] }, null, 2), parsed);
  assert.equal(exported.identity, 'served-model-matched');
  assert.throws(() => LIVE.liveParseCodex(JSON.stringify({ type: 'turn.completed' }), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /Codex output lacks/);
  assert.throws(() => LIVE.liveParseCodex([
    { type: 'thread.started', thread_id: 'thread-1' }, { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' }, { type: 'reroute' }, { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' },
  ].map(JSON.stringify).join('\n'), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /reroute/);
  assert.throws(() => LIVE.liveParseCodex([
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started' },
    { type: 'item.started', item: { id: 'item-1' } },
    { type: 'item.completed', item: { id: 'item-2' } },
    { type: 'turn.completed' },
  ].map(JSON.stringify).join('\n'), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /paired|lifecycle/);
  assert.throws(() => LIVE.liveParseClaude(JSON.stringify({ type: 'result', session_id: 'wrong' }), 'claude-sonnet-5'), /Claude output lacks/);
  assert.throws(() => LIVE.liveParseClaude([
    { type: 'system', subtype: 'init', session_id: 'session-1' }, { type: 'assistant', session_id: 'session-2', message: { model: 'claude-sonnet-5' } }, { type: 'result', session_id: 'session-1', modelUsage: { 'claude-sonnet-5': {} } },
  ].map(JSON.stringify).join('\n'), 'claude-sonnet-5'), /session/);
  assert.throws(() => LIVE.liveParseClaude([
    { type: 'system', subtype: 'init', session_id: 'session-1' }, { type: 'assistant', session_id: 'session-1', message: { model: 'wrong-model' } }, { type: 'result', session_id: 'session-1', modelUsage: { 'wrong-model': {} } },
  ].map(JSON.stringify).join('\n'), 'claude-sonnet-5'), /model/);
  assert.throws(() => LIVE.liveParseOpenCodeExport(JSON.stringify({ info: { id: 'session-1' }, messages: [
    { info: { sessionID: 'session-1', id: 'user-1', role: 'user' } },
    { info: { sessionID: 'session-1', id: 'assistant-1', role: 'assistant', parentID: 'other', providerID: 'openai', modelID: 'gpt-5.6-luna' } },
  ] }), parsed), /ancestry/);
  assert.throws(() => LIVE.liveParseOpenCode([
    { type: 'step_start', sessionID: 'session-1', part: { messageID: 'assistant-1' } },
    { type: 'error', sessionID: 'session-1', part: { messageID: 'assistant-1' } },
  ].map(JSON.stringify).join('\n'), 'openai/gpt-5.6-luna'), /error/);
});

test('OpenCode executable fixture requires the separate sanitized export invocation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-opencode-export-'));
  const stub = path.join(root, 'provider.cjs');
  try {
    const runOutput = [
      { type: 'step_start', sessionID: 'session-1', part: { id: 'part-1', messageID: 'assistant-1', sessionID: 'session-1' } },
      { type: 'step_finish', sessionID: 'session-1', part: { id: 'part-2', messageID: 'assistant-1', sessionID: 'session-1' } },
    ].map(JSON.stringify).join('\n') + '\n';
    const exportOutput = JSON.stringify({ info: { id: 'session-1' }, messages: [
      { info: { id: 'user-1', sessionID: 'session-1', role: 'user' } },
      { info: { id: 'assistant-1', sessionID: 'session-1', role: 'assistant', parentID: 'user-1', providerID: 'openai', modelID: 'gpt-5.6-luna' } },
    ] }, null, 2);
    fs.writeFileSync(stub, `process.stdout.write(process.argv.includes('export') ? ${JSON.stringify(exportOutput)} : ${JSON.stringify(runOutput)});\n`);
    const descriptor = { command: process.execPath, prefix: [stub], shell: false };
    const nativeRun = LIVE.realAgentRunProvider(descriptor, ['run', '--format', 'json'], { cwd: root, env: process.env });
    const native = LIVE.liveParseOpenCode(nativeRun.stdout, 'openai/gpt-5.6-luna');
    const exportArgv = ['export', native.session_id, '--sanitize'];
    const nativeExport = LIVE.realAgentRunProvider(descriptor, exportArgv, { cwd: root, env: process.env });
    assert.deepEqual(exportArgv, ['export', 'session-1', '--sanitize']);
    assert.equal(LIVE.liveParseOpenCodeExport(nativeExport.stdout, native).identity, 'served-model-matched');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('live run rejects a pending Docusaurus binding before provider resolution', () => {
  const fixture = liveFixture();
  try {
    const result = runWithEnv(['--run', 'docusaurus-browser-codex', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, false);
    assert.equal(receipt.terminal.failure_code, 'calibration_pending');
    assert.equal(fs.existsSync(fixture.receiptFile), true);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live run rejects duplicate or unknown flags before provider resolution and preserves one receipt', () => {
  const fixture = liveFixture();
  try {
    for (const extra of [['--unknown'], ['--run', 'core-treesnap-codex-1']]) {
      const receipt = path.join(fixture.root, `${extra.length}.json`);
      const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', receipt, ...extra], fixture.env);
      assert.notEqual(result.status, 0);
      const output = parse(result.stdout);
      assert.equal(output.provider_invoked, false);
      assert.equal(output.workflow_verdict, 'not_evaluated');
      assert.equal(output.terminal.receipt_count, 1);
      assert.equal(fs.existsSync(receipt), true);
      fs.rmSync(receipt, { force: true });
    }
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live admission rejects frozen artifact, member, entry, source, runtime, and config drift before provider execution', () => {
  const cases = [
    ['candidate artifact', (revision) => { revision.candidate.artifact_sha256 = '0'.repeat(64); }, 'candidate_artifact_hash_mismatch', false],
    ['member ledger', (revision) => { revision.candidate.members[0].sha256 = '0'.repeat(64); }, 'candidate_member_mismatch', false],
    ['entry hash', (revision) => { revision.candidate.entry.sha256 = '0'.repeat(64); }, 'candidate_entry_mismatch', false],
    ['source hash', (revision) => { revision.candidate.source_hashes['package/package.json'] = '0'.repeat(64); }, 'candidate_source_mismatch', false],
    ['duplicate member ledger', (revision) => { revision.candidate.members.push({ ...revision.candidate.members[0] }); }, 'candidate_members_duplicate', false],
    ['runtime executable pin', (revision) => { revision.runtimes.codex.executable_sha256 = '0'.repeat(64); }, 'runtime_pin_mismatch', false],
    ['runtime version output pin', (revision) => { revision.runtimes.codex.version_sha256 = '0'.repeat(64); }, 'runtime_version_mismatch', true],
    ['runtime config bytes', (revision, fixture) => { fs.writeFileSync(fixture.configFile, '{"fixture":false}\n'); }, 'runtime_pin_mismatch', false],
  ];
  for (const [name, mutate, code, invoked] of cases) {
    const fixture = liveFixture();
    try {
      const revision = JSON.parse(fs.readFileSync(fixture.revisionFile, 'utf8'));
      mutate(revision, fixture);
      fs.writeFileSync(fixture.revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
      const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
      assert.notEqual(result.status, 0, name);
      const receipt = parse(result.stdout);
      assert.equal(receipt.provider_invoked, invoked, name);
      assert.equal(receipt.workflow_verdict, 'not_evaluated', name);
      assert.equal(receipt.terminal.failure_code, code, name);
      assert.equal(receipt.terminal.receipt_count, 1, name);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
});

test('live tar reader rejects checksum corruption and bytes after the exact end marker', () => {
  const fixture = liveFixture();
  const checksumFile = path.join(fixture.root, 'bad-checksum.tar');
  const trailingFile = path.join(fixture.root, 'trailing.tar');
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(fixture.artifact));
    const badHeader = Buffer.from(raw);
    badHeader[0] ^= 1;
    fs.writeFileSync(checksumFile, badHeader);
    assert.throws(() => LIVE.liveTarEntries(checksumFile), /checksum/);
    fs.writeFileSync(trailingFile, Buffer.concat([raw, Buffer.from([1])]));
    assert.throws(() => LIVE.liveTarEntries(trailingFile), /exactly two zero tar blocks|trailing/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live artifact consumption rechecks the frozen hash and rejects duplicate tar members', () => {
  const fixture = liveFixture();
  const duplicate = path.join(fixture.root, 'duplicate.tar');
  const destination = path.join(fixture.root, 'candidate');
  try {
    const revision = LIVE.liveCanonicalRevision(fixture.revisionFile);
    const artifact = fs.readFileSync(fixture.artifact);
    artifact[4] ^= 1;
    fs.writeFileSync(fixture.artifact, artifact);
    assert.throws(() => LIVE.liveBootstrapArtifact(revision, destination), /changed after revision validation/);
    const packed = cp.spawnSync('tar', ['-cf', duplicate, '-C', fixture.source, 'package/bin/gsdd.mjs', 'package/bin/gsdd.mjs'], { encoding: 'utf8', windowsHide: true });
    assert.equal(packed.status, 0, packed.stderr);
    assert.throws(() => LIVE.liveTarEntries(duplicate), /duplicated/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live receipt is exclusive and never overwrites an existing artifact', () => {
  const fixture = liveFixture();
  try {
    const original = '{"owner":"existing"}\n';
    fs.writeFileSync(fixture.receiptFile, original);
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, false);
    assert.equal(receipt.terminal.failure_code, 'receipt_exists');
    assert.equal(fs.readFileSync(fixture.receiptFile, 'utf8'), original);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live provider resolution is direct-only on Windows and preserves exact role argv/budgets', () => {
  const fixture = liveFixture();
  try {
    const descriptor = LIVE.realAgentResolveProvider('codex', { command: 'codex' }, fixture.env, { platform: 'win32', whereEntries: [fixture.shim] });
    assert.equal(descriptor.shell, false);
    assert.equal(descriptor.source_kind, 'cmd-shim');
    assert.equal(descriptor.target_path, fixture.providerTarget);
    assert.equal(LIVE.realAgentResolveProvider('codex', { command: 'codex' }, fixture.env, { platform: 'win32', whereEntries: [path.join(fixture.root, 'wrong.cmd')] }), null);
    const argv = LIVE.realAgentInvocationArgv('codex', 'C:\\isolated\\candidate', 'prompt', 'plan-check', { model: 'gpt-5.6-luna', reasoning: 'high' });
    assert.deepEqual(argv.slice(0, 2), ['exec', '--ephemeral']);
    assert.deepEqual(argv.slice(-2), ['C:\\isolated\\candidate', 'prompt']);
    assert.ok(argv.includes('-m') && argv[argv.indexOf('-m') + 1] === 'gpt-5.6-luna');
    assert.throws(() => LIVE.realAgentRunProvider({ command: 'codex.cmd', prefix: [], shell: true }, [], { cwd: fixture.root, env: fixture.env }), /directly spawnable/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('direct synthetic provider timeout is observable without retry or fallback', () => {
  const fixture = liveFixture({ sleepMs: 250 });
  try {
    const descriptor = LIVE.realAgentResolveProvider('codex', { command: 'codex' }, fixture.env, { platform: 'win32', whereEntries: [fixture.shim] });
    const result = LIVE.realAgentRunProvider(descriptor, ['noop'], { cwd: fixture.root, env: fixture.env, timeout: 10 });
    assert.equal(result.timed_out, true);
    assert.equal(result.error.code, 'ETIMEDOUT');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('live failures preserve provider invocation evidence for output caps, network markers, and secret redaction', () => {
  const cases = [
    { name: 'raw cap', fixture: () => liveFixture({ output: ['x'.repeat(80)] }), mutate: (revision) => { revision.raw_output_limit_bytes = 16; }, code: 'raw_output_cap' },
    { name: 'retained cap', fixture: () => liveFixture(), mutate: (revision) => { revision.retained_event_limit_bytes = 1; }, code: 'retained_event_cap' },
    { name: 'network marker', fixture: () => liveFixture({ output: ['PHASE16_NETWORK_BLOCKED'] }), mutate: () => {}, code: 'network_violation' },
  ];
  for (const item of cases) {
    const fixture = item.fixture();
    try {
      const revision = JSON.parse(fs.readFileSync(fixture.revisionFile, 'utf8'));
      item.mutate(revision);
      fs.writeFileSync(fixture.revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
      const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
      assert.notEqual(result.status, 0, item.name);
      const receipt = parse(result.stdout);
      assert.equal(receipt.provider_invoked, true, item.name);
      assert.equal(receipt.terminal.failure_code, item.code, item.name);
      assert.equal(receipt.roles.length, 1, item.name);
      assert.ok(receipt.roles[0].invocation.argv.length > 0, item.name);
      assert.ok(receipt.roles[0].output.stdout_sha256, item.name);
      assert.equal(receipt.workflow_verdict, 'not_evaluated', item.name);
    } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
  }
  const secret = 'fixture-secret-value-should-not-retain';
  const fixture = liveFixture({ secretValue: secret });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.ok(receipt.roles.every((role) => role.invocation.secret_env_names.includes('PHASE16_TEST_SECRET')));
    assert.ok(!JSON.stringify(receipt).includes(secret));
    assert.ok(!JSON.stringify(receipt).includes('PHASE16_TEST_SECRET='));
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('offline calibration contract admits five cases and keeps Docusaurus pending', () => {
  const result = runCalibration(['--check', '--cases', CALIBRATION_CASES]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.provider_invoked, false);
  assert.equal(receipt.browser_invoked, false);
  assert.equal(receipt.terminal.status, 'passed');
  assert.equal(receipt.matrix.cases, 5);
  assert.equal(receipt.matrix.calibrated_cases, 5);
  assert.equal(receipt.matrix.calibrated_bindings, 20);
  assert.equal(receipt.matrix.pending_bindings, 1);
  assert.equal(receipt.matrix.pending_cases, 1);
  assert.deepEqual(receipt.terminal.pending_cases, ['docusaurus-browser']);
  assert.ok(receipt.cases.filter((item) => item.admission === 'admitted-core' || item.admission === 'admitted-auxiliary').every((item) => item.status === 'ready'));
  assert.ok(receipt.cases.filter((item) => item.admission === 'pending').every((item) => item.status === 'pending'));
});

test('offline calibration executes all five admitted native controls twice', () => {
  const result = runCalibration(['--all', '--repeat', '2', '--cases', CALIBRATION_CASES]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.provider_invoked, false);
  assert.equal(receipt.browser_invoked, false);
  assert.equal(receipt.terminal.status, 'passed');
  assert.equal(receipt.matrix.cases, 5);
  assert.equal(receipt.matrix.calibrated_bindings, 20);
  assert.equal(receipt.matrix.repetitions, 2);
  assert.equal(receipt.terminal.message, 'all admitted native red/green/red controls passed twice');
  assert.ok(receipt.cases.every((item) => item.repetitions === 2 && item.status === 'calibrated'));
});

test('offline calibration reports the requested repetition count', () => {
  const result = runCalibration(['--case', 'treesnap-greenfield', '--repeat', '1', '--cases', CALIBRATION_CASES]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.terminal.status, 'passed');
  assert.equal(receipt.terminal.message, 'all admitted native red/green/red controls passed once');
  assert.equal(receipt.matrix.repetitions, 1);
  assert.deepEqual(receipt.cases.map((item) => item.repetitions), [1]);
});

test('offline calibration rejects tampered pins before executing an oracle', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-tamper-'));
  try {
    const mutations = [
      (data) => { data.cases.find((item) => item.id === 'chi-bodyless-charset').variants[0].sha256 = '0'.repeat(64); },
      (data) => { data.cases.find((item) => item.id === 'treesnap-greenfield').oracle.path = 'missing/oracle.py'; },
      (data) => { data.cases.find((item) => item.id === 'chi-bodyless-charset').source.candidate_commit = '0'.repeat(40); },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const tampered = path.join(tempRoot, `cases-${index}.json`);
      const data = JSON.parse(fs.readFileSync(CALIBRATION_CASES, 'utf8'));
      mutate(data);
      fs.writeFileSync(tampered, JSON.stringify(data, null, 2));
      const result = runCalibration(['--check', '--cases', tampered]);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      const receipt = parse(result.stdout);
       assert.equal(receipt.terminal.status, 'failed');
       assert.notEqual(receipt.terminal.failure_code, 'calibration_input_missing');
    }
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});

test('check is provider-free and validates the new campaign', () => {
  const result = run(['--check', '--campaign', CAMPAIGN]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.terminal.status, 'passed');
  assert.equal(receipt.provider_invoked, false);
  assert.equal(receipt.matrix.bindings, 21);
  assert.equal(receipt.matrix.core, 18);
  assert.equal(receipt.matrix.auxiliary, 3);
  assert.equal(receipt.matrix.calibrated, 20);
  assert.equal(receipt.matrix.pending, 1);
  assert.equal(receipt.critical_witnesses.length, 10);
});

test('dry-run constructs one binding and cleans its isolated root without providers', () => {
  const receiptPath = path.join(os.tmpdir(), `workspine-phase16-05-test-${process.pid}.json`);
  try {
    const result = run(['--dry-run', '--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--receipt', receiptPath]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = parse(result.stdout);
    assert.equal(receipt.terminal.status, 'passed');
    assert.equal(receipt.provider_invoked, false);
    assert.equal(receipt.run_id, 'core-treesnap-codex-1');
    assert.equal(receipt.cleanup.removed, true);
    assert.equal(fs.existsSync(receiptPath), true);
  } finally { fs.rmSync(receiptPath, { force: true }); }
});

test('historical 16-04A scenario bytes remain exact and are rejected as live authority', () => {
  assert.equal(sha(HISTORICAL), HISTORICAL_SHA256);
  const result = run(['--check', '--campaign', HISTORICAL]);
  assert.notEqual(result.status, 0);
  const receipt = parse(result.stdout);
  assert.equal(receipt.terminal.failure_code, 'historical_campaign_rejected');
});

test('proof owns no live provider lane', () => {
  const source = fs.readFileSync(PROOF, 'utf8');
  assert.doesNotMatch(source, /realAgent|REAL_AGENT|--real-agent|provider resolution|provider_invoked/i);
  assert.match(fs.readFileSync(EVAL, 'utf8'), /realAgentResolveProvider/);
});

test('simulation emits and re-grades one bounded provider-free audit pack', () => {
  const receiptPath = path.join(os.tmpdir(), `workspine-phase16-sim-${process.pid}.json`);
  try {
    const result = run(['--simulate', 'success', '--campaign', CAMPAIGN, '--receipt', receiptPath]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = parse(result.stdout);
    assert.equal(receipt.mode, 'simulate');
    assert.equal(receipt.provider_invoked, false);
    assert.equal(receipt.terminal.receipt_count, 1);
    assert.equal(receipt.audit_pack.deterministic_grader.status, 'passed');
    assert.equal(receipt.audit_pack.advisory_judge.after, 'deterministic-grader');
    const reread = run(['--verify-pack', receiptPath, '--campaign', CAMPAIGN]);
    assert.equal(reread.status, 0, reread.stderr);
    assert.equal(parse(reread.stdout).deterministic, 'passed');
  } finally { fs.rmSync(receiptPath, { force: true }); }
});

test('all 21 simulations use only applicable witnesses', () => {
  const campaign = JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8'));
  const freshRuns = new Set(campaign.bindings.filter((binding) => binding.critical_witnesses.includes('fresh-pause-resume')).map((binding) => binding.run_id));
  for (const binding of campaign.bindings) {
    const receiptPath = path.join(os.tmpdir(), `workspine-phase16-all-${process.pid}-${binding.run_id}.json`);
    try {
      const result = run(['--simulate', 'success', '--run', binding.run_id, '--campaign', CAMPAIGN, '--receipt', receiptPath]);
      assert.equal(result.status, 0, `${binding.run_id}: ${result.stderr}`);
      const receipt = parse(result.stdout);
      assert.equal(receipt.provider_invoked, false);
      assert.equal(receipt.audit_pack.deterministic_grader.checks.some((check) => check.id === 'fresh-pause-resume'), freshRuns.has(binding.run_id));
      const reread = run(['--verify-pack', receiptPath, '--campaign', CAMPAIGN]);
      assert.equal(reread.status, 0, `${binding.run_id} re-grade: ${reread.stderr}`);
    } finally { fs.rmSync(receiptPath, { force: true }); }
  }
});

test('removed auxiliary IDs are rejected as non-authoritative', () => {
  const removed = [
    'owner-scripted-pause-resume', 'owner-scripted-verify',
    'packed-readme-claude', 'packed-readme-opencode',
    'docusaurus-browser-claude', 'docusaurus-browser-opencode',
  ];
  for (const runId of removed) {
    const receiptPath = path.join(os.tmpdir(), `workspine-phase16-removed-${process.pid}-${runId}.json`);
    try {
      const result = run(['--simulate', 'success', '--run', runId, '--campaign', CAMPAIGN, '--receipt', receiptPath]);
      assert.notEqual(result.status, 0, runId);
      assert.equal(parse(result.stdout).terminal.failure_code, 'run_unknown', runId);
      assert.equal(fs.existsSync(receiptPath), false, runId);
    } finally { fs.rmSync(receiptPath, { force: true }); }
  }
});

test('audit pack rejects forged verifier, escaped paths, and lifecycle disorder', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-core-schema-'));
  const source = path.join(temporary, 'source.json');
  const file = path.join(temporary, 'bad.json');
  try {
    const generated = run(['--simulate', 'success', '--campaign', CAMPAIGN, '--receipt', source]);
    assert.equal(generated.status, 0, generated.stderr);
    const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
    receipt.audit_pack.verifier.candidate_sha256 = 'forged';
    receipt.audit_pack.events[0].realpath = '../outside';
    receipt.audit_pack.lifecycle.transitions.reverse();
    fs.writeFileSync(file, JSON.stringify(receipt));
    const result = run(['--verify-pack', file, '--campaign', CAMPAIGN]);
    assert.notEqual(result.status, 0);
    assert.match(parse(result.stdout).terminal.failure_code, /path_escape|event_order_invalid|lifecycle_disorder|verifier_contradiction/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('brownfield pause/resume cannot be replaced by a recomputed superficial grader hash', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-pause-resume-'));
  const source = path.join(temporary, 'source.json');
  const file = path.join(temporary, 'tampered.json');
  try {
    const generated = run(['--simulate', 'success', '--run', 'core-brownfield-plan-codex-1', '--campaign', CAMPAIGN, '--receipt', source]);
    assert.equal(generated.status, 0, generated.stderr);
    const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
    receipt.audit_pack.lifecycle.pause_resume = null;
    const grader = receipt.audit_pack.deterministic_grader;
    const graderBody = { mode: grader.mode, status: grader.status, checks: grader.checks, score: grader.score, maximum: grader.maximum, sequence: grader.sequence };
    grader.output_sha256 = stableHash(graderBody);
    fs.writeFileSync(file, JSON.stringify(receipt));
    const result = run(['--verify-pack', file, '--campaign', CAMPAIGN]);
    assert.notEqual(result.status, 0);
    assert.equal(parse(result.stdout).terminal.failure_code, 'pause_resume_invalid');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('audit pack binds campaign, binding, provider argv, skills, resume IDs, and one receipt', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-binding-contract-'));
  const source = path.join(temporary, 'source.json');
  try {
    const generated = run(['--simulate', 'success', '--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--receipt', source]);
    assert.equal(generated.status, 0, generated.stderr);
    const base = JSON.parse(fs.readFileSync(source, 'utf8'));
    const cases = [
      ['campaign hash tamper', (receipt) => { receipt.campaign.sha256 = 'tampered'; }, /campaign_contradiction/],
      ['cross-binding relabel replay', (receipt) => { receipt.run_id = 'core-treesnap-codex-2'; }, /binding_contradiction/],
      ['provider model tamper', (receipt) => { receipt.provider.model = 'wrong-model'; }, /provider_contradiction/],
      ['provider argv tamper', (receipt) => { receipt.audit_pack.events.find((event) => event.event === 'invocation').argv[1] = 'wrong-model'; }, /provider_contradiction/],
      ['provider completion runtime tamper', (receipt) => { receipt.audit_pack.events.find((event) => event.event === 'completed').runtime = 'claude'; }, /provider_contradiction/],
      ['arbitrary generated skill hash', (receipt) => { receipt.audit_pack.generated_skills[0].stable_hash = 'arbitrary'; }, /skill_witness_contradiction/],
      ['duplicate terminal receipt', (receipt) => { receipt.terminal_receipts = [receipt.terminal]; }, /receipt_schema_invalid/],
    ];
    for (const [label, mutate, expected] of cases) {
      const file = path.join(temporary, `${label.replaceAll(' ', '-')}.json`);
      const receipt = structuredClone(base);
      mutate(receipt);
      fs.writeFileSync(file, JSON.stringify(receipt));
      const result = run(['--verify-pack', file, '--campaign', CAMPAIGN]);
      assert.notEqual(result.status, 0, label);
      assert.match(parse(result.stdout).terminal.failure_code, expected, label);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('disconnected pause IDs fail even when a superficial continuity hash is recomputed', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-resume-contract-'));
  const source = path.join(temporary, 'source.json');
  const file = path.join(temporary, 'tampered.json');
  try {
    const generated = run(['--simulate', 'success', '--run', 'core-brownfield-plan-codex-1', '--campaign', CAMPAIGN, '--receipt', source]);
    assert.equal(generated.status, 0, generated.stderr);
    const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
    const evidence = receipt.audit_pack.lifecycle.pause_resume;
    evidence.pause_context_id = 'disconnected-context';
    const basis = { binding_fingerprint: receipt.binding_fingerprint, pause_context_id: evidence.pause_context_id, resumed_context_id: evidence.resumed_context_id, pause_process_id: evidence.pause_process_id, resumed_process_id: evidence.resumed_process_id, pause_session_id: evidence.pause_session_id, resumed_session_id: evidence.resumed_session_id };
    evidence.continuity_hash = stableHash(basis);
    fs.writeFileSync(file, JSON.stringify(receipt));
    const result = run(['--verify-pack', file, '--campaign', CAMPAIGN]);
    assert.notEqual(result.status, 0);
    assert.equal(parse(result.stdout).terminal.failure_code, 'pause_resume_invalid');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
