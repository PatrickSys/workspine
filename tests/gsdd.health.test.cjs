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
    assert.ok(json.warnings.some((w) => w.id === 'W2'), 'should have W2 warning for modified template');
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
    assert.ok(json.warnings.some((w) => w.id === 'W3'), 'should have W3 warning for missing template');
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
    assert.ok(json.warnings.some((w) => w.id === 'W6'));
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

  test('generated runtime surface drift → W11 with gsdd update guidance', async () => {
    await initWorkspace();
    fs.appendFileSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'), '\n<!-- drift -->\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'should warn when installed generated runtime surfaces drift');
    assert.match(warning.message, /\.agents\/skills\/gsdd-plan\/SKILL\.md/);
    assert.match(warning.fix, /gsdd update/);
  });

  test('local workflow helper drift → W11 with gsdd update guidance', async () => {
    await initWorkspace();
    fs.appendFileSync(path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs'), '\n// drift\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'should warn when local workflow helper drifts');
    assert.match(warning.message, /\.planning\/bin\/gsdd\.mjs/);
    assert.match(warning.fix, /gsdd update/);
  });

  test('no installed generated runtime surfaces → no W11', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(!json.warnings.some((w) => w.id === 'W11'), 'absence of generated runtime surfaces should not be treated as drift');
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
  test('adapters installed → I3', async () => {
    await initWorkspace();
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.info.some((i) => i.id === 'I3'), 'should report installed adapters');
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
      '<details>',
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
});
