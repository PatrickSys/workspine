const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { cleanup, createTempProject, runCliAsMain, readJson } = require('./gsdd.helpers.cjs');

let root;
const phase = '.work/phases/01-parallel-issues';
const plan = id => `${phase}/${id}-PLAN.md`;
const summary = id => `${phase}/${id}-SUMMARY.md`;
const report = id => `${phase}/${id}-VERIFICATION.md`;
const write = (name, content) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const bytes = name => fs.readFileSync(path.join(root, name));
const state = () => readJson(path.join(root, '.work/state.json'));
const transition = (target, id, flags = []) => runCliAsMain(root, [
  'lifecycle-transition', target, '--plan', plan(id), '--authority', 'workflow',
  ...flags, '--json', '--no-update-notice',
]);
async function ok(target, id, flags = []) {
  const result = await transition(target, id, flags);
  assert.equal(result.exitCode, 0, result.output);
  return JSON.parse(result.output);
}
async function approve(id) {
  const result = await runCliAsMain(root, [
    'lifecycle-transition', 'approve', '--plan', plan(id), '--authority', 'owner',
    '--approval-ref', `fixture-owner-review-${id}`, '--json', '--no-update-notice',
  ]);
  assert.equal(result.exitCode, 0, result.output);
}
async function refused(target, id, flags, code) {
  const before = bytes('.work/state.json');
  const result = await transition(target, id, flags);
  assert.equal(result.exitCode, 1, result.output);
  if (code) assert.equal(JSON.parse(result.output).error_code, code, result.output);
  assert.deepEqual(bytes('.work/state.json'), before);
}
async function executed(id = '01') {
  await ok('plan', id);
  await approve(id);
  await ok('execute', id);
  write(summary(id), '---\nstatus: complete\n---\n# Execution evidence\n');
  await ok('verify', id, ['--artifact', summary(id)]);
}
async function verified(status, id = '01') {
  await executed(id);
  write(report(id), `---\nstatus: ${status}\n---\n# Verification evidence\n`);
  await ok(status === 'passed' ? 'audit' : 'fix_gaps', id, ['--artifact', report(id)]);
}
const start = ['--start-new', '--reason', 'Start the independently scoped second plan; retain first-plan proof'];

beforeEach(async () => {
  root = createTempProject();
  const { ensureWorkStructure } = await import(pathToFileURL(path.join(__dirname, '../bin/lib/work-context.mjs')).href);
  ensureWorkStructure(root);
  write('.work/config.json', '{}\n');
  write('.work/SPEC.md', '# Parallel issues fixture\n');
  write('.work/ROADMAP.md', '# Roadmap\n- [-] **Phase 1: Parallel issues**\n');
  for (const id of ['01', '02']) write(plan(id), `---\nstatus: pending\nphase: 01-parallel-issues\nplan: ${id}\n---\n# Independent plan ${id}\n`);
});
afterEach(() => cleanup(root));

for (const status of ['human_needed', 'passed']) {
  test(`explicit handoff to a separate plan retains ${status} proof and requires fresh exact approval`, async () => {
    await verified(status);
    const previous = state().workflow;
    const retained = [plan('01'), summary('01'), report('01')].map(bytes);
    await refused('plan', '02', [], 'stale_state');
    const beforeWrongApproval = bytes('.work/state.json');
    const wrongApproval = await runCliAsMain(root, [
      'lifecycle-transition', 'approve', '--plan', plan('02'), '--authority', 'owner',
      '--approval-ref', 'fixture-second-review', '--json', '--no-update-notice',
    ]);
    assert.equal(wrongApproval.exitCode, 1, wrongApproval.output);
    assert.equal(JSON.parse(wrongApproval.output).error_code, 'stale_state');
    assert.deepEqual(bytes('.work/state.json'), beforeWrongApproval);

    const result = await ok('plan', '02', start);
    assert.equal(result.changed, true);
    const current = state().workflow;
    assert.equal(current.plan.path, plan('02'));
    assert.equal(current.plan.identity, plan('02'));
    assert.equal(current.plan.approved, false);
    assert.equal(current.plan.approved_sha256, undefined);
    assert.equal(current.approval_ref, null);
    for (const stage of ['execution', 'verification', 'audit', 'dogfood']) assert.deepEqual(current[stage], { status: 'not_started' });
    assert.deepEqual(current.plan_history.at(-1).workflow, previous);
    assert.deepEqual([plan('01'), summary('01'), report('01')].map(bytes), retained);
    await refused('execute', '02', [], 'not_approved');
    await approve('02');
    write(plan('02'), bytes(plan('02')).toString() + '\nChanged after approval\n');
    await refused('execute', '02', [], 'not_approved');
    await approve('02');
    await ok('execute', '02');
    await refused('execute', '01', [], 'not_approved');
    write(summary('02'), '---\nstatus: complete\n---\n# Second execution\n');
    await ok('verify', '02', ['--artifact', summary('02')]);
    write(report('02'), '---\nstatus: passed\n---\n# Second verification\n');
    await ok('audit', '02', ['--artifact', report('02')]);
    await refused('plan', '01', start, 'new_plan_not_allowed');
    assert.deepEqual([plan('01'), summary('01'), report('01')].map(bytes), retained);
    const routed = await runCliAsMain(root, ['next', '--json', '--no-update-notice']);
    assert.equal(routed.exitCode, 0, routed.output);
    assert.equal(JSON.parse(routed.output).continuity.posture.verification.value, 'passed');
  });
}

test('fresh verification reconciles gaps to human-needed and then passed without approving a human gate', async () => {
  await verified('gaps_found');
  const originalPlan = state().workflow.plan;
  write(report('01'), '---\nstatus: human_needed\n---\n# Browser proof still needs a human\n');
  const reconciled = await ok('fix_gaps', '01', ['--artifact', report('01')]);
  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.state.workflow.verification.status, 'human_needed');
  assert.deepEqual(reconciled.state.workflow.plan, originalPlan);
  const unchanged = bytes('.work/state.json');
  assert.equal((await ok('fix_gaps', '01', ['--artifact', report('01')])).changed, false);
  assert.deepEqual(bytes('.work/state.json'), unchanged);
  write(report('01'), '---\nstatus: passed\n---\n# Fresh passing evidence\n');
  await refused('fix_gaps', '01', ['--artifact', report('01')], 'gaps_not_recorded');
  const passed = await ok('audit', '01', ['--artifact', report('01')]);
  assert.equal(passed.changed, true);
  assert.equal(passed.state.workflow.verification.status, 'passed');
  assert.equal(passed.state.workflow.current_state, 'audit');
  assert.equal(passed.state.workflow.human_gate, undefined);
  assert.deepEqual(passed.state.workflow.plan, originalPlan);
});

test('a passing report cannot approve an explicit owner gate or reconcile unfinished execution', async () => {
  await verified('gaps_found');
  write(report('01'), '---\nstatus: passed\n---\n# Fresh report\n');
  const unfinished = state();
  unfinished.workflow.execution.status = 'in_progress';
  write('.work/state.json', JSON.stringify(unfinished));
  await refused('audit', '01', ['--artifact', report('01')], 'execution_incomplete');
  unfinished.workflow.execution.status = 'complete';
  const gate = { approved: false, question: 'Owner signoff is still required' };
  unfinished.workflow.human_gate = gate;
  write('.work/state.json', JSON.stringify(unfinished));
  const result = await ok('audit', '01', ['--artifact', report('01')]);
  assert.deepEqual(result.state.workflow.human_gate, gate);
});

test('new plan cannot discard in-progress execution, blocked work, mismatched identity or existing target evidence', async () => {
  await ok('plan', '01');
  await approve('01');
  await ok('execute', '01');
  await refused('plan', '02', start, 'new_plan_not_allowed');
  write(summary('01'), '---\nstatus: complete\n---\n# Execution\n');
  await ok('verify', '01', ['--artifact', summary('01')]);
  await refused('plan', '02', ['--start-new'], 'new_plan_not_allowed');
  const valid = state();
  for (const change of [
    s => { s.workflow.plan.identity = plan('02'); },
    s => { s.workflow.current_state = s.current_state = 'complete'; },
    s => { s.workflow.status = s.status = 'blocked'; },
    s => { s.workflow.human_gate = { approved: false, question: 'Owner decision pending' }; },
  ]) {
    const changed = structuredClone(valid);
    change(changed);
    write('.work/state.json', JSON.stringify(changed));
    await refused('plan', '02', start, 'new_plan_not_allowed');
  }
  write('.work/state.json', JSON.stringify(valid));
  write(summary('02'), '---\nstatus: complete\n---\n# Retained completed work\n');
  await refused('plan', '02', start, 'new_plan_not_allowed');
});

test('verification reconciliation rejects another chain and conflicting artifact identity', async () => {
  await verified('gaps_found');
  write(report('02'), '---\nstatus: human_needed\n---\n# Wrong chain\n');
  await refused('fix_gaps', '01', ['--artifact', report('02')], 'wrong_artifact_identity');
  const changed = state();
  changed.workflow.verification.identity = report('02');
  write('.work/state.json', JSON.stringify(changed));
  await refused('fix_gaps', '01', ['--artifact', report('01')], 'stale_state');
});
