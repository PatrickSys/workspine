/**
 * Phase 16 flow-cohesion regression tests.
 *
 * These fixtures exercise the existing lifecycle authority and artifact seams;
 * they do not create a second state or question store.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { cleanup, createTempProject, runCliAsMain } = require('./gsdd.helpers.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
  fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');
});

afterEach(() => cleanup(tmpDir));

function write(relativePath, content) {
  const target = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function standardPlan(status = 'pending') {
  return `---\nstatus: ${status}\n---\n# Plan\n`;
}

function brownfieldChange(posture = 'active') {
  return [
    '---',
    'change: FLOW-160301',
    'status: active',
    '---',
    '',
    '# Brownfield Change: Flow cohesion',
    '',
    '## Goal',
    '- Prove one bounded brownfield lifecycle.',
    '',
    '## In Scope',
    '- Existing lifecycle helpers only.',
    '',
    '## Out of Scope',
    '- New state roots or routers.',
    '',
    '## Done When',
    '- Plan, execute, and verify remain on this lane.',
    '',
    '## Current Status',
    `- Current posture: ${posture}`,
    '- Current branch / integration surface: disposable fixture',
    '- Current owner / runtime: node test',
    '',
    '## Next Action',
    '- Continue the bounded lifecycle.',
    '',
    '## PR Slice Ownership',
    '| Slice | Scope | Owned files / modules | Status |',
    '| --- | --- | --- | --- |',
    '| A | lifecycle | bin/lib/ | active |',
    '',
    '## Closeout Path',
    '- Record verification in VERIFICATION.md.',
    '',
  ].join('\n');
}

async function lifecycleState() {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-state.mjs')).href;
  return import(`${modulePath}?flow=${Date.now()}-${Math.random()}`);
}

async function preflight(surface, phase) {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-preflight.mjs')).href;
  const { evaluateLifecyclePreflight } = await import(`${modulePath}?flow=${Date.now()}-${Math.random()}`);
  return evaluateLifecyclePreflight({
    planningDir: path.join(tmpDir, '.work'),
    surface,
    phaseNumber: phase,
    expectsMutation: ['execute', 'verify'].includes(surface) ? 'phase-status' : 'none',
  });
}

describe('Phase 16 flow cohesion', () => {
  test('discovers nested standard phase artifacts recursively in deterministic order', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 16: Cohesion**\n');
    write('.work/phases/16-cohesion/z-nested/16-2-SUMMARY.md', '# later\n');
    write('.work/phases/16-cohesion/a-nested/16-1-PLAN.md', standardPlan());
    write('.work/phases/16-cohesion/a-nested/16-1-SUMMARY.md', '# first\n');

    const { evaluateLifecycleState } = await lifecycleState();
    const lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.deepEqual(
      lifecycle.phaseArtifacts.map((artifact) => artifact.displayPath),
      [
        '16-cohesion/a-nested/16-1-PLAN.md',
        '16-cohesion/a-nested/16-1-SUMMARY.md',
        '16-cohesion/z-nested/16-2-SUMMARY.md',
      ],
    );
    assert.equal(lifecycle.incompletePlans.length, 0);

    const found = await runCliAsMain(tmpDir, ['find-phase']);
    assert.equal(found.exitCode, 0, found.output);
    const packet = JSON.parse(found.output);
    assert.equal(packet.summaryCount, 2);
  });

  test('keeps a supported brownfield plan -> execute -> verify lane without SPEC or ROADMAP', async () => {
    write('.work/brownfield-change/CHANGE.md', brownfieldChange('active'));

    const plan = await preflight('plan', 'brownfield-change');
    assert.equal(plan.allowed, true);
    assert.equal(plan.authority, 'brownfield_change');
    assert.equal(plan.phase, 'brownfield-change');

    const execute = await preflight('execute', 'brownfield-change');
    assert.equal(execute.allowed, true);
    assert.equal(execute.authority, 'brownfield_change');
    assert.equal(execute.blockers.length, 0);

    write('.work/brownfield-change/CHANGE.md', brownfieldChange('ready_for_verification'));
    const verify = await preflight('verify', 'brownfield-change');
    assert.equal(verify.allowed, true);
    assert.equal(verify.authority, 'brownfield_change');
    assert.equal(verify.blockers.length, 0);
    assert.equal(fs.existsSync(path.join(tmpDir, '.work', 'SPEC.md')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, '.work', 'ROADMAP.md')), false);
  });

  test('fails closed when brownfield authority has an incomplete contract', async () => {
    write('.work/brownfield-change/CHANGE.md', [
      '---',
      'change: FLOW-160301-BROKEN',
      'status: active',
      '---',
      '',
      '# Incomplete brownfield change',
      '',
      '## Current Status',
      '- Current posture: active',
      '',
    ].join('\n'));

    const result = await preflight('plan', 'brownfield-change');
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'brownfield_contract_invalid');
    assert.ok(result.blockers.some((entry) => entry.code === 'brownfield_contract_invalid'));
  });

  test('fails closed when brownfield authority has a competing active stream', async () => {
    write('.work/brownfield-change/CHANGE.md', brownfieldChange('active'));
    write('.work/brownfield-change-2/CHANGE.md', brownfieldChange('active'));
    const before = JSON.stringify(fs.readdirSync(path.join(tmpDir, '.work')).sort());

    const result = await preflight('plan', 'brownfield-change');
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'brownfield_contract_invalid');
    assert.ok(result.blockers.some((entry) => entry.code === 'brownfield_contract_invalid'));
    assert.equal(JSON.stringify(fs.readdirSync(path.join(tmpDir, '.work')).sort()), before);
  });

  test('ignores an external nested summary junction during recursive discovery', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 16: Cohesion**\n');
    write('.work/phases/16-cohesion/16-PLAN.md', standardPlan());
    const external = path.join(tmpDir, 'external-summary');
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, '16-SUMMARY.md'), '# outside summary\n');
    const junction = path.join(tmpDir, '.work', 'phases', '16-cohesion', 'external');
    try {
      fs.symlinkSync(external, junction, 'junction');
    } catch (error) {
      assert.fail(`adversarial junction fixture could not be created: ${error.message}`);
    }

    const { evaluateLifecycleState } = await lifecycleState();
    const lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });
    assert.deepEqual(
      lifecycle.phaseArtifacts.map((artifact) => artifact.displayPath),
      ['16-cohesion/16-PLAN.md'],
    );
    assert.equal(lifecycle.incompletePlans.length, 1);
    assert.ok(lifecycle.incompletePlans.every((artifact) => !artifact.displayPath.includes('external')));
  });

  test('direct preflight matches next authority-conflict behavior for native milestone work', async () => {
    write('.work/brownfield-change/CHANGE.md', brownfieldChange('active'));
    write('.work/milestone/MILESTONE.md', '# Active milestone\n');

    const result = await preflight('plan', 'brownfield-change');
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'authority_conflict');
    assert.ok(result.blockers.some((entry) => entry.code === 'authority_conflict'));
    assert.deepEqual(result.blockers.find((entry) => entry.code === 'authority_conflict').artifacts, [
      '.work/brownfield-change/CHANGE.md',
      '.work/milestone/MILESTONE.md',
      '.work/milestone/ROADMAP.md',
    ]);
  });

  test('retains normal greenfield routing when roadmap authority is valid', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 7: Greenfield**\n');
    write('.work/phases/07-greenfield/07-PLAN.md', standardPlan());
    const result = await preflight('execute', '7');
    assert.equal(result.allowed, true);
    assert.equal(result.authority, 'planning');
    assert.equal(result.phase, '7');
  });
});
