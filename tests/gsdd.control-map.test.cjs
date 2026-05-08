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
