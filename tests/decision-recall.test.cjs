const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { cleanup, createTempProject, runCliAsMain } = require('./gsdd.helpers.cjs');

const ROOT = path.join(__dirname, '..');
const WORK_CONTEXT_PATH = path.join(ROOT, 'bin', 'lib', 'work-context.mjs');
const DECISION_CLI_PATH = path.join(ROOT, 'bin', 'lib', 'decision-cli.mjs');
const MIGRATION_PATH = path.join(ROOT, 'scripts', 'migrate-decision-corpus.mjs');
const WORK_CONTEXT_URL = pathToFileURL(WORK_CONTEXT_PATH).href;

async function loadStore() {
  return import(`${WORK_CONTEXT_URL}?t=${Date.now()}-${Math.random()}`);
}

function record(id, decision, overrides = {}) {
  return {
    id,
    type: 'rule',
    status: 'active',
    scope: 'repo',
    decision,
    why: overrides.why || `${decision} is a standing constraint.`,
    for: overrides.for || 'repo:current',
    links: overrides.links || null,
    body: overrides.body || `Evidence for ${decision}.`,
    ...overrides,
  };
}

describe('S1 decision recall loop', () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length > 0) cleanup(dirs.pop());
  });

  test('writes and parses the v1 schema with auto provenance and a body hash', async () => {
    const root = createTempProject();
    dirs.push(root);
    const { writeDecisionRecord, parseDecisionRecord, hashDecisionBody } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    const result = writeDecisionRecord(path.join(root, '.work'), record('git-flow-a1b2', 'Use direct commits for dogfood phase work', {
      why: 'The direct flow removes per-phase PR ceremony.',
      for: 'phase:7, path:bin/gsdd.mjs',
      links: { code: 'bin/gsdd.mjs:42', commit: 'abc123' },
      people: 'owner',
      body: 'The user changed dogfood flow after reviewing the cost of PR ceremony.',
    }), { now, repoRoot: root, session: 'test-session', agent: 'test-agent' });

    const raw = fs.readFileSync(path.join(root, '.work', 'decisions', 'git-flow-a1b2.md'), 'utf-8');
    const parsed = parseDecisionRecord(raw);
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(parsed.meta.id, 'git-flow-a1b2');
    assert.strictEqual(parsed.meta.status, 'active');
    assert.strictEqual(parsed.meta.scope, 'repo');
    assert.match(parsed.meta.provenance, /session=test-session/);
    assert.match(parsed.meta.provenance, /agent=test-agent/);
    assert.strictEqual(parsed.meta.created_at, now.toISOString());
    assert.strictEqual(parsed.meta.updated_at, now.toISOString());
    assert.strictEqual(parsed.meta.last_verified, now.toISOString());
    assert.strictEqual(parsed.meta.hash, hashDecisionBody(parsed.body));
    assert.match(parsed.body, /^## Evidence\n/);
  });

  test('allocates distinct ids with an exclusive write after a slug collision', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { writeDecisionRecord } = await loadStore();
    const suffixes = ['cafe', 'cafe', 'babe'];
    let index = 0;
    const random = () => suffixes[Math.min(index++, suffixes.length - 1)];
    const first = writeDecisionRecord(workDir, record(null, 'Same slug decision'), { repoRoot: root, random });
    const second = writeDecisionRecord(workDir, record(null, 'Same slug decision'), { repoRoot: root, random });
    assert.notStrictEqual(first.id, second.id);
    assert.strictEqual(fs.readdirSync(path.join(workDir, 'decisions')).length, 2);
  });

  test('recall applies literal term, path, type, status filters and suppresses invalidated records', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { recallDecisions, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('git-flow-a1b2', 'Use direct commits for phase work', {
      for: 'path:bin/lib/state-dir.mjs',
      links: { code: 'bin/lib/state-dir.mjs:15' },
      body: 'Direct commits are the current git flow for phase work.',
    }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('git-lesson-b2c3', 'Git flow needs a fresh review', {
      type: 'lesson',
      body: 'A review caught a mismatch before push.',
    }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('old-git-c3d4', 'Old git flow', {
      status: 'invalidated',
      body: 'This record must never be recalled.',
    }), { now, repoRoot: root });

    const result = recallDecisions({
      workDir,
      terms: 'current git flow',
      paths: 'bin/lib/state-dir.mjs',
      type: 'rule',
      status: 'active',
      now,
    });
    assert.deepStrictEqual(result.records.map((entry) => entry.record.meta.id), ['git-flow-a1b2']);
    assert.ok(!result.records.some((entry) => entry.record.meta.id === 'old-git-c3d4'));
  });

  test('scores structured fields and id only, excluding archival body and repo boilerplate', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { recallDecisions, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('body-only-a1b2', 'Unrelated standing rule', {
      why: 'This record has no structured match.',
      body: 'needle phrase appears only in archival evidence.',
    }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('structured-match-b2c3', 'Needle phrase is the standing rule', {
      why: 'The structured fields carry the intended recall text.',
    }), { now, repoRoot: root });

    const bodyOnly = recallDecisions({ workDir, terms: 'needle phrase', now });
    assert.deepStrictEqual(bodyOnly.records.map((entry) => entry.record.meta.id), ['structured-match-b2c3']);

    const boilerplate = recallDecisions({ workDir, terms: 'repo:current', now });
    assert.deepStrictEqual(boilerplate.records, []);
  });

  test('normalizes slash-separated words without splitting path-like tokens', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { recallDecisions, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('review-flow-a1b2', 'Review phase commits', {
      why: 'Fable is excluded from this review flow.',
      for: 'sol is tightly bounded.',
      links: { code: 'bin/lib/state-dir.mjs:15' },
    }), { now, repoRoot: root });

    const killQuery = recallDecisions({
      workDir,
      terms: "which agent reviews commits, what's Fable/sol banned from",
      now,
    });
    assert.deepStrictEqual(killQuery.records.map((entry) => entry.record.meta.id), ['review-flow-a1b2']);

    const pathQuery = recallDecisions({ workDir, terms: 'bin/lib/state-dir.mjs', now });
    assert.deepStrictEqual(pathQuery.records.map((entry) => entry.record.meta.id), ['review-flow-a1b2']);
  });

  test('rejects empty and header-only evidence before section normalization', async () => {
    const root = createTempProject();
    dirs.push(root);
    const { writeDecisionRecord } = await loadStore();
    assert.throws(() => writeDecisionRecord(path.join(root, '.work'), record(null, 'Missing evidence', { body: '   ' }), { repoRoot: root }), /body is required/);
    assert.throws(() => writeDecisionRecord(path.join(root, '.work'), record(null, 'Header only', { body: '## Evidence\n\n' }), { repoRoot: root }), /body is required/);
  });

  test('flags a supersede fork and persists both sides of supersession', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { recallDecisions, writeDecisionRecord, parseDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('base-policy-a1b2', 'Base policy for workflow flow'), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('successor-one-b2c3', 'First successor policy', { supersedes: 'base-policy-a1b2' }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('successor-two-c3d4', 'Second successor policy', { supersedes: 'base-policy-a1b2' }), { now, repoRoot: root });

    const predecessor = parseDecisionRecord(fs.readFileSync(path.join(workDir, 'decisions', 'base-policy-a1b2.md'), 'utf-8'));
    assert.strictEqual(predecessor.meta.status, 'superseded');
    assert.strictEqual(predecessor.meta.superseded_by, 'successor-two-c3d4');
    assert.strictEqual(predecessor.meta.updated_at, now.toISOString());

    const successor = parseDecisionRecord(fs.readFileSync(path.join(workDir, 'decisions', 'successor-two-c3d4.md'), 'utf-8'));
    assert.strictEqual(successor.meta.supersedes, 'base-policy-a1b2');
    const recalled = recallDecisions({ workDir, terms: 'base policy', now });
    const base = recalled.records.find((entry) => entry.record.meta.id === 'base-policy-a1b2');
    assert.ok(base, 'the superseded source should remain visible to a graph walk');
    assert.ok(base.flags.includes('conflict'));
    assert.deepStrictEqual(base.conflictSuccessors.sort(), ['successor-one-b2c3', 'successor-two-c3d4']);
  });

  test('caps decision digests at ten records and fifteen lines', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    for (let index = 0; index < 12; index += 1) {
      const suffix = `${index}`.padStart(4, '0');
      writeDecisionRecord(workDir, record(`digest-rule-${suffix}`, `Digest standing rule ${index}`), { now, repoRoot: root });
    }
    const digest = buildDecisionsDigest({ workDir, now });
    assert.ok(digest.records.length <= 10);
    assert.ok(digest.text.split('\n').length <= 15);
    assert.match(digest.text, /^DECISIONS DIGEST \(10 active\)/);
  });

  test('includes repo-wide decisions in unrelated phase digests while narrowing explicit scopes', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('repo-current-a1b2', 'Repo-wide standing rule'), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('phase-seven-c3d4', 'Phase-seven-only rule', { for: 'phase:7' }), { now, repoRoot: root });

    const digest = buildDecisionsDigest({ workDir, phase: '99', paths: ['phase:99'], now });

    assert.deepStrictEqual(digest.records.map((entry) => entry.id), ['repo-current-a1b2']);
    assert.strictEqual(digest.counts.eligible, 1);
    assert.strictEqual(digest.counts.returned, 1);
  });

  test('returns the accountable digest shape and honest exclusion counts', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('candidate-a1b2', 'Candidate rule', { status: 'candidate' }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('invalidated-b2c3', 'Invalidated rule', { status: 'invalidated' }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('base-rule-c3d4', 'Superseded rule'), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('new-rule-d4e5', 'Replacement rule', { supersedes: 'base-rule-c3d4' }), { now, repoRoot: root });
    const digest = buildDecisionsDigest({ workDir, now });

    assert.deepStrictEqual(Object.keys(digest), [
      'records', 'text', 'counts', 'truncated', 'readErrors', 'ids',
    ]);
    assert.ok(digest.records.every((entry) => Object.keys(entry).sort().join(',') === 'hash,id,status'));
    assert.deepStrictEqual(digest.ids, digest.records.map((entry) => entry.id));
    assert.strictEqual(digest.counts.eligible, 1);
    assert.strictEqual(digest.counts.returned, 1);
    assert.strictEqual(digest.counts.excluded.candidate, 1);
    assert.strictEqual(digest.counts.excluded.invalidated, 1);
    assert.strictEqual(digest.counts.excluded.superseded, 1);
    assert.strictEqual(digest.counts.invalid, 0);
    assert.strictEqual(digest.truncated, false);
  });

  test('continues after injected decision read failures without filesystem permission tricks', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    const written = writeDecisionRecord(workDir, record('readable-a1b2', 'Readable rule'), { now, repoRoot: root });
    const raw = fs.readFileSync(path.join(workDir, 'decisions', `${written.id}.md`), 'utf-8');
    const reader = {
      existsSync: () => true,
      readdirSync: () => ['readable-a1b2.md', 'broken-b2c3.md'],
      readFileSync: (filePath) => {
        if (String(filePath).endsWith('broken-b2c3.md')) {
          const error = new Error('injected read failure');
          error.code = 'EACCES';
          throw error;
        }
        return raw;
      },
    };
    const digest = buildDecisionsDigest({ workDir, reader, now });
    assert.deepStrictEqual(digest.records.map((entry) => entry.id), ['readable-a1b2']);
    assert.strictEqual(digest.counts.invalid, 1);
    assert.deepStrictEqual(digest.readErrors, [{ path: '.work/decisions/broken-b2c3.md', code: 'EACCES' }]);
  });

  test('treats an injected decision-directory failure as a warning-only empty digest', async () => {
    const root = createTempProject();
    dirs.push(root);
    const { buildDecisionsDigest } = await loadStore();
    const error = new Error('injected directory failure');
    error.code = 'EIO';
    const digest = buildDecisionsDigest({
      workDir: path.join(root, '.work'),
      reader: { existsSync: () => true, readdirSync: () => { throw error; } },
    });
    assert.strictEqual(digest.directoryUnreadable, true);
    assert.deepStrictEqual(digest.records, []);
    assert.strictEqual(digest.counts.invalid, 0);
    assert.deepStrictEqual(digest.readErrors, [{ path: '.work/decisions', code: 'EIO' }]);
  });

  test('CLI captures a candidate and queries a compact digest', async () => {
    const root = createTempProject();
    dirs.push(root);
    fs.mkdirSync(path.join(root, '.work'), { recursive: true });
    let result = await runCliAsMain(root, ['remember', 'Use direct commits for phase work', '--type', 'rule', '--scope', 'repo', '--code', 'bin/gsdd.mjs:1', '--why', 'PR ceremony was dropped for dogfood.']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const captured = JSON.parse(result.output);
    assert.strictEqual(captured.status, 'candidate');
    assert.match(captured.record.id, /^use-direct-commits-for-phase-work-[a-z0-9]{4}$/);
    const { readDecisionRecords } = await loadStore();
    const candidateRecord = readDecisionRecords(path.join(root, '.work')).records.find((entry) => entry.meta.id === captured.record.id);
    assert.strictEqual(candidateRecord?.meta.status, 'candidate');
    assert.strictEqual(candidateRecord?.meta.source, 'agent-proposed');

    result = await runCliAsMain(root, ['decisions', 'query', 'direct commits']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /^DECISIONS DIGEST/m);
    assert.match(result.output, /Use direct commits for phase work/);

    result = await runCliAsMain(root, ['remember', 'Lock direct commits for this repo', '--type', 'rule', '--scope', 'repo', '--by-user']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const userCapture = JSON.parse(result.output);
    assert.strictEqual(userCapture.status, 'active');
    const userRecord = readDecisionRecords(path.join(root, '.work')).records.find((entry) => entry.meta.id === userCapture.record.id);
    assert.strictEqual(userRecord?.meta.status, 'active');
    assert.strictEqual(userRecord?.meta.source, 'user');
  });

  test('decision lifecycle operations enforce the matrix and preserve body hashes', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    fs.mkdirSync(workDir, { recursive: true });
    let result = await runCliAsMain(root, ['remember', 'Promote this candidate', '--type', 'rule', '--scope', 'repo']);
    const candidateId = JSON.parse(result.output).record.id;
    const { readDecisionRecords } = await loadStore();
    const candidatePath = path.join(workDir, 'decisions', `${candidateId}.md`);
    const candidateBefore = readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidateId);
    result = await runCliAsMain(root, ['decisions', 'promote', candidateId]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const promoted = JSON.parse(result.output);
    assert.deepStrictEqual(promoted.record.status, 'active');
    const active = readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidateId);
    assert.strictEqual(active.meta.hash, candidateBefore.meta.hash);
    assert.strictEqual(active.meta.source, 'user');
    assert.ok(fs.existsSync(candidatePath));

    result = await runCliAsMain(root, ['decisions', 'promote', candidateId]);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, new RegExp(`cannot promote record with status active`));
    result = await runCliAsMain(root, ['decisions', 'invalidate', candidateId]);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /Usage: gsdd decisions/);
    result = await runCliAsMain(root, ['decisions', 'invalidate', candidateId, '--reason', 'Replaced']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const invalidated = readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidateId);
    assert.strictEqual(invalidated.meta.status, 'invalidated');
    assert.strictEqual(invalidated.meta.hash, candidateBefore.meta.hash);
    assert.strictEqual(invalidated.meta.invalidation_reason, 'Replaced');
    assert.deepStrictEqual((await loadStore()).recallDecisions({ workDir, terms: 'Promote this candidate' }).records, []);

    result = await runCliAsMain(root, ['remember', 'Reject this candidate', '--type', 'rule', '--scope', 'repo']);
    const rejectId = JSON.parse(result.output).record.id;
    result = await runCliAsMain(root, ['decisions', 'reject', rejectId]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const rejected = readDecisionRecords(workDir).records.find((entry) => entry.meta.id === rejectId);
    assert.strictEqual(rejected.meta.status, 'invalidated');
    assert.strictEqual(rejected.meta.invalidation_reason, 'rejected');
    assert.ok(fs.existsSync(path.join(workDir, 'decisions', `${rejectId}.md`)));
    result = await runCliAsMain(root, ['decisions', 'reject', rejectId]);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /cannot reject record with status invalidated/);
  });

  test('refusal matrix rejects every invalid transition without changing files', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    fs.mkdirSync(workDir, { recursive: true });
    const { writeDecisionRecord } = await loadStore();
    const cases = [
      ['promote', 'active'],
      ['promote', 'superseded'],
      ['promote', 'invalidated'],
      ['reject', 'active'],
      ['reject', 'superseded'],
      ['reject', 'invalidated'],
      ['invalidate', 'candidate'],
      ['invalidate', 'superseded'],
      ['invalidate', 'invalidated'],
    ];

    for (const [operation, status] of cases) {
      const id = `${operation}-${status}-a1b2`;
      writeDecisionRecord(workDir, record(id, `${operation} ${status} refusal`, { status }), { repoRoot: root });
      const filePath = path.join(workDir, 'decisions', `${id}.md`);
      const before = fs.readFileSync(filePath, 'utf-8');
      const args = ['decisions', operation, id];
      if (operation === 'invalidate') args.push('--reason', 'matrix regression');
      const result = await runCliAsMain(root, args);

      assert.strictEqual(result.exitCode, 1, result.output);
      assert.match(result.output, new RegExp(`cannot ${operation} record with status ${status}`));
      assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), before);
    }
  });

  test('plan preflight persists the digest and execute preflight warns on missing or stale acknowledgements', async () => {
    const root = createTempProject();
    dirs.push(root);
    const stateDir = path.join(root, '.planning');
    const phaseDir = path.join(stateDir, 'phases', '30-decisions');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'ROADMAP.md'), '- [ ] **Phase 30: Decisions**\n');
    const { writeDecisionRecord, readDecisionRecords } = await loadStore();
    const decision = writeDecisionRecord(stateDir, record('phase-rule-a1b2', 'Phase-bound rule', { for: 'phase:30' }), {
      repoRoot: root,
      now: new Date('2026-07-11T09:00:00.000Z'),
    });
    fs.writeFileSync(path.join(phaseDir, '30-PLAN.md'), '# plan\n');
    let result = await runCliAsMain(root, ['lifecycle-preflight', 'plan', '30']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const persisted = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8')).lastDecisionsDigest;
    assert.deepStrictEqual(persisted.records, [{ id: decision.id, hash: decision.record.meta.hash, status: 'active' }]);
    const writeDispositionPlan = (hashLine = null) => fs.writeFileSync(path.join(phaseDir, '30-PLAN.md'), [
      '---',
      'status: planned',
      'decision_dispositions:',
      `  - id: ${decision.id}`,
      ...(hashLine ? [`    ${hashLine}`] : []),
      '    disposition: applied',
      '    note: ""',
      '---',
      '# plan',
    ].join('\n'));
    writeDispositionPlan(`hash: ${decision.record.meta.hash}`);
    result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);
    let output = JSON.parse(result.output);
    assert.ok(!output.warnings.some((warning) => warning.code === 'decision_dispositions_missing'));
    assert.ok(!output.warnings.some((warning) => warning.code === 'decision_ack_stale'));

    for (const hashLine of ['hash: ""', null]) {
      writeDispositionPlan(hashLine);
      result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
      assert.strictEqual(result.exitCode, 0, result.output);
      output = JSON.parse(result.output);
      const staleWarning = output.warnings.find((warning) => warning.code === 'decision_ack_stale');
      assert.ok(staleWarning, `expected stale warning for ${hashLine === null ? 'absent' : 'empty'} hash`);
      assert.match(staleWarning.message, new RegExp(decision.id));
    }

    result = await runCliAsMain(root, ['decisions', 'invalidate', decision.id, '--reason', 'Changed']);
    assert.strictEqual(result.exitCode, 0, result.output);
    result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    output = JSON.parse(result.output);
    assert.ok(output.warnings.some((warning) => warning.code === 'decision_ack_stale'));
    const stateAfterExecute = fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8');
    assert.strictEqual(JSON.parse(stateAfterExecute).lastDecisionsDigest.emitted_at, persisted.emitted_at);
    assert.strictEqual(readDecisionRecords(stateDir).records.find((entry) => entry.meta.id === decision.id).meta.hash, decision.record.meta.hash);
  });

  test('README and help keep every decision backend command experimental and expose all verbs', async () => {
    const root = createTempProject();
    dirs.push(root);
    const help = await runCliAsMain(root, ['help']);
    assert.strictEqual(help.exitCode, 0, help.output);
    for (const verb of ['remember', 'decisions query', 'decisions promote', 'decisions reject', 'decisions invalidate']) {
      assert.match(help.output, new RegExp(verb.replace(' ', '\\s+')));
    }
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    for (const line of readme.split(/\r?\n/).filter((line) => /gsdd-cli (?:remember|decisions)/.test(line))) {
      assert.match(line, /# \(experimental\)$/);
    }
  });

  test('lifecycle preflight carries the digest for every surface without breaking JSON output', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { writeDecisionRecord } = await loadStore();
    writeDecisionRecord(workDir, record('preflight-rule-a1b2', 'Preflight must inject active decisions'), {
      now: new Date('2026-07-11T09:00:00.000Z'),
      repoRoot: root,
    });

    const result = await runCliAsMain(root, ['lifecycle-preflight', 'progress']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const output = JSON.parse(result.output);
    assert.match(output.decisionsDigest.text, /^DECISIONS DIGEST/);
    assert.ok(output.decisionsDigest.ids.includes('preflight-rule-a1b2'));
  });

  test('decision-record paths use the shared state resolver rather than hardcoded roots', () => {
    const workContext = fs.readFileSync(WORK_CONTEXT_PATH, 'utf-8');
    const decisionBlock = workContext.slice(workContext.indexOf('export function writeDecisionRecord'), workContext.indexOf('export function captureDogfoodFinding'));
    const cli = fs.readFileSync(DECISION_CLI_PATH, 'utf-8');
    const migration = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    const migrationFunction = migration.slice(migration.indexOf('export function migrateDecisionCorpus'), migration.indexOf('\nfunction rule('));
    for (const [label, source] of [['decision store', decisionBlock], ['decision CLI', cli], ['decision migration', migrationFunction]]) {
      assert.doesNotMatch(source, /['"]\.(?:work|planning)['"]/,
        `${label} must not hardcode a state-root literal in its decision-record path logic`);
    }
  });

  test('write and read resolve the same .work or legacy .planning root', async () => {
    for (const stateDir of ['.work', '.planning']) {
      const root = createTempProject();
      dirs.push(root);
      fs.mkdirSync(path.join(root, stateDir), { recursive: true });
      if (stateDir === '.work') fs.writeFileSync(path.join(root, stateDir, 'config.json'), '{}\n');
      const result = await runCliAsMain(root, ['remember', `Root pinned to ${stateDir}`, '--type', 'rule', '--scope', 'repo']);
      assert.strictEqual(result.exitCode, 0, result.output);
      const captured = JSON.parse(result.output);
      const { resolveStateDir } = await import(pathToFileURL(path.join(ROOT, 'bin', 'lib', 'state-dir.mjs')).href);
      const resolvedRoot = resolveStateDir(root).dir;
      assert.strictEqual(resolvedRoot, path.join(root, stateDir));
      const { readDecisionRecords } = await loadStore();
      const records = readDecisionRecords(resolvedRoot).records;
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].meta.id, captured.record.id);
      assert.ok(fs.existsSync(path.join(resolvedRoot, 'decisions', `${captured.record.id}.md`)));
      const otherRoot = stateDir === '.work' ? path.join(root, '.planning') : path.join(root, '.work');
      assert.ok(!fs.existsSync(path.join(otherRoot, 'decisions', `${captured.record.id}.md`)));
    }
  });
});
