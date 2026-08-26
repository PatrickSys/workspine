'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const test = require('node:test');

const REPO = path.resolve(__dirname, '..', '..');
const EVAL = path.join(REPO, 'tests', 'evals', 'phase16-core-flows.cjs');
const CAMPAIGN = path.join(REPO, 'tests', 'evals', 'phase16-core-flows.json');
const PROOF = path.join(REPO, 'tests', 'proof', 'phase16-first-run.cjs');
const HISTORICAL = path.join(REPO, 'tests', 'evals', 'historical', 'phase16-04A-scenarios.json');
const HISTORICAL_SHA256 = 'D66601B028C92CB520011DFE9DC669190FD45F3AE435BC722D2AF395DDDA4504';

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function stableHash(value) { return crypto.createHash('sha256').update(stableStringify(value)).digest('hex'); }
function run(argv) { return cp.spawnSync(process.execPath, [EVAL, ...argv], { cwd: REPO, encoding: 'utf8', windowsHide: true }); }
function parse(stdout) { return JSON.parse(stdout); }

test('campaign has exactly three journeys and 27 bindings', () => {
  const campaign = JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8'));
  assert.equal(campaign.contract, 'phase16-core-flows.v2');
  assert.equal(campaign.journeys.length, 3);
  assert.equal(campaign.bindings.length, 27);
  const freshRuns = campaign.bindings.filter((binding) => binding.critical_witnesses.includes('fresh-pause-resume')).map((binding) => binding.run_id);
  assert.deepEqual(freshRuns, [
    'core-brownfield-plan-codex-1', 'core-brownfield-plan-codex-2', 'core-brownfield-plan-claude-1',
    'core-brownfield-plan-claude-2', 'core-brownfield-plan-opencode-1', 'core-brownfield-plan-opencode-2',
    'owner-scripted-pause-resume',
  ]);
  assert.ok(campaign.bindings.every((binding) => binding.critical_witnesses.length === (binding.required_skills.length > 0 ? 9 : 8) + (freshRuns.includes(binding.run_id) ? 1 : 0)));
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'core-treesnap-codex-1').required_skills, ['work-new-project', 'work-plan', 'work-execute', 'work-verify']);
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'core-brownfield-plan-codex-1').required_skills, ['work-plan', 'work-pause', 'work-resume', 'work-execute', 'work-verify', 'work-progress']);
  assert.deepEqual(campaign.bindings.find((binding) => binding.run_id === 'owner-scripted-pause-resume').required_skills, ['work-pause', 'work-resume', 'work-verify']);
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
  for (const kind of ['scripted-owner', 'packed-readme', 'docusaurus-browser']) assert.equal(campaign.bindings.filter((binding) => binding.kind === kind).length, 3);
});

test('check is provider-free and validates the new campaign', () => {
  const result = run(['--check', '--campaign', CAMPAIGN]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = parse(result.stdout);
  assert.equal(receipt.terminal.status, 'passed');
  assert.equal(receipt.provider_invoked, false);
  assert.equal(receipt.matrix.bindings, 27);
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

test('all 27 simulations use only applicable witnesses', () => {
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
