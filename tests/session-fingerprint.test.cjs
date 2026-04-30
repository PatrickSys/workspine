/**
 * Session Fingerprint Tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { runCliAsMain } = require('./gsdd.helpers.cjs');

function createTmpPlanning() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-fp-test-'));
  const planningDir = path.join(tmpDir, '.planning');
  fs.mkdirSync(planningDir, { recursive: true });
  return { tmpDir, planningDir };
}

function cleanupTmp(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function importModule() {
  return import(
    `${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'session-fingerprint.mjs')).href}?t=${Date.now()}-${Math.random()}`
  );
}

function computeLegacyHash(planningDir) {
  const hash = createHash('sha256');
  for (const file of ['ROADMAP.md', 'SPEC.md', 'config.json']) {
    const filePath = path.join(planningDir, file);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    hash.update(`${file}:${content}\n`);
  }
  return hash.digest('hex');
}

describe('session-fingerprint', () => {
  let tmpDir, planningDir;

  beforeEach(() => {
    ({ tmpDir, planningDir } = createTmpPlanning());
  });

  afterEach(() => {
    cleanupTmp(tmpDir);
  });

  test('computeFingerprint returns a SHA-256 hex hash', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{"researchDepth":"standard"}');
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec');
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');

    const result = mod.computeFingerprint(planningDir);
    assert.ok(result.hash, 'hash should exist');
    assert.strictEqual(result.hash.length, 64, 'SHA-256 hex is 64 chars');
    assert.strictEqual(result.sources['config.json'], true);
    assert.strictEqual(result.sources['SPEC.md'], true);
    assert.strictEqual(result.sources['ROADMAP.md'], true);
  });

  test('computeFingerprint changes when a file changes', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v1');
    const hash1 = mod.computeFingerprint(planningDir).hash;
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v2');
    const hash2 = mod.computeFingerprint(planningDir).hash;
    assert.notStrictEqual(hash1, hash2, 'hash should change when SPEC.md changes');
  });

  test('writeFingerprint and readStoredFingerprint roundtrip', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec');
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');

    const written = mod.writeFingerprint(planningDir);
    assert.ok(written.hash, 'writeFingerprint should return a hash');
    assert.strictEqual(written.schemaVersion, 2);
    assert.strictEqual(written.algorithm, 'sha256:v2:exists-content');
    assert.ok(written.timestamp, 'writeFingerprint should return a timestamp');

    const stored = mod.readStoredFingerprint(planningDir);
    assert.strictEqual(stored.hash, written.hash, 'stored hash should match written');
    assert.strictEqual(stored.schemaVersion, 2);
    assert.strictEqual(stored.algorithm, 'sha256:v2:exists-content');
    assert.strictEqual(stored.timestamp, written.timestamp, 'stored timestamp should match written');
  });

  test('writeFingerprint does not create root .gitignore', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec');

    mod.writeFingerprint(planningDir);

    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.gitignore')), false);
  });

  test('writeFingerprint does not mutate existing root .gitignore', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '/.planning/\n');

    mod.writeFingerprint(planningDir);

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    assert.strictEqual(gitignore, '/.planning/\n');
  });

  test('checkDrift accepts unchanged legacy fingerprints without false drift', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec');
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(planningDir, '.state-fingerprint.json'), JSON.stringify({
      hash: computeLegacyHash(planningDir),
      sources: { 'ROADMAP.md': true, 'SPEC.md': true, 'config.json': true },
      timestamp: '2026-04-27T00:00:00.000Z',
    }, null, 2));

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, false);
    assert.strictEqual(result.classification, 'clean');
    assert.strictEqual(result.compatibility, 'legacy_v1');
    assert.strictEqual(result.needsBaselineRefresh, true);
  });

  test('checkDrift keeps legacy fingerprints conservative when content changed', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v1');
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(planningDir, '.state-fingerprint.json'), JSON.stringify({
      hash: computeLegacyHash(planningDir),
      sources: { 'ROADMAP.md': true, 'SPEC.md': true, 'config.json': true },
      timestamp: '2026-04-27T00:00:00.000Z',
    }, null, 2));
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v2');

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, true);
    assert.strictEqual(result.classification, 'planning_state_drift');
    assert.strictEqual(result.compatibility, 'legacy_v1');
    assert.strictEqual(result.files.find((file) => file.file === 'SPEC.md').status, 'unknown');
    assert.ok(result.details.some((detail) => detail === 'SPEC.md may have changed'));
  });

  test('checkDrift returns noBaseline when no fingerprint file exists', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec');

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, false);
    assert.strictEqual(result.noBaseline, true);
    assert.strictEqual(result.classification, 'no_baseline');
  });

  test('checkDrift detects no drift when state is unchanged', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec');
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    mod.writeFingerprint(planningDir);

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, false);
    assert.strictEqual(result.noBaseline, false);
  });

  test('checkDrift detects drift when a planning file changes', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v1');
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    mod.writeFingerprint(planningDir);

    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v2');

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, true);
    assert.strictEqual(result.noBaseline, false);
    assert.strictEqual(result.classification, 'planning_state_drift');
    assert.ok(result.details.length > 0, 'should have drift details');
    assert.ok(result.details.some((d) => d === 'SPEC.md changed'), 'details should mention SPEC.md changed');
    assert.strictEqual(result.files.find((file) => file.file === 'SPEC.md').status, 'changed');
    assert.strictEqual(result.files.find((file) => file.file === 'ROADMAP.md').status, 'unchanged');
    assert.strictEqual(result.files.find((file) => file.file === 'config.json').status, 'unchanged');
  });

  test('checkDrift detects drift when a file is created', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    mod.writeFingerprint(planningDir);

    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap');

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, true);
    assert.ok(result.details.some((d) => d.includes('ROADMAP.md') && d.includes('created')));
    assert.strictEqual(result.classification, 'planning_state_drift');
    assert.strictEqual(result.files.find((file) => file.file === 'ROADMAP.md').status, 'created');
  });

  test('checkDrift detects drift when an empty planning file is created', async () => {
    const mod = await importModule();
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    mod.writeFingerprint(planningDir);

    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '');

    const result = mod.checkDrift(planningDir);
    assert.strictEqual(result.drifted, true);
    assert.strictEqual(result.files.find((file) => file.file === 'ROADMAP.md').status, 'created');
  });

  test('session-fingerprint write command creates a fresh baseline', async () => {
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v1');
    let result = await runCliAsMain(tmpDir, ['session-fingerprint', 'write']);
    assert.strictEqual(result.exitCode, 0, result.output);

    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v2');
    const mod = await importModule();
    assert.strictEqual(mod.checkDrift(planningDir).drifted, true);

    result = await runCliAsMain(tmpDir, ['session-fingerprint', 'write']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(mod.checkDrift(planningDir).drifted, false);
  });

  test('session-fingerprint write can restrict expected changed planning files', async () => {
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap v1');
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v1');
    fs.writeFileSync(path.join(planningDir, 'config.json'), '{}');
    const mod = await importModule();
    mod.writeFingerprint(planningDir);

    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap v2');
    let result = await runCliAsMain(tmpDir, ['session-fingerprint', 'write', '--allow-changed', 'ROADMAP.md']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(mod.checkDrift(planningDir).drifted, false);

    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), '# Roadmap v3');
    fs.writeFileSync(path.join(planningDir, 'SPEC.md'), '# Spec v2');
    result = await runCliAsMain(tmpDir, ['session-fingerprint', 'write', '--allow-changed', 'ROADMAP.md']);
    assert.strictEqual(result.exitCode, 1, result.output);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.reason, 'unexpected_planning_drift');
    assert.deepStrictEqual(output.unexpected, ['SPEC.md']);
  });
});
