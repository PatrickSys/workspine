/**
 * Workspine Phase Tests — CLI mechanics, lifecycle, provenance, evidence, freshness
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
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

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeProjectFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function snapshotTree(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(prefix, entry.name);
      const fullPath = path.join(directory, entry.name);
      if (fs.lstatSync(fullPath).isSymbolicLink()) return [{ path: relativePath.replace(/\\/g, '/'), link: fs.readlinkSync(fullPath) }];
      return entry.isDirectory()
        ? [{ path: `${relativePath.replace(/\\/g, '/')}/`, directory: true }, ...snapshotTree(fullPath, relativePath)]
        : [{ path: relativePath.replace(/\\/g, '/'), bytes: fs.readFileSync(fullPath) }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function initCandidateProofGitRepository(root, artifactPath = 'src/candidate.js') {
  git(['init'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test User'], root);
  git(['config', 'core.autocrlf', 'false'], root);
  writeProjectFile(root, '.gitignore', '.work/\n');
  writeProjectFile(root, artifactPath, 'export const candidate = true;\n');
  git(['add', '.gitignore', artifactPath], root);
  git(['commit', '-m', 'candidate fixture'], root);
}

function captureCandidateReceipt(root, planPath, artifactPath, { evidenceKind = 'runtime', excludePaths = ['.work', '.planning'] } = {}) {
  const pathspecs = ['.', ...excludePaths.map((entry) => `:(exclude,literal)${entry.replace(/\\/g, '/')}`)];
  const status = execFileSync('git', ['-c', 'core.quotePath=true', 'status', '--porcelain=v1', '--untracked-files=all', '--', ...pathspecs], {
    cwd: root,
    encoding: 'utf-8',
  }).replace(/\r\n/g, '\n');
  return {
    commit: git(['rev-parse', '--verify', 'HEAD'], root),
    dirtyFingerprint: `sha256:${sha256(Buffer.from(status, 'utf-8'))}`,
    dirtyEntries: status.split('\n').filter(Boolean).length,
    planSha256: `sha256:${sha256(fs.readFileSync(path.join(root, '.work', 'phases', planPath)))}`,
    artifactSha256: `sha256:${sha256(fs.readFileSync(path.join(root, artifactPath)))}`,
    runtimeIdentity: evidenceKind === 'runtime'
      ? `artifact:${artifactPath}`
      : 'not_applicable: repeatable test evidence has no live runtime identity',
  };
}

function writeCandidateProofFixture(root, phaseName, { evidenceKind = 'runtime', runtimeIdentity } = {}) {
  const phaseDir = path.join(root, '.work', 'phases', phaseName);
  const planRelativePath = `${phaseName}/01-PLAN.md`;
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), [
    '---', 'browser_proof_required: true', 'browser_proof_rationale: rendered proof.', '---',
    '## Browser Proof Plan', 'Routes/states: /dashboard.', 'Viewports: desktop.', 'Runtime path: agent-browser.',
    `Evidence kind: ${evidenceKind}`, 'Evidence command: npm run test:e2e', 'Candidate identity:', '  - src/candidate.js',
    'Observations: dashboard renders.', 'Artifacts: local-only.', 'Claim limit: dashboard only.',
  ].join('\n'));
  const receipt = captureCandidateReceipt(root, planRelativePath, 'src/candidate.js', { evidenceKind });
  fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), [
    '## Browser Proof Observation', `- Plan: ${planRelativePath}`, '- Flow: /dashboard.', '- Viewports: desktop.',
    '- Runtime path: agent-browser.', `- Evidence kind: ${evidenceKind}`, '- Evidence command: npm run test:e2e',
    `- Candidate commit: ${receipt.commit}`, `- Candidate dirty fingerprint: ${receipt.dirtyFingerprint}`, `- Candidate dirty entries: ${receipt.dirtyEntries}`,
    `- Plan sha256: ${receipt.planSha256}`, '- Candidate artifacts:', `  - src/candidate.js | ${receipt.artifactSha256}`,
    `- Runtime identity: ${runtimeIdentity || receipt.runtimeIdentity}`, '- Observed: dashboard renders.', '- Artifacts: local-only.', '- Result: passed', '- Claim limit: dashboard only.',
  ].join('\n'));
  return { phaseDir, receipt };
}

function writePassedStandardChain(root, phase = '18') {
  const dir = path.join(root, '.work', 'phases', `${phase}-closure`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${phase}-PLAN.md`), '# plan\n');
  fs.writeFileSync(path.join(dir, `${phase}-SUMMARY.md`), '# summary\n');
  fs.writeFileSync(path.join(dir, `${phase}-VERIFICATION.md`), '---\nstatus: passed\n---\n# verification\n');
}

function initPreflightGitWorkspace(root) {
  git(['init'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test User'], root);
  git(['config', 'core.autocrlf', 'false'], root);
  writeProjectFile(root, '.gitignore', '.work/\n');
  writeProjectFile(root, 'README.md', '# Test repo\n');
  git(['add', '.gitignore', 'README.md'], root);
  git(['commit', '-m', 'initial'], root);
  try {
    git(['branch', '-M', 'main'], root);
  } catch {
    // The preflight tests do not depend on the branch name.
  }
}

function writePreflightPhase(root, phase = '30') {
  const phaseDir = path.join(root, '.work', 'phases', `${phase}-deterministic-lifecycle-gates`);
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.work', 'ROADMAP.md'),
    [
      '# Roadmap',
      '',
      '### v1.3.0 Engine Contract Hardening',
      '',
      `- [ ] **Phase ${phase}: Deterministic Lifecycle Gates** - [ENGINE-02]`,
    ].join('\n')
  );
  fs.writeFileSync(path.join(root, '.work', 'SPEC.md'), '# Spec\n');
  fs.writeFileSync(path.join(root, '.work', 'config.json'), '{}\n');
  fs.writeFileSync(path.join(phaseDir, `${phase}-PLAN.md`), '# plan\n');
}

function writeWorkMilestonePhase(root, phase = '7', { execute = false, verify = false } = {}) {
  const phaseDir = path.join(root, '.work', 'milestone', 'phases', `${phase}-easy-global-install-auto-mode`);
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(root, '.work', 'milestone', 'ROADMAP.md'),
    [
      '# Work Milestone',
      '',
      '## Phases',
      '',
      `- [ ] **Phase ${phase}: Easy Global Install Auto Mode**`,
    ].join('\n')
  );
  fs.writeFileSync(path.join(phaseDir, `${phase}-PLAN.md`), '# plan\n');
  if (execute) fs.writeFileSync(path.join(phaseDir, `${phase}-EXECUTE.md`), '# execute\n');
  if (verify) fs.writeFileSync(path.join(phaseDir, `${phase}-VERIFY.md`), '# verify\n');
}

function writeWorkMilestonePlanOnly(root, phase = '7', status = 'planned') {
  const phaseDir = path.join(root, '.work', 'milestones', 'active-milestone', 'phases', `${phase}-decisions`);
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(path.join(root, '.work', 'milestones', 'active-milestone', 'MILESTONE.md'), '---\nstatus: in_progress\n---\n');
  fs.writeFileSync(path.join(phaseDir, 'PLAN.md'), `---\nstatus: ${status}\n---\n# plan\n`);
  return phaseDir;
}

async function importLifecycleStateModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-state.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importLifecyclePreflightModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-preflight.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importControlMapModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'control-map.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importRenderingModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'rendering.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importRuntimeFreshnessModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'runtime-freshness.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

async function importPhaseModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'phase.mjs')).href}?t=${Date.now()}-${Math.random()}`);
}

describe('Phase 18 deterministic CLI mechanics', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('file-op copy writes a checkpoint backup inside the workspace', async () => {
    const source = path.join(tmpDir, '.work', '.continue-here.md');
    const backup = path.join(tmpDir, '.work', '.continue-here.bak');
    fs.writeFileSync(source, '# checkpoint\n');

    const result = await runCliAsMain(tmpDir, ['file-op', 'copy', '.work/.continue-here.md', '.work/.continue-here.bak']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'copy');
    assert.strictEqual(output.changed, true);
    assert.strictEqual(fs.readFileSync(backup, 'utf-8'), '# checkpoint\n');
  });

  test('file-op delete supports cleanup no-op semantics for missing files', async () => {
    const result = await runCliAsMain(tmpDir, ['file-op', 'delete', '.work/.continue-here.bak', '--missing', 'ok']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'delete');
    assert.strictEqual(output.changed, false);
    assert.strictEqual(output.reason, 'missing_target');
  });

  test('file-op regex-sub performs deterministic text mutation', async () => {
    const target = path.join(tmpDir, '.work', 'note.txt');
    fs.writeFileSync(target, 'manual checkpoint cleanup\nmanual checkpoint cleanup\n');

    const result = await runCliAsMain(tmpDir, ['file-op', 'regex-sub', '.work/note.txt', 'manual checkpoint cleanup', 'gsdd file-op delete --missing ok']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'regex-sub');
    assert.strictEqual(output.replacements, 2);
    assert.match(fs.readFileSync(target, 'utf-8'), /gsdd file-op delete --missing ok/);
  });

  test('file-op regex-sub reports one replacement when flags are non-global', async () => {
    const target = path.join(tmpDir, '.work', 'single.txt');
    fs.writeFileSync(target, 'phase 18\nphase 18\n');

    const result = await runCliAsMain(tmpDir, ['file-op', 'regex-sub', '.work/single.txt', 'phase', 'step', '--flags', 'i']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.operation, 'regex-sub');
    assert.strictEqual(output.replacements, 1);
    assert.strictEqual(output.changed, true);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), 'step 18\nphase 18\n');
  });

  test('file-op delete fails loudly when a contract-significant file is missing', async () => {
    const result = await runCliAsMain(tmpDir, ['file-op', 'delete', '.work/.continue-here.md']);
    assert.notStrictEqual(result.exitCode, 0, 'missing delete should fail');
    assert.match(result.output, /does not exist/i);
  });

  test('file-op remains an explicit repair primitive across a legacy root', async () => {
    const legacyDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'repair.txt'), 'repair me\n');
    const result = await runCliAsMain(tmpDir, ['file-op', 'copy', '.planning/repair.txt', '.planning/repair.bak']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(fs.readFileSync(path.join(legacyDir, 'repair.bak'), 'utf8'), 'repair me\n');
  });

  test('phase writers refuse supported legacy authority without changing it', async () => {
    fs.rmSync(path.join(tmpDir, '.work'), { recursive: true, force: true });
    const legacyDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    fs.writeFileSync(path.join(legacyDir, 'ROADMAP.md'), '- [ ] **Phase 18: Legacy**\n');
    const before = fs.readFileSync(path.join(legacyDir, 'ROADMAP.md'));
    for (const args of [
      ['phase-status', '18', 'done'],
      ['find-phase', '18'],
      ['verify', '18'],
      ['scaffold', 'phase', '18', 'legacy'],
      ['lifecycle-preflight', 'progress'],
    ]) {
      const result = await runCliAsMain(tmpDir, args);
      assert.strictEqual(result.exitCode, 1, result.output);
      assert.match(result.output, /npx -y workspine init --migrate/);
      assert.deepStrictEqual(fs.readFileSync(path.join(legacyDir, 'ROADMAP.md')), before);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work')), false);
    }
  });

  test('phase-status updates ROADMAP phase status markers through the helper', async () => {
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n- [ ] **Phase 19: Workflow UX & Provenance** - goal\n'
    );

    let result = await runCliAsMain(tmpDir, ['phase-status', '18', 'in_progress']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[-\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);

    writePassedStandardChain(tmpDir, '18');
    result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
  });

  test('phase-status supports letter-suffixed phase identifiers already used in roadmap truth', async () => {
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
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
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n* [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );
    writePassedStandardChain(tmpDir, '18');

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /\* \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
  });

  test('phase-status updates overview and matching Phase Details status together', async () => {
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
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
    writePassedStandardChain(tmpDir, '18');

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const roadmap = fs.readFileSync(roadmapPath, 'utf-8');
    assert.match(roadmap, /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
    assert.match(roadmap, /\*\*Status\*\*: \[x\]/);
  });

  test('phase-status ignores archived duplicate phase entries in details blocks', async () => {
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
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
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
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
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
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
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
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
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    const original = '# Roadmap\n\n- [x] **Phase 18: Deterministic CLI Mechanics** - goal\n';
    fs.writeFileSync(roadmapPath, original);
    writePassedStandardChain(tmpDir, '18');

    const result = await runCliAsMain(tmpDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.changed, false);
    assert.strictEqual(fs.readFileSync(roadmapPath, 'utf-8'), original);
  });

  test('phase-status finds the workspace root when the main CLI runs from a nested directory', async () => {
    const nestedDir = path.join(tmpDir, 'src', 'nested');
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );
    writePassedStandardChain(tmpDir, '18');

    const result = await runCliAsMain(nestedDir, ['phase-status', '18', 'done']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(fs.readFileSync(roadmapPath, 'utf-8'), /- \[x\] \*\*Phase 18: Deterministic CLI Mechanics\*\*/);
  });

  test('generated helper runtime resolves the workspace root from a nested directory', async () => {
    const nestedDir = path.join(tmpDir, 'packages', 'feature');
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');

    const gsdd = await loadGsdd(tmpDir);
    await gsdd.cmdInit('--auto', '--tools', 'claude');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );
    writePassedStandardChain(tmpDir, '18');

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
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );
    writePassedStandardChain(tmpDir, '18');

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
    assert.match(result.output, /Workspace root is not a real directory/);
  });

  test('help text documents file-op, phase-status, and lifecycle-preflight commands', async () => {
    const result = await runCliAsMain(tmpDir, ['help']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /file-op <copy\|delete\|regex-sub>/);
    assert.match(result.output, /phase-status <N> <status>/);
    assert.match(result.output, /verify <N>/);
    assert.match(result.output, /lifecycle-preflight <surface> \[phase]/);
  });

  test('repo-local helper executes correctly from a nested cwd', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'all']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);

    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
    fs.mkdirSync(nestedDir, { recursive: true });

    const result = spawnSync(process.execPath, [helperPath, 'help'], {
      cwd: nestedDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const output = result.stdout;
    assert.match(output, /node \.work\/bin\/gsdd\.mjs file-op/);
    assert.match(output, /node \.work\/bin\/gsdd\.mjs phase-status/);
    assert.match(output, /node \.work\/bin\/gsdd\.mjs verify 1/);
    assert.match(output, /node \.work\/bin\/gsdd\.mjs lifecycle-preflight/);
    assert.doesNotMatch(output, /\.agents\/bin\/gsdd\.mjs/);

    const generatedSkill = fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-execute', 'SKILL.md'), 'utf-8');
    assert.match(generatedSkill, /node \.work\/bin\/gsdd\.mjs lifecycle-preflight/);

    const executorRole = fs.readFileSync(path.join(tmpDir, '.work', 'templates', 'roles', 'executor.md'), 'utf-8');
    assert.match(executorRole, /node \.work\/bin\/gsdd\.mjs next --json/);

    const rootAgents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    assert.match(rootAgents, /helpers in `\.work\/bin\/`/);

    const claudeSkill = fs.readFileSync(path.join(tmpDir, '.claude', 'skills', 'gsdd-execute', 'SKILL.md'), 'utf-8');
    assert.match(claudeSkill, /node \.work\/bin\/gsdd\.mjs lifecycle-preflight/);

    const openCodeCommand = fs.readFileSync(path.join(tmpDir, '.opencode', 'commands', 'gsdd-execute.md'), 'utf-8');
    assert.match(openCodeCommand, /node \.work\/bin\/gsdd\.mjs lifecycle-preflight/);
  });

  test('state-dir localization does not rewrite longer dot-work prefixes', async () => {
    const { localizeStateDirReferences } = await importRenderingModule();
    const localized = localizeStateDirReferences('Use .work/.continue-here.md, but keep .worktrees/ literal.', {
      stateDirName: '.planning',
    });

    assert.strictEqual(localized, 'Use .planning/.continue-here.md, but keep .worktrees/ literal.');
  });

  test('a later successful in-process CLI run clears an earlier phase-command failure exit code', async () => {
    const gsdd = await loadGsdd(tmpDir);
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    const previousCwd = process.cwd();

    fs.writeFileSync(
      roadmapPath,
      '# Roadmap\n\n- [ ] **Phase 18: Deterministic CLI Mechanics** - goal\n'
    );
    writePassedStandardChain(tmpDir, '18');

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

describe('Phase 29 lifecycle-state helper', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '29-contract-inventory-and-claim-narrowing'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('uses one strict status parser and partitions the complete exact superseded chain', async () => {
    const mod = await importLifecycleStateModule();
    assert.strictEqual(mod.readPlanStatus('---\r\nstatus: "SuPeRsEdEd" # old chain\r\n---\r\n# plan\r\n'), 'superseded');
    assert.strictEqual(mod.isSupersededPlanContent('---\nstatus: superseded\n---\n'), true);
    assert.strictEqual(mod.isSupersededPlanContent('status: superseded\n'), false);
    assert.strictEqual(mod.isSupersededPlanContent('---\n  status: superseded\n---\n'), false);
    assert.strictEqual(mod.isSupersededPlanContent('---\n# status: superseded\n---\n'), false);
    assert.strictEqual(mod.isSupersededPlanContent('---\nstatus: active\n---\nstatus: superseded\n'), false);
    assert.strictEqual(mod.readPlanStatus('---\nstatus: active\'s\n---\n'), "active's");
    assert.throws(() => mod.readPlanStatus('---\nstatus: "superseded\n---\n'), /unmatched quote/);
    assert.throws(() => mod.readPlanStatus('---\nstatus: superseded\n'), /not closed/);

    const planPath = path.join(tmpDir, '01-1-PLAN.md');
    const summaryPath = path.join(tmpDir, '01-1-SUMMARY.md');
    const verificationPath = path.join(tmpDir, '01-1-VERIFICATION.md');
    const currentPlanPath = path.join(tmpDir, '01-2-PLAN.md');
    const artifacts = [
      { kind: 'plan', path: planPath, chainKey: 'one', name: '01-1-PLAN.md' },
      { kind: 'summary', path: summaryPath, chainKey: 'one', name: '01-1-SUMMARY.md' },
      { kind: 'verification', path: verificationPath, chainKey: 'one', name: '01-1-VERIFICATION.md' },
      { kind: 'plan', path: currentPlanPath, chainKey: 'two', name: '01-2-PLAN.md' },
    ];
    const partition = mod.partitionPlanChains(artifacts, {
      readFile: (filePath) => filePath === planPath ? '---\nstatus: superseded\n---\n' : '# current\n',
    });
    assert.deepStrictEqual(partition.historicalArtifacts.map((artifact) => artifact.name), ['01-1-PLAN.md', '01-1-SUMMARY.md', '01-1-VERIFICATION.md']);
    assert.deepStrictEqual(partition.currentArtifacts.map((artifact) => artifact.name), ['01-2-PLAN.md']);
    assert.throws(() => mod.partitionPlanChains(artifacts, { readFile: () => { throw new Error('injected read failure'); } }), /injected read failure/);
    assert.throws(() => mod.partitionPlanChains([{ kind: 'plan', path: planPath, name: 'missing-key-PLAN.md' }]), /missing a normalized chain key/);
    assert.throws(() => mod.partitionPlanChains([{ kind: 'summary', path: summaryPath, name: 'missing-key-SUMMARY.md' }]), /missing a normalized chain key/);

    const nativePhases = path.join(tmpDir, '.work', 'milestone', 'phases');
    const prefixed = mod.classifyNativePhaseArtifact({
      workspaceRoot: tmpDir,
      phasesDir: nativePhases,
      filePath: path.join(nativePhases, '07-native', '07-EXECUTE.md'),
    });
    const bare = mod.classifyNativePhaseArtifact({
      workspaceRoot: tmpDir,
      phasesDir: nativePhases,
      filePath: path.join(nativePhases, '08-native', 'VERIFY.md'),
    });
    assert.deepStrictEqual({ phaseToken: prefixed.phaseToken, kind: prefixed.kind, dir: prefixed.dir }, { phaseToken: '7', kind: 'execute', dir: '07-native' });
    assert.deepStrictEqual({ phaseToken: bare.phaseToken, kind: bare.kind, dir: bare.dir }, { phaseToken: '8', kind: 'verification', dir: '08-native' });
    assert.strictEqual(mod.classifyNativePhaseArtifact({ workspaceRoot: tmpDir, phasesDir: nativePhases, filePath: path.join(nativePhases, 'reference', 'PLAN.md') }), null);
    assert.strictEqual(mod.classifyNativePhaseArtifact({ workspaceRoot: tmpDir, phasesDir: nativePhases, filePath: path.join(nativePhases, '01-native', '01-reference-PLAN.md') }), null);
    fs.mkdirSync(path.join(nativePhases, 'nested', '10-native'), { recursive: true });
    fs.writeFileSync(path.join(nativePhases, '09-PLAN.md'), '# top level packet\n');
    fs.writeFileSync(path.join(nativePhases, 'nested', '10-native', '10-EXECUTE.md'), '# nested packet\n');
    assert.deepStrictEqual(
      mod.collectNativePhaseArtifacts({ workspaceRoot: tmpDir, phasesDir: nativePhases }).map((artifact) => [artifact.dir, artifact.phaseToken, artifact.kind]),
      [['', '9', 'plan'], ['nested/10-native', '10', 'execute']]
    );
  });

  test('finds unpaired standard SUMMARY and native EXECUTE chains by normalized chain key', async () => {
    const mod = await importLifecycleStateModule();
    const standardPlan = { kind: 'plan', chainKey: 'standard/01-1', name: '01-1-PLAN.md' };
    const unrelatedSummary = { kind: 'summary', chainKey: 'standard/01-2', name: '01-2-SUMMARY.md' };
    const matchingSummary = { kind: 'summary', chainKey: 'standard/01-1', name: '01-1-SUMMARY.md' };
    assert.deepStrictEqual(
      mod.findUnpairedPlanArtifacts([standardPlan, unrelatedSummary], { companionKind: 'summary' }),
      [standardPlan]
    );
    assert.deepStrictEqual(
      mod.findUnpairedPlanArtifacts([standardPlan, unrelatedSummary, matchingSummary], { companionKind: 'summary' }),
      []
    );

    const nativePlan = { kind: 'plan', chainKey: 'native/7-a', name: '7-PLAN.md' };
    const unrelatedExecute = { kind: 'execute', chainKey: 'native/7-b', name: '7-EXECUTE.md' };
    const matchingExecute = { kind: 'execute', chainKey: 'native/7-a', name: '7-EXECUTE.md' };
    assert.deepStrictEqual(
      mod.findUnpairedPlanArtifacts([nativePlan, unrelatedExecute], { companionKind: 'execute' }),
      [nativePlan]
    );
    assert.deepStrictEqual(
      mod.findUnpairedPlanArtifacts([nativePlan, unrelatedExecute, matchingExecute], { companionKind: 'execute' }),
      []
    );
    assert.throws(
      () => mod.findUnpairedPlanArtifacts([{ kind: 'plan', name: 'missing-key-PLAN.md' }], { companionKind: 'summary' }),
      /missing a normalized chain key/
    );
    assert.throws(
      () => mod.findUnpairedPlanArtifacts([{ kind: 'execute', name: 'missing-key-EXECUTE.md' }], { companionKind: 'execute' }),
      /missing a normalized chain key/
    );
  });

  test('keeps every superseded standard chain companion historical', async () => {
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), '# Roadmap\n\n- [-] **Phase 29: Current Work**\n');
    const phaseDir = path.join(tmpDir, '.work', 'phases', '29-contract-inventory-and-claim-narrowing');
    fs.writeFileSync(path.join(phaseDir, '29-1-PLAN.md'), '---\nstatus: superseded\n---\n# old\n');
    fs.writeFileSync(path.join(phaseDir, '29-1-SUMMARY.md'), '# old summary\n');
    fs.writeFileSync(path.join(phaseDir, '29-1-VERIFICATION.md'), '# evidence\n');
    fs.writeFileSync(path.join(phaseDir, '29-2-PLAN.md'), '# current\n');
    fs.writeFileSync(path.join(phaseDir, '29-2-SUMMARY.md'), '# current summary\n');

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });
    assert.deepStrictEqual(state.phaseArtifacts.map((artifact) => artifact.name), ['29-2-PLAN.md', '29-2-SUMMARY.md']);
    assert.deepStrictEqual(state.historicalPhaseArtifacts.map((artifact) => artifact.name), ['29-1-PLAN.md', '29-1-SUMMARY.md', '29-1-VERIFICATION.md']);
    assert.deepStrictEqual(state.incompletePlans, []);

    const execute = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '29', '--expects-mutation', 'phase-status']);
    assert.strictEqual(execute.exitCode, 1, execute.output);
    assert.strictEqual(JSON.parse(execute.output).reason, 'no_pending_plan');
    fs.unlinkSync(path.join(phaseDir, '29-2-SUMMARY.md'));
    const pendingExecute = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '29', '--expects-mutation', 'phase-status']);
    assert.strictEqual(pendingExecute.exitCode, 0, pendingExecute.output);
    fs.writeFileSync(path.join(phaseDir, '29-2-SUMMARY.md'), '# current summary\n');
    const verify = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '29', '--expects-mutation', 'phase-status']);
    assert.strictEqual(verify.exitCode, 0, verify.output);
    const phaseModuleUrl = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'phase.mjs')).href;
    const phase = await import(`${phaseModuleUrl}?t=${Date.now()}-${Math.random()}`);
    const mixedReport = phase.buildPhaseVerificationReport('--workspace-root', tmpDir, '29');
    assert.deepStrictEqual(mixedReport.result.plans, ['29-contract-inventory-and-claim-narrowing/29-2-PLAN.md']);
    assert.deepStrictEqual(mixedReport.result.summaries, ['29-contract-inventory-and-claim-narrowing/29-2-SUMMARY.md']);
    assert.deepStrictEqual(mixedReport.result.historical, {
      plans: ['29-contract-inventory-and-claim-narrowing/29-1-PLAN.md'],
      summaries: ['29-contract-inventory-and-claim-narrowing/29-1-SUMMARY.md'],
    });

    fs.unlinkSync(path.join(phaseDir, '29-2-PLAN.md'));
    fs.unlinkSync(path.join(phaseDir, '29-2-SUMMARY.md'));
    const report = phase.buildPhaseVerificationReport('--workspace-root', tmpDir, '29');
    assert.strictEqual(report.exitCode, 1);
    assert.deepStrictEqual(report.result.plans, []);
    assert.deepStrictEqual(report.result.summaries, []);
    assert.deepStrictEqual(report.result.historical, {
      plans: ['29-contract-inventory-and-claim-narrowing/29-1-PLAN.md'],
      summaries: ['29-contract-inventory-and-claim-narrowing/29-1-SUMMARY.md'],
    });
    assert.ok(report.result.prerequisite_status.blockers.some((blocker) => blocker.code === 'missing_phase_plan'));

    const find = await runCliAsMain(tmpDir, ['find-phase', '29']);
    assert.strictEqual(find.exitCode, 0, find.output);
    const found = JSON.parse(find.output);
    assert.deepStrictEqual(found.plans, []);
    assert.deepStrictEqual(found.summaries, []);
    assert.deepStrictEqual(found.historical, report.result.historical);
  });

  test('derives active milestone posture from roadmap, milestone ledger, audits, and phase artifacts', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
      path.join(tmpDir, '.work', 'SPEC.md'),
      [
        '- [x] **[ENGINE-01]**: Lifecycle mutability boundaries',
        '- [ ] **[ENGINE-02]**: Shared lifecycle evaluator',
        '- [ ] **[ENGINE-05]**: Runtime contract',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'MILESTONES.md'),
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
    fs.writeFileSync(path.join(tmpDir, '.work', 'v1.2.0-MILESTONE-AUDIT.md'), '# v1.2.0 audit\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '29-contract-inventory-and-claim-narrowing', '29-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '29-contract-inventory-and-claim-narrowing', '29-SUMMARY.md'), '# summary\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '29-contract-inventory-and-claim-narrowing', '30-PLAN.md'), '# phase 30 plan\n');

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

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
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.2.0 Fork-Honest Launch Hardening',
        '',
        '- [x] **Phase 28: Tracked Public Proof Closure** — [PROOF-01]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '- [x] **[PROOF-01]**: Tracked public proof\n');
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'MILESTONES.md'),
      [
        '# Milestones',
        '',
        '## ✅ v1.2.0 — Fork-Honest Launch Hardening',
        '- Status: shipped',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'v1.2.0-MILESTONE-AUDIT.md'), '# audit\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '29-contract-inventory-and-claim-narrowing', '28-SUMMARY.md'), '# historical summary\n');

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.strictEqual(state.currentMilestone.version, 'v1.2.0');
    assert.strictEqual(state.currentMilestone.shippedInLedger, true);
    assert.strictEqual(state.currentMilestone.hasMatchingAudit, true);
    assert.strictEqual(state.currentMilestone.archiveState, 'archived');
  });

  test('classifies nested phase plan artifacts by parent phase directory instead of plan filename', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.4.0 Launch Surface Coherence',
        '',
        '- [ ] **Phase 34: Identity And Story Lock** — [LSC-01]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '- [ ] **[LSC-01]**: story lock\n');
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      '# nested plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '34-APPROACH.md'),
      '# approach\n'
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.ok(
      state.phaseArtifacts.some((artifact) => artifact.displayPath === '34-identity-and-story-lock/01-PLAN.md' && artifact.kind === 'plan' && artifact.phaseToken === '34'),
      'nested 01-PLAN.md must be attributed to Phase 34 via the parent directory. FIX: prefer phase directory token over plan filename token when classifying nested artifacts.'
    );
  });

  test('does not classify implementation-plan handoff artifacts as executable phase plans', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.6 Release Spine Hardening',
        '',
        '- [x] **Phase 47: Synthesis, Minimal Hardening, And v1.7 Plan** — [REL-04]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '- [x] **[REL-04]**: v1.7 plan\n');
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-PLAN.md'),
      '# executable phase plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-SUMMARY.md'),
      '# phase summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-v1.7-IMPLEMENTATION-PLAN.md'),
      '# next-milestone implementation plan candidate\n'
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.ok(
      state.phaseArtifacts.some((artifact) => artifact.displayPath.endsWith('47-v1.7-IMPLEMENTATION-PLAN.md') && artifact.kind === 'other'),
      'implementation-plan handoff files must stay kind=other. FIX: classify only exact <baseId>-PLAN.md files as executable phase plans.'
    );
    assert.deepStrictEqual(state.incompletePlans, [],
      'implementation-plan handoff files must not create stale in-progress W5 warnings. FIX: keep incompletePlans limited to exact executable PLAN artifacts.');
  });

  test('phase CLI ignores implementation-plan handoff artifacts when finding executable plans', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.6 Release Spine Hardening',
        '',
        '- [x] **Phase 47: Synthesis, Minimal Hardening, And v1.7 Plan** — [REL-04]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '47-synthesis-minimal-hardening-and-v1-7-plan', '47-v1.7-IMPLEMENTATION-PLAN.md'),
      '# next-milestone implementation plan candidate\n'
    );

    const result = await runCliAsMain(tmpDir, ['verify', '47']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, false);
    assert.deepStrictEqual(output.plans, [],
      'phase CLI must not treat IMPLEMENTATION-PLAN handoff files as executable plans. FIX: keep phase.mjs classifier exact-name based.');
    assert.strictEqual(output.verified, false);
    assert.ok(output.prerequisite_status.blockers.some((blocker) => blocker.code === 'missing_phase_plan'));
  });

  test('derives active brownfield change continuity from CHANGE.md and HANDOFF.md without a roadmap', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'brownfield-change'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'brownfield-change', 'CHANGE.md'),
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
      path.join(tmpDir, '.work', 'brownfield-change', 'HANDOFF.md'),
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
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

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

  test('prefers Current Status posture over stale CHANGE.md frontmatter status', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'brownfield-change'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'brownfield-change', 'CHANGE.md'),
      [
        '---',
        'change: CHANGE-042',
        'status: active',
        '---',
        '',
        '# Brownfield Change: Verification Ready',
        '',
        '## Current Status',
        '',
        '- Current posture: ready_for_verification',
        '- Current branch / integration surface: feat/verification-ready',
        '- Current owner / runtime: codex-cli',
        '',
        '## Next Action',
        '',
        '- Run the closeout checks.',
      ].join('\n')
    );

    const mod = await importLifecycleStateModule();
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.strictEqual(state.brownfieldChange.currentStatus, 'ready_for_verification');
  });

  test('closed brownfield change is historical context, not active non-phase state', async () => {
    const changeDir = path.join(tmpDir, '.work', 'brownfield-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
      '---',
      'change: CLOSED-001',
      'status: active',
      '---',
      '',
      '# Brownfield Change: Closed Work',
      '',
      '## Current Status',
      '- Current posture: closed',
      '',
    ].join('\n'));

    const { evaluateLifecycleState } = await importLifecycleStateModule();
    const state = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.strictEqual(state.brownfieldChange.exists, true);
    assert.strictEqual(state.brownfieldChange.currentStatus, 'closed');
    assert.notStrictEqual(state.nonPhaseState, 'active_brownfield_change');
  });

  test('reports overview and Phase Details status mismatches in lifecycle state', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.deepStrictEqual(state.phaseStatusAlignment.mismatches, [
      'Phase 29 overview status done disagrees with Phase Details status in_progress',
    ]);
    assert.deepStrictEqual(state.requirementAlignment.mismatches, ['ENGINE-01 phase complete but SPEC unchecked']);
  });

  test('ignores archived duplicate overview and detail statuses when checking active roadmap alignment', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
    const state = mod.evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.deepStrictEqual(state.phaseStatusAlignment.mismatches, []);
    assert.strictEqual(state.counts.total, 1);
    assert.strictEqual(state.nextPhase.number, '1');
  });
});

describe('Phase 04 exact lifecycle identity and closure', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '11-first'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '11-second'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), '# Roadmap\n\n- [ ] **Phase 11: Exact closure**\n');
  });

  afterEach(() => cleanup(tmpDir));

  test('never silently selects a colliding phase token', async () => {
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '11-first', '11-PLAN.md'), '# first\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '11-second', '11-PLAN.md'), '# second\n');

    const result = await runCliAsMain(tmpDir, ['verify', '11']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const body = JSON.parse(result.output);
    assert.strictEqual(body.error, 'ambiguous_phase_selector');
    assert.deepStrictEqual(body.choices, ['phases/11-first', 'phases/11-second']);

    const preflight = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '11', '--expects-mutation', 'phase-status']);
    assert.strictEqual(preflight.exitCode, 1, preflight.output);
    assert.strictEqual(JSON.parse(preflight.output).reason, 'ambiguous_phase_selector');
  });

  test('preflight accepts an exact current PLAN selector but refuses path escape and phase mismatch', async () => {
    const first = path.join(tmpDir, '.work', 'phases', '11-first');
    fs.writeFileSync(path.join(first, '11-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(first, '11-SUMMARY.md'), '# summary\n');

    const exact = await runCliAsMain(tmpDir, [
      'lifecycle-preflight', 'verify', 'phases/11-first', '--plan', 'phases/11-first/11-PLAN.md', '--expects-mutation', 'phase-status',
    ]);
    assert.strictEqual(exact.exitCode, 0, exact.output);
    assert.strictEqual(JSON.parse(exact.output).plan, 'phases/11-first/11-PLAN.md');

    const escaped = await runCliAsMain(tmpDir, [
      'lifecycle-preflight', 'verify', 'phases/11-first', '--plan', 'phases/11-first/../11-second/11-PLAN.md', '--expects-mutation', 'phase-status',
    ]);
    assert.strictEqual(escaped.exitCode, 1, escaped.output);
    assert.strictEqual(JSON.parse(escaped.output).reason, 'invalid_plan_selector');
  });

  test('does not mark a phase done until every current plan has a passed exact verification chain', async () => {
    const first = path.join(tmpDir, '.work', 'phases', '11-first');
    for (const [dir, base] of [[first, '11-1'], [first, '11-2']]) {
      fs.writeFileSync(path.join(dir, `${base}-PLAN.md`), '# plan\n');
      fs.writeFileSync(path.join(dir, `${base}-SUMMARY.md`), '# summary\n');
    }
    fs.writeFileSync(path.join(first, '11-1-VERIFICATION.md'), '---\nstatus: passed\n---\n# verified\n');
    fs.writeFileSync(path.join(first, '11-2-VERIFICATION.md'), '---\nstatus: gaps_found\n---\n# gaps\n');
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    const before = fs.readFileSync(roadmapPath, 'utf8');

    const blocked = await runCliAsMain(tmpDir, ['phase-status', 'phases/11-first', 'done']);
    assert.strictEqual(blocked.exitCode, 1, blocked.output);
    assert.deepStrictEqual(fs.readFileSync(roadmapPath, 'utf8'), before);

    fs.writeFileSync(path.join(first, '11-2-VERIFICATION.md'), '---\nstatus: passed\n---\n# verified\n');
    const complete = await runCliAsMain(tmpDir, ['phase-status', 'phases/11-first', 'done']);
    assert.strictEqual(complete.exitCode, 0, complete.output);
  });

  test('refuses a bare standard/native collision without changing either ROADMAP and accepts exact authorities', async () => {
    const standard = path.join(tmpDir, '.work', 'phases', '11-first');
    fs.writeFileSync(path.join(standard, '11-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(standard, '11-SUMMARY.md'), '# summary\n');
    fs.writeFileSync(path.join(standard, '11-VERIFICATION.md'), '---\nstatus: passed\n---\n');
    const native = path.join(tmpDir, '.work', 'milestone', 'phases', '11-native');
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'milestone', 'ROADMAP.md'), '# Native\n\n- [ ] **Phase 11: Native**\n');
    fs.writeFileSync(path.join(native, '11-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(native, '11-EXECUTE.md'), '# execute\n');
    fs.writeFileSync(path.join(native, '11-VERIFY.md'), '---\nstatus: passed\n---\n');
    const standardRoadmap = path.join(tmpDir, '.work', 'ROADMAP.md');
    const nativeRoadmap = path.join(tmpDir, '.work', 'milestone', 'ROADMAP.md');
    const beforeStandard = fs.readFileSync(standardRoadmap, 'utf8');
    const beforeNative = fs.readFileSync(nativeRoadmap, 'utf8');

    const bare = await runCliAsMain(tmpDir, ['phase-status', '11', 'done']);
    assert.strictEqual(bare.exitCode, 1, bare.output);
    assert.strictEqual(JSON.parse(bare.output).error, 'ambiguous_phase_selector');
    assert.deepStrictEqual(fs.readFileSync(standardRoadmap, 'utf8'), beforeStandard);
    assert.deepStrictEqual(fs.readFileSync(nativeRoadmap, 'utf8'), beforeNative);

    const exactStandard = await runCliAsMain(tmpDir, ['phase-status', 'phases/11-first', 'done']);
    assert.strictEqual(exactStandard.exitCode, 0, exactStandard.output);
    const exactNative = await runCliAsMain(tmpDir, ['phase-status', 'milestone/phases/11-native', 'done']);
    assert.strictEqual(exactNative.exitCode, 0, exactNative.output);
  });

  test('rechecks closure when done is requested for an already-done phase', async () => {
    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    fs.writeFileSync(roadmapPath, '# Roadmap\n\n- [x] **Phase 11: Exact closure**\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '11-first', '11-PLAN.md'), '# plan\n');
    const before = fs.readFileSync(roadmapPath, 'utf8');
    const result = await runCliAsMain(tmpDir, ['phase-status', 'phases/11-first', 'done']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.strictEqual(JSON.parse(result.output).error, 'incomplete_phase_closure');
    assert.deepStrictEqual(fs.readFileSync(roadmapPath, 'utf8'), before);
  });

  test('find-phase shares the exact resolver and refuses colliding selectors', async () => {
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '11-first', '11-PLAN.md'), '# first\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '11-second', '11-PLAN.md'), '# second\n');
    const result = await runCliAsMain(tmpDir, ['find-phase', '11']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.deepStrictEqual(JSON.parse(result.output).choices, ['phases/11-first', 'phases/11-second']);
  });

  test('rejects malformed or duplicate --plan selectors in verify and preflight', async () => {
    const first = path.join(tmpDir, '.work', 'phases', '11-first');
    fs.writeFileSync(path.join(first, '11-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(first, '11-SUMMARY.md'), '# summary\n');
    for (const args of [
      ['verify', 'phases/11-first', '--plan'],
      ['verify', 'phases/11-first', '--plan', '--other'],
      ['verify', 'phases/11-first', '--plan', 'phases/11-first/11-PLAN.md', '--plan', 'phases/11-first/11-PLAN.md'],
      ['lifecycle-preflight', 'verify', 'phases/11-first', '--plan', '--expects-mutation', 'phase-status'],
      ['lifecycle-preflight', 'verify', 'phases/11-first', '--plan', 'phases/11-first/11-PLAN.md', '--plan', 'phases/11-first/11-PLAN.md', '--expects-mutation', 'phase-status'],
    ]) {
      const result = await runCliAsMain(tmpDir, args);
      assert.strictEqual(result.exitCode, 1, result.output);
      const body = JSON.parse(result.output);
      assert.ok(body.error === 'invalid_plan_selector' || body.reason === 'invalid_plan_selector', result.output);
    }
  });

  test('native exact closure requires matching execute and passed verification', async () => {
    const native = path.join(tmpDir, '.work', 'milestone', 'phases', '11-native');
    const sibling = path.join(tmpDir, '.work', 'milestone', 'phases', '11-sibling');
    fs.mkdirSync(native, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'milestone', 'ROADMAP.md'), '# Native\n\n- [ ] **Phase 11: Native**\n');
    fs.writeFileSync(path.join(native, '11-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(sibling, '11-PLAN.md'), '# pending sibling\n');
    let result = await runCliAsMain(tmpDir, ['phase-status', 'milestone/phases/11-native', 'done']);
    assert.strictEqual(result.exitCode, 1, result.output);
    fs.writeFileSync(path.join(native, '11-EXECUTE.md'), '# execute\n');
    fs.writeFileSync(path.join(native, '11-VERIFY.md'), '---\nstatus: gaps_found\n---\n');
    result = await runCliAsMain(tmpDir, ['phase-status', 'milestone/phases/11-native', 'done']);
    assert.strictEqual(result.exitCode, 1, result.output);
    fs.writeFileSync(path.join(native, '11-VERIFY.md'), '---\nstatus: passed\n---\n');
    result = await runCliAsMain(tmpDir, ['verify', 'milestone/phases/11-native', '--plan', 'milestone/phases/11-native/11-PLAN.md']);
    assert.strictEqual(result.exitCode, 0, result.output);
    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', 'milestone/phases/11-native', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(JSON.parse(result.output).authority, 'work_milestone');
    result = await runCliAsMain(tmpDir, [
      'lifecycle-preflight', 'verify', 'milestone/phases/11-native', '--plan', 'milestone/phases/11-native/11-PLAN.md', '--expects-mutation', 'phase-status',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(JSON.parse(result.output).plan, 'milestone/phases/11-native/11-PLAN.md');
  });
});

describe('Phase 30 lifecycle-preflight helper', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates'), { recursive: true });
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
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
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

  test('blocks standard execute for a historical-only plan chain with missing_plan', async () => {
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), '# Roadmap\n\n- [-] **Phase 30: Deterministic Lifecycle Gates**\n');
    const phaseDir = path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates');
    fs.writeFileSync(path.join(phaseDir, '30-PLAN.md'), '---\nstatus: superseded\n---\n# old plan\n');
    fs.writeFileSync(path.join(phaseDir, '30-SUMMARY.md'), '# old summary\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'missing_plan');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'missing_plan'));
  });

  test('owned-write preflight reports control-map warnings without blocking ordinary dirty state', async () => {
    initPreflightGitWorkspace(tmpDir);
    writePreflightPhase(tmpDir);
    writeProjectFile(tmpDir, 'notes.md', 'local note\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.controlMap.blockerCount, 0);
    assert.ok(output.controlMap.warningCount > 0);
    assert.ok(output.warnings.some((warning) => warning.source === 'control-map' && warning.code === 'canonical_dirty'));
    assert.ok(!output.blockers.some((blocker) => blocker.code === 'canonical_dirty'));
  });

  test('control-map reports checkpoint and annotation labels from the resolved legacy state dir', async () => {
    initPreflightGitWorkspace(tmpDir);
    writeProjectFile(tmpDir, '.work/.continue-here.md', '# checkpoint\n');

    const { buildControlMap } = await importControlMapModule();
    const output = buildControlMap({ workspaceRoot: tmpDir });

    assert.strictEqual(output.workflow_state.checkpoint.exists, true);
    assert.strictEqual(output.workflow_state.checkpoint.path, '.work/.continue-here.md');
    assert.strictEqual(output.default_annotations_path, '.work/.local/control-map.annotations.json');
  });

  test('control-map reports checkpoint and annotation labels from the resolved .work state dir', async () => {
    const workRoot = createGsddTempProject();
    try {
      fs.mkdirSync(path.join(workRoot, '.work'), { recursive: true });
      writeProjectFile(workRoot, '.work/.continue-here.md', '# checkpoint\n');

      const { buildControlMap } = await importControlMapModule();
      const output = buildControlMap({ workspaceRoot: workRoot });

      assert.strictEqual(output.workflow_state.checkpoint.exists, true);
      assert.strictEqual(output.workflow_state.checkpoint.path, '.work/.continue-here.md');
      assert.strictEqual(output.default_annotations_path, '.work/.local/control-map.annotations.json');
    } finally {
      cleanup(workRoot);
    }
  });

  test('owned-write preflight blocks on block-level control-map overlap risks', async () => {
    initPreflightGitWorkspace(tmpDir);
    writePreflightPhase(tmpDir);
    writeProjectFile(tmpDir, '.work/.local/control-map.annotations.json', JSON.stringify({
      schema_version: 1,
      worktrees: [{
        id: 'canonical',
        path: '.',
        cleanup_state: 'active',
        write_set: ['src/app.js'],
      }],
    }, null, 2));
    writeProjectFile(tmpDir, 'src/app.js', 'dirty implementation\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, false);
    assert.strictEqual(output.reason, 'dirty_path_write_set_overlap');
    assert.ok(output.controlMap.blockerCount > 0);
    const blocker = output.blockers.find((entry) => entry.code === 'dirty_path_write_set_overlap');
    assert.ok(blocker);
    assert.strictEqual(blocker.source, 'control-map');
    assert.strictEqual(blocker.severity, 'block');
    assert.ok(blocker.risk.overlaps.some((overlap) => overlap.write_path === 'src/app.js' && overlap.dirty_path === 'src/app.js'));
  });

  test('read-only progress does not consume control-map risks as blockers', async () => {
    initPreflightGitWorkspace(tmpDir);
    writePreflightPhase(tmpDir);
    writeProjectFile(tmpDir, '.work/.local/control-map.annotations.json', JSON.stringify({
      schema_version: 1,
      worktrees: [{
        id: 'canonical',
        path: '.',
        cleanup_state: 'active',
        write_set: ['src/app.js'],
      }],
    }, null, 2));
    writeProjectFile(tmpDir, 'src/app.js', 'dirty implementation\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'progress']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.classification, 'read_only');
    assert.strictEqual(output.controlMap, null);
    assert.ok(!output.blockers.some((blocker) => blocker.source === 'control-map'));
  });

  test('generated local helper lifecycle-preflight includes control-map risk consumption', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);
    initPreflightGitWorkspace(tmpDir);
    writePreflightPhase(tmpDir);
    writeProjectFile(tmpDir, '.work/.local/control-map.annotations.json', JSON.stringify({
      schema_version: 1,
      worktrees: [{
        id: 'canonical',
        path: '.',
        cleanup_state: 'active',
        write_set: ['src/app.js'],
      }],
    }, null, 2));
    writeProjectFile(tmpDir, 'src/app.js', 'dirty implementation\n');

    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const result = spawnSync(process.execPath, [helperPath, 'lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.reason, 'dirty_path_write_set_overlap');
    assert.ok(output.blockers.some((blocker) => blocker.source === 'control-map' && blocker.code === 'dirty_path_write_set_overlap'));
  });

  test('allows plan when the target phase has no summary and no explicit lifecycle mutation', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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

  test('allows plan amend as an owned write before mutating roadmap', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.8 UI Proof',
        '',
        '- [x] **Phase 58: Dogfood UI Proof Loop** — [UIPROOF-10]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', 'amend']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.classification, 'owned_write');
    assert.deepStrictEqual(output.ownedWrites, ['research', 'plan', 'roadmap', 'phase-directories']);
    assert.strictEqual(output.explicitLifecycleMutation, 'none');
    assert.strictEqual(output.phase, 'amend');
    assert.strictEqual(output.authority, 'plan_amend');
  });

  test('finds lifecycle state from a nested directory', async () => {
    const nestedDir = path.join(tmpDir, 'apps', 'web');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [ ] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );

    const result = await runCliAsMain(nestedDir, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.phase, '30');
  });

  test('allows execute when the pending plan uses nested 01-PLAN.md naming inside the phase directory', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.4.0 Launch Surface Coherence',
        '',
        '- [ ] **Phase 34: Identity And Story Lock** — [LSC-01]',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
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
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
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
    fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'progress', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, false);
    assert.strictEqual(output.classification, 'read_only');
    assert.strictEqual(output.explicitLifecycleMutation, 'none');
    assert.strictEqual(output.reason, 'illegal_lifecycle_mutation');
  });

  test('blocks work-milestone execute after the execute artifact exists', async () => {
    writePreflightPhase(tmpDir, '30');
    writeWorkMilestonePhase(tmpDir, '7', { execute: true });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.authority, 'work_milestone');
    assert.strictEqual(output.reason, 'no_pending_plan');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'no_pending_plan'));
  });

  test('keeps a work-native plan pending until its exact-chain execute artifact exists', async () => {
    writePreflightPhase(tmpDir, '30');
    const milestoneDir = path.join(tmpDir, '.work', 'milestone');
    const planDir = path.join(milestoneDir, 'phases', '7-plan-chain-a');
    const unrelatedExecuteDir = path.join(milestoneDir, 'phases', '7-plan-chain-b');
    fs.mkdirSync(planDir, { recursive: true });
    fs.mkdirSync(unrelatedExecuteDir, { recursive: true });
    fs.writeFileSync(path.join(milestoneDir, 'ROADMAP.md'), '# Roadmap\n\n- [-] **Phase 7: Native chain pairing**\n');
    fs.writeFileSync(path.join(planDir, '7-PLAN.md'), '# plan\n');
    fs.writeFileSync(path.join(unrelatedExecuteDir, '7-EXECUTE.md'), '# unrelated execute\n');

    let result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);
    let output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);

    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    output = JSON.parse(result.output);
    const missingExecute = output.blockers.find((blocker) => blocker.code === 'missing_execute');
    assert.deepStrictEqual(missingExecute?.artifacts, ['.work/milestone/phases/7-plan-chain-a/7-PLAN.md']);

    fs.writeFileSync(path.join(planDir, '7-EXECUTE.md'), '# matching execute\n');

    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.strictEqual(JSON.parse(result.output).reason, 'no_pending_plan');
    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);
  });

  test('allows work-milestone verify after plan and execute artifacts exist', async () => {
    writePreflightPhase(tmpDir, '30');
    writeWorkMilestonePhase(tmpDir, '7', { execute: true });

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.authority, 'work_milestone');
    assert.ok(!output.blockers.some((blocker) => blocker.code === 'missing_summary'));
  });

  test('blocks work-milestone verify before execute artifact exists', async () => {
    writePreflightPhase(tmpDir, '30');
    writeWorkMilestonePhase(tmpDir, '7');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.authority, 'work_milestone');
    assert.strictEqual(output.reason, 'missing_execute');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'missing_execute'));
  });

  test('native historical-only plan and execute block execute and verify through current authority', async () => {
    writePreflightPhase(tmpDir, '30');
    const phaseDir = path.join(tmpDir, '.work', 'milestone', 'phases', '7-easy-global-install-auto-mode');
    writeWorkMilestonePhase(tmpDir, '7', { execute: true });
    fs.writeFileSync(path.join(phaseDir, '7-PLAN.md'), '---\nstatus: superseded\n---\n# historical plan\n');

    let result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'execute', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    let output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'missing_plan');
    assert.deepStrictEqual(output.blockers.map((blocker) => blocker.code), ['missing_plan']);

    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'missing_plan');
    assert.deepStrictEqual(output.blockers.map((blocker) => blocker.code), ['missing_plan', 'missing_execute']);
  });

  test('native preflight rejects stray nonnumeric and suffix-overmatch packets', async () => {
    writePreflightPhase(tmpDir, '30');
    fs.mkdirSync(path.join(tmpDir, '.work', 'milestone', 'phases'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'milestone', 'ROADMAP.md'), '# Roadmap\n\n- [ ] **Phase 7: Native packet**\n');
    fs.mkdirSync(path.join(tmpDir, '.work', 'milestone', 'phases', 'reference'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.work', 'milestone', 'phases', '07-native'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'milestone', 'phases', 'reference', 'PLAN.md'), '# stray\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'milestone', 'phases', '07-native', '07-reference-PLAN.md'), '# suffix overmatch\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.blockers.map((blocker) => blocker.code), ['missing_plan', 'missing_execute']);
  });

  test('narrows milestones-only fallback without changing ROADMAP-present blocker outcomes', async () => {
    writePreflightPhase(tmpDir, '30');
    writeWorkMilestonePhase(tmpDir, '7');
    fs.writeFileSync(path.join(tmpDir, '.work', 'milestone', 'MILESTONE.md'), '---\nstatus: in_progress\n---\n');
    let result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const roadmapPresent = JSON.parse(result.output);
    const roadmapBlockers = roadmapPresent.blockers.map((blocker) => blocker.code);
    assert.deepStrictEqual(roadmapBlockers, ['missing_execute']);

    fs.rmSync(path.join(tmpDir, '.work', 'milestone', 'ROADMAP.md'));
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'milestone', 'phases', '7-easy-global-install-auto-mode', '7-PLAN.md'),
      '---\nstatus: planned\n---\n# plan\n'
    );
    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const milestonesOnly = JSON.parse(result.output);
    assert.deepStrictEqual(milestonesOnly.blockers.map((blocker) => blocker.code), roadmapBlockers);
    assert.ok(!milestonesOnly.blockers.some((blocker) => blocker.code === 'missing_roadmap'));
    assert.strictEqual(milestonesOnly.authority, 'work_milestone');
  });

  test('derives a milestones-only phase from PLAN frontmatter and allows the repo-shaped plan preflight', async () => {
    writeWorkMilestonePlanOnly(tmpDir, '4', 'draft_v2');
    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', '4']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.authority, 'work_milestone');
    assert.strictEqual(output.lifecycle.workMilestone.phase, '4');
    assert.strictEqual(output.lifecycle.workMilestone.roadmapPath, '.work/milestones/active-milestone/ROADMAP.md');
  });

  test('fails loud through the CLI when a native roadmap-fallback PLAN frontmatter is malformed', async () => {
    const phaseDir = writeWorkMilestonePlanOnly(tmpDir, '4', 'planned');
    fs.writeFileSync(path.join(phaseDir, 'PLAN.md'), '---\nstatus: superseded\n# missing closing delimiter\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', '4']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /frontmatter starts with --- but is not closed/);
  });

  test('generated local helper lifecycle-preflight supports work-milestone authority', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);
    writePreflightPhase(tmpDir, '30');
    writeWorkMilestonePhase(tmpDir, '7', { execute: true });

    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const result = spawnSync(process.execPath, [helperPath, 'lifecycle-preflight', 'verify', '7', '--expects-mutation', 'phase-status'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.authority, 'work_milestone');
    assert.strictEqual(output.lifecycle.workMilestone.phase, '7');
  });

  test('blocks plan when the target phase is already complete', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v1.3.0 Engine Contract Hardening',
        '',
        '- [x] **Phase 30: Deterministic Lifecycle Gates** - [ENGINE-02]',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', '30']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'phase_already_complete');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'phase_already_complete'));
  });

  test('allows resume without checkpoint when active brownfield CHANGE.md exists', async () => {
    const changeDir = path.join(tmpDir, '.work', 'brownfield-change');
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

  test('closed brownfield CHANGE.md does not bypass missing resume checkpoint preflight', async () => {
    const changeDir = path.join(tmpDir, '.work', 'brownfield-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
      '# Brownfield Change: Closed Work',
      '',
      '## Current Status',
      '- Current posture: closed',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'resume']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, false);
    assert.strictEqual(output.reason, 'missing_checkpoint');
    const checkpointBlocker = output.blockers.find((blocker) => blocker.code === 'missing_checkpoint');
    assert.ok(checkpointBlocker);
    assert.match(checkpointBlocker.message, /\.work\/\.continue-here\.md/);
    assert.deepStrictEqual(checkpointBlocker.artifacts, [
      '.work/.continue-here.md',
      '.work/brownfield-change/CHANGE.md',
    ]);
  });

  test('resume preflight reports .work checkpoint labels from .work state dir', async () => {
    const workRoot = createGsddTempProject();
    try {
      fs.mkdirSync(path.join(workRoot, '.work'), { recursive: true });
      fs.writeFileSync(path.join(workRoot, '.work', 'config.json'), '{}\n');

      const { evaluateLifecyclePreflight } = await importLifecyclePreflightModule();
      const output = evaluateLifecyclePreflight({
        planningDir: path.join(workRoot, '.work'),
        surface: 'resume',
      });

      assert.strictEqual(output.allowed, false);
      assert.strictEqual(output.reason, 'missing_checkpoint');
      const checkpointBlocker = output.blockers.find((blocker) => blocker.code === 'missing_checkpoint');
      assert.ok(checkpointBlocker);
      assert.match(checkpointBlocker.message, /\.work\/\.continue-here\.md/);
      assert.deepStrictEqual(checkpointBlocker.artifacts, [
        '.work/.continue-here.md',
        '.work/brownfield-change/CHANGE.md',
      ]);
    } finally {
      cleanup(workRoot);
    }
  });

  test('resume preflight refuses a malformed present checkpoint without rewriting it', async () => {
    const checkpointPath = path.join(tmpDir, '.work', '.continue-here.md');
    fs.writeFileSync(checkpointPath, '---\nworkflow: phase\n---\n<current_state>only one section</current_state>\n');
    const before = fs.readFileSync(checkpointPath);

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'resume']);

    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'malformed_checkpoint');
    const checkpointBlocker = output.blockers.find((blocker) => blocker.code === 'malformed_checkpoint');
    assert.ok(checkpointBlocker);
    assert.match(checkpointBlocker.message, /repair .*\.work\/\.continue-here\.md/i);
    assert.deepStrictEqual(fs.readFileSync(checkpointPath), before, 'preflight must not repair or consume malformed checkpoint bytes');
  });

  test('resume preflight refuses a checkpoint symlink without rewriting its target', async (t) => {
    const checkpointPath = path.join(tmpDir, '.work', '.continue-here.md');
    const targetPath = path.join(tmpDir, '.work', 'checkpoint-target.md');
    fs.writeFileSync(targetPath, [
      '---',
      'workflow: phase',
      'phase: 30',
      'timestamp: 2026-08-12T10:00:00.000Z',
      'runtime: codex-cli',
      '---',
      '<current_state>target</current_state>',
      '<completed_work>target</completed_work>',
      '<remaining_work>target</remaining_work>',
      '<decisions>target</decisions>',
      '<blockers>target</blockers>',
      '<next_action>target</next_action>',
    ].join('\n'));
    try {
      fs.symlinkSync(targetPath, checkpointPath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('symlink creation requires unavailable Windows privileges');
        return;
      }
      throw error;
    }
    const beforeTarget = fs.readFileSync(targetPath);

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'resume']);

    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'malformed_checkpoint');
    assert.strictEqual(fs.lstatSync(checkpointPath).isSymbolicLink(), true);
    assert.deepStrictEqual(fs.readFileSync(targetPath), beforeTarget, 'resume preflight must not consume or rewrite a checkpoint symlink target');
  });

  test('resume preflight refuses a dangling checkpoint symlink without creating or exposing its target', async (t) => {
    const checkpointPath = path.join(tmpDir, '.work', '.continue-here.md');
    const targetPath = path.join(tmpDir, '.work', 'checkpoint-dangling-target.md');
    try {
      fs.symlinkSync(targetPath, checkpointPath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('symlink creation requires unavailable Windows privileges');
        return;
      }
      throw error;
    }

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'resume']);

    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'malformed_checkpoint');
    assert.doesNotMatch(JSON.stringify(output), /checkpoint-dangling-target/);
    assert.strictEqual(fs.existsSync(targetPath), false, 'resume preflight must not create a dangling checkpoint target');
    assert.strictEqual(fs.lstatSync(checkpointPath).isSymbolicLink(), true);
  });

  test('allows explicit brownfield-change plan preflight without roadmap phase membership', async () => {
    const changeDir = path.join(tmpDir, '.work', 'brownfield-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '### v9.9.9 Unrelated Active Work',
        '',
        '- [ ] **Phase 425589: Unrelated Roadmap Item** — [OTHER-01]',
        '',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');
    fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
      '---',
      'change: PBI-425589',
      'status: active',
      '---',
      '',
      '# Brownfield Change: PBI 425589 Approval Plan',
      '',
      '## Current Status',
      '- Current posture: active',
      '- Current branch / integration surface: feature/pbi-425589',
      '',
      '## Next Action',
      '- Create the approval plan in the bounded brownfield lane.',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', 'brownfield-change']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.authority, 'brownfield_change');
    assert.strictEqual(output.phase, 'brownfield-change');
    assert.strictEqual(output.lifecycle.brownfieldChange.path, '.work/brownfield-change/CHANGE.md');
    assert.ok(!output.blockers.some((blocker) => blocker.code === 'missing_phase'));
  });

  test('explicit brownfield-change preflight reports .work labels from .work state dir', async () => {
    const workRoot = createGsddTempProject();
    try {
      const changeDir = path.join(workRoot, '.work', 'brownfield-change');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(workRoot, '.work', 'config.json'), '{}\n');
      fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
        '---',
        'change: PBI-9000',
        'status: active',
        '---',
        '',
        '# Brownfield Change: Work State Labels',
        '',
        '## Current Status',
        '- Current posture: active',
        '',
        '## Next Action',
        '- Continue the bounded change.',
        '',
      ].join('\n'));

      const { evaluateLifecyclePreflight } = await importLifecyclePreflightModule();
      const output = evaluateLifecyclePreflight({
        planningDir: path.join(workRoot, '.work'),
        surface: 'plan',
        phaseNumber: 'brownfield-change',
      });

      assert.strictEqual(output.allowed, true);
      assert.strictEqual(output.lifecycle.brownfieldChange.path, '.work/brownfield-change/CHANGE.md');
    } finally {
      cleanup(workRoot);
    }
  });

  test('blocks explicit brownfield-change plan preflight when CHANGE.md is missing or closed', async () => {
    let result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', 'brownfield-change']);
    assert.strictEqual(result.exitCode, 1, result.output);
    let output = JSON.parse(result.output);
    assert.strictEqual(output.authority, 'brownfield_change');
    assert.strictEqual(output.lifecycle.authority, 'brownfield_change');
    assert.strictEqual(output.reason, 'missing_brownfield_change');
    assert.ok(!output.blockers.some((blocker) => blocker.code === 'missing_phase'));

    const changeDir = path.join(tmpDir, '.work', 'brownfield-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
      '---',
      'change: PBI-425589',
      'status: active',
      '---',
      '',
      '# Brownfield Change: Closed PBI',
      '',
      '## Current Status',
      '- Current posture: closed',
      '',
    ].join('\n'));

    result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', 'brownfield-change']);
    assert.strictEqual(result.exitCode, 1, result.output);
    output = JSON.parse(result.output);
    assert.strictEqual(output.authority, 'brownfield_change');
    assert.strictEqual(output.lifecycle.authority, 'brownfield_change');
    assert.strictEqual(output.reason, 'brownfield_change_closed');
    assert.ok(!output.blockers.some((blocker) => blocker.code === 'missing_phase'));
  });

  test('warns when lifecycle preflight sees overview/detail status mismatch', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.ok(output.warnings.some((warning) => warning.code === 'roadmap_phase_status_mismatch'));
  });

  test('blocks terminal milestone preflight when roadmap overview/detail status mismatches', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-VERIFICATION.md'),
      '# verification\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'audit-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'roadmap_phase_status_mismatch');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'roadmap_phase_status_mismatch'));
  });

  test('allows audit-milestone preflight when active milestone uses level-two heading', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '## Milestones',
        '',
        '- 🚧 **v1.7 Agentic Engineering Hardening** — Phases 50-54 (in progress)',
        '',
        '## Phases',
        '',
        '## v1.7 Agentic Engineering Hardening',
        '',
        '- [x] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
        '',
      ].join('\n')
    );
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '- [x] **[ENGINE-02]**: lifecycle gates\n');
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-VERIFICATION.md'),
      '# verification\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'audit-milestone']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.allowed, true);
    assert.strictEqual(output.lifecycle.currentMilestone.version, 'v1.7');
    assert.strictEqual(output.lifecycle.currentMilestone.title, 'Agentic Engineering Hardening');
  });

  test('blocks complete-milestone preflight when roadmap overview/detail status mismatches', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
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
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-PLAN.md'),
      '# plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-SUMMARY.md'),
      '# summary\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '30-deterministic-lifecycle-gates', '30-VERIFICATION.md'),
      '# verification\n'
    );

    const result = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'complete-milestone']);
    assert.strictEqual(result.exitCode, 1, result.output);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'roadmap_phase_status_mismatch');
    assert.ok(output.blockers.some((blocker) => blocker.code === 'roadmap_phase_status_mismatch'));
  });
});

describe('verify command nested phase plans', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('finds nested 01-PLAN.md when verifying a phase', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: false',
        'browser_proof_rationale: Artifact-path fixture; no rendered UI behavior is claimed.',
        '---',
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
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '01-SUMMARY.md'),
      '# Phase 34 Summary\n'
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
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: false',
        'browser_proof_rationale: Artifact-path fixture; no rendered UI behavior is claimed.',
        '---',
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
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'phases', '34-identity-and-story-lock', '01-SUMMARY.md'),
      '# Phase 34 Summary\n'
    );

    const result = await runCliAsMain(tmpDir, ['verify', '34']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.artifacts, [
      { operation: 'rename', from: 'src/old.js', to: 'src/new.js', file: 'src/new.js', exists: true },
      { operation: 'move', from: 'src/a.js', to: 'src/b.js', file: 'src/b.js', exists: true },
    ]);
  });
});

describe('Phase 58 dogfood and Phase 59 UI proof product comparison', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createGsddTempProject();
    fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('phase verify fails closed when no matching plan exists', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);

    const result = await runCliAsMain(tmpDir, ['verify', '9999']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.strictEqual(output.exists, false);
    assert.deepStrictEqual(output.blocked_on, ['prerequisites']);
    assert.strictEqual(output.prerequisite_status.satisfied, false);
    assert.ok(output.prerequisite_status.blockers.some((blocker) => blocker.code === 'missing_phase_plan'));
  });

  test('phase verify fails closed when summary is missing', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-summary-missing');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), '---\nbrowser_proof_required: false\nbrowser_proof_rationale: CLI-only work.\n---\n# Phase 1 Plan\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.strictEqual(output.legacy_verified, false);
    assert.deepStrictEqual(output.blocked_on, ['prerequisites']);
    assert.ok(output.prerequisite_status.blockers.some((blocker) => blocker.code === 'missing_phase_summary'));
  });

  test('phase verify requires a summary for each exact current plan chain', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-mixed-plan-chains');
    const unmatchedPlan = '01-mixed-plan-chains/01-1-PLAN.md';
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      '# Roadmap\n\n- [-] **Phase 1: Mixed Plan Chains**\n'
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-1-PLAN.md'),
      '---\nbrowser_proof_required: false\nbrowser_proof_rationale: CLI-only chain verification.\n---\n# Phase 1 Plan\n'
    );
    fs.writeFileSync(path.join(phaseDir, '01-2-SUMMARY.md'), '# Orphan Phase 1 Summary\n');

    const direct = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(direct.exitCode, 1, direct.output);
    const directOutput = JSON.parse(direct.output);
    const directBlocker = directOutput.prerequisite_status.blockers.find(
      (blocker) => blocker.code === 'missing_phase_summary'
    );
    assert.strictEqual(directOutput.legacy_verified, false);
    assert.strictEqual(directBlocker?.path, unmatchedPlan);

    const preflight = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '1', '--expects-mutation', 'phase-status']);
    assert.strictEqual(preflight.exitCode, 1, preflight.output);
    const preflightOutput = JSON.parse(preflight.output);
    const preflightBlocker = preflightOutput.blockers.find((blocker) => blocker.code === 'missing_summary');
    assert.deepStrictEqual(preflightBlocker?.artifacts, [unmatchedPlan]);

    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const helper = spawnSync(process.execPath, [helperPath, 'verify', '1'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(helper.status, 1, helper.stderr || helper.stdout);
    assert.deepStrictEqual(JSON.parse(helper.stdout), directOutput);

    fs.writeFileSync(path.join(phaseDir, '01-1-SUMMARY.md'), '# Matching Phase 1 Summary\n');

    const completedDirect = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(completedDirect.exitCode, 0, completedDirect.output);
    assert.strictEqual(JSON.parse(completedDirect.output).verified, true);
    const completedPreflight = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'verify', '1', '--expects-mutation', 'phase-status']);
    assert.strictEqual(completedPreflight.exitCode, 0, completedPreflight.output);
  });

  test('generated local helper runs direct phase verify checks', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-helper-verify');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), '---\nbrowser_proof_required: false\nbrowser_proof_rationale: CLI-only helper verification.\n---\n# Phase 1 Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const result = spawnSync(process.execPath, [helperPath, 'verify', '1'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);

    assert.strictEqual(output.verified, true);
  });

  test('phase verification builder matches direct verify result shape', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-builder-verify');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), '---\nbrowser_proof_required: false\nbrowser_proof_rationale: CLI-only builder verification.\n---\n# Phase 1 Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const phase = await importPhaseModule();
    const built = phase.buildPhaseVerificationReport('--workspace-root', tmpDir, '1');
    const cli = await runCliAsMain(tmpDir, ['verify', '1']);
    const output = JSON.parse(cli.output);

    assert.strictEqual(built.ok, true);
    assert.strictEqual(built.exitCode, 0);
    assert.strictEqual(built.result.verified, output.verified);
    assert.deepStrictEqual(built.result.blocked_on, output.blocked_on);
  });

  test('phase verify blocks required browser proof when the plan section is missing', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-missing');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.blocked_on.includes('browser_proof'));
    assert.strictEqual(output.browser_proof_status.satisfied, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => blocker.code === 'missing_browser_proof_plan'));
  });

  test('phase verify blocks missing browser proof declaration', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-declaration');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), '# Phase 1 Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.blocked_on.includes('browser_proof'));
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'missing_browser_proof_declaration'
    )));
  });

  test('phase verify blocks legacy no-UI proof declarations with placeholder rationale', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-retired-browser-proof');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'ui_proof_slots: []',
        'no_ui_proof_rationale: none',
        '---',
        '# Phase 1 Plan',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'missing_browser_proof_rationale'
      && blocker.message.includes('ui_proof_slots')
    )));
  });

  test('phase verify blocks legacy non-empty ui-proof slots pending migration', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-legacy-ui-proof-slots');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'ui_proof_slots:',
        '  - slot_id: dashboard-render',
        '    claim: dashboard render proof',
        'no_ui_proof_rationale: null',
        '---',
        '# Phase 1 Plan',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'legacy_browser_proof_slots_require_migration'
    )));
    assert.strictEqual(output.browser_proof_status.blockers.filter((blocker) => (
      blocker.code === 'legacy_browser_proof_slots_require_migration'
    )).length, 1);
  });

  test('phase verify normalizes scalar comments and rejects placeholder rationale values', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-scalars');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: "false" # CLI-only',
        'browser_proof_rationale: "" # empty placeholder',
        '---',
        '# Phase 1 Plan',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'missing_browser_proof_rationale'
    )));
    assert.ok(!output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'invalid_browser_proof_required'
    )));
  });

  test('phase verify blocks incomplete browser proof sections without evidence command or no-command rationale', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-incomplete');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-incomplete/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'incomplete_browser_proof_plan'
      && blocker.message.includes('Evidence command or No-command rationale')
    )));
  });

  test('phase verify blocks placeholder browser proof plan fields', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-placeholders');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: [Exact routes or UI states to inspect]',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence command: [Runnable command]',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-placeholders/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'incomplete_browser_proof_plan'
      && blocker.message.includes('Routes/states')
    )));
  });

  test('phase verify blocks required browser proof when no observation is recorded', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-observation-missing');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-observation-missing/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\nNo browser proof yet.\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'missing_browser_proof_observation'
    )));
  });

  test('phase verify passes required browser proof with a complete observation record', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    initCandidateProofGitRepository(tmpDir);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-observed');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: "true" # visible dashboard work',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Candidate identity:',
        '  - src/candidate.js',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-observed/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    const receipt = captureCandidateReceipt(tmpDir, '01-browser-proof-observed/01-PLAN.md', 'src/candidate.js');
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-observed/01-PLAN.md',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        `- Candidate commit: ${receipt.commit}`,
        `- Candidate dirty fingerprint: ${receipt.dirtyFingerprint}`,
        `- Candidate dirty entries: ${receipt.dirtyEntries}`,
        `- Plan sha256: ${receipt.planSha256}`,
        '- Candidate artifacts:',
        `  - src/candidate.js | ${receipt.artifactSha256}`,
        `- Runtime identity: ${receipt.runtimeIdentity}`,
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts:',
        '  - .work/phases/01-browser-proof-observed/artifacts/dashboard.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard render proof only.',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, true);
    assert.strictEqual(output.browser_proof_status.satisfied, true);
  });

  test('phase verify refuses required browser proof without a candidate identity declaration', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    initCandidateProofGitRepository(tmpDir);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-candidate-required');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-candidate-required/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-candidate-required/01-PLAN.md',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts: .work/phases/01-browser-proof-candidate-required/artifacts/dashboard.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard render proof only.',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => blocker.code === 'missing_candidate_identity'));
  });

  test('phase verify refuses case-variant .WORK candidate inputs without writing the fixture', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    initCandidateProofGitRepository(tmpDir);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-state-root-alias');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'secret.txt'), 'private candidate\n');
    const planPath = path.join(phaseDir, '01-PLAN.md');
    fs.writeFileSync(planPath, [
      '---', 'browser_proof_required: true', 'browser_proof_rationale: rendered proof.', '---',
      '## Browser Proof Plan', 'Routes/states: /dashboard.', 'Viewports: desktop.', 'Runtime path: agent-browser.',
      'Evidence kind: runtime', 'Evidence command: npm run test:e2e', 'Candidate identity:', '  - .WORK/secret.txt',
      'Observations: dashboard renders.', 'Artifacts: local-only.', 'Claim limit: dashboard only.',
    ].join('\n'));
    const receipt = captureCandidateReceipt(tmpDir, '01-browser-proof-state-root-alias/01-PLAN.md', '.work/secret.txt');
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), [
      '## Browser Proof Observation', '- Plan: 01-browser-proof-state-root-alias/01-PLAN.md', '- Flow: /dashboard.',
      '- Viewports: desktop.', '- Runtime path: agent-browser.', '- Evidence kind: runtime', '- Evidence command: npm run test:e2e',
      `- Candidate commit: ${receipt.commit}`, `- Candidate dirty fingerprint: ${receipt.dirtyFingerprint}`, `- Candidate dirty entries: ${receipt.dirtyEntries}`,
      `- Plan sha256: ${receipt.planSha256}`, '- Candidate artifacts:', `  - .WORK/secret.txt | ${receipt.artifactSha256}`,
      '- Runtime identity: artifact:.WORK/secret.txt', '- Observed: dashboard renders.', '- Artifacts: local-only.', '- Result: passed', '- Claim limit: dashboard only.',
    ].join('\n'));
    const before = snapshotTree(tmpDir);
    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => blocker.code === 'invalid_candidate_identity'));
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
  });

  test('generated helper returns the same candidate receipt blocker as direct verification', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-generated-candidate');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), [
      '---',
      'browser_proof_required: true',
      'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
      '---',
      '## Browser Proof Plan',
      'Routes/states: /dashboard.',
      'Viewports: desktop.',
      'Runtime path: agent-browser.',
      'Evidence kind: runtime',
      'Evidence command: npm run test:e2e',
      'Observations: dashboard renders.',
      'Artifacts: local-only.',
      'Claim limit: dashboard only.',
    ].join('\n'));
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# summary\n');

    const direct = await runCliAsMain(tmpDir, ['verify', '1']);
    const helper = spawnSync(process.execPath, [path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'), 'verify', '1'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(direct.exitCode, 1, direct.output);
    assert.strictEqual(helper.status, 1, helper.stderr || helper.stdout);
    const directCodes = JSON.parse(direct.output).browser_proof_status.blockers.map((blocker) => blocker.code).sort();
    const helperCodes = JSON.parse(helper.stdout).browser_proof_status.blockers.map((blocker) => blocker.code).sort();
    assert.deepStrictEqual(helperCodes, directCodes);
  });

  test('candidate receipt mismatches fail closed without exposing unrelated dirty paths', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    initCandidateProofGitRepository(tmpDir);
    const { phaseDir, receipt } = writeCandidateProofFixture(tmpDir, '01-browser-proof-candidate-mismatch');
    const summaryPath = path.join(phaseDir, '01-SUMMARY.md');
    fs.writeFileSync(summaryPath, fs.readFileSync(summaryPath, 'utf-8').replace(receipt.commit, '0'.repeat(40)));
    const before = snapshotTree(tmpDir);
    const wrongCommit = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(wrongCommit.exitCode, 1, wrongCommit.output);
    assert.ok(JSON.parse(wrongCommit.output).browser_proof_status.blockers.some((blocker) => blocker.code === 'candidate_commit_mismatch'));
    assert.deepStrictEqual(snapshotTree(tmpDir), before, 'verification must not mutate a wrong-commit refusal');

    fs.writeFileSync(summaryPath, fs.readFileSync(summaryPath, 'utf-8').replace('0'.repeat(40), receipt.commit));
    fs.writeFileSync(path.join(tmpDir, 'unrelated-dirty.txt'), 'do not disclose\n');
    const dirty = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(dirty.exitCode, 1, dirty.output);
    assert.ok(JSON.parse(dirty.output).browser_proof_status.blockers.some((blocker) => blocker.code === 'candidate_dirty_mismatch'));
    assert.doesNotMatch(dirty.output, /unrelated-dirty\.txt/);
    const helper = spawnSync(process.execPath, [path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'), 'verify', '1'], { cwd: tmpDir, encoding: 'utf-8' });
    assert.strictEqual(helper.status, 1, helper.stderr || helper.stdout);
    assert.deepStrictEqual(
      JSON.parse(helper.stdout).browser_proof_status.blockers.map((blocker) => blocker.code).sort(),
      JSON.parse(dirty.output).browser_proof_status.blockers.map((blocker) => blocker.code).sort()
    );
  });

  test('tracked .work receipts exclude themselves but still detect product dirty state', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    initCandidateProofGitRepository(tmpDir);
    const { phaseDir } = writeCandidateProofFixture(tmpDir, '01-browser-proof-tracked-state');
    const summaryPath = path.join(phaseDir, '01-SUMMARY.md');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '');
    git(['add', '.gitignore', '.work'], tmpDir);
    git(['commit', '-m', 'track work state'], tmpDir);
    const receipt = captureCandidateReceipt(tmpDir, '01-browser-proof-tracked-state/01-PLAN.md', 'src/candidate.js');
    let summary = fs.readFileSync(summaryPath, 'utf-8');
    summary = summary.replace(/Candidate commit: .+/, `Candidate commit: ${receipt.commit}`)
      .replace(/Candidate dirty fingerprint: .+/, `Candidate dirty fingerprint: ${receipt.dirtyFingerprint}`)
      .replace(/Candidate dirty entries: .+/, `Candidate dirty entries: ${receipt.dirtyEntries}`)
      .replace(/Plan sha256: .+/, `Plan sha256: ${receipt.planSha256}`)
      .replace(/src\/candidate\.js \| sha256:[a-f0-9]+/, `src/candidate.js | ${receipt.artifactSha256}`);
    fs.writeFileSync(summaryPath, summary);

    const passing = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(passing.exitCode, 0, passing.output);
    fs.appendFileSync(path.join(tmpDir, 'src', 'candidate.js'), '// changed after receipt\n');
    const dirty = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(dirty.exitCode, 1, dirty.output);
    assert.ok(JSON.parse(dirty.output).browser_proof_status.blockers.some((blocker) => blocker.code === 'candidate_dirty_mismatch'));
  });

  test('candidate receipt matrix is exact, fail-closed, and read-only', async (t) => {
    const cases = [
      ['test-only receipt passes', 'test', null, 0, null],
      ['runtime cannot use not_applicable', 'runtime', ({ phaseDir }) => {
        const summary = path.join(phaseDir, '01-SUMMARY.md');
        fs.writeFileSync(summary, fs.readFileSync(summary, 'utf-8').replace(/Runtime identity: artifact:.+/, 'Runtime identity: not_applicable: invalid for runtime'));
      }, 1, 'invalid_candidate_runtime_identity'],
      ['case-wrong Plan cannot close', 'runtime', ({ phaseDir }) => {
        const summary = path.join(phaseDir, '01-SUMMARY.md');
        fs.writeFileSync(summary, fs.readFileSync(summary, 'utf-8').replace('01-PLAN.md', '01-plan.md'));
      }, 1, 'unmatched_browser_proof_observation'],
      ['changed PLAN blocks', 'runtime', ({ phaseDir }) => fs.appendFileSync(path.join(phaseDir, '01-PLAN.md'), '\nchanged\n'), 1, 'candidate_plan_mismatch'],
      ['changed artifact blocks', 'runtime', (_fixture, root) => fs.appendFileSync(path.join(root, 'src', 'candidate.js'), '// changed\n'), 1, 'candidate_artifact_mismatch'],
      ['candidate directory blocks', 'runtime', ({ phaseDir }) => {
        const plan = path.join(phaseDir, '01-PLAN.md');
        const summary = path.join(phaseDir, '01-SUMMARY.md');
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf-8').replace('src/candidate.js', 'src'));
        fs.writeFileSync(summary, fs.readFileSync(summary, 'utf-8').replaceAll('src/candidate.js', 'src'));
      }, 1, 'invalid_candidate_artifact_path'],
      ['absolute candidate blocks', 'runtime', ({ phaseDir }) => fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), fs.readFileSync(path.join(phaseDir, '01-PLAN.md'), 'utf-8').replace('src/candidate.js', 'C:/outside.js')), 1, 'invalid_candidate_identity'],
      ['duplicate receipt field blocks', 'runtime', ({ phaseDir }) => fs.appendFileSync(path.join(phaseDir, '01-SUMMARY.md'), '\n- Candidate commit: 0000000000000000000000000000000000000000\n'), 1, 'missing_candidate_receipt'],
    ];
    for (const [name, evidenceKind, mutate, exitCode, blockerCode] of cases) {
      const root = createGsddTempProject();
      try {
        await runCliAsMain(root, ['init', '--auto', '--tools', 'agents']);
        initCandidateProofGitRepository(root);
        const fixture = writeCandidateProofFixture(root, '01-candidate-matrix', { evidenceKind });
        if (mutate) {
          mutate(fixture, root);
        }
        const before = snapshotTree(root);
        const result = await runCliAsMain(root, ['verify', '1']);
        assert.strictEqual(result.exitCode, exitCode, `${name}: ${result.output}`);
        assert.deepStrictEqual(snapshotTree(root), before, `${name}: verifier wrote fixture bytes`);
        if (blockerCode) assert.ok(JSON.parse(result.output).browser_proof_status.blockers.some((blocker) => blocker.code === blockerCode), name);
      } finally {
        cleanup(root);
      }
    }
    for (const dangling of [false, true]) {
      const root = createGsddTempProject();
      try {
        await runCliAsMain(root, ['init', '--auto', '--tools', 'agents']);
        initCandidateProofGitRepository(root);
        const { phaseDir } = writeCandidateProofFixture(root, `01-candidate-${dangling ? 'dangling' : 'link'}`);
        const link = path.join(root, 'src', 'candidate-link.js');
        try { fs.symlinkSync(dangling ? path.join(root, 'missing.js') : path.join(root, 'src', 'candidate.js'), link, 'file'); } catch (error) {
          if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`symlink unavailable: ${error.code}`); continue; }
          throw error;
        }
        for (const file of ['01-PLAN.md', '01-SUMMARY.md']) {
          const target = path.join(phaseDir, file);
          fs.writeFileSync(target, fs.readFileSync(target, 'utf-8').replaceAll('src/candidate.js', 'src/candidate-link.js'));
        }
        const before = snapshotTree(root);
        const result = await runCliAsMain(root, ['verify', '1']);
        assert.strictEqual(result.exitCode, 1, result.output);
        assert.ok(JSON.parse(result.output).browser_proof_status.blockers.some((blocker) => blocker.code === 'invalid_candidate_artifact_path' || blocker.code === 'missing_candidate_artifact'));
        assert.deepStrictEqual(snapshotTree(root), before);
      } finally { cleanup(root); }
    }
  });

  test('one comma-separated Plan reference cannot close two candidate-bound plans', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-one-plan');
    fs.mkdirSync(phaseDir, { recursive: true });
    const plan = [
      '---', 'browser_proof_required: true', 'browser_proof_rationale: rendered proof.', '---', '## Browser Proof Plan',
      'Routes/states: /dashboard.', 'Viewports: desktop.', 'Runtime path: agent-browser.', 'Evidence kind: runtime',
      'Evidence command: npm run test:e2e', 'Candidate identity:', '  - src/candidate.js', 'Observations: dashboard renders.', 'Artifacts: local-only.', 'Claim limit: dashboard only.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-1-PLAN.md'), plan);
    fs.writeFileSync(path.join(phaseDir, '01-2-PLAN.md'), plan);
    fs.writeFileSync(path.join(phaseDir, '01-1-SUMMARY.md'), [
      '## Browser Proof Observation', '- Plan: 01-browser-proof-one-plan/01-1-PLAN.md, 01-browser-proof-one-plan/01-2-PLAN.md',
      '- Flow: /dashboard.', '- Viewports: desktop.', '- Runtime path: agent-browser.', '- Evidence kind: runtime', '- Evidence command: npm run test:e2e',
      '- Observed: dashboard renders.', '- Artifacts: local-only.', '- Result: passed', '- Claim limit: dashboard only.',
    ].join('\n'));
    fs.writeFileSync(path.join(phaseDir, '01-2-SUMMARY.md'), '# summary\n');
    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const blockers = JSON.parse(result.output).browser_proof_status.blockers;
    assert.strictEqual(blockers.filter((blocker) => blocker.code === 'unmatched_browser_proof_observation').length, 2);
  });

  test('phase verify blocks failed browser proof observations', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-failed');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-failed/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-failed/01-PLAN.md',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        '- Observed: dashboard widget failed to render.',
        '- Artifacts: .work/phases/01-browser-proof-failed/artifacts/dashboard.png - local-only',
        '- Result: failed product_bug',
        '- Claim limit: dashboard render proof only.',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'failed_browser_proof_observation'
    )));
  });

  test('phase verify blocks failed browser proof observations even when another observation passes', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-mixed-result');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-mixed-result/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-mixed-result/01-PLAN.md',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts: .work/phases/01-browser-proof-mixed-result/artifacts/dashboard.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard render proof only.',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-mixed-result/01-PLAN.md',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        '- Observed: dashboard widget failed to render on mobile.',
        '- Artifacts: .work/phases/01-browser-proof-mixed-result/artifacts/dashboard-mobile.png - local-only',
        '- Result: partial product_bug',
        '- Claim limit: dashboard mobile render proof only.',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'failed_browser_proof_observation'
    )));
  });

  test('phase verify blocks single-plan browser proof when observation references another plan', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-wrong-plan');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-wrong-plan/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 99-other-phase/99-PLAN.md',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts: .work/phases/01-browser-proof-wrong-plan/artifacts/dashboard.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard render proof only.',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'unmatched_browser_proof_observation'
      && blocker.path.endsWith('01-PLAN.md')
    )));
  });

  test('phase verify blocks linked browser proof observation outside workspace', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-outside-link');
    fs.mkdirSync(phaseDir, { recursive: true });
    const outsideRecord = path.join(path.dirname(tmpDir), `outside-browser-proof-${Date.now()}.md`);
    fs.writeFileSync(outsideRecord, '## Browser Proof Observation\n\n- Result: passed\n');
    const outsideLink = path.relative(phaseDir, outsideRecord).replace(/\\/g, '/');
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-outside-link/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        `Browser Proof Observation: ${outsideLink}`,
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'invalid_browser_proof_observation_link'
    )));
  });

  test('phase verify blocks URL browser proof observation links', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-url-link');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-url-link/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-SUMMARY.md'),
      [
        '# Phase 1 Summary',
        '',
        'Browser Proof Observation: https://example.test/proof.md',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'invalid_browser_proof_observation_link'
      && blocker.message.includes('not a URL')
    )));
  });

  test('phase verify blocks linked browser proof observation symlink escape', async (t) => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-symlink-link');
    fs.mkdirSync(phaseDir, { recursive: true });
    const outsideRecord = path.join(path.dirname(tmpDir), `outside-browser-proof-${Date.now()}.md`);
    const symlinkRecord = path.join(phaseDir, 'linked-observation.md');
    fs.writeFileSync(outsideRecord, '## Browser Proof Observation\n\n- Result: passed\n');
    try {
      fs.symlinkSync(outsideRecord, symlinkRecord, 'file');
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) {
        t.skip(`symlink creation unavailable in this environment: ${error.code}`);
        return;
      }
      throw error;
    }
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-symlink-link/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n\nBrowser Proof Observation: linked-observation.md\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'invalid_browser_proof_observation_link'
    )));
  });

  test('phase verify reports linked browser proof observation directories instead of throwing', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-directory-link');
    fs.mkdirSync(path.join(phaseDir, 'observations'), { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'browser_proof_required: true',
        'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
        '---',
        '# Phase 1 Plan',
        '',
        '## Browser Proof Plan',
        'Routes/states: /dashboard after loading current account.',
        'Viewports: desktop and mobile.',
        'Runtime path: agent-browser.',
        'Evidence kind: runtime',
        'Evidence command: npm run test:e2e -- --grep dashboard',
        'Observations: dashboard widgets render without console errors.',
        'Artifacts: .work/phases/01-browser-proof-directory-link/artifacts/dashboard.png, local_only.',
        'Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n\nBrowser Proof Observation: observations\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'invalid_browser_proof_observation_link'
    )));
  });

  test('phase verify keeps legacy no-UI proof plans compatible', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-legacy-no-ui-proof');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-PLAN.md'),
      [
        '---',
        'ui_proof_slots: []',
        'no_ui_proof_rationale: CLI-only phase; no rendered UI behavior is claimed.',
        '---',
        '# Phase 1 Plan',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, true);
    assert.strictEqual(output.browser_proof_status.plans[0].legacy_compatible, true);
    assert.ok(output.browser_proof_status.warnings.some((warning) => (
      warning.code === 'legacy_browser_proof_contract'
    )));
  });

  test('phase verify blocks multi-plan browser proof when observations do not identify each plan', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-multi');
    fs.mkdirSync(phaseDir, { recursive: true });
    const planContent = [
      '---',
      'browser_proof_required: true',
      'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
      '---',
      '# Phase 1 Plan',
      '',
      '## Browser Proof Plan',
      'Routes/states: /dashboard after loading current account.',
      'Viewports: desktop and mobile.',
      'Runtime path: agent-browser.',
      'Evidence kind: runtime',
      'Evidence command: npm run test:e2e -- --grep dashboard',
      'Observations: dashboard widgets render without console errors.',
      'Artifacts: .work/phases/01-browser-proof-multi/artifacts/dashboard.png, local_only.',
      'Claim limit: dashboard render proof only.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-1-PLAN.md'), planContent);
    fs.writeFileSync(path.join(phaseDir, '01-2-PLAN.md'), planContent);
    fs.writeFileSync(
      path.join(phaseDir, '01-1-SUMMARY.md'),
      [
        '# Phase 1-1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Flow: /dashboard after loading current account.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard',
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts: .work/phases/01-browser-proof-multi/artifacts/dashboard.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(path.join(phaseDir, '01-2-SUMMARY.md'), '# Phase 1-2 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'unmatched_browser_proof_observation'
      && blocker.path.endsWith('01-1-PLAN.md')
    )));
    assert.ok(output.browser_proof_status.blockers.some((blocker) => (
      blocker.code === 'unmatched_browser_proof_observation'
      && blocker.path.endsWith('01-2-PLAN.md')
    )));
  });

  test('phase verify passes multi-plan browser proof when observations reference each required plan', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    initCandidateProofGitRepository(tmpDir);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-browser-proof-multi-observed');
    fs.mkdirSync(phaseDir, { recursive: true });
    const planContent = [
      '---',
      'browser_proof_required: true',
      'browser_proof_rationale: Rendered UI work changes the visible dashboard.',
      '---',
      '# Phase 1 Plan',
      '',
      '## Browser Proof Plan',
      'Routes/states: /dashboard after loading current account.',
      'Viewports: desktop and mobile.',
      'Runtime path: agent-browser.',
      'Evidence kind: runtime',
      'Evidence command: npm run test:e2e -- --grep dashboard',
      'Candidate identity:',
      '  - src/candidate.js',
      'Observations: dashboard widgets render without console errors.',
      'Artifacts: .work/phases/01-browser-proof-multi-observed/artifacts/dashboard.png, local_only.',
      'Claim limit: dashboard render proof only.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-1-PLAN.md'), planContent);
    fs.writeFileSync(path.join(phaseDir, '01-2-PLAN.md'), planContent);
    const receiptA = captureCandidateReceipt(tmpDir, '01-browser-proof-multi-observed/01-1-PLAN.md', 'src/candidate.js');
    const receiptB = captureCandidateReceipt(tmpDir, '01-browser-proof-multi-observed/01-2-PLAN.md', 'src/candidate.js');
    fs.writeFileSync(
      path.join(phaseDir, '01-1-SUMMARY.md'),
      [
        '# Phase 1-1 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-multi-observed/01-1-PLAN.md',
        '- Flow: /dashboard account A.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard-a',
        `- Candidate commit: ${receiptA.commit}`,
        `- Candidate dirty fingerprint: ${receiptA.dirtyFingerprint}`,
        `- Candidate dirty entries: ${receiptA.dirtyEntries}`,
        `- Plan sha256: ${receiptA.planSha256}`,
        '- Candidate artifacts:',
        `  - src/candidate.js | ${receiptA.artifactSha256}`,
        `- Runtime identity: ${receiptA.runtimeIdentity}`,
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts: .work/phases/01-browser-proof-multi-observed/artifacts/dashboard-a.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard account A render proof only.',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-2-SUMMARY.md'),
      [
        '# Phase 1-2 Summary',
        '',
        '## Browser Proof Observation',
        '',
        '- Plan: 01-browser-proof-multi-observed/01-2-PLAN.md',
        '- Flow: /dashboard account B.',
        '- Viewports: desktop and mobile.',
        '- Runtime path: agent-browser.',
        '- Evidence kind: runtime',
        '- Evidence command: npm run test:e2e -- --grep dashboard-b',
        `- Candidate commit: ${receiptB.commit}`,
        `- Candidate dirty fingerprint: ${receiptB.dirtyFingerprint}`,
        `- Candidate dirty entries: ${receiptB.dirtyEntries}`,
        `- Plan sha256: ${receiptB.planSha256}`,
        '- Candidate artifacts:',
        `  - src/candidate.js | ${receiptB.artifactSha256}`,
        `- Runtime identity: ${receiptB.runtimeIdentity}`,
        '- Observed: dashboard widgets rendered without console errors.',
        '- Artifacts: .work/phases/01-browser-proof-multi-observed/artifacts/dashboard-b.png - local-only',
        '- Result: passed',
        '- Claim limit: dashboard account B render proof only.',
      ].join('\n')
    );

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, true);
    assert.strictEqual(output.browser_proof_status.satisfied, true);
  });

  test('phase verify blocks when planned file artifacts are unsatisfied', async () => {
    await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-artifact-proof');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-PLAN.md'), '---\nbrowser_proof_required: false\nbrowser_proof_rationale: File-artifact verification only.\n---\n<task id="01-01" type="auto">\n  <files>\n    - CREATE: src/missing.js\n  </files>\n</task>\n');
    fs.writeFileSync(path.join(phaseDir, '01-SUMMARY.md'), '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['verify', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);

    assert.strictEqual(output.verified, false);
    assert.strictEqual(output.legacy_verified, true);
    assert.strictEqual(output.blocks_verification, true);
    assert.deepStrictEqual(output.blocked_on, ['artifacts']);
    assert.strictEqual(output.artifact_status.satisfied, false);
    assert.strictEqual(output.artifact_status.unsatisfied[0].file, 'src/missing.js');
    assert.strictEqual(output.artifact_status.unsatisfied[0].severity, 'blocker');
    assert.match(output.artifact_status.unsatisfied[0].fix_hint, /CREATE/);
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
    fs.unlinkSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'));

    const gsdd = await loadGsdd(tmpDir);
    const mod = await importRuntimeFreshnessModule();
    const report = mod.evaluateRuntimeFreshness({
      cwd: tmpDir,
      workflows: gsdd.createCliContext(tmpDir).workflows,
    });

    assert.strictEqual(report.staleCount, 1);
    assert.strictEqual(report.missingCount, 1);
    assert.ok(report.issues.some((entry) => entry.relativePath === '.agents/skills/gsdd-plan/SKILL.md' && entry.status === 'stale'));
    assert.ok(report.issues.some((entry) => entry.relativePath === '.work/bin/gsdd.mjs' && entry.status === 'missing'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete command
// ─────────────────────────────────────────────────────────────────────────────
