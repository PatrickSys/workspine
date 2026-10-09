const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTempProject, cleanup, runCliAsMain } = require('./gsdd.helpers.cjs');

let root;
const work = () => path.join(root, '.work');
function write(name, value) {
  const file = path.join(work(), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
function snapshot() {
  return Object.fromEntries(['ROADMAP.md','state.json','.continue-here.md',
    'phases/11-parked/11-01-PLAN.md','phases/11-parked/11-01-SUMMARY.md',
    'phases/11-parked/11-01-VERIFICATION.md','phases/12-current/12-01-PLAN.md',
    'phases/12-current/12-01-SUMMARY.md','phases/16-done/16-01-SUMMARY.md'].map(name => {
    const p = path.join(work(), name);
    return [name, fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null];
  }));
}
function roadmap({ parked = true, detailParked = true, otherParked = false } = {}) {
  return [
    '# Roadmap',
    '- [ ] **Phase 11 (POST-RELAUNCH): Rigor dial final form** - '+(parked ? 'Parked by owner 2026-08-29 until real use.' : 'Regular future work.'),
    '- [ ] **Phase 12: Current allowed phase** - '+(otherParked ? 'Parked vehicles are unrelated commentary.' : 'Current work.'),
    '- [x] **Phase 16: Historically closed phase** - Closed before this task.',
    '',
    '## Phase Details',
    '### Phase 11: Rigor dial final form',
    '**Status**: [ ]'+(detailParked ? ' — PARKED by owner until relaunch.' : ''),
    '### Phase 12: Current allowed phase',
    '**Status**: [ ]',
    '### Phase 16: Historically closed phase',
    '**Status**: [x]',
    '',
    '## Historical narrative',
    'Phase 12 parked status was mentioned in a retrospective; this is not Phase 12 authority.',
    '<details>',
    '- [ ] **Phase 12: Archived parked copy** - Parked by owner in old release.',
    '### Phase 12: Archived parked copy',
    '**Status**: [ ] — PARKED by owner.',
    '</details>',
  ].join('\n')+'\n';
}
function phaseCheckpoint(phase) {
  return ['---','workflow: phase',`phase: ${phase}`,'timestamp: 2026-10-09T01:00:00.000Z',
    'runtime: other','---','<current_state>Captured current phase.</current_state>',
    '<completed_work>Selected source saved.</completed_work>',
    '<remaining_work>Resume only selected authority.</remaining_work>',
    '<decisions>No owner changes.</decisions>',
    '<blockers>None known.</blockers>',
    '<next_action>Follow selected current phase.</next_action>'].join('\n')+'\n';
}
const cmd = (...args) => runCliAsMain(root, [...args, '--json', '--no-update-notice']);

beforeEach(async () => {
  root = createTempProject();
  const module = await import(pathToFileURL(path.join(__dirname, '..', 'bin','lib','work-context.mjs')).href);
  module.ensureWorkStructure(root);
  write('ROADMAP.md', roadmap());
  write('SPEC.md', '# Valid bounded contract\n');
  write('MILESTONES.md', '# Historical milestone list\n');
  write('phases/11-parked/11-01-PLAN.md', '---\nstatus: approved\n---\n# Plan 11\n');
  write('phases/11-parked/11-01-SUMMARY.md', '# Retained candidate summary\n');
  write('phases/16-done/16-01-SUMMARY.md', '# Retained historical summary\n');
  write('phases/12-current/12-01-PLAN.md', '---\nstatus: approved\n---\n# Plan 12\n');
  write('phases/12-current/12-01-SUMMARY.md', '# Current summary\n');
});
afterEach(() => cleanup(root));

test('selected owner-PARKED Phase11 cannot receive verify grant or act as ordinary next phase', async () => {
  const before = snapshot();
  const refused = await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
  assert.equal(refused.exitCode, 1, refused.output);
  const result = JSON.parse(refused.output);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'owner_parked_phase');
  assert.deepEqual(snapshot(), before, 'refusal must preserve current source and state');
  const module = await import(pathToFileURL(path.join(__dirname, '..', 'bin','lib','lifecycle-state.mjs')).href);
  const lifecycle = module.evaluateLifecycleState({planningDir:work()});
  assert.equal(lifecycle.phases.find(phase => phase.number==='11').parked, true);
  assert.equal(lifecycle.phases.find(phase => phase.number==='11').status, 'not_started');
  assert.equal(lifecycle.nextPhase?.number, '12');
});

test('resume grant refuses only an explicitly checkpoint-selected parked phase', async () => {
  write('.continue-here.md', phaseCheckpoint('11-parked'));
  const before = snapshot();
  const refused = await cmd('lifecycle-preflight','resume');
  assert.equal(refused.exitCode, 1, refused.output);
  assert.equal(JSON.parse(refused.output).reason, 'owner_parked_phase');
  assert.deepEqual(snapshot(), before);
  write('.continue-here.md', phaseCheckpoint('12-current'));
  const valid = await cmd('lifecycle-preflight','resume');
  assert.equal(valid.exitCode, 0, valid.output);
  assert.equal(JSON.parse(valid.output).allowed, true);
  write('.continue-here.md', phaseCheckpoint('null'));
  const unbound = await cmd('lifecycle-preflight','resume');
  assert.equal(unbound.exitCode, 0, unbound.output);
});

test('historical closed summary and parked plan do not generate next=verify', async () => {
  fs.rmSync(path.join(work(),'phases','12-current','12-01-SUMMARY.md'));
  const before = snapshot();
  const next = await cmd('next');
  assert.equal(next.exitCode, 0, next.output);
  const body = JSON.parse(next.output);
  assert.notEqual(body.state, 'verify', 'historical completed summary and parked candidate must not request verification');
  assert.notEqual(body.next_command, 'work-verify');
  assert.deepEqual(snapshot(), before);
});

test('ordinary not_started summary and unrelated archived PARKED prose keep current verification grant', async () => {
  write('ROADMAP.md', roadmap({ parked: true, detailParked: true, otherParked: true }));
  const before = snapshot();
  const verify = await cmd('lifecycle-preflight','verify','12','--expects-mutation','phase-status');
  assert.equal(verify.exitCode, 0, verify.output);
  const next = await cmd('next');
  assert.equal(next.exitCode, 0, next.output);
  assert.equal(JSON.parse(next.output).state, 'verify');
  assert.deepEqual(snapshot(), before);
});

test('PARKED marker must be attached to the selected phase status grammar, not a roadmap-wide word', async () => {
  write('ROADMAP.md', roadmap({ parked:false, detailParked:false, otherParked:true }));
  const result = await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
  assert.equal(result.exitCode, 0, result.output);
  const preflight = JSON.parse(result.output);
  assert.equal(preflight.allowed, true);
  assert.equal(preflight.phase, '11');
});

test('a single current Phase Details owner-PARKED status refuses while overview remains ordinary not_started', async () => {
  write('ROADMAP.md',roadmap({parked:false,detailParked:true}));
  const before = snapshot();
  const result = await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
  assert.equal(result.exitCode,1,result.output);
  assert.equal(JSON.parse(result.output).reason,'owner_parked_phase');
  assert.deepEqual(snapshot(),before);
});

test('unrelated native milestone phase with same number is not the parked standard phase', async () => {
  write('milestone/MILESTONE.md', '# Distinct Workspine-native milestone\n');
  write('milestone/ROADMAP.md', '# Native roadmap\n- [-] **Phase 11: Native active work**\n');
  write('milestone/phases/11-native/11-PLAN.md', '# Native plan\n');
  write('milestone/phases/11-native/11-EXECUTE.md', '# Native execution\n');
  const result = await cmd('lifecycle-preflight','verify','milestone/phases/11-native',
    '--expects-mutation','phase-status');
  assert.equal(result.exitCode, 0, result.output);
  const preflight = JSON.parse(result.output);
  assert.equal(preflight.allowed, true);
  assert.equal(preflight.authority, 'work_milestone');
});

test('resume checkpoint naming a different same-number native phase is not the parked standard chain', async () => {
  write('milestone/MILESTONE.md', '# Distinct native milestone\n');
  write('milestone/ROADMAP.md', '# Native roadmap\n- [-] **Phase 11: Native active work**\n');
  write('milestone/phases/11-native/11-PLAN.md', '# Current independent plan\n');
  write('.continue-here.md', phaseCheckpoint('11-native'));
  const before = snapshot();
  const result = await cmd('lifecycle-preflight','resume');
  assert.equal(result.exitCode,0,result.output);
  assert.equal(JSON.parse(result.output).allowed,true);
  assert.deepEqual(snapshot(),before);
});

test('direct phase-status mutation cannot unpark the phase behind preflight', async () => {
  const before = snapshot();
  // phase-status is a mutating legacy command without --json support.
  const result = await runCliAsMain(root, ['phase-status','11','in_progress']);
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /owner_parked_phase/i);
  assert.deepEqual(snapshot(), before);
});

test('direct lifecycle verify transition cannot bypass the parked phase gate', async () => {
  const plan = '.work/phases/11-parked/11-01-PLAN.md';
  const summary = '.work/phases/11-parked/11-01-SUMMARY.md';
  write('ROADMAP.md', roadmap({parked:false,detailParked:false}));
  const planned = await cmd('lifecycle-transition','plan','--plan',plan,'--authority','workflow');
  assert.equal(planned.exitCode, 0, planned.output);
  const approved = await cmd('lifecycle-transition','approve','--plan',plan,'--authority','owner','--approval-ref','parked-fixture-owner');
  assert.equal(approved.exitCode, 0, approved.output);
  const executed = await cmd('lifecycle-transition','execute','--plan',plan,'--authority','workflow');
  assert.equal(executed.exitCode, 0, executed.output);
  write('phases/11-parked/11-01-SUMMARY.md','---\nstatus: complete\n---\n# Prior phase summary\n');
  write('ROADMAP.md', roadmap());
  const before = snapshot();
  const blocked = await cmd('lifecycle-transition','verify','--plan',plan,'--artifact',summary,'--authority','workflow');
  assert.equal(blocked.exitCode, 1, blocked.output);
  assert.equal(JSON.parse(blocked.output).error_code,'owner_parked_phase');
  assert.deepEqual(snapshot(),before);
});

for (const [target,verificationStatus] of [['audit','passed'],['next','passed'],['fix_gaps','gaps_found']]) {
  test(`direct ${target} transition cannot claim new lifecycle authority for owner-PARKED phase`, async () => {
    const plan = '.work/phases/11-parked/11-01-PLAN.md';
    const summary = '.work/phases/11-parked/11-01-SUMMARY.md';
    const verification = '.work/phases/11-parked/11-01-VERIFICATION.md';
    write('ROADMAP.md',roadmap({parked:false,detailParked:false}));
    for (const [verb,extra] of [
      ['plan',['--authority','workflow']],
      ['approve',['--authority','owner','--approval-ref','prior-owner-reference']],
      ['execute',['--authority','workflow']],
    ]) {
      const previous = await cmd('lifecycle-transition',verb,'--plan',plan,...extra);
      assert.equal(previous.exitCode,0,previous.output);
    }
    write('phases/11-parked/11-01-SUMMARY.md','---\nstatus: complete\n---\n# Previously executed\n');
    const verified = await cmd('lifecycle-transition','verify','--plan',plan,'--artifact',summary,'--authority','workflow');
    assert.equal(verified.exitCode,0,verified.output);
    write('phases/11-parked/11-01-VERIFICATION.md',`---\nstatus: ${verificationStatus}\n---\n# Prior proof\n`);
    write('ROADMAP.md',roadmap());
    const before = snapshot();
    const result = await cmd('lifecycle-transition',target,'--plan',plan,'--artifact',verification,'--authority','workflow');
    assert.equal(result.exitCode,1,result.output);
    assert.equal(JSON.parse(result.output).error_code,'owner_parked_phase');
    assert.deepEqual(snapshot(),before);
  });
}

for (const [name, open, close] of [
  ['tilde', '~~~md', '~~~'],
  ['backtick', String.fromCharCode(96).repeat(4)+'md', String.fromCharCode(96).repeat(4)],
]) {
  test(`fenced ${name} examples cannot supply current phase inventory, status or parking`, async () => {
    const body = [roadmap({parked:false,detailParked:false}), '## Examples', open,
      '- [ ] **Phase 21: Example only** - Parked by owner.',
      '### Phase 11: Example only', '**Status**: [ ] — PARKED by owner.',
      '<details>', String.fromCharCode(96).repeat(3), close].join('\n');
    write('ROADMAP.md',body);
    const before=snapshot();
    const result=await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
    assert.equal(result.exitCode,0,result.output);
    const module=await import(pathToFileURL(path.join(__dirname,'..','bin','lib','lifecycle-state.mjs')).href);
    const state=module.evaluateLifecycleState({planningDir:work()});
    assert.deepEqual(state.phases.map(p=>p.number),['11','12','16']);
    assert.equal(state.phases[0].parked,false);
    assert.deepEqual(snapshot(),before);
  });
}

test('nested archived details remain inactive until the outer close, including same-line nesting', async () => {
  for(const inner of ['<details>Inner note</details>','<details>\nInner note\n</details>']) {
    write('ROADMAP.md',[roadmap({parked:false,detailParked:false}), '## Archive',
      '<details>', '<summary>Historical examples</summary>',inner,
      '- [ ] **Phase 21: Archived phase** - Parked by owner.',
      '### Phase 11: Historical only','**Status**: [ ] — PARKED by owner.',
      '</details>'].join('\n'));
    const before=snapshot();
    const result=await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
    assert.equal(result.exitCode,0,result.output);
    const module=await import(pathToFileURL(path.join(__dirname,'..','bin','lib','lifecycle-state.mjs')).href);
    assert.deepEqual(module.evaluateLifecycleState({planningDir:work()}).phases.map(p=>p.number),['11','12','16']);
    assert.deepEqual(snapshot(),before);
  }
});

test('HTML tags inside a fenced example cannot hide a later real owner parking instruction', async () => {
  write('ROADMAP.md',['# Roadmap','~~~md','<details>','~~~',roadmap()].join('\n'));
  const before=snapshot();
  const result=await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
  assert.equal(result.exitCode,1,result.output);
  assert.equal(JSON.parse(result.output).reason,'owner_parked_phase');
  assert.deepEqual(snapshot(),before);
});

test('a phase-looking heading outside current Phase Details does not establish owner parking', async () => {
  write('ROADMAP.md',['# Roadmap','- [ ] **Phase 11: Current ordinary phase**',
    '## Historical example (not current Phase Details)','### Phase 11: Example only',
    '**Status**: [ ] — PARKED by owner.'].join('\n'));
  const before=snapshot();
  const result=await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
  assert.equal(result.exitCode,0,result.output);
  assert.deepEqual(snapshot(),before);
});

test('inline archive-tag examples cannot swallow later current phase authority', async () => {
  const prose='Preserve the literal '+String.fromCharCode(96)+'<details>'+String.fromCharCode(96)+' example as historical text.';
  write('ROADMAP.md',['# Current authority',prose,roadmap()].join('\n'));
  const before=snapshot();
  const result=await cmd('lifecycle-preflight','verify','11','--expects-mutation','phase-status');
  assert.equal(result.exitCode,1,result.output);
  assert.equal(JSON.parse(result.output).reason,'owner_parked_phase');
  assert.deepEqual(snapshot(),before);
});
