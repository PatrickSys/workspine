'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const zlib = require('node:zlib');
const http = require('node:http');
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
function runWithEnv(argv, env) {
  const values = [...argv];
  if (values.includes('--campaign-revision') && !values.includes('--handoff')) {
    const receipt = values[values.indexOf('--receipt') + 1];
    values.push('--handoff', path.join(path.dirname(receipt), 'handoff.json'));
  }
  return cp.spawnSync(process.execPath, [EVAL, ...values], { cwd: REPO, env, encoding: 'utf8', windowsHide: true });
}

function cleanupLiveFixture(fixture, { receiptFiles = [], runIds = [] } = {}) {
  const receipts = [...new Set([fixture.receiptFile, ...receiptFiles])];
  const campaignRunIds = runIds.length ? runIds : JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8')).bindings.map((binding) => binding.run_id);
  for (const receiptFile of receipts) for (const runId of campaignRunIds) {
    fs.rmSync(LIVE.liveRetainedRoot(receiptFile, runId), { recursive: true, force: true });
  }
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

// A small local-only provider fixture. It is intentionally outside the
// checkout and is never used by the normal campaign tests.
function liveFixture({ output, exitCode = 0, runtime = 'codex', sleepMs = 0, secretValue = null, marker = false, networkKind = null, tamperAbort = false } = {}) {
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
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"workspine","version":"1.0.0","bin":{"gsdd":"bin/gsdd.mjs"}}\n');
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
    { type: 'item.started', thread_id: 'thread-fixture', turn_id: 'turn-fixture', item: { id: 'item-fixture', type: 'command_execution' } },
    { type: 'item.completed', thread_id: 'thread-fixture', turn_id: 'turn-fixture', item: { id: 'item-fixture', type: 'command_execution' } },
    { type: 'turn.completed', thread_id: 'thread-fixture', turn_id: 'turn-fixture' },
  ];
  const encodedOutput = lines.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') + '\n';
  const markerCode = marker ? "process.stderr.write('PHASE16_NETWORK_BLOCKED\\n');" : '';
  const abortTamperCode = tamperAbort ? "try { process.abort = () => {}; } catch {} try { delete process.abort; } catch {} try { Object.defineProperty(process, 'abort', { value: () => {}, writable: true, configurable: true }); } catch {}" : '';
  const networkCode = networkKind === 'net.connect' ? "require('node:net').connect();" : networkKind === 'dns.lookup' ? "require('node:dns').lookup('example.invalid', () => {});" : networkKind === 'dns.promises.lookup' ? "require('node:dns').promises.lookup('example.invalid');" : networkKind === 'fetch' ? "globalThis.fetch('https://example.invalid');" : '';
  fs.writeFileSync(providerTarget, `if (process.argv.includes('--version')) { process.stdout.write(${JSON.stringify(`${version}\n`)}); process.exitCode=0; } else if (${Number(sleepMs)} > 0) { setTimeout(() => { process.stdout.write(${JSON.stringify(encodedOutput)}); process.exitCode=${exitCode}; }, ${Number(sleepMs)}); } else { const index = process.env.PHASE16_PROCESS_INDEX || '0'; const fs = require('node:fs'); ${markerCode} ${abortTamperCode} ${networkCode} if (process.argv.join(' ').includes('packed-readme')) { const cp = require('node:child_process'); const install = cp.spawnSync(process.execPath, [process.env.PHASE16_NPM_CLI, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-save', process.env.PHASE16_PACKED_ARTIFACT], { cwd: process.env.PHASE16_WORKSPACE_ROOT, env: process.env, encoding: 'utf8' }); if (install.status !== 0) { process.stderr.write(install.stderr || 'packed install failed'); process.exitCode = install.status || 1; } } const output = ${JSON.stringify(encodedOutput)}.replaceAll('thread-fixture', 'thread-fixture-' + index).replaceAll('turn-fixture', 'turn-fixture-' + index).replaceAll('item-fixture', 'item-fixture-' + index); if (index === '1' && process.argv.join(' ').includes('brownfield-plan')) { fs.mkdirSync('.work', { recursive: true }); fs.writeFileSync('.work/.continue-here.md', '# Current task\\nBounded brownfield task.\\n\\n## Evidence\\nPlan paused with frozen inputs.\\n\\n## Next action\\nResume process B and execute only the approved plan.\\n', { flag: 'w' }); } process.stdout.write(output); process.exitCode=${exitCode}; }\n`);
  const command = runtime === 'claude' ? 'claude' : 'codex';
  const shim = path.join(providerBin, `${command}.cmd`);
  fs.writeFileSync(shim, `@echo off\r\n"%~dp0\\${targetRelative.replaceAll('/', '\\')}" %*\r\n`);
  const artifact = path.join(root, 'candidate.tgz');
  const packed = cp.spawnSync('tar', ['-czf', artifact, '-C', source, 'package'], { encoding: 'utf8', windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr);
  const inputRoot = path.join(root, 'input-bundle');
  fs.mkdirSync(path.join(inputRoot, 'project', 'src'), { recursive: true });
  fs.mkdirSync(path.join(inputRoot, 'owner'), { recursive: true });
  fs.writeFileSync(path.join(inputRoot, 'project', 'src', 'app.js'), 'export const consumerInput = true;\n');
  fs.writeFileSync(path.join(inputRoot, 'owner', 'TASK.md'), '# Owner task\nChange only the declared consumer input.\n');
  fs.writeFileSync(path.join(inputRoot, 'owner', 'BRIEF.md'), '# Owner brief\nA bounded first-run consumer task.\n');
  fs.writeFileSync(path.join(inputRoot, 'owner', 'ANSWER.md'), '# Owner answer\nApprove the bounded plan only.\n');
  const inputBundle = path.join(root, 'consumer-input.tgz');
  const inputPacked = cp.spawnSync('tar', ['-czf', inputBundle, '-C', inputRoot, 'project', 'owner'], { encoding: 'utf8', windowsHide: true });
  assert.equal(inputPacked.status, 0, inputPacked.stderr);
  const inputMembers = ['project/src/app.js', 'owner/TASK.md', 'owner/BRIEF.md', 'owner/ANSWER.md'].map((memberPath) => ({ path: memberPath, sha256: bytesHash(fs.readFileSync(path.join(inputRoot, ...memberPath.split('/')))) }));
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
  const gitProbe = cp.spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], { encoding: 'utf8', windowsHide: true });
  const gitPath = String(gitProbe.stdout || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  const npmPath = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const toolchain = { node: { path: process.execPath, sha256: bytesHash(fs.readFileSync(process.execPath)) }, npm: { path: npmPath, sha256: bytesHash(fs.readFileSync(npmPath)) }, git: { path: gitPath, sha256: bytesHash(fs.readFileSync(gitPath)) } };
  const revision = {
    schema_version: 1, contract: 'phase16-live-campaign-revision.v1', revision_id: `fixture-${process.pid}`,
    candidate: { commit: '0123456789012345678901234567890123456789', artifact_path: artifact, artifact_sha256: bytesHash(fs.readFileSync(artifact)), members, entry: { path: entryPath, sha256: sourceHashes[entryPath] }, source_hashes: sourceHashes }, consumer_input_bundle: { path: inputBundle, sha256: bytesHash(fs.readFileSync(inputBundle)), members: inputMembers, source_path: 'project/src/app.js', task_path: 'owner/TASK.md', brief_path: 'owner/BRIEF.md', owner_answer_path: 'owner/ANSWER.md' }, toolchain, path_allowlist: [providerBin, path.dirname(process.execPath), path.dirname(npmPath), path.dirname(gitPath)],
    runtimes, raw_output_limit_bytes: 65536, retained_event_limit_bytes: 65536, auth_config_files: [{ path: authFile, sha256: bytesHash(fs.readFileSync(authFile)), destination: 'fixture-auth.json' }], secret_env: secretValue ? [{ name: 'PHASE16_TEST_SECRET', sha256: bytesHash(Buffer.from(secretValue)) }] : [],
  };
  const revisionFile = path.join(root, 'revision.json');
  fs.writeFileSync(revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
  return { root, source, revisionFile, receiptFile: path.join(root, 'receipt.json'), configFile, authFile, providerTarget, shim, artifact, inputMembers, env: { ...process.env, PATH: `${providerBin}${path.delimiter}${process.env.PATH || ''}`, ...(secretValue ? { PHASE16_TEST_SECRET: secretValue } : {}) }, runtime };
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
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'docusaurus-browser-codex').required_skills, ['work-new-project', 'work-plan', 'work-execute', 'work-verify']);
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

test('campaign declares natural process accounting and retained auxiliary routes', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8')).process_contract, { journey_processes: 27, version_probes: 21, opencode_exports: 8 });
  assert.deepEqual(LIVE.bindingFlow({ kind: 'core', journey_id: 'brownfield-plan', flow: ['setup', 'health', 'brownfield-plan', 'pause', 'fresh-resume', 'execute', 'verify', 'progress'] }), ['setup', 'health', 'brownfield-plan', 'pause', 'fresh-resume', 'execute', 'verify', 'progress']);
  assert.deepEqual(LIVE.bindingFlow({ kind: 'packed-readme' }), ['install', 'setup', 'health', 'update', 'rerun']);
  assert.deepEqual(LIVE.bindingFlow({ kind: 'docusaurus-browser' }), ['init-auto', 'health', 'new-project', 'plan', 'execute', 'verify', 'audit']);
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
    assert.equal(receipt.terminal.status, 'provider_complete');
    assert.deepEqual(receipt.cleanup, { attempted: false, removed: false });
    assert.equal(receipt.processes.length, 1);
    assert.equal(receipt.process_count, 1);
    assert.equal(receipt.journey.process_count, 1);
    assert.equal(receipt.processes[0].terminal.status, 'completed');
    assert.ok(receipt.processes[0].invocation.config_files.some((item) => item.path.endsWith('/fixture-auth.json')));
    assert.equal(receipt.preparation.input_bundle.source, '<CONSUMER_ROOT>/inputs/project/src/app.js');
    const expectedInputHashes = Object.fromEntries(fixture.inputMembers.map((item) => [item.path, item.sha256]));
    assert.deepEqual(receipt.preparation.input_bundle.member_hashes, expectedInputHashes);
    assert.equal(receipt.preparation.input_bundle.source_sha256, expectedInputHashes['project/src/app.js']);
    assert.equal(receipt.preparation.input_bundle.task_sha256, expectedInputHashes['owner/TASK.md']);
    assert.equal(receipt.preparation.input_bundle.brief_sha256, expectedInputHashes['owner/BRIEF.md']);
    assert.equal(receipt.preparation.input_bundle.owner_answer, null);
    assert.deepEqual(JSON.parse(JSON.stringify(receipt.preparation.input_bundle)).member_hashes, expectedInputHashes);
    assert.match(receipt.processes[0].invocation.argv.join(' '), /inputs[\\/]owner[\\/]TASK\.md/);
    assert.match(receipt.processes[0].invocation.argv.join(' '), /node_modules[\\/]workspine[\\/]bin[\\/]gsdd\.mjs/);
    const retainedRoot = LIVE.liveRetainedRoot(fixture.receiptFile, 'core-treesnap-codex-1');
    assert.equal(fs.existsSync(retainedRoot), true);
    assert.equal(path.relative(fixture.root, retainedRoot).startsWith('..'), true);
    assert.equal(fs.existsSync(path.join(retainedRoot, '.git')), false);
    assert.equal(fs.existsSync(path.join(retainedRoot, '.work')), false);
    assert.ok(!JSON.stringify(receipt).includes(retainedRoot));
    assert.equal(fs.existsSync(path.join(fixture.root, 'handoff.json')), true);
    assert.ok(!JSON.stringify(receipt).includes(process.env.USERPROFILE || '___owner_profile_not_set___'));
    assert.equal(receipt.provider.identity_claim, 'requested/native identity only');
    assert.equal(receipt.owner_authority.status, 'unchanged');
  } finally {
    cleanupLiveFixture(fixture);
  }
});

test('scripted-owner uses the frozen deterministic approval input and binds its hash', () => {
  const fixture = liveFixture();
  try {
    const result = runWithEnv(['--run', 'owner-scripted-plan-check', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    const expected = fixture.inputMembers.find((item) => item.path === 'owner/ANSWER.md').sha256;
    assert.equal(receipt.preparation.input_bundle.owner_answer, '<CONSUMER_ROOT>/inputs/owner/ANSWER.md');
    assert.equal(receipt.preparation.input_bundle.owner_answer_sha256, expected);
    assert.match(receipt.processes[0].invocation.argv.join(' '), /inputs[\\/]owner[\\/]ANSWER\.md/);
    assert.equal(JSON.parse(JSON.stringify(receipt.preparation.input_bundle)).owner_answer_sha256, expected);
  } finally { cleanupLiveFixture(fixture); }
});

test('live Claude binding captures native session, assistant model, and result linkage', () => {
  const fixture = liveFixture({ runtime: 'claude' });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-claude-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, true);
    assert.equal(receipt.provider.runtime_version, 'fixture-claude-1');
    assert.equal(receipt.processes.length, 1);
    assert.equal(receipt.processes[0].native.parser, 'claude-stream-json');
    assert.equal(receipt.processes[0].native.assistant_model, 'claude-sonnet-5');
    assert.equal(receipt.workflow_verdict, 'not_evaluated');
  } finally { cleanupLiveFixture(fixture); }
});

test('brownfield journey uses two fresh processes over one retained root and creates handoff', () => {
  const fixture = liveFixture();
  try {
    const result = runWithEnv(['--run', 'core-brownfield-plan-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.process_count, 2);
    assert.deepEqual(receipt.processes.map((item) => item.process_index), [1, 2]);
    assert.equal(new Set(receipt.processes.map((item) => item.native_identity)).size, 2);
    assert.ok(receipt.journey.checkpoint.bytes >= 64);
    assert.equal(receipt.cleanup.attempted, false);
    const retainedRoot = LIVE.liveRetainedRoot(fixture.receiptFile, 'core-brownfield-plan-codex-1');
    const handoff = JSON.parse(fs.readFileSync(path.join(fixture.root, 'handoff.json'), 'utf8'));
    assert.equal(handoff.state, 'handed_off');
    assert.equal(handoff.provider_receipt_sha256, sha(fixture.receiptFile).toLowerCase());
    assert.equal(handoff.root_exists, true);
    assert.equal(fs.existsSync(retainedRoot), true);
    assert.equal(path.relative(fixture.root, retainedRoot).startsWith('..'), true);
  } finally { cleanupLiveFixture(fixture); }
});

test('packed README journey owns installation while frozen inputs and task paths are visible', () => {
  const fixture = liveFixture();
  try {
    const result = runWithEnv(['--run', 'packed-readme-codex', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.preparation.install.mode, 'provider-owned-offline-frozen-artifact');
    assert.equal(receipt.processes[0].invocation.install_state.preexisting_cli, false);
    assert.equal(receipt.processes[0].invocation.install_state.reachable_after, true);
    assert.match(receipt.processes[0].invocation.argv.join(' '), /inputs[\\/]owner[\\/]TASK\.md/);
    assert.match(receipt.processes[0].invocation.argv.join(' '), /inputs[\\/]workspine\.tgz/);
  } finally { cleanupLiveFixture(fixture); }
});

test('consumer input bundle tamper is rejected before provider execution', () => {
  const fixture = liveFixture();
  try {
    const revision = JSON.parse(fs.readFileSync(fixture.revisionFile, 'utf8'));
    revision.consumer_input_bundle.sha256 = '0'.repeat(64);
    fs.writeFileSync(fixture.revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.ok(result.status !== 0 || result.signal, 'guarded network process must terminate abnormally');
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, false);
    assert.equal(receipt.terminal.failure_code, 'consumer_input_bundle_hash_mismatch');
    assert.equal(fs.existsSync(path.join(fixture.root, 'handoff.json')), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, 'handoff.json'), 'utf8')).state, 'failed');
    const retainedRoot = LIVE.liveRetainedRoot(fixture.receiptFile, 'core-treesnap-codex-1');
    assert.equal(fs.existsSync(retainedRoot), true);
    assert.ok(!JSON.stringify(receipt).includes(retainedRoot));
    assert.ok(!fs.readFileSync(path.join(fixture.root, 'handoff.json'), 'utf8').includes(retainedRoot));
  } finally { cleanupLiveFixture(fixture); }
});

test('consumer input member ledger tamper is rejected before provider execution', () => {
  const fixture = liveFixture();
  try {
    const revision = JSON.parse(fs.readFileSync(fixture.revisionFile, 'utf8'));
    revision.consumer_input_bundle.members.find((item) => item.path === 'owner/TASK.md').sha256 = '0'.repeat(64);
    fs.writeFileSync(fixture.revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, false);
    assert.equal(receipt.terminal.failure_code, 'consumer_input_bundle_member_mismatch');
    assert.equal(fs.existsSync(LIVE.liveRetainedRoot(fixture.receiptFile, 'core-treesnap-codex-1')), true);
  } finally { cleanupLiveFixture(fixture); }
});

test('pre-existing consumer roots are rejected without creating a handoff', () => {
  const fixture = liveFixture();
  const runRoot = LIVE.liveRetainedRoot(fixture.receiptFile, 'core-treesnap-codex-1');
  try {
    fs.mkdirSync(runRoot);
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    const receipt = parse(result.stdout);
    assert.equal(receipt.terminal.failure_code, 'workspace_exists');
    assert.equal(receipt.workspace.created_by_run, false);
    assert.equal(fs.existsSync(path.join(fixture.root, 'handoff.json')), false);
  } finally { cleanupLiveFixture(fixture); }
});

test('retained-root containment rejects enclosing authorities and receipt overlap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-containment-'));
  const sourceRoot = path.join(root, 'source');
  const enclosing = path.join(root, 'enclosing');
  const receipt = path.join(root, 'receipts');
  const consumerUnderAuthority = path.join(enclosing, 'consumer');
  const consumerUnderReceipt = path.join(receipt, 'consumer');
  const consumerWithLocalWork = path.join(root, 'local-consumer');
  try {
    fs.mkdirSync(path.join(enclosing, '.git'), { recursive: true });
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(path.join(receipt), { recursive: true });
    fs.mkdirSync(consumerUnderAuthority, { recursive: true });
    fs.mkdirSync(consumerUnderReceipt, { recursive: true });
    fs.mkdirSync(path.join(consumerWithLocalWork, '.work'), { recursive: true });
    assert.throws(() => LIVE.liveAssertRetainedRootIsolation(consumerUnderAuthority, { sourceRoot, receiptDirectory: receipt }), /repository or planning authority ancestor/);
    assert.throws(() => LIVE.liveAssertRetainedRootIsolation(consumerUnderReceipt, { sourceRoot, receiptDirectory: receipt }), /overlaps the receipt directory/);
    assert.doesNotThrow(() => LIVE.liveAssertRetainedRootIsolation(consumerWithLocalWork, { sourceRoot, receiptDirectory: receipt }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('owner authority snapshot detects byte changes without exposing paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-owner-'));
  try {
    for (const relative of ['.work/SPEC.md', '.work/ROADMAP.md', '.work/state.json']) {
      const file = path.join(root, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${relative}\n`);
    }
    const snapshot = LIVE.liveOwnerAuthoritySnapshot(root);
    assert.equal(LIVE.liveOwnerAuthorityStatus(snapshot, root).status, 'unchanged');
    fs.appendFileSync(path.join(root, '.work', 'SPEC.md'), 'mutated\n');
    const status = LIVE.liveOwnerAuthorityStatus(snapshot, root);
    assert.equal(status.status, 'changed');
    assert.deepEqual(status.changed, ['.work/SPEC.md']);
    assert.throws(() => LIVE.liveAssertOwnerAuthority(snapshot, root), /source owner authority changed/);
    assert.ok(!JSON.stringify(status).includes(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('retained-root reservation is atomic under two bounded concurrent attempts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-reservation-'));
  const target = path.join(root, 'retained');
  const script = "const fs=require('node:fs');try{fs.mkdirSync(process.argv[1]);process.stdout.write('reserved')}catch(error){process.stdout.write(error.code||'other')}";
  const reserve = () => new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, ['-e', script, target], { encoding: 'utf8', windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
  try {
    const results = await Promise.all([reserve(), reserve()]);
    assert.equal(results.filter((item) => item.output === 'reserved').length, 1);
    assert.equal(results.filter((item) => item.output === 'EEXIST').length, 1);
    assert.throws(() => LIVE.liveReserveRetainedRoot(target), /reuse an existing retained consumer workspace/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('handoff refuses unverified or re-invalidated isolation without writing a receipt', () => {
  const fixture = liveFixture();
  const campaign = JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8'));
  const binding = campaign.bindings.find((item) => item.run_id === 'core-treesnap-codex-1');
  const contract = { sha256: 'fixture-contract' };
  const root = path.join(fixture.root, 'invalid-consumer');
  const handoff = path.join(fixture.root, 'handoff-invalid.json');
  const receipt = {
    workspace: { retained: true, token: 'fixture-token', realpath_sha256: 'fixture-root-hash' },
    isolation: { verified: false },
    terminal: { status: 'failed', failure_code: 'fixture_failure' },
    binding_fingerprint: LIVE.bindingFingerprint(binding), run_id: binding.run_id,
    processes: [], toolchain: { hashes: {} }, journey: { checkpoint: null },
  };
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(fixture.receiptFile, `${JSON.stringify(receipt)}\n`);
    assert.throws(() => LIVE.liveBuildHandoff(contract, binding, fixture.receiptFile, handoff, receipt, root), /isolation was not verified/);
    assert.equal(fs.existsSync(handoff), false);
    receipt.isolation.verified = true;
    fs.writeFileSync(fixture.receiptFile, `${JSON.stringify(receipt)}\n`);
    const revalidatedHandoff = path.join(fixture.root, 'handoff-revalidated-invalid.json');
    assert.throws(() => LIVE.liveBuildHandoff(contract, binding, fixture.receiptFile, revalidatedHandoff, receipt, root), /overlaps the receipt directory/);
    assert.equal(fs.existsSync(revalidatedHandoff), false);
  } finally { cleanupLiveFixture(fixture); }
});

test('brownfield checkpoint accepts only substantive .work/.continue-here.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-checkpoint-'));
  try {
    fs.mkdirSync(path.join(root, '.work'), { recursive: true });
    fs.writeFileSync(path.join(root, '.work', 'state.json'), '{}\n');
    assert.throws(() => LIVE.liveCaptureCheckpoint(root), /did not leave/);
    fs.writeFileSync(path.join(root, '.work', '.continue-here.md'), '# Current task\nshort\n');
    assert.throws(() => LIVE.liveCaptureCheckpoint(root), /substantive/);
    fs.writeFileSync(path.join(root, '.work', '.continue-here.md'), '# Current task\nBounded task.\n\n## Evidence\nObserved.\n\n## Next action\nResume process B.\n');
    assert.ok(LIVE.liveCaptureCheckpoint(root).sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('provider and toolchain targets must be inside the declared PATH allowlist', () => {
  const fixture = liveFixture();
  try {
    const revision = JSON.parse(fs.readFileSync(fixture.revisionFile, 'utf8'));
    revision.path_allowlist = [path.dirname(process.execPath), path.dirname(revision.toolchain.npm.path), path.dirname(revision.toolchain.git.path)];
    fs.writeFileSync(fixture.revisionFile, `${JSON.stringify(revision, null, 2)}\n`);
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    assert.equal(parse(result.stdout).terminal.failure_code, 'path_allowlist_excludes_target');
  } finally { cleanupLiveFixture(fixture); }
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
  } finally { cleanupLiveFixture(fixture); }
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
    } finally { cleanupLiveFixture(fixture); }
  }
});

test('synthetic native matrix accepts only complete Codex, Claude, and OpenCode evidence', () => {
  const codex = [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-1', type: 'agent_message', text: 'Plan complete.' } },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'reasoning-1', type: 'reasoning', text: 'Bounded reasoning.' } },
    { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'command-1', type: 'command_execution', command: 'git status' } },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'command-1', type: 'command_execution', exit_code: 0 } },
    { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'todo-1', type: 'todo_list', items: [] } },
    { type: 'item.updated', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'todo-1', type: 'todo_list', items: [{ text: 'done' }] } },
    { type: 'item.updated', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'todo-1', type: 'todo_list', items: [{ text: 'done', completed: true }] } },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'todo-1', type: 'todo_list', items: [{ text: 'done', completed: true }] } },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'file-change-1', type: 'file_change', changes: [] } },
    { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' },
  ].map(JSON.stringify).join('\n');
  const parsedCodex = LIVE.liveParseCodex(codex, 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']);
  assert.equal(parsedCodex.identity, 'requested-model-accepted');
  assert.deepEqual(parsedCodex.item_kinds, ['agent_message', 'reasoning', 'command_execution', 'todo_list', 'file_change']);

  const codexEnvelope = (items) => [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    ...items,
    { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' },
  ].map(JSON.stringify).join('\n');
  for (const kind of ['agent_message', 'reasoning', 'file_change']) {
    const completionOnly = { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: `${kind}-completion`, type: kind } };
    const started = { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: `${kind}-paired`, type: kind } };
    const completed = { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: `${kind}-paired`, type: kind } };
    const updated = { type: 'item.updated', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: `${kind}-paired`, type: kind } };
    assert.equal(LIVE.liveParseCodex(codexEnvelope([completionOnly]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']).identity, 'requested-model-accepted');
    assert.equal(LIVE.liveParseCodex(codexEnvelope([started, completed]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']).identity, 'requested-model-accepted');
    assert.throws(() => LIVE.liveParseCodex(codexEnvelope([started]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /terminal item lifecycle is incomplete/);
    assert.throws(() => LIVE.liveParseCodex(codexEnvelope([started, updated, completed]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /open todo_list/);
  }
  const terminalStart = { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-2', type: 'agent_message' } };
  const terminalComplete = { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-2', type: 'agent_message', text: 'Completed.' } };
  assert.equal(LIVE.liveParseCodex(codexEnvelope([terminalStart, terminalComplete]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']).identity, 'requested-model-accepted');
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([terminalStart]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /terminal item lifecycle is incomplete/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([terminalComplete, terminalStart]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /duplicated or follows completion/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.updated', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-2', type: 'agent_message' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /open todo_list/);
  const commandStart = { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'command-1', type: 'command_execution' } };
  const commandComplete = { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'command-1', type: 'command_execution' } };
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.completed', item: { id: 'unknown-1', type: 'unknown_kind' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /unknown item kind/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([commandComplete]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /orphaned/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([commandStart, commandComplete, commandComplete]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /duplicated/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([commandStart]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /incomplete/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.delta', item: { id: 'message-1', type: 'agent_message' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /unknown event/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.updated', item: { id: 'todo-1', type: 'todo_list' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /open todo_list/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.started', item: { id: 'todo-1', type: 'todo_list' } }, { type: 'item.completed', item: { id: 'todo-1', type: 'todo_list' } }, { type: 'item.updated', item: { id: 'todo-1', type: 'todo_list' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /open todo_list/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ ...commandStart, item: { id: 'command-1', type: 'command' } }, { ...commandComplete, item: { id: 'command-1', type: 'command' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /unknown item kind/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'error', message: 'ordinary failure' }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /native error/);
  assert.equal(LIVE.liveParseCodex(codexEnvelope([{ type: 'item.completed', item: { id: 'error-1', type: 'error', message: 'ordinary failure' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']).identity, 'requested-model-accepted');
  assert.equal(LIVE.liveParseCodex(codexEnvelope([{ type: 'item.completed', item: { id: 'error-2', type: 'error', message: 'redirected to fallback' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']).identity, 'requested-model-accepted');
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'turn.failed', message: 'turn failed' }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /native error/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.completed', item: { type: 'agent_message' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /item id/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-1', type: 'agent_message', thread_id: 'thread-2', turn_id: 'turn-2' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /incoherent/);
  assert.throws(() => LIVE.liveParseCodex(codexEnvelope([{ type: 'item.completed', thread_id: 'thread-2', turn_id: 'turn-2', item: { id: 'message-1', type: 'agent_message' } }]), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /not linked/);
  assert.throws(() => LIVE.liveParseCodex([
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'message-1', type: 'agent_message' } },
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' },
  ].map(JSON.stringify).join('\n'), 'gpt-5.6-luna', ['exec', '-m', 'gpt-5.6-luna']), /outside the turn/);
  assert.throws(() => LIVE.liveParseCodex(codex, 'gpt-5.6-luna', ['exec']), /model flag/);
  assert.throws(() => LIVE.liveParseCodex(codex, 'gpt-5.6-luna', ['exec', '-m', 'wrong-model']), /requested model/);

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
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    { type: 'item.started', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'item-1', type: 'command_execution' } },
    { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'item-2', type: 'command_execution' } },
    { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' },
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

test('Codex completion-only diagnostic errors are nonfatal, but terminal signals and usage remain strict', () => {
  const envelope = (items, turn = { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1', usage: { input_tokens: 3, output_tokens: 2 } }) => [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.started', thread_id: 'thread-1', turn_id: 'turn-1' },
    ...items,
    ...(turn ? [turn] : []),
  ].map(JSON.stringify).join('\n');
  const argv = ['exec', '-m', 'gpt-5.6-luna'];
  const diagnostic = { type: 'item.completed', thread_id: 'thread-1', turn_id: 'turn-1', item: { id: 'error-1', type: 'error', message: 'redirected to fallback' } };

  const parsed = LIVE.liveParseCodex(envelope([diagnostic]), 'gpt-5.6-luna', argv, { requireUsage: true });
  assert.deepEqual(parsed.usage, { input_tokens: 3, output_tokens: 2, total_tokens: 5 });

  for (const type of ['error', 'reroute', 'redirect', 'turn.failed']) {
    assert.throws(() => LIVE.liveParseCodex(envelope([diagnostic, { type, message: 'ordinary failure' }]), 'gpt-5.6-luna', argv, { requireUsage: true }), /native error|reroute/);
  }
  assert.throws(() => LIVE.liveParseCodex(envelope([diagnostic], null), 'gpt-5.6-luna', argv, { requireUsage: true }), /normal thread\/turn sequence/);
  assert.throws(() => LIVE.liveParseCodex(envelope([diagnostic], { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1', usage: { input_tokens: '3', output_tokens: 2 } }), 'gpt-5.6-luna', argv, { requireUsage: true }), /validated native usage/);
  assert.throws(() => LIVE.liveParseCodex(envelope([diagnostic], { type: 'turn.completed', thread_id: 'thread-1', turn_id: 'turn-1' }), 'gpt-5.6-luna', argv, { requireUsage: true }), /validated native usage/);
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
  } finally { cleanupLiveFixture(fixture); }
});

test('live run rejects duplicate or unknown flags before provider resolution and preserves one receipt', () => {
  const fixture = liveFixture();
  const alternateReceipts = [];
  try {
    for (const extra of [['--unknown'], ['--run', 'core-treesnap-codex-1']]) {
      const receipt = path.join(fixture.root, `${extra.length}.json`);
      alternateReceipts.push(receipt);
      const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', receipt, ...extra], fixture.env);
      assert.notEqual(result.status, 0);
      const output = parse(result.stdout);
      assert.equal(output.provider_invoked, false);
      assert.equal(output.workflow_verdict, 'not_evaluated');
      assert.equal(output.terminal.receipt_count, 1);
      assert.equal(fs.existsSync(receipt), true);
      fs.rmSync(receipt, { force: true });
    }
  } finally { cleanupLiveFixture(fixture, { receiptFiles: alternateReceipts }); }
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
    } finally { cleanupLiveFixture(fixture); }
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
  } finally { cleanupLiveFixture(fixture); }
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
  } finally { cleanupLiveFixture(fixture); }
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
  } finally { cleanupLiveFixture(fixture); }
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
  } finally { cleanupLiveFixture(fixture); }
});

test('direct synthetic provider timeout is observable without retry or fallback', () => {
  const fixture = liveFixture({ sleepMs: 250 });
  try {
    const descriptor = LIVE.realAgentResolveProvider('codex', { command: 'codex' }, fixture.env, { platform: 'win32', whereEntries: [fixture.shim] });
    const result = LIVE.realAgentRunProvider(descriptor, ['noop'], { cwd: fixture.root, env: fixture.env, timeout: 10 });
    assert.equal(result.timed_out, true);
    assert.equal(result.error.code, 'ETIMEDOUT');
  } finally { cleanupLiveFixture(fixture); }
});

test('live failures preserve provider invocation evidence for output caps and secret redaction', () => {
  const cases = [
    { name: 'raw cap', fixture: () => liveFixture({ output: ['x'.repeat(80)] }), mutate: (revision) => { revision.raw_output_limit_bytes = 16; }, code: 'raw_output_cap' },
    { name: 'retained cap', fixture: () => liveFixture(), mutate: (revision) => { revision.retained_event_limit_bytes = 1; }, code: 'retained_event_cap' },
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
      assert.equal(receipt.processes.length, 1, item.name);
      assert.ok(receipt.processes[0].invocation.argv.length > 0, item.name);
      assert.ok(receipt.processes[0].output.stdout_sha256, item.name);
      assert.equal(receipt.workflow_verdict, 'not_evaluated', item.name);
    } finally { cleanupLiveFixture(fixture); }
  }
  const secret = 'fixture-secret-value-should-not-retain';
  const fixture = liveFixture({ secretValue: secret });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.ok(receipt.processes.every((item) => item.invocation.secret_env_names.includes('PHASE16_TEST_SECRET')));
    assert.ok(!JSON.stringify(receipt).includes(secret));
    assert.ok(!JSON.stringify(receipt).includes('PHASE16_TEST_SECRET='));
  } finally { cleanupLiveFixture(fixture); }
});

test('provider-authored network marker without a guard sentinel is not a network violation', () => {
  const fixture = liveFixture({ marker: true });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = parse(result.stdout);
    assert.equal(receipt.terminal.status, 'provider_complete');
    assert.equal(receipt.processes[0].terminal.failure_code, null);
    assert.equal(receipt.processes[0].invocation.network_attempt, null);
  } finally { cleanupLiveFixture(fixture); }
});

test('an actual patched network call writes a process-bound sentinel and preserves its exact kind/hash', () => {
  const fixture = liveFixture({ networkKind: 'dns.lookup' });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    const receipt = parse(result.stdout);
    assert.equal(receipt.provider_invoked, true);
    assert.equal(receipt.workflow_verdict, 'not_evaluated');
    assert.equal(receipt.terminal.failure_code, 'network_violation');
    const attempt = receipt.processes[0].invocation.network_attempt;
    assert.equal(attempt.kind, 'dns.lookup');
    assert.match(attempt.sha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.terminal.evidence.network_attempt.kind, 'dns.lookup');
    assert.equal(receipt.terminal.evidence.network_attempt.sha256, attempt.sha256);
    assert.ok(!JSON.stringify(receipt).includes('example.invalid'));
    assert.ok(receipt.processes[0].invocation.signal || receipt.processes[0].invocation.status !== 0);
  } finally { cleanupLiveFixture(fixture); }
});

test('dns.promises calls are blocked with an exact validated sentinel and no external lookup', () => {
  const fixture = liveFixture({ networkKind: 'dns.promises.lookup' });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.ok(result.status !== 0 || result.signal);
    const receipt = parse(result.stdout);
    assert.equal(receipt.terminal.failure_code, 'network_violation');
    assert.equal(receipt.processes[0].invocation.network_attempt.kind, 'dns.promises.lookup');
    assert.match(receipt.processes[0].invocation.network_attempt.sha256, /^[0-9a-f]{64}$/);
  } finally { cleanupLiveFixture(fixture); }
});

test('provider cannot replace, delete, or reset captured process.abort before a blocked call', () => {
  const fixture = liveFixture({ networkKind: 'dns.lookup', tamperAbort: true });
  try {
    const result = runWithEnv(['--run', 'core-treesnap-codex-1', '--campaign', CAMPAIGN, '--campaign-revision', fixture.revisionFile, '--receipt', fixture.receiptFile], fixture.env);
    assert.notEqual(result.status, 0);
    const receipt = parse(result.stdout);
    assert.equal(receipt.terminal.failure_code, 'network_violation');
    const attempt = receipt.processes[0].invocation.network_attempt;
    assert.equal(attempt.kind, 'dns.lookup');
    assert.match(attempt.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(receipt.terminal.evidence.network_attempt, attempt);
    assert.ok(receipt.processes[0].invocation.signal || receipt.processes[0].invocation.status !== 0);
  } finally { cleanupLiveFixture(fixture); }
});

test('network sentinels reject malformed, forged, stale, wrong-process, and overwrite attempts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-network-sentinel-'));
  const file = path.join(root, 'attempt.json');
  const base = { schema: 'phase16-network-attempt-v1', nonce: 'a'.repeat(32), pid: 1234, role: 'process-1', kind: 'dns.lookup' };
  try {
    assert.equal(Object.hasOwn(LIVE, 'makeNetworkGuard'), false);
    const write = (value) => fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
    write({ ...base, extra: 'forged' });
    const operation = path.join(root, 'operation'); fs.mkdirSync(operation);
    assert.throws(() => LIVE.readNetworkAttemptSentinel(file, { nonce: base.nonce, role: base.role, pid: base.pid, runDirectory: root, operationDirectory: operation }), /escaped/);
    assert.throws(() => LIVE.readNetworkAttemptSentinel(file, { nonce: base.nonce, role: base.role, pid: base.pid, runDirectory: root, operationDirectory: root }), /unexpected fields/);
    write({ ...base, nonce: 'b'.repeat(32) });
    assert.throws(() => LIVE.readNetworkAttemptSentinel(file, { nonce: base.nonce, role: base.role, pid: base.pid, runDirectory: root, operationDirectory: root }), /stale/);
    write({ ...base, pid: 5678 });
    assert.throws(() => LIVE.readNetworkAttemptSentinel(file, { nonce: base.nonce, role: base.role, pid: base.pid, runDirectory: root, operationDirectory: root }), /stale/);
    write({ ...base, kind: 'dns.lookup', role: 'process-2' });
    assert.throws(() => LIVE.readNetworkAttemptSentinel(file, { nonce: base.nonce, role: base.role, pid: base.pid, runDirectory: root, operationDirectory: root }), /stale/);
    write(base);
    const first = fs.readFileSync(file);
    assert.throws(() => fs.writeFileSync(file, `${JSON.stringify({ ...base, kind: 'fetch' })}\n`, { flag: 'wx' }), /EEXIST/);
    assert.deepEqual(fs.readFileSync(file), first);
    fs.writeFileSync(file, '{malformed}\n');
    assert.throws(() => LIVE.readNetworkAttemptSentinel(file, { nonce: base.nonce, role: base.role, pid: base.pid, runDirectory: root, operationDirectory: root }), /valid JSON/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('liveMinimalEnv disables both update-awareness flags for providers and child Node processes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-env-'));
  try {
    const env = LIVE.liveMinimalEnv(root, 'fixture-revision', 'codex', [path.dirname(process.execPath)]);
    assert.equal(env.WORKSPINE_UPDATE_AWARENESS, '0');
    assert.equal(env.GSDD_UPDATE_AWARENESS, '0');
    const child = cp.spawnSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify({workspine:process.env.WORKSPINE_UPDATE_AWARENESS,gsdd:process.env.GSDD_UPDATE_AWARENESS}))"], { cwd: root, env, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { workspine: '0', gsdd: '0' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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

test('itsdangerous public case binds source root, canonical brownfield ownership, and isolated red-green-red controls', () => {
  const caseFile = path.join(REPO, 'tests', 'evals', 'cases', 'itsdangerous-fips-sha1.json');
  const data = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
  const checked = LIVE.caseValidate(data);
  assert.equal(checked.sourceRoot.archive_prefix, data.source.root_prefix);
  assert.equal(checked.sourceRoot.candidate_path, 'project/src/itsdangerous/signer.py');
  assert.deepEqual(checked.inputBundle.member_hashes, Object.fromEntries(data.input_bundle.members.map((item) => [item.path, item.sha256])));
  assert.deepEqual(data.controls.variants.map((item) => item.expected), ['red', 'green', 'red']);
  assert.equal(data.controls.mount_policy, 'never-live-agent-root');
  assert.deepEqual(data.brownfield.files.map((item) => [item.path, item.role]), [
    ['.work/brownfield-change/CHANGE.md', 'operational_authority'],
    ['.work/brownfield-change/HANDOFF.md', 'judgment_context'],
    ['.work/brownfield-change/VERIFICATION.md', 'closeout_evidence'],
  ]);
  const tamperedInput = JSON.parse(JSON.stringify(data));
  tamperedInput.input_bundle.members[0].content += 'tampered';
  assert.throws(() => LIVE.caseValidate(tamperedInput), (error) => error.code === 'case_input_bundle_hash_mismatch');
  const recomputedInput = JSON.parse(JSON.stringify(data));
  recomputedInput.input_bundle.members[0].content += 'tampered';
  recomputedInput.input_bundle.members[0].sha256 = bytesHash(Buffer.from(recomputedInput.input_bundle.members[0].content));
  assert.throws(() => LIVE.caseValidate(recomputedInput), (error) => error.code === 'case_input_bundle_pin_mismatch');
  const recomputedDependency = JSON.parse(JSON.stringify(data));
  recomputedDependency.dependencies.artifacts[0].version = '8.1.2';
  recomputedDependency.dependencies.artifacts[0].sha256 = bytesHash(Buffer.from('internally consistent cache bytes'));
  assert.throws(() => LIVE.caseValidate(recomputedDependency), (error) => error.code === 'case_dependency_pin_mismatch');
  const wrongRoot = JSON.parse(JSON.stringify(data));
  wrongRoot.source.source_root.candidate_path = 'other/src/itsdangerous/signer.py';
  assert.throws(() => LIVE.caseValidate(wrongRoot), (error) => error.code === 'case_source_root_mismatch');
  const coordinatedWrongRoot = JSON.parse(JSON.stringify(data));
  coordinatedWrongRoot.source.source_root.materialized_root = 'other';
  coordinatedWrongRoot.source.source_root.candidate_path = 'other/src/itsdangerous/signer.py';
  coordinatedWrongRoot.source.source_root.required_paths = ['other/src/itsdangerous/signer.py', 'other/tests'];
  coordinatedWrongRoot.input_bundle.source_root = 'other';
  coordinatedWrongRoot.task.allowed_paths = ['other/src/itsdangerous/signer.py'];
  assert.throws(() => LIVE.caseValidate(coordinatedWrongRoot), (error) => error.code === 'case_source_root_pin_mismatch');
  const privateMember = JSON.parse(JSON.stringify(data));
  privateMember.input_bundle.members[0].path = '.work/secret.md';
  privateMember.input_bundle.members[0].sha256 = bytesHash(Buffer.from(privateMember.input_bundle.members[0].content));
  assert.throws(() => LIVE.caseValidate(privateMember), (error) => error.code === 'case_input_private');
  const wrongArtifactRole = JSON.parse(JSON.stringify(data));
  wrongArtifactRole.brownfield.files[1].role = 'operational_authority';
  assert.throws(() => LIVE.caseValidate(wrongArtifactRole), (error) => error.code === 'case_brownfield_invalid');
  const liveControls = JSON.parse(JSON.stringify(data));
  liveControls.controls.mount_policy = 'live-agent-root';
  assert.throws(() => LIVE.caseValidate(liveControls), (error) => error.code === 'case_controls_invalid');
  const wrongControl = JSON.parse(JSON.stringify(data));
  wrongControl.controls.variants[2].expected = 'green';
  assert.throws(() => LIVE.caseValidate(wrongControl), (error) => error.code === 'case_controls_invalid');
  const fakeControlPin = JSON.parse(JSON.stringify(data));
  fakeControlPin.controls.variants[1].revision = '0123456789012345678901234567890123456789';
  fakeControlPin.controls.variants[1].candidate_sha256 = '0'.repeat(64);
  assert.throws(() => LIVE.caseValidate(fakeControlPin), (error) => error.code === 'case_controls_pin_mismatch');
  const fakeControlSource = JSON.parse(JSON.stringify(data));
  fakeControlSource.controls.variants[1].source = 'private-solution-source';
  assert.throws(() => LIVE.caseValidate(fakeControlSource), (error) => error.code === 'case_controls_invalid');
});

test('itsdangerous public case prepares and rechecks offline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-public-case-'));
  const sourceParent = path.join(root, 'source-parent');
  const prefix = 'fixture-itsdangerous';
  const sourceRoot = path.join(sourceParent, prefix);
  fs.mkdirSync(path.join(sourceRoot, 'src', 'itsdangerous'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'itsdangerous', 'signer.py'), 'class Signer: pass\n');
  fs.mkdirSync(path.join(sourceRoot, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'tests', 'test_signer.py'), 'def test_fixture_source(): pass\n');
  const archive = path.join(root, 'source.tar.gz');
  const packed = cp.spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', archive, '-C', sourceParent, prefix], { encoding: 'utf8', windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr);
  const archiveBytes = fs.readFileSync(archive);
  const sourceUrl = 'https://codeload.github.com/pallets/itsdangerous/tar.gz/93ae366874bbd4f69d90495c45b2cd336387496c';
  const dependencyUrl = 'https://files.pythonhosted.org/packages/4d/7e/c79cecfdb6aa85c6c2e3cf63afc56d0f165f24f5c66c03c695c4d9b84756/pytest-8.1.1-py3-none-any.whl';
  const dependencyBytes = Buffer.from('fixture dependency\n');
  const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'evals', 'cases', 'itsdangerous-fips-sha1.json'), 'utf8'));
  fixture.source.revision = '0123456789012345678901234567890123456789';
  fixture.source.archive_url = sourceUrl;
  fixture.source.archive_sha256 = bytesHash(archiveBytes);
  fixture.source.root_prefix = prefix;
  fixture.source.source_root.archive_prefix = prefix;
  fixture.source.source_root.candidate_path = `${fixture.source.source_root.materialized_root}/${fixture.source.candidate_path}`;
  fixture.acquisition.allowed_hosts = ['codeload.github.com', 'files.pythonhosted.org'];
  fixture.dependencies.artifacts = [{ name: 'pytest', version: '8.1.1', url: dependencyUrl, sha256: bytesHash(dependencyBytes) }];
  fixture.acquisition.allowed_urls = [sourceUrl, dependencyUrl];
  const caseFile = path.join(root, 'case.json');
  fs.writeFileSync(caseFile, JSON.stringify(fixture, null, 2));
  const cache = path.join(root, 'cache');
  const downloads = new Map([[sourceUrl, archiveBytes], [dependencyUrl, dependencyBytes]]);
  try {
    const prepared = await LIVE.preparePublicCase(caseFile, cache, { fixture: true, fetch: async (url) => downloads.get(url) });
    assert.equal(prepared.source_archive_sha256, bytesHash(archiveBytes));
    assert.ok(/^[a-f0-9]{64}$/.test(prepared.source_root_sha256));
    assert.equal(prepared.source_member_hashes.find((item) => item.path === 'src/itsdangerous/signer.py').sha256, prepared.source_candidate_sha256);
    assert.deepEqual(prepared.input_member_hashes, LIVE.caseValidate(fixture, { fixture: true }).inputBundle.member_hashes);
    const checked = LIVE.checkPublicCase(caseFile, cache, { fixture: true, offline: true });
    assert.equal(checked.terminal.status, 'passed');
    assert.equal(checked.network, 'offline');
    assert.deepEqual(fs.readdirSync(cache), [fixture.id]);
    const cachedCandidate = path.join(cache, fixture.id, 'source', 'src', 'itsdangerous', 'signer.py');
    const candidateBytes = fs.readFileSync(cachedCandidate);
    fs.appendFileSync(cachedCandidate, 'tampered');
    assert.throws(() => LIVE.checkPublicCase(caseFile, cache, { fixture: true, offline: true }), (error) => ['case_cache_mismatch', 'case_source_member_mismatch'].includes(error.code));
    fs.writeFileSync(cachedCandidate, candidateBytes);
    const dependencyDir = path.join(cache, fixture.id, 'dependencies');
    const dependencyFile = path.join(dependencyDir, 'pytest-8.1.1-py3-none-any.whl');
    const dependencyBytesOnDisk = fs.readFileSync(dependencyFile);
    fs.appendFileSync(dependencyFile, 'tampered');
    assert.throws(() => LIVE.checkPublicCase(caseFile, cache, { fixture: true, offline: true }), (error) => error.code === 'case_dependency_hash_mismatch');
    fs.writeFileSync(dependencyFile, dependencyBytesOnDisk);
    fs.writeFileSync(path.join(dependencyDir, 'unexpected.whl'), 'extra');
    assert.throws(() => LIVE.checkPublicCase(caseFile, cache, { fixture: true, offline: true }), (error) => error.code === 'case_dependency_set_mismatch');
    fs.rmSync(path.join(dependencyDir, 'unexpected.whl'));
    const preparedPath = path.join(cache, fixture.id, 'prepared.json');
    const preparedBytes = fs.readFileSync(preparedPath);
    const preparedTamper = JSON.parse(preparedBytes);
    preparedTamper.dependency_files[0].url = dependencyUrl.replace('/packages/', '/simple/');
    fs.writeFileSync(preparedPath, JSON.stringify(preparedTamper, null, 2));
    assert.throws(() => LIVE.checkPublicCase(caseFile, cache, { fixture: true, offline: true }), (error) => error.code === 'case_dependency_metadata_mismatch');
    fs.writeFileSync(preparedPath, preparedBytes);
    const tamperedAllowlist = JSON.parse(JSON.stringify(fixture));
    tamperedAllowlist.acquisition.allowed_urls = [sourceUrl];
    assert.throws(() => LIVE.caseValidate(tamperedAllowlist, { fixture: true }), (error) => error.code === 'case_acquisition_invalid');
    const unknownKey = JSON.parse(JSON.stringify(fixture));
    unknownKey.runtime.extra = true;
    assert.throws(() => LIVE.caseValidate(unknownKey, { fixture: true }), (error) => error.code === 'case_schema_invalid');
    const duplicateDependency = JSON.parse(JSON.stringify(fixture));
    duplicateDependency.dependencies.artifacts.push({ ...duplicateDependency.dependencies.artifacts[0] });
    duplicateDependency.acquisition.allowed_urls.push(dependencyUrl);
    assert.throws(() => LIVE.caseValidate(duplicateDependency, { fixture: true }), (error) => error.code === 'case_dependency_duplicate');
    const tamperedHash = JSON.parse(JSON.stringify(fixture));
    tamperedHash.source.archive_sha256 = '0'.repeat(64);
    const hashCaseFile = path.join(root, 'hash-case.json');
    fs.writeFileSync(hashCaseFile, JSON.stringify(tamperedHash));
    await assert.rejects(() => LIVE.preparePublicCase(hashCaseFile, path.join(root, 'hash-cache'), { fixture: true, fetch: async () => archiveBytes }), (error) => error.code === 'case_archive_hash_mismatch');
    assert.throws(() => LIVE.checkPublicCase(caseFile, path.join(root, 'missing-cache'), { fixture: true, offline: true }), (error) => error.code === 'case_cache_missing');
    const linkedCache = path.join(root, 'linked-cache');
    fs.symlinkSync(cache, linkedCache, 'junction');
    assert.throws(() => LIVE.checkPublicCase(caseFile, linkedCache, { fixture: true, offline: true }), (error) => error.code === 'case_cache_unsafe');
    const traversalTar = Buffer.alloc(1024);
    Buffer.from('../outside').copy(traversalTar, 0);
    Buffer.from('0000777\0').copy(traversalTar, 100);
    Buffer.from('0000000\0').copy(traversalTar, 108);
    Buffer.from('0000000\0').copy(traversalTar, 116);
    Buffer.from('00000000000\0').copy(traversalTar, 124);
    Buffer.from('00000000000\0').copy(traversalTar, 136);
    traversalTar[156] = 48;
    let traversalChecksum = 0; for (let index = 0; index < 512; index += 1) traversalChecksum += index >= 148 && index < 156 ? 32 : traversalTar[index];
    Buffer.from(`${traversalChecksum.toString(8).padStart(6, '0')}\0 `).copy(traversalTar, 148);
    assert.throws(() => LIVE.caseTarEntries(require('node:zlib').gzipSync(traversalTar)), (error) => error.code === 'case_archive_traversal');
    const unpacked = zlib.gunzipSync(archiveBytes);
    const badChecksum = Buffer.from(unpacked); badChecksum[0] ^= 1;
    assert.throws(() => LIVE.caseTarEntries(zlib.gzipSync(badChecksum)), (error) => error.code === 'case_archive_checksum_mismatch');
    assert.throws(() => LIVE.caseTarEntries(zlib.gzipSync(Buffer.concat([unpacked, Buffer.alloc(512, 1)]))), (error) => error.code === 'case_archive_trailing_data');
    assert.ok(LIVE.caseTarEntries(archiveBytes).some((entry) => entry.member.endsWith('/src/itsdangerous/signer.py')));
    const linkRoot = path.join(root, 'link-source', prefix);
    fs.mkdirSync(path.join(linkRoot, 'src', 'itsdangerous'), { recursive: true });
    fs.writeFileSync(path.join(linkRoot, 'src', 'itsdangerous', 'signer.py'), 'class Signer: pass\n');
    fs.symlinkSync('signer.py', path.join(linkRoot, 'src', 'itsdangerous', 'link.py'));
    const linkArchive = path.join(root, 'link.tar.gz');
    const linkPacked = cp.spawnSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', linkArchive, '-C', path.dirname(linkRoot), prefix], { encoding: 'utf8', windowsHide: true });
    assert.equal(linkPacked.status, 0, linkPacked.stderr);
    assert.throws(() => LIVE.caseTarEntries(fs.readFileSync(linkArchive)), (error) => error.code === 'case_archive_link_refused');
    const server = http.createServer((request, response) => {
      if (request.url === '/slow') return setTimeout(() => response.end('slow'), 100);
      response.end(Buffer.alloc(16, 7));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      await assert.rejects(() => LIVE.caseFetch(`http://127.0.0.1:${port}/slow`, { timeoutMs: 20 }), (error) => error.code === 'case_download_timeout');
      await assert.rejects(() => LIVE.caseFetch(`http://127.0.0.1:${port}/large`, { maxBytes: 8 }), (error) => error.code === 'case_download_too_large');
    } finally { await new Promise((resolve) => server.close(resolve)); }
    const publicText = fs.readFileSync(path.join(REPO, 'tests', 'evals', 'cases', 'itsdangerous-fips-sha1.json'), 'utf8') + fs.readFileSync(path.join(REPO, 'tests', 'evals', 'cases', 'itsdangerous-fips-sha1-oracle.py'), 'utf8');
    assert.doesNotMatch(publicText, /(?:gold(?:en)?|solution[_ -]?patch|private[_ -]?oracle|expected[_ -]?patch)/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('itsdangerous public case acquires the pinned codeload archive when network is enabled', { skip: !process.env.PHASE16_CASE_NETWORK }, () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-public-case-live-'));
  const caseFile = path.join(REPO, 'tests', 'evals', 'cases', 'itsdangerous-fips-sha1.json');
  try {
    const prepared = run(['--prepare-case', caseFile, '--cache', cache]);
    assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
    assert.deepEqual(parse(prepared.stdout).preparation.control_results.results.map((item) => [item.id, item.status]), [['baseline', 'fail'], ['reference', 'pass'], ['mutant', 'fail']]);
    const checked = run(['--check-case', caseFile, '--offline', '--cache', cache]);
    assert.equal(checked.status, 0, checked.stdout || checked.stderr);
    assert.equal(parse(checked.stdout).terminal.status, 'passed');
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
});
