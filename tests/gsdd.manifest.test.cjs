/**
 * GSDD CLI Tests - Generation Manifest / Template Refresh
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliAsMain,
  setNonInteractiveStdin,
  withEnv,
} = require('./gsdd.helpers.cjs');

describe('generation manifest', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  async function initProject() {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }
  }

  test('init writes generation-manifest.json with correct shape', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'generation-manifest.json must exist after init');

    const manifest = readJson(manifestPath);
    assert.ok(manifest.frameworkVersion, 'manifest must have frameworkVersion');
    assert.ok(manifest.generatedAt, 'manifest must have generatedAt');
    assert.ok(manifest.templates, 'manifest must have templates');
    assert.ok(manifest.templates.delegates, 'manifest must have templates.delegates');
    assert.ok(manifest.templates.research, 'manifest must have templates.research');
    assert.ok(manifest.templates.codebase, 'manifest must have templates.codebase');
    assert.ok(manifest.templates.root, 'manifest must have templates.root');
    assert.ok(manifest.roles, 'manifest must have roles');
    assert.ok(manifest.runtimeHelpers, 'manifest must have runtimeHelpers');
    assert.ok(Object.keys(manifest.templates.delegates).length >= 10);
    assert.ok(Object.keys(manifest.roles).length >= 9);
    assert.ok(Object.keys(manifest.runtimeHelpers).includes('bin/gsdd.mjs'));
    assert.match(Object.values(manifest.templates.delegates)[0], /^[a-f0-9]{64}$/);
  });

  test('init produces non-empty research, codebase, and root manifest groups', async () => {
    await initProject();
    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    assert.ok(Object.keys(manifest.templates.research).length > 0,
      'templates.research must have at least one file hash after init (empty group = scaffold failure)');
    assert.ok(Object.keys(manifest.templates.codebase).length > 0,
      'templates.codebase must have at least one file hash after init (empty group = scaffold failure)');
    assert.ok(Object.keys(manifest.templates.root).length > 0,
      'templates.root must have at least one file hash after init (spec.md, roadmap.md, auth-matrix.md must be present)');
  });

  test('init creates research and codebase template subdirs with .md files', async () => {
    await initProject();
    const researchDir = path.join(tmpDir, '.planning', 'templates', 'research');
    const codebaseDir = path.join(tmpDir, '.planning', 'templates', 'codebase');
    assert.ok(fs.existsSync(researchDir), '.planning/templates/research/ must exist after init');
    assert.ok(fs.existsSync(codebaseDir), '.planning/templates/codebase/ must exist after init');
    const researchFiles = fs.readdirSync(researchDir).filter(f => f.endsWith('.md'));
    const codebaseFiles = fs.readdirSync(codebaseDir).filter(f => f.endsWith('.md'));
    assert.ok(researchFiles.length > 0, '.planning/templates/research/ must have .md files after init');
    assert.ok(codebaseFiles.length > 0, '.planning/templates/codebase/ must have .md files after init');
  });

  test('init copies critical root template files (spec.md, roadmap.md, auth-matrix.md)', async () => {
    await initProject();
    const templatesDir = path.join(tmpDir, '.planning', 'templates');
    for (const file of ['spec.md', 'roadmap.md', 'auth-matrix.md']) {
      assert.ok(fs.existsSync(path.join(templatesDir, file)),
        `.planning/templates/${file} must exist after init (SC7 template family)`);
    }
  });

  test('update --templates refreshes corrupted delegate', async () => {
    await initProject();

    const delegatePath = path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'stale content');

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /refreshed delegates\/mapper-tech\.md/);

    const restored = fs.readFileSync(delegatePath, 'utf-8');
    assert.ok(restored.includes('role'));
    assert.notStrictEqual(restored, 'stale content');
  });

  test('update --templates warns about user-modified files', async () => {
    await initProject();

    const delegatePath = path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'user-modified content');

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.match(result.output, /WARN.*mapper-tech\.md/);
  });

  test('update --dry does not write files', async () => {
    await initProject();

    const delegatePath = path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'stale content');

    const result = await runCliAsMain(tmpDir, ['update', '--templates', '--dry']);
    assert.match(result.output, /would refresh delegates\/mapper-tech\.md/);
    assert.match(result.output, /Dry run/);
    assert.strictEqual(fs.readFileSync(delegatePath, 'utf-8'), 'stale content');
  });

  test('update --templates refreshes role contracts', async () => {
    await initProject();

    const rolePath = path.join(tmpDir, '.planning', 'templates', 'roles', 'mapper.md');
    fs.writeFileSync(rolePath, 'stale role');

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.match(result.output, /refreshed roles\/mapper\.md/);

    const restored = fs.readFileSync(rolePath, 'utf-8');
    assert.ok(restored.includes('Responsibility') || restored.includes('<role>'));
  });

  test('update --templates skips unchanged files', async () => {
    await initProject();

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.ok(!result.output.includes('refreshed delegates/'));
    assert.ok(!result.output.includes('refreshed roles/'));
  });

  test('update without --templates does not touch templates', async () => {
    await initProject();

    const delegatePath = path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'stale content');

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.ok(!result.output.includes('refreshed delegates/'));
    assert.strictEqual(fs.readFileSync(delegatePath, 'utf-8'), 'stale content');
  });

  test('update without --templates does not rewrite manifest', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    const beforeContent = fs.readFileSync(manifestPath, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md'), 'user-modified content');

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0);

    const afterContent = fs.readFileSync(manifestPath, 'utf-8');
    assert.strictEqual(afterContent, beforeContent);
  });

  test('update repairs open-standard skills when only the .planning/bin helper remains', async () => {
    await initProject();

    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const launcherPath = path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs');
    fs.rmSync(skillsDir, { recursive: true, force: true });

    assert.ok(fs.existsSync(launcherPath), 'launcher must remain present for the partial-runtime repair case');
    assert.ok(!fs.existsSync(path.join(skillsDir, 'gsdd-plan', 'SKILL.md')));

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /updated open-standard skills/);
    assert.ok(fs.existsSync(path.join(skillsDir, 'gsdd-plan', 'SKILL.md')));
    assert.ok(fs.existsSync(launcherPath));
  });

  test('update repairs .planning/bin helper when planning exists and helpers are missing', async () => {
    await initProject();

    const helperDir = path.join(tmpDir, '.planning', 'bin');
    const launcherPath = path.join(helperDir, 'gsdd.mjs');
    fs.rmSync(helperDir, { recursive: true, force: true });

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /updated local workflow helpers/);
    assert.ok(fs.existsSync(launcherPath));
  });

  test('update repairs generated surfaces from a nested cwd by discovering the workspace root', async () => {
    await initProject();

    const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.rmSync(path.join(tmpDir, '.planning', 'bin'), { recursive: true, force: true });
    fs.rmSync(path.join(tmpDir, '.agents', 'skills'), { recursive: true, force: true });

    const result = await runCliAsMain(nestedDir, ['update']);
    assert.strictEqual(result.exitCode, 0, result.output);

    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(nestedDir, '.planning')), 'update must not initialize nested cwd as a separate workspace');
  });

  test('nested update prefers discovered cwd workspace over stale GSDD_WORKSPACE_ROOT env', async () => {
    await initProject();
    const otherDir = createTempProject();
    try {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(otherDir);
        await gsdd.cmdInit();
      } finally {
        restoreStdin();
      }

      const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.rmSync(path.join(tmpDir, '.planning', 'bin'), { recursive: true, force: true });
      fs.rmSync(path.join(tmpDir, '.agents', 'skills'), { recursive: true, force: true });

      const result = await withEnv({ GSDD_WORKSPACE_ROOT: otherDir }, () => runCliAsMain(nestedDir, ['update']));
      assert.strictEqual(result.exitCode, 0, result.output);

      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs')),
        'update must repair the cwd-discovered workspace, not the stale env workspace');
      assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md')),
        'update must repair skills in the cwd-discovered workspace');
    } finally {
      cleanup(otherDir);
    }
  });

  test('nested update --dry reports missing generated surfaces without repairing or writing', async () => {
    await initProject();

    const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
    const helperDir = path.join(tmpDir, '.planning', 'bin');
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const manifestPath = path.join(tmpDir, '.planning', 'generation-manifest.json');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.rmSync(helperDir, { recursive: true, force: true });
    fs.rmSync(skillsDir, { recursive: true, force: true });
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8');

    const result = await runCliAsMain(nestedDir, ['update', '--dry']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /would update open-standard skills/);
    assert.match(result.output, /would update local workflow helpers/);
    assert.match(result.output, /Dry run/);

    assert.ok(!fs.existsSync(path.join(helperDir, 'gsdd.mjs')), 'dry update must not repair .planning/bin');
    assert.ok(!fs.existsSync(path.join(skillsDir, 'gsdd-plan', 'SKILL.md')), 'dry update must not repair .agents/skills');
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf-8'), manifestBefore, 'dry update must not rewrite the manifest');
    assert.ok(!fs.existsSync(path.join(nestedDir, '.planning')), 'dry update must not initialize nested cwd as a separate workspace');
  });

  test('dry-run --templates creates no directories in fresh project', async () => {
    const planningDir = path.join(tmpDir, '.planning');
    assert.ok(!fs.existsSync(planningDir));

    const result = await runCliAsMain(tmpDir, ['update', '--templates', '--dry']);
    assert.match(result.output, /Dry run/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'delegates')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles')));
  });

  test('update --templates removes orphaned root templates', async () => {
    await initProject();

    const orphanPath = path.join(tmpDir, '.planning', 'templates', 'obsolete-template.md');
    fs.writeFileSync(orphanPath, '# Obsolete');

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /removed orphan templates\/obsolete-template\.md/);
    assert.ok(!fs.existsSync(orphanPath));
  });
});
