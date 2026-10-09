const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
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

  test('explicit adoption quarantines all historic GSD bytes and produces a verified read-only receipt', async () => {
    const { adoptLegacyState, digestLegacyTree } = await loadMigration();
    const legacy = path.join(tmp, '.planning');
    fs.mkdirSync(path.join(legacy, 'phases', '01-first'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'SPEC.md'), '# Historic Spec\n');
    fs.writeFileSync(path.join(legacy, 'ROADMAP.md'), '# Historic Roadmap\n');
    fs.writeFileSync(path.join(legacy, 'phases', '01-first', '01-PLAN.md'), Buffer.from([0, 1, 2, 255]));
    const before = snapshot(legacy);
    const digest = digestLegacyTree(legacy);
    const result = adoptLegacyState(tmp, { now: new Date('2026-10-09T02:00:00.000Z') });
    const archive = path.join(tmp, '.work', '.local', 'legacy-planning');
    assert.strictEqual(fs.existsSync(legacy), false);
    assert.deepStrictEqual(snapshot(archive), before);
    assert.strictEqual(result.receipt.signature, 'GSD-roadmap-v1');
    assert.strictEqual(result.receipt.pre_adoption_tree_sha256, digest.sha256);
    assert.strictEqual(result.receipt.pre_adoption_entry_count, digest.entryCount);
    assert.strictEqual(result.receipt.source, '.planning');
    assert.strictEqual(result.receipt.archive, '.work/.local/legacy-planning');
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work', 'migration-receipt.json')), false);
    assert.match(fs.readFileSync(path.join(tmp, '.work', '.local', '.gitignore'), 'utf8'), /\*/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(tmp, '.work', 'adoption-receipt.json'), 'utf8')), result.receipt);
    assert.strictEqual(spawnSync('git', ['init', '--quiet'], { cwd: tmp }).status, 0);
    const ignored = spawnSync('git', ['check-ignore', '-q', '.work/.local/legacy-planning/SPEC.md'], { cwd: tmp });
    assert.strictEqual(ignored.status, 0, 'historic private sources must remain ignored even before full init');
  });

  test('adoption receipt failure restores original legacy bytes and leaves no active work root', async () => {
    const { adoptLegacyState } = await loadMigration();
    const legacy = path.join(tmp, '.planning');
    fs.mkdirSync(path.join(legacy, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'SPEC.md'), '# Historic Spec\n');
    fs.writeFileSync(path.join(legacy, 'ROADMAP.md'), '# Historic Roadmap\n');
    const before = snapshot(legacy);
    assert.throws(() => adoptLegacyState(tmp, {
      writeReceipt() { throw new Error('injected adoption receipt failure'); },
    }), /injected adoption receipt failure/);
    assert.deepStrictEqual(snapshot(legacy), before);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
  });

  test('adoption final rename failure restores the original tree and refuses partial authority', async () => {
    const { adoptLegacyState } = await loadMigration();
    const legacy = path.join(tmp, '.planning');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'SPEC.md'), '# Historic Spec\n');
    fs.writeFileSync(path.join(legacy, 'ROADMAP.md'), '# Historic Roadmap\n');
    const before = snapshot(legacy);
    let renames = 0;
    assert.throws(() => adoptLegacyState(tmp, {
      rename(from, to) {
        renames += 1;
        if (renames === 2) throw new Error('injected final rename failure');
        fs.renameSync(from, to);
      },
    }), /injected final rename failure/);
    assert.strictEqual(renames, 3, 'one move, one failed activation and one source restoration');
    assert.deepStrictEqual(snapshot(legacy), before);
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
    assert.deepStrictEqual(fs.readdirSync(tmp), ['.planning']);
  });

  test('adoption detects a source edit between classification and receipt and restores modified bytes', async () => {
    const { adoptLegacyState } = await loadMigration();
    const legacy = path.join(tmp, '.planning');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'SPEC.md'), '# Historic Spec\n');
    fs.writeFileSync(path.join(legacy, 'ROADMAP.md'), '# Historic Roadmap\n');
    let moved = false;
    assert.throws(() => adoptLegacyState(tmp, {
      rename(from, to) {
        fs.renameSync(from, to);
        if (!moved) {
          moved = true;
          fs.writeFileSync(path.join(to, 'SPEC.md'), '# Owner edited during move\n');
        }
      },
    }), /changed during adoption/);
    assert.strictEqual(fs.readFileSync(path.join(legacy, 'SPEC.md'), 'utf8'), '# Owner edited during move\n');
    assert.strictEqual(fs.existsSync(path.join(tmp, '.work')), false);
    assert.deepStrictEqual(fs.readdirSync(tmp), ['.planning']);
  });
});
