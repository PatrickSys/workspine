/**
 * Workspine active milestone directory resolution tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { cleanup, createTempProject, runCliAsMain, withEnv } = require('./gsdd.helpers.cjs');

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

  test('refuses unscoped authority when several milestones are in progress', async () => {
    writeFile('.work/milestones/m0-a/MILESTONE.md', 'status: in_progress\n');
    writeFile('.work/milestones/m1-b/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();

    assert.throws(() => mod.resolveActiveMilestoneDir(workDir()), {
      code: 'multiple_active_milestones',
      choices: ['.work/milestones/m0-a', '.work/milestones/m1-b'],
    });
  });

  test('an exact emitted native phase can select one deliberately parallel active milestone', async () => {
    writeFile('.work/milestones/m0-a/MILESTONE.md', 'status: in_progress\n');
    writeFile('.work/milestones/m1-b/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir(), { phaseSelector: 'milestones/m0-a/phases/01-task' }), milestonePath('m0-a'));
    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir(), { planSelector: 'milestones/m1-b/phases/01-task/01-PLAN.md' }), milestonePath('m1-b'));
  });

  test('an exact root ROADMAP identity bypasses ambiguous native milestones', async () => {
    writeFile('.work/milestones/m0-a/MILESTONE.md', 'status: in_progress\n');
    writeFile('.work/milestones/m1-b/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir(), { phaseSelector: 'ROADMAP.md#phase-11' }), path.join(workDir(), 'milestone'));
  });

  test('different emitted phase and PLAN identities cannot select different milestones', async () => {
    writeFile('.work/milestones/m0-a/MILESTONE.md', 'status: in_progress\n');
    writeFile('.work/milestones/m1-b/MILESTONE.md', 'status: in_progress\n');
    const mod = await importWorkContextModule();

    assert.throws(() => mod.resolveActiveMilestoneDir(workDir(), {
      phaseSelector: 'milestones/m0-a/phases/01-task',
      planSelector: 'milestones/m1-b/phases/01-task/01-PLAN.md',
    }), { code: 'conflicting_milestone_selectors' });
  });

  test('an archived milestone cannot look active from historical body status prose', async () => {
    writeFile('.work/milestones/m0-live/MILESTONE.md', '---\nstatus: in_progress\n---\n# Live\n');
    writeFile('.work/milestones/m1-archived/MILESTONE.md', '---\nstatus: archived\n---\n# Old\nstatus: in_progress\n');
    const mod = await importWorkContextModule();

    assert.strictEqual(mod.resolveActiveMilestoneDir(workDir()), milestonePath('m0-live'));
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

  test('preserves bare root Phase 11 when parallel active native milestones contain only Phase 1', async () => {
    writeFile('.work/ROADMAP.md', '# Root\n- [ ] **Phase 11: Distinct root phase**\n');
    writeFile('.work/phases/11-root/11-PLAN.md', '---\nphase: 11\nstatus: approved\n---\n# Root plan\n');
    for (const slug of ['m0-a', 'm1-b']) {
      writeFile(`.work/milestones/${slug}/MILESTONE.md`, '---\nstatus: in_progress\n---\n');
      writeFile(`.work/milestones/${slug}/ROADMAP.md`, `# ${slug}\n- [ ] **Phase 1: Owned**\n`);
      writeFile(`.work/milestones/${slug}/phases/01-owned/01-PLAN.md`, '---\nphase: 1\nstatus: approved\n---\n');
    }
    const siblingBefore = ['m0-a', 'm1-b'].map((slug) => fs.readFileSync(path.join(milestonePath(slug), 'ROADMAP.md'), 'utf8'));
    const result = await withEnv({ WORKSPINE_UPDATE_AWARENESS: '0' }, () => runCliAsMain(tmpDir, ['phase-status', '11', 'in_progress']));
    assert.strictEqual(result.exitCode, 0, result.output);
    const packet = JSON.parse(result.stdout);
    assert.strictEqual(packet.identity, 'phases/11-root');
    assert.strictEqual(packet.roadmap, '.work/ROADMAP.md');
    assert.match(fs.readFileSync(path.join(workDir(), 'ROADMAP.md'), 'utf8'), /\[-\] \*\*Phase 11/);
    assert.deepStrictEqual(['m0-a', 'm1-b'].map((slug) => fs.readFileSync(path.join(milestonePath(slug), 'ROADMAP.md'), 'utf8')), siblingBefore);
  });

  test('preserves native and root resume --plan identities across two active milestones', async () => {
    writeFile('.work/ROADMAP.md', '# Root\n- [ ] **Phase 11: Root work**\n');
    writeFile('.work/phases/11-root/11-PLAN.md', '---\nphase: 11\nstatus: approved\n---\n');
    for (const slug of ['m0-a', 'm1-b']) {
      writeFile(`.work/milestones/${slug}/MILESTONE.md`, '---\nstatus: in_progress\n---\n');
      writeFile(`.work/milestones/${slug}/ROADMAP.md`, `# ${slug}\n- [ ] **Phase 1: Owned**\n`);
      writeFile(`.work/milestones/${slug}/phases/01-owned/01-PLAN.md`, '---\nphase: 1\nstatus: approved\n---\n');
    }
    writeFile('.work/.continue-here.md', [
      '---', 'workflow: phase', 'phase: 01-owned', 'timestamp: 2026-10-09T06:00:00Z', 'runtime: other', '---',
      '<current_state>Bounded interruption.</current_state>', '<completed_work>Read-only stage.</completed_work>',
      '<remaining_work>Continue owner-selected PLAN.</remaining_work>', '<decisions>Preserve existing approvals.</decisions>',
      '<blockers>None.</blockers>', '<next_action>Resume the named PLAN.</next_action>', '',
    ].join('\n'));
    for (const selected of [
      'milestones/m1-b/phases/01-owned/01-PLAN.md',
      'phases/11-root/11-PLAN.md',
    ]) {
      const result = await withEnv({ WORKSPINE_UPDATE_AWARENESS: '0' }, () => runCliAsMain(tmpDir, ['lifecycle-preflight', 'resume', '--plan', selected]));
      assert.strictEqual(result.exitCode, 0, result.output);
      const packet = JSON.parse(result.stdout);
      assert.strictEqual(packet.allowed, true, result.output);
      assert.strictEqual(packet.plan, selected);
    }
  });
});
