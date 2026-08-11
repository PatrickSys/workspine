const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { cleanup, createTempProject, runCliAsMain } = require('./gsdd.helpers.cjs');

let tmpDir;
const WORK_CONTEXT_URL = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
const DECISION_STORE = import(WORK_CONTEXT_URL);

beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

function writeFile(relativePath, content) {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeMilestone(name, status, phases) {
  writeFile(`.work/milestones/${name}/MILESTONE.md`, `---\nstatus: ${status}\n---\n`);
  for (const [dir, plan] of Object.entries(phases)) {
    writeFile(`.work/milestones/${name}/phases/${dir}/PLAN.md`, plan);
  }
}

function humanDecision(value) {
  return value.length > 60 ? `${value.slice(0, 60)}...` : value;
}

async function writeDecision(decision, overrides = {}, now = new Date(), stateDirName = '.work') {
  const { writeDecisionRecord } = await DECISION_STORE;
  return writeDecisionRecord(path.join(tmpDir, stateDirName), {
    id: null,
    type: 'rule',
    status: 'active',
    scope: 'repo',
    decision,
    why: `${decision} is a standing constraint.`,
    for: 'repo:current',
    body: `Evidence for ${decision}.`,
    ...overrides,
  }, { now, repoRoot: tmpDir });
}

describe('gsdd journey', () => {
  test('renders milestone bars, active phases, and unknown malformed plans', async () => {
    writeMilestone('m0-foundation', 'done', {
      '01-base': '---\nstatus: shipped\n---\n',
      '02-docs': '---\nstatus: planned\n---\n',
    });
    writeMilestone('m1-delivery', 'in_progress', {
      '03-running': '---\nstatus: executing\n---\n',
      '04-blocked': '---\nstatus: blocked\n---\n',
      '05-malformed': 'not frontmatter\n',
      '06-shipped': '---\nstatus: shipped\n---\n',
    });

    const result = await runCliAsMain(tmpDir, ['journey']);
    assert.strictEqual(result.exitCode, 0);
    assert.match(result.output, /m0-foundation\s+\[#####_____\]\s+done/);
    assert.match(result.output, /m1-delivery\s+\[###_______\]\s+in_progress\s+<- you are here/);
    assert.match(result.output, /phase 03 running\s+\[>] executing/);
    assert.match(result.output, /phase 04 blocked\s+\[!] blocked/);
    assert.match(result.output, /phase 05 malformed\s+\[\?\] unknown/);
    assert.match(result.output, /phase 06 shipped\s+\[x] shipped/);
  });

  test('renders superseded plans as historical and excludes them from progress', async () => {
    writeMilestone('m1-delivery', 'in_progress', {
      '01-shipped': '---\nstatus: shipped\n---\n',
      '02-planned': '---\nstatus: planned\n---\n',
      '03-historical': '---\nstatus: superseded\n---\n',
    });

    const result = await runCliAsMain(tmpDir, ['journey']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /m1-delivery\s+\[#####_____]\s+in_progress/);
    assert.match(result.output, /phase 03 historical\s+\[~] superseded \(historical\)/);
  });

  test('keeps the existing journey JSON phase shape for superseded plans', async () => {
    writeMilestone('m1-delivery', 'in_progress', {
      '03-historical': '---\nstatus: superseded\n---\n',
    });

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const json = JSON.parse(result.output);
    assert.deepStrictEqual(json.milestones[0].phases, [
      { dir: '03-historical', status: 'superseded', identity: 'milestones/m1-delivery/phases/03-historical', plan: 'milestones/m1-delivery/phases/03-historical/PLAN.md' },
    ]);
  });

  test('fails loud for opened but malformed PLAN frontmatter', async () => {
    writeMilestone('m1-delivery', 'in_progress', {
      '03-historical': '---\nstatus: superseded\n',
    });

    await assert.rejects(
      () => runCliAsMain(tmpDir, ['journey', '--json']),
      /PLAN frontmatter starts with --- but is not closed/
    );
  });

  test('keeps root ROADMAP lifecycle truth over a same-token superseded PLAN', async () => {
    writeMilestone('m1-delivery', 'in_progress', {
      '06-stale-history': '---\nstatus: superseded\n---\n',
    });
    writeFile('.work/ROADMAP.md', [
      '# Roadmap',
      '',
      '- [x] **Phase 6: Truth reconciliation**',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const json = JSON.parse(result.output);
    assert.deepStrictEqual(json.milestones[0].phases, [
      { dir: '06-truth-reconciliation', status: 'done' },
    ]);
  });

  test('prints a friendly zero-milestone message', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });
    const result = await runCliAsMain(tmpDir, ['journey']);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.output, 'No milestones found. Run `gsdd init` to start your workspace journey.');
  });

  test('emits the machine-readable journey shape', async () => {
    writeMilestone('m0-foundation', 'done', {
      '01-base': '---\nstatus: shipped\n---\n',
      '02-docs': '---\nstatus: planned\n---\n',
    });
    writeMilestone('m1-delivery', 'in_progress', {
      '03-running': '---\nstatus: executing\n---\n',
      '04-malformed': 'broken plan\n',
    });

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0);
    const json = JSON.parse(result.output);
    assert.deepStrictEqual(Object.keys(json).sort(), ['decisions', 'milestones', 'recent']);
    assert.strictEqual(json.milestones.length, 2);
    assert.deepStrictEqual(json.milestones.map((milestone) => milestone.phases.length), [2, 2]);
    assert.deepStrictEqual(json.milestones[1].phases, [
      { dir: '03-running', status: 'executing', identity: 'milestones/m1-delivery/phases/03-running', plan: 'milestones/m1-delivery/phases/03-running/PLAN.md' },
      { dir: '04-malformed', status: 'unknown', identity: 'milestones/m1-delivery/phases/04-malformed', plan: 'milestones/m1-delivery/phases/04-malformed/PLAN.md' },
    ]);
    assert.strictEqual(json.milestones[0].active, false);
    assert.strictEqual(json.milestones[1].active, true);
    assert.deepStrictEqual(json.recent, { commits48h: 0, latest: null });
    assert.strictEqual(json.decisions, null);
  });

  test('keeps root roadmap truth separate from native milestones while preserving unique history', async () => {
    writeMilestone('m0-foundation', 'done', {
      '01-base': '---\nstatus: shipped\n---\n',
      '06-inactive-history': '---\nstatus: planned\n---\n',
    });
    writeMilestone('m1-delivery', 'in_progress', {
      '00-history': '---\nstatus: shipped\n---\n',
      '06-stale-status': '---\nstatus: planned\n---\n',
      '09-unmatched-history': '---\nstatus: blocked\n---\n',
      'legacy-note': '---\nstatus: planned\n---\n',
    });
    writeFile('.work/ROADMAP.md', [
      '# Roadmap',
      '',
      '- [x] **Phase 6: Truth reconciliation**',
      '- [x] **Phase 7: Decision delivery**',
      '- [ ] **Phase 8: Execute discipline**',
      '',
    ].join('\n'));

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const json = JSON.parse(result.output);
    assert.deepStrictEqual(json.milestones[0].phases, [
      { dir: '06-truth-reconciliation', status: 'done' },
      { dir: '07-decision-delivery', status: 'done' },
      { dir: '08-execute-discipline', status: 'not_started' },
    ]);
    assert.strictEqual(json.milestones[0].name, 'roadmap');
    assert.strictEqual(json.milestones[0].active, true);
    assert.deepStrictEqual(json.milestones[1].phases, [
      { dir: '01-base', status: 'shipped', identity: 'milestones/m0-foundation/phases/01-base', plan: 'milestones/m0-foundation/phases/01-base/PLAN.md' },
      { dir: '06-inactive-history', status: 'planned', identity: 'milestones/m0-foundation/phases/06-inactive-history', plan: 'milestones/m0-foundation/phases/06-inactive-history/PLAN.md' },
    ]);
    assert.deepStrictEqual(json.milestones[2].phases, [
      { dir: '00-history', status: 'shipped', identity: 'milestones/m1-delivery/phases/00-history', plan: 'milestones/m1-delivery/phases/00-history/PLAN.md' },
      { dir: '06-stale-status', status: 'planned', identity: 'milestones/m1-delivery/phases/06-stale-status', plan: 'milestones/m1-delivery/phases/06-stale-status/PLAN.md' },
      { dir: '09-unmatched-history', status: 'blocked', identity: 'milestones/m1-delivery/phases/09-unmatched-history', plan: 'milestones/m1-delivery/phases/09-unmatched-history/PLAN.md' },
      { dir: 'legacy-note', status: 'planned' },
    ]);
  });

  test('renders a root ROADMAP as a usable journey without inventing a milestone', async () => {
    writeFile('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 1: Start here**\n');

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const json = JSON.parse(result.output);
    assert.deepStrictEqual(json.milestones, [{
      name: 'roadmap',
      status: 'in_progress',
      phases: [{ dir: '01-start-here', status: 'in_progress' }],
      active: true,
    }]);
  });

  test('exposes exact standard plan identities and same-token choices without merging authority', async () => {
    writeFile('.work/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 11: Identity**\n');
    writeFile('.work/phases/11-first/11-1-PLAN.md', '# plan\n');
    writeFile('.work/phases/11-second/11-2-PLAN.md', '# plan\n');

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const phase = JSON.parse(result.output).milestones[0].phases[0];
    assert.deepStrictEqual(phase.choices, ['phases/11-first', 'phases/11-second']);
    assert.strictEqual(phase.identity, undefined);
  });

  test('uses the shared native inventory for named PLAN packets and exposes exact plan paths', async () => {
    writeFile('.work/milestone/MILESTONE.md', '---\nstatus: in_progress\n---\n');
    writeFile('.work/milestone/phases/07-native/7-PLAN.md', '---\nstatus: planned\n---\n');
    writeFile('.work/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 7: Root plan**\n');
    writeFile('.work/phases/07-root/7-PLAN.md', '# plan\n');

    const result = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const json = JSON.parse(result.output);
    const root = json.milestones.find((milestone) => milestone.name === 'roadmap');
    const native = json.milestones.find((milestone) => milestone.name === 'milestone');
    assert.deepStrictEqual(root.phases[0].plans, ['phases/07-root/7-PLAN.md']);
    assert.deepStrictEqual(native.phases, [{
      dir: '07-native',
      status: 'planned',
      identity: 'milestone/phases/07-native',
      plan: 'milestone/phases/07-native/7-PLAN.md',
    }]);
  });

  test('surfaces root roadmap read failures instead of returning nested fallback JSON', async () => {
    writeMilestone('m1-delivery', 'in_progress', {
      '00-history': '---\nstatus: shipped\n---\n',
    });
    fs.mkdirSync(path.join(tmpDir, '.work', 'ROADMAP.md'), { recursive: true });

    await assert.rejects(
      () => runCliAsMain(tmpDir, ['journey', '--json']),
      (error) => {
        assert.match(`${error?.code || ''} ${error?.message || ''} ${String(error)}`, /EISDIR|directory|ROADMAP/i);
        return true;
      }
    );
  });

  test('renders decision counts and a truncated latest choice', async () => {
    writeMilestone('m0-foundation', 'in_progress', {});
    await writeDecision('Keep the current architecture', {}, new Date('2026-07-11T09:00:00.000Z'));
    await writeDecision('Await explicit user confirmation', { status: 'candidate' }, new Date('2026-07-11T10:00:00.000Z'));
    await writeDecision('Do not repeat the failed shortcut', { status: 'invalidated' }, new Date('2026-07-11T11:00:00.000Z'));
    const base = await writeDecision('Use the old implementation', {}, new Date('2026-07-11T12:00:00.000Z'));
    await writeDecision('Replace the old implementation', { supersedes: base.id }, new Date('2026-07-11T13:00:00.000Z'));
    const latest = 'Reviewers and verifiers must re-run an executor\'s proof before calling the work complete and trusted';
    await writeDecision(latest, {}, new Date('2026-07-11T14:00:00.000Z'));

    const result = await runCliAsMain(tmpDir, ['journey']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /decisions: 3 active \. 1 candidate \(awaiting promote\) \. 1 invalidated \(mistakes recorded\) \. 1 superseded/);
    assert.match(result.output, new RegExp(`latest: "${humanDecision(latest)}"`));

    const jsonResult = await runCliAsMain(tmpDir, ['journey', '--json']);
    assert.strictEqual(jsonResult.exitCode, 0, jsonResult.output);
    const json = JSON.parse(jsonResult.output);
    assert.deepStrictEqual(json.decisions, {
      active: 3,
      candidate: 1,
      invalidated: 1,
      superseded: 1,
      latest,
    });
  });

  test('refuses dual lifecycle roots without changing either authority', async () => {
    writeFile('.planning/config.json', JSON.stringify({ initVersion: 'v1.1' }));
    writeFile('.planning/legacy.bin', Buffer.from([0, 255]));
    writeFile('.work/current.bin', Buffer.from([255, 0]));
    const legacy = fs.readFileSync(path.join(tmpDir, '.planning', 'legacy.bin'));
    const current = fs.readFileSync(path.join(tmpDir, '.work', 'current.bin'));

    await assert.rejects(() => runCliAsMain(tmpDir, ['journey', '--json']), /Both `\.work\/` and `\.planning\/` exist/);
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.planning', 'legacy.bin')), legacy);
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.work', 'current.bin')), current);
  });

  test('refuses supported legacy lifecycle state and preserves its bytes', async () => {
    writeFile('.planning/config.json', JSON.stringify({ initVersion: 'v1.1' }));
    writeFile('.planning/milestones/m1-legacy/MILESTONE.md', '---\nstatus: in_progress\n---\n');
    const before = fs.readFileSync(path.join(tmpDir, '.planning', 'milestones', 'm1-legacy', 'MILESTONE.md'));

    await assert.rejects(() => runCliAsMain(tmpDir, ['journey']), /npx -y gsdd-cli init --migrate/);
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.planning', 'milestones', 'm1-legacy', 'MILESTONE.md')), before);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work')), false);
  });

  test('omits zero decision buckets and truncates long latest choices', async () => {
    writeMilestone('m0-foundation', 'in_progress', {});
    await writeDecision('Keep this active rule', {}, new Date('2026-07-12T09:00:00.000Z'));
    await writeDecision('Candidate choice', { status: 'candidate' }, new Date('2026-07-12T10:00:00.000Z'));
    const latest = 'This is a deliberately long decision string that should be shortened in the human journey display';
    await writeDecision(latest, {}, new Date('2026-07-12T11:00:00.000Z'));

    const result = await runCliAsMain(tmpDir, ['journey']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /decisions: 2 active \. 1 candidate \(awaiting promote\)/);
    assert.doesNotMatch(result.output, /invalidated|superseded/);
    assert.match(result.output, new RegExp(`latest: "${humanDecision(latest)}"`));
  });

  test('omits the human strip when the decision store is absent', async () => {
    writeMilestone('m0-foundation', 'in_progress', {});
    const result = await runCliAsMain(tmpDir, ['journey']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.doesNotMatch(result.output, /decisions:|latest:/);
  });
});
