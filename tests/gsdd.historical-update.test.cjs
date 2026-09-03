const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, before, describe, test } = require('node:test');

// Intentionally source-grounded: release tags produce the historical generated
// skill bytes in disposable workspaces, while the small frozen manifest files
// preserve the exact published schemas where a release tag alone is not enough.
// CI fetches full history for this test instead of checking in megabytes of
// duplicated generated skill fixtures.
const REPO = path.resolve(__dirname, '..');
const CURRENT_CLI = path.join(REPO, 'bin', 'gsdd.mjs');
const PUBLISHED_MANIFESTS = {
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'historical-generation-manifests-gsdd.json'), 'utf-8')),
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'historical-generation-manifests.json'), 'utf-8')),
};
const HISTORICAL_TAGS = [
  { tag: 'v0.28.0', profile: 'gsdd-cli@0.28.0', preRename: true },
  { tag: 'v0.29.0', profile: 'gsdd-cli@0.29.0-0.29.1', manifestFixture: 'gsdd-cli@0.29.0', preRename: true },
  { tag: 'v0.29.1', profile: 'gsdd-cli@0.29.0-0.29.1', manifestFixture: 'gsdd-cli@0.29.0', preRename: true },
  { tag: 'v0.29.2', profile: 'gsdd-cli@0.29.2', manifestFixture: 'gsdd-cli@0.29.2', preRename: true },
  { tag: 'v0.30.0', profile: 'gsdd-cli@0.30.0', manifestFixture: 'gsdd-cli@0.30.0', preRename: true },
  { tag: 'v0.31.0', profile: 'gsdd-cli@0.31.0', manifestFixture: 'gsdd-cli@0.31.0', preRename: true },
  { tag: 'v0.31.1', profile: 'gsdd-cli@0.31.1-0.32.0', preRename: true },
  { tag: 'v0.31.2', profile: 'gsdd-cli@0.31.1-0.32.0', preRename: true },
  { tag: 'v0.32.0', profile: 'gsdd-cli@0.31.1-0.32.0', preRename: true },
  { tag: 'v0.33.0', profile: 'workspine@0.33.0', manifestFixture: 'workspine@0.33.0' },
  { tag: 'v0.34.0', profile: 'workspine@0.34.0', manifestFixture: 'workspine@0.34.0' },
];

let sourceClone;
let suiteRoot;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf-8',
    env: {
      ...process.env,
      WORKSPINE_UPDATE_AWARENESS: '0',
      GSDD_UPDATE_AWARENESS: '0',
      ...options.env,
    },
    ...options,
  });
}

function requireSuccess(result, label) {
  assert.strictEqual(result.status, 0, `${label}\n${result.stdout || ''}\n${result.stderr || ''}`);
}

function snapshotTree(root) {
  const snapshot = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) snapshot[relative] = { kind: 'link', target: fs.readlinkSync(absolute) };
      else if (stat.isDirectory()) {
        snapshot[relative] = { kind: 'directory' };
        visit(absolute);
      } else snapshot[relative] = { kind: 'file', bytes: fs.readFileSync(absolute).toString('base64') };
    }
  };
  visit(root);
  return snapshot;
}

function createFixture(tag, manifestFixture = null) {
  const fixture = fs.mkdtempSync(path.join(suiteRoot, `${tag.replace(/\./g, '-')}-`));
  requireSuccess(run('git', ['checkout', '--quiet', '--force', tag], { cwd: sourceClone }), `checkout ${tag}`);
  requireSuccess(run('git', ['init', '--quiet'], { cwd: fixture }), `git init ${tag} fixture`);
  const historicalCli = path.join(sourceClone, 'bin', 'gsdd.mjs');
  requireSuccess(
    run(process.execPath, [historicalCli, 'init', '--auto', '--tools', 'agents'], { cwd: fixture }),
    `${tag} init in disposable cwd ${fixture}`,
  );
  if (manifestFixture) {
    fs.writeFileSync(
      path.join(fixture, '.work', 'generation-manifest.json'),
      `${JSON.stringify(PUBLISHED_MANIFESTS[manifestFixture], null, 2)}\n`,
    );
  }
  return fixture;
}

function updateFixture(fixture) {
  return run(process.execPath, [CURRENT_CLI, 'update'], {
    cwd: fixture,
    env: { GSDD_TEST_HOME: path.join(fixture, 'isolated-home') },
  });
}

async function writeCurrentWorkSkills(fixture, names = null) {
  const [{ renderSkillContent }, { WORKFLOWS }] = await Promise.all([
    import('../bin/lib/rendering.mjs'),
    import('../bin/lib/workflows.mjs'),
  ]);
  const selected = names ? new Set(names) : null;
  for (const workflow of WORKFLOWS) {
    if (selected && !selected.has(workflow.name)) continue;
    const target = path.join(fixture, '.agents', 'skills', workflow.name, 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderSkillContent(workflow, { stateDirName: '.work' }));
  }
}

describe('historical repository update bridge', () => {
  before(() => {
    suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-historical-update-'));
    sourceClone = path.join(suiteRoot, 'historical-source');
    requireSuccess(
      run('git', ['clone', '--no-hardlinks', '--quiet', REPO, sourceClone], { cwd: suiteRoot }),
      'clone isolated historical source',
    );
  });

  after(() => {
    if (suiteRoot && path.dirname(suiteRoot) === os.tmpdir() && path.basename(suiteRoot).startsWith('workspine-historical-update-')) {
      fs.rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  for (const { tag, profile, manifestFixture, preRename } of HISTORICAL_TAGS) {
    test(`plain update upgrades intact ${tag} generated ownership`, () => {
      const fixture = createFixture(tag, manifestFixture);
      const result = updateFixture(fixture);

      requireSuccess(result, `${tag} update`);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.match(output, new RegExp(`recognized ${profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ownership`));
      assert.match(output, /Repository update complete/);
      const manifest = JSON.parse(fs.readFileSync(path.join(fixture, '.work', 'generation-manifest.json'), 'utf-8'));
      assert.deepStrictEqual(manifest.adapterSelection, ['agents']);
      assert.ok(manifest.adapterFiles['.agents/skills/work-plan/SKILL.md']);
      assert.ok(fs.existsSync(path.join(fixture, '.agents', 'skills', 'work-plan', 'SKILL.md')));
      if (preRename) {
        const legacySkillFiles = fs.readdirSync(path.join(fixture, '.agents', 'skills'))
          .filter((entry) => entry.startsWith('gsdd-'))
          .filter((entry) => fs.existsSync(path.join(fixture, '.agents', 'skills', entry, 'SKILL.md')));
        assert.deepStrictEqual(legacySkillFiles, [], 'every exact-hash-proven pre-rename skill file should be pruned');
      }
    });
  }

  test('modified historical generated bytes fail closed without writes', () => {
    const fixture = createFixture('v0.32.0');
    const target = path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'SKILL.md');
    fs.appendFileSync(target, '\nconsumer change\n');
    const beforeTree = snapshotTree(fixture);

    const result = updateFixture(fixture);

    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /historical generated target .* was modified/);
    assert.match(`${result.stdout}\n${result.stderr}`, /restore the exact gsdd-cli@0\.31\.1-0\.32\.0 generated bytes/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /re-run init|rerun init/i);
    assert.deepStrictEqual(snapshotTree(fixture), beforeTree);
  });

  test('an unknown historical manifest fails closed without writes', () => {
    const fixture = createFixture('v0.32.0');
    const manifestPath = path.join(fixture, '.work', 'generation-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.frameworkVersion = 'unknown-historical-schema';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const beforeTree = snapshotTree(fixture);

    const result = updateFixture(fixture);

    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /generation manifest ownership is missing or corrupt/);
    assert.deepStrictEqual(snapshotTree(fixture), beforeTree);
  });

  test('a historical target symlink fails closed without writes', (t) => {
    const fixture = createFixture('v0.32.0');
    const target = path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'SKILL.md');
    const external = path.join(fixture, 'consumer-skill.md');
    fs.writeFileSync(external, 'consumer bytes\n');
    fs.rmSync(target);
    try {
      fs.symlinkSync(external, target, 'file');
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip('file symlinks require an unavailable Windows privilege');
        return;
      }
      throw error;
    }
    const beforeTree = snapshotTree(fixture);

    const result = updateFixture(fixture);

    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /must be a regular file/);
    assert.deepStrictEqual(snapshotTree(fixture), beforeTree);
  });

  test('a consumer collision at a renamed current target fails closed without writes', () => {
    const fixture = createFixture('v0.28.0');
    const collision = path.join(fixture, '.agents', 'skills', 'work-plan', 'SKILL.md');
    fs.mkdirSync(path.dirname(collision), { recursive: true });
    fs.writeFileSync(collision, 'consumer-owned work-plan\n');
    const beforeTree = snapshotTree(fixture);

    const result = updateFixture(fixture);

    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /collides with an unproven consumer file/);
    assert.deepStrictEqual(snapshotTree(fixture), beforeTree);
  });

  test('a missing historical generated target fails closed without writes', () => {
    const fixture = createFixture('v0.32.0');
    fs.rmSync(path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'));
    const beforeTree = snapshotTree(fixture);

    const result = updateFixture(fixture);

    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /historical generated target .* is missing/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /re-run init|rerun init/i);
    assert.deepStrictEqual(snapshotTree(fixture), beforeTree);
  });

  test('unknown extra pre-rename skills and sibling files remain untouched', () => {
    const fixture = createFixture('v0.32.0');
    const custom = path.join(fixture, '.agents', 'skills', 'gsdd-consumer-extra', 'SKILL.md');
    const sibling = path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'NOTES.md');
    fs.mkdirSync(path.dirname(custom), { recursive: true });
    fs.writeFileSync(custom, 'consumer-owned extra skill\n');
    fs.writeFileSync(sibling, 'consumer-owned sibling note\n');

    const result = updateFixture(fixture);

    requireSuccess(result, 'v0.32.0 update with extra gsdd content');
    assert.strictEqual(fs.readFileSync(custom, 'utf-8'), 'consumer-owned extra skill\n');
    assert.strictEqual(fs.readFileSync(sibling, 'utf-8'), 'consumer-owned sibling note\n');
    assert.ok(!fs.existsSync(path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, '.work', 'generation-manifest.json'), 'utf-8'));
    assert.ok(!manifest.adapterFiles['.agents/skills/gsdd-consumer-extra/SKILL.md']);
    assert.ok(!manifest.adapterFiles['.agents/skills/gsdd-plan/NOTES.md']);
  });

  test('retry after a partially pruned pre-rename upgrade converges', async () => {
    const fixture = createFixture('v0.32.0');
    await writeCurrentWorkSkills(fixture, ['work-plan']);
    fs.rmSync(path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'));

    const result = updateFixture(fixture);

    requireSuccess(result, 'v0.32.0 retry after partial prune');
    assert.ok(fs.existsSync(path.join(fixture, '.agents', 'skills', 'work-plan', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(fixture, '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(fixture, '.agents', 'skills', 'gsdd-verify', 'SKILL.md')));
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, '.work', 'generation-manifest.json'), 'utf-8'));
    assert.ok(manifest.adapterFiles['.agents/skills/work-plan/SKILL.md']);
    assert.ok(!manifest.adapterFiles['.agents/skills/gsdd-plan/SKILL.md']);
  });

  test('prune revalidation checks every candidate before deleting any', async () => {
    const fixture = createFixture('v0.32.0');
    await writeCurrentWorkSkills(fixture);
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, '.work', 'generation-manifest.json'), 'utf-8'));
    const { applyHistoricalAdapterPruning, bridgeHistoricalAdapterOwnership } = await import('../bin/lib/manifest.mjs');
    const bridge = bridgeHistoricalAdapterOwnership({ cwd: fixture, manifest, stateDirName: '.work' });
    assert.ok(bridge?.pruningPlan?.removals?.length > 1);
    const late = bridge.pruningPlan.removals.at(-1);
    fs.appendFileSync(path.join(fixture, late.relativePath), '\nconsumer race change\n');
    const first = bridge.pruningPlan.removals[0];
    const firstBytes = fs.readFileSync(path.join(fixture, first.relativePath));

    assert.throws(
      () => applyHistoricalAdapterPruning(bridge.pruningPlan),
      /changed before pruning/,
    );
    assert.ok(fs.readFileSync(path.join(fixture, first.relativePath)).equals(firstBytes));
  });
});
