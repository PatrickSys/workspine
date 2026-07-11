/**
 * Workspine active milestone directory resolution tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { cleanup, createTempProject } = require('./gsdd.helpers.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

function writeFile(relativePath, content) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function workDir() {
  return path.join(tmpDir, '.work');
}

function milestonePath(slug) {
  return path.join(workDir(), 'milestones', slug);
}

async function importWorkContextModule() {
  const modulePath = path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);
}

describe('active Workspine milestone directory resolution', () => {
  test('uses the plural in-progress milestone when one exists', async () => {
    writeFile('.work/milestones/m1-active/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), milestonePath('m1-active'));
  });

  test('uses lexicographic-last in-progress milestone when several exist', async () => {
    writeFile('.work/milestones/m0-a/MILESTONE.md', 'status: in_progress\n');
    writeFile('.work/milestones/m1-b/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), milestonePath('m1-b'));
  });

  test('uses lexicographic-last plural candidate when none are in progress', async () => {
    writeFile('.work/milestones/m0-a/MILESTONE.md', 'status: draft\n');
    writeFile('.work/milestones/m1-b/MILESTONE.md', '# Milestone\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), milestonePath('m1-b'));
  });

  test('falls back to the legacy path when the plural directory is empty', async () => {
    fs.mkdirSync(path.join(workDir(), 'milestones'), { recursive: true });
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), path.join(workDir(), 'milestone'));
  });

  test('skips an unreadable plural candidate and uses another valid in-progress milestone', async () => {
    fs.mkdirSync(path.join(milestonePath('m0-unreadable'), 'MILESTONE.md'), { recursive: true });
    writeFile('.work/milestones/m1-valid/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();
    let resolved;

    assert.doesNotThrow(() => {
      resolved = mod.resolveActiveMilestoneDir(workDir());
    });
    assert.strictEqual(resolved, milestonePath('m1-valid'));
  });

  test('falls back to legacy singular milestone directory when plural is absent', async () => {
    writeFile('.work/milestone/MILESTONE.md', 'status: active\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), path.join(workDir(), 'milestone'));
  });

  test('defaults to legacy singular path when neither layout exists and reports missing milestone', async () => {
    fs.mkdirSync(workDir(), { recursive: true });
    const mod = await importWorkContextModule();
    const expected = path.join(workDir(), 'milestone');

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), expected);
    assert.strictEqual(mod.inspectWorkMilestone(workDir()).exists, false);
  });

  test('inspectWorkMilestone reports roadmap data from the resolved plural milestone', async () => {
    writeFile('.work/milestones/m1-tighten-workflows/MILESTONE.md', 'status: in_progress\n');
    writeFile('.work/milestones/m1-tighten-workflows/ROADMAP.md', [
      '# Roadmap',
      '',
      '- [x] **Phase 1: Bootstrap** - done',
      '',
    ].join('\n'));
    const mod = await importWorkContextModule();

    const milestone = mod.inspectWorkMilestone(workDir());
    assert.strictEqual(milestone.has_roadmap, true);
    assert.strictEqual(milestone.roadmap_phase_count, 1);
    assert.strictEqual(milestone.dir, milestonePath('m1-tighten-workflows'));
  });
});
