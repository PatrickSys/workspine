const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTempProject, cleanup, runCliAsMain } = require('./gsdd.helpers.cjs');

const STATE_DIR_MODULE = path.join(__dirname, '..', 'bin', 'lib', 'state-dir.mjs');
const WORKSPACE_ROOT_MODULE = path.join(__dirname, '..', 'bin', 'lib', 'workspace-root.mjs');

async function loadModule(file) {
  return import(`${pathToFileURL(file).href}?t=${Date.now()}-${Math.random()}`);
}

function writeLegacyConfig(root, initVersion = 'v1.1') {
  const dir = path.join(root, '.planning');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ initVersion }));
}

function classificationContract(result, root) {
  return {
    status: result.status,
    action: result.action,
    root: result.root,
    dir: result.dir,
    name: result.name,
    legacyDir: result.legacyDir,
  };
}

// A real Git root. An empty `.git` directory is no longer one: `hasGitMarker` now requires what Git
// itself requires -- `HEAD` plus `objects/` or `commondir`. Measured 2026-08-23, a hollow `.git`
// holding only `info/exclude` on the developer's home directory made every non-Git directory beneath
// it look like a project, so commands run there initialised a workspace in the home directory. These
// fixtures previously asserted that a marker Git disowns is a project root; now they use real ones.
function makeRealGitRoot(dir) {
  const created = spawnSync('git', ['init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(created.status, 0, `git init failed in fixture ${dir}: ${created.stderr}`);
  // Warm the index once so a later read-only `git` call inside the CLI cannot be the first writer
  // to `.git/index` and perturb a byte-identity snapshot taken during setup.
  spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' });
}

function snapshotTree(root) {
  const entries = [];
  const visit = (relativePath = '') => {
    const directory = path.join(root, relativePath);
    for (const name of fs.readdirSync(directory).sort()) {
      const childRelativePath = path.join(relativePath, name);
      const childPath = path.join(root, childRelativePath);
      const stat = fs.lstatSync(childPath);
      if (stat.isDirectory()) {
        entries.push(`${childRelativePath}/`);
        visit(childRelativePath);
      } else {
        entries.push(`${childRelativePath}:${fs.readFileSync(childPath).toString('hex')}`);
      }
    }
  };
  visit();
  return entries;
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

describe('canonical Workspine state classification', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('S0 fresh and S1 current always name .work as active authority', async () => {
    const { resolveStateDir } = await loadModule(STATE_DIR_MODULE);
    assert.deepStrictEqual(classificationContract(resolveStateDir(tmp), tmp), {
      status: 'fresh',
      action: 'use_current',
      root: tmp,
      dir: path.join(tmp, '.work'),
      name: '.work',
      legacyDir: path.join(tmp, '.planning'),
    });

    fs.mkdirSync(path.join(tmp, '.work'));
    assert.deepStrictEqual(classificationContract(resolveStateDir(tmp), tmp), {
      status: 'current',
      action: 'use_current',
      root: tmp,
      dir: path.join(tmp, '.work'),
      name: '.work',
      legacyDir: path.join(tmp, '.planning'),
    });
  });

  test('S2-config-v1 recognizes only initVersion "v1.1" without selecting .planning', async () => {
      const { resolveStateDir } = await loadModule(STATE_DIR_MODULE);
      writeLegacyConfig(tmp, 'v1.1');
      const state = resolveStateDir(tmp);
      assert.deepStrictEqual(classificationContract(state, tmp), {
        status: 'legacy_migratable',
        action: 'migrate',
        root: tmp,
        dir: path.join(tmp, '.work'),
        name: '.work',
        legacyDir: path.join(tmp, '.planning'),
      });
      assert.strictEqual(state.signature, 'S2-config-v1');
      assert.strictEqual(state.detectedInitVersion, 'v1.1');
  });

  test('missing, malformed, non-object, and unknown-version legacy configs are unsupported', async () => {
    const { resolveStateDir } = await loadModule(STATE_DIR_MODULE);
    const cases = [
      ['missing_config', null],
      ['malformed_config', '{not json'],
      ['invalid_config_object', '[]'],
      ['unsupported_init_version', JSON.stringify({ initVersion: 1 })],
      ['unsupported_init_version', JSON.stringify({ initVersion: '1' })],
      ['unsupported_init_version', JSON.stringify({ initVersion: 2 })],
    ];
    for (const [reason, content] of cases) {
      fs.rmSync(path.join(tmp, '.planning'), { recursive: true, force: true });
      fs.mkdirSync(path.join(tmp, '.planning'));
      if (content !== null) fs.writeFileSync(path.join(tmp, '.planning', 'config.json'), content);
      const state = resolveStateDir(tmp);
      assert.strictEqual(state.status, 'legacy_unsupported');
      assert.strictEqual(state.action, 'refuse');
      assert.strictEqual(state.reason, reason);
      assert.strictEqual(state.dir, path.join(tmp, '.work'));
    }
  });

  test('receipt collisions and nonempty legacy decisions are unsupported, while an empty decisions dir is allowed', async () => {
    const { resolveStateDir } = await loadModule(STATE_DIR_MODULE);
    writeLegacyConfig(tmp);
    fs.writeFileSync(path.join(tmp, '.planning', 'migration-receipt.json'), '{}');
    let state = resolveStateDir(tmp);
    assert.strictEqual(state.status, 'legacy_unsupported');
    assert.strictEqual(state.reason, 'migration_receipt_exists');

    fs.rmSync(path.join(tmp, '.planning'), { recursive: true, force: true });
    writeLegacyConfig(tmp);
    fs.mkdirSync(path.join(tmp, '.planning', 'decisions'));
    state = resolveStateDir(tmp);
    assert.strictEqual(state.status, 'legacy_migratable');

    fs.writeFileSync(path.join(tmp, '.planning', 'decisions', 'legacy.md'), 'legacy decision');
    state = resolveStateDir(tmp);
    assert.strictEqual(state.status, 'legacy_unsupported');
    assert.strictEqual(state.reason, 'nonempty_legacy_decisions');
  });

  test('linked legacy roots and entries are refused without traversal', async (t) => {
    const { resolveStateDir } = await loadModule(STATE_DIR_MODULE);
    const outside = createTempProject();
    try {
      writeLegacyConfig(outside);
      try {
        fs.symlinkSync(path.join(outside, '.planning'), path.join(tmp, '.planning'), 'junction');
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlink creation unavailable');
        throw error;
      }
      let state = resolveStateDir(tmp);
      assert.strictEqual(state.status, 'legacy_unsupported');
      assert.strictEqual(state.reason, 'linked_legacy_root');

      fs.rmSync(path.join(tmp, '.planning'));
      writeLegacyConfig(tmp);
      fs.symlinkSync(outside, path.join(tmp, '.planning', 'linked-entry'), 'junction');
      state = resolveStateDir(tmp);
      assert.strictEqual(state.status, 'legacy_unsupported');
      assert.strictEqual(state.reason, 'linked_legacy_entry');
    } finally {
      cleanup(outside);
    }
  });

  test('every dual-root shape is a conflict and never receives legacy precedence', async () => {
    const { resolveStateDir } = await loadModule(STATE_DIR_MODULE);
    const shapes = [
      () => { fs.mkdirSync(path.join(tmp, '.work')); fs.mkdirSync(path.join(tmp, '.planning')); },
      () => { fs.mkdirSync(path.join(tmp, '.work')); writeLegacyConfig(tmp); },
      () => { fs.mkdirSync(path.join(tmp, '.work')); fs.writeFileSync(path.join(tmp, '.work', 'config.json'), '{}'); writeLegacyConfig(tmp); },
    ];
    for (const makeShape of shapes) {
      fs.rmSync(path.join(tmp, '.work'), { recursive: true, force: true });
      fs.rmSync(path.join(tmp, '.planning'), { recursive: true, force: true });
      makeShape();
      const state = resolveStateDir(tmp);
      assert.strictEqual(state.status, 'dual_conflict');
      assert.strictEqual(state.action, 'refuse');
      assert.strictEqual(state.dir, path.join(tmp, '.work'));
    }
  });

  test('shared authority gate emits the exact explicit migration command', async () => {
    const { resolveStateDir, stateAuthorityGate, MIGRATION_COMMAND } = await loadModule(STATE_DIR_MODULE);
    writeLegacyConfig(tmp);
    const gate = stateAuthorityGate(resolveStateDir(tmp));
    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(MIGRATION_COMMAND, 'npx -y workspine init --migrate');
    assert.match(gate.message, /Run `npx -y workspine init --migrate`\./);
  });
});

describe('workspace-root discovery', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  for (const markerKind of ['directory', 'absolute-file', 'relative-file']) {
    test(`nested fresh workspace anchors at a real .git ${markerKind}`, async () => {
      const { findWorkspaceRoot, resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
      const nested = path.join(tmp, 'packages', 'feature', 'deep');
      fs.mkdirSync(nested, { recursive: true });
      if (markerKind === 'directory') makeRealGitRoot(tmp);
      else {
        const target = path.join(tmp, 'git-metadata');
        // A real gitdir moved aside with `.git` left as a pointer file -- a layout Git supports,
        // and the shape a linked worktree uses. The previous fixture pointed at an empty
        // directory, which Git itself would refuse.
        makeRealGitRoot(tmp);
        fs.renameSync(path.join(tmp, '.git'), target);
        const pointer = markerKind === 'absolute-file' ? target : 'git-metadata';
        fs.writeFileSync(path.join(tmp, '.git'), `gitdir: ${pointer}\n`);
      }
      assert.strictEqual(findWorkspaceRoot(nested), tmp);
      const context = resolveWorkspaceContext([], { cwd: nested, env: {} });
      assert.strictEqual(context.workspaceRoot, tmp);
      assert.strictEqual(context.planningDir, path.join(tmp, '.work'));
      assert.strictEqual(context.state.status, 'fresh');
    });
  }

  test('stale gitfile refuses public next and init without changing the workspace bytes', async () => {
    const nested = path.join(tmp, 'packages', 'feature', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(tmp, '.git'), 'gitdir: missing-worktree-metadata\n');
    const before = snapshotTree(tmp);

    const next = await runCliAsMain(nested, ['next', '--json']);
    assert.notStrictEqual(next.exitCode, 0, next.output);
    assert.match(next.output, /Workspace markers could not be inspected/);
    assert.match(next.output, /Invalid \.git marker/);
    assert.deepStrictEqual(snapshotTree(tmp), before);

    const init = await runCliAsMain(nested, ['init', '--auto', '--tools', 'agents']);
    assert.notStrictEqual(init.exitCode, 0, init.output);
    assert.match(init.output, /Workspace markers could not be inspected/);
    assert.match(init.output, /Invalid \.git marker/);
    assert.deepStrictEqual(snapshotTree(tmp), before);
  });

  test('stale gitfile invalidates explicit resolver and public init before any write', async () => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const foreign = createTempProject();
    try {
      fs.writeFileSync(path.join(tmp, '.git'), 'gitdir: missing-worktree-metadata\n');
      const before = snapshotTree(tmp);
      const context = resolveWorkspaceContext(['--workspace-root', tmp], { cwd: foreign, env: {} });
      assert.strictEqual(context.invalid, true);
      assert.match(context.error, /Workspace markers could not be inspected/);
      assert.match(context.error, /Invalid \.git marker/);
      assert.deepStrictEqual(snapshotTree(tmp), before);

      const init = await runCliAsMain(foreign, ['init', '--workspace-root', tmp, '--auto', '--tools', 'agents']);
      assert.notStrictEqual(init.exitCode, 0, init.output);
      assert.match(init.output, /Workspace markers could not be inspected/);
      assert.match(init.output, /Invalid \.git marker/);
      assert.deepStrictEqual(snapshotTree(tmp), before);
    } finally {
      cleanup(foreign);
    }
  });

  test('unsafe gitfiles fail closed without selecting an ancestor or nested write root', async () => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const cases = [
      ['malformed', (root) => fs.writeFileSync(path.join(root, '.git'), 'not a gitdir declaration\n')],
      ['oversized', (root) => fs.writeFileSync(path.join(root, '.git'), 'x'.repeat(4097))],
      ['target-file', (root) => {
        fs.writeFileSync(path.join(root, 'git-metadata'), 'not a directory');
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: git-metadata\n');
      }],
      ['linked-marker', (root) => {
        const target = path.join(root, 'marker-target');
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(root, '.git'), 'junction');
      }],
      ['linked-target', (root) => {
        const target = path.join(root, 'git-metadata');
        const linkedTarget = path.join(root, 'linked-git-metadata');
        fs.mkdirSync(target);
        fs.symlinkSync(target, linkedTarget, 'junction');
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: linked-git-metadata\n');
      }],
    ];

    for (const [name, setup] of cases) {
      const root = path.join(tmp, name);
      const nested = path.join(root, 'packages', 'feature');
      fs.mkdirSync(nested, { recursive: true });
      setup(root);
      const context = resolveWorkspaceContext([], { cwd: nested, env: {} });
      assert.strictEqual(context.invalid, true, name);
      assert.match(context.error, /Workspace markers could not be inspected/, name);
      assert.strictEqual(fs.existsSync(path.join(root, '.work')), false, name);
      assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false, name);
    }
  });

  test('gitfile target inspection and reads fail closed when their filesystem seam errors', async () => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const nested = path.join(tmp, 'packages', 'feature');
    const target = path.join(tmp, 'git-metadata');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(tmp, '.git'), 'gitdir: git-metadata\n');

    const deniedTarget = resolveWorkspaceContext([], {
      cwd: nested,
      env: {},
      lstat: (candidate) => {
        if (path.resolve(candidate) === path.resolve(target)) throw new Error('injected target inspection denial');
        return fs.lstatSync(candidate);
      },
    });
    assert.strictEqual(deniedTarget.invalid, true);
    assert.match(deniedTarget.error, /injected target inspection denial/);

    const deniedRead = resolveWorkspaceContext([], {
      cwd: nested,
      env: {},
      readFile: () => { throw new Error('injected gitfile read denial'); },
    });
    assert.strictEqual(deniedRead.invalid, true);
    assert.match(deniedRead.error, /injected gitfile read denial/);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
  });

  test('an actual Git linked worktree remains a valid workspace root', async () => {
    const { findWorkspaceRoot, resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const seed = path.join(tmp, 'seed');
    const linked = path.join(tmp, 'linked');
    fs.mkdirSync(seed);
    runGit(seed, ['init', '--quiet']);
    runGit(seed, ['config', 'user.name', 'GSDD Test']);
    runGit(seed, ['config', 'user.email', 'gsdd-test@example.invalid']);
    fs.writeFileSync(path.join(seed, 'README.md'), 'seed\n');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '--quiet', '-m', 'seed']);
    runGit(seed, ['worktree', 'add', '--quiet', linked]);

    const nested = path.join(linked, 'packages', 'feature');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(fs.lstatSync(path.join(linked, '.git')).isFile(), true);
    assert.strictEqual(findWorkspaceRoot(nested), linked);
    assert.strictEqual(resolveWorkspaceContext([], { cwd: nested, env: {} }).workspaceRoot, linked);
  });

  test('explicit workspace override is authoritative even before initialization', async () => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const foreign = createTempProject();
    try {
      const context = resolveWorkspaceContext(['--workspace-root', tmp], { cwd: foreign, env: {} });
      assert.strictEqual(context.invalid, false);
      assert.strictEqual(context.workspaceRoot, tmp);
      assert.strictEqual(context.state.status, 'fresh');
    } finally {
      cleanup(foreign);
    }
  });

  test('explicit workspace override refuses a real directory through a symlinked parent', async (t) => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const outside = createTempProject();
    const target = path.join(outside, 'target');
    fs.mkdirSync(target);
    const linkedParent = path.join(tmp, 'linked-parent');
    try {
      fs.symlinkSync(outside, linkedParent, 'junction');
    } catch (error) {
      cleanup(outside);
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlink creation unavailable');
      throw error;
    }

    const before = snapshotTree(outside);
    const context = resolveWorkspaceContext(
      ['--workspace-root', path.join(linkedParent, 'target')],
      { cwd: tmp, env: {} }
    );

    assert.strictEqual(context.invalid, true);
    assert.match(context.error, /symlink|symbolic link|real directory/i);
    assert.deepStrictEqual(snapshotTree(outside), before,
      'a root reached through a symlinked parent must not become an admitted write target');
    cleanup(outside);
  });

  test('discovered workspace root refuses a symlinked root chain before selecting it', async (t) => {
    const { findWorkspaceRoot, resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const outside = createTempProject();
    makeRealGitRoot(outside);
    const linkedParent = path.join(tmp, 'linked-repo');
    try {
      fs.symlinkSync(outside, linkedParent, 'junction');
    } catch (error) {
      cleanup(outside);
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlink creation unavailable');
      throw error;
    }
    const nested = path.join(linkedParent, 'packages', 'feature');
    fs.mkdirSync(nested, { recursive: true });
    const before = snapshotTree(outside);

    assert.throws(
      () => findWorkspaceRoot(nested),
      /symlink|symbolic link/i,
      'discovery must not return a lexical path whose root chain leaves the invocation tree'
    );
    const context = resolveWorkspaceContext([], { cwd: nested, env: {} });
    assert.strictEqual(context.invalid, true);
    assert.match(context.error, /symlink|symbolic link/i);
    assert.deepStrictEqual(snapshotTree(outside), before,
      'a discovered symlinked root must not receive workspace writes');
    cleanup(outside);
  });

  test('ancestor marker inspection failures return an invalid context and never select a nested write root', async () => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const nested = path.join(tmp, 'packages', 'feature', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    const deniedMarker = path.join(tmp, '.git');
    const lstat = (candidate) => {
      if (path.resolve(candidate) === path.resolve(deniedMarker)) {
        const error = new Error('injected marker inspection denial');
        error.code = 'EACCES';
        throw error;
      }
      return fs.lstatSync(candidate);
    };

    const context = resolveWorkspaceContext([], { cwd: nested, env: {}, lstat });
    assert.strictEqual(context.invalid, true);
    assert.match(context.error, /Workspace markers could not be inspected/);
    assert.match(context.error, /injected marker inspection denial/);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
  });

  test('state marker inspection does not hide an unreadable legacy marker behind an existing .work root', async () => {
    const { resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
    const nested = path.join(tmp, 'packages', 'feature');
    fs.mkdirSync(path.join(tmp, '.work'));
    fs.mkdirSync(nested, { recursive: true });
    const deniedMarker = path.join(tmp, '.planning');
    const lstat = (candidate) => {
      if (path.resolve(candidate) === path.resolve(deniedMarker)) {
        const error = new Error('injected legacy marker inspection denial');
        error.code = 'EACCES';
        throw error;
      }
      return fs.lstatSync(candidate);
    };

    const context = resolveWorkspaceContext([], { cwd: nested, env: {}, lstat });
    assert.strictEqual(context.invalid, true);
    assert.match(context.error, /Workspace markers could not be inspected/);
    assert.match(context.error, /injected legacy marker inspection denial/);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
  });

  test('nested init writes at the fresh Git root, never the package subdirectory', async () => {
    makeRealGitRoot(tmp);
    const nested = path.join(tmp, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    const result = await runCliAsMain(nested, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work', 'config.json')), true);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
    assert.strictEqual(fs.existsSync(path.join(nested, '.planning')), false);
  });
});
