/**
 * GSDD next continuity router tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { cleanup, createTempProject, runCliAsMain, readJson } = require('./gsdd.helpers.cjs');

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

function writeJson(relativePath, value) {
  writeFile(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runJson(args) {
  const result = await runCliAsMain(tmpDir, args);
  assert.strictEqual(result.exitCode, 0, result.output);
  return JSON.parse(result.output);
}

async function initWork() {
  const result = await runJson(['next', '--init', '--json']);
  assert.strictEqual(result.operation, 'next init');
  return result;
}

async function inspectWorkMilestone(workDir) {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
  const mod = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  return mod.inspectWorkMilestone(workDir);
}

async function inspectWorkContext(cwd) {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
  const mod = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  return mod.inspectWorkContext(cwd);
}

describe('next command bootstrap', () => {
  test('next --help documents the continuity command surface', async () => {
    const result = await runCliAsMain(tmpDir, ['next', '--help']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /gsdd next --init/);
    assert.match(result.output, /question add/);
    assert.match(result.output, /dogfood capture/);
  });

  test('plain next is read-only and routes to bootstrap when .work is missing', async () => {
    const result = await runJson(['next', '--json']);

    assert.strictEqual(result.state, 'ask_user');
    assert.strictEqual(result.next_command, 'gsdd next --init');
    assert.strictEqual(result.next_action.type, 'cli_command');
    assert.deepStrictEqual(result.next_action.argv, ['next', '--init']);
    assert.strictEqual(result.requires_user, true);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.work')), 'plain next must not create .work');
  });

  test('next --init creates .work state, graph, question, evidence, and privacy defaults idempotently', async () => {
    const first = await initWork();
    const second = await runJson(['next', '--init', '--json']);

    assert.strictEqual(first.status, 'ok');
    assert.strictEqual(first.changed, true);
    assert.strictEqual(second.status, 'ok');
    assert.strictEqual(second.next.state, 'plan');
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'goal.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'state.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'graph', 'index.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'questions', 'open.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'evidence', 'manifest.json')));

    const gitignore = fs.readFileSync(path.join(tmpDir, '.work', '.gitignore'), 'utf-8');
    assert.match(gitignore, /state\.json/);
    assert.match(gitignore, /graph\/events\.jsonl/);
    assert.match(gitignore, /!goal\.md/);
    assert.match(gitignore, /!milestone\//);

    const state = readJson(path.join(tmpDir, '.work', 'state.json'));
    assert.strictEqual(state.privacy.raw_transcript_ingestion, 'disabled');
    const manifest = readJson(path.join(tmpDir, '.work', 'evidence', 'manifest.json'));
    assert.strictEqual(manifest.privacy.raw_artifacts_safe_to_publish, false);
  });

  test('plain next emits json when stdout is captured', async () => {
    await initWork();
    const result = await runCliAsMain(tmpDir, ['next']);

    assert.strictEqual(result.exitCode, 0, result.output);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.operation, 'next');
    assert.ok(parsed.next_action);
  });

  test('explicit human output exposes supervisor card evidence and skipped inputs', async () => {
    await initWork();
    const result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Why:/);
    assert.match(result.output, /Where things stand/);
    assert.match(result.output, /Waiting on you:/);
    assert.match(result.output, /Evidence required:/);
    assert.match(result.output, /Skipped inputs:/);
    assert.match(result.output, /\.work\/SPEC\.md: missing/);
  });
});

describe('next command questions and decisions', () => {
  test('blocking questions route next to ask_user until answered', async () => {
    await initWork();
    const add = await runJson([
      'next',
      'question',
      'add',
      '--id',
      'arch-root',
      '--prompt',
      'Approve .work as canonical?',
      '--default',
      'yes',
      '--gate',
      'architecture',
      '--json',
    ]);
    assert.strictEqual(add.operation, 'next question add');
    assert.strictEqual(add.status, 'ok');
    assert.strictEqual(add.question.blocking, true);

    const blocked = await runJson(['next', '--json']);
    assert.strictEqual(blocked.state, 'ask_user');
    assert.strictEqual(blocked.questions[0].id, 'arch-root');

    const answer = await runJson([
      'next',
      'question',
      'answer',
      '--id',
      'arch-root',
      '--answer',
      'approve default',
      '--json',
    ]);
    assert.strictEqual(answer.status, 'ok');
    assert.strictEqual(answer.graph_event_ids.length, 2);

    const after = await runJson(['next', '--json']);
    assert.notStrictEqual(after.state, 'ask_user');
    const answered = fs.readFileSync(path.join(tmpDir, '.work', 'questions', 'answered.jsonl'), 'utf-8');
    assert.match(answered, /approve default/);
    const index = readJson(path.join(tmpDir, '.work', 'graph', 'index.json'));
    assert.ok(index.edges.some((edge) => edge.type === 'answers' && edge.to === 'question:arch-root'));
  });

  test('duplicate question ids fail unless --replace is explicit', async () => {
    await initWork();
    await runJson([
      'next',
      'question',
      'add',
      '--id',
      'same-question',
      '--prompt',
      'Original?',
      '--json',
    ]);

    const duplicate = await runCliAsMain(tmpDir, [
      'next',
      'question',
      'add',
      '--id',
      'same-question',
      '--prompt',
      'Overwrite?',
      '--json',
    ]);
    assert.strictEqual(duplicate.exitCode, 1);
    assert.match(JSON.parse(duplicate.output).error, /already exists/);

    const replace = await runJson([
      'next',
      'question',
      'add',
      '--id',
      'same-question',
      '--prompt',
      'Overwrite?',
      '--replace',
      '--json',
    ]);
    assert.strictEqual(replace.question.question, 'Overwrite?');
  });

  test('same question add replay is unchanged and appends no graph events', async () => {
    await initWork();
    const first = await runJson([
      'next',
      'question',
      'add',
      '--id',
      'replay-question',
      '--prompt',
      'Same?',
      '--default',
      'yes',
      '--json',
    ]);
    const before = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');
    const second = await runJson([
      'next',
      'question',
      'add',
      '--id',
      'replay-question',
      '--prompt',
      'Same?',
      '--default',
      'yes',
      '--json',
    ]);
    const after = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');

    assert.strictEqual(first.status, 'ok');
    assert.strictEqual(second.status, 'unchanged');
    assert.strictEqual(second.graph_event_id, null);
    assert.deepStrictEqual(second.graph_event_ids, []);
    assert.strictEqual(after, before);
  });

  test('decision record writes a durable decision and graph event', async () => {
    await initWork();
    const decision = await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'jsonl-first',
      '--title',
      'Use JSONL first',
      '--body',
      'Keep graph storage file-backed in v1.',
      '--json',
    ]);

    assert.strictEqual(decision.status, 'ok');
    assert.deepStrictEqual(decision.graph_event_ids, [decision.graph_event_id]);
    assert.strictEqual(decision.decision.id, 'jsonl-first');
    const decisionPath = path.join(tmpDir, '.work', 'decisions', 'jsonl-first.md');
    assert.ok(fs.existsSync(decisionPath));
    assert.match(fs.readFileSync(decisionPath, 'utf-8'), /Keep graph storage file-backed/);
    const events = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');
    assert.match(events, /decision:jsonl-first/);
  });

  test('same decision replay is unchanged and appends no graph events', async () => {
    await initWork();
    await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'replay-decision',
      '--title',
      'Replay decision',
      '--body',
      'Same body.',
      '--json',
    ]);
    const before = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');
    const replay = await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'replay-decision',
      '--title',
      'Replay decision',
      '--body',
      'Same body.',
      '--json',
    ]);
    const after = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');

    assert.strictEqual(replay.status, 'unchanged');
    assert.strictEqual(replay.graph_event_id, null);
    assert.deepStrictEqual(replay.graph_event_ids, []);
    assert.strictEqual(after, before);
  });

  test('decision supersession records an explicit graph edge', async () => {
    await initWork();
    await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'old-memory',
      '--title',
      'Old memory shape',
      '--body',
      'Use loose files.',
      '--json',
    ]);
    const newer = await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'new-memory',
      '--title',
      'New memory shape',
      '--body',
      'Use graph edges.',
      '--supersedes',
      'old-memory',
      '--json',
    ]);

    assert.strictEqual(newer.graph_event_ids.length, 2);
    const index = readJson(path.join(tmpDir, '.work', 'graph', 'index.json'));
    assert.ok(index.edges.some((edge) =>
      edge.type === 'supersedes' &&
      edge.from === 'decision:new-memory' &&
      edge.to === 'decision:old-memory'
    ));
  });

  test('duplicate decisions fail unless --replace is explicit', async () => {
    await initWork();
    await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'same-decision',
      '--title',
      'Original',
      '--body',
      'First body.',
      '--json',
    ]);

    const duplicate = await runCliAsMain(tmpDir, [
      'next',
      'decision',
      'record',
      '--id',
      'same-decision',
      '--title',
      'Duplicate',
      '--body',
      'Second body.',
      '--json',
    ]);
    assert.strictEqual(duplicate.exitCode, 1);
    assert.match(JSON.parse(duplicate.output).error, /already exists/);

    const replaced = await runJson([
      'next',
      'decision',
      'record',
      '--id',
      'same-decision',
      '--title',
      'Replacement',
      '--body',
      'Replacement body.',
      '--replace',
      '--json',
    ]);
    assert.strictEqual(replaced.status, 'ok');
    assert.match(fs.readFileSync(path.join(tmpDir, '.work', 'decisions', 'same-decision.md'), 'utf-8'), /Replacement body/);
  });

  test('invalid decision privacy fails before writing a partial decision file', async () => {
    await initWork();
    const result = await runCliAsMain(tmpDir, [
      'next',
      'decision',
      'record',
      '--id',
      'bad-privacy',
      '--title',
      'Bad privacy',
      '--body',
      'This should not be written.',
      '--privacy',
      'private',
      '--json',
    ]);

    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.match(parsed.error, /unsupported privacy private/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.work', 'decisions', 'bad-privacy.md')));
  });

  test('dogfood capture writes a local-only finding, updates manifest, and records graph event', async () => {
    await initWork();
    const capture = await runJson([
      'next',
      'dogfood',
      'capture',
      '--id',
      'next-router-useful',
      '--title',
      'Next router clarified work',
      '--body',
      'The packet made the missing planning truth explicit.',
      '--backlog',
      '../ideaspine/workspine.md#next-router-useful',
      '--json',
    ]);

    assert.strictEqual(capture.operation, 'next dogfood capture');
    assert.strictEqual(capture.status, 'ok');
    const findingPath = path.join(tmpDir, '.work', 'dogfood', 'next-router-useful.md');
    assert.ok(fs.existsSync(findingPath));
    assert.match(fs.readFileSync(findingPath, 'utf-8'), /privacy: local_only/);
    assert.match(fs.readFileSync(findingPath, 'utf-8'), /missing planning truth/);
    const manifest = readJson(path.join(tmpDir, '.work', 'evidence', 'manifest.json'));
    assert.strictEqual(manifest.dogfood.status, 'captured');
    assert.strictEqual(manifest.dogfood.last_finding, '.work/dogfood/next-router-useful.md');
    const events = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');
    assert.match(events, /dogfood:next-router-useful/);
  });

  test('same dogfood replay is unchanged and appends no graph events', async () => {
    await initWork();
    await runJson([
      'next',
      'dogfood',
      'capture',
      '--id',
      'replay-finding',
      '--title',
      'Replay finding',
      '--body',
      'Same body.',
      '--json',
    ]);
    const before = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');
    const replay = await runJson([
      'next',
      'dogfood',
      'capture',
      '--id',
      'replay-finding',
      '--title',
      'Replay finding',
      '--body',
      'Same body.',
      '--json',
    ]);
    const after = fs.readFileSync(path.join(tmpDir, '.work', 'graph', 'events.jsonl'), 'utf-8');

    assert.strictEqual(replay.status, 'unchanged');
    assert.strictEqual(replay.graph_event_id, null);
    assert.strictEqual(after, before);
  });

  test('duplicate dogfood findings fail unless --replace is explicit', async () => {
    await initWork();
    await runJson([
      'next',
      'dogfood',
      'capture',
      '--id',
      'same-finding',
      '--title',
      'Original',
      '--body',
      'First body.',
      '--json',
    ]);

    const duplicate = await runCliAsMain(tmpDir, [
      'next',
      'dogfood',
      'capture',
      '--id',
      'same-finding',
      '--title',
      'Duplicate',
      '--body',
      'Second body.',
      '--json',
    ]);
    assert.strictEqual(duplicate.exitCode, 1);
    assert.match(JSON.parse(duplicate.output).error, /already exists/);

    const replaced = await runJson([
      'next',
      'dogfood',
      'capture',
      '--id',
      'same-finding',
      '--title',
      'Replacement',
      '--body',
      'Replacement body.',
      '--replace',
      '--json',
    ]);
    assert.strictEqual(replaced.status, 'ok');
    assert.match(fs.readFileSync(path.join(tmpDir, '.work', 'dogfood', 'same-finding.md'), 'utf-8'), /Replacement body/);
  });
});

describe('next command routing', () => {
  test('missing Workspine lifecycle truth routes to Workspine-native planning, not false lifecycle progress', async () => {
    await initWork();
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });

    const result = await runJson(['next', '--json']);

    assert.strictEqual(result.state, 'plan');
    assert.strictEqual(result.authority, 'work');
    assert.strictEqual(result.route_kind, 'work_native_plan');
    assert.match(result.reason, /canonical .work lifecycle truth is incomplete/);
    assert.ok(result.inputs_skipped.includes('.work/SPEC.md: missing'));
    assert.ok(result.inputs_skipped.includes('.work/ROADMAP.md: missing'));
    assert.ok(result.inputs_skipped.includes('.work/MILESTONES.md: missing'));
  });

  test('active brownfield change routes to brownfield planning before unrelated roadmap phase preflight', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/ROADMAP.md', [
      '# Roadmap',
      '',
      '### v9.9.9 Unrelated Active Work',
      '',
      '- [ ] **Phase 425589: Unrelated Roadmap Item** — [OTHER-01]',
      '',
    ].join('\n'));
    writeFile('.planning/brownfield-change/CHANGE.md', [
      '---',
      'change: PBI-425589',
      'status: active',
      '---',
      '',
      '# Brownfield Change: PBI 425589 Approval Plan',
      '',
      '## Goal',
      'Plan the bounded consumer approval change.',
      '',
      '## Current Status',
      '- Current posture: active',
      '- Current branch / integration surface: feature/pbi-425589',
      '',
      '## Next Action',
      '- Create the bounded approval plan without adding the PBI to the unrelated roadmap.',
      '',
    ].join('\n'));

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'plan');
    assert.strictEqual(result.authority, 'brownfield_change');
    assert.strictEqual(result.route_kind, 'brownfield_change');
    assert.strictEqual(result.next_command, 'gsdd-plan');
    assert.match(result.reason, /bounded brownfield change/i);
    assert.ok(result.artifacts_to_read.includes('.planning/brownfield-change/CHANGE.md'));
    assert.ok(result.artifacts_to_write.includes('.planning/brownfield-change/HANDOFF.md'));

    const preflight = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', 'brownfield-change']);
    assert.strictEqual(preflight.exitCode, 0, preflight.output);
    const parsedPreflight = JSON.parse(preflight.output);
    assert.strictEqual(parsedPreflight.allowed, true);
    assert.strictEqual(parsedPreflight.authority, 'brownfield_change');
    assert.strictEqual(parsedPreflight.phase, 'brownfield-change');
  });

  test('brownfield status controls routing without treating every non-closed change as planning', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/ROADMAP.md', '# Roadmap\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/brownfield-change/CHANGE.md', [
      '---',
      'change: PBI-425589',
      'status: active',
      '---',
      '',
      '# Brownfield Change: Verification Ready PBI',
      '',
      '## Current Status',
      '- Current posture: ready_for_verification',
      '',
      '## Next Action',
      '- Verify the bounded approval plan.',
      '',
    ].join('\n'));

    let result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'verify');
    assert.strictEqual(result.authority, 'brownfield_change');
    assert.strictEqual(result.route_kind, 'brownfield_change_verification');
    assert.strictEqual(result.next_command, null);
    assert.ok(result.artifacts_to_write.includes('.planning/brownfield-change/VERIFICATION.md'));

    writeFile('.planning/brownfield-change/CHANGE.md', [
      '---',
      'change: PBI-425589',
      'status: active',
      '---',
      '',
      '# Brownfield Change: Blocked PBI',
      '',
      '## Current Status',
      '- Current posture: blocked',
      '',
      '## Next Action',
      '- Wait for product approval.',
      '',
    ].join('\n'));

    result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'blocked');
    assert.strictEqual(result.authority, 'brownfield_change');
    assert.strictEqual(result.route_kind, 'brownfield_change_blocked');
    assert.ok(result.blocked_by.includes('brownfield_change'));
  });

  test('active brownfield change blocks instead of silently choosing over work-milestone authority', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/ROADMAP.md', '# Roadmap\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/brownfield-change/CHANGE.md', [
      '# Brownfield Change: PBI Conflict',
      '',
      '## Current Status',
      '- Current posture: active',
      '',
      '## Next Action',
      '- Continue bounded PBI planning.',
      '',
    ].join('\n'));
    writeFile('.work/milestone/MILESTONE.md', '# Work Milestone\n');
    writeFile('.work/milestone/ROADMAP.md', [
      '# Work Milestone Roadmap',
      '',
      '- [ ] **Phase 1: Work Native Follow-Up**',
      '',
    ].join('\n'));

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'blocked');
    assert.strictEqual(result.authority, 'blocked');
    assert.strictEqual(result.route_kind, 'authority_conflict');
    assert.ok(result.blocked_by.includes('brownfield_change'));
    assert.ok(result.blocked_by.includes('work_milestone'));
  });

  test('active brownfield change precedence over legacy unverified phase residue is explicit', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/ROADMAP.md', '# Roadmap\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/phases/01-stale/01-SUMMARY.md', '# stale summary\n');
    writeFile('.planning/brownfield-change/CHANGE.md', [
      '# Brownfield Change: Active PBI',
      '',
      '## Current Status',
      '- Current posture: active',
      '',
      '## Next Action',
      '- Plan the bounded PBI.',
      '',
    ].join('\n'));

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'plan');
    assert.strictEqual(result.authority, 'brownfield_change');
    assert.strictEqual(result.route_kind, 'brownfield_change');
    assert.match(result.reason, /bounded brownfield change/i);
  });

  test('closed brownfield change does not hijack normal legacy verification routing', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/ROADMAP.md', '# Roadmap\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/phases/01-foundation/01-SUMMARY.md', '# Summary\n');
    writeFile('.planning/brownfield-change/CHANGE.md', [
      '---',
      'change: PBI-425589',
      'status: active',
      '---',
      '',
      '# Brownfield Change: Closed PBI',
      '',
      '## Current Status',
      '- Current posture: closed',
      '',
    ].join('\n'));

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'verify');
    assert.strictEqual(result.authority, 'planning');
    assert.notStrictEqual(result.route_kind, 'brownfield_change');
    assert.match(result.reason, /summaries exist without matching verification/);
  });

  test('work-native milestone audit prevents routing backward to plan', async () => {
    await initWork();
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    writeFile('.work/milestone/MILESTONE.md', '# Milestone\n');
    writeFile('.work/milestone/ROADMAP.md', [
      '# Roadmap',
      '',
      '- [x] **Phase 1: Bootstrap** - done',
      '- [x] **Phase 2: Router** - done',
      '',
    ].join('\n'));
    writeFile('.work/milestone/AUDIT.md', [
      '# Audit',
      '',
      'Status: passed with follow-up hardening candidates',
      '',
    ].join('\n'));
    writeFile('.work/milestone/phases/01-bootstrap/01-PLAN.md', '# Plan\n');
    writeFile('.work/milestone/phases/01-bootstrap/01-EXECUTE.md', '# Execute\n');
    writeFile('.work/milestone/phases/01-bootstrap/01-VERIFY.md', '# Verify\n');
    writeFile('.work/dogfood/a-finding.md', '# Finding\n');

    const result = await runJson(['next', '--json']);

    assert.strictEqual(result.state, 'ask_user');
    assert.strictEqual(result.questions[0].id, 'completion-approval');
    assert.match(result.reason, /Workspine-native milestone audit passed/);
    assert.ok(result.inputs_considered.includes('.work/milestone/ROADMAP.md'));
    assert.ok(result.inputs_considered.includes('.work/milestone/AUDIT.md'));
    assert.ok(result.inputs_considered.includes('.work/milestone/phases/*'));
    assert.ok(result.artifacts_to_read.includes('.work/milestone/AUDIT.md'));
    assert.strictEqual(result.next_command, 'gsdd-complete-milestone');
    assert.strictEqual(result.next_action.type, 'manual_review');
    assert.ok(result.next_action.targets.includes('.work/milestone/AUDIT.md'));
    assert.doesNotMatch(result.reason, /canonical `.planning` lifecycle truth is incomplete/);
  });

  test('historical-only native packets remain inspectable but cannot route verify', async () => {
    await initWork();
    writeFile('.work/milestone/MILESTONE.md', '# Milestone\n');
    writeFile('.work/milestone/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 1: Historical chain**\n');
    writeFile('.work/milestone/phases/01-historical/01-PLAN.md', '---\nstatus: superseded\n---\n# old plan\n');
    writeFile('.work/milestone/phases/01-historical/01-EXECUTE.md', '# old execute\n');
    writeFile('.work/milestone/phases/01-historical/01-VERIFY.md', '# retained verification evidence\n');

    const milestone = await inspectWorkMilestone(path.join(tmpDir, '.work'));
    assert.deepStrictEqual(milestone.phases[0].plans, []);
    assert.deepStrictEqual(milestone.phases[0].executes, []);
    assert.deepStrictEqual(milestone.phases[0].verifies, ['01-VERIFY.md']);
    assert.deepStrictEqual(milestone.phases[0].historical_plans, ['01-PLAN.md']);
    assert.deepStrictEqual(milestone.phases[0].historical_executes, ['01-EXECUTE.md']);
    assert.strictEqual(milestone.phase_packet_count, 1);
    assert.strictEqual(milestone.actionable_phase_packet_count, 0);
    assert.strictEqual(milestone.historical_phase_packet_count, 2);

    const result = await runJson(['next', '--json']);
    assert.notStrictEqual(result.state, 'verify');
  });

  test('verification-only native packet is visible evidence but cannot route verify', async () => {
    await initWork();
    writeFile('.work/milestone/MILESTONE.md', '# Milestone\n');
    writeFile('.work/milestone/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 1: Evidence only**\n');
    writeFile('.work/milestone/phases/01-evidence/01-VERIFY.md', '# retained evidence\n');

    const milestone = await inspectWorkMilestone(path.join(tmpDir, '.work'));
    assert.deepStrictEqual(milestone.phases[0].verifies, ['01-VERIFY.md']);
    assert.strictEqual(milestone.phase_packet_count, 1);
    assert.strictEqual(milestone.actionable_phase_packet_count, 0);
    assert.strictEqual(milestone.historical_phase_packet_count, 0);

    const result = await runJson(['next', '--json']);
    assert.notStrictEqual(result.state, 'verify');
  });

  test('stray native reference packets are rejected consistently and cannot route verify', async () => {
    await initWork();
    writeFile('.work/milestone/MILESTONE.md', '# Milestone\n');
    writeFile('.work/milestone/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 1: Native packet**\n');
    writeFile('.work/milestone/phases/reference/PLAN.md', '# stray plan\n');
    writeFile('.work/milestone/phases/01-native/01-reference-PLAN.md', '# suffix overmatch\n');

    const milestone = await inspectWorkMilestone(path.join(tmpDir, '.work'));
    assert.strictEqual(milestone.phase_packet_count, 0);
    assert.strictEqual(milestone.actionable_phase_packet_count, 0);

    const result = await runJson(['next', '--json']);
    assert.notStrictEqual(result.state, 'verify');
  });

  test('native same-directory packets partition only the superseded phase token and preserve current verify routing', async () => {
    await initWork();
    writeFile('.work/milestone/MILESTONE.md', '# Milestone\n');
    writeFile('.work/milestone/ROADMAP.md', '# Roadmap\n\n- [ ] **Phase 1: Mixed packets**\n');
    writeFile('.work/milestone/phases/mixed/01-PLAN.md', '---\nstatus: superseded\n---\n# old plan\n');
    writeFile('.work/milestone/phases/mixed/01-EXECUTE.md', '# old execute\n');
    writeFile('.work/milestone/phases/mixed/01-VERIFY.md', '# old evidence\n');
    writeFile('.work/milestone/phases/mixed/02-PLAN.md', '# current plan\n');
    writeFile('.work/milestone/phases/mixed/02-EXECUTE.md', '# current execute\n');
    writeFile('.work/milestone/phases/mixed/02-VERIFY.md', '# current evidence\n');

    const milestone = await inspectWorkMilestone(path.join(tmpDir, '.work'));
    assert.deepStrictEqual(milestone.phases[0], {
      dir: 'mixed',
      plans: ['02-PLAN.md'],
      executes: ['02-EXECUTE.md'],
      verifies: ['01-VERIFY.md', '02-VERIFY.md'],
      historical_plans: ['01-PLAN.md'],
      historical_executes: ['01-EXECUTE.md'],
    });
    assert.strictEqual(milestone.phase_packet_count, 4);
    assert.strictEqual(milestone.actionable_phase_packet_count, 2);
    assert.strictEqual(milestone.historical_phase_packet_count, 2);

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'verify');
  });

  test('missing open questions file is surfaced as skipped input instead of silently considered', async () => {
    await initWork();
    fs.rmSync(path.join(tmpDir, '.work', 'questions', 'open.json'));

    const result = await runJson(['next', '--json']);

    assert.strictEqual(result.state, 'plan');
    assert.ok(result.inputs_skipped.includes('.work/questions/open.json: missing'));
    assert.ok(!result.inputs_considered.includes('.work/questions/open.json'));
  });

  test('malformed open questions shape blocks routing instead of treating questions as empty', async () => {
    await initWork();
    writeJson('.work/questions/open.json', { typo: [] });

    const result = await runJson(['next', '--json']);

    assert.strictEqual(result.state, 'blocked');
    assert.match(result.reason, /open\.json/);
    assert.ok(result.artifacts_to_read.includes('.work/questions/open.json'));
  });

  test('malformed graph events block routing and graph rebuild reports invalid events', async () => {
    await initWork();
    writeFile('.work/graph/events.jsonl', '{"id":"bad"}\n');

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'blocked');
    assert.match(result.reason, /invalid events/);

    const rebuild = await runCliAsMain(tmpDir, ['next', 'graph', 'rebuild', '--json']);
    assert.strictEqual(rebuild.exitCode, 1);
    const parsed = JSON.parse(rebuild.output);
    assert.strictEqual(parsed.status, 'invalid_events');
    assert.strictEqual(parsed.index.invalid_event_count, 1);
  });

  test('trust gates route to ask_user before privileged boundaries', async () => {
    await initWork();
    writeJson('.work/evidence/manifest.json', {
      schema_version: 1,
      trust_gates: [{
        id: 'live-browser',
        gate: 'browser',
        reason: 'Launching a browser may expose private UI state.',
        question: 'Approve live browser proof?',
        default: 'no',
      }],
    });

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'ask_user');
    assert.strictEqual(result.questions[0].id, 'live-browser');
    assert.match(result.reason, /private UI state/);
  });

  test("trust gates take precedence over state-derived execution routes", async () => {
    await initWork();
    writeJson(".work/state.json", {
      schema_version: 1,
      workflow: {
        plan: { approved: true },
        execution: { status: "not_started" },
      },
    });
    writeJson(".work/evidence/manifest.json", {
      schema_version: 1,
      trust_gates: [{
        id: "publication",
        gate: "publication",
        reason: "Publishing local-only continuity state requires explicit approval.",
        question: "Approve publishing local-only continuity state?",
        default: "no",
      }],
    });

    const result = await runJson(["next", "--json"]);
    assert.strictEqual(result.state, "ask_user");
    assert.strictEqual(result.requires_user, true);
    assert.strictEqual(result.questions[0].id, "publication");
    assert.match(result.reason, /explicit approval/);
  });

  test('passed audit routes to dogfood, then completion approval after dogfood capture', async () => {
    await initWork();
    writeJson('.work/evidence/manifest.json', {
      schema_version: 1,
      audit: { status: 'passed' },
      dogfood: { status: 'not_started' },
      privacy: { raw_transcript_ingestion: 'disabled' },
    });

    const before = await runJson(['next', '--json']);
    assert.strictEqual(before.state, 'dogfood');
    assert.match(before.next_command, /gsdd next dogfood capture/);
    assert.strictEqual(before.next_action.type, 'cli_command');
    assert.deepStrictEqual(before.next_action.argv.slice(0, 3), ['next', 'dogfood', 'capture']);

    await runJson([
      'next',
      'dogfood',
      'capture',
      '--id',
      'audit-pass-finding',
      '--title',
      'Audit pass finding',
      '--body',
      'After audit pass, Workspine should capture one bounded improvement.',
      '--json',
    ]);

    const after = await runJson(['next', '--json']);
    assert.strictEqual(after.state, 'ask_user');
    assert.strictEqual(after.questions[0].id, 'completion-approval');
  });

  test('legacy summaries without verification route to verify', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/ROADMAP.md', '# Roadmap\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/phases/01-foundation/01-SUMMARY.md', '# Summary\n');

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'verify');
    assert.match(result.reason, /summaries exist without matching verification/);
  });

  test('historical-only standard plan chain routes to plan rather than verification', async () => {
    await initWork();
    writeFile('.planning/SPEC.md', '# Spec\n');
    writeJson('.planning/config.json', { initVersion: 1 });
    writeFile('.planning/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 1: Historical chain**\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/phases/01-historical/01-PLAN.md', '---\nstatus: superseded\n---\n# old plan\n');
    writeFile('.planning/phases/01-historical/01-SUMMARY.md', '# old summary\n');
    writeFile('.planning/phases/01-historical/01-VERIFICATION.md', '# retained evidence\n');

    const context = await inspectWorkContext(tmpDir);
    assert.deepStrictEqual(context.planning.phases, [{
      dir: '01-historical',
      plans: [],
      summaries: [],
      verifications: ['01-VERIFICATION.md'],
      historical_plans: ['01-PLAN.md'],
      historical_summaries: ['01-SUMMARY.md'],
    }]);

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'plan');
    assert.notStrictEqual(result.state, 'verify');
  });

  test('fixture evals cover every allowed next state', async () => {
    const fixtures = [
      { name: 'ask_user', state: { human_gate: { question: 'Approve?', approved: false } }, expected: 'ask_user' },
      { name: 'research', state: { current_state: 'research' }, expected: 'research' },
      { name: 'plan', state: { current_state: 'plan' }, expected: 'plan' },
      { name: 'execute', state: { workflow: { plan: { approved: true }, execution: { status: 'not_started' } } }, expected: 'execute' },
      { name: 'verify', state: { workflow: { execution: { status: 'complete' }, verification: { status: 'not_started' } } }, expected: 'verify' },
      { name: 'audit', state: { workflow: { verification: { status: 'passed' }, audit: { status: 'not_started' } } }, expected: 'audit' },
      { name: 'fix_gaps', state: { workflow: { verification: { status: 'gaps_found' } } }, expected: 'fix_gaps' },
      { name: 'dogfood', state: { workflow: { audit: { status: 'passed' }, dogfood: { status: 'not_started' } } }, expected: 'dogfood' },
      { name: 'pause', state: { status: 'paused' }, expected: 'pause' },
      { name: 'blocked', state: { status: 'blocked' }, expected: 'blocked' },
      { name: 'complete', state: { workflow: { audit: { status: 'passed' }, dogfood: { status: 'captured' }, completion_approved: true } }, expected: 'complete' },
    ];

    for (const fixture of fixtures) {
      cleanup(tmpDir);
      tmpDir = createTempProject();
      await initWork();
      writeJson('.work/state.json', { schema_version: 1, ...fixture.state });
      const result = await runJson(['next', '--json']);
      assert.strictEqual(result.state, fixture.expected, fixture.name);
      assert.ok(result.reason, `${fixture.name} should explain routing`);
      assert.ok(Array.isArray(result.inputs_considered), `${fixture.name} should include trace inputs`);
      assert.ok(Array.isArray(result.trace_refs), `${fixture.name} should include trace refs`);
      assert.ok('next_action' in result, `${fixture.name} should include typed action slot`);
    }
  });
});
