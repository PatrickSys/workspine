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
