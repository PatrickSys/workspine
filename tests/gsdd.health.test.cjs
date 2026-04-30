/**
 * GSDD Health Command Tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { createTempProject, loadGsdd, runCliAsMain, cleanup } = require('./gsdd.helpers.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

/**
 * Helper: run gsdd init in tmpDir to get a healthy workspace.
 */
async function initWorkspace() {
  const result = await runCliAsMain(tmpDir, ['init']);
  assert.strictEqual(result.exitCode, 0, `init failed: ${result.output}`);
}

function writeFile(relativePath, content) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function writeAlignedTruthFixtures() {
  writeFile('distilled/DESIGN.md', `## 20. Workspace Health Diagnostics

| ID | Severity | What it checks |
|----|----------|----------------|
| E1 | ERROR | x |
| E2 | ERROR | x |
| E3 | ERROR | x |
| E4 | ERROR | x |
| E5 | ERROR | x |
| E6 | ERROR | x |
| E7 | ERROR | x |
| E8 | ERROR | x |
| E9 | ERROR | x |
| E10 | ERROR | x |
| W1 | WARN | x |
| W2 | WARN | x |
| W3 | WARN | x |
| W4 | WARN | x |
| W5 | WARN | x |
| W6 | WARN | x |
| W7 | WARN | x |
| W8 | WARN | x |
| W9 | WARN | x |
| W10 | WARN | x |
| W11 | WARN | x |
| W12 | WARN | x |
| I1 | INFO | x |
| I2 | INFO | x |
| I3 | INFO | x |

**Verdict logic:**
`);
  writeFile('distilled/README.md', [
    '## Current Status (updated 2026-04-10)',
    '',
    '| Workflow | Status | Notes |',
    '|----------|--------|-------|',
    '| `alpha.md` | [OK] | x |',
    '| `beta.md` | [OK] | x |',
    '',
    'Architecture notes:',
    '',
    '## Files In This Framework',
    '',
    '```',
    'distilled/',
    '  workflows/',
    '    alpha.md',
    '    beta.md',
    '  templates/',
    '```',
    '',
  ].join('\n'));
  writeFile('distilled/workflows/alpha.md', '# alpha\n');
  writeFile('distilled/workflows/beta.md', '# beta\n');
  writeFile('.internal-research/gaps.md', 'See `.planning/SPEC.md` and `.planning/ROADMAP.md`.\n');
  writeFile('.planning/SPEC.md', '- [ ] **[LAUNCH-07]**: Health\n');
  writeFile('.planning/ROADMAP.md', '- [ ] **Phase 16: Framework Health & Truth Reconciliation** — [LAUNCH-07]\n');
}

function writeWorkflowInventoryReadme({ heading = '## Workflow Surface', rows = ['alpha.md', 'beta.md'], treeLines }) {
  const tableIntro = heading.startsWith('## Current Status')
    ? ['| Workflow | Status | Notes |', '|----------|--------|-------|']
    : ['| Workflow | What ships |', '|----------|------------|'];
  const tableRows = rows.map((file) => `| \`${file}\` | x |`);
  writeFile('distilled/README.md', [
    heading,
    '',
    ...tableIntro,
    ...tableRows,
    '',
    'Architecture notes:',
    '',
    '## Files In This Framework',
    '',
    '```',
    ...(treeLines || [
      'distilled/',
      '  workflows/',
      '    alpha.md',
      '    beta.md',
      '  templates/',
    ]),
    '```',
    '',
  ].join('\n'));
}

function writeForkHonestAlignmentFixtures() {
  writeFile('.internal-research/gaps.md', [
    'Historical checkpoint evidence is recorded against the active checkpoint file rather than a stale missing repo path.',
    '',
    '### Gap I39 - archived routing seam',
    '',
    '- Status: CLOSED',
    '- Closure evidence: archived-with-ROADMAP routing now depends on the shipped ledger and matching archived audit artifact.',
  ].join('\n'));
  writeFile('.planning/SPEC.md', [
    '- [x] **[IDENT-01]**: Identity\n',
    '- [x] **[IDENT-02]**: Retained contracts\n',
    '- [x] **[PROOF-01]**: Public proof\n',
    '- [x] **[FLOW-04]**: Archive routing and health integrity\n',
  ].join(''));
  writeFile('.planning/ROADMAP.md', [
    '- [x] **Phase 23: Launch Posture Lock** — [IDENT-01]',
    '- [x] **Phase 24: Naming Contract Reconciliation** — [IDENT-02]',
    '- [x] **Phase 25: Public Proof Export** — [PROOF-01]',
    '- [x] **Phase 26: Routing And Health Integrity** — [FLOW-04]',
    '- [ ] **Phase 27: Release Packaging Audit** — [PACK-01]',
    '',
  ].join('\n'));
}

function validUiProofBundle(overrides = {}) {
  return {
    proof_bundle_version: 1,
    scope: {
      work_item: 'quick-001-example-ui',
      requirement_ids: ['quick-001'],
      slot_ids: ['quick-001-ui-01'],
      claim: 'Local reviewer can inspect changed UI proof metadata.',
    },
    route_state: { route: '/example', state: 'synthetic user' },
    environment: { app_url: 'http://localhost:3000', data_state: 'synthetic' },
    viewport: { width: 1280, height: 720 },
    evidence_inputs: { kinds: ['test', 'runtime'], tools_used: ['manual'] },
    commands_or_manual_steps: [{ manual_step: 'Open /example.', result: 'passed' }],
    observations: [{
      observation: 'Changed state is visible.',
      claim: 'Local reviewer can inspect the changed UI proof metadata.',
      route_state: { route: '/example', state: 'synthetic user' },
      evidence_kind: 'runtime',
      artifact_refs: ['artifacts/report.html'],
      privacy: { data_classification: 'synthetic', raw_artifacts_safe_to_publish: false, retention: 'temporary_review' },
      result: 'passed',
      claim_limit: 'Does not prove unrelated UI states.',
    }],
    artifacts: [{
      path: 'artifacts/report.html',
      type: 'report',
      visibility: 'local_only',
      retention: 'temporary_review',
      sensitivity: 'synthetic',
      safe_to_publish: false,
    }],
    privacy: {
      data_classification: 'synthetic',
      redactions: [],
      raw_artifacts_safe_to_publish: false,
      retention: 'Keep raw artifacts only while needed for review.',
    },
    result: { claim_status: 'passed', comparison_status_by_slot: { 'quick-001-ui-01': 'satisfied' } },
    claim_limits: ['Does not prove unrelated UI states.'],
    ...overrides,
  };
}

describe('Health — pre-init guard', () => {
  test('no .planning/ → pre-init error with exit code 1', async () => {
    const result = await runCliAsMain(tmpDir, ['health']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /Not initialized/);
    assert.match(result.output, /gsdd init/);
  });

  test('no .planning/ with --json → broken JSON', async () => {
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    assert.strictEqual(result.exitCode, 1);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'broken');
    assert.ok(json.errors.length > 0);
    assert.strictEqual(json.errors[0].id, 'E1');
  });
});

describe('Health — healthy workspace', () => {
  test('clean init → healthy verdict', async () => {
    await initWorkspace();
    const result = await runCliAsMain(tmpDir, ['health']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /HEALTHY/);
    assert.doesNotMatch(result.output, /\[I1\]/);
  });

  test('clean init → healthy JSON', async () => {
    await initWorkspace();
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    assert.strictEqual(result.exitCode, 0);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'healthy');
    assert.strictEqual(json.errors.length, 0);
    assert.strictEqual(json.warnings.length, 0);
    assert.ok(!json.info.some((i) => i.id === 'I1'), 'clean init should not report manifest version drift');
  });

  test('nested cwd with explicit --workspace-root → healthy JSON', async () => {
    await initWorkspace();
    const nestedDir = path.join(tmpDir, 'apps', 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });
    const result = await runCliAsMain(nestedDir, ['health', '--json', '--workspace-root', tmpDir]);
    assert.strictEqual(result.exitCode, 0);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'healthy');
  });
});

describe('Health — ERROR: malformed config.json', () => {
  test('unparseable config.json → broken', async () => {
    await initWorkspace();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{bad json!!!');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    assert.strictEqual(result.exitCode, 1);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'broken');
    assert.ok(json.errors.some((e) => e.id === 'E1'));
  });
});

describe('Health — ERROR: missing required config fields', () => {
  test('config.json missing researchDepth → E2', async () => {
    await initWorkspace();
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    delete config.researchDepth;
    fs.writeFileSync(configPath, JSON.stringify(config));
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E2'));
    assert.match(json.errors.find((e) => e.id === 'E2').message, /researchDepth/);
  });
});

describe('Health — ERROR: missing templates dir', () => {
  test('templates/ removed → E3 without child-template noise', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'broken');
    assert.ok(json.errors.some((e) => e.id === 'E3'));
    assert.ok(!json.errors.some((e) => e.id === 'E4' || e.id === 'E5'),
      'missing templates root should not duplicate child-template errors');
    assert.ok(!json.warnings.some((w) => w.id === 'W3'),
      'missing templates root should not emit manifest-derived missing-file warnings');
  });
});

describe('Health — ERROR: missing roles dir', () => {
  test('roles/ removed → E4', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates', 'roles'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E4'));
  });

  test('roles/ exists but empty → E4', async () => {
    await initWorkspace();
    const rolesDir = path.join(tmpDir, '.planning', 'templates', 'roles');
    for (const f of fs.readdirSync(rolesDir)) {
      fs.unlinkSync(path.join(rolesDir, f));
    }
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E4' && e.message.includes('0 role files')));
  });
});

describe('Health — ERROR: missing delegates dir', () => {
  test('delegates/ removed → E5', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates', 'delegates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E5'));
  });
});

describe('Health — ERROR: missing research/codebase/root templates', () => {
  test('research/ removed → E6', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates', 'research'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E6'));
  });

  test('codebase/ removed → E7', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates', 'codebase'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E7'));
  });

  test('critical root template file removed → E8', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates', 'spec.md'), { force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E8' && e.message.includes('spec.md')));
  });

  test('ui-proof root template removed → E8', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates', 'ui-proof.md'), { force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E8' && e.message.includes('ui-proof.md')));
  });
});

describe('Health — ERROR: invalid UI proof bundle metadata', () => {
  test('invalid known UI proof bundle → E10 without mutating files', async () => {
    await initWorkspace();
    const bundlePath = path.join(tmpDir, '.planning', 'ui-proof.json');
    const invalidBundle = validUiProofBundle({ proof_claim: 'public' });
    fs.writeFileSync(bundlePath, JSON.stringify(invalidBundle, null, 2));
    const before = fs.readFileSync(bundlePath, 'utf-8');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.strictEqual(json.status, 'broken');
    assert.ok(json.errors.some((e) => e.id === 'E10' && e.message.includes('unsafe_public_proof_claim')));
    assert.strictEqual(fs.readFileSync(bundlePath, 'utf-8'), before, 'health must not mutate UI proof bundles');
  });

  test('invalid nested brownfield UI proof bundle → E10', async () => {
    await initWorkspace();
    writeFile('.planning/brownfield-change/change-001/UI-PROOF.md', '```json\n{"proof_bundle_version":1}\n```\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.strictEqual(result.exitCode, 1);
    assert.ok(json.errors.some((e) => e.id === 'E10' && e.message.includes('brownfield-change/change-001/UI-PROOF.md')));
  });

  test('valid local-only known UI proof bundle → no E10', async () => {
    await initWorkspace();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ui-proof.json'), JSON.stringify(validUiProofBundle(), null, 2));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.ok(!json.errors.some((e) => e.id === 'E10'));
  });

  test('valid local-only dogfood UI proof bundle → no E10', async () => {
    await initWorkspace();
    writeFile('.planning/phases/58-dogfood-ui-proof-loop/proof-bundle.json', JSON.stringify(validUiProofBundle({
      scope: {
        work_item: 'phase-58-dogfood-ui-proof-loop',
        requirement_ids: ['UIPROOF-10'],
        slot_ids: ['ui-58-valid-scoped-proof'],
        claim: 'Local-only dogfood UI proof validates metadata for a generated fixture.',
      },
      result: { claim_status: 'passed', comparison_status_by_slot: { 'ui-58-valid-scoped-proof': 'satisfied' } },
    }), null, 2));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.ok(!json.errors.some((e) => e.id === 'E10'));
  });

  test('unsafe public-style dogfood UI proof bundle → E10 without mutating files', async () => {
    await initWorkspace();
    const bundlePath = path.join(tmpDir, '.planning', 'phases', '58-dogfood-ui-proof-loop', 'proof-bundle.json');
    const invalidBundle = validUiProofBundle({
      proof_claims: ['public', 'tracked', 'delivery', 'release', 'publication'],
      scope: {
        work_item: 'phase-58-dogfood-ui-proof-loop',
        requirement_ids: ['UIPROOF-10'],
        slot_ids: ['ui-58-valid-scoped-proof'],
        claim: 'Unsafe public-style dogfood UI proof must fail closed.',
      },
      result: { claim_status: 'passed', comparison_status_by_slot: { 'ui-58-valid-scoped-proof': 'satisfied' } },
    });
    writeFile('.planning/phases/58-dogfood-ui-proof-loop/proof-bundle.json', JSON.stringify(invalidBundle, null, 2));
    const before = fs.readFileSync(bundlePath, 'utf-8');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.strictEqual(json.status, 'broken');
    assert.ok(json.errors.some((e) => e.id === 'E10' && e.message.includes('unsafe_public_proof_claim')));
    assert.strictEqual(fs.readFileSync(bundlePath, 'utf-8'), before, 'health must not mutate dogfood UI proof bundles');
  });
});

describe('Health — WARN: missing manifest', () => {
  test('manifest deleted → W1', async () => {
    await initWorkspace();
    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W1'));
    assert.strictEqual(json.status, 'degraded');
    assert.strictEqual(result.exitCode, 0);
  });
});

describe('Health — WARN: modified template (hash mismatch)', () => {
  test('delegate file modified → W2', async () => {
    await initWorkspace();
    const delegatesDir = path.join(tmpDir, '.planning', 'templates', 'delegates');
    const files = fs.readdirSync(delegatesDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length > 0, 'should have delegate files');
    const target = path.join(delegatesDir, files[0]);
    fs.appendFileSync(target, '\n<!-- local modification -->\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W2');
    assert.ok(warning, 'should have W2 warning for modified template');
    assert.match(warning.message, /manifest-tracked installed file\(s\) modified locally/);
  });
});

describe('Health — WARN: deleted template file (in manifest, not on disk)', () => {
  test('delegate file deleted → W3', async () => {
    await initWorkspace();
    const delegatesDir = path.join(tmpDir, '.planning', 'templates', 'delegates');
    const files = fs.readdirSync(delegatesDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length > 0);
    fs.unlinkSync(path.join(delegatesDir, files[0]));
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W3');
    assert.ok(warning, 'should have W3 warning for missing template');
    assert.match(warning.message, /manifest-tracked installed file\(s\) missing from disk/);
  });
});

describe('Health — WARN: ROADMAP references nonexistent phase', () => {
  test('ROADMAP with active in-progress phase but no phase files → W4', async () => {
    await initWorkspace();
    const roadmapContent = `# Roadmap\n\n- [-] **Phase 1: Foundation**\n- [ ] **Phase 2: API**\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W4'), 'should warn about missing phase dirs');
  });

  test('ROADMAP planned future phases without artifacts → no W4', async () => {
    await initWorkspace();
    const roadmapContent = `# Roadmap\n\n- [ ] **Phase 1: Foundation**\n- [ ] **Phase 2: API**\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(!json.warnings.some((w) => w.id === 'W4'), 'should ignore future planned phases');
  });

  test('active phase with only non-lifecycle artifacts → W4 without W5', async () => {
    await initWorkspace();
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n- [x] **Phase 47: Synthesis And v1.7 Plan**\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '47-synthesis-and-v1-7-plan');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '47-v1.7-IMPLEMENTATION-PLAN.md'),
      '# Next Milestone Implementation Plan\n'
    );

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.ok(json.warnings.some((w) => w.id === 'W4' && /Phase 47/.test(w.message)),
      'non-lifecycle artifacts must not make active phase health clean');
    assert.ok(!json.warnings.some((w) => w.id === 'W5'),
      'non-lifecycle artifacts must not create stale PLAN/SUMMARY warnings');
  });
});

describe('Health — WARN: phase with PLAN but no SUMMARY', () => {
  test('nested PLAN without SUMMARY → W5', async () => {
    await initWorkspace();
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Phase 1 Plan\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W5'), 'should warn about stale in-progress phase');
  });

  test('nested PLAN with SUMMARY → no W5', async () => {
    await initWorkspace();
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Phase 1 Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Phase 1 Summary\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(!json.warnings.some((w) => w.id === 'W5'), 'should not warn when SUMMARY exists');
  });
});

describe('Health — WARN: adapter and truth drift detection', () => {
  test('no adapter surfaces detected → W6', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W6');
    assert.ok(warning);
    assert.match(warning.message, /No generated workflow adapter surfaces detected/);
  });

  test('empty or unrelated runtime directories still report W6', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.opencode', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.opencode', 'commands', 'local-note.md'), '# local note\n');
    fs.mkdirSync(path.join(tmpDir, '.codex', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.codex', 'agents', 'local.toml'), 'name = "local"\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W6');
    assert.ok(warning, 'empty or unrelated runtime directories must not count as generated workflow adapter surfaces');
    assert.match(warning.message, /No generated workflow adapter surfaces detected/);
  });

  test('Codex native agents without skills still report W6', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(tmpDir, '.codex', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'name = "gsdd-plan-checker"\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W6');
    assert.ok(warning, 'Codex checker agents do not replace workflow entry surfaces and must not suppress W6');
    assert.match(warning.message, /No generated workflow adapter surfaces detected/);
  });

  test('Claude and OpenCode generated agents without commands or skills still report W6', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(tmpDir, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), '# checker\n');
    fs.mkdirSync(path.join(tmpDir, '.opencode', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), '# checker\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W6');
    assert.ok(warning, 'generated checker agents do not replace workflow entry surfaces and must not suppress W6');
    assert.match(warning.message, /No generated workflow adapter surfaces detected/);
    assert.ok(json.info.some((i) => i.id === 'I3' && /claude/.test(i.message) && /opencode/.test(i.message)),
      'agent-only runtime surfaces should still be reported by I3 for visibility');
  });

  test('DESIGN.md health table drift → W7', async () => {
    await initWorkspace();
    writeFile('distilled/DESIGN.md', `## 20. Workspace Health Diagnostics

| ID | Severity | What it checks |
|----|----------|----------------|
| E1 | ERROR | x |
| E2 | ERROR | x |
| E3 | ERROR | x |

**Verdict logic:**
`);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W7'));
  });

  test('README workflow inventory drift → W8', async () => {
    await initWorkspace();
    writeFile('distilled/README.md', [
      '## Current Status (updated 2026-04-10)',
      '',
      '| Workflow | Status | Notes |',
      '|----------|--------|-------|',
      '| `alpha.md` | [OK] | x |',
      '',
      'Architecture notes:',
      '',
      '## Files In This Framework',
      '',
      '```',
      'distilled/',
      '  workflows/',
      '    alpha.md',
      '  templates/',
      '```',
      '',
    ].join('\n'));
    writeFile('distilled/workflows/alpha.md', '# alpha\n');
    writeFile('distilled/workflows/beta.md', '# beta\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W8'));
  });

  test('current Workflow Surface inventory shape → no W8', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    writeWorkflowInventoryReadme({ heading: '## Workflow Surface' });

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.ok(!json.warnings.some((w) => w.id === 'W8'),
      'current Workflow Surface table and plain tree shape should align with workflows dir');
  });

  test('legacy Current Status inventory shape → no W8', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    writeWorkflowInventoryReadme({ heading: '## Current Status (updated 2026-04-10)' });

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.ok(!json.warnings.some((w) => w.id === 'W8'),
      'legacy Current Status table should remain compatible with workflows dir');
  });

  test('framework tree glyph inventory shape → no W8', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    writeWorkflowInventoryReadme({
      heading: '## Workflow Surface',
      treeLines: [
        'distilled/',
        '├── workflows/',
        '│   ├── alpha.md',
        '│   └── beta.md',
        '└── templates/',
      ],
    });

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    assert.ok(!json.warnings.some((w) => w.id === 'W8'),
      'tree glyph framework inventory should align with workflows dir');
  });

  test('missing workflow table entry → W8', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    writeWorkflowInventoryReadme({ rows: ['alpha.md'] });

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    const warning = json.warnings.find((w) => w.id === 'W8');
    assert.ok(warning, 'missing workflow table entry should warn');
    assert.match(warning.message, /missing from status table: beta\.md/);
  });

  test('canonical Workflow Surface table is not masked by legacy Current Status rows', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    writeFile('distilled/README.md', [
      '## Workflow Surface',
      '',
      '| Workflow | What ships |',
      '|----------|------------|',
      '| `alpha.md` | x |',
      '',
      'Architecture notes:',
      '',
      '## Current Status (updated 2026-04-10)',
      '',
      '| Workflow | Status | Notes |',
      '|----------|--------|-------|',
      '| `alpha.md` | x |',
      '| `beta.md` | x |',
      '',
      'Architecture notes:',
      '',
      '## Files In This Framework',
      '',
      '```',
      'distilled/',
      '  workflows/',
      '    alpha.md',
      '    beta.md',
      '  templates/',
      '```',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    const warning = json.warnings.find((w) => w.id === 'W8');
    assert.ok(warning, 'canonical Workflow Surface drift should warn even when legacy Current Status is complete');
    assert.match(warning.message, /missing from status table: beta\.md/);
  });

  test('missing workflow tree entry → W8', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    writeWorkflowInventoryReadme({
      rows: ['alpha.md', 'beta.md'],
      treeLines: [
        'distilled/',
        '  workflows/',
        '    alpha.md',
        '  templates/',
      ],
    });

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);

    const warning = json.warnings.find((w) => w.id === 'W8');
    assert.ok(warning, 'missing workflow tree entry should warn');
    assert.match(warning.message, /missing from framework tree: beta\.md/);
  });

  test('gaps.md stale repo-local path reference → W9', async () => {
    await initWorkspace();
    writeFile('.internal-research/gaps.md', 'Missing file: `distilled/missing.md`\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W9'));
  });

  test('gaps.md command and branch references do not trigger W9', async () => {
    await initWorkspace();
    writeFile('.internal-research/gaps.md', 'Use `/gsdd-verify` on `feat/example-branch` after reviewing `.planning/config.json`.\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(!json.warnings.some((w) => w.id === 'W9'));
  });

  test('ROADMAP/SPEC requirement mismatch → W10', async () => {
    await initWorkspace();
    writeFile('.planning/SPEC.md', '- [x] **[LAUNCH-07]**: Health\n');
    writeFile('.planning/ROADMAP.md', '- [ ] **Phase 16: Framework Health & Truth Reconciliation** — [LAUNCH-07]\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W10'));
  });

  test('ROADMAP overview and Phase Details status mismatch → W10', async () => {
    await initWorkspace();
    writeFile('.planning/SPEC.md', '- [ ] **[LAUNCH-07]**: Health\n');
    writeFile('.planning/ROADMAP.md', [
      '# Roadmap',
      '',
      '- [-] **Phase 16: Framework Health & Truth Reconciliation** — [LAUNCH-07]',
      '',
      '## Phase Details',
      '',
      '### Phase 16: Framework Health & Truth Reconciliation',
      '**Status**: [x]',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W10');
    assert.ok(warning, 'should warn when overview/detail phase status differs');
    assert.match(warning.message, /ROADMAP lifecycle status drift/);
    assert.match(warning.message, /overview\/detail phase status mismatch/);
    assert.match(warning.message, /overview status in_progress disagrees with Phase Details status done/);
    assert.match(warning.fix, /overview\/detail phase markers/);
  });

  test('ROADMAP overview/detail mismatch still reports W10 when SPEC is missing', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'SPEC.md'), { force: true });
    writeFile('.planning/ROADMAP.md', [
      '# Roadmap',
      '',
      '- [-] **Phase 16: Framework Health & Truth Reconciliation**',
      '',
      '## Phase Details',
      '',
      '### Phase 16: Framework Health & Truth Reconciliation',
      '**Status**: [x]',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W10');
    assert.ok(warning, 'ROADMAP-only lifecycle drift must not depend on SPEC.md existing');
    assert.match(warning.message, /overview status in_progress disagrees with Phase Details status done/);
  });

  test('generated helper runtime drift under .planning/bin → W11 with npx-first update guidance', async () => {
    await initWorkspace();
    fs.appendFileSync(path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs'), '\n// drift\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'should warn when installed generated runtime surfaces drift');
    assert.match(warning.message, /Renderer-backed generated runtime and workflow-helper surfaces/);
    assert.match(warning.message, /\.planning\/bin\/gsdd\.mjs/);
    assert.match(warning.fix, /npx -y gsdd-cli update/);
  });

  test('missing generated helper runtime under .planning/bin → W11 repair guidance', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.planning/bin', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'missing .planning/bin helper should be repairable generated-surface drift');
    assert.match(warning.message, /\.planning\/bin\/gsdd\.mjs/);
    assert.match(warning.fix, /npx -y gsdd-cli update/);
  });

  test('aligned framework truth files → no W7-W10', async () => {
    await initWorkspace();
    writeAlignedTruthFixtures();
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    for (const id of ['W7', 'W8', 'W9', 'W10']) {
      assert.ok(!json.warnings.some((w) => w.id === id), `${id} should not be present when truth files align`);
    }
  });

  test('fork-honest v1.2.0 truth alignment clears W9 and W10', async () => {
    await initWorkspace();
    writeForkHonestAlignmentFixtures();
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    for (const id of ['W9', 'W10']) {
      assert.ok(!json.warnings.some((w) => w.id === id), `${id} should not be present when v1.2.0 truth aligns`);
    }
  });
});

describe('Health — INFO: version drift', () => {
  test('manifest frameworkVersion older than current framework → I1', async () => {
    await initWorkspace();
    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.frameworkVersion = 'v0.1';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.info.some((i) => i.id === 'I1'), 'should have I1 info about version drift');
  });
});

describe('Health — INFO: adapter detection', () => {
  test('runtime and governance surfaces installed → I3', async () => {
    await initWorkspace();
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Local governance\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const info = json.info.find((i) => i.id === 'I3');
    assert.ok(info, 'should report installed runtime/governance surfaces');
    assert.match(info.message, /Installed runtime\/governance surfaces/);
    assert.match(info.message, /root AGENTS\.md governance-only/);
  });
});

describe('Health — INFO: phase completion count', () => {
  test('ROADMAP phases counted → I2', async () => {
    await initWorkspace();
    writeFile('.planning/ROADMAP.md', `# Roadmap

- [x] **Phase 1: Foundation**
- [ ] **Phase 2: API**
`);
    writeFile('.planning/phases/01-foundation/01-SUMMARY.md', '# done\n');
    writeFile('.planning/phases/02-api/02-SUMMARY.md', '# pending artifact\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.info.some((i) => i.id === 'I2' && i.message.includes('1/2')));
  });

  test('I2 counts only the active milestone phases, not archived phases nested in details', async () => {
    await initWorkspace();
    writeFile('.planning/ROADMAP.md', [
      '# Roadmap',
      '',
      '<details open>',
      '<summary>✅ v1.2.0 Fork-Honest Launch Hardening</summary>',
      '',
      '- [x] **Phase 23: Launch Posture Lock**',
      '- [x] **Phase 24: Naming Contract Reconciliation**',
      '</details>',
      '',
      '### v1.3.0 Engine Contract Hardening',
      '',
      '- [x] **Phase 29: Contract Inventory And Claim Narrowing** — [ENGINE-01]',
      '- [ ] **Phase 30: Deterministic Lifecycle Gates** — [ENGINE-02]',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.info.some((i) => i.id === 'I2' && i.message.includes('1/2')),
      'I2 should report only the active milestone phase count');
  });
});

describe('Health — JSON output mode', () => {
  test('--json produces valid JSON with all required fields', async () => {
    await initWorkspace();
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok('status' in json);
    assert.ok('errors' in json);
    assert.ok('warnings' in json);
    assert.ok('info' in json);
    assert.ok(Array.isArray(json.errors));
    assert.ok(Array.isArray(json.warnings));
    assert.ok(Array.isArray(json.info));
  });
});

describe('Health — verdict logic', () => {
  test('errors → broken with exit 1', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'broken');
    assert.strictEqual(result.exitCode, 1);
  });

  test('warnings only → degraded with exit 0', async () => {
    await initWorkspace();
    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'degraded');
    assert.strictEqual(result.exitCode, 0);
  });

  test('no errors no warnings → healthy with exit 0', async () => {
    await initWorkspace();
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'healthy');
    assert.strictEqual(result.exitCode, 0);
  });
});

describe('Health — human-readable output', () => {
  test('default output includes verdict line', async () => {
    await initWorkspace();
    const result = await runCliAsMain(tmpDir, ['health']);
    assert.match(result.output, /Verdict:/);
    assert.match(result.output, /HEALTHY/);
  });

  test('error output includes ERROR markers and fix instructions', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health']);
    assert.match(result.output, /ERROR:/);
    assert.match(result.output, /Fix:/);
    assert.match(result.output, /BROKEN/);
  });
});

// ---------------------------------------------------------------------------
// Framework source mode (isFrameworkSourceRepo)
// Regression test: health must suppress E3-E8 and W1-W3 when run from the
// framework repo itself, where distilled/templates/ is the source of truth
// rather than an installed consumer copy.
// Skipped in CI because .planning/ is gitignored and won't be present there.
// ---------------------------------------------------------------------------
const FRAMEWORK_ROOT = path.join(__dirname, '..');
const planningConfigPath = path.join(FRAMEWORK_ROOT, '.planning', 'config.json');
const skipFrameworkSourceMode = !fs.existsSync(planningConfigPath)
  ? '.planning/ is gitignored and local-only — skip in CI'
  : false;

function extractJsonPayload(output) {
  const text = String(output).trim();
  const start = text.indexOf('{');
  if (start !== -1) {
    return JSON.parse(text.slice(start));
  }
  throw new Error(`No JSON object found in CLI output:\n${output}`);
}

describe('Health — framework source mode', () => {
  test('gsdd health in framework repo suppresses E3-E8 and W1-W3', { skip: skipFrameworkSourceMode }, async () => {
    const result = await runCliAsMain(FRAMEWORK_ROOT, ['health', '--json']);
    const parsed = extractJsonPayload(result.output);

    for (const id of ['E3', 'E4', 'E5', 'E6', 'E7', 'E8']) {
      assert.ok(
        !parsed.errors.some(e => e.id === id),
        `gsdd health in framework repo must suppress ${id} (frameworkSourceMode). FIX: Check isFrameworkSourceRepo detection in health.mjs.`
      );
    }
    for (const id of ['W1', 'W2', 'W3']) {
      assert.ok(
        !parsed.warnings.some(w => w.id === id),
        `gsdd health in framework repo must suppress ${id} (skipInstalledTemplateChecks). FIX: Check isFrameworkSourceRepo detection in health.mjs.`
      );
    }
    assert.notStrictEqual(
      parsed.status,
      'broken',
      'gsdd health in framework repo must not report broken status. FIX: Check frameworkSourceMode suppression logic in health.mjs.'
    );
  });

  test('source-like consumer repos do not suppress installed-project checks', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.planning', 'templates'), { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, 'distilled', 'templates'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'distilled', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'consumer-app' }));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const parsed = extractJsonPayload(result.output);

    assert.ok(parsed.errors.some(e => e.id === 'E3'),
      'consumer repos with distilled folders must still report missing installed templates. FIX: Keep framework-source detection tied to source repo identity.');
    assert.strictEqual(parsed.status, 'broken');
  });
});
