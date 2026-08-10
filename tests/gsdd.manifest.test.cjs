/**
 * GSDD CLI Tests - Generation Manifest / Template Refresh
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createHash } = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
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

  function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  function writeRawManifest(manifestPath, manifest) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  async function loadAtomicWrite() {
    return import(pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'atomic-write.mjs')).href);
  }

  async function loadGenerationManifest() {
    return import(pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'manifest.mjs')).href);
  }

  test('init writes generation-manifest.json with correct shape', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'generation-manifest.json must exist after init');

    const manifest = readJson(manifestPath);
    assert.ok(manifest.frameworkVersion, 'manifest must have frameworkVersion');
    assert.ok(manifest.generatedAt, 'manifest must have generatedAt');
    assert.ok(manifest.templates, 'manifest must have templates');
    assert.ok(manifest.templates.delegates, 'manifest must have templates.delegates');
    assert.ok(manifest.templates.research, 'manifest must have templates.research');
    assert.ok(manifest.templates.codebase, 'manifest must have templates.codebase');
    assert.ok(manifest.templates.brownfieldChange, 'manifest must have templates.brownfieldChange');
    assert.ok(manifest.templates.root, 'manifest must have templates.root');
    assert.ok(manifest.roles, 'manifest must have roles');
    assert.ok(manifest.runtimeHelpers, 'manifest must have runtimeHelpers');
    assert.ok(Object.keys(manifest.templates.delegates).length >= 10);
    assert.ok(Object.keys(manifest.roles).length >= 9);
    assert.ok(Object.keys(manifest.runtimeHelpers).includes('bin/gsdd.mjs'));
    assert.match(Object.values(manifest.templates.delegates)[0], /^[a-f0-9]{64}$/);
    assert.match(manifest.runtimeHelpers['bin/gsdd.mjs'], /^[a-f0-9]{64}$/);
    assert.match(manifest.runtimeHelpers['bin/gsdd'], /^[a-f0-9]{64}$/);
    assert.match(manifest.runtimeHelpers['bin/gsdd.cmd'], /^[a-f0-9]{64}$/);
  });

  test('writeManifest replaces an existing manifest with its exact JSON serialization', async () => {
    const planningDir = path.join(tmpDir, '.work');
    const manifestPath = path.join(planningDir, 'generation-manifest.json');
    const nextManifest = { frameworkVersion: '0.32.0', runtimeHelpers: { 'bin/gsdd.mjs': 'next' } };
    fs.mkdirSync(planningDir);
    fs.writeFileSync(manifestPath, '{"old":true}');

    const { writeManifest: writeGenerationManifest } = await loadGenerationManifest();
    writeGenerationManifest(planningDir, nextManifest);

    assert.deepStrictEqual(readJson(manifestPath), nextManifest);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf-8'), JSON.stringify(nextManifest, null, 2));
    assert.deepStrictEqual(
      fs.readdirSync(planningDir).filter((name) => name.startsWith('.generation-manifest.json.')),
      [],
    );
  });

  test('atomic writer preserves the destination and removes its temp after a pre-rename failure', async () => {
    const destinationPath = path.join(tmpDir, 'generation-manifest.json');
    const tempPath = path.join(tmpDir, '.generation-manifest.json.failure.tmp');
    const previousBytes = Buffer.from('{"old":true}');
    const calls = [];
    fs.writeFileSync(destinationPath, previousBytes);
    const { createAtomicFileWriter } = await loadAtomicWrite();
    const writer = createAtomicFileWriter({
      createTempPath: () => tempPath,
      operations: {
        openSync: (...args) => {
          calls.push('open');
          return fs.openSync(...args);
        },
        writeFileSync: (...args) => {
          calls.push('write');
          return fs.writeFileSync(...args);
        },
        fsyncSync: (...args) => {
          calls.push('sync');
          return fs.fsyncSync(...args);
        },
        closeSync: (...args) => {
          calls.push('close');
          return fs.closeSync(...args);
        },
        renameSync: () => {
          calls.push('rename');
          const error = new Error('injected rename failure');
          error.code = 'EIO';
          throw error;
        },
        unlinkSync: (...args) => {
          calls.push('unlink');
          return fs.unlinkSync(...args);
        },
      },
    });

    assert.throws(() => writer(destinationPath, '{"new":true}'), /injected rename failure/);
    assert.deepStrictEqual(calls, ['open', 'write', 'sync', 'close', 'rename', 'unlink']);
    assert.deepStrictEqual(fs.readFileSync(destinationPath), previousBytes);
    assert.ok(!fs.existsSync(tempPath));
  });

  test('atomic writer leaves an exclusive-create collision untouched', async () => {
    const destinationPath = path.join(tmpDir, 'generation-manifest.json');
    const tempPath = path.join(tmpDir, '.generation-manifest.json.collision.tmp');
    const previousBytes = Buffer.from('{"old":true}');
    const collisionBytes = Buffer.from('do not overwrite or remove');
    fs.writeFileSync(destinationPath, previousBytes);
    fs.writeFileSync(tempPath, collisionBytes);
    const { createAtomicFileWriter } = await loadAtomicWrite();
    const writer = createAtomicFileWriter({ createTempPath: () => tempPath });

    assert.throws(() => writer(destinationPath, '{"new":true}'), (error) => error.code === 'EEXIST');
    assert.deepStrictEqual(fs.readFileSync(destinationPath), previousBytes);
    assert.deepStrictEqual(fs.readFileSync(tempPath), collisionBytes);
  });

  test('init installs and hashes the atomic-write helper required by generated work-context', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    const helperPath = path.join(tmpDir, '.work', 'bin', 'lib', 'atomic-write.mjs');
    const workContextPath = path.join(tmpDir, '.work', 'bin', 'lib', 'work-context.mjs');

    assert.ok(fs.existsSync(helperPath));
    assert.strictEqual(manifest.runtimeHelpers['bin/lib/atomic-write.mjs'], sha256(fs.readFileSync(helperPath)));
    await import(pathToFileURL(workContextPath).href);
  });

  test('init and update preserve the decision CLI helper source bytes and manifest hash', async () => {
    await initProject();

    const sourcePath = path.join(__dirname, '..', 'bin', 'lib', 'decision-cli.mjs');
    const helperPath = path.join(tmpDir, '.work', 'bin', 'lib', 'decision-cli.mjs');
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const sourceBytes = fs.readFileSync(sourcePath);
    const sourceHash = sha256(sourceBytes);

    assert.deepStrictEqual(fs.readFileSync(helperPath), sourceBytes);
    assert.strictEqual(readJson(manifestPath).runtimeHelpers['bin/lib/decision-cli.mjs'], sourceHash);
    await import(pathToFileURL(helperPath).href);

    fs.rmSync(helperPath);
    const update = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(update.exitCode, 0, update.output);
    assert.deepStrictEqual(fs.readFileSync(helperPath), sourceBytes);
    assert.strictEqual(readJson(manifestPath).runtimeHelpers['bin/lib/decision-cli.mjs'], sourceHash);
  });

  test('init produces non-empty research, codebase, and root manifest groups', async () => {
    await initProject();
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    assert.ok(Object.keys(manifest.templates.research).length > 0,
      'templates.research must have at least one file hash after init (empty group = scaffold failure)');
    assert.ok(Object.keys(manifest.templates.codebase).length > 0,
      'templates.codebase must have at least one file hash after init (empty group = scaffold failure)');
    assert.ok(Object.keys(manifest.templates.brownfieldChange).length > 0,
      'templates.brownfieldChange must have at least one file hash after init (empty group = scaffold failure)');
    assert.ok(Object.keys(manifest.templates.root).length > 0,
      'templates.root must have at least one file hash after init (spec.md, roadmap.md, auth-matrix.md must be present)');
  });

  test('init creates research and codebase template subdirs with .md files', async () => {
    await initProject();
    const researchDir = path.join(tmpDir, '.work', 'templates', 'research');
    const codebaseDir = path.join(tmpDir, '.work', 'templates', 'codebase');
    assert.ok(fs.existsSync(researchDir), '.work/templates/research/ must exist after init');
    assert.ok(fs.existsSync(codebaseDir), '.work/templates/codebase/ must exist after init');
    const researchFiles = fs.readdirSync(researchDir).filter(f => f.endsWith('.md'));
    const codebaseFiles = fs.readdirSync(codebaseDir).filter(f => f.endsWith('.md'));
    assert.ok(researchFiles.length > 0, '.work/templates/research/ must have .md files after init');
    assert.ok(codebaseFiles.length > 0, '.work/templates/codebase/ must have .md files after init');
  });

  test('init copies critical root template files (spec.md, roadmap.md, auth-matrix.md)', async () => {
    await initProject();
    const templatesDir = path.join(tmpDir, '.work', 'templates');
    for (const file of ['spec.md', 'roadmap.md', 'auth-matrix.md']) {
      assert.ok(fs.existsSync(path.join(templatesDir, file)),
        `.work/templates/${file} must exist after init (SC7 template family)`);
    }
  });

  test('update --templates refreshes corrupted delegate', async () => {
    await initProject();

    const delegatePath = path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md');
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

    const delegatePath = path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'user-modified content');

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.match(result.output, /WARN.*mapper-tech\.md/);
  });

  test('update --dry does not write files', async () => {
    await initProject();

    const delegatePath = path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'stale content');

    const result = await runCliAsMain(tmpDir, ['update', '--templates', '--dry']);
    assert.match(result.output, /would refresh delegates\/mapper-tech\.md/);
    assert.match(result.output, /Dry run/);
    assert.strictEqual(fs.readFileSync(delegatePath, 'utf-8'), 'stale content');
  });

  test('update --templates refreshes role contracts', async () => {
    await initProject();

    const rolePath = path.join(tmpDir, '.work', 'templates', 'roles', 'mapper.md');
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

    const delegatePath = path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md');
    fs.writeFileSync(delegatePath, 'stale content');

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.ok(!result.output.includes('refreshed delegates/'));
    assert.strictEqual(fs.readFileSync(delegatePath, 'utf-8'), 'stale content');
  });

  test('update without --templates does not rewrite manifest', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const beforeContent = fs.readFileSync(manifestPath, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md'), 'user-modified content');

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0);

    const afterContent = fs.readFileSync(manifestPath, 'utf-8');
    assert.strictEqual(afterContent, beforeContent);
  });

  test('update does not generate GSDD skills for unrelated .agents/skills directories', async () => {
    const unrelatedSkillDir = path.join(tmpDir, '.agents', 'skills', 'custom-agent');
    fs.mkdirSync(unrelatedSkillDir, { recursive: true });
    fs.writeFileSync(path.join(unrelatedSkillDir, 'SKILL.md'), '# Custom Agent\n');

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /no adapters found to update/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan')),
      'unrelated .agents/skills must not trigger GSDD skill generation');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')),
      'update must not bootstrap planning state for an unrelated .agents/skills directory');
  });

  test('update repairs open-standard skills when only the .work/bin helper remains', async () => {
    await initProject();

    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const launcherPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    fs.rmSync(skillsDir, { recursive: true, force: true });

    assert.ok(fs.existsSync(launcherPath), 'launcher must remain present for the partial-runtime repair case');
    assert.ok(!fs.existsSync(path.join(skillsDir, 'gsdd-plan', 'SKILL.md')));

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /updated open-standard skills/);
    assert.ok(fs.existsSync(path.join(skillsDir, 'gsdd-plan', 'SKILL.md')));
    assert.ok(fs.existsSync(launcherPath));
  });

  test('update repairs .work/bin helper when planning exists and helpers are missing', async () => {
    await initProject();

    const helperDir = path.join(tmpDir, '.work', 'bin');
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
    fs.rmSync(path.join(tmpDir, '.work', 'bin'), { recursive: true, force: true });
    fs.rmSync(path.join(tmpDir, '.agents', 'skills'), { recursive: true, force: true });

    const result = await runCliAsMain(nestedDir, ['update']);
    assert.strictEqual(result.exitCode, 0, result.output);

    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs')));
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
      fs.rmSync(path.join(tmpDir, '.work', 'bin'), { recursive: true, force: true });
      fs.rmSync(path.join(tmpDir, '.agents', 'skills'), { recursive: true, force: true });

      const result = await withEnv({ GSDD_WORKSPACE_ROOT: otherDir }, () => runCliAsMain(nestedDir, ['update']));
      assert.strictEqual(result.exitCode, 0, result.output);

      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs')),
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
    const helperDir = path.join(tmpDir, '.work', 'bin');
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.rmSync(helperDir, { recursive: true, force: true });
    fs.rmSync(skillsDir, { recursive: true, force: true });
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8');

    const result = await runCliAsMain(nestedDir, ['update', '--dry']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /would update open-standard skills/);
    assert.match(result.output, /would update local workflow helpers/);
    assert.match(result.output, /Dry run/);

    assert.ok(!fs.existsSync(path.join(helperDir, 'gsdd.mjs')), 'dry update must not repair .work/bin');
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

    const orphanPath = path.join(tmpDir, '.work', 'templates', 'obsolete-template.md');
    fs.writeFileSync(orphanPath, '# Obsolete');

    const result = await runCliAsMain(tmpDir, ['update', '--templates']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /removed orphan templates\/obsolete-template\.md/);
    assert.ok(!fs.existsSync(orphanPath));
  });

  test('update removes only hash-proven obsolete runtime helpers and unmanages preserved targets', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    const currentRuntimePaths = Object.keys(manifest.runtimeHelpers).sort();
    const helpersDir = path.join(tmpDir, '.work', 'bin', 'lib');
    const removablePath = path.join(helpersDir, 'obsolete-owned.mjs');
    const modifiedPath = path.join(helpersDir, 'obsolete-modified.mjs');
    const directoryPath = path.join(helpersDir, 'obsolete-directory');
    const outsidePath = path.join(tmpDir, 'obsolete-outside.mjs');
    const ownedContent = '// old generated helper\n';
    const modifiedContent = '// local customization\n';

    fs.writeFileSync(removablePath, ownedContent);
    fs.writeFileSync(modifiedPath, modifiedContent);
    fs.mkdirSync(directoryPath);
    fs.writeFileSync(outsidePath, ownedContent);
    manifest.runtimeHelpers['bin/lib/obsolete-owned.mjs'] = sha256(ownedContent);
    manifest.runtimeHelpers['bin/lib/obsolete-modified.mjs'] = sha256(ownedContent);
    manifest.runtimeHelpers['bin/lib/obsolete-directory'] = sha256('not a directory hash');
    manifest.runtimeHelpers['bin/../../obsolete-outside.mjs'] = sha256(ownedContent);
    writeRawManifest(manifestPath, manifest);

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /removed obsolete runtime helper bin\/lib\/obsolete-owned\.mjs/);
    assert.match(result.output, /obsolete-modified\.mjs was modified locally; preserving it/);
    assert.match(result.output, /obsolete-directory is not a regular file; preserving it/);
    assert.match(result.output, /bin\/\.\.\/\.\.\/obsolete-outside\.mjs resolves outside the managed runtime root; preserving it/);
    assert.doesNotMatch(result.output, new RegExp(tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(!fs.existsSync(removablePath));
    assert.strictEqual(fs.readFileSync(modifiedPath, 'utf-8'), modifiedContent);
    assert.ok(fs.lstatSync(directoryPath).isDirectory());
    assert.strictEqual(fs.readFileSync(outsidePath, 'utf-8'), ownedContent);
    assert.deepStrictEqual(Object.keys(readJson(manifestPath).runtimeHelpers).sort(), currentRuntimePaths);
  });

  test('repeated init removes an unchanged obsolete runtime helper after replacing manifest ownership', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    const currentRuntimePaths = Object.keys(manifest.runtimeHelpers).sort();
    const obsoletePath = path.join(tmpDir, '.work', 'bin', 'lib', 'obsolete-reinit.mjs');
    const content = '// obsolete init helper\n';
    fs.writeFileSync(obsoletePath, content);
    manifest.runtimeHelpers['bin/lib/obsolete-reinit.mjs'] = sha256(content);
    writeRawManifest(manifestPath, manifest);

    await initProject();

    assert.ok(!fs.existsSync(obsoletePath));
    assert.deepStrictEqual(Object.keys(readJson(manifestPath).runtimeHelpers).sort(), currentRuntimePaths);
  });

  test('update --dry leaves obsolete runtime helper bytes and raw manifest unchanged', async () => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    const obsoletePath = path.join(tmpDir, '.work', 'bin', 'lib', 'obsolete-dry-run.mjs');
    const content = '// obsolete dry-run helper\n';
    fs.writeFileSync(obsoletePath, content);
    manifest.runtimeHelpers['bin/lib/obsolete-dry-run.mjs'] = sha256(content);
    writeRawManifest(manifestPath, manifest);
    const manifestBefore = fs.readFileSync(manifestPath);

    const result = await runCliAsMain(tmpDir, ['update', '--dry']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.deepStrictEqual(fs.readFileSync(manifestPath), manifestBefore);
    assert.strictEqual(fs.readFileSync(obsoletePath, 'utf-8'), content);
    assert.doesNotMatch(result.output, /removed obsolete runtime helper/);
  });

  test('update preserves obsolete runtime symlinks and realpath escapes', async (t) => {
    await initProject();

    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifest = readJson(manifestPath);
    const currentRuntimePaths = Object.keys(manifest.runtimeHelpers).sort();
    const outsideFile = path.join(tmpDir, 'outside-link-target.mjs');
    const outsideDir = path.join(tmpDir, 'outside-link-directory');
    const parentTarget = path.join(outsideDir, 'obsolete-parent.mjs');
    const directLink = path.join(tmpDir, '.work', 'bin', 'lib', 'obsolete-link.mjs');
    const danglingLink = path.join(tmpDir, '.work', 'bin', 'lib', 'obsolete-dangling.mjs');
    const parentLink = path.join(tmpDir, '.work', 'bin', 'obsolete-link-dir');
    const content = '// external user file\n';
    fs.writeFileSync(outsideFile, content);
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(parentTarget, content);
    try {
      fs.symlinkSync(outsideFile, directLink, 'file');
      fs.symlinkSync(path.join(tmpDir, 'missing-link-target.mjs'), danglingLink, 'file');
      fs.symlinkSync(outsideDir, parentLink, 'junction');
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) {
        t.skip(`symlink creation unavailable in this environment: ${error.code}`);
        return;
      }
      throw error;
    }
    manifest.runtimeHelpers['bin/lib/obsolete-link.mjs'] = sha256(content);
    manifest.runtimeHelpers['bin/lib/obsolete-dangling.mjs'] = sha256(content);
    manifest.runtimeHelpers['bin/obsolete-link-dir/obsolete-parent.mjs'] = sha256(content);
    writeRawManifest(manifestPath, manifest);

    const result = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /obsolete-link\.mjs is not a regular file; preserving it/);
    assert.match(result.output, /obsolete-dangling\.mjs is not a regular file; preserving it/);
    assert.match(result.output, /obsolete-link-dir\/obsolete-parent\.mjs resolves outside the managed runtime root; preserving it/);
    assert.doesNotMatch(result.output, new RegExp(tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(fs.lstatSync(directLink).isSymbolicLink());
    assert.ok(fs.lstatSync(danglingLink).isSymbolicLink());
    assert.ok(fs.lstatSync(parentLink).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(outsideFile, 'utf-8'), content);
    assert.strictEqual(fs.readFileSync(parentTarget, 'utf-8'), content);
    assert.deepStrictEqual(Object.keys(readJson(manifestPath).runtimeHelpers).sort(), currentRuntimePaths);
  });

  for (const command of ['init', 'update']) {
    test(`${command} preflights every current helper before refusing a later target symlink`, async (t) => {
      await initProject();

      const runtimeRoot = path.join(tmpDir, '.work', 'bin');
      const earlierHelper = path.join(runtimeRoot, 'gsdd.mjs');
      const laterHelper = path.join(runtimeRoot, 'gsdd.ps1');
      const outsidePath = path.join(tmpDir, `outside-current-${command}.ps1`);
      const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
      const manifestBefore = fs.readFileSync(manifestPath);
      const staleEarlierContent = '// deliberately stale earlier helper\n';
      const outsideContent = '# external current-helper sentinel\n';
      fs.writeFileSync(earlierHelper, staleEarlierContent);
      fs.rmSync(laterHelper);
      fs.writeFileSync(outsidePath, outsideContent);
      try {
        fs.symlinkSync(outsidePath, laterHelper, 'file');
      } catch (error) {
        if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) {
          t.skip(`symlink creation unavailable in this environment: ${error.code}`);
          return;
        }
        throw error;
      }

      const run = command === 'init'
        ? () => initProject()
        : () => runCliAsMain(tmpDir, ['update']);
      await assert.rejects(run, (error) => {
        assert.match(error.message, /Refusing to write generated runtime helper bin\/gsdd\.ps1: target must be a regular file inside bin\//);
        assert.doesNotMatch(error.message, new RegExp(tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      });
      assert.strictEqual(fs.readFileSync(earlierHelper, 'utf-8'), staleEarlierContent);
      assert.ok(fs.lstatSync(laterHelper).isSymbolicLink());
      assert.strictEqual(fs.readFileSync(outsidePath, 'utf-8'), outsideContent);
      assert.deepStrictEqual(fs.readFileSync(manifestPath), manifestBefore);
    });
  }

  test('update preflights all helpers before refusing a current-helper parent junction', async (t) => {
    await initProject();

    const runtimeRoot = path.join(tmpDir, '.work', 'bin');
    const earlierHelper = path.join(runtimeRoot, 'gsdd.mjs');
    const helperLib = path.join(runtimeRoot, 'lib');
    const outsideDir = path.join(tmpDir, 'outside-current-helper-parent');
    const sentinelPath = path.join(outsideDir, 'sentinel.txt');
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifestBefore = fs.readFileSync(manifestPath);
    const staleEarlierContent = '// stale before parent preflight\n';
    fs.writeFileSync(earlierHelper, staleEarlierContent);
    fs.rmSync(helperLib, { recursive: true, force: true });
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(sentinelPath, 'leave current helper parent alone\n');
    try {
      fs.symlinkSync(outsideDir, helperLib, 'junction');
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) {
        t.skip(`junction creation unavailable in this environment: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => runCliAsMain(tmpDir, ['update']),
      /Refusing to write generated runtime helper bin\/lib\/.*: parent must be a real directory inside bin\//
    );
    assert.strictEqual(fs.readFileSync(earlierHelper, 'utf-8'), staleEarlierContent);
    assert.deepStrictEqual(fs.readdirSync(outsideDir), ['sentinel.txt']);
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf-8'), 'leave current helper parent alone\n');
    assert.deepStrictEqual(fs.readFileSync(manifestPath), manifestBefore);
  });

  test('update does not claim a planning root that appears after helper generation was skipped', async () => {
    const initModulePath = path.join(__dirname, '..', 'bin', 'lib', 'init.mjs');
    const { createCmdUpdate } = await import(`${pathToFileURL(initModulePath).href}?late-root=${Date.now()}`);
    const planningDir = path.join(tmpDir, '.work');
    const unmanagedPath = path.join(planningDir, 'bin', 'unmanaged.mjs');
    const adapter = {
      id: 'late-root',
      name: 'late-root',
      detect: () => true,
      isInstalled: () => true,
      generate: () => {
        fs.mkdirSync(path.dirname(unmanagedPath), { recursive: true });
        fs.writeFileSync(unmanagedPath, '// adapter-owned file\n');
      },
      summary: () => 'late-root adapter updated',
    };
    const lines = [];
    const originalLog = console.log;
    console.log = (...parts) => lines.push(parts.join(' '));
    try {
      createCmdUpdate({
        cwd: tmpDir,
        planningDir,
        stateDirName: '.work',
        adapters: { 'late-root': adapter },
        workflows: [],
        frameworkVersion: 'test',
      })();
    } finally {
      console.log = originalLog;
    }

    assert.strictEqual(fs.readFileSync(unmanagedPath, 'utf-8'), '// adapter-owned file\n');
    assert.ok(!fs.existsSync(path.join(planningDir, 'generation-manifest.json')));
    assert.ok(lines.some((line) => line.includes('late-root adapter updated')));
    assert.ok(lines.every((line) => !line.includes('generation manifest')));
  });

  test('update refuses a linked runtime root before writing helpers or manifest', async (t) => {
    await initProject();

    const runtimeRoot = path.join(tmpDir, '.work', 'bin');
    const externalRoot = path.join(tmpDir, 'external-runtime-root');
    const sentinelPath = path.join(externalRoot, 'sentinel.txt');
    const manifestPath = path.join(tmpDir, '.work', 'generation-manifest.json');
    const manifestBefore = fs.readFileSync(manifestPath);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.mkdirSync(externalRoot);
    fs.writeFileSync(sentinelPath, 'leave me alone\n');
    try {
      fs.symlinkSync(externalRoot, runtimeRoot, 'junction');
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) {
        t.skip(`junction creation unavailable in this environment: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => runCliAsMain(tmpDir, ['update']),
      /Refusing to write generated runtime helpers: bin\/ must be a real directory/
    );
    assert.deepStrictEqual(fs.readdirSync(externalRoot), ['sentinel.txt']);
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf-8'), 'leave me alone\n');
    assert.deepStrictEqual(fs.readFileSync(manifestPath), manifestBefore);
  });
});
