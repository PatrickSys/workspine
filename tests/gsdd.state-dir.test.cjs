const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
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
    assert.strictEqual(MIGRATION_COMMAND, 'npx -y gsdd-cli init --migrate');
    assert.match(gate.message, /Run `npx -y gsdd-cli init --migrate`\./);
  });
});

describe('workspace-root discovery', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  for (const markerKind of ['directory', 'file']) {
    test(`nested fresh workspace anchors at a real .git ${markerKind}`, async () => {
      const { findWorkspaceRoot, resolveWorkspaceContext } = await loadModule(WORKSPACE_ROOT_MODULE);
      const nested = path.join(tmp, 'packages', 'feature', 'deep');
      fs.mkdirSync(nested, { recursive: true });
      if (markerKind === 'directory') fs.mkdirSync(path.join(tmp, '.git'));
      else fs.writeFileSync(path.join(tmp, '.git'), 'gitdir: C:/example/worktrees/test\n');
      assert.strictEqual(findWorkspaceRoot(nested), tmp);
      const context = resolveWorkspaceContext([], { cwd: nested, env: {} });
      assert.strictEqual(context.workspaceRoot, tmp);
      assert.strictEqual(context.planningDir, path.join(tmp, '.work'));
      assert.strictEqual(context.state.status, 'fresh');
    });
  }

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
    fs.mkdirSync(path.join(tmp, '.git'));
    const nested = path.join(tmp, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    const result = await runCliAsMain(nested, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work', 'config.json')), true);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
    assert.strictEqual(fs.existsSync(path.join(nested, '.planning')), false);
  });
});
