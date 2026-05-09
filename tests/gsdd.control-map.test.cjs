/**
 * GSDD control-map helper tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');

const { createTempProject, runCliAsMain, cleanup } = require('./gsdd.helpers.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

function git(args, cwd = tmpDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function gitRaw(args, cwd = tmpDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeFile(relativePath, content) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

async function initGitWorkspace() {
  const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
  assert.strictEqual(initResult.exitCode, 0, initResult.output);
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  git(['config', 'core.autocrlf', 'false']);
  writeFile('.gitignore', '.planning/\n.agents/\nignored*.log\n');
  writeFile('README.md', '# Test repo\n');
  writeFile('tracked.txt', 'tracked\n');
  git(['add', '.gitignore', 'README.md', 'tracked.txt']);
  git(['commit', '-m', 'initial']);
  try {
    git(['branch', '-M', 'main']);
  } catch {
    // Older Git builds may already use a fixed default branch. The control-map
    // contract only needs the live branch value, not a hardcoded branch name.
  }
}

describe('control-map command', () => {
  test('reports computed repo truth, dirty buckets, and authority order', async () => {
    await initGitWorkspace();
    writeFile('tracked.txt', 'tracked changed\n');
    writeFile('new-file.txt', 'new\n');
    writeFile('ignored.log', 'ignored\n');
    for (let i = 0; i < 205; i += 1) writeFile(`ignored-${i}.log`, 'ignored\n');

    const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);

    assert.strictEqual(map.operation, 'control-map');
    assert.deepStrictEqual(map.authority, [
      'repo_truth',
      'planning_artifacts',
      'checkpoint_narrative',
      'local_annotations',
      'vendor_session_forensics',
    ]);
    assert.strictEqual(map.canonical_worktree.git_valid, true);
    assert.deepStrictEqual(map.canonical_worktree.ahead_behind, { ahead: null, behind: null });
    assert.strictEqual(map.canonical_worktree.dirty.counts.tracked, 1);
    assert.ok(map.canonical_worktree.dirty.counts.untracked >= 1);
    assert.strictEqual(map.canonical_worktree.dirty.counts.ignored, null);
    assert.strictEqual(map.canonical_worktree.dirty.ignored.length, 0);
    assert.strictEqual(map.canonical_worktree.dirty.omitted_counts.ignored, null);
    assert.ok(map.risks.some((risk) => risk.code === 'canonical_dirty'));
    assert.ok(!map.risks.some((risk) => risk.code === 'ignored_local_surfaces_present'));
  });

  test('reports git inspection failures as warnings when no git repo is present', async () => {
    const initResult = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(initResult.exitCode, 0, initResult.output);

    const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);

    assert.ok(map.risks.some((risk) => risk.code === 'git_worktree_list_failed' && risk.severity === 'warn'));
    assert.ok(map.risks.some((risk) => risk.code === 'canonical_git_invalid' && risk.severity === 'warn'));
    assert.ok(map.interventions.some((entry) => /git\/safe\.directory/i.test(entry)));
  });

  test('includes explicit ignored path list only with --with-ignored', async () => {
    await initGitWorkspace();
    writeFile('ignored-a.log', 'ignored a\n');
    writeFile('ignored-b.log', 'ignored b\n');
    for (let i = 0; i < 205; i += 1) writeFile(`ignored-${i}.log`, 'ignored\n');

    const summaryResult = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(summaryResult.exitCode, 0, summaryResult.output);
    const summaryMap = JSON.parse(summaryResult.output);

    assert.strictEqual(summaryMap.canonical_worktree.dirty.ignored.length, 0);
    assert.strictEqual(summaryMap.canonical_worktree.dirty.counts.ignored, null);
    assert.strictEqual(summaryMap.canonical_worktree.dirty.ignored_count_included, false);

    const deepResult = await runCliAsMain(tmpDir, ['control-map', '--json', '--with-ignored']);
    assert.strictEqual(deepResult.exitCode, 0, deepResult.output);
    const deepMap = JSON.parse(deepResult.output);

    assert.ok(deepMap.canonical_worktree.dirty.ignored.length > 0);
    assert.ok(deepMap.canonical_worktree.dirty.ignored.length <= 200);
    assert.ok(deepMap.canonical_worktree.dirty.omitted_counts.ignored > 0);
    assert.ok(deepMap.canonical_worktree.dirty.counts.ignored >= deepMap.canonical_worktree.dirty.ignored.length);
  });

  test('reads local annotations as stale-checkable intent, not product truth', async () => {
    await initGitWorkspace();
    const head = git(['rev-parse', 'HEAD']);
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    writeFile('.planning/.local/control-map.annotations.json', JSON.stringify({
      schema_version: 1,
      worktrees: [{
        id: 'canonical',
        path: '.',
        runtime_owner: 'codex-cli',
        branch,
        last_known_head: head,
        intended_scope: 'control-map test',
        write_set: ['bin/lib/control-map.mjs'],
        cleanup_state: 'active',
        proof_state: 'test-only',
        next_step: 'run control-map tests',
        updated_at: '2026-05-08T00:00:00.000Z',
      }, {
        id: 'stale',
        path: '../missing-worktree',
        cleanup_state: 'paused',
      }],
    }, null, 2));

    const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);

    assert.strictEqual(map.annotations.exists, true);
    assert.strictEqual(map.annotations.valid, true);
    assert.strictEqual(map.canonical_worktree.annotation.runtime_owner, 'codex-cli');
    assert.ok(map.risks.some((risk) => risk.code === 'stale_annotation_missing_worktree'));
    assert.strictEqual(map.authority.indexOf('repo_truth') < map.authority.indexOf('local_annotations'), true);
  });

  test('annotation helper writes, updates, and clears local intent', async () => {
    await initGitWorkspace();

    let result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--owner',
      'codex-cli',
      '--scope',
      'phase 61',
      '--write-set',
      'bin/lib/control-map.mjs,tests/gsdd.control-map.test.cjs',
      '--next-step',
      'run focused tests',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    let mutation = JSON.parse(result.output);

    assert.strictEqual(mutation.operation, 'control-map annotate set');
    assert.strictEqual(mutation.status, 'created');
    assert.strictEqual(mutation.annotation.id, 'canonical');
    assert.strictEqual(mutation.annotation.runtime_owner, 'codex-cli');
    assert.deepStrictEqual(mutation.annotation.write_set, [
      'bin/lib/control-map.mjs',
      'tests/gsdd.control-map.test.cjs',
    ]);

    result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    let map = JSON.parse(result.output);
    assert.strictEqual(map.canonical_worktree.annotation.id, 'canonical');
    assert.strictEqual(map.canonical_worktree.annotation.intended_scope, 'phase 61');

    result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--write-set',
      'src/app.js',
      '--cleanup-state',
      'paused',
      '--next-step',
      'resume later',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.status, 'updated');
    assert.strictEqual(mutation.annotation.cleanup_state, 'paused');
    assert.deepStrictEqual(mutation.annotation.write_set, ['src/app.js']);

    result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--write-set',
      'src/other.js',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.status, 'updated');
    assert.strictEqual(mutation.annotation.cleanup_state, 'paused');
    assert.deepStrictEqual(mutation.annotation.write_set, ['src/other.js']);

    result = await runCliAsMain(tmpDir, ['control-map', 'annotate', 'clear', '--id', 'missing', '--write-set', 'src/app.js']);
    assert.notStrictEqual(result.exitCode, 0, 'clear should reject set-only flags');
    mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.reason, 'invalid_arguments');

    result = await runCliAsMain(tmpDir, ['control-map', 'annotate', 'clear', '--id', 'canonical']);
    assert.strictEqual(result.exitCode, 0, result.output);
    mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.operation, 'control-map annotate clear');
    assert.strictEqual(mutation.status, 'cleared');
    assert.strictEqual(mutation.changed, true);

    result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    map = JSON.parse(result.output);
    assert.strictEqual(map.canonical_worktree.annotation, null);
  });

  test('annotation helper fails closed on stale updates and supports explicit refresh', async () => {
    await initGitWorkspace();
    let result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--write-set',
      'src/app.js',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const initialHead = JSON.parse(result.output).annotation.last_known_head;

    writeFile('README.md', '# Updated\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'update readme']);

    result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--write-set',
      'src/app.js',
    ]);
    assert.notStrictEqual(result.exitCode, 0, 'stale update should fail closed');
    let mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.reason, 'stale_annotation');
    assert.ok(mutation.stale_issues.some((issue) => issue.code === 'head_mismatch'));

    result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    let map = JSON.parse(result.output);
    assert.ok(map.risks.some((risk) => risk.code === 'stale_annotation_head_mismatch'));

    result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--write-set',
      'src/app.js',
      '--refresh',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.status, 'refreshed');
    assert.notStrictEqual(mutation.annotation.last_known_head, initialHead);

    writeFile('README.md', '# Updated again\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'update readme again']);

    result = await runCliAsMain(tmpDir, ['control-map', 'annotate', 'clear', '--id', 'canonical']);
    assert.strictEqual(result.exitCode, 0, result.output);
    mutation = JSON.parse(result.output);
    assert.strictEqual(mutation.status, 'cleared');
  });

  test('helper-written annotations remain lower-authority than live dirty truth', async () => {
    await initGitWorkspace();
    let result = await runCliAsMain(tmpDir, [
      'control-map',
      'annotate',
      'set',
      '--id',
      'canonical',
      '--write-set',
      'src/app.js',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    writeFile('src/app.js', 'dirty\n');

    result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);
    const risk = map.risks.find((entry) => entry.code === 'dirty_path_write_set_overlap');

    assert.ok(risk);
    assert.strictEqual(risk.severity, 'block');
    assert.ok(risk.overlaps.some((overlap) => overlap.annotation_id === 'canonical' && overlap.dirty_path === 'src/app.js'));
    assert.strictEqual(map.authority.indexOf('repo_truth') < map.authority.indexOf('local_annotations'), true);
  });

  test('reports active annotation write-set overlap as a block-level risk', async () => {
    await initGitWorkspace();
    writeFile('.planning/.local/control-map.annotations.json', JSON.stringify({
      schema_version: 1,
      worktrees: [{
        id: 'codex',
        path: '.',
        cleanup_state: 'active',
        write_set: ['src'],
      }, {
        id: 'opencode',
        path: '.',
        cleanup_state: 'paused',
        write_set: ['src/app.js'],
      }, {
        id: 'merged-old-work',
        path: '.',
        cleanup_state: 'merged',
        write_set: ['src/app.js'],
      }],
    }, null, 2));

    const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);
    const risk = map.risks.find((entry) => entry.code === 'write_set_overlap');

    assert.ok(risk);
    assert.strictEqual(risk.severity, 'block');
    assert.strictEqual(risk.overlaps.length, 1);
    assert.deepStrictEqual(
      [risk.overlaps[0].left_annotation_id, risk.overlaps[0].right_annotation_id].sort(),
      ['codex', 'opencode']
    );
    assert.ok(map.interventions.some((entry) => /overlapping local annotation write sets/i.test(entry)));
  });

  test('reports live dirty paths that overlap annotated write sets', async () => {
    await initGitWorkspace();
    writeFile('.planning/.local/control-map.annotations.json', JSON.stringify({
      schema_version: 1,
      worktrees: [{
        id: 'canonical',
        path: '.',
        cleanup_state: 'active',
        write_set: ['src/app.js'],
      }],
    }, null, 2));
    writeFile('src/app.js', 'dirty\n');

    const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);
    const risk = map.risks.find((entry) => entry.code === 'dirty_path_write_set_overlap');

    assert.ok(risk);
    assert.strictEqual(risk.severity, 'block');
    assert.ok(risk.overlaps.some((overlap) => (
      overlap.annotation_id === 'canonical'
      && overlap.write_path === 'src/app.js'
      && overlap.dirty_path === 'src/app.js'
      && overlap.dirty_kind === 'untracked'
    )));
  });

  test('detects dirty overlap in a real sibling git worktree', async () => {
    await initGitWorkspace();
    const siblingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-control-map-sibling-'));
    fs.rmSync(siblingPath, { recursive: true, force: true });

    try {
      git(['worktree', 'add', '-b', 'feature/sibling-risk', siblingPath]);
      fs.writeFileSync(path.join(siblingPath, 'tracked.txt'), 'sibling dirty\n');
      writeFile('.planning/.local/control-map.annotations.json', JSON.stringify({
        schema_version: 1,
        worktrees: [{
          id: 'sibling',
          path: siblingPath,
          cleanup_state: 'active',
          write_set: ['tracked.txt'],
        }],
      }, null, 2));

      const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
      assert.strictEqual(result.exitCode, 0, result.output);
      const map = JSON.parse(result.output);
      const risk = map.risks.find((entry) => entry.code === 'dirty_path_write_set_overlap');

      assert.ok(map.worktrees.some((worktree) => path.resolve(worktree.path) === path.resolve(siblingPath)));
      assert.ok(risk);
      assert.strictEqual(risk.severity, 'block');
      assert.ok(risk.overlaps.some((overlap) => overlap.annotation_id === 'sibling' && overlap.dirty_worktree_id !== '.'));
    } finally {
      try {
        git(['worktree', 'remove', '--force', siblingPath]);
      } catch {
        // Temp worktree cleanup is best-effort; the temp directory is removed below.
      }
      fs.rmSync(siblingPath, { recursive: true, force: true });
    }
  });

  test('reports detached sibling worktrees as candidate-work risks', async () => {
    await initGitWorkspace();
    const detachedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-control-map-detached-'));
    fs.rmSync(detachedPath, { recursive: true, force: true });

    try {
      git(['worktree', 'add', '--detach', detachedPath, 'HEAD']);

      const result = await runCliAsMain(tmpDir, ['control-map', '--json']);
      assert.strictEqual(result.exitCode, 0, result.output);
      const map = JSON.parse(result.output);
      const detached = map.worktrees.find((worktree) => path.resolve(worktree.path) === path.resolve(detachedPath));

      assert.ok(detached);
      assert.strictEqual(detached.detached, true);
      assert.ok(map.risks.some((risk) => risk.code === 'detached_candidate_worktree' && risk.worktree_id === detached.id));
      assert.ok(map.risks.some((risk) => risk.code === 'unannotated_candidate_worktree' && risk.worktree_id === detached.id));
    } finally {
      try {
        git(['worktree', 'remove', '--force', detachedPath]);
      } catch {
        // Temp worktree cleanup is best-effort; the temp directory is removed below.
      }
      fs.rmSync(detachedPath, { recursive: true, force: true });
    }
  });

  test('reports comparable upstream behind state and dirty-behind transition risk', async () => {
    await initGitWorkspace();
    const remotePath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-control-map-remote-'));
    const clonePath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-control-map-clone-'));
    fs.rmSync(remotePath, { recursive: true, force: true });
    fs.rmSync(clonePath, { recursive: true, force: true });

    try {
      gitRaw(['init', '--bare', remotePath], os.tmpdir());
      gitRaw(['symbolic-ref', 'HEAD', 'refs/heads/main'], remotePath);
      git(['remote', 'add', 'origin', remotePath]);
      git(['push', '-u', 'origin', 'main']);
      gitRaw(['clone', remotePath, clonePath], os.tmpdir());
      gitRaw(['config', 'user.email', 'test@example.com'], clonePath);
      gitRaw(['config', 'user.name', 'Test User'], clonePath);
      fs.writeFileSync(path.join(clonePath, 'README.md'), '# Remote change\n');
      gitRaw(['add', 'README.md'], clonePath);
      gitRaw(['commit', '-m', 'remote change'], clonePath);
      gitRaw(['push'], clonePath);
      git(['fetch', 'origin']);
      git(['reset', '--hard', 'HEAD']);
      git(['clean', '-fd']);

      let result = await runCliAsMain(tmpDir, ['control-map', '--json']);
      assert.strictEqual(result.exitCode, 0, result.output);
      let map = JSON.parse(result.output);

      assert.ok(map.risks.some((risk) => risk.code === 'canonical_branch_behind_upstream' && risk.behind === 1));
      assert.ok(!map.risks.some((risk) => risk.code === 'canonical_dirty_behind_upstream'));

      writeFile('notes.md', 'ordinary local note\n');
      result = await runCliAsMain(tmpDir, ['control-map', '--json']);
      assert.strictEqual(result.exitCode, 0, result.output);
      map = JSON.parse(result.output);
      assert.ok(map.risks.some((risk) => risk.code === 'canonical_dirty'));
      assert.ok(!map.risks.some((risk) => risk.code === 'canonical_dirty_behind_upstream'));
      fs.unlinkSync(path.join(tmpDir, 'notes.md'));

      writeFile('tracked.txt', 'dirty behind\n');
      result = await runCliAsMain(tmpDir, ['control-map', '--json']);
      assert.strictEqual(result.exitCode, 0, result.output);
      map = JSON.parse(result.output);

      const dirtyBehind = map.risks.find((risk) => risk.code === 'canonical_dirty_behind_upstream');
      assert.ok(dirtyBehind);
      assert.strictEqual(dirtyBehind.severity, 'block');
    } finally {
      fs.rmSync(remotePath, { recursive: true, force: true });
      fs.rmSync(clonePath, { recursive: true, force: true });
    }
  });

  test('rejects annotation files outside the workspace without reading them', async () => {
    await initGitWorkspace();
    const outsidePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-annotation-outside-')), 'annotations.json');
    fs.writeFileSync(outsidePath, JSON.stringify({
      worktrees: [{
        path: '.',
        runtime_owner: 'outside',
        cleanup_state: 'active',
      }],
    }, null, 2));

    const result = await runCliAsMain(tmpDir, ['control-map', '--json', '--annotations', outsidePath]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const map = JSON.parse(result.output);

    assert.strictEqual(map.annotations.exists, false);
    assert.strictEqual(map.annotations.valid, false);
    assert.ok(map.annotations.errors.some((error) => error.code === 'annotations_path_outside_workspace'));
    assert.strictEqual(map.canonical_worktree.annotation, null);
  });

  test('human output includes lifecycle checkpoint state', async () => {
    await initGitWorkspace();
    const result = await runCliAsMain(tmpDir, ['control-map']);
    assert.strictEqual(result.exitCode, 0, result.output);

    assert.match(result.output, /Workflow: /);
    assert.match(result.output, /Checkpoint: \.planning\/\.continue-here\.md \((present|missing)\)/);
  });

  test('generated local helper exposes control-map from nested directories', async () => {
    await initGitWorkspace();
    const nestedDir = path.join(tmpDir, 'apps', 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });
    const helperPath = path.join(tmpDir, '.planning', 'bin', 'gsdd.mjs');

    const result = execFileSync(process.execPath, [helperPath, 'control-map', '--json'], {
      cwd: nestedDir,
      encoding: 'utf-8',
    });
    const map = JSON.parse(result);

    assert.strictEqual(map.operation, 'control-map');
    assert.strictEqual(path.resolve(map.workspace_root), path.resolve(tmpDir));
  });
});
