/**
 * An explicit empty adapterSelection in the generation manifest is a portable-only workspace, not
 * an unknown one. Adding CLAUDE.md or .claude/ later must not make `update` or `health` fall back
 * to platform detection and start owning Claude adapter files the setup never selected.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTempProject, cleanup, readJson } = require('./gsdd.helpers.cjs');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'gsdd.mjs');

function runEntry(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0' },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function createPortableOnlyWorkspace() {
  const dir = createTempProject();
  const git = spawnSync('git', ['init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
  assert.equal(git.status, 0, git.stderr);
  const setup = runEntry(dir, ['setup', '-y']);
  assert.equal(setup.exitCode, 0, setup.output);
  const manifest = readJson(path.join(dir, '.work', 'generation-manifest.json'));
  assert.deepEqual(manifest.adapterSelection, [], 'fixture must be a portable-only workspace');
  return dir;
}

test.describe('explicit empty adapterSelection stays portable-only', () => {
  let dir;
  test.beforeEach(() => { dir = createPortableOnlyWorkspace(); });
  test.afterEach(() => { cleanup(dir); });

  for (const [label, addMarker] of [
    ['CLAUDE.md', () => fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# project\n')],
    ['a .claude directory', () => fs.mkdirSync(path.join(dir, '.claude'))],
  ]) {
    test(`update succeeds and writes no Claude files after ${label} appears`, () => {
      addMarker();
      const result = runEntry(dir, ['update']);
      assert.equal(result.exitCode, 0, result.output);
      assert.ok(!/Refusing adapter update/.test(result.output), result.output);
      assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills')), '.claude/skills must not be created');
      assert.ok(!fs.existsSync(path.join(dir, '.claude', 'commands')), '.claude/commands must not be created');
      assert.ok(!fs.existsSync(path.join(dir, '.claude', 'agents')), '.claude/agents must not be created');
      const manifest = readJson(path.join(dir, '.work', 'generation-manifest.json'));
      assert.deepEqual(manifest.adapterSelection, []);
    });

    test(`health reports no W11 drift after ${label} appears`, () => {
      addMarker();
      const result = runEntry(dir, ['health', '--json']);
      const report = JSON.parse(result.stdout);
      assert.ok(!report.warnings.some((w) => w.id === 'W11'), JSON.stringify(report.warnings));
      assert.ok(!report.errors.length, JSON.stringify(report.errors));
    });
  }

  test('an update --dry-run is also accepted', () => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# project\n');
    const result = runEntry(dir, ['update', '--dry-run']);
    assert.equal(result.exitCode, 0, result.output);
    assert.ok(!/Refusing adapter update/.test(result.output), result.output);
  });
});
