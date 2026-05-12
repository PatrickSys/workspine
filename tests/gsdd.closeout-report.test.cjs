const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('node:child_process');

const { cleanup, createTempProject, runCliAsMain } = require('./gsdd.helpers.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

function writeFile(relativePath, content) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function git(args, cwd = tmpDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

async function initWorkspace() {
  const result = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
  assert.strictEqual(result.exitCode, 0, result.output);
}

async function initGitWorkspace() {
  await initWorkspace();
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'core.autocrlf', 'false']);
  writeFile('.gitignore', '.planning/\n.agents/\n');
  writeFile('README.md', '# Closeout report test\n');
  writeFile('tracked.txt', 'tracked\n');
  git(['add', '.gitignore', 'README.md', 'tracked.txt']);
  git(['commit', '-m', 'initial']);
}

function writeRoadmap() {
  writeFile('.planning/ROADMAP.md', [
    '# Roadmap',
    '',
    '### v1.0 Closeout Test',
    '',
    '- [x] **Phase 1: First Closed Phase** - [CLOSE-01]',
    '- [x] **Phase 2: Latest Closed Phase** - [CLOSE-01]',
    '- [ ] **Phase 3: Pending Phase** - [CLOSE-01]',
    '',
  ].join('\n'));
  writeFile('.planning/SPEC.md', '- [x] **[CLOSE-01]**: Closeout report\n');
}

function writeCompletedPhase(number, slug, planBody = '') {
  const phaseDir = `.planning/phases/${String(number).padStart(2, '0')}-${slug}`;
  writeFile(`${phaseDir}/${String(number).padStart(2, '0')}-PLAN.md`, [
    '---',
    'ui_proof_slots: []',
    'no_ui_proof_rationale: CLI-only report test.',
    '---',
    `# Phase ${number} Plan`,
    planBody,
  ].join('\n'));
  writeFile(`${phaseDir}/${String(number).padStart(2, '0')}-SUMMARY.md`, `# Phase ${number} Summary\n`);
}

function writePhaseWithMissingObservedUiProof(number, slug, slot) {
  const phaseDir = `.planning/phases/${String(number).padStart(2, '0')}-${slug}`;
  const phaseNumber = String(number).padStart(2, '0');
  writeFile(`${phaseDir}/${phaseNumber}-PLAN.md`, [
    '---',
    'ui_proof_slots:',
    '  - slot_id: ui-01-missing-bundle',
    '---',
    `# Phase ${number} Plan`,
    '',
  ].join('\n'));
  writeFile(`${phaseDir}/ui-proof-slots.json`, JSON.stringify({ ui_proof_slots: [slot] }, null, 2));
  writeFile(`${phaseDir}/${phaseNumber}-SUMMARY.md`, `# Phase ${number} Summary\n`);
}

describe('closeout-report helper', () => {
  test('defaults to the latest completed phase in the active roadmap', async () => {
    await initWorkspace();
    writeRoadmap();
    writeCompletedPhase(1, 'first-closed-phase');
    writeCompletedPhase(2, 'latest-closed-phase');

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const report = JSON.parse(result.output);

    assert.strictEqual(report.operation, 'closeout-report');
    assert.strictEqual(report.phase, '2');
    assert.strictEqual(report.scope.defaulted_to_latest_completed, true);
    assert.ok(!report.next_safe_action.command.startsWith('/gsdd-'));
    assert.ok('control_map' in report);
    assert.ok('health' in report);
    assert.ok('preflight' in report);
    assert.ok('phase_verification' in report);
    assert.ok('ui_proof' in report);
    assert.ok(Array.isArray(report.blockers));
    assert.ok(Array.isArray(report.warnings));
    assert.ok(report.next_safe_action.command);
  });

  test('supports explicit phase replay', async () => {
    await initWorkspace();
    writeRoadmap();
    writeCompletedPhase(1, 'first-closed-phase');
    writeCompletedPhase(2, 'latest-closed-phase');

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const report = JSON.parse(result.output);

    assert.strictEqual(report.phase, '1');
    assert.strictEqual(report.scope.defaulted_to_latest_completed, false);
    assert.strictEqual(report.phase_verification.status, 'passed');
    assert.strictEqual(report.ui_proof.status, 'not_applicable');
  });

  test('next safe action routes to health when health warnings are present', async () => {
    await initWorkspace();
    writeRoadmap();
    writeCompletedPhase(1, 'first-closed-phase');
    // Emit a health warning without blocking preflight/phase verification.
    fs.unlinkSync(path.join(tmpDir, '.planning', 'generation-manifest.json'));

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const report = JSON.parse(result.output);

    assert.ok(report.warnings.some((entry) => entry.source === 'health'));
    assert.strictEqual(report.next_safe_action.command, 'gsdd health --json');
  });

  test('aggregates typed blockers from direct phase verification', async () => {
    await initWorkspace();
    writeRoadmap();
    writeFile('.planning/phases/03-pending-phase/03-PLAN.md', [
      '---',
      'ui_proof_slots: []',
      'no_ui_proof_rationale: CLI-only report test.',
      '---',
      '# Phase 3 Plan',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '3']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const report = JSON.parse(result.output);

    assert.strictEqual(report.status, 'blocked');
    assert.ok(report.blockers.some((entry) => entry.source === 'phase_verification' && entry.code === 'missing_phase_summary'));
    assert.strictEqual(report.phase_verification.verified, false);
  });

  test('passes UI-proof status through from direct phase verification', async () => {
    await initWorkspace();
    writeRoadmap();
    writeFile('.planning/phases/01-first-closed-phase/01-PLAN.md', [
      '---',
      'ui_proof_slots:',
      '  - slot_id: missing-ui-proof',
      '---',
      '# Phase 1 Plan',
    ].join('\n'));
    writeFile('.planning/phases/01-first-closed-phase/01-SUMMARY.md', '# Phase 1 Summary\n');

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const report = JSON.parse(result.output);

    assert.strictEqual(report.ui_proof.status, 'missing');
    assert.ok(report.blockers.some((entry) => entry.source === 'ui_proof'));
  });

  test('treats required ui_proof failures as blockers even when uiProof.errors is empty', async () => {
    await initWorkspace();
    writeRoadmap();
    writePhaseWithMissingObservedUiProof(1, 'first-closed-phase', {
      slot_id: 'ui-01-missing-bundle',
      requirement_id: 'CLOSE-01',
      claim: 'A deterministic non-empty UI claim for closeout validation.',
      route_state: '/closeout/test',
      required_evidence_kinds: ['code', 'runtime'],
      minimum_observations: [
        'Capture deterministic evidence for route and viewport.',
      ],
      environment: { app_url: 'file://test', data_state: 'synthetic' },
      viewport: { width: 1280, height: 720 },
      expected_artifact_types: ['screenshot'],
      validation_command: 'gsdd ui-proof validate .planning/phases/01-first-closed-phase/proof-bundle.json',
      manual_acceptance_required: false,
      claim_limit: 'Proof does not establish accessibility.',
    });

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '1']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const report = JSON.parse(result.output);

    assert.strictEqual(report.phase, '1');
    assert.strictEqual(report.ui_proof.status, 'missing');
    assert.strictEqual(report.ui_proof.blocks_verification, true);
    assert.ok(report.blockers.some((entry) => entry.source === 'ui_proof'));
  });

  test('is read-only for roadmap, fingerprint, annotations, branches, worktrees, and report files', async () => {
    await initWorkspace();
    writeRoadmap();
    writeCompletedPhase(1, 'first-closed-phase');
    writeFile('.planning/.state-fingerprint.json', '{"before":true}\n');
    writeFile('.planning/.local/control-map.annotations.json', '{"worktrees":[]}\n');
    const rebaseline = await runCliAsMain(tmpDir, ['session-fingerprint', 'write']);
    assert.strictEqual(rebaseline.exitCode, 0, rebaseline.output);
    const before = new Map([
      ['.planning/ROADMAP.md', fs.readFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), 'utf-8')],
      ['.planning/.state-fingerprint.json', fs.readFileSync(path.join(tmpDir, '.planning', '.state-fingerprint.json'), 'utf-8')],
      ['.planning/.local/control-map.annotations.json', fs.readFileSync(path.join(tmpDir, '.planning', '.local', 'control-map.annotations.json'), 'utf-8')],
    ]);

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);

    for (const [relativePath, content] of before.entries()) {
      assert.strictEqual(fs.readFileSync(path.join(tmpDir, relativePath), 'utf-8'), content, `${relativePath} must not change`);
    }
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'closeout-report.json')), false);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.planning', 'closeout-report.json')), false);
  });

  test('top-level warnings do not duplicate control-map risks from preflight', async () => {
    await initGitWorkspace();
    writeRoadmap();
    writeCompletedPhase(1, 'first-closed-phase');
    writeFile('tracked.txt', 'tracked changed\n');

    const result = await runCliAsMain(tmpDir, ['closeout-report', '--json', '--phase', '1']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const report = JSON.parse(result.output);
    const canonicalDirtyWarnings = report.warnings.filter((entry) => entry.code === 'canonical_dirty');

    assert.strictEqual(canonicalDirtyWarnings.length, 1);
    assert.strictEqual(canonicalDirtyWarnings[0].source, 'control_map');
    assert.ok(canonicalDirtyWarnings[0].fix, 'control_map warnings should include fix guidance');
    assert.ok(report.preflight.warnings.some((entry) => entry.source === 'control-map' && entry.code === 'canonical_dirty'));
  });

  test('generated local helper emits typed closeout report with explicit health availability boundary', async () => {
    await initWorkspace();
    writeRoadmap();
    writeCompletedPhase(1, 'first-closed-phase');
    const helperPath = path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs');

    const result = spawnSync(process.execPath, [helperPath, 'closeout-report', '--json', '--phase', '1'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);

    assert.strictEqual(report.operation, 'closeout-report');
    assert.strictEqual(report.phase, '1');
    assert.ok(report.health.warnings.some((entry) => entry.id === 'W_CLOSEOUT_HEALTH_UNAVAILABLE'));
    assert.strictEqual(report.phase_verification.status, 'passed');
  });
});
