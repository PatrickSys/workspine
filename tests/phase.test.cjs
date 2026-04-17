/**
 * GSD Tools Tests - Phase
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const {
  createTempProject: createGsddTempProject,
  loadGsdd,
  runCliAsMain,
} = require('./gsdd.helpers.cjs');

async function importLifecycleStateModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-state.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importLifecyclePreflightModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-preflight.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importEvidenceContractModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'evidence-contract.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importRuntimeFreshnessModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'runtime-freshness.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

describe('phases list command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns empty array', () => {
    const result = runGsdTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.directories, [], 'directories should be empty');
    assert.strictEqual(output.count, 0, 'count should be 0');
  });

  test('lists phase directories sorted numerically', () => {
    // Create out-of-order directories
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '10-final'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runGsdTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 3, 'should have 3 directories');
    assert.deepStrictEqual(
      output.directories,
      ['01-foundation', '02-api', '10-final'],
      'should be sorted numerically'
    );
  });

  test('handles decimal phases in sort order', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.2-patch'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-ui'), { recursive: true });

    const result = runGsdTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.directories,
      ['02-api', '02.1-hotfix', '02.2-patch', '03-ui'],
      'decimal phases should sort correctly between whole numbers'
    );
  });

  test('--type plans lists only PLAN.md files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-PLAN.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(phaseDir, 'RESEARCH.md'), '# Research');

    const result = runGsdTools('phases list --type plans', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.files.sort(),
      ['01-01-PLAN.md', '01-02-PLAN.md'],
      'should list only PLAN files'
    );
  });

  test('--type summaries lists only SUMMARY.md files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-SUMMARY.md'), '# Summary 2');

    const result = runGsdTools('phases list --type summaries', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.files.sort(),
      ['01-01-SUMMARY.md', '01-02-SUMMARY.md'],
      'should list only SUMMARY files'
    );
  });

  test('--phase filters to specific phase directory', () => {
    const phase01 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    const phase02 = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase01, { recursive: true });
    fs.mkdirSync(phase02, { recursive: true });
    fs.writeFileSync(path.join(phase01, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(phase02, '02-01-PLAN.md'), '# Plan');

    const result = runGsdTools('phases list --type plans --phase 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.files, ['01-01-PLAN.md'], 'should only list phase 01 plans');
    assert.strictEqual(output.phase_dir, 'foundation', 'should report phase name without number prefix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// roadmap get-phase command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase next-decimal command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns X.1 when no decimal phases exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '07-next'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.1', 'should return 06.1');
    assert.deepStrictEqual(output.existing, [], 'no existing decimals');
  });

  test('increments from existing decimal phases', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.2-patch'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.3', 'should return 06.3');
    assert.deepStrictEqual(output.existing, ['06.1', '06.2'], 'lists existing decimals');
  });

  test('handles gaps in decimal sequence', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-first'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.3-third'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Should take next after highest, not fill gap
    assert.strictEqual(output.next, '06.4', 'should return 06.4, not fill gap at 06.2');
  });

  test('handles single-digit phase input', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });

    const result = runGsdTools('phase next-decimal 6', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.1', 'should normalize to 06.1');
    assert.strictEqual(output.base_phase, '06', 'base phase should be padded');
  });

  test('returns error if base phase does not exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-start'), { recursive: true });

    const result = runGsdTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'base phase not found');
    assert.strictEqual(output.next, '06.1', 'should still suggest 06.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase-plan-index command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase-plan-index command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phase directory returns empty plans array', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '03', 'phase number correct');
    assert.deepStrictEqual(output.plans, [], 'plans should be empty');
    assert.deepStrictEqual(output.waves, {}, 'waves should be empty');
    assert.deepStrictEqual(output.incomplete, [], 'incomplete should be empty');
    assert.strictEqual(output.has_checkpoints, false, 'no checkpoints');
  });

  test('extracts single plan with frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-PLAN.md'),
      `---
wave: 1
autonomous: true
objective: Set up database schema
files-modified: [prisma/schema.prisma, src/lib/db.ts]
---

## Task 1: Create schema
## Task 2: Generate client
`
    );

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 1, 'should have 1 plan');
    assert.strictEqual(output.plans[0].id, '03-01', 'plan id correct');
    assert.strictEqual(output.plans[0].wave, 1, 'wave extracted');
    assert.strictEqual(output.plans[0].autonomous, true, 'autonomous extracted');
    assert.strictEqual(output.plans[0].objective, 'Set up database schema', 'objective extracted');
    assert.deepStrictEqual(output.plans[0].files_modified, ['prisma/schema.prisma', 'src/lib/db.ts'], 'files extracted');
    assert.strictEqual(output.plans[0].task_count, 2, 'task count correct');
    assert.strictEqual(output.plans[0].has_summary, false, 'no summary yet');
  });

  test('groups multiple plans by wave', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-PLAN.md'),
      `---
wave: 1
autonomous: true
objective: Database setup
---

## Task 1: Schema
`
    );

    fs.writeFileSync(
      path.join(phaseDir, '03-02-PLAN.md'),
      `---
wave: 1
autonomous: true
objective: Auth setup
---

## Task 1: JWT
`
    );

    fs.writeFileSync(
      path.join(phaseDir, '03-03-PLAN.md'),
      `---
wave: 2
autonomous: false
objective: API routes
---

## Task 1: Routes
`
    );

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 3, 'should have 3 plans');
    assert.deepStrictEqual(output.waves['1'], ['03-01', '03-02'], 'wave 1 has 2 plans');
    assert.deepStrictEqual(output.waves['2'], ['03-03'], 'wave 2 has 1 plan');
  });

  test('detects incomplete plans (no matching summary)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Plan with summary
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), `---\nwave: 1\n---\n## Task 1`);
    fs.writeFileSync(path.join(phaseDir, '03-01-SUMMARY.md'), `# Summary`);

    // Plan without summary
    fs.writeFileSync(path.join(phaseDir, '03-02-PLAN.md'), `---\nwave: 2\n---\n## Task 1`);

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans[0].has_summary, true, 'first plan has summary');
    assert.strictEqual(output.plans[1].has_summary, false, 'second plan has no summary');
    assert.deepStrictEqual(output.incomplete, ['03-02'], 'incomplete list correct');
  });

  test('detects checkpoints (autonomous: false)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-PLAN.md'),
      `---
wave: 1
autonomous: false
objective: Manual review needed
---

## Task 1: Review
`
    );

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_checkpoints, true, 'should detect checkpoint');
    assert.strictEqual(output.plans[0].autonomous, false, 'plan marked non-autonomous');
  });

  test('phase not found returns error', () => {
    const result = runGsdTools('phase-plan-index 99', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Phase not found', 'should report phase not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state-snapshot command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase add command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('adds phase after highest existing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API

---
`
    );

    const result = runGsdTools('phase add User Dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, 3, 'should be phase 3');
    assert.strictEqual(output.slug, 'user-dashboard');

    // Verify directory created
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '03-user-dashboard')),
      'directory should be created'
    );

    // Verify ROADMAP updated
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('### Phase 3: User Dashboard'), 'roadmap should include new phase');
    assert.ok(roadmap.includes('**Depends on:** Phase 2'), 'should depend on previous');
  });

  test('handles empty roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0\n`
    );

    const result = runGsdTools('phase add Initial Setup', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, 1, 'should be phase 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase insert command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase insert command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('inserts decimal phase after target', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runGsdTools('phase insert 1 Fix Critical Bug', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '01.1', 'should be 01.1');
    assert.strictEqual(output.after_phase, '1');

    // Verify directory
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01.1-fix-critical-bug')),
      'decimal phase directory should be created'
    );

    // Verify ROADMAP
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('Phase 01.1: Fix Critical Bug (INSERTED)'), 'roadmap should include inserted phase');
  });

  test('increments decimal when siblings exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01.1-hotfix'), { recursive: true });

    const result = runGsdTools('phase insert 1 Another Fix', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '01.2', 'should be 01.2');
  });

  test('rejects missing phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: Test\n**Goal:** Test\n`
    );

    const result = runGsdTools('phase insert 99 Fix Something', tmpDir);
    assert.ok(!result.success, 'should fail for missing phase');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });

  test('handles padding mismatch between input and roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

## Phase 09.05: Existing Decimal Phase
**Goal:** Test padding

## Phase 09.1: Next Phase
**Goal:** Test
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '09.05-existing'), { recursive: true });

    // Pass unpadded "9.05" but roadmap has "09.05"
    const result = runGsdTools('phase insert 9.05 Padding Test', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.after_phase, '9.05');

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('(INSERTED)'), 'roadmap should include inserted phase');
  });

  test('handles #### heading depth from multi-milestone roadmaps', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### v1.1 Milestone

#### Phase 5: Feature Work
**Goal:** Build features

#### Phase 6: Polish
**Goal:** Polish
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05-feature-work'), { recursive: true });

    const result = runGsdTools('phase insert 5 Hotfix', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '05.1');

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('Phase 05.1: Hotfix (INSERTED)'), 'roadmap should include inserted phase');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase remove command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase remove command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('removes phase directory and renumbers subsequent', () => {
    // Setup 3 phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup
**Depends on:** Nothing

### Phase 2: Auth
**Goal:** Authentication
**Depends on:** Phase 1

### Phase 3: Features
**Goal:** Core features
**Depends on:** Phase 2
`
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-auth');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, '02-01-PLAN.md'), '# Plan');
    const p3 = path.join(tmpDir, '.planning', 'phases', '03-features');
    fs.mkdirSync(p3, { recursive: true });
    fs.writeFileSync(path.join(p3, '03-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p3, '03-02-PLAN.md'), '# Plan 2');

    // Remove phase 2
    const result = runGsdTools('phase remove 2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.removed, '2');
    assert.strictEqual(output.directory_deleted, '02-auth');

    // Phase 3 should be renumbered to 02
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features')),
      'phase 3 should be renumbered to 02-features'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '03-features')),
      'old 03-features should not exist'
    );

    // Files inside should be renamed
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features', '02-01-PLAN.md')),
      'plan file should be renumbered to 02-01'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features', '02-02-PLAN.md')),
      'plan 2 should be renumbered to 02-02'
    );

    // ROADMAP should be updated
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(!roadmap.includes('Phase 2: Auth'), 'removed phase should not be in roadmap');
    assert.ok(roadmap.includes('Phase 2: Features'), 'phase 3 should be renumbered to 2');
  });

  test('rejects removal of phase with summaries unless --force', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: Test\n**Goal:** Test\n`
    );

    // Should fail without --force
    const result = runGsdTools('phase remove 1', tmpDir);
    assert.ok(!result.success, 'should fail without --force');
    assert.ok(result.error.includes('executed plan'), 'error mentions executed plans');

    // Should succeed with --force
    const forceResult = runGsdTools('phase remove 1 --force', tmpDir);
    assert.ok(forceResult.success, `Force remove failed: ${forceResult.error}`);
  });

  test('removes decimal phase and renumbers siblings', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 6: Main\n**Goal:** Main\n### Phase 6.1: Fix A\n**Goal:** Fix A\n### Phase 6.2: Fix B\n**Goal:** Fix B\n### Phase 6.3: Fix C\n**Goal:** Fix C\n`
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-main'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-fix-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.2-fix-b'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.3-fix-c'), { recursive: true });

    const result = runGsdTools('phase remove 6.2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    // 06.3 should become 06.2
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '06.2-fix-c')),
      '06.3 should be renumbered to 06.2'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '06.3-fix-c')),
      'old 06.3 should not exist'
    );
  });

  test('updates STATE.md phase count', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n**Goal:** A\n### Phase 2: B\n**Goal:** B\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 1\n**Total Phases:** 2\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });

    runGsdTools('phase remove 2', tmpDir);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(state.includes('**Total Phases:** 1'), 'total phases should be decremented');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase complete command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('marks phase complete and transitions to next', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [ ] Phase 1: Foundation
- [ ] Phase 2: API

### Phase 1: Foundation
**Goal:** Setup
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Foundation\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working on phase 1\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed_phase, '1');
    assert.strictEqual(output.plans_executed, '1/1');
    assert.strictEqual(output.next_phase, '02');
    assert.strictEqual(output.is_last_phase, false);

    // Verify STATE.md updated
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(state.includes('**Current Phase:** 02'), 'should advance to phase 02');
    assert.ok(state.includes('**Status:** Ready to plan'), 'status should be ready to plan');
    assert.ok(state.includes('**Current Plan:** Not started'), 'plan should be reset');

    // Verify ROADMAP checkbox
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8');
    assert.ok(roadmap.includes('[x]'), 'phase should be checked off');
    assert.ok(roadmap.includes('completed'), 'completion date should be added');
  });

  test('detects last phase in milestone', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: Only Phase\n**Goal:** Everything\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-only-phase');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.is_last_phase, true, 'should detect last phase');
    assert.strictEqual(output.next_phase, null, 'no next phase');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(state.includes('Milestone complete'), 'status should be milestone complete');
  });

  test('updates REQUIREMENTS.md traceability when phase completes', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [ ] Phase 1: Auth

### Phase 1: Auth
**Goal:** User authentication
**Requirements:** AUTH-01, AUTH-02
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
**Requirements:** API-01
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      `# Requirements

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: User can sign up with email
- [ ] **AUTH-02**: User can log in
- [ ] **AUTH-03**: User can reset password

### API

- [ ] **API-01**: REST endpoints

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 2 | Pending |
| API-01 | Phase 2 | Pending |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Auth\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'REQUIREMENTS.md'), 'utf-8');

    // Checkboxes updated for phase 1 requirements
    assert.ok(req.includes('- [x] **AUTH-01**'), 'AUTH-01 checkbox should be checked');
    assert.ok(req.includes('- [x] **AUTH-02**'), 'AUTH-02 checkbox should be checked');
    // Other requirements unchanged
    assert.ok(req.includes('- [ ] **AUTH-03**'), 'AUTH-03 should remain unchecked');
    assert.ok(req.includes('- [ ] **API-01**'), 'API-01 should remain unchecked');

    // Traceability table updated
    assert.ok(req.includes('| AUTH-01 | Phase 1 | Complete |'), 'AUTH-01 status should be Complete');
    assert.ok(req.includes('| AUTH-02 | Phase 1 | Complete |'), 'AUTH-02 status should be Complete');
    assert.ok(req.includes('| AUTH-03 | Phase 2 | Pending |'), 'AUTH-03 should remain Pending');
    assert.ok(req.includes('| API-01 | Phase 2 | Pending |'), 'API-01 should remain Pending');
  });

  test('handles requirements with bracket format [REQ-01, REQ-02]', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [ ] Phase 1: Auth

### Phase 1: Auth
**Goal:** User authentication
**Requirements:** [AUTH-01, AUTH-02]
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
**Requirements:** [API-01]
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      `# Requirements

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: User can sign up with email
- [ ] **AUTH-02**: User can log in
- [ ] **AUTH-03**: User can reset password

### API

- [ ] **API-01**: REST endpoints

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 2 | Pending |
| API-01 | Phase 2 | Pending |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Auth\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'REQUIREMENTS.md'), 'utf-8');

    // Checkboxes updated for phase 1 requirements (brackets stripped)
    assert.ok(req.includes('- [x] **AUTH-01**'), 'AUTH-01 checkbox should be checked');
    assert.ok(req.includes('- [x] **AUTH-02**'), 'AUTH-02 checkbox should be checked');
    // Other requirements unchanged
    assert.ok(req.includes('- [ ] **AUTH-03**'), 'AUTH-03 should remain unchecked');
    assert.ok(req.includes('- [ ] **API-01**'), 'API-01 should remain unchecked');

    // Traceability table updated
    assert.ok(req.includes('| AUTH-01 | Phase 1 | Complete |'), 'AUTH-01 status should be Complete');
    assert.ok(req.includes('| AUTH-02 | Phase 1 | Complete |'), 'AUTH-02 status should be Complete');
    assert.ok(req.includes('| AUTH-03 | Phase 2 | Pending |'), 'AUTH-03 should remain Pending');
    assert.ok(req.includes('| API-01 | Phase 2 | Pending |'), 'API-01 should remain Pending');
  });

  test('handles phase with no requirements mapping', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [ ] Phase 1: Setup

### Phase 1: Setup
**Goal:** Project setup (no requirements)
**Plans:** 1 plans
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      `# Requirements

## v1 Requirements

- [ ] **REQ-01**: Some requirement

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-01 | Phase 2 | Pending |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    // REQUIREMENTS.md should be unchanged
    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'REQUIREMENTS.md'), 'utf-8');
    assert.ok(req.includes('- [ ] **REQ-01**'), 'REQ-01 should remain unchecked');
    assert.ok(req.includes('| REQ-01 | Phase 2 | Pending |'), 'REQ-01 should remain Pending');
  });

  test('handles missing REQUIREMENTS.md gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [ ] Phase 1: Foundation
**Requirements:** REQ-01

### Phase 1: Foundation
**Goal:** Setup
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

    const result = runGsdTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command should succeed even without REQUIREMENTS.md: ${result.error}`);
  });
});

describe('Phase 18 deterministic CLI mechanics', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('file-op copy writes a checkpoint backup inside the workspace', async () => {
    const source = path.join(tmpDir, '.planning', '.continue-here.md');
    const backup = path.join(tmpDir, '.planning', '.continue-here.bak');
    fs.writeFileSync(source, '# checkpoint\n');

    const result = await runCliAsMain(tmpDir, ['file-op', 'copy', '.planning/.continue-here.md', '.planning/.continue-here.bak']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'copy');
    assert.strictEqual(output.changed, true);
    assert.strictEqual(fs.readFileSync(backup, 'utf-8'), '# checkpoint\n');
  });

  test('file-op delete supports cleanup no-op semantics for missing files', async () => {
    const result = await runCliAsMain(tmpDir, ['file-op', 'delete', '.planning/.continue-here.bak', '--missing', 'ok']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'delete');
    assert.strictEqual(output.changed, false);
    assert.strictEqual(output.reason, 'missing_target');
  });

  test('file-op regex-sub performs deterministic text mutation', async () => {
    const target = path.join(tmpDir, '.planning', 'note.txt');
    fs.writeFileSync(target, 'manual checkpoint cleanup\nmanual checkpoint cleanup\n');

    const result = await runCliAsMain(tmpDir, ['file-op', 'regex-sub', '.planning/note.txt', 'manual checkpoint cleanup', 'gsdd file-op delete --missing ok']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'regex-sub');
    assert.strictEqual(output.replacements, 2);
    assert.match(fs.readFileSync(target, 'utf-8'), /gsdd file-op delete --missing ok/);
  });

  test('file-op regex-sub reports one replacement when flags are non-global', async () => {
    const target = path.join(tmpDir, '.planning', 'single.txt');
    fs.writeFileSync(target, 'phase 18\nphase 18\n');

    const result = await runCliAsMain(tmpDir, ['file-op', 'regex-sub', '.planning/single.txt', 'phase', 'step', '--flags', 'i']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'regex-sub');
    assert.strictEqual(output.replacements, 1);
    assert.strictEqual(output.changed, true);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'step 18\nphase 18\n');
  });

  test('file-op delete fails loudly when a contract-significant file is missing', async () => {
    const result = await runCliAsMain(tmpDir, ['file-op', 'delete', '.planning/.continue-here.md']);
    assert.notStrictEqual(result.exitCode, 0, 'missing delete should fail');
    assert.match(result.output, /does not exist/i);
  });

  test('phase-status updates ROADMAP phase status markers through the helper', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n- [ ] **Phase 19: Workflow UX & Provenance** - goal\n'
    );

    let result = await runCliAsMain(tmpDir, ['phase-status', '18', 'in_progress']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[-\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);

    result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
  });

  test('phase-status supports letter-suffixed phase identifiers already used in roadmap truth', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 9a: Truth Reconciliation** - goal\n- [ ] **Phase 10: Next Phase** - goal\n'
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '9a', 'in_progress']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '9a');
    assert.strictEqual(output.changed, true);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[-\] \*\*Phase 9a: Truth Reconciliation\*\*/);
  });

  test('phase-status supports star-bullet roadmap entries', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n* [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /\* \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
  });

  test('phase-status reports changed false when target phase already has requested status', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const original = '# Roadmap\n\n- [x] **Phase 18: Deterministic CLI Mechanics** - goal\n';
    fs.writeFileSync(roadmapPath, original);

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.changed, false);
    assert.strictEqual(fs.readFileSync(roadmapPath, 'utf-8'), original);
  });

  test('phase-status fails loudly for invalid status values', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'complete']);
    assert.notStrictEqual(result.exitCode, 0, 'invalid phase status should fail');
    assert.match(result.output, /unsupported phase status/i);
  });

  test('help text documents file-op, phase-status, and lifecycle-preflight commands', async () => {
    const result = await runCliAsMain(tmpDir, ['help']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /file-op <copy\|delete\|regex-sub>/);
    assert.match(result.output, /phase-status <N> <status>/);
    assert.match(result.output, /lifecycle-preflight <surface> \[phase]/);
  });

  test('a later successful in-process CLI run clears an earlier phase-command failure exit code', async () => {
    const gsdd = await loadGsdd(tmpDir);
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const previousCwd = process.cwd();

    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );

    process.chdir(tmpDir);
    try {
      await gsdd.runCli('verify', []);
      assert.strictEqual(process.exitCode, 1, 'failing verify should set a non-zero exit code');

      await gsdd.runCli('phase-status', ['18', 'done']);
      assert.strictEqual(process.exitCode, 0, 'successful follow-up run should clear the prior failure exit code');
      assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('Phase 19 provenance helpers', () => {
  test('parseGitStatusShort separates staged, unstaged, and untracked files', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const status = mod.parseGitStatusShort('M  README.md\n M distilled/workflows/resume.md\n?? bin/lib/provenance.mjs\n');

    assert.strictEqual(status.stagedCount, 1);
    assert.strictEqual(status.unstagedCount, 1);
    assert.strictEqual(status.untrackedCount, 1);
    assert.strictEqual(status.dirty, true);
  });

  test('parseGitStatusShort ignores git --ignored markers', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const status = mod.parseGitStatusShort('!! .env.local\n');

    assert.strictEqual(status.stagedCount, 0);
    assert.strictEqual(status.unstagedCount, 0);
    assert.strictEqual(status.untrackedCount, 0);
    assert.strictEqual(status.dirty, false);
    assert.deepStrictEqual(status.files, []);
  });

  test('classifyCheckpointRouting keeps generic checkpoints informational for progress', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);

    assert.deepStrictEqual(mod.classifyCheckpointRouting('phase'), {
      workflow: 'phase',
      routingClass: 'blocking',
      progressBlocks: true,
      resumeOwnsCleanup: true,
    });
    assert.deepStrictEqual(mod.classifyCheckpointRouting('quick'), {
      workflow: 'quick',
      routingClass: 'blocking',
      progressBlocks: true,
      resumeOwnsCleanup: true,
    });
    assert.deepStrictEqual(mod.classifyCheckpointRouting('generic'), {
      workflow: 'generic',
      routingClass: 'informational',
      progressBlocks: false,
      resumeOwnsCleanup: true,
    });
  });

  test('buildProvenanceSnapshot requires acknowledgement for material checkpoint mismatch', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const snapshot = mod.buildProvenanceSnapshot({
      checkpoint: { workflow: 'generic', runtime: 'codex-cli', hasNarrative: true },
      planning: { currentPhase: '19', nextPhase: '20', completedPhaseCount: 21 },
      git: {
        branch: 'feat/example',
        prState: 'none',
        commitsAheadOfMain: 2,
        commitsAheadOfRemote: 1,
        statusShort: 'M  README.md\n?? tests/new.test.cjs\n',
        staleBranch: true,
        mixedScope: true,
        materialCheckpointMismatch: true,
      },
    });

    assert.strictEqual(snapshot.requiresAcknowledgement, true);
    assert.ok(snapshot.warnings.some((warning) => warning.id === 'checkpoint_mismatch'));
    assert.ok(snapshot.warnings.some((warning) => warning.id === 'stale_branch'));
    assert.strictEqual(snapshot.git.untrackedCount, 1);
    assert.deepStrictEqual(snapshot.checkpoint.routing, {
      workflow: 'generic',
      routingClass: 'informational',
      progressBlocks: false,
      resumeOwnsCleanup: true,
    });
  });
});

describe('Phase 29 lifecycle-state helper', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '29-contract-inventory-and-claim-narrowing'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('derives active milestone posture from roadmap, milestone ledger, audits, and phase artifacts', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '<details>',
        '<summary>✅ v1.2.0 Fork-Honest Launch Hardening</summary>',
        '',
        '- [x] **Phase 28: Tracked Public Proof Closure** — [PROOF-01]',
        '</details>',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 29: Contract Inventory And Claim Narrowing** — [ENGINE-01, ENGINE-05]',
        '- [-] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '- [ ] **Phase 31: Evidence-Gated Closure** — [ENGINE-04]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'SPEC.md'),
      [
        '- [x] **[ENGINE-01]**: Lifecycle mutability boundaries',
        '- [ ] **[ENGINE-02]**: Shared lifecycle evaluator',
        '- [ ] **[ENGINE-05]**: Runtime contract',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      [
        '# Milestones',
        '',
        '## ✅ v1.2.0 — Fork-Honest Launch Hardening',
        '- Status: shipped',
        '',
        '## v1.3.0 Engine Contract Hardening',
        '- Status: in progress',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'v1.2.0-MILESTONE-AUDIT.md'), '# v1.2.0 audit\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '29-contract-inventory-and-claim-narrowing', '29-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '29-contract-inventory-and-claim-narrowing', '29-SUMMARY.md'), '# summary\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '29-contract-inventory-and-claim-narrowing', '30-PLAN.md'), '# phase 30 plan\n');

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.strictEqual(state.currentMilestone.version, 'v1.3.0');
    assert.strictEqual(state.currentMilestone.archiveState, 'active');
    assert.strictEqual(state.counts.completed, 1);
    assert.strictEqual(state.counts.inProgress, 1);
    assert.strictEqual(state.counts.notStarted, 1);
    assert.strictEqual(state.currentPhase.number, '30');
    assert.strictEqual(state.nextPhase.number, '31');
    assert.deepStrictEqual(
      state.incompletePlans.map((artifact) => artifact.displayPath),
      ['29-contract-inventory-and-claim-narrowing/30-PLAN.md']
    );
    assert.deepStrictEqual(state.requirementAlignment.mismatches, ['ENGINE-05 phase complete but SPEC unchecked']);
  });

  test('treats shipped ledger plus matching audit artifact as archived milestone truth', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.2.0 Fork-Honest Launch Hardening',
        '',
        '- [x] **Phase 28: Tracked Public Proof Closure** — [PROOF-01]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '- [x] **[PROOF-01]**: Tracked public proof\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      [
        '# Milestones',
        '',
        '## ✅ v1.2.0 — Fork-Honest Launch Hardening',
        '- Status: shipped',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'v1.2.0-MILESTONE-AUDIT.md'), '# audit\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '29-contract-inventory-and-claim-narrowing', '28-SUMMARY.md'), '# historical summary\n');

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.strictEqual(state.currentMilestone.version, 'v1.2.0');
    assert.strictEqual(state.currentMilestone.shippedInLedger, true);
    assert.strictEqual(state.currentMilestone.hasMatchingAudit, true);
    assert.strictEqual(state.currentMilestone.archiveState, 'archived');
  });
});

describe('Phase 30 lifecycle-preflight helper', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('exports the shared preflight evaluator and CLI command handler', async () => {
    const mod = await importLifecyclePreflightModule();

    assert.strictEqual(typeof mod.evaluateLifecyclePreflight, 'function');
    assert.strictEqual(typeof mod.cmdLifecyclePreflight, 'function');
  });

  test('allows execute when the target phase has a pending plan and explicit phase-status mutation', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 29: Contract Inventory And Claim Narrowing** — [ENGINE-01]',
        '- [ ] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '- [ ] **Phase 31: Evidence-Gated Closure** — [ENGINE-04]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.status, 'allowed');
    assert.strictEqual(output.classification, 'owned_write');
    assert.strictEqual(output.explicitLifecycleMutation, 'phase-status');
    assert.deepStrictEqual(output.ownedWrites, ['summary']);
    assert.strictEqual(output.phase, '30');
  });

  test('blocks verify when the target phase has no summary artifact yet', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 29: Contract Inventory And Claim Narrowing** — [ENGINE-01]',
        '- [-] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, false);
    assert.strictEqual(output.reason, 'missing_summary');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'missing_summary'));
  });

  test('rejects lifecycle mutation requests on read-only progress', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'progress', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, false);
    assert.strictEqual(output.classification, 'read_only');
    assert.strictEqual(output.explicitLifecycleMutation, 'none');
    assert.strictEqual(output.reason, 'illegal_lifecycle_mutation');
  });
});

describe('Phase 31 evidence-gated closure helpers', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '31-evidence-gated-closure'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('normalizes legacy verification proof names into stable evidence kinds', async () => {
    const mod = await importEvidenceContractModule();

    assert.deepStrictEqual(
      mod.normalizeEvidenceKinds(['repo-test', 'code-evidence', 'runtime-check', 'user-confirmation', 'repo-test', 'delivery']),
      ['test', 'code', 'runtime', 'human', 'delivery']
    );
    assert.strictEqual(mod.normalizeEvidenceKind('unknown-proof'), null);
  });

  test('defines closure evidence requirements by surface and delivery posture', async () => {
    const mod = await importEvidenceContractModule();

    assert.deepStrictEqual(
      mod.getEvidenceContract('verify', 'repo_only'),
      {
        surface: 'verify',
        deliveryPosture: 'repo_only',
        supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
        requiredKinds: ['code'],
        recommendedKinds: ['test'],
        blockedSoloKinds: ['human', 'delivery'],
      }
    );

    assert.deepStrictEqual(
      mod.getEvidenceContract('complete-milestone', 'delivery_sensitive'),
      {
        surface: 'complete-milestone',
        deliveryPosture: 'delivery_sensitive',
        supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
        requiredKinds: ['code', 'test', 'runtime', 'delivery'],
        recommendedKinds: ['human'],
        blockedSoloKinds: ['code', 'human'],
      }
    );
  });

  test('lifecycle preflight exposes closure evidence metadata only for closure surfaces', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '- [-] **Phase 31: Evidence-Gated Closure** — [ENGINE-04]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '31-evidence-gated-closure', '31-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '31-evidence-gated-closure', '31-SUMMARY.md'),
      '# summary\n'
    );

    const mod = await importLifecyclePreflightModule();
    const verifyResult = mod.evaluateLifecyclePreflight({
      planningDir: path.join(tmpDir, '.planning'),
      surface: 'verify',
      phaseNumber: '31',
      expectsMutation: 'phase-status',
    });
    const progressResult = mod.evaluateLifecyclePreflight({
      planningDir: path.join(tmpDir, '.planning'),
      surface: 'progress',
    });

    assert.deepStrictEqual(
      verifyResult.closureEvidence,
      {
        surface: 'verify',
        supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
        deliveryPostures: [
          {
            surface: 'verify',
            deliveryPosture: 'repo_only',
            supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
            requiredKinds: ['code'],
            recommendedKinds: ['test'],
            blockedSoloKinds: ['human', 'delivery'],
          },
          {
            surface: 'verify',
            deliveryPosture: 'delivery_sensitive',
            supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
            requiredKinds: ['code', 'runtime'],
            recommendedKinds: ['test', 'delivery', 'human'],
            blockedSoloKinds: ['code', 'human'],
          },
        ],
      }
    );
    assert.strictEqual(progressResult.closureEvidence, null);
  });
});

describe('Phase 32 runtime-freshness helper', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports clean generated surfaces for installed runtimes and ignores absent ones', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);

    const gsdd = await loadGsdd(tmpDir);
    const mod = await importRuntimeFreshnessModule();
    const report = mod.evaluateRuntimeFreshness({
      cwd: tmpDir,
      workflows: gsdd.createCliContext(tmpDir).workflows,
    });

    assert.strictEqual(report.issueCount, 0);
    assert.strictEqual(report.hasInstalledRuntimeSurfaces, true);
    assert.ok(report.groups.some((group) => group.runtime === 'portable' && group.installed));
    assert.ok(report.groups.some((group) => group.runtime === 'claude' && group.installed));
    assert.ok(report.groups.some((group) => group.runtime === 'opencode' && !group.installed));
  });

  test('reports stale and missing generated files against current render output', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);

    fs.appendFileSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'), '\n<!-- local drift -->\n');
    fs.unlinkSync(path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md'));

    const gsdd = await loadGsdd(tmpDir);
    const mod = await importRuntimeFreshnessModule();
    const report = mod.evaluateRuntimeFreshness({
      cwd: tmpDir,
      workflows: gsdd.createCliContext(tmpDir).workflows,
    });

    assert.strictEqual(report.staleCount, 1);
    assert.strictEqual(report.missingCount, 1);
    assert.ok(report.issues.some((entry) => entry.relativePath === '.agents/skills/gsdd-plan/SKILL.md' && entry.status === 'stale'));
    assert.ok(report.issues.some((entry) => entry.relativePath === '.claude/commands/gsdd-plan.md' && entry.status === 'missing'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete command
// ─────────────────────────────────────────────────────────────────────────────

