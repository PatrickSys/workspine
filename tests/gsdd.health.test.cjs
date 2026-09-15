/**
 * GSDD Health Command Tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');

const { createTempProject, loadGsdd, runCliAsMain, cleanup, withEnv } = require('./gsdd.helpers.cjs');

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

function snapshotTree(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isSymbolicLink()) files.push([path.relative(rootDir, absolutePath).replace(/\\/g, '/'), `symlink:${fs.readlinkSync(absolutePath)}`]);
      else files.push([path.relative(rootDir, absolutePath).replace(/\\/g, '/'), fs.readFileSync(absolutePath)]);
    }
  };
  visit(rootDir);
  return files.sort(([left], [right]) => left.localeCompare(right));
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
  writeFile('.internal-research/gaps.md', 'See `.work/SPEC.md` and `.work/ROADMAP.md`.\n');
  writeFile('.work/SPEC.md', '- [ ] **[LAUNCH-07]**: Health\n');
  writeFile('.work/ROADMAP.md', '- [ ] **Phase 16: Framework Health & Truth Reconciliation** — [LAUNCH-07]\n');
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
  writeFile('.work/SPEC.md', [
    '- [x] **[IDENT-01]**: Identity\n',
    '- [x] **[IDENT-02]**: Retained contracts\n',
    '- [x] **[PROOF-01]**: Public proof\n',
    '- [x] **[FLOW-04]**: Archive routing and health integrity\n',
  ].join(''));
  writeFile('.work/ROADMAP.md', [
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
    assert.match(json.errors[0].fix, /npx -y workspine init/);
  });

  test('supported legacy state is a blocking migration issue and remains byte-identical', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    const config = Buffer.from(JSON.stringify({ initVersion: 'v1.1', keep: true }));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), config);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'broken');
    assert.strictEqual(parsed.errors[0].id, 'E1');
    assert.match(parsed.errors[0].message, /Run `npx -y workspine init --migrate`\./);
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.planning', 'config.json')), config);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work')), false);
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
    fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{bad json!!!');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    assert.strictEqual(result.exitCode, 1);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'broken');
    const error = json.errors.find((e) => e.id === 'E1');
    assert.ok(error);
    assert.match(error.fix, /Repair or restore .*config\.json manually/);
    assert.doesNotMatch(error.fix, /Run `npx -y workspine init`/);
  });
});

describe('Health — ERROR: missing required config fields', () => {
  test('config.json missing researchDepth → E2', async () => {
    await initWorkspace();
    const configPath = path.join(tmpDir, '.work', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    delete config.researchDepth;
    fs.writeFileSync(configPath, JSON.stringify(config));
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const error = json.errors.find((e) => e.id === 'E2');
    assert.ok(error);
    assert.match(error.message, /researchDepth/);
    assert.match(error.fix, /Repair or restore .*config\.json manually/);
    assert.doesNotMatch(error.fix, /Run `npx -y workspine init`/);
  });
});

describe('Health — ERROR: missing templates dir', () => {
  test('templates/ removed → E3 without child-template noise', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates'), { recursive: true, force: true });
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
    fs.rmSync(path.join(tmpDir, '.work', 'templates', 'roles'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E4'));
  });

  test('roles/ exists but empty → E4', async () => {
    await initWorkspace();
    const rolesDir = path.join(tmpDir, '.work', 'templates', 'roles');
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
    fs.rmSync(path.join(tmpDir, '.work', 'templates', 'delegates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E5'));
  });
});

describe('Health — ERROR: missing research/codebase/root templates', () => {
  test('research/ removed → E6', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates', 'research'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E6'));
  });

  test('codebase/ removed → E7', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates', 'codebase'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E7'));
  });

  test('critical root template file removed → E8', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates', 'spec.md'), { force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const error = json.errors.find((e) => e.id === 'E8' && e.message.includes('spec.md'));
    assert.ok(error);
    assert.strictEqual(error.fix, 'Run `npx -y workspine update`');
    const repaired = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(repaired.exitCode, 0, repaired.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'spec.md')));
  });

  test('ui-proof root template removed → E8', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates', 'ui-proof.md'), { force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.errors.some((e) => e.id === 'E8' && e.message.includes('ui-proof.md')));
  });
});

describe('Health — WARN: missing manifest', () => {
  test('manifest deleted → W1', async () => {
    await initWorkspace();
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W1');
    assert.ok(warning);
    assert.match(warning.fix, /Restore .*generation-manifest\.json.*trusted backup/);
    assert.match(warning.fix, /initialize a clean workspace/);
    assert.doesNotMatch(warning.fix, /Run `npx -y workspine update`/);
    assert.strictEqual(json.status, 'degraded');
    assert.strictEqual(result.exitCode, 0);
  });
});

describe('Health — WARN: modified template (hash mismatch)', () => {
  test('delegate file modified → W2', async () => {
    await initWorkspace();
    const delegatesDir = path.join(tmpDir, '.work', 'templates', 'delegates');
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
    const delegatesDir = path.join(tmpDir, '.work', 'templates', 'delegates');
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
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), roadmapContent);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W4'), 'should warn about missing phase dirs');
  });

  test('ROADMAP planned future phases without artifacts → no W4', async () => {
    await initWorkspace();
    const roadmapContent = `# Roadmap\n\n- [ ] **Phase 1: Foundation**\n- [ ] **Phase 2: API**\n`;
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), roadmapContent);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(!json.warnings.some((w) => w.id === 'W4'), 'should ignore future planned phases');
  });

  test('active phase with only non-lifecycle artifacts → W4 without W5', async () => {
    await initWorkspace();
    fs.writeFileSync(
      path.join(tmpDir, '.work', 'ROADMAP.md'),
      '# Roadmap\n\n- [x] **Phase 47: Synthesis And v1.7 Plan**\n'
    );
    const phaseDir = path.join(tmpDir, '.work', 'phases', '47-synthesis-and-v1-7-plan');
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

  test('active phase with only a superseded chain → W4 without W5', async () => {
    await initWorkspace();
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), '# Roadmap\n\n- [-] **Phase 2: API**\n');
    const phaseDir = path.join(tmpDir, '.work', 'phases', '02-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '02-PLAN.md'), '---\nstatus: superseded\n---\n# old plan\n');
    fs.writeFileSync(path.join(phaseDir, '02-SUMMARY.md'), '# old summary\n');
    fs.writeFileSync(path.join(phaseDir, '02-VERIFICATION.md'), '# retained evidence\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((entry) => entry.id === 'W4' && /Phase 2/.test(entry.message));
    assert.ok(warning, 'historical-only chains must be missing current lifecycle artifacts');
    assert.match(warning.message, /no current PLAN or SUMMARY/);
    assert.ok(!json.warnings.some((entry) => entry.id === 'W5'), 'historical PLAN must not be stale current work');
  });
});

describe('Health — WARN: phase with PLAN but no SUMMARY', () => {
  test('nested PLAN without SUMMARY → W5', async () => {
    await initWorkspace();
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Phase 1 Plan\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W5'), 'should warn about stale in-progress phase');
  });

  test('nested PLAN with SUMMARY → no W5', async () => {
    await initWorkspace();
    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-foundation');
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
    fs.writeFileSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'), 'name = "work-plan-checker"\n');

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
    fs.writeFileSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'), '# checker\n');
    fs.mkdirSync(path.join(tmpDir, '.opencode', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), '# checker\n');

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
    writeFile('.internal-research/gaps.md', 'Use `/work-verify` on `feat/example-branch` after reviewing `.work/config.json`.\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(!json.warnings.some((w) => w.id === 'W9'));
  });

  test('ROADMAP/SPEC requirement mismatch → W10', async () => {
    await initWorkspace();
    writeFile('.work/SPEC.md', '- [x] **[LAUNCH-07]**: Health\n');
    writeFile('.work/ROADMAP.md', '- [ ] **Phase 16: Framework Health & Truth Reconciliation** — [LAUNCH-07]\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W10'));
  });

  test('ROADMAP overview and Phase Details status mismatch → W10', async () => {
    await initWorkspace();
    writeFile('.work/SPEC.md', '- [ ] **[LAUNCH-07]**: Health\n');
    writeFile('.work/ROADMAP.md', [
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
    fs.rmSync(path.join(tmpDir, '.work', 'SPEC.md'), { force: true });
    writeFile('.work/ROADMAP.md', [
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

  test('generated helper runtime drift under .work/bin → W11 with npx-first update guidance', async () => {
    await initWorkspace();
    fs.appendFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'), '\n// drift\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'should warn when installed generated runtime surfaces drift');
    assert.match(warning.message, /Renderer-backed generated runtime and workflow-helper surfaces/);
    assert.match(warning.message, /\.work\/bin\/gsdd\.mjs/);
    assert.match(warning.fix, /npx -y workspine update/);
  });

  test('missing generated helper runtime under .work/bin → W11 repair guidance', async () => {
    await initWorkspace();
    for (const rel of ['.agents', '.work/bin', '.claude', '.opencode', '.codex']) {
      fs.rmSync(path.join(tmpDir, rel), { recursive: true, force: true });
    }
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'missing .work/bin helper should be repairable generated-surface drift');
    assert.match(warning.message, /\.work\/bin\/gsdd\.mjs/);
    assert.match(warning.fix, /npx -y workspine update/);
  });

  test('missing owned Claude runtime target → W11 emits supported init repair and restores the file', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initialized.exitCode, 0, initialized.output);
    const target = path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    fs.rmSync(target);

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'missing owned Claude target should emit W11');
    assert.match(warning.fix, /`npx -y workspine init --tools claude`/);
    assert.doesNotMatch(warning.fix, /workspine update --tools/);

    const repaired = await runCliAsMain(tmpDir, ['init', '--tools', 'claude']);
    assert.strictEqual(repaired.exitCode, 0, repaired.output);
    assert.ok(fs.existsSync(target), 'emitted init repair must restore the missing Claude target');
  });

  test('stale owned Claude runtime target → W11 keeps plain update repair', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initialized.exitCode, 0, initialized.output);
    const target = path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    fs.appendFileSync(target, '\n<!-- drift -->\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const warning = json.warnings.find((w) => w.id === 'W11');
    assert.ok(warning, 'stale owned Claude target should emit W11');
    assert.match(warning.fix, /`npx -y workspine update`/);
    assert.doesNotMatch(warning.fix, /workspine update --tools|workspine init --tools/);
  });

  test('mixed missing native plus stale helper W11 orders init repair before plain update', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initialized.exitCode, 0, initialized.output);
    fs.rmSync(path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md'));
    fs.appendFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'), '\n// drift\n');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const warning = JSON.parse(result.output).warnings.find((w) => w.id === 'W11');
    assert.ok(warning);
    const initIndex = warning.fix.indexOf('npx -y workspine init --tools claude');
    const updateIndex = warning.fix.indexOf('npx -y workspine update');
    assert.ok(initIndex >= 0 && updateIndex > initIndex, warning.fix);
    assert.doesNotMatch(warning.fix, /workspine update --tools/);
  });

  test('unowned generated-looking Claude target → W11 requires manual ownership repair first', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initialized.exitCode, 0, initialized.output);
    const relativeTarget = '.claude/skills/work-plan/SKILL.md';
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    delete manifest.adapterFiles[relativeTarget];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const warning = JSON.parse(result.output).warnings.find((w) => w.id === 'W11');
    assert.ok(warning);
    assert.match(warning.fix, /Resolve generated target ownership manually first/);
    assert.match(warning.fix, /\.claude\/skills\/work-plan\/SKILL\.md/);
    assert.doesNotMatch(warning.fix, /workspine (?:update|init) --tools/);
    assert.doesNotMatch(warning.fix, /`npx -y workspine update`/);
  });

  test('dangling owned Claude symlink → W11 stays manual and never emits init repair', async () => {
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.strictEqual(initialized.exitCode, 0, initialized.output);
    const target = path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    fs.unlinkSync(target);
    fs.symlinkSync(path.join(tmpDir, 'missing-dangling-skill.md'), target, 'file');

    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const warning = JSON.parse(result.output).warnings.find((w) => w.id === 'W11');
    assert.ok(warning, result.output);
    assert.match(warning.message, /\.claude\/skills\/work-plan\/SKILL\.md \[collision\]/);
    assert.match(warning.fix, /Resolve generated target ownership manually first/);
    assert.doesNotMatch(warning.fix, /workspine init --tools|`npx -y workspine update`/);
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
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
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
    writeFile('.work/ROADMAP.md', `# Roadmap

- [x] **Phase 1: Foundation**
- [ ] **Phase 2: API**
`);
    writeFile('.work/phases/01-foundation/01-SUMMARY.md', '# done\n');
    writeFile('.work/phases/02-api/02-SUMMARY.md', '# pending artifact\n');
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.info.some((i) => i.id === 'I2' && i.message.includes('1/2')));
  });

  test('I2 counts only the active milestone phases, not archived phases nested in details', async () => {
    await initWorkspace();
    writeFile('.work/ROADMAP.md', [
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

  test('buildHealthReport matches JSON command output', async () => {
    await initWorkspace();
    const gsdd = await loadGsdd(tmpDir);
    const healthModule = await import(`file://${path.join(__dirname, '..', 'bin', 'lib', 'health.mjs').replace(/\\/g, '/')}`);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    const built = healthModule.buildHealthReport(gsdd.createCliContext(tmpDir), ['--workspace-root', tmpDir]);

    assert.deepStrictEqual(built, json);
  });
});

describe('Health — verdict logic', () => {
  test('errors → broken with exit 1', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'broken');
    assert.strictEqual(result.exitCode, 1);
  });

  test('warnings only → degraded with exit 0', async () => {
    await initWorkspace();
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
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
    assert.match(result.output, /gsdd health - workspace integrity check/);
    assert.doesNotMatch(result.output, /â€”/);
    assert.match(result.output, /Verdict:/);
    assert.match(result.output, /HEALTHY/);
  });

  test('error output includes ERROR markers and fix instructions', async () => {
    await initWorkspace();
    fs.rmSync(path.join(tmpDir, '.work', 'templates'), { recursive: true, force: true });
    const result = await runCliAsMain(tmpDir, ['health']);
    assert.match(result.output, /ERROR:/);
    assert.match(result.output, /Fix:/);
    assert.match(result.output, /BROKEN/);
  });
});

describe('Health — global agent homes', () => {
  test('global health is read-only and reports modified owned bytes', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const skillPath = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        const clean = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        assert.strictEqual(clean.exitCode, 0, clean.output);
        assert.strictEqual(JSON.parse(clean.output).status, 'healthy');
        fs.appendFileSync(skillPath, '\nuser edit\n');
        const beforeHealthHome = snapshotTree(homeDir);
        const beforeHealthRepo = snapshotTree(repoDir);
        const degraded = await runCliAsMain(repoDir, ['health', '-g', '--json']);
        assert.strictEqual(degraded.exitCode, 0, degraded.output);
        const degradedReport = JSON.parse(degraded.output);
        assert.strictEqual(degradedReport.status, 'degraded');
        assert.ok(degradedReport.warnings.some((warning) => warning.message.includes('modified')));
        for (const issue of [...degradedReport.errors, ...degradedReport.warnings]) {
          assert.doesNotMatch(issue.fix, /update --global/, 'unsafe global health must not emit automatic update repair');
        }
        assert.match(degradedReport.warnings.find((warning) => warning.message.includes('modified')).fix, /Preserve the existing file/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeHealthHome, 'global health must not rewrite the modified owned home');
        assert.deepStrictEqual(snapshotTree(repoDir), beforeHealthRepo, 'global health must not touch the invoking repo');
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global health reports user-modified obsolete manifest entries and blocks update-global', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const obsoleteRelativePath = 'skills/work-obsolete/SKILL.md';
    const obsoletePath = path.join(homeDir, '.claude', ...obsoleteRelativePath.split('/'));
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        fs.mkdirSync(path.dirname(obsoletePath), { recursive: true });
        const originalBytes = 'obsolete package-owned bytes\n';
        fs.writeFileSync(obsoletePath, originalBytes);
        const manifestPath = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        manifest.files[obsoleteRelativePath] = createHash('sha256').update(originalBytes).digest('hex');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        fs.appendFileSync(obsoletePath, 'user edit\n');

        const beforeHealth = snapshotTree(homeDir);
        const health = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const report = JSON.parse(health.output);
        const issue = report.warnings.find((entry) => entry.message.includes(obsoleteRelativePath) && /modified/.test(entry.message));
        assert.ok(issue, health.output);
        assert.match(issue.fix, /Preserve the existing file/);
        assert.doesNotMatch(issue.fix, /update --global/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeHealth, 'global health must stay read-only');

        const beforeUpdate = snapshotTree(homeDir);
        const update = await runCliAsMain(repoDir, ['update', '--global']);
        assert.notStrictEqual(update.exitCode, 0, update.output);
        assert.match(update.output, /stale Workspine-managed file was modified by the user/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeUpdate, 'blocked update must preserve the entire selected set');
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('safe obsolete manifest-owned global file is advertised and removed by update-global', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const obsoleteRelativePath = 'skills/work-obsolete/SKILL.md';
    const obsoletePath = path.join(homeDir, '.claude', ...obsoleteRelativePath.split('/'));
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        fs.mkdirSync(path.dirname(obsoletePath), { recursive: true });
        const originalBytes = 'obsolete package-owned bytes\n';
        fs.writeFileSync(obsoletePath, originalBytes);
        const manifestPath = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        manifest.files[obsoleteRelativePath] = createHash('sha256').update(originalBytes).digest('hex');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        const health = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const report = JSON.parse(health.output);
        const issue = report.warnings.find((entry) => entry.message.includes(obsoleteRelativePath) && /obsolete/.test(entry.message));
        assert.ok(issue, health.output);
        assert.match(issue.fix, /npx -y workspine update --global/);

        const update = await runCliAsMain(repoDir, ['update', '--global']);
        assert.strictEqual(update.exitCode, 0, update.output);
        assert.ok(!fs.existsSync(obsoletePath), 'safe obsolete manifest-owned file should be removed');
        const clean = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        assert.strictEqual(clean.exitCode, 0, clean.output);
        assert.strictEqual(JSON.parse(clean.output).status, 'healthy');
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global health reports linked, colliding, and corrupt ownership read-only', async () => {
    const cases = [
      {
        name: 'linked',
        mutate: (homeDir) => {
          const target = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
          const external = path.join(homeDir, 'user-owned-skill.md');
          fs.writeFileSync(external, 'user-owned bytes\n');
          fs.unlinkSync(target);
          fs.symlinkSync(external, target, 'file');
        },
      },
      {
        name: 'linked',
        mutate: (homeDir) => {
          const manifest = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
          fs.unlinkSync(manifest);
          fs.symlinkSync(path.join(homeDir, 'missing-manifest.json'), manifest, 'file');
        },
      },
      {
        name: 'collision',
        mutate: (homeDir) => {
          const target = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
          fs.unlinkSync(target);
          fs.mkdirSync(target, { recursive: true });
        },
      },
      {
        name: 'corrupt',
        mutate: (homeDir) => {
          fs.writeFileSync(path.join(homeDir, '.claude', 'workspine-file-manifest.json'), '{not-json');
        },
      },
      {
        name: 'foreign',
        mutate: (homeDir) => {
          const manifestPath = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          manifest.product = 'OtherProduct';
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        },
      },
    ];
    for (const scenario of cases) {
      const homeDir = createTempProject();
      const repoDir = createTempProject();
      try {
        await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
          const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
          assert.strictEqual(install.exitCode, 0, install.output);
          scenario.mutate(homeDir);
          const beforeHome = snapshotTree(homeDir);
          const beforeRepo = snapshotTree(repoDir);
          const result = await runCliAsMain(repoDir, ['health', '--global', '--json']);
          assert.strictEqual(result.exitCode, 1, `${scenario.name} should be broken`);
          const parsed = JSON.parse(result.output);
          assert.strictEqual(parsed.status, 'broken');
          assert.match(`${parsed.errors.map((error) => error.message).join('\n')}\n${parsed.warnings.map((warning) => warning.message).join('\n')}`, new RegExp(scenario.name));
          for (const issue of [...parsed.errors, ...parsed.warnings]) {
            assert.doesNotMatch(issue.fix, /update --global/, `${scenario.name} must not advertise blocked global update`);
          }
          assert.deepStrictEqual(snapshotTree(homeDir), beforeHome, `${scenario.name} health must be zero-write`);
          assert.deepStrictEqual(snapshotTree(repoDir), beforeRepo, `${scenario.name} health must not touch repo`);
        });
      } finally {
        cleanup(homeDir);
        cleanup(repoDir);
      }
    }
  });

  test('global health marks an untracked expected file manual and never emits update-global', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        const manifestPath = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        delete manifest.files['skills/work-plan/SKILL.md'];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        const before = snapshotTree(homeDir);

        const result = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const report = JSON.parse(result.output);
        const issue = [...report.errors, ...report.warnings].find((entry) => /untracked/.test(entry.message));
        assert.ok(issue, result.output);
        assert.match(issue.fix, /Preserve the existing file/);
        assert.doesNotMatch(issue.fix, /update --global/);
        assert.deepStrictEqual(snapshotTree(homeDir), before);

        fs.unlinkSync(path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md'));
        const beforeMissingOwnership = snapshotTree(homeDir);
        const missingOwnership = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const missingReport = JSON.parse(missingOwnership.output);
        const missingIssue = missingReport.errors.find((entry) => /ownership-missing/.test(entry.message));
        assert.ok(missingIssue, missingOwnership.output);
        assert.match(missingIssue.fix, /Manual ownership repair required/);
        assert.doesNotMatch(missingIssue.fix, /update --global/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeMissingOwnership);
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('safe missing owned global file emits update-global, restores it, and clears health', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const target = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        fs.unlinkSync(target);

        const health = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const report = JSON.parse(health.output);
        const issue = report.errors.find((entry) => /skills\/work-plan\/SKILL\.md is missing/.test(entry.message));
        assert.ok(issue, health.output);
        assert.match(issue.fix, /npx -y workspine update --global/);

        const repaired = await runCliAsMain(repoDir, ['update', '--global']);
        assert.strictEqual(repaired.exitCode, 0, repaired.output);
        assert.ok(fs.existsSync(target));
        const clean = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        assert.strictEqual(clean.exitCode, 0, clean.output);
        assert.strictEqual(JSON.parse(clean.output).status, 'healthy');
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('package-stale owned global bytes are auto-safe and update-global converges', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const target = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    const manifestPath = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        const oldBytes = 'older package-owned work-plan bytes\n';
        fs.writeFileSync(target, oldBytes);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        manifest.files['skills/work-plan/SKILL.md'] = createHash('sha256').update(oldBytes).digest('hex');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        const health = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const report = JSON.parse(health.output);
        const issue = report.warnings.find((entry) => /package-stale/.test(entry.message));
        assert.ok(issue, health.output);
        assert.match(issue.fix, /npx -y workspine update --global/);
        const repaired = await runCliAsMain(repoDir, ['update', '--global']);
        assert.strictEqual(repaired.exitCode, 0, repaired.output);
        assert.notStrictEqual(fs.readFileSync(target, 'utf-8'), oldBytes);
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('mixed safe missing plus manual blocker suppresses update-global everywhere and stays zero-write', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const missingTarget = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    const modifiedTarget = path.join(homeDir, '.claude', 'agents', 'work-plan-checker.md');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'claude']);
        assert.strictEqual(install.exitCode, 0, install.output);
        fs.unlinkSync(missingTarget);
        fs.appendFileSync(modifiedTarget, '\nuser edit\n');
        const beforeHealth = snapshotTree(homeDir);

        const health = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        const report = JSON.parse(health.output);
        assert.ok([...report.errors, ...report.warnings].some((entry) => /missing/.test(entry.message)));
        assert.ok([...report.errors, ...report.warnings].some((entry) => /modified/.test(entry.message)));
        for (const issue of [...report.errors, ...report.warnings]) {
          assert.doesNotMatch(issue.fix, /update --global/);
        }
        assert.deepStrictEqual(snapshotTree(homeDir), beforeHealth, 'mixed global health must be read-only');

        const beforeUpdate = snapshotTree(homeDir);
        const blocked = await runCliAsMain(repoDir, ['update', '--global']);
        assert.notStrictEqual(blocked.exitCode, 0, blocked.output);
        assert.match(blocked.output, /Manual resolution is required before retrying/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeUpdate, 'blocked selected set must write nothing');
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('partial lost split-root ownership is reported manually instead of omitted as healthy', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'opencode']);
        assert.strictEqual(install.exitCode, 0, install.output);
        fs.unlinkSync(path.join(homeDir, '.agents', 'workspine-file-manifest.json'));
        const before = snapshotTree(homeDir);
        const result = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        assert.strictEqual(result.exitCode, 1, result.output);
        const report = JSON.parse(result.output);
        const issue = report.errors.find((entry) => /manifest-missing/.test(entry.message));
        assert.ok(issue, result.output);
        assert.match(issue.fix, /Manual ownership repair required/);
        assert.doesNotMatch(issue.fix, /update --global/);
        assert.deepStrictEqual(snapshotTree(homeDir), before);
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global health without an owned manifest fails read-only with guidance', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const beforeHome = snapshotTree(homeDir);
        const result = await runCliAsMain(repoDir, ['health', '--global', '--json']);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.output);
        assert.strictEqual(parsed.status, 'broken');
        assert.match(parsed.errors[0].fix, /install --global/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeHome);
      });
    } finally {
      cleanup(homeDir);
      cleanup(repoDir);
    }
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
    fs.rmSync(path.join(tmpDir, '.work', 'templates'), { recursive: true, force: true });
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
