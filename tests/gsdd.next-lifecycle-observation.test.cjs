/**
 * One per-invocation lifecycle observation across next/control-map/continuity.
 * Uses native synthetic repositories; never reads an actual Workspine .work.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const fixtureParent = process.env.WORKSPINE_NEXT_LATENCY_TEST_ROOT || os.tmpdir();
let fixture = null;

function createFixture() {
  const cwd = fs.mkdtempSync(path.join(fixtureParent, 'gsdd-next-lifecycle-'));
  const work = path.join(cwd, '.work');
  fs.mkdirSync(path.join(work, 'phases', '11-rigor-final'), { recursive: true });
  fs.mkdirSync(path.join(work, 'phases', '16-historical'), { recursive: true });
  fs.writeFileSync(path.join(work, 'goal.md'), '# Synthetic current Workspine goal\n');
  fs.writeFileSync(path.join(work, 'SPEC.md'), '# Synthetic requirements\n');
  fs.writeFileSync(path.join(work, 'state.json'), JSON.stringify({
    schema_version: 1,
    status: 'active',
    current_state: 'plan',
    workflow: { current_state: 'plan' },
  }));
  fs.writeFileSync(path.join(work, 'ROADMAP.md'), [
    '# Synthetic roadmap',
    '',
    '## Phases',
    '- [ ] **Phase 01: Active work** - Not started.',
    '- [ ] **Phase 11: Rigor final** - Parked by owner until after relaunch.',
    '- [x] **Phase 16: Historical proof** - Closed previously.',
    '',
    '### Phase 01: Active work',
    '',
    '**Status**: [ ]',
    '',
    '### Phase 11: Rigor final',
    '',
    '**Status**: [ ] — PARKED by owner until after relaunch.',
    '',
    '### Phase 16: Historical proof',
    '',
    '**Status**: [x]',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(work, 'phases', '11-rigor-final', '11-01-PLAN.md'),
    '---\nphase: 11-rigor-final\nstatus: planned\n---\n# Historical plan\n');
  fs.writeFileSync(path.join(work, 'phases', '11-rigor-final', '11-01-SUMMARY.md'),
    '---\nstatus: complete\n---\n# Historical summary\n');
  fs.writeFileSync(path.join(work, 'phases', '11-rigor-final', '11-01-VERIFICATION.md'),
    '---\nstatus: passed\n---\n# Historical candidate verification\n');
  fs.writeFileSync(path.join(work, 'phases', '16-historical', '16-12-SUMMARY.md'),
    '# Retained historical orphan evidence; never an active verify grant\n');
  for (let index = 0; index < 40; index += 1) {
    const nested = path.join(work, 'phases', '16-historical', 'evidence',
      `batch-${Math.floor(index / 10)}`, `run-${index}`);
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, '16-01-RECEIPT.md'), '# retained evidence\n');
  }
  execFileSync('git', ['init', '-q'], { cwd, stdio: 'pipe' });
  return cwd;
}

async function load(relative) {
  return import(pathToFileURL(path.join(root, relative)).href);
}

function captureNext(handler) {
  const beforeLog = console.log;
  const beforeWrite = process.stdout.write;
  const beforeExitCode = process.exitCode;
  let output = '';
  try {
    console.log = (...parts) => { output += parts.join(' ') + '\n'; };
    process.stdout.write = (chunk) => { output += String(chunk); return true; };
    process.exitCode = undefined;
    handler('--json');
    assert.equal(process.exitCode ?? 0, 0, output);
  } finally {
    console.log = beforeLog;
    process.stdout.write = beforeWrite;
    process.exitCode = beforeExitCode;
  }
  return JSON.parse(output.trim());
}

test('next shares exactly one bounded, non-serialized lifecycle observation and rereads changed authority', async () => {
  fixture = createFixture();
  try {
    const work = await load('bin/lib/work-context.mjs');
    const controls = await load('bin/lib/control-map.mjs');
    const { createCmdNext } = await load('bin/lib/next.mjs');
    const ordinary = work.inspectWorkContext(fixture);
    const requested = work.inspectWorkContext(fixture, { includeLifecycleObservation: true });
    assert.equal(Object.hasOwn(ordinary, '_lifecycleObservation'), false);
    assert.equal(Object.getOwnPropertyDescriptor(requested, '_lifecycleObservation').enumerable, false);
    assert.equal(Object.keys(requested).includes('_lifecycleObservation'), false);
    assert.equal(JSON.stringify(ordinary), JSON.stringify(requested));
    assert.equal(JSON.stringify(requested).includes('_lifecycleObservation'), false);
    assert.equal(requested._lifecycleObservation.workspaceRoot, fixture);
    assert.equal(requested._lifecycleObservation.planningDir, path.join(fixture, '.work'));

    const plainMap = controls.buildControlMap({
      workspaceRoot: fixture, planningDir: path.join(fixture, '.work'),
    });
    const observedMap = controls.buildControlMap({
      workspaceRoot: fixture, planningDir: path.join(fixture, '.work'),
      lifecycleObservation: requested._lifecycleObservation,
    });
    // generated_at is intentionally volatile; operational fields must match.
    assert.equal(JSON.stringify({ ...plainMap, generated_at: null }),
      JSON.stringify({ ...observedMap, generated_at: null }));

    const unrelated = fs.mkdtempSync(path.join(fixtureParent, 'gsdd-next-other-root-'));
    try {
      const legacyIndependentPlanning = controls.buildControlMap({
        workspaceRoot: fixture,
        planningDir: path.join(unrelated, '.work'),
      });
      assert.equal(legacyIndependentPlanning.workflow_state.checkpoint.path,
        '.work/.continue-here.md',
        'default control-map checkpoint path remains planningDir-relative');
      assert.throws(() => controls.buildControlMap({
        workspaceRoot: unrelated,
        planningDir: path.join(unrelated, '.work'),
        lifecycleObservation: requested._lifecycleObservation,
      }), /observation workspace root or planning directory mismatch/);
      assert.throws(() => controls.buildControlMap({
        workspaceRoot: fixture,
        planningDir: path.join(fixture, '.work-other'),
        lifecycleObservation: requested._lifecycleObservation,
      }), /observation workspace root or planning directory mismatch/);
    } finally {
      fs.rmSync(unrelated, { recursive: true, force: true });
    }

    // Count exactly the phase root's withFileTypes enumeration. Other
    // non-lifecycle directory metadata calls are deliberately not counted.
    const originalReadDir = fs.readdirSync;
    let scannedPhases = 0;
    const phasesDir = path.join(fixture, '.work', 'phases');
    fs.readdirSync = function (file, options) {
      if (path.resolve(String(file)) === phasesDir && options?.withFileTypes === true) {
        scannedPhases += 1;
      }
      return originalReadDir.apply(this, arguments);
    };
    syncBuiltinESMExports();
    const handler = createCmdNext({ cwd: fixture });
    let first;
    try {
      first = captureNext(handler);
    } finally {
      fs.readdirSync = originalReadDir;
      syncBuiltinESMExports();
    }
    assert.equal(scannedPhases, 1, 'each next invocation should scan phases once');
    assert.equal(first.continuity.work_identity.next_phase, '1');
    assert.equal(first.state, 'plan');
    assert.equal(first.reason.includes('verification'), false,
      'historical Phase 16 orphan is not current verification authority');

    const roadmap = path.join(fixture, '.work', 'ROADMAP.md');
    const source = fs.readFileSync(roadmap);
    try {
      const revised = source.toString('utf8')
        .replace('- [ ] **Phase 01:', '- [x] **Phase 01:')
        .replace('**Status**: [ ]\n', '**Status**: [x]\n');
      assert.notEqual(revised, source.toString('utf8'));
      fs.writeFileSync(roadmap, revised);
      const next = captureNext(handler); // same handler must read fresh files
      assert.equal(next.continuity.work_identity.next_phase, null);
      assert.equal(next.continuity.work_identity.current_phase, null);
      assert.equal(next.state, 'plan');
    } finally {
      fs.writeFileSync(roadmap, source);
    }
    assert.deepEqual(fs.readFileSync(roadmap), source, 'fixture authority restored exactly');

    const { evaluateLifecyclePreflight } = await load('bin/lib/lifecycle-preflight.mjs');
    const verify = evaluateLifecyclePreflight({
      planningDir: path.join(fixture, '.work'),
      surface: 'verify',
      phaseNumber: '11',
    });
    assert.equal(verify.allowed, false);
    assert.ok(verify.blockers.some((blocker) => blocker.code === 'owner_parked_phase'));
  } finally {
    if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
  }
});
