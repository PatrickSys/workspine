const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  cleanup,
  createTempProject,
  runCliAsMain,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

const RECEIPT_FIELDS = [
  'schema_version', 'phase', 'task', 'requested_level', 'effective_level',
  'interactive', 'frontier_questions', 'agent_discretion_exemptions',
  'alignment', 'plan_check', 'execution', 'verification', 'claim_limit',
  'terminal_result', 'next_action',
];

describe('final rigor dial output contract', () => {
  const projects = [];
  afterEach(() => {
    while (projects.length > 0) cleanup(projects.pop());
  });

  async function show(level) {
    const cwd = createTempProject();
    projects.push(cwd);
    const init = await runCliAsMain(cwd, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(init.exitCode, 0, init.output);
    const set = await runCliAsMain(cwd, ['rigor', level]);
    assert.strictEqual(set.exitCode, 0, set.output);
    const result = await runCliAsMain(cwd, ['rigor', 'show']);
    assert.strictEqual(result.exitCode, 0, result.output);
    return JSON.parse(result.stdout);
  }

  test('low, medium, high, and max expose distinct production paths', async () => {
    const paths = [];
    for (const level of ['low', 'medium', 'high', 'max']) {
      const payload = await show(level);
      paths.push(payload.policy.path);
      assert.strictEqual(payload.requested_level, level);
      assert.strictEqual(payload.effective_level, level === 'max' ? 'high' : level);
      assert.deepStrictEqual(payload.effective_levels,
        level === 'max' ? { plan: 'high', execute: 'high', verify: 'high' } : { plan: level, execute: level, verify: level });
      assert.deepStrictEqual(payload.policy.receipt_fields, RECEIPT_FIELDS);
    }
    assert.strictEqual(new Set(paths).size, 4);
  });

  test('max policy is fail-closed for headless unresolved and zero-question paths', async () => {
    const payload = await show('max');
    assert.strictEqual(payload.policy.headless_missing_interaction, 'unresolved');
    assert.strictEqual(payload.policy.unknown_is_pass, false);
    assert.strictEqual(payload.policy.preview_limit, 2);
    assert.match(payload.policy.path, /frontier|alignment|preview|verification/);
    // The production contract distinguishes an unresolved interaction from an
    // answered question or sign-off; a fully specified request therefore has
    // no question record to emit, rather than an invented answered receipt.
    assert.ok(payload.policy.receipt_fields.includes('frontier_questions'));
    assert.ok(payload.policy.receipt_fields.includes('verification'));
  });

  test('per-step output applies an override only to that step frontier', async () => {
    const cwd = createTempProject();
    projects.push(cwd);
    const init = await runCliAsMain(cwd, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(init.exitCode, 0, init.output);
    const set = await runCliAsMain(cwd, ['rigor', 'execute', 'max']);
    assert.strictEqual(set.exitCode, 0, set.output);
    const result = await runCliAsMain(cwd, ['rigor', 'show']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const payload = JSON.parse(result.stdout);

    assert.strictEqual(payload.steps.plan.requested_level, 'medium');
    assert.strictEqual(payload.steps.plan.effective_level, 'medium');
    assert.strictEqual(payload.steps.plan.policy.path, 'research-plan-check');
    assert.strictEqual(payload.steps.execute.requested_level, 'max');
    assert.strictEqual(payload.steps.execute.effective_level, 'high');
    assert.strictEqual(payload.steps.execute.policy.path, 'frontier-alignment-preview-verification');
    assert.strictEqual(payload.steps.verify.requested_level, 'medium');
    assert.strictEqual(payload.steps.verify.effective_level, 'medium');
    assert.deepStrictEqual(payload.effective_levels, { plan: 'medium', execute: 'high', verify: 'medium' });
  });

  test('Agent discretion remains an explicit exemption in the production contract', async () => {
    const payload = await show('max');
    assert.ok(payload.policy.receipt_fields.includes('agent_discretion_exemptions'));
    assert.ok(payload.policy.receipt_fields.includes('claim_limit'));
    assert.ok(payload.policy.receipt_fields.includes('terminal_result'));
    assert.ok(payload.policy.receipt_fields.includes('next_action'));
  });

  test('deprecated rigor keys remain ignored no-ops', async () => {
    const cwd = createTempProject();
    projects.push(cwd);
    const init = await runCliAsMain(cwd, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(init.exitCode, 0, init.output);
    const configPath = path.join(cwd, '.work', 'config.json');
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.rigorProfile = 'max';
    config.workflow.showCode = true;
    config.workflow.askBeforeDecide = true;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const restore = setNonInteractiveStdin();
    try {
      const result = await runCliAsMain(cwd, ['rigor', 'show']);
      const payload = JSON.parse(result.stdout);
      assert.deepStrictEqual(payload.deprecatedNoOps, {
        showCode: 'ignored deprecated no-op',
        askBeforeDecide: 'ignored deprecated no-op',
      });
    } finally {
      restore();
    }
  });
});
