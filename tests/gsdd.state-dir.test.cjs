/**
 * Workspine state-directory resolution + .planning -> .work migration.
 * Single-folder rule: .work is canonical; legacy .planning is still read
 * (dual-read) with a one-line notice; .work wins ties; new repo defaults to .work.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTempProject, cleanup, runCliAsMain } = require('./gsdd.helpers.cjs');

const STATE_DIR_MODULE = path.join(__dirname, '..', 'bin', 'lib', 'state-dir.mjs');
async function loadStateDir() {
  return import(`${pathToFileURL(STATE_DIR_MODULE).href}?t=${Date.now()}-${Math.random()}`);
}
function writeConfig(root, dirName) {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ initVersion: 1 }));
}

describe('state-dir resolution (.planning -> .work migration)', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('.planning-only repo reads legacy .planning and reports a migration notice', async () => {
    const { resolveStateDir, hasStateMarker } = await loadStateDir();
    writeConfig(tmp, '.planning');
    const r = resolveStateDir(tmp);
    assert.strictEqual(r.name, '.planning');
    assert.strictEqual(r.dir, path.join(tmp, '.planning'));
    assert.strictEqual(r.legacy, true);
    assert.ok(typeof r.migrationNotice === 'string' && r.migrationNotice.length > 0);
    assert.strictEqual(hasStateMarker(tmp), true);
  });

  test('.work-only repo reads .work with no migration notice', async () => {
    const { resolveStateDir, hasStateMarker } = await loadStateDir();
    writeConfig(tmp, '.work');
    const r = resolveStateDir(tmp);
    assert.strictEqual(r.name, '.work');
    assert.strictEqual(r.dir, path.join(tmp, '.work'));
    assert.strictEqual(r.legacy, false);
    assert.strictEqual(r.migrationNotice, null);
    assert.strictEqual(hasStateMarker(tmp), true);
  });

  test('both present: .work wins, no migration notice', async () => {
    const { resolveStateDir } = await loadStateDir();
    writeConfig(tmp, '.planning');
    writeConfig(tmp, '.work');
    const r = resolveStateDir(tmp);
    assert.strictEqual(r.name, '.work');
    assert.strictEqual(r.legacy, false);
    assert.strictEqual(r.migrationNotice, null);
  });

  test('brand-new repo (neither folder) defaults to .work', async () => {
    const { resolveStateDir, hasStateMarker } = await loadStateDir();
    const r = resolveStateDir(tmp);
    assert.strictEqual(r.name, '.work');
    assert.strictEqual(r.dir, path.join(tmp, '.work'));
    assert.strictEqual(r.legacy, false);
    assert.strictEqual(hasStateMarker(tmp), false);
  });

  test('inspectWorkContext reads a legacy .planning workspace and carries the notice', async () => {
    const wcUrl = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
    const wc = await import(`${wcUrl}?t=${Date.now()}-${Math.random()}`);
    fs.mkdirSync(path.join(tmp, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'config.json'), JSON.stringify({ initVersion: 1 }));
    const ctx = wc.inspectWorkContext(tmp);
    assert.strictEqual(ctx.planning.state_dir_name, '.planning');
    assert.ok(typeof ctx.migration_notice === 'string' && ctx.migration_notice.length > 0);
  });
});
