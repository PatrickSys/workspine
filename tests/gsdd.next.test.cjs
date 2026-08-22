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

function typedDecision(id, decision, overrides = {}) {
  return {
    id,
    type: 'rule',
    status: 'active',
    scope: 'repo',
    decision,
    why: `${decision} is current authority.`,
    for: 'repo:current',
    body: `Evidence for ${decision}.`,
    ...overrides,
  };
}

async function writeTypedDecision(input, options = {}, stateDirName = '.work') {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
  const { writeDecisionRecord } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  return writeDecisionRecord(path.join(tmpDir, stateDirName), input, { repoRoot: tmpDir, ...options });
}

async function writeOwnerDecision(input, options = {}) {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
  const { writeDecisionRecord, transitionDecisionRecord } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  const candidate = writeDecisionRecord(path.join(tmpDir, '.work'), { ...input, status: 'candidate' }, { repoRoot: tmpDir, ...options });
  return transitionDecisionRecord(path.join(tmpDir, '.work'), candidate.id, 'promote', {
    authority: 'owner',
    approvalRef: `next-review-${candidate.id}`,
    now: options.now || new Date(),
  });
}

function snapshotTree(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(prefix, entry.name);
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? [{ path: `${relativePath.replace(/\\/g, '/')}/`, directory: true }, ...snapshotTree(fullPath, relativePath)]
        : [{ path: relativePath.replace(/\\/g, '/'), bytes: fs.readFileSync(fullPath) }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
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

async function readContinuityCheckpoint(cwd = tmpDir) {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
  const mod = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
  return mod.readContinuityCheckpoint(path.join(cwd, '.work'));
}

function writeCheckpoint(content) {
  writeFile('.work/.continue-here.md', content);
}

const VALID_CHECKPOINT = [
  '---',
  'workflow: phase',
  'phase: 04-continuity',
  'timestamp: 2026-08-12T10:00:00.000Z',
  'runtime: codex-cli',
  '---',
  '',
  '<current_state>',
  'Implementing the continuity projection.',
  '</current_state>',
  '',
  '<completed_work>',
  'The first focused test is red.',
  '</completed_work>',
  '',
  '<remaining_work>',
  'Add the shared parser.',
  '</remaining_work>',
  '',
  '<decisions>',
  'Checkpoint prose remains non-authoritative.',
  '</decisions>',
  '',
  '<blockers>',
  'None.',
  '</blockers>',
  '',
  '<next_action>',
  'Run the focused test.',
  '</next_action>',
].join('\n');

describe('next command bootstrap', () => {
  test('next projects a valid explicit checkpoint without changing the workspace', async () => {
    await initWork();
    writeCheckpoint(VALID_CHECKPOINT);
    const before = snapshotTree(tmpDir);

    const packet = await runJson(['next', '--json']);
    const replay = await runJson(['next', '--json']);

    assert.deepStrictEqual(packet.continuity.workspace_root, tmpDir.replace(/\\/g, '/'));
    assert.strictEqual(packet.continuity.state_root, '.work');
    assert.strictEqual(packet.continuity.checkpoint.status, 'valid');
    assert.strictEqual(packet.continuity.checkpoint.path, '.work/.continue-here.md');
    assert.strictEqual(packet.continuity.checkpoint.frontmatter.workflow, 'phase');
    assert.strictEqual(packet.continuity.checkpoint.sections.next_action, 'Run the focused test.');
    assert.deepStrictEqual(replay.continuity, packet.continuity, 'separate next processes must return the same continuity projection');
    assert.deepStrictEqual(snapshotTree(tmpDir), before, 'next must not rewrite a valid checkpoint or derived state');
  });

  test('next makes a malformed present checkpoint explicit without treating it as authority', async () => {
    await initWork();
    writeCheckpoint('---\nworkflow: phase\n---\n<current_state>incomplete</current_state>\n');
    const before = snapshotTree(tmpDir);

    const packet = await runJson(['next', '--json']);

    assert.strictEqual(packet.continuity.checkpoint.status, 'malformed');
    assert.ok(packet.continuity.checkpoint.errors.some((error) => /missing checkpoint frontmatter field: phase/.test(error)));
    assert.strictEqual(packet.continuity.posture.approval.value, 'not_approved');
    assert.match(packet.continuity.posture.approval.source, /\.work\/state\.json#workflow\.plan\.approved|structured_state_or_lifecycle/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before, 'next must preserve malformed checkpoint bytes for repair');
  });

  test('checkpoint parser classifies absent, CRLF-valid, duplicate, unreadable, and oversized inputs without leaking content', async () => {
    let checkpoint = await readContinuityCheckpoint();
    assert.strictEqual(checkpoint.status, 'absent');

    writeCheckpoint(VALID_CHECKPOINT.replace(/\n/g, '\r\n'));
    checkpoint = await readContinuityCheckpoint();
    assert.strictEqual(checkpoint.status, 'valid');

    writeCheckpoint(`${VALID_CHECKPOINT}\n<next_action>duplicate</next_action>\n`);
    checkpoint = await readContinuityCheckpoint();
    assert.strictEqual(checkpoint.status, 'malformed');
    assert.ok(checkpoint.errors.includes('duplicate checkpoint section: next_action'));

    fs.rmSync(path.join(tmpDir, '.work', '.continue-here.md'));
    fs.mkdirSync(path.join(tmpDir, '.work', '.continue-here.md'));
    checkpoint = await readContinuityCheckpoint();
    assert.strictEqual(checkpoint.status, 'unreadable');
    assert.deepStrictEqual(checkpoint.errors, ['cannot read checkpoint']);

    fs.rmSync(path.join(tmpDir, '.work', '.continue-here.md'), { recursive: true });
    writeCheckpoint(`${VALID_CHECKPOINT}\n${'x'.repeat(300 * 1024)}`);
    checkpoint = await readContinuityCheckpoint();
    assert.strictEqual(checkpoint.status, 'malformed');
    assert.deepStrictEqual(checkpoint.errors, ['checkpoint exceeds read limit']);
  });

  test('next rejects a checkpoint symlink without reading or rewriting its target', async (t) => {
    await initWork();
    const targetPath = path.join(tmpDir, '.work', 'checkpoint-target.md');
    const checkpointPath = path.join(tmpDir, '.work', '.continue-here.md');
    fs.writeFileSync(targetPath, VALID_CHECKPOINT);
    try {
      fs.symlinkSync(targetPath, checkpointPath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('symlink creation requires unavailable Windows privileges');
        return;
      }
      throw error;
    }
    const beforeTarget = fs.readFileSync(targetPath);

    const packet = await runJson(['next', '--json']);

    assert.strictEqual(packet.continuity.checkpoint.status, 'unreadable');
    assert.deepStrictEqual(packet.continuity.checkpoint.errors, ['cannot read checkpoint']);
    assert.strictEqual(fs.lstatSync(checkpointPath).isSymbolicLink(), true);
    assert.deepStrictEqual(fs.readFileSync(targetPath), beforeTarget, 'next must not consume or rewrite a checkpoint symlink target');
  });

  test('next rejects a dangling checkpoint symlink without creating or exposing its target', async (t) => {
    await initWork();
    const targetPath = path.join(tmpDir, '.work', 'checkpoint-dangling-target.md');
    const checkpointPath = path.join(tmpDir, '.work', '.continue-here.md');
    try {
      fs.symlinkSync(targetPath, checkpointPath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip('symlink creation requires unavailable Windows privileges');
        return;
      }
      throw error;
    }

    const packet = await runJson(['next', '--json']);

    assert.strictEqual(packet.continuity.checkpoint.status, 'unreadable');
    assert.deepStrictEqual(packet.continuity.checkpoint.errors, ['cannot read checkpoint']);
    assert.doesNotMatch(JSON.stringify(packet), /checkpoint-dangling-target/);
    assert.strictEqual(fs.existsSync(targetPath), false, 'next must not create a dangling checkpoint target');
    assert.strictEqual(fs.lstatSync(checkpointPath).isSymbolicLink(), true);
  });

  test('continuity mirrors state workflow sources and keeps checkpoint identity narrative-only', async () => {
    await initWork();
    writeCheckpoint(VALID_CHECKPOINT);
    writeJson('.work/state.json', {
      schema_version: 1,
      status: 'active',
      workflow: {
        human_gate: { approved: true },
        plan: { approved: true },
        execution: { status: 'complete' },
        verification: { status: 'passed' },
      },
    });
    writeJson('.work/evidence/manifest.json', { verification: { status: 'gaps_found' } });

    const packet = await runJson(['next', '--json']);

    assert.deepStrictEqual(packet.continuity.posture, {
      approval: { value: 'approved', source: '.work/state.json#workflow.human_gate' },
      result: { value: 'complete', source: '.work/state.json#workflow.execution.status' },
      verification: { value: 'passed', source: '.work/state.json#workflow.verification.status' },
    });
    assert.deepStrictEqual(packet.continuity.checkpoint.narrative_identity, {
      workflow: 'phase', phase: '04-continuity', authority: 'non_authoritative_checkpoint_prose',
    });
  });

  test('continuity retains the route reason and questions for an ask-user state', async () => {
    await initWork();
    writeJson('.work/state.json', { workflow: { human_gate: { reason: 'Owner must decide.', question: 'Approve?', approved: false } } });

    const packet = await runJson(['next', '--json']);

    assert.strictEqual(packet.state, 'ask_user');
    assert.deepStrictEqual(packet.continuity.blockers, {
      codes: [], reason: 'Owner must decide.', questions: [{ reason: 'Owner must decide.', question: 'Approve?', approved: false }],
    });
  });

  test('plain next projects active typed decisions without changing route fields', async () => {
    await initWork();
    const before = await runJson(['next', '--json']);
    const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
    const { writeDecisionRecord } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
    const workDir = path.join(tmpDir, '.work');
    writeDecisionRecord(workDir, {
      id: 'active-next-a1b2',
      status: 'candidate',
      decision: 'Use the active decision projection.',
      why: 'It is current authority.',
      body: 'Active decision body.',
    }, { repoRoot: tmpDir });
    const promoted = await runCliAsMain(tmpDir, [
      'decisions', 'promote', 'active-next-a1b2', '--authority', 'owner', '--approval-ref', 'next-fixture',
    ]);
    assert.strictEqual(promoted.exitCode, 0, promoted.output);
    writeDecisionRecord(workDir, {
      id: 'candidate-next-c3d4',
      status: 'candidate',
      decision: 'Candidate must stay excluded.',
      why: 'It is not authority.',
      body: 'Candidate decision body.',
    }, { repoRoot: tmpDir });

    const after = await runJson(['next', '--json']);

    assert.deepStrictEqual(after.decisionsDigest.records.map((record) => record.id), ['active-next-a1b2']);
    assert.strictEqual(after.decisionsDigest.counts.excluded.candidate, 1);
    for (const field of ['state', 'reason', 'next_command', 'next_action', 'authority', 'blocked_by', 'questions', 'constraints', 'route_kind']) {
      assert.deepStrictEqual(after[field], before[field], field);
    }
  });

  test('plain next excludes unreceipted active records and emits bounded review debt', async () => {
    await initWork();
    await writeTypedDecision(typedDecision('legacy-review-a1b2', 'Legacy active requires owner review.', {
      source: 'manual',
    }));

    const json = await runJson(['next', '--json']);
    assert.deepStrictEqual(json.decisionsDigest.records, []);
    assert.strictEqual(json.decisionsDigest.counts.excluded.unreceipted_active, 1);
    assert.strictEqual(json.decisionsDigest.counts.returned, 0);

    const human = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(human.exitCode, 0, human.output);
    assert.match(human.output, /unreceipted active/i);
    assert.match(human.output, /review/i);
    assert.doesNotMatch(human.output, /Legacy active requires owner review\./);
    assert.doesNotMatch(human.output, /0 additional active decisions omitted by the digest cap/);
  });

  test('human next uses singular grammar for malformed authority assertions', async () => {
    await initWork();
    const record = await writeTypedDecision(typedDecision('malformed-singular-a1b2', 'Malformed assertion singular grammar.'));
    const filePath = path.join(tmpDir, '.work', 'decisions', `${record.id}.md`);
    fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf-8').replace('status: active\n', 'status: active\napproval_authority: \n'));
    const human = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(human.exitCode, 0, human.output);
    assert.match(human.output, /1 active decision has malformed owner assertion and requires review/);
  });

  test('plain next returns the unchanged empty digest for missing and initialized work', async () => {
    const missing = await runJson(['next', '--json']);
    assert.deepStrictEqual(missing.decisionsDigest, {
      records: [], legacyRecords: [], text: 'DECISIONS DIGEST (0 active)',
      counts: {
        eligible: 0,
        returned: 0,
        excluded: {
          candidate: 0,
          superseded: 0,
          invalidated: 0,
          stale_flagged: 0,
          conflict_flagged: 0,
          unreceipted_active: 0,
          malformed_assertion: 0,
          legacy: 0,
        },
        invalid: 0,
      },
      truncated: false, readErrors: [], ids: [],
    });

    const initialized = await initWork();
    assert.deepStrictEqual(initialized.next.decisionsDigest, missing.decisionsDigest);
  });

  test('plain next refuses dual roots instead of silently selecting .work', async () => {
    fs.mkdirSync(path.join(tmpDir, '.work', 'decisions'), { recursive: true });
    await writeOwnerDecision(typedDecision('early-active-a1b2', 'Use .work before bootstrap.'));
    fs.mkdirSync(path.join(tmpDir, '.planning', 'decisions'), { recursive: true });
    const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
    const { writeDecisionRecord } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
    writeDecisionRecord(path.join(tmpDir, '.planning'), typedDecision('planning-only-c3d4', 'Do not project planning authority.', {
      body: 'PLANNING BODY MUST NOT LEAK.',
    }), { repoRoot: tmpDir });

    const result = await runCliAsMain(tmpDir, ['next', '--json']);
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'error');
    assert.match(parsed.error, /Both `\.work\/` and `\.planning\/` exist/);
    assert.doesNotMatch(result.output, /planning-only-c3d4|PLANNING BODY MUST NOT LEAK/);
  });

  test('legacy-only next and next --init refuse with the explicit init migration command', async () => {
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const before = fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'));
    for (const args of [['next', '--json'], ['next', '--init', '--json']]) {
      const result = await runCliAsMain(tmpDir, args);
      assert.strictEqual(result.exitCode, 1);
      assert.match(JSON.parse(result.output).error, /Run `npx -y workspine init --migrate`\./);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work')), false);
      assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.planning', 'config.json')), before);
    }
  });

  test('human next is quiet when no decision signal exists', async () => {
    await initWork();
    const packet = await runJson(['next', '--json']);
    const result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'next.mjs')).href;
    const { renderNextCard } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
    const expected = [
      renderNextCard(packet),
      '\nConstraints:',
      ...packet.constraints.map((item) => `- ${item}`),
      '\nEvidence required:',
      ...packet.evidence_required.map((item) => `- ${item}`),
      '\nSkipped inputs:',
      ...packet.inputs_skipped.map((item) => `- ${item}`),
    ].join('\n');

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(result.output, expected);
    assert.doesNotMatch(result.output, /Decision digest|Decision notices/);
  });

  test('human next shows active text and bounded excluded-record notices without leaking bodies', async () => {
    await initWork();
    await writeOwnerDecision(typedDecision('active-human-a1b2', 'Use active human projection.', { body: 'ACTIVE BODY MUST NOT RENDER.' }));
    await writeTypedDecision(typedDecision('candidate-human-c3d4', 'Candidate decision title.', {
      status: 'candidate', body: 'CANDIDATE BODY MUST NOT RENDER.',
    }));
    await writeTypedDecision(typedDecision('invalid-human-e5f6', 'Invalid decision title.', {
      status: 'invalidated', body: 'INVALID BODY MUST NOT RENDER.',
    }));
    await runJson(['next', 'decision', 'record', '--id', 'legacy-human', '--title', 'Legacy title must not render', '--body', 'LEGACY BODY MUST NOT RENDER.', '--json']);
    writeFile('.work/decisions/malformed.md', 'MALFORMED BODY MUST NOT RENDER.');

    const result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /DECISIONS DIGEST \(1 active\)/);
    assert.match(result.output, /Decisions: 1 active; 4 notices/);
    assert.match(result.output, /Use active human projection/);
    assert.match(result.output, /Decision notices:/);
    assert.match(result.output, /candidate decision excluded/);
    assert.match(result.output, /invalidated decision excluded/);
    assert.match(result.output, /Legacy metadata: legacy-human \(.work\/decisions\/legacy-human.md; next_graph_v1\)/);
    assert.match(result.output, /invalid or unreadable decision record detected/);
    for (const leaked of ['ACTIVE BODY MUST NOT RENDER.', 'CANDIDATE BODY MUST NOT RENDER.', 'INVALID BODY MUST NOT RENDER.', 'LEGACY BODY MUST NOT RENDER.', 'MALFORMED BODY MUST NOT RENDER.', 'Candidate decision title.', 'Invalid decision title.', 'Legacy title must not render']) {
      assert.doesNotMatch(result.output, new RegExp(leaked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('candidate-only and legacy-only human signals remain non-authoritative', async () => {
    await initWork();
    await writeTypedDecision(typedDecision('candidate-only-a1b2', 'Candidate title must not render.', {
      status: 'candidate', body: 'CANDIDATE-ONLY BODY MUST NOT RENDER.',
    }));
    let result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Decisions: no active decisions; 1 notice/);
    assert.match(result.output, /Decision notices:\n- 1 candidate decision excluded/);
    assert.doesNotMatch(result.output, /DECISIONS DIGEST|Candidate title must not render|CANDIDATE-ONLY BODY MUST NOT RENDER/);

    fs.rmSync(path.join(tmpDir, '.work', 'decisions', 'candidate-only-a1b2.md'));
    await runJson(['next', 'decision', 'record', '--id', 'legacy-only', '--title', 'Legacy title must not render', '--body', 'LEGACY-ONLY BODY MUST NOT RENDER.', '--json']);
    result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Decisions: no active decisions; 1 notice/);
    assert.match(result.output, /Legacy metadata: legacy-only \(.work\/decisions\/legacy-only.md; next_graph_v1\)/);
    assert.doesNotMatch(result.output, /DECISIONS DIGEST|Legacy title must not render|LEGACY-ONLY BODY MUST NOT RENDER/);
  });

  test('human next bounds legacy and invalid diagnostics without leaking high-cardinality bodies', async () => {
    await initWork();
    const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
    const { recordDecision } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
    const workDir = path.join(tmpDir, '.work');
    for (let index = 0; index < 5; index += 1) {
      recordDecision(workDir, {
        id: `legacy-many-${index}`,
        title: `Legacy title ${index} must not render`,
        body: `LEGACY MANY BODY ${index} MUST NOT RENDER.`,
      }, { now: new Date(`2026-08-0${index + 1}T00:00:00.000Z`) });
      writeFile(`.work/decisions/malformed-many-${index}.md`, `MALFORMED MANY BODY ${index} MUST NOT RENDER.`);
    }

    const result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Decisions: no active decisions; 2 notices/);
    assert.match(result.output, /5 legacy decision records are non-authoritative/);
    assert.strictEqual((result.output.match(/Legacy metadata:/g) || []).length, 3);
    assert.match(result.output, /2 additional legacy metadata entries omitted/);
    assert.match(result.output, /5 invalid or unreadable decision records detected/);
    assert.strictEqual((result.output.match(/invalid_decision_record/g) || []).length, 3);
    assert.match(result.output, /2 additional invalid\/read-error details omitted/);
    for (let index = 0; index < 5; index += 1) {
      assert.doesNotMatch(result.output, new RegExp(`LEGACY MANY BODY ${index}|MALFORMED MANY BODY ${index}`));
    }
  });

  test('human next describes stale and conflicting active records as digest-cap review debt', async () => {
    await initWork();
    const current = new Date();
    const old = new Date(current);
    old.setUTCDate(old.getUTCDate() - 91);
    for (let index = 0; index < 10; index += 1) {
      await writeOwnerDecision(typedDecision(`current-cap-${String(index).padStart(4, '0')}`, `Current cap decision ${index}.`), { now: current });
    }
    await writeOwnerDecision(typedDecision('stale-cap-a1b2', 'Stale active decision.', { last_verified: old.toISOString() }), { now: old });
    await writeOwnerDecision(typedDecision('conflict-base-c3d4', 'Conflict base decision.', { last_verified: current.toISOString() }), { now: old });
    await writeOwnerDecision(typedDecision('conflict-one-e5f6', 'First conflicting active decision.', { supersedes: 'conflict-base-c3d4', last_verified: current.toISOString() }), { now: old });
    await writeOwnerDecision(typedDecision('conflict-two-g7h8', 'Second conflicting active decision.', { supersedes: 'conflict-base-c3d4', last_verified: current.toISOString() }), { now: old });
    const conflictBasePath = path.join(tmpDir, '.work', 'decisions', 'conflict-base-c3d4.md');
    const conflictBase = fs.readFileSync(conflictBasePath, 'utf-8')
      .replace('status: superseded', 'status: active')
      .replace(/^superseded_by: .*\n/m, '');
    fs.writeFileSync(conflictBasePath, conflictBase);

    const result = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /4 additional active decisions omitted by the digest cap; 1 stale-flagged and 1 conflict-flagged for review/);
    assert.doesNotMatch(result.output, /stale flagged decision excluded|conflict flagged decision excluded/);
  });

  test('plain next JSON and human replays preserve every .work byte and member', async () => {
    await initWork();
    await writeOwnerDecision(typedDecision('replay-active-a1b2', 'Preserve all .work bytes.'));
    await writeTypedDecision(typedDecision('replay-candidate-c3d4', 'Preserve candidate bytes.', { status: 'candidate' }));
    writeFile('.work/research/evidence.md', 'Read-only replay evidence.\n');
    const before = snapshotTree(path.join(tmpDir, '.work'));

    for (let index = 0; index < 2; index += 1) {
      await runJson(['next', '--json']);
      const human = await runCliAsMain(tmpDir, ['next', '--format', 'human']);
      assert.strictEqual(human.exitCode, 0, human.output);
    }

    assert.deepStrictEqual(snapshotTree(path.join(tmpDir, '.work')), before);
  });

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

  test('nested next init refuses a supported legacy workspace without creating a second root', async () => {
    writeJson('.planning/config.json', { initVersion: 'v1.1' });
    const poisonPath = path.join(tmpDir, '.planning', 'legacy.bin');
    fs.writeFileSync(poisonPath, Buffer.from([0, 1, 255]));
    const poisonBytes = fs.readFileSync(poisonPath);
    const planningBefore = snapshotTree(path.join(tmpDir, '.planning'));
    const nestedDir = path.join(tmpDir, 'src', 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });

    const initialized = await runCliAsMain(nestedDir, ['next', '--init', '--json']);

    assert.strictEqual(initialized.exitCode, 1, initialized.output);
    assert.match(JSON.parse(initialized.output).error, /Run `npx -y workspine init --migrate`\./);
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work')), false);
    assert.strictEqual(fs.existsSync(path.join(nestedDir, '.work')), false);
    assert.strictEqual(fs.existsSync(path.join(nestedDir, 'goal.md')), false);
    assert.deepStrictEqual(fs.readFileSync(poisonPath), poisonBytes);
    assert.deepStrictEqual(snapshotTree(path.join(tmpDir, '.planning')), planningBefore);
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

    const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'work-context.mjs')).href;
    const { readDecisionRecords, buildDecisionsDigest } = await import(`${modulePath}?t=${Date.now()}-${Math.random()}`);
    const workDir = path.join(tmpDir, '.work');
    const listMembership = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => {
        const relativePath = path.join(prefix, entry.name);
        return entry.isDirectory()
          ? [`${relativePath}/`, ...listMembership(path.join(directory, entry.name), relativePath)]
          : [relativePath];
      })
      .sort();
    const snapshot = () => ({
      decision: fs.readFileSync(decisionPath),
      state: fs.readFileSync(path.join(workDir, 'state.json')),
      events: fs.readFileSync(path.join(workDir, 'graph', 'events.jsonl')),
      index: fs.readFileSync(path.join(workDir, 'graph', 'index.json')),
      membership: listMembership(workDir),
    });
    const beforeScan = snapshot();
    const scanned = readDecisionRecords(workDir);
    const digest = buildDecisionsDigest({ workDir });
    for (let index = 0; index < 2; index += 1) {
      readDecisionRecords(workDir);
      buildDecisionsDigest({ workDir });
    }

    assert.deepStrictEqual(scanned.records, []);
    assert.deepStrictEqual(scanned.invalid, []);
    assert.deepStrictEqual(scanned.readErrors, []);
    assert.deepStrictEqual(scanned.legacyRecords, [{
      id: 'jsonl-first',
      path: '.work/decisions/jsonl-first.md',
      format: 'next_graph_v1',
    }]);
    assert.deepStrictEqual(digest.legacyRecords, scanned.legacyRecords);
    assert.strictEqual(digest.counts.excluded.legacy, 1);
    assert.ok(!digest.ids.includes('jsonl-first'));
    assert.ok(!digest.text.includes('JSONL first'));
    const afterScan = snapshot();
    assert.deepStrictEqual(afterScan.membership, beforeScan.membership);
    assert.deepStrictEqual(afterScan.decision, beforeScan.decision);
    assert.deepStrictEqual(afterScan.state, beforeScan.state);
    assert.deepStrictEqual(afterScan.events, beforeScan.events);
    assert.deepStrictEqual(afterScan.index, beforeScan.index);
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
    fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });

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
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/ROADMAP.md', [
      '# Roadmap',
      '',
      '### v9.9.9 Unrelated Active Work',
      '',
      '- [ ] **Phase 425589: Unrelated Roadmap Item** — [OTHER-01]',
      '',
    ].join('\n'));
    writeFile('.work/brownfield-change/CHANGE.md', [
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
    assert.strictEqual(result.next_command, 'work-plan');
    assert.match(result.reason, /bounded brownfield change/i);
    assert.ok(result.artifacts_to_read.includes('.work/brownfield-change/CHANGE.md'));
    assert.ok(result.artifacts_to_write.includes('.work/brownfield-change/HANDOFF.md'));

    const preflight = await runCliAsMain(tmpDir, ['lifecycle-preflight', 'plan', 'brownfield-change']);
    assert.strictEqual(preflight.exitCode, 0, preflight.output);
    const parsedPreflight = JSON.parse(preflight.output);
    assert.strictEqual(parsedPreflight.allowed, true);
    assert.strictEqual(parsedPreflight.authority, 'brownfield_change');
    assert.strictEqual(parsedPreflight.phase, 'brownfield-change');
  });

  test('brownfield status controls routing without treating every non-closed change as planning', async () => {
    await initWork();
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/ROADMAP.md', '# Roadmap\n');
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/brownfield-change/CHANGE.md', [
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
    assert.ok(result.artifacts_to_write.includes('.work/brownfield-change/VERIFICATION.md'));

    writeFile('.work/brownfield-change/CHANGE.md', [
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
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/ROADMAP.md', '# Roadmap\n');
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/brownfield-change/CHANGE.md', [
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
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/ROADMAP.md', '# Roadmap\n');
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/phases/01-stale/01-SUMMARY.md', '# stale summary\n');
    writeFile('.work/brownfield-change/CHANGE.md', [
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
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/ROADMAP.md', '# Roadmap\n');
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/phases/01-foundation/01-SUMMARY.md', '# Summary\n');
    writeFile('.work/brownfield-change/CHANGE.md', [
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
    assert.strictEqual(result.next_command, 'work-complete-milestone');
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
    assert.deepStrictEqual(milestone.phases[0].verifies, []);
    assert.deepStrictEqual(milestone.phases[0].historical_plans, ['01-PLAN.md']);
    assert.deepStrictEqual(milestone.phases[0].historical_executes, ['01-EXECUTE.md']);
    assert.deepStrictEqual(milestone.phases[0].historical_verifies, ['01-VERIFY.md']);
    assert.strictEqual(milestone.phase_packet_count, 0);
    assert.strictEqual(milestone.actionable_phase_packet_count, 0);
    assert.strictEqual(milestone.historical_phase_packet_count, 3);

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

  test('native same-directory packets keep a superseded chain fully historical and preserve current verify routing', async () => {
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
      verifies: ['02-VERIFY.md'],
      historical_plans: ['01-PLAN.md'],
      historical_executes: ['01-EXECUTE.md'],
      historical_verifies: ['01-VERIFY.md'],
    });
    assert.strictEqual(milestone.phase_packet_count, 3);
    assert.strictEqual(milestone.actionable_phase_packet_count, 2);
    assert.strictEqual(milestone.historical_phase_packet_count, 3);

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
    assert.deepStrictEqual(result.continuity.posture.approval, {
      value: 'pending',
      source: '.work/evidence/manifest.json#trust_gates',
    });
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

  test('canonical summaries without verification route to verify', async () => {
    await initWork();
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/ROADMAP.md', '# Roadmap\n');
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/phases/01-foundation/01-SUMMARY.md', '# Summary\n');

    const result = await runJson(['next', '--json']);
    assert.strictEqual(result.state, 'verify');
    assert.match(result.reason, /summaries exist without matching verification/);
  });

  test('historical-only standard plan chain keeps every companion historical and routes to plan', async () => {
    await initWork();
    writeFile('.work/SPEC.md', '# Spec\n');
    writeJson('.work/config.json', { initVersion: 1 });
    writeFile('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 1: Historical chain**\n');
    writeFile('.work/MILESTONES.md', '# Milestones\n');
    writeFile('.work/phases/01-historical/01-PLAN.md', '---\nstatus: superseded\n---\n# old plan\n');
    writeFile('.work/phases/01-historical/01-SUMMARY.md', '# old summary\n');
    writeFile('.work/phases/01-historical/01-VERIFICATION.md', '# retained evidence\n');

    const context = await inspectWorkContext(tmpDir);
    assert.deepStrictEqual(context.planning.phases, [{
      dir: '01-historical',
      plans: [],
      summaries: [],
      verifications: [],
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

  test('lifecycle-transition records the artifact-backed loop and replays without writing', async () => {
    await initWork();
    writeFile('.work/phases/01-transition/01-PLAN.md', '---\nstatus: pending\n---\n# plan\n');
    let result = await runCliAsMain(tmpDir, [
      'lifecycle-transition', 'plan', '--plan', '.work/phases/01-transition/01-PLAN.md',
      '--authority', 'workflow', '--json', '--no-update-notice',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(JSON.parse(result.output).state.current_state, 'plan');

    writeFile('.work/phases/01-transition/01-PLAN.md', '---\nstatus: approved\n---\n# plan\n');
    result = await runCliAsMain(tmpDir, [
      'lifecycle-transition', 'execute', '--plan', '.work/phases/01-transition/01-PLAN.md',
      '--authority', 'owner', '--json', '--no-update-notice',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(JSON.parse(result.output).state.current_state, 'execute');

    writeFile('.work/phases/01-transition/01-SUMMARY.md', '---\nstatus: complete\n---\n# summary\n');
    result = await runCliAsMain(tmpDir, [
      'lifecycle-transition', 'verify', '--plan', '.work/phases/01-transition/01-PLAN.md',
      '--artifact', '.work/phases/01-transition/01-SUMMARY.md', '--authority', 'workflow', '--json', '--no-update-notice',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);

    const beforeReplay = fs.readFileSync(path.join(tmpDir, '.work', 'state.json'));
    result = await runCliAsMain(tmpDir, [
      'lifecycle-transition', 'verify', '--plan', '.work/phases/01-transition/01-PLAN.md',
      '--artifact', '.work/phases/01-transition/01-SUMMARY.md', '--authority', 'workflow', '--json', '--no-update-notice',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(JSON.parse(result.output).status, 'replayed');
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.work', 'state.json')), beforeReplay);
  });

  test('lifecycle-transition blocks missing terminal artifacts before dereference and without writing', async () => {
    await initWork();
    writeFile('.work/phases/01-transition/01-PLAN.md', '---\nstatus: approved\n---\n# plan\n');
    const statePath = path.join(tmpDir, '.work', 'state.json');
    const before = fs.readFileSync(statePath);

    const result = await runCliAsMain(tmpDir, [
      'lifecycle-transition', 'audit', '--plan', '.work/phases/01-transition/01-PLAN.md',
      '--authority', 'workflow', '--json', '--no-update-notice',
    ]);

    assert.strictEqual(result.exitCode, 1, result.output);
    const response = JSON.parse(result.output);
    assert.strictEqual(response.error_code, 'missing_artifact');
    assert.match(response.error, /audit lifecycle transition requires --artifact <path>/);
    assert.deepStrictEqual(response.evidence, ['--artifact']);
    assert.strictEqual(response.changed, false);
    assert.deepStrictEqual(fs.readFileSync(statePath), before);
  });

  test('lifecycle-transition rejects wrong or missing artifacts without changing state and next fails closed', async () => {
    await initWork();
    writeFile('.work/phases/01-transition/01-PLAN.md', '---\nstatus: approved\n---\n# plan\n');
    writeFile('.work/phases/02-other/02-SUMMARY.md', '---\nstatus: complete\n---\n# summary\n');
    const before = fs.readFileSync(path.join(tmpDir, '.work', 'state.json'));
    let result = await runCliAsMain(tmpDir, [
      'lifecycle-transition', 'verify', '--plan', '.work/phases/01-transition/01-PLAN.md',
      '--artifact', '.work/phases/02-other/02-SUMMARY.md', '--authority', 'workflow', '--json', '--no-update-notice',
    ]);
    assert.strictEqual(result.exitCode, 1);
    assert.match(JSON.parse(result.output).error_code, /wrong_artifact_identity|out_of_order/);
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.work', 'state.json')), before);

    writeJson('.work/state.json', {
      schema_version: 1,
      status: 'active',
      current_state: 'verify',
      workflow: { current_state: 'verify', plan: { approved: true, path: '.work/phases/01-transition/01-PLAN.md' }, execution: { status: 'complete', artifact: '.work/phases/01-transition/missing-SUMMARY.md' } },
    });
    result = await runCliAsMain(tmpDir, ['next', '--json', '--no-update-notice']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const next = JSON.parse(result.output);
    assert.strictEqual(next.state, 'blocked');
    assert.strictEqual(next.error_code, 'workflow_state_contradiction');
    assert.match(next.reason, /missing durable artifact/);
  });
});
