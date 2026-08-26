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
function run(argv) { return cp.spawnSync(process.execPath, [EVAL, ...argv], { cwd: REPO, encoding: 'utf8', windowsHide: true }); }
function parse(stdout) { return JSON.parse(stdout); }

test('campaign has exactly three journeys and 27 bindings', () => {
  const campaign = JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8'));
  assert.equal(campaign.contract, 'phase16-core-flows.v1');
  assert.equal(campaign.journeys.length, 3);
  assert.equal(campaign.bindings.length, 27);
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
  assert.equal(receipt.critical_witnesses, 'deferred-to-task-16-05-02');
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

test('schema rejects critical witnesses during the mechanical split', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-core-schema-'));
  const file = path.join(temporary, 'bad.json');
  try {
    const campaign = JSON.parse(fs.readFileSync(CAMPAIGN, 'utf8'));
    campaign.bindings[0].critical_witnesses = ['lifecycle'];
    fs.writeFileSync(file, JSON.stringify(campaign));
    const result = run(['--check', '--campaign', file]);
    assert.notEqual(result.status, 0);
    assert.equal(parse(result.stdout).terminal.failure_code, 'critical_witnesses_present');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
