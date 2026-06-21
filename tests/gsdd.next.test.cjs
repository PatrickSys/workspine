/**
 * GSDD next continuity router tests
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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
    assert.match(result.output, /Approval:/);
    assert.match(result.output, /Evidence required:/);
    assert.match(result.output, /Skipped inputs:/);
    assert.match(result.output, /\.planning\/SPEC\.md: missing/);
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
  test('missing legacy planning truth routes to Workspine-native planning, not false lifecycle progress', async () => {
    await initWork();
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });

    const result = await runJson(['next', '--json']);

    assert.strictEqual(result.state, 'plan');
    assert.match(result.reason, /canonical `.planning` lifecycle truth is incomplete/);
    assert.ok(result.inputs_skipped.includes('.planning/SPEC.md: missing'));
    assert.ok(result.inputs_skipped.includes('.planning/ROADMAP.md: missing'));
    assert.ok(result.inputs_skipped.includes('.planning/MILESTONES.md: missing'));
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
    writeFile('.planning/ROADMAP.md', '# Roadmap\n');
    writeFile('.planning/MILESTONES.md', '# Milestones\n');
    writeFile('.planning/phases/01-foundation/01-SUMMARY.md', '# Summary\n');

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'verify');
    assert.match(result.reason, /summaries exist without matching verification/);
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
