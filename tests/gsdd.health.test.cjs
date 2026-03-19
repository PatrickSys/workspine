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
  test('ROADMAP with phase 1 but no phase files → W4', async () => {
    await initWorkspace();
    const roadmapContent = `# Roadmap\n\n- [ ] **Phase 1: Foundation**\n- [ ] **Phase 2: API**\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent);
    const result = await runCliAsMain(tmpDir, ['health', '--json']);
    const json = JSON.parse(result.output);
    assert.ok(json.warnings.some((w) => w.id === 'W4'), 'should warn about missing phase dirs');
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
