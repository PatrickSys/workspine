const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTempProject, cleanup } = require('./gsdd.helpers.cjs');

const MODULE = path.join(__dirname, '..', 'bin', 'lib', 'state-migration.mjs');

async function loadMigration() {
  return import(`${pathToFileURL(MODULE).href}?t=${Date.now()}-${Math.random()}`);
}

function writeLegacyTree(root) {
  const legacy = path.join(root, '.planning');
  fs.mkdirSync(path.join(legacy, 'nested', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ initVersion: 'v1.1', keep: true }));
  fs.writeFileSync(path.join(legacy, 'nested', 'bytes.bin'), Buffer.from([0, 1, 2, 13, 10, 255]));
  return legacy;
}

function snapshot(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = path.join(relative, entry.name);
      return entry.isDirectory()
        ? [{ path: `${child.replace(/\\/g, '/')}/`, type: 'directory' }, ...snapshot(root, child)]
        : [{ path: child.replace(/\\/g, '/'), type: 'file', bytes: fs.readFileSync(path.join(root, child)).toString('base64') }];
    });
}

describe('same-parent legacy state migration', () => {
  let tmp;
  beforeEach(() => { tmp = createTempProject(); });
  afterEach(() => { cleanup(tmp); });

  test('rename preserves every pre-existing path and byte and writes the deterministic receipt', async () => {
    const { migrateLegacyState, digestLegacyTree } = await loadMigration();
    const legacy = writeLegacyTree(tmp);
    const before = snapshot(legacy);
    const digest = digestLegacyTree(legacy);
    const now = new Date('2026-08-11T10:11:12.000Z');

    const result = migrateLegacyState(tmp, { now });
    const work = path.join(tmp, '.work');
    assert.strictEqual(fs.existsSync(legacy), false);
    assert.deepStrictEqual(snapshot(work).filter((entry) => entry.path !== 'migration-receipt.json'), before);
    assert.deepStrictEqual(result.receipt, JSON.parse(fs.readFileSync(path.join(work, 'migration-receipt.json'), 'utf8')));
    assert.deepStrictEqual(result.receipt, {
      schema_version: 1,
      signature: 'S2-config-v1',
      source: '.planning',
      destination: '.work',
      detected_init_version: 'v1.1',
      pre_migration_entry_count: digest.entryCount,
      pre_migration_tree_sha256: digest.sha256,
      migrated_at: now.toISOString(),
      method: 'same-parent-rename',
    });
  });

  test('receipt failure rolls the rename back before any later write', async () => {
    const { migrateLegacyState } = await loadMigration();
    const legacy = writeLegacyTree(tmp);
    const before = snapshot(legacy);
    assert.throws(() => migrateLegacyState(tmp, {
      writeReceipt() {
        throw new Error('injected receipt failure');
      },
    }), /injected receipt failure/);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
    assert.deepStrictEqual(snapshot(legacy), before);
  });

  test('migration delegates temporary cleanup to the atomic writer and never unlinks the receipt destination', () => {
    const source = fs.readFileSync(MODULE, 'utf8');
    assert.doesNotMatch(source, /unlinkSync|unlinkFile|rmSync\([^\n]*migration-receipt/);
  });

  test('rename failure leaves the supported legacy tree untouched', async () => {
    const { migrateLegacyState } = await loadMigration();
    const legacy = writeLegacyTree(tmp);
    const before = snapshot(legacy);
    assert.throws(() => migrateLegacyState(tmp, {
      rename() { throw new Error('injected rename failure'); },
    }), /injected rename failure/);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
    assert.deepStrictEqual(snapshot(legacy), before);
  });
});
