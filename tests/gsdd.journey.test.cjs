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

async function writeDecision(decision, overrides = {}, now = new Date()) {
  const { writeDecisionRecord } = await DECISION_STORE;
  return writeDecisionRecord(path.join(tmpDir, '.work'), {
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
      { dir: '03-running', status: 'executing' },
      { dir: '04-malformed', status: 'unknown' },
    ]);
    assert.strictEqual(json.milestones[0].active, false);
    assert.strictEqual(json.milestones[1].active, true);
    assert.deepStrictEqual(json.recent, { commits48h: 0, latest: null });
    assert.strictEqual(json.decisions, null);
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
