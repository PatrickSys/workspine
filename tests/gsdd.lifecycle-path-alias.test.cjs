const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ownedRoots = [];
const canonical = p => fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
const modulePath = name => pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', name)).href;
const stateModule = import(modulePath('lifecycle-state.mjs'));
const preflightModule = import(modulePath('lifecycle-preflight.mjs'));
const checkpointModule = import(modulePath('work-context.mjs'));

function write(root, name, text) {
  const target = path.join(root, '.work', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

function fixture({ originalSpelling = false } = {}) {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-path-alias-'));
  ownedRoots.push(raw);
  const root = originalSpelling ? raw : canonical(raw);
  write(root, 'config.json', '{}\n');
  write(root, 'SPEC.md', '# Bounded path fixture\n');
  write(root, 'MILESTONES.md', '# Historical fixture\n');
  write(root, 'ROADMAP.md', [
    '# Roadmap',
    '- [ ] **Phase 11: Parked stream** - Parked by owner.',
    '- [ ] **Phase 12: Current stream** - Current work.',
    '',
    '## Phase Details',
    '### Phase 11: Parked stream',
    '**Status**: [ ] - PARKED by owner.',
    '### Phase 12: Current stream',
    '**Status**: [ ]',
    '',
  ].join('\n'));
  for (const dir of ['11-parked', '12-current']) {
    const number = dir.slice(0, 2);
    write(root, 'phases/' + dir + '/' + number + '-01-PLAN.md', '---\nstatus: approved\n---\n# Plan\n');
    write(root, 'phases/' + dir + '/' + number + '-01-SUMMARY.md', '# Summary\n');
  }
  return root;
}

function checkpoint(root) {
  write(root, '.continue-here.md', [
    '---', 'workflow: phase', 'phase: 11-parked',
    'timestamp: 2026-10-09T01:00:00.000Z', 'runtime: other', '---',
    '<current_state>Selected parked phase.</current_state>',
    '<completed_work>Saved fixture.</completed_work>',
    '<remaining_work>Wait for owner.</remaining_work>',
    '<decisions>No change.</decisions>',
    '<blockers>Parked.</blockers>',
    '<next_action>Preserve owner parking.</next_action>', '',
  ].join('\n'));
}

async function state(root) {
  return (await stateModule).evaluateLifecycleState({ planningDir: path.join(root, '.work') });
}
const names = value => value.phaseArtifacts.map(artifact => artifact.displayPath);
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

function requireNativeAlias(t, root) {
  if (process.platform !== 'win32' || root.toLowerCase() === canonical(root).toLowerCase()) {
    t.skip('This Windows temporary-root spelling has no observed native alias.');
    return false;
  }
  assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
  assert.equal(fs.statSync(root).ino, fs.statSync(canonical(root)).ino);
  return true;
}

afterEach(() => {
  for (const root of ownedRoots.splice(0).reverse()) fs.rmSync(root, { recursive: true, force: true });
});

test('Windows native temporary-root alias retains the same standard phase inventory', async t => {
  const root = fixture({ originalSpelling: true });
  if (!requireNativeAlias(t, root)) return;
  const aliasState = await state(root);
  const canonicalState = await state(canonical(root));
  assert.equal(aliasState.phaseArtifacts.length, 4);
  assert.deepEqual(names(aliasState), names(canonicalState));
  assert.ok(aliasState.phaseArtifacts.every(artifact => artifact.path.startsWith(path.resolve(root))));
});

test('valid parked checkpoint stays bound through a Windows native temporary-root alias', async t => {
  const root = fixture({ originalSpelling: true });
  if (!requireNativeAlias(t, root)) return;
  checkpoint(root);
  const planningDir = path.join(root, '.work');
  assert.equal((await checkpointModule).readContinuityCheckpoint(planningDir).status, 'valid');
  const evaluate = (await preflightModule).evaluateLifecyclePreflight;
  const parked = evaluate({ planningDir, surface: 'resume' });
  assert.equal(parked.allowed, false);
  assert.equal(parked.reason, 'owner_parked_phase');
  const ordinary = evaluate({ planningDir, surface: 'verify', phaseNumber: '12', expectsMutation: 'phase-status' });
  assert.equal(ordinary.allowed, true);
});

test('canonical directory discovery retains logical artifact paths and ordinary verify authority', async () => {
  const root = fixture();
  const current = await state(root);
  assert.equal(current.phaseArtifacts.length, 4);
  assert.ok(current.phaseArtifacts.every(artifact => artifact.path.startsWith(path.resolve(root))));
  const result = (await preflightModule).evaluateLifecyclePreflight({
    planningDir: path.join(root, '.work'), surface: 'verify', phaseNumber: '12', expectsMutation: 'phase-status',
  });
  assert.equal(result.allowed, true);
});

test('a phase root junction cannot supply authority even when its target is a real directory', async () => {
  const root = fixture();
  const phases = path.join(root, '.work', 'phases');
  const retained = path.join(root, 'retained-phases');
  const before = fs.readFileSync(path.join(phases, '12-current', '12-01-PLAN.md'));
  fs.renameSync(phases, retained);
  fs.symlinkSync(retained, phases, linkType);
  assert.equal(fs.lstatSync(phases).isSymbolicLink(), true);
  assert.deepEqual(names(await state(root)), []);
  assert.deepEqual(fs.readFileSync(path.join(retained, '12-current', '12-01-PLAN.md')), before);
});

test('a linked planning ancestor cannot supply phase authority', async () => {
  const root = fixture();
  const work = path.join(root, '.work');
  const retained = path.join(root, 'retained-work');
  const before = fs.readFileSync(path.join(work, 'phases', '12-current', '12-01-PLAN.md'));
  fs.renameSync(work, retained);
  fs.symlinkSync(retained, work, linkType);
  assert.equal(fs.lstatSync(work).isSymbolicLink(), true);
  assert.deepEqual(names(await state(root)), []);
  assert.deepEqual(fs.readFileSync(path.join(retained, 'phases', '12-current', '12-01-PLAN.md')), before);
});

test('an external nested junction stays excluded while ordinary artifacts remain visible', async () => {
  const root = fixture();
  const outside = path.join(root, 'external');
  fs.mkdirSync(outside);
  const payload = path.join(outside, '12-02-SUMMARY.md');
  fs.writeFileSync(payload, '# External fixture\n');
  fs.symlinkSync(outside, path.join(root, '.work', 'phases', '12-current', 'external'), linkType);
  const current = await state(root);
  assert.equal(current.phaseArtifacts.length, 4);
  assert.ok(names(current).every(name => !name.includes('external')));
  assert.equal(fs.readFileSync(payload, 'utf8'), '# External fixture\n');
});

test('a linked phase file remains excluded without hiding ordinary artifacts', async () => {
  const root = fixture();
  const outside = path.join(root, '12-02-PLAN.md');
  fs.writeFileSync(outside, '---\nstatus: approved\n---\n# External plan\n');
  fs.symlinkSync(outside, path.join(root, '.work', 'phases', '12-current', '12-02-PLAN.md'), 'file');
  const current = await state(root);
  assert.equal(current.phaseArtifacts.length, 4);
  assert.ok(names(current).every(name => !name.includes('12-02')));
  assert.equal(fs.readFileSync(outside, 'utf8'), '---\nstatus: approved\n---\n# External plan\n');
});

test('a nested junction to an internal phase cannot duplicate its authority', async () => {
  const root = fixture();
  const phases = path.join(root, '.work', 'phases');
  fs.symlinkSync(path.join(phases, '12-current'), path.join(phases, '11-parked', 'same-target'), linkType);
  const current = await state(root);
  assert.equal(current.phaseArtifacts.length, 4);
  assert.ok(names(current).every(name => !name.includes('same-target')));
});

test('Windows directory case aliases retain inventory without rewriting emitted paths', { skip: process.platform !== 'win32' }, async () => {
  const root = fixture();
  const upper = root.toUpperCase();
  const current = await state(upper);
  assert.equal(current.phaseArtifacts.length, 4);
  assert.ok(current.phaseArtifacts.every(artifact => artifact.path.startsWith(path.resolve(upper))));
});

