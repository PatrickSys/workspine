/**
 * Workspine Phase Tests — CLI mechanics, lifecycle, provenance, evidence, freshness
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  createTempProject: createGsddTempProject,
  loadGsdd,
  runCliAsMain,
} = require('./gsdd.helpers.cjs');

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

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

async function importSessionFingerprintModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'session-fingerprint.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

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

  test('phase-status refreshes fingerprint without mutating root .gitignore', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);

    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.planning', '.state-fingerprint.json')), true);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.gitignore')), false);
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

  test('phase-status updates overview and matching Phase Details status together', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      [
        '# Roadmap',
        '',
        '- [-] **Phase 18: Deterministic CLI Mechanics** - goal',
        '',
        '## Phase Details',
        '',
        '### Phase 18: Deterministic CLI Mechanics',
        '',
        '**Goal**: goal',
        '**Status**: [-]',
        '',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const roadmap = fs.readFileSync(roadmapPath, 'utf-8');
    assert.match(roadmap, /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
    assert.match(roadmap, /\*\*Status\*\*: \[x\]/);
  });

  test('phase-status ignores archived duplicate phase entries in details blocks', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      [
        '# Roadmap',
        '',
        '<details open>',
        '<summary>Archived v1.0.0</summary>',
        '',
        '- [x] **Phase 1: Archived Foundation** - old goal',
        '',
        '## Phase Details',
        '',
        '### Phase 1: Archived Foundation',
        '**Status**: [x]',
        '</details>',
        '',
        '### v1.1.0 Active Milestone',
        '',
        '- [ ] **Phase 1: Active Foundation** - new goal',
        '',
        '## Phase Details',
        '',
        '### Phase 1: Active Foundation',
        '**Status**: [ ]',
        '',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '1', 'in_progress']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const roadmap = fs.readFileSync(roadmapPath, 'utf-8');
    assert.match(roadmap, /- \[x\] \*\*Phase 1: Archived Foundation\*\*/);
    assert.match(roadmap, /### Phase 1: Archived Foundation\n\*\*Status\*\*: \[x\]/);
    assert.match(roadmap, /- \[-\] \*\*Phase 1: Active Foundation\*\*/);
    assert.match(roadmap, /### Phase 1: Active Foundation\n\*\*Status\*\*: \[-\]/);
  });

  test('phase-status supports dotted phase identifiers in overview and details', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      [
        '# Roadmap',
        '',
        '- [ ] **Phase 1.2a: Follow-up Closure** - goal',
        '',
        '## Phase Details',
        '',
        '### Phase 1.2a: Follow-up Closure',
        '**Status**: [ ]',
        '',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['phase-status', '01.02a', 'in_progress']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const roadmap = fs.readFileSync(roadmapPath, 'utf-8');
    assert.match(roadmap, /- \[-\] \*\*Phase 1\.2a: Follow-up Closure\*\*/);
    assert.match(roadmap, /\*\*Status\*\*: \[-\]/);
  });

  test('phase-status fails loudly when a matching Phase Details section lacks Status', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const original = [
      '# Roadmap',
      '',
      '- [ ] **Phase 18: Deterministic CLI Mechanics** - goal',
      '',
      '## Phase Details',
      '',
      '### Phase 18: Deterministic CLI Mechanics',
      '**Goal**: goal',
      '',
    ].join('\n');
    fs.writeFileSync(roadmapPath, original);

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.notStrictEqual(result.exitCode, 0, 'unreconciled overview/detail status should fail');
    assert.match(result.output, /Phase Details section but no \*\*Status\*\* line/i);
    assert.strictEqual(fs.readFileSync(roadmapPath, 'utf-8'), original);
  });

  test('phase-status does not treat later non-phase heading status as the target detail status', async () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const original = [
      '# Roadmap',
      '',
      '- [ ] **Phase 18: Deterministic CLI Mechanics** - goal',
      '',
      '## Phase Details',
      '',
      '### Phase 18: Deterministic CLI Mechanics',
      '**Goal**: goal',
      '',
      '### Risks',
      '**Status**: [ ]',
      '',
    ].join('\n');
    fs.writeFileSync(roadmapPath, original);

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.notStrictEqual(result.exitCode, 0, 'unrelated heading status must not be mutated');
    assert.match(result.output, /Phase Details section but no \*\*Status\*\* line/i);
    assert.strictEqual(fs.readFileSync(roadmapPath, 'utf-8'), original);
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

  test('phase-status finds the workspace root when the main CLI runs from a nested directory', async () => {
    const nestedDir = path.join(tmpDir, 'src', 'nested');
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );

    const result = await runCliAsMain(nestedDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
  });

  test('generated helper runtime resolves the workspace root from a nested directory', async () => {
    const nestedDir = path.join(tmpDir, 'packages', 'feature');
    const roadmapPath = path.join(tmpDir, '.planning', 'ROADMAP.md');
    const helperPath = path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs');

    const gsdd = await loadGsdd(tmpDir);
    await gsdd.cmdInit('--auto', '--tools', 'claude');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );

    const output = execFileSync(
      process.execPath,
      [helperPath, 'phase-status', '18', 'done'],
      {
        cwd: nestedDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: '',
        },
      }
    );

    const result = JSON.parse(output);
    assert.strictEqual(result.phase, '18');
    assert.strictEqual(result.changed, true);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
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

  test('helper commands fail loudly when --workspace-root is malformed', async () => {
    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done', '--workspace-root']);
    assert.notStrictEqual(result.exitCode, 0, 'malformed workspace-root flag should fail');
    assert.match(result.output, /Usage: --workspace-root <path>/);
  });

  test('helper commands fail loudly when --workspace-root targets the wrong path', async () => {
    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done', '--workspace-root', path.join(tmpDir, 'missing-root')]);
    assert.notStrictEqual(result.exitCode, 0, 'invalid workspace-root target should fail');
    assert.match(result.output, /Workspace root does not contain \.planning\//);
  });

  test('help text documents file-op, phase-status, and lifecycle-preflight commands', async () => {
    const result = await runCliAsMain(tmpDir, ['help']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /file-op <copy\|delete\|regex-sub>/);
    assert.match(result.output, /phase-status <N> <status>/);
    assert.match(result.output, /lifecycle-preflight <surface> \[phase]/);
  });

  test('repo-local helper executes correctly from a nested cwd', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);

    const helperPath = path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs');
    const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
    fs.mkdirSync(nestedDir, { recursive: true });

    const result = spawnSync(process.execPath, [helperPath, 'help'], {
      cwd: nestedDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const output = result.stdout;
    assert.match(output, /node \.planning\/bin\/gsdd\.mjs file-op/);
    assert.match(output, /node \.planning\/bin\/gsdd\.mjs phase-status/);
    assert.match(output, /node \.planning\/bin\/gsdd\.mjs lifecycle-preflight/);
    assert.doesNotMatch(output, /\.agents\/bin\/gsdd\.mjs/);
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

  test('parseGitStatusShort normalizes rename entries to destination paths for scope checks', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const status = mod.parseGitStatusShort('R  src/old.js -> src/new.js\n');

    assert.strictEqual(status.files.length, 1);
    assert.strictEqual(status.files[0].path, 'src/new.js');
    assert.strictEqual(status.files[0].fromPath, 'src/old.js');
    assert.strictEqual(status.files[0].staged, true);
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

  test('classifyBrownfieldCheckpointPrecedence keeps CHANGE.md primary when strict-match proof is incomplete', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const precedence = mod.classifyBrownfieldCheckpointPrecedence({
      checkpoint: {
        workflow: 'phase',
        phase: '34',
        branch: 'feat/phase-34-identity-story-lock',
      },
      planning: {
        phases: [{ number: '34', status: 'not_started' }],
      },
      brownfieldChange: {
        exists: true,
        currentIntegrationSurface: 'main',
        declaredOwnedPaths: ['distilled/workflows/progress.md'],
      },
      git: {
        branch: 'main',
        statusShort: 'M  README.md\n',
      },
    });

    assert.strictEqual(precedence.primary, 'brownfield_change');
    assert.strictEqual(precedence.strictMatchRequired, true);
    assert.strictEqual(precedence.branchAligned, false);
    assert.strictEqual(precedence.checkpointCanOverrideBrownfield, false);
  });

  test('classifyBrownfieldCheckpointPrecedence lets a phase checkpoint outrank CHANGE.md only on a full strict match', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const precedence = mod.classifyBrownfieldCheckpointPrecedence({
      checkpoint: {
        workflow: 'phase',
        phase: '42',
        branch: 'feat/brownfield-routing',
      },
      planning: {
        phases: [{ number: '42', status: 'in_progress' }],
      },
      brownfieldChange: {
        exists: true,
        currentIntegrationSurface: 'feat/brownfield-routing',
        declaredOwnedPaths: ['distilled/workflows/progress.md', 'distilled/workflows/resume.md'],
      },
      git: {
        branch: 'feat/brownfield-routing',
        statusShort: 'M  distilled/workflows/progress.md\nM  distilled/workflows/resume.md\n',
      },
    });

    assert.strictEqual(precedence.primary, 'checkpoint');
    assert.strictEqual(precedence.branchAligned, true);
    assert.strictEqual(precedence.scopeAligned, true);
    assert.strictEqual(precedence.executionActive, true);
    assert.strictEqual(precedence.checkpointCanOverrideBrownfield, true);
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

  test('buildProvenanceSnapshot requires acknowledgement for material brownfield artifact mismatch', async () => {
    const mod = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'provenance.mjs')).href}?t=${Date.now()}-${Math.random()}`);
    const snapshot = mod.buildProvenanceSnapshot({
      brownfieldChange: {
        exists: true,
        title: 'Brownfield Change: Harden progress continuity',
        currentStatus: 'active',
        currentIntegrationSurface: 'feat/brownfield-continuity',
        nextAction: 'Update progress and resume to read the same CHANGE.md anchor.',
        declaredOwnedPaths: ['distilled/workflows/progress.md', 'distilled/workflows/resume.md'],
      },
      git: {
        branch: 'main',
        prState: 'unknown',
        statusShort: 'M  distilled/workflows/progress.md\nM  README.md\n',
      },
    });

    assert.strictEqual(snapshot.requiresAcknowledgement, true);
    assert.strictEqual(snapshot.integrationSurface.materialBrownfieldMismatch, true);
    assert.ok(snapshot.warnings.some((warning) => warning.id === 'brownfield_branch_mismatch'));
    assert.ok(snapshot.warnings.some((warning) => warning.id === 'brownfield_scope_mismatch'));
    assert.strictEqual(snapshot.routing.primary, 'brownfield_change');
    assert.strictEqual(snapshot.routing.checkpointCanOverrideBrownfield, false);
    assert.deepStrictEqual(snapshot.brownfieldChange.declaredOwnedPaths, [
      'distilled/workflows/progress.md',
      'distilled/workflows/resume.md',
    ]);
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

  test('classifies nested phase plan artifacts by parent phase directory instead of plan filename', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.4.0 Launch Surface Coherence',
        '',
        '- [ ] **Phase 34: Identity And Story Lock** — [LSC-01]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '- [ ] **[LSC-01]**: story lock\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      '# nested plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock', '34-APPROACH.md'),
      '# approach\n'
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.ok(
      state.phaseArtifacts.some((artifact) => artifact.displayPath === '34-identity-and-story-lock/01-PLAN.md' && artifact.kind === 'plan' && artifact.phaseToken === '34'),
      'nested 01-PLAN.md must be attributed to Phase 34 via the parent directory. FIX: prefer phase directory token over plan filename token when classifying nested artifacts.'
    );
  });

  test('does not classify implementation-plan handoff artifacts as executable phase plans', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.6 Release Spine Hardening',
        '',
        '- [x] **Phase 47: Synthesis, Minimal Hardening, And v1.7 Plan** — [REL-04]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '- [x] **[REL-04]**: v1.7 plan\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-PLAN.md'),
      '# executable phase plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-SUMMARY.md'),
      '# phase summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-v1.7-IMPLEMENTATION-PLAN.md'),
      '# next-milestone implementation plan candidate\n'
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.ok(
      state.phaseArtifacts.some((artifact) => artifact.displayPath.endsWith('47-v1.7-IMPLEMENTATION-PLAN.md') && artifact.kind === 'other'),
      'implementation-plan handoff files must stay kind=other. FIX: classify only exact <baseId>-PLAN.md files as executable phase plans.'
    );
    assert.deepStrictEqual(state.incompletePlans, [],
      'implementation-plan handoff files must not create stale in-progress W5 warnings. FIX: keep incompletePlans limited to exact executable PLAN artifacts.');
  });

  test('phase CLI ignores implementation-plan handoff artifacts when finding executable plans', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.6 Release Spine Hardening',
        '',
        '- [x] **Phase 47: Synthesis, Minimal Hardening, And v1.7 Plan** — [REL-04]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-v1.7-IMPLEMENTATION-PLAN.md'),
      '# next-milestone implementation plan candidate\n'
    );

    const result = await runCliAsMain(tmpDir, ['verify', '47']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, false);
    assert.deepStrictEqual(output.plans, [],
      'phase CLI must not treat IMPLEMENTATION-PLAN handoff files as executable plans. FIX: keep phase.mjs classifier exact-name based.');
    assert.strictEqual(output.verified, false);
  });

  test('derives active brownfield change continuity from CHANGE.md and HANDOFF.md without a roadmap', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'brownfield-change'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'brownfield-change', 'CHANGE.md'),
      [
        '---',
        'change: CHANGE-041',
        'status: active',
        '---',
        '',
        '# Brownfield Change: Resume Contract Hardening',
        '',
        '## Goal',
        '',
        '- Keep brownfield continuity honest across progress and resume.',
        '',
        '## Out of Scope',
        '',
        '- No automatic milestone promotion.',
        '',
        '## Structural Promotion Triggers',
        '',
        '- Widen when the change no longer fits one active stream.',
        '- Use `/gsdd-new-milestone` when milestone-owned lifecycle state is required.',
        '',
        '## Current Status',
        '',
        '- Current posture: active',
        '- Current branch / integration surface: feat/brownfield-continuity',
        '- Current owner / runtime: codex-cli',
        '',
        '## Next Action',
        '',
        '- Update progress and resume so they read the same CHANGE.md anchor.',
        '',
        '## PR Slice Ownership',
        '',
        '| Slice | Scope | Owned files / modules | Status |',
        '| --- | --- | --- | --- |',
        '| A | Continuity contract | distilled/workflows/progress.md, distilled/workflows/resume.md | active |',
        '',
        '## Widening Handoff',
        '',
        '- `HANDOFF.md` preserves decision context.',
        '- `VERIFICATION.md` preserves partial proof.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'brownfield-change', 'HANDOFF.md'),
      [
        '---',
        'change: CHANGE-041',
        'updated: 2026-04-21',
        '---',
        '',
        '# Brownfield Change Handoff',
        '',
        '## Active Constraints',
        '',
        '- CHANGE.md stays the operational anchor.',
        '',
        '## Unresolved Uncertainty',
        '',
        '- None yet.',
        '',
        '## Decision Posture',
        '',
        '- Warning in progress, acknowledgement in resume.',
        '',
        '## Anti-Regression',
        '',
        '- Do not turn HANDOFF.md into a second status authority.',
        '',
        '## Next Action',
        '',
        '- If the work widens, carry this judgment into `/gsdd-new-milestone` instead of recreating it.',
      ].join('\n')
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.strictEqual(state.nonPhaseState, 'active_brownfield_change');
    assert.strictEqual(state.brownfieldChange.exists, true);
    assert.strictEqual(state.brownfieldChange.changeId, 'CHANGE-041');
    assert.strictEqual(state.brownfieldChange.title, 'Brownfield Change: Resume Contract Hardening');
    assert.strictEqual(state.brownfieldChange.currentIntegrationSurface, 'feat/brownfield-continuity');
    assert.strictEqual(state.brownfieldChange.nextAction, 'Update progress and resume so they read the same CHANGE.md anchor.');
    assert.deepStrictEqual(state.brownfieldChange.declaredOwnedPaths, [
      'distilled/workflows/progress.md',
      'distilled/workflows/resume.md',
    ]);
    assert.strictEqual(state.brownfieldChange.handoff.activeConstraints, 'CHANGE.md stays the operational anchor.');
    assert.strictEqual(state.brownfieldChange.handoff.antiRegression, 'Do not turn HANDOFF.md into a second status authority.');
    assert.match(state.brownfieldChange.handoff.nextActionContext, /\/gsdd-new-milestone/);
  });

  test('reports overview and Phase Details status mismatches in lifecycle state', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '- [x] **Phase 29: Contract Inventory And Claim Narrowing** — [ENGINE-01]',
        '',
        '## Phase Details',
        '',
        '### Phase 29: Contract Inventory And Claim Narrowing',
        '**Status**: [-]',
        '',
      ].join('\n')
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.deepStrictEqual(state.phaseStatusAlignment.mismatches, [
      'Phase 29 overview status done disagrees with Phase Details status in_progress',
    ]);
    assert.deepStrictEqual(state.requirementAlignment.mismatches, ['ENGINE-01 phase complete but SPEC unchecked']);
  });

  test('ignores archived duplicate overview and detail statuses when checking active roadmap alignment', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '<details>',
        '<summary>Archived v1.0.0</summary>',
        '',
        '- [x] **Phase 1: Archived Foundation** — [OLD-01]',
        '',
        '## Phase Details',
        '',
        '### Phase 1: Archived Foundation',
        '**Status**: [-]',
        '</details>',
        '',
        '### v1.1.0 Active Milestone',
        '',
        '- [ ] **Phase 1: Active Foundation** — [NEW-01]',
        '',
        '## Phase Details',
        '',
        '### Phase 1: Active Foundation',
        '**Status**: [ ]',
        '',
      ].join('\n')
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.planning') });

    assert.deepStrictEqual(state.phaseStatusAlignment.mismatches, []);
    assert.strictEqual(state.counts.total, 1);
    assert.strictEqual(state.nextPhase.number, '1');
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

  test('allows plan when the target phase has no summary and no explicit lifecycle mutation', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [ ] **Phase 30: Deterministic Lifecycle Gates** - [ENGINE-02]',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', '30']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.classification, 'owned_write');
    assert.deepStrictEqual(output.ownedWrites, ['research', 'plan']);
    assert.strictEqual(output.explicitLifecycleMutation, 'none');
    assert.strictEqual(output.phase, '30');
  });

  test('finds lifecycle state from a nested directory', async () => {
    const nestedDir = path.join(tmpDir, 'apps', 'web');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [ ] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );

    const result = await runCliAsMain(nestedDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.phase, '30');
  });

  test('allows execute when the pending plan uses nested 01-PLAN.md naming inside the phase directory', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.4.0 Launch Surface Coherence',
        '',
        '- [ ] **Phase 34: Identity And Story Lock** — [LSC-01]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      '# nested plan\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '34', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.status, 'allowed');
    assert.strictEqual(output.phase, '34');
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

  test('allows read-only progress with planning drift warning', async () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '# Spec v1\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{}\n');

    const fp = await importSessionFingerprintModule();
    fp.writeFingerprint(path.join(tmpDir, '.planning'));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '# Spec v2\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'progress']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.classification, 'read_only');
    assert.strictEqual(output.planningState.classification, 'planning_state_drift');
    assert.ok(output.warnings.some((warning) => warning.code === 'planning_state_drift'));
    assert.strictEqual(output.blockers.length, 0);
  });

  test('blocks owned-write execute preflight when planning drift is present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [ ] **Phase 30: Deterministic Lifecycle Gates** - [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '# Spec v1\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{}\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );

    const fp = await importSessionFingerprintModule();
    fp.writeFingerprint(path.join(tmpDir, '.planning'));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '# Spec v2\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, false);
    assert.strictEqual(output.reason, 'planning_state_drift');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'planning_state_drift'));
    assert.strictEqual(output.planningState.classification, 'planning_state_drift');
    assert.strictEqual(output.planningState.files.find((file) => file.file === 'SPEC.md').status, 'changed');
  });

  test('does not block owned-write execute preflight without a fingerprint baseline', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [ ] **Phase 30: Deterministic Lifecycle Gates** - [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{}\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.planningState.classification, 'no_baseline');
  });

  test('blocks plan when the target phase is already complete', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 30: Deterministic Lifecycle Gates** - [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{}\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', '30']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'phase_already_complete');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'phase_already_complete'));
  });

  test('allows resume without checkpoint when active brownfield CHANGE.md exists', async () => {
    const changeDir = path.join(tmpDir, '.planning', 'brownfield-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
      '---',
      'change: CHANGE-041',
      'status: active',
      '---',
      '',
      '# Brownfield Change: Resume Contract Hardening',
      '',
      '## Current Status',
      '- Current posture: active',
      '- Current branch / integration surface: feat/brownfield-continuity',
      '',
      '## Next Action',
      '- Continue the brownfield change.',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'resume']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.status, 'allowed');
    assert.strictEqual(output.reason, null);
  });

  test('warns when lifecycle preflight sees overview/detail status mismatch', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [-] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '',
        '## Phase Details',
        '',
        '### Phase 30: Deterministic Lifecycle Gates',
        '**Status**: [x]',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some((warning) => warning.code === 'roadmap_phase_status_mismatch'));
  });

  test('blocks terminal milestone preflight when roadmap overview/detail status mismatches', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '',
        '## Phase Details',
        '',
        '### Phase 30: Deterministic Lifecycle Gates',
        '**Status**: [-]',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-VERIFICATION.md'),
      '# verification\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'audit-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'roadmap_phase_status_mismatch');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'roadmap_phase_status_mismatch'));
  });

  test('blocks complete-milestone preflight when roadmap overview/detail status mismatches', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '',
        '## Phase Details',
        '',
        '### Phase 30: Deterministic Lifecycle Gates',
        '**Status**: [-]',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '30-deterministic-lifecycle-gates', '30-VERIFICATION.md'),
      '# verification\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'roadmap_phase_status_mismatch');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'roadmap_phase_status_mismatch'));
  });

  test('blocks complete-milestone preflight when a passed audit lacks release claim metadata', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'v1.6-MILESTONE-AUDIT.md'),
      ['---', 'milestone: v1.6', 'status: passed', '---', '', '# audit'].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'missing_release_claim_contract');
    assert.ok(output.blockers[0].message.includes('release_claim_posture'));
  });

  test('blocks complete-milestone preflight on invalid waivers and missing release evidence', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      releaseClaimPosture: 'delivery_supported_closeout',
      requiredKinds: ['code', 'test', 'runtime', 'delivery'],
      observedKinds: ['code', 'test', 'runtime'],
      missingKinds: ['delivery'],
      waivers: ['delivery'],
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'missing_required_release_evidence'));
    assert.ok(output.blockers.some((blocker) => blocker.code === 'invalid_release_waivers'));
  });

  test('blocks complete-milestone preflight on unsupported release claims without deferral', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      unsupportedClaims: ['generated surface freshness'],
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'unsupported_release_claims'));
  });

  test('blocks complete-milestone preflight when deferral names a different unsupported claim', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      unsupportedClaims: ['generated surface freshness', 'public support'],
      deferrals: ['public support deferred to a later delivery milestone'],
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    const unsupportedBlocker = output.blockers.find((blocker) => blocker.code === 'unsupported_release_claims');
    assert.ok(unsupportedBlocker);
    assert.match(unsupportedBlocker.message, /generated surface freshness/);
    assert.doesNotMatch(unsupportedBlocker.message, /public support/);
  });

  test('blocks complete-milestone preflight when deferral is too vague', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      unsupportedClaims: ['public support'],
      deferrals: ['public'],
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    const unsupportedBlocker = output.blockers.find((blocker) => blocker.code === 'unsupported_release_claims');
    assert.ok(unsupportedBlocker);
    assert.match(unsupportedBlocker.message, /public support/);
  });

  test('allows repo closeout when unrelated generated-surface contradiction failed', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'not_applicable',
        runtime: 'not_applicable',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'failed',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
  });

  test('blocks repo closeout when claim-scoped evidence contradiction failed', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      contradictionChecks: {
        evidence: 'failed',
        public_surface: 'not_applicable',
        runtime: 'not_applicable',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'not_applicable',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'failed_release_contradiction_checks'));
  });

  test('blocks repo closeout when public-surface contradiction failed', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'failed',
        runtime: 'not_applicable',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'not_applicable',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'failed_release_contradiction_checks'));
  });

  test('blocks runtime-validated closeout when generated-surface contradiction failed', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      releaseClaimPosture: 'runtime_validated_closeout',
      requiredKinds: ['code', 'test', 'runtime'],
      observedKinds: ['code', 'test', 'runtime'],
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'not_applicable',
        runtime: 'passed',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'failed',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'failed_release_contradiction_checks'));
  });

  test('blocks runtime-validated closeout when required_kinds omits release-claim runtime evidence', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      releaseClaimPosture: 'runtime_validated_closeout',
      requiredKinds: ['code', 'test'],
      observedKinds: ['code', 'test', 'runtime'],
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'not_applicable',
        runtime: 'passed',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'passed',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    const evidenceBlocker = output.blockers.find((blocker) => blocker.code === 'invalid_release_evidence_contract');
    assert.ok(evidenceBlocker);
    assert.match(evidenceBlocker.message, /runtime/);
  });

  test('blocks complete-milestone preflight when required contradiction checks are missing', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      contradictionChecks: {
        evidence: 'passed',
        planning_drift: 'passed',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'missing_release_contradiction_checks'));
  });

  test('blocks complete-milestone preflight on unknown contradiction check keys', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'not_applicable',
        runtime: 'not_applicable',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'not_applicable',
        security: 'failed',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    const unknownBlocker = output.blockers.find((blocker) => blocker.code === 'unknown_release_contradiction_checks');
    assert.ok(unknownBlocker);
    assert.match(unknownBlocker.message, /security/);
  });

  test('blocks complete-milestone preflight when delivery posture evidence is under-observed', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      deliveryPosture: 'delivery_sensitive',
      releaseClaimPosture: 'repo_closeout',
      requiredKinds: ['code', 'test', 'runtime', 'delivery'],
      observedKinds: ['code', 'test'],
      missingKinds: [],
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    const evidenceBlocker = output.blockers.find((blocker) => blocker.code === 'missing_required_release_evidence');
    assert.ok(evidenceBlocker);
    assert.match(evidenceBlocker.message, /runtime/);
    assert.match(evidenceBlocker.message, /delivery/);
  });

  test('blocks complete-milestone preflight on incompatible release and delivery postures', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      deliveryPosture: 'repo_only',
      releaseClaimPosture: 'delivery_supported_closeout',
      requiredKinds: ['code', 'test', 'runtime', 'delivery'],
      observedKinds: ['code', 'test', 'runtime', 'delivery'],
    });

    let result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);
    let output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'incompatible_release_claim_posture'));

    writeMilestoneAudit(tmpDir, {
      deliveryPosture: 'delivery_sensitive',
      releaseClaimPosture: 'repo_closeout',
      requiredKinds: ['code', 'test', 'runtime', 'delivery'],
      observedKinds: ['code', 'test', 'runtime', 'delivery'],
    });
    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);
    output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'incompatible_release_claim_posture'));
  });

  test('blocks complete-milestone preflight on invalid release claim posture', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      releaseClaimPosture: 'delivery_supported_closout',
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.blockers.some((blocker) => blocker.code === 'invalid_release_claim_posture'));
  });

  test('blocks complete-milestone preflight on invalid evidence kind values', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      requiredKinds: ['code', 'test', 'banana'],
      observedKinds: ['code', 'test'],
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    const evidenceKindBlocker = output.blockers.find((blocker) => blocker.code === 'invalid_release_evidence_kinds');
    assert.ok(evidenceKindBlocker);
    assert.match(evidenceKindBlocker.message, /required_kinds: banana/);
  });

  test('allows complete-milestone preflight when passed audit release contract is satisfied', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {});

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.reason, null);
  });

  test('parses quoted release metadata and comma-containing inline lists', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    writeMilestoneAudit(tmpDir, {
      deliveryPosture: '"repo_only"',
      releaseClaimPosture: "'repo_closeout'",
      unsupportedClaims: ['"generated surface freshness, helper output"'],
      deferrals: ['"generated surface freshness, helper output lacks runtime evidence until a later milestone"'],
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'not_applicable',
        runtime: 'not_applicable',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'failed',
      },
    });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
  });

  test('parses structured YAML deferrals for unsupported release claims', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'v1.6-MILESTONE-AUDIT.md'),
      [
        '---',
        'milestone: v1.6',
        'status: passed',
        'delivery_posture: repo_only',
        'release_claim_posture: repo_closeout',
        'evidence_contract:',
        '  required_kinds: [code, test]',
        '  observed_kinds: [code, test]',
        '  missing_kinds: []',
        'release_claim_contract:',
        '  unsupported_claims:',
        '    - public support',
        '  waivers: []',
        '  deferrals:',
        '    - claim: public support',
        '      missing_kinds: [delivery]',
        '      later: next delivery milestone',
        '  contradiction_checks:',
        '    evidence: passed',
        '    public_surface: not_applicable',
        '    runtime: not_applicable',
        '    delivery: not_applicable',
        '    planning_drift: passed',
        '    generated_surface: failed',
        '---',
        '',
        '# audit',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
  });

  test('parses quoted audit status and wider YAML indentation', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'v1.6-MILESTONE-AUDIT.md'),
      [
        '---',
        'milestone: v1.6',
        'status: "passed" # audited successfully',
        'delivery_posture: repo_only',
        'release_claim_posture: repo_closeout',
        'evidence_contract:',
        '    required_kinds: [code, test]',
        '    observed_kinds: [code, test]',
        '    missing_kinds: []',
        'release_claim_contract:',
        '    unsupported_claims: []',
        '    waivers: []',
        '    deferrals: []',
        '    contradiction_checks:',
        '        evidence: passed',
        '        public_surface: not_applicable',
        '        runtime: not_applicable',
        '        delivery: not_applicable',
        '        planning_drift: passed',
        '        generated_surface: failed',
        '---',
        '',
        '# audit',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
  });

  test('parses release metadata with YAML inline comments', async () => {
    writeCompletedMilestoneFixture(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'v1.6-MILESTONE-AUDIT.md'),
      [
        '---',
        'milestone: v1.6',
        'status: passed',
        'delivery_posture: repo_only # local closeout only',
        'release_claim_posture: repo_closeout # no public delivery claim',
        'evidence_contract: # D50 closeout proof',
        '  required_kinds:',
        '    - code # implementation exists',
        '    - test # regression coverage exists',
        '  observed_kinds: [code, test] # observed during audit',
        '  missing_kinds: [] # none',
        'release_claim_contract: # claim boundary',
        '  unsupported_claims: [] # none',
        '  waivers: [] # none',
        '  deferrals: [] # none',
        '  contradiction_checks:',
        '    evidence: passed # repo evidence aligned',
        '    public_surface: not_applicable # no public claim',
        '    runtime: not_applicable # no runtime claim',
        '    delivery: not_applicable # no delivery claim',
        '    planning_drift: passed # planning current',
        '    generated_surface: failed # unrelated generated freshness claim',
        '---',
        '',
        '# audit',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
  });
});

function writeCompletedMilestoneFixture(tmpDir) {
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '48-generated-helper-and-closeout-contract-parity'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    [
      '# Roadmap',
      '',
      '### v1.6 Release Spine Hardening',
      '',
      '- [x] **Phase 48: Generated Helper And Closeout Contract Parity** — [REL-04]',
    ].join('\n')
  );
  fs.writeFileSync(path.join(tmpDir, '.planning', 'SPEC.md'), '- [x] **[REL-04]**: release spine\n');
  fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '48-generated-helper-and-closeout-contract-parity', '48-PLAN.md'), '# plan\n');
  fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '48-generated-helper-and-closeout-contract-parity', '48-SUMMARY.md'), '# summary\n');
  fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '48-generated-helper-and-closeout-contract-parity', '48-VERIFICATION.md'), '# verification\n');
}

function writeMilestoneAudit(tmpDir, {
  deliveryPosture = null,
  releaseClaimPosture = 'repo_closeout',
  requiredKinds = ['code', 'test'],
  observedKinds = ['code', 'test'],
  missingKinds = [],
  unsupportedClaims = [],
  waivers = [],
  deferrals = [],
  contradictionChecks = {
    evidence: 'passed',
    public_surface: 'not_applicable',
    runtime: 'not_applicable',
    delivery: 'not_applicable',
    planning_drift: 'passed',
    generated_surface: 'not_applicable',
  },
} = {}) {
  const list = (items) => `[${items.join(', ')}]`;
  const resolvedDeliveryPosture = deliveryPosture
    || (releaseClaimPosture === 'delivery_supported_closeout' ? 'delivery_sensitive' : 'repo_only');
  const contradictionLines = Object.entries(contradictionChecks)
    .map(([name, status]) => `    ${name}: ${status}`)
    .join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'v1.6-MILESTONE-AUDIT.md'),
    [
      '---',
      'milestone: v1.6',
      'status: passed',
      `delivery_posture: ${resolvedDeliveryPosture}`,
      `release_claim_posture: ${releaseClaimPosture}`,
      'evidence_contract:',
      `  required_kinds: ${list(requiredKinds)}`,
      `  observed_kinds: ${list(observedKinds)}`,
      `  missing_kinds: ${list(missingKinds)}`,
      'release_claim_contract:',
      `  unsupported_claims: ${list(unsupportedClaims)}`,
      `  waivers: ${list(waivers)}`,
      `  deferrals: ${list(deferrals)}`,
      '  contradiction_checks:',
      contradictionLines,
      '---',
      '',
      '# audit',
    ].join('\n')
  );
}

describe('verify command nested phase plans', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('finds nested 01-PLAN.md when verifying a phase', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      [
        '<task id="34-01" type="auto">',
        '  <files>',
        '    - MODIFY: src/example.js',
        '  </files>',
        '</task>',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'example.js'),
      ['const a = 1;', 'const b = 2;', 'export const sum = a + b;'].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '34']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '34');
    assert.deepStrictEqual(output.artifacts.map((artifact) => artifact.file), ['src/example.js']);
    assert.strictEqual(output.allExist, true);
  });

  test('reports RENAME and MOVE plan artifacts by destination path', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      [
        '<task id="34-01" type="auto">',
        '  <files>',
        '    - RENAME: src/old.js -> src/new.js',
        '    - MOVE: src/a.js -> src/b.js',
        '  </files>',
        '</task>',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'new.js'), 'export const renamed = true;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'export const moved = true;\n');

    const result = await runCliAsMain(tmpDir, ['verify', '34']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.artifacts, [
      { operation: 'rename', from: 'src/old.js', to: 'src/new.js', file: 'src/new.js', exists: true },
      { operation: 'move', from: 'src/a.js', to: 'src/b.js', file: 'src/b.js', exists: true },
    ]);
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

  test('defines release claim postures without adding evidence kinds', async () => {
    const mod = await importEvidenceContractModule();

    assert.deepStrictEqual(mod.RELEASE_CLAIM_POSTURES, [
      'repo_closeout',
      'runtime_validated_closeout',
      'delivery_supported_closeout',
    ]);

    const runtimeClaim = mod.getReleaseClaimContract('audit-milestone', 'runtime_validated_closeout');
    assert.strictEqual(runtimeClaim.releaseClaimPosture, 'runtime_validated_closeout');
    assert.strictEqual(runtimeClaim.deliveryPosture, 'repo_only');
    assert.deepStrictEqual(runtimeClaim.supportedKinds, ['code', 'test', 'runtime', 'delivery', 'human']);
    assert.deepStrictEqual(runtimeClaim.requiredKinds, ['code', 'test', 'runtime']);
    assert.match(runtimeClaim.waiverRule, /never satisfy missing required evidence/i);
    assert.ok(runtimeClaim.contradictionCategories.includes('generated_surface'));

    const deliveryClaim = mod.getReleaseClaimContract('complete-milestone', 'delivery_supported_closeout');
    assert.strictEqual(deliveryClaim.deliveryPosture, 'delivery_sensitive');
    assert.deepStrictEqual(deliveryClaim.requiredKinds, ['code', 'test', 'runtime', 'delivery']);

    assert.strictEqual(mod.normalizeReleaseClaimPosture('unknown'), null);
    assert.throws(
      () => mod.getReleaseClaimContract('complete-milestone', 'unknown'),
      /Unsupported release claim posture/
    );
  });

  test('unsupported stronger release claims must downgrade or defer instead of using waiver prose', async () => {
    const mod = await importEvidenceContractModule();

    const unsupportedDelivery = mod.evaluateReleaseClaimPosture({
      surface: 'complete-milestone',
      releaseClaimPosture: 'delivery_supported_closeout',
      observedKinds: ['code', 'test', 'runtime'],
      waivedKinds: ['delivery'],
    });

    assert.deepStrictEqual(unsupportedDelivery.missingKinds, ['delivery']);
    assert.deepStrictEqual(unsupportedDelivery.invalidWaivers, ['delivery']);
    assert.strictEqual(unsupportedDelivery.status, 'unsupported');
    assert.strictEqual(unsupportedDelivery.disposition, 'downgrade_or_defer');
    assert.strictEqual(unsupportedDelivery.downgradeTo, 'runtime_validated_closeout');
    assert.deepStrictEqual(unsupportedDelivery.deferredClaims, [
      { claim: 'delivery_supported_closeout', missingKinds: ['delivery'] },
    ]);

    const supportedRepo = mod.evaluateReleaseClaimPosture({
      surface: 'audit-milestone',
      releaseClaimPosture: 'repo_closeout',
      observedKinds: ['code', 'test', 'human'],
    });

    assert.strictEqual(supportedRepo.status, 'supported');
    assert.strictEqual(supportedRepo.disposition, 'proceed');
    assert.deepStrictEqual(supportedRepo.missingKinds, []);
  });

  test('release closeout contract fails closed on unknown contradiction check keys', async () => {
    const mod = await importEvidenceContractModule();

    const result = mod.evaluateReleaseClaimCloseoutContract({
      surface: 'complete-milestone',
      releaseClaimPosture: 'repo_closeout',
      observedKinds: ['code', 'test'],
      contradictionChecks: {
        evidence: 'passed',
        public_surface: 'not_applicable',
        runtime: 'not_applicable',
        delivery: 'not_applicable',
        planning_drift: 'passed',
        generated_surface: 'not_applicable',
        security: 'failed',
      },
    });

    assert.strictEqual(result.status, 'unsupported');
    assert.deepStrictEqual(result.unknownContradictionChecks, ['security']);
    assert.ok(result.blockers.some((blocker) => blocker.code === 'unknown_release_contradiction_checks'));
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
            requiredKinds: ['code', 'runtime', 'delivery'],
            recommendedKinds: ['test', 'human'],
            blockedSoloKinds: ['code', 'human'],
          },
        ],
        releaseClaimPostures: [
          {
            surface: 'verify',
            releaseClaimPosture: 'repo_closeout',
            deliveryPosture: 'repo_only',
            supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
            requiredKinds: ['code'],
            requiredClaimKinds: [],
            allowedClaim: 'Repo-local milestone or phase closeout is supported by planning and repository artifacts only.',
            invalidClaim: 'Do not imply runtime validation, delivery, publication, or public support from repo-local closeout alone.',
            waiverRule: 'Waivers may only narrow the release claim posture or defer an unsupported claim; they never satisfy missing required evidence for the stronger claim.',
            deferralRule: 'Deferrals must name the unsupported claim, missing evidence kinds, and later workflow or milestone candidate when known.',
            contradictionCategories: [
              'evidence',
              'public_surface',
              'runtime',
              'delivery',
              'planning_drift',
              'generated_surface',
            ],
          },
          {
            surface: 'verify',
            releaseClaimPosture: 'runtime_validated_closeout',
            deliveryPosture: 'repo_only',
            supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
            requiredKinds: ['code', 'runtime'],
            requiredClaimKinds: ['runtime'],
            allowedClaim: 'Runtime behavior or a runtime surface was directly executed and observed for the named runtime or surface.',
            invalidClaim: 'Do not generalize validation from one runtime or generated surface to another.',
            waiverRule: 'Waivers may only narrow the release claim posture or defer an unsupported claim; they never satisfy missing required evidence for the stronger claim.',
            deferralRule: 'Deferrals must name the unsupported claim, missing evidence kinds, and later workflow or milestone candidate when known.',
            contradictionCategories: [
              'evidence',
              'public_surface',
              'runtime',
              'delivery',
              'planning_drift',
              'generated_surface',
            ],
          },
          {
            surface: 'verify',
            releaseClaimPosture: 'delivery_supported_closeout',
            deliveryPosture: 'delivery_sensitive',
            supportedKinds: ['code', 'test', 'runtime', 'delivery', 'human'],
            requiredKinds: ['code', 'runtime', 'delivery'],
            requiredClaimKinds: [],
            allowedClaim: 'Externally consumed release, support, install, or delivery claims are supported by the delivery-sensitive evidence bar.',
            invalidClaim: 'Do not imply merge, package, tag, GitHub Release, publication, generated-surface freshness, or public support without matching delivery evidence.',
            waiverRule: 'Waivers may only narrow the release claim posture or defer an unsupported claim; they never satisfy missing required evidence for the stronger claim.',
            deferralRule: 'Deferrals must name the unsupported claim, missing evidence kinds, and later workflow or milestone candidate when known.',
            contradictionCategories: [
              'evidence',
              'public_surface',
              'runtime',
              'delivery',
              'planning_drift',
              'generated_surface',
            ],
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
    fs.unlinkSync(path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs'));

    const gsdd = await loadGsdd(tmpDir);
    const mod = await importRuntimeFreshnessModule();
    const report = mod.evaluateRuntimeFreshness({
      cwd: tmpDir,
      workflows: gsdd.createCliContext(tmpDir).workflows,
    });

    assert.strictEqual(report.staleCount, 1);
    assert.strictEqual(report.missingCount, 1);
    assert.ok(report.issues.some((entry) => entry.relativePath === '.agents/skills/gsdd-plan/SKILL.md' && entry.status === 'stale'));
    assert.ok(report.issues.some((entry) => entry.relativePath === '.planning/bin/gsdd.mjs' && entry.status === 'missing'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete command
// ─────────────────────────────────────────────────────────────────────────────
