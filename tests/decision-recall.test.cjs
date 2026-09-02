const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
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

async function writeOwnerRecord(workDir, input, options = {}) {
  const { writeDecisionRecord, transitionDecisionRecord } = await loadStore();
  const candidate = writeDecisionRecord(workDir, { ...input, status: 'candidate' }, options);
  const promoted = transitionDecisionRecord(workDir, candidate.id, 'promote', {
    authority: 'owner',
    approvalRef: `test-review-${candidate.id}`,
    now: options.now || new Date(),
  });
  return { ...promoted, id: promoted.meta.id };
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

function legacyGraphRecord({
  id = 'legacy-record',
  createdAt = '2026-07-11T09:00:00.000Z',
  privacy = 'repo',
  supersedes = null,
  title = 'Legacy graph record',
  body = 'This remains non-authoritative.',
} = {}) {
  return [
    '---',
    `id: ${id}`,
    `created_at: ${createdAt}`,
    `privacy: ${privacy}`,
    supersedes === null ? null : `supersedes: ${supersedes}`,
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
  ].filter((line) => line !== null).join('\n');
}

function snapshotDecisionDirectory(workDir) {
  const decisionDir = path.join(workDir, 'decisions');
  const members = fs.readdirSync(decisionDir, { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, '/'))
    .sort();
  return {
    members,
    files: members
      .filter((entry) => fs.statSync(path.join(decisionDir, entry)).isFile())
      .map((entry) => [entry, fs.readFileSync(path.join(decisionDir, entry))]),
  };
}

function snapshotTree(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
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
      await writeOwnerRecord(workDir, record(`digest-rule-${suffix}`, `Digest standing rule ${index}`), { now, repoRoot: root });
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
    const { buildDecisionsDigest } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    await writeOwnerRecord(workDir, record('repo-current-a1b2', 'Repo-wide standing rule'), { now, repoRoot: root });
    await writeOwnerRecord(workDir, record('phase-seven-c3d4', 'Phase-seven-only rule', { for: 'phase:7' }), { now, repoRoot: root });

    const digest = buildDecisionsDigest({ workDir, phase: '99', paths: ['phase:99'], now });

    assert.deepStrictEqual(digest.records.map((entry) => entry.id), ['repo-current-a1b2']);
    assert.strictEqual(digest.counts.eligible, 1);
    assert.strictEqual(digest.counts.returned, 1);
  });

  test('ranks a phase-scoped decision above a strictly more recent unscoped one', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest } = await loadStore();
    // The unscoped record is written LAST, so it wins on recency. Before the tiered comparator the
    // digest score was (phase * 100) + (path * 50) + epoch-milliseconds, which made the scope terms
    // roughly 1e-11 of the total and unable to reorder anything. This asserts scope now outranks it.
    await writeOwnerRecord(workDir, record('phase-fourteen-aa11', 'Phase fourteen scoped rule', { for: 'phase:14' }), {
      now: new Date('2026-07-11T09:00:00.000Z'),
      repoRoot: root,
    });
    await writeOwnerRecord(workDir, record('repo-wide-bb22', 'Repo-wide rule written later'), {
      now: new Date('2026-07-12T09:00:00.000Z'),
      repoRoot: root,
    });

    const scoped = buildDecisionsDigest({ workDir, phase: '14', now: new Date('2026-07-13T09:00:00.000Z') });
    assert.deepStrictEqual(scoped.records.map((entry) => entry.id), ['phase-fourteen-aa11', 'repo-wide-bb22']);

    const unmatched = buildDecisionsDigest({ workDir, phase: '05', now: new Date('2026-07-13T09:00:00.000Z') });
    assert.deepStrictEqual(unmatched.records.map((entry) => entry.id), ['repo-wide-bb22', 'phase-fourteen-aa11']);
  });

  test('CLI --for writes an explicit scope and omitting it keeps repo:current', async () => {
    const root = createTempProject();
    dirs.push(root);
    const { readDecisionRecords } = await loadStore();

    const scopedResult = await runCliAsMain(root, ['remember', 'Scope this to phase fourteen', '--type', 'rule', '--scope', 'repo', '--for', 'phase:14']);
    assert.strictEqual(scopedResult.exitCode, 0, scopedResult.output);
    const scopedId = JSON.parse(scopedResult.stdout).record.id;

    const defaultResult = await runCliAsMain(root, ['remember', 'Leave this repo wide', '--type', 'rule', '--scope', 'repo']);
    assert.strictEqual(defaultResult.exitCode, 0, defaultResult.output);
    const defaultId = JSON.parse(defaultResult.stdout).record.id;

    const records = readDecisionRecords(path.join(root, '.work')).records;
    assert.strictEqual(records.find((entry) => entry.meta.id === scopedId)?.meta.for, 'phase:14');
    assert.strictEqual(records.find((entry) => entry.meta.id === defaultId)?.meta.for, 'repo:current');

    const invalid = await runCliAsMain(root, ['remember', 'Missing the value', '--type', 'rule', '--scope', 'repo', '--for']);
    assert.notStrictEqual(invalid.exitCode, 0);
    assert.match(invalid.output, /\[--for <ref>\]/);
  });

  test('returns the accountable digest shape and honest exclusion counts', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    writeDecisionRecord(workDir, record('candidate-a1b2', 'Candidate rule', { status: 'candidate' }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('invalidated-b2c3', 'Invalidated rule', { status: 'invalidated' }), { now, repoRoot: root });
    await writeOwnerRecord(workDir, record('base-rule-c3d4', 'Superseded rule'), { now, repoRoot: root });
    await writeOwnerRecord(workDir, record('new-rule-d4e5', 'Replacement rule', { supersedes: 'base-rule-c3d4' }), { now, repoRoot: root });
    const digest = buildDecisionsDigest({ workDir, now });

    assert.deepStrictEqual(Object.keys(digest), [
      'records', 'legacyRecords', 'text', 'counts', 'truncated', 'readErrors', 'ids',
    ]);
    assert.ok(digest.records.every((entry) => Object.keys(entry).sort().join(',') === 'authority,authority_fingerprint,hash,id,status'));
    assert.deepStrictEqual(digest.legacyRecords, []);
    assert.deepStrictEqual(digest.ids, digest.records.map((entry) => entry.id));
    assert.strictEqual(digest.counts.eligible, 1);
    assert.strictEqual(digest.counts.returned, 1);
    assert.strictEqual(digest.counts.excluded.candidate, 1);
    assert.strictEqual(digest.counts.excluded.invalidated, 1);
    assert.strictEqual(digest.counts.excluded.superseded, 1);
    assert.strictEqual(digest.counts.excluded.legacy, 0);
    assert.strictEqual(digest.counts.invalid, 0);
    assert.strictEqual(digest.truncated, false);
  });

  test('keeps exact graph-era records separately from typed authority across scanner, recall, and digest', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, readDecisionRecords, recallDecisions, recordDecision, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    await writeOwnerRecord(workDir, record('typed-active-a1b2', 'Typed active authority'), { now, repoRoot: root });
    recordDecision(workDir, {
      id: 'legacy-graph',
      title: 'Legacy graph record',
      body: 'This stays non-authoritative.',
    }, { now });
    fs.writeFileSync(path.join(workDir, 'decisions', 'legacy-near-miss.md'), [
      '---',
      'id: legacy-near-miss',
      `created_at: ${now.toISOString()}`,
      'privacy: repo',
      'type: rule',
      '---',
      '',
      '# Near miss',
      '',
      'Must remain invalid.',
      '',
    ].join('\n'));

    const scanned = readDecisionRecords(workDir);
    const recalled = recallDecisions({ workDir, now });
    const digest = buildDecisionsDigest({ workDir, now });
    const expectedLegacy = [{ id: 'legacy-graph', path: '.work/decisions/legacy-graph.md', format: 'next_graph_v1' }];

    assert.deepStrictEqual(scanned.records.map((entry) => entry.meta.id), ['typed-active-a1b2']);
    assert.deepStrictEqual(scanned.legacyRecords, expectedLegacy);
    assert.deepStrictEqual(scanned.invalid.map((entry) => entry.path), ['.work/decisions/legacy-near-miss.md']);
    assert.deepStrictEqual(recalled.records.map((entry) => entry.record.meta.id), ['typed-active-a1b2']);
    assert.deepStrictEqual(recalled.legacyRecords, expectedLegacy);
    assert.deepStrictEqual(digest.records.map((entry) => entry.id), ['typed-active-a1b2']);
    assert.deepStrictEqual(digest.legacyRecords, expectedLegacy);
    assert.strictEqual(digest.counts.excluded.legacy, 1);
    assert.ok(!digest.ids.includes('legacy-graph'));
    assert.ok(!digest.text.includes('Legacy graph record'));
  });

  test('recognizes only the exact graph-era envelope and preserves malformed near-misses as invalid evidence', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const decisionDir = path.join(workDir, 'decisions');
    fs.mkdirSync(decisionDir, { recursive: true });
    const { parseDecisionRecord, readDecisionRecords } = await loadStore();
    const writeLegacy = (name, content) => fs.writeFileSync(path.join(decisionDir, `${name}.md`), content);
    const exact = legacyGraphRecord({ id: 'exact-legacy' });
    writeLegacy('exact-legacy', exact);
    assert.throws(() => parseDecisionRecord(exact), /missing type/);

    const cases = [
      ['reordered', legacyGraphRecord({ id: 'reordered' }).replace(
        'id: reordered\ncreated_at: 2026-07-11T09:00:00.000Z\nprivacy: repo',
        'created_at: 2026-07-11T09:00:00.000Z\nid: reordered\nprivacy: repo',
      )],
      ['duplicate', legacyGraphRecord({ id: 'duplicate' }).replace('created_at:', 'id: duplicate\ncreated_at:')],
      ['unknown', legacyGraphRecord({ id: 'unknown' }).replace('privacy: repo', 'privacy: repo\nunknown: value')],
      ['typed', legacyGraphRecord({ id: 'typed' }).replace('privacy: repo', 'privacy: repo\ntype: rule')],
      ['whitespace', legacyGraphRecord({ id: 'whitespace' }).replace('id: whitespace', 'id:  whitespace')],
      ['loose-time', legacyGraphRecord({ id: 'loose-time', createdAt: '2026-07-11T09:00:00Z' })],
      ['invalid-time', legacyGraphRecord({ id: 'invalid-time', createdAt: '2026-02-30T09:00:00.000Z' })],
      ['bad-privacy', legacyGraphRecord({ id: 'bad-privacy', privacy: 'private' })],
      ['unsafe-id', legacyGraphRecord({ id: 'unsafe/id' })],
      ['empty-supersedes', legacyGraphRecord({ id: 'empty-supersedes', supersedes: '' })],
      ['unsafe-supersedes', legacyGraphRecord({ id: 'unsafe-supersedes', supersedes: 'unsafe/id' })],
      ['filename-mismatch', legacyGraphRecord({ id: 'different-id' })],
      ['malformed-delimiter', legacyGraphRecord({ id: 'malformed-delimiter' }).replace(/^---/, '--')],
      ['preamble', `preamble\n${legacyGraphRecord({ id: 'preamble' })}`],
      ['missing-heading', legacyGraphRecord({ id: 'missing-heading' }).replace('# Legacy graph record', 'Legacy graph record')],
      ['blank-heading', legacyGraphRecord({ id: 'blank-heading', title: '   ' })],
      ['non-h1-heading', legacyGraphRecord({ id: 'non-h1-heading' }).replace('# Legacy graph record', '## Legacy graph record')],
      ['extra-blank', legacyGraphRecord({ id: 'extra-blank' }).replace('---\n\n# Legacy graph record', '---\n\n\n# Legacy graph record')],
      ['missing-heading-blank', legacyGraphRecord({ id: 'missing-heading-blank' }).replace('# Legacy graph record\n\n', '# Legacy graph record\n')],
      ['missing-final-lf', legacyGraphRecord({ id: 'missing-final-lf' }).slice(0, -1)],
    ];
    for (const [name, content] of cases) writeLegacy(name, content);

    const scanned = readDecisionRecords(workDir);
    assert.deepStrictEqual(scanned.legacyRecords, [{ id: 'exact-legacy', path: '.work/decisions/exact-legacy.md', format: 'next_graph_v1' }]);
    assert.deepStrictEqual(scanned.records, []);
    assert.deepStrictEqual(scanned.invalid.map((entry) => entry.path).sort(), cases.map(([name]) => `.work/decisions/${name}.md`).sort());
    assert.strictEqual(scanned.readErrors.length, cases.length);
  });

  test('uses the actual legacy state-root name in read-only legacy path evidence', async () => {
    const root = createTempProject();
    dirs.push(root);
    const planningDir = path.join(root, '.planning');
    const legacyPath = path.join(planningDir, 'decisions', 'planning-legacy.md');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    const original = legacyGraphRecord({ id: 'planning-legacy' }).replace(/\n/g, '\r\n');
    fs.writeFileSync(legacyPath, original);
    const { buildDecisionsDigest, readDecisionRecords } = await loadStore();

    const scanned = readDecisionRecords(planningDir);
    const digest = buildDecisionsDigest({ workDir: planningDir });

    assert.deepStrictEqual(scanned.legacyRecords, [{ id: 'planning-legacy', path: '.planning/decisions/planning-legacy.md', format: 'next_graph_v1' }]);
    assert.deepStrictEqual(digest.legacyRecords, scanned.legacyRecords);
    assert.strictEqual(digest.counts.excluded.legacy, 1);
    assert.strictEqual(fs.readFileSync(legacyPath, 'utf-8'), original);
  });

  test('continues after injected decision read failures without filesystem permission tricks', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date('2026-07-11T09:00:00.000Z');
    const written = await writeOwnerRecord(workDir, record('readable-a1b2', 'Readable rule'), { now, repoRoot: root });
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
    assert.deepStrictEqual(digest.legacyRecords, []);
    assert.strictEqual(digest.counts.excluded.legacy, 0);
    assert.strictEqual(digest.counts.invalid, 0);
    assert.deepStrictEqual(digest.readErrors, [{ path: '.work/decisions', code: 'EIO' }]);
  });

  test('CLI query labels every non-invalidated result with its real status', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { writeDecisionRecord } = await loadStore();
    const now = new Date();
    await writeOwnerRecord(workDir, record('query-active-a1b2', 'Shared query policy active', {
      legacy_ref: 'legacy-active',
    }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('query-candidate-b2c3', 'Shared query policy candidate', {
      status: 'candidate',
      legacy_ref: 'legacy-candidate',
      last_verified: '2000-01-01T00:00:00.000Z',
    }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('query-superseded-c3d4', 'Shared query policy superseded', {
      status: 'superseded',
    }), { now, repoRoot: root });
    writeDecisionRecord(workDir, record('query-invalidated-d4e5', 'Shared query policy invalidated', {
      status: 'invalidated',
    }), { now, repoRoot: root });

    const result = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'gsdd.mjs'), 'decisions', 'query', 'shared query policy'], {
      cwd: root,
      encoding: 'utf-8',
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, [
      'DECISION QUERY RESULTS (3 records)',
      '- query-active-a1b2 [legacy-active] [status: active] [authority: owner_asserted] — Shared query policy active',
      '- query-candidate-b2c3 [legacy-candidate] [status: candidate] [authority: candidate] — Shared query policy candidate (stale)',
      '- query-superseded-c3d4 [status: superseded] [authority: non_authoritative] — Shared query policy superseded',
      '',
    ].join('\n'));
  });

  test('CLI query keeps zero results, active digest bytes, and decision files unchanged', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { buildDecisionsDigest, recallDecisions, renderDecisionsDigest, writeDecisionRecord } = await loadStore();
    const now = new Date();
    await writeOwnerRecord(workDir, record('digest-parity-a1b2', 'Preserve digest bytes', {
      legacy_ref: 'legacy-digest',
    }), { now, repoRoot: root });
    const expectedDigest = [
      'DECISIONS DIGEST (1 active)',
      '- digest-parity-a1b2 [legacy-digest] — Preserve digest bytes',
    ].join('\n');
    const recalled = recallDecisions({ workDir, terms: 'preserve digest bytes', now });

    assert.strictEqual(renderDecisionsDigest(recalled.records), expectedDigest);
    assert.strictEqual(renderDecisionsDigest(recalled.records, { heading: 'CUSTOM DECISIONS' }), expectedDigest.replace('DECISIONS DIGEST', 'CUSTOM DECISIONS'));
    assert.strictEqual(buildDecisionsDigest({ workDir, now }).text, expectedDigest);

    const before = snapshotDecisionDirectory(workDir);
    const empty = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'gsdd.mjs'), 'decisions', 'query', 'no matching decision'], {
      cwd: root,
      encoding: 'utf-8',
    });
    assert.strictEqual(empty.status, 0, empty.stderr);
    assert.strictEqual(empty.stdout, 'DECISION QUERY RESULTS (0 records)\n');

    for (let index = 0; index < 2; index += 1) {
      const query = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'gsdd.mjs'), 'decisions', 'query', 'preserve digest bytes'], {
        cwd: root,
        encoding: 'utf-8',
      });
      assert.strictEqual(query.status, 0, query.stderr);
       assert.strictEqual(query.stdout, `DECISION QUERY RESULTS (1 record)\n- digest-parity-a1b2 [legacy-digest] [status: active] [authority: owner_asserted] — Preserve digest bytes\n`);
    }
    assert.deepStrictEqual(snapshotDecisionDirectory(workDir), before);
  });

  test('CLI captures a candidate and queries it as a candidate', async () => {
    const root = createTempProject();
    dirs.push(root);
    let result = await runCliAsMain(root, ['remember', 'Use direct commits for phase work', '--type', 'rule', '--scope', 'repo', '--code', 'bin/gsdd.mjs:1', '--why', 'PR ceremony was dropped for dogfood.']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const captured = JSON.parse(result.stdout);
    assert.strictEqual(captured.status, 'candidate');
    assert.match(captured.record.id, /^use-direct-commits-for-phase-work-[a-z0-9]{4}$/);
    const { readDecisionRecords } = await loadStore();
    const candidateRecord = readDecisionRecords(path.join(root, '.work')).records.find((entry) => entry.meta.id === captured.record.id);
    assert.strictEqual(candidateRecord?.meta.status, 'candidate');
    assert.strictEqual(candidateRecord?.meta.source, 'agent-proposed');

    result = await runCliAsMain(root, ['decisions', 'query', 'direct commits']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /^DECISION QUERY RESULTS \(1 record\)/m);
    assert.match(result.output, /\[status: candidate\]/);
    assert.match(result.output, /Use direct commits for phase work/);

    result = await runCliAsMain(root, ['remember', 'Lock direct commits for this repo', '--type', 'rule', '--scope', 'repo']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const candidateCapture = JSON.parse(result.stdout);
    assert.strictEqual(candidateCapture.status, 'candidate');
    const promoteCandidate = readDecisionRecords(path.join(root, '.work')).records.find((entry) => entry.meta.id === candidateCapture.record.id);
    assert.strictEqual(promoteCandidate?.meta.status, 'candidate');
    assert.strictEqual(promoteCandidate?.meta.source, 'agent-proposed');

    const candidatePath = path.join(root, '.work', 'decisions', `${candidateCapture.record.id}.md`);
    const beforeBarePromotion = fs.readFileSync(candidatePath);
    result = await runCliAsMain(root, ['decisions', 'promote', candidateCapture.record.id]);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /Usage: gsdd decisions/);
    assert.deepStrictEqual(fs.readFileSync(candidatePath), beforeBarePromotion);
    const stillCandidate = readDecisionRecords(path.join(root, '.work')).records.find((entry) => entry.meta.id === candidateCapture.record.id);
    assert.strictEqual(stillCandidate?.meta.status, 'candidate');
    assert.strictEqual(stillCandidate?.meta.source, 'agent-proposed');
  });

  test('removed remember authority flag fails without writing a record', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    fs.mkdirSync(workDir, { recursive: true });
    const removedFlag = ['--by', 'user'].join('-');
    const result = await runCliAsMain(root, ['remember', 'Should fail', '--type', 'rule', '--scope', 'repo', removedFlag]);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /removed/);
    assert.match(result.output, /decisions promote <id>/);
    assert.strictEqual(fs.existsSync(path.join(workDir, 'decisions')), false);
  });

  test('decision lifecycle operations enforce the matrix and preserve body hashes', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    fs.mkdirSync(workDir, { recursive: true });
    let result = await runCliAsMain(root, ['remember', 'Promote this candidate', '--type', 'rule', '--scope', 'repo']);
    const candidateId = JSON.parse(result.stdout).record.id;
    const { readDecisionRecords } = await loadStore();
    const candidatePath = path.join(workDir, 'decisions', `${candidateId}.md`);
    const candidateBefore = readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidateId);
    result = await runCliAsMain(root, ['decisions', 'promote', candidateId, '--authority', 'owner', '--approval-ref', 'owner-review-2026-08-11']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const promoted = JSON.parse(result.output);
    assert.deepStrictEqual(promoted.record.status, 'active');
    const active = readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidateId);
    assert.strictEqual(active.meta.hash, candidateBefore.meta.hash);
    assert.strictEqual(active.meta.source, candidateBefore.meta.source);
    assert.strictEqual(active.meta.approval_authority, 'owner');
    assert.strictEqual(active.meta.approval_body_hash, candidateBefore.meta.hash);
    assert.ok(fs.existsSync(candidatePath));

    result = await runCliAsMain(root, ['decisions', 'promote', candidateId, '--authority', 'owner', '--approval-ref', 'owner-review-2026-08-11']);
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
    const rejectId = JSON.parse(result.stdout).record.id;
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
      if (status === 'active') {
        await writeOwnerRecord(workDir, record(id, `${operation} ${status} refusal`, { status }), { repoRoot: root });
      } else {
        writeDecisionRecord(workDir, record(id, `${operation} ${status} refusal`, { status }), { repoRoot: root });
      }
      const filePath = path.join(workDir, 'decisions', `${id}.md`);
      const before = fs.readFileSync(filePath, 'utf-8');
      const args = ['decisions', operation, id];
      if (operation === 'promote') args.push('--authority', 'owner', '--approval-ref', 'refusal-matrix');
      if (operation === 'invalidate') args.push('--reason', 'matrix regression');
      const result = await runCliAsMain(root, args);

      assert.strictEqual(result.exitCode, 1, result.output);
      assert.match(result.output, new RegExp(`cannot ${operation} record with status ${status}`));
      assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), before);
    }
  });

  test('authority matrix binds explicit owner assertions without rewriting proposal provenance', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    fs.mkdirSync(workDir, { recursive: true });
    const store = await loadStore();

    let result = await runCliAsMain(root, [
      'remember', 'Explicit owner assertion is required.', '--type', 'rule', '--scope', 'repo',
    ]);
    const candidateId = JSON.parse(result.stdout).record.id;
    const candidatePath = path.join(workDir, 'decisions', `${candidateId}.md`);
    const candidateBytes = fs.readFileSync(candidatePath);

    for (const args of [
      [],
      ['--authority'],
      ['--authority', 'owner'],
      ['--authority', 'owner', '--approval-ref'],
      ['--authority', 'owner', '--approval-ref', 'secret-token'],
      ['--authority', 'owner', '--approval-ref', 'owner-review', '--approval-ref', 'duplicate'],
      ['--authority', 'owner', '--approval-ref', 'owner-review', '--unexpected', 'flag'],
      ['--authority', 'owner', '--approval-ref', 'AKIAIOSFODNN7EXAMPLE'],
      ['--authority', 'owner', '--approval-ref', 'ASIAIOSFODNN7EXAMPLE'],
      ['--authority', 'owner', '--approval-ref', 'AIzaSyDUMMYKEYWITHENOUGHCHARACTERS1234'],
    ]) {
      result = await runCliAsMain(root, ['decisions', 'promote', candidateId, ...args]);
      assert.strictEqual(result.exitCode, 1, `${args.join(' ')} unexpectedly succeeded: ${result.output}`);
      assert.match(result.output, /Usage: gsdd decisions/);
      assert.deepStrictEqual(fs.readFileSync(candidatePath), candidateBytes, `${args.join(' ')} changed the candidate`);
    }

    result = await runCliAsMain(root, [
      'decisions', 'promote', candidateId, '--authority', 'owner', '--approval-ref', 'owner-review-42',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const promoted = store.readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidateId);
    assert.strictEqual(promoted.meta.status, 'active');
    assert.strictEqual(promoted.meta.source, 'agent-proposed');
    assert.strictEqual(promoted.meta.approval_authority, 'owner');
    assert.strictEqual(promoted.meta.approval_ref, 'owner-review-42');
    assert.strictEqual(promoted.meta.approval_body_hash, promoted.meta.hash);
    assert.strictEqual(promoted.meta.authority_fingerprint, store.computeDecisionAuthorityFingerprint({
      id: promoted.meta.id,
      bodyHash: promoted.meta.hash,
      authority: promoted.meta.approval_authority,
      approvalRef: promoted.meta.approval_ref,
      approvedAt: promoted.meta.approved_at,
    }));
    const promotedBytes = fs.readFileSync(candidatePath);

    result = await runCliAsMain(root, [
      'decisions', 'promote', candidateId, '--authority', 'owner', '--approval-ref', 'owner-review-42',
    ]);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /cannot promote record with status active|already owner-asserted/);
    assert.deepStrictEqual(fs.readFileSync(candidatePath), promotedBytes);

    result = await runCliAsMain(root, ['decisions', 'query', 'Explicit owner assertion']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /\[status: active\] \[authority: owner_asserted\]/);

    const legacy = store.writeDecisionRecord(workDir, record('legacy-unreceipted-a1b2', 'Legacy active needs review', {
      source: 'manual',
    }), { repoRoot: root });
    const legacyPath = path.join(workDir, 'decisions', 'legacy-unreceipted-a1b2.md');
    const legacyBefore = fs.readFileSync(legacyPath);
    const digestBefore = store.buildDecisionsDigest({ workDir });
    assert.ok(!digestBefore.ids.includes(legacy.id));
    assert.strictEqual(digestBefore.counts.excluded.unreceipted_active, 1);

    result = await runCliAsMain(root, ['decisions', 'query', 'Legacy active needs review']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /\[status: active\] \[authority: unreceipted_active\]/);

    result = await runCliAsMain(root, [
      'decisions', 'promote', legacy.id, '--authority', 'owner', '--approval-ref', 'legacy-review',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const reattested = store.readDecisionRecords(workDir).records.find((entry) => entry.meta.id === legacy.id);
    assert.strictEqual(reattested.meta.source, 'manual');
    assert.strictEqual(reattested.meta.hash, legacy.record.meta.hash);
    assert.strictEqual(reattested.body, legacy.record.body);
    assert.notDeepStrictEqual(fs.readFileSync(legacyPath), legacyBefore);
    assert.strictEqual(store.classifyDecisionAuthority(reattested).classification, 'owner_asserted');

    const partial = store.writeDecisionRecord(workDir, record('partial-assertion-c3d4', 'Partial assertion refuses', {
      source: 'manual',
    }), { repoRoot: root });
    const partialPath = path.join(workDir, 'decisions', 'partial-assertion-c3d4.md');
    const partialBytes = fs.readFileSync(partialPath, 'utf-8').replace('source: manual\n', 'source: manual\napproval_authority: owner\n');
    fs.writeFileSync(partialPath, partialBytes);
    result = await runCliAsMain(root, [
      'decisions', 'promote', partial.id, '--authority', 'owner', '--approval-ref', 'partial-review',
    ]);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /malformed|review/i);
    assert.strictEqual(fs.readFileSync(partialPath, 'utf-8'), partialBytes);
    assert.strictEqual(store.classifyDecisionAuthority(store.readDecisionRecords(workDir).records.find((entry) => entry.meta.id === partial.id)).classification, 'malformed_assertion');

    const nested = path.join(root, 'src', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    result = await runCliAsMain(nested, ['decisions', 'query', 'Explicit owner assertion']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, new RegExp(candidateId));
  });

  test('canonicalizes padded approval references before validation, storage, and fingerprinting', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const store = await loadStore();
    const candidate = store.writeDecisionRecord(workDir, record('padded-ref-a1b2', 'Padded approval references stay canonical.', { status: 'candidate' }), { repoRoot: root });

    const result = await runCliAsMain(root, [
      'decisions', 'promote', candidate.id, '--authority', 'owner', '--approval-ref', '  owner-review-padded  ',
    ]);
    assert.strictEqual(result.exitCode, 0, result.output);
    const promoted = store.readDecisionRecords(workDir).records.find((entry) => entry.meta.id === candidate.id);
    assert.strictEqual(promoted.meta.approval_ref, 'owner-review-padded');
    assert.strictEqual(store.classifyDecisionAuthority(promoted).classification, 'owner_asserted');
    assert.strictEqual(JSON.parse(result.output).record.authority, 'owner_asserted');
  });

  test('treats empty or partial receipt keys and duplicate keys as malformed without writes', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const decisionDir = path.join(workDir, 'decisions');
    fs.mkdirSync(decisionDir, { recursive: true });
    const store = await loadStore();
    const initial = store.writeDecisionRecord(workDir, record('empty-receipt-a1b2', 'Empty receipt fields are malformed.'), { repoRoot: root });
    const partialPath = path.join(decisionDir, `${initial.id}.md`);
    const partialBytes = fs.readFileSync(partialPath, 'utf-8').replace('status: active\n', 'status: active\napproval_authority: \n');
    fs.writeFileSync(partialPath, partialBytes);
    const partial = store.readDecisionRecords(workDir).records.find((entry) => entry.meta.id === initial.id);
    assert.strictEqual(store.classifyDecisionAuthority(partial).classification, 'malformed_assertion');

    const duplicatePath = path.join(decisionDir, 'duplicate-receipt-c3d4.md');
    const duplicateBytes = fs.readFileSync(partialPath, 'utf-8').replace('id: empty-receipt-a1b2', 'id: duplicate-receipt-c3d4\nid: duplicate-receipt-c3d4');
    fs.writeFileSync(duplicatePath, duplicateBytes);
    const before = snapshotDecisionDirectory(workDir);
    const result = await runCliAsMain(root, ['decisions', 'promote', 'duplicate-receipt-c3d4', '--authority', 'owner', '--approval-ref', 'duplicate-review']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /decision record not found|duplicate decision frontmatter/i);
    assert.deepStrictEqual(snapshotDecisionDirectory(workDir), before);
    assert.throws(() => store.parseDecisionRecord(duplicateBytes), /duplicate decision frontmatter key: id/);
  });

  test('plan preflight persists the digest and execute preflight warns on missing or stale acknowledgements', async () => {
    const root = createTempProject();
    dirs.push(root);
    const stateDir = path.join(root, '.work');
    const workDir = stateDir;
    const phaseDir = path.join(stateDir, 'phases', '30-decisions');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'config.json'), '{}\n');
    fs.writeFileSync(path.join(stateDir, 'ROADMAP.md'), '- [ ] **Phase 30: Decisions**\n');
    const { writeDecisionRecord, readDecisionRecords } = await loadStore();
    const decision = writeDecisionRecord(workDir, record('phase-rule-a1b2', 'Phase-bound rule', { for: 'phase:30', status: 'candidate' }), {
      repoRoot: root,
      now: new Date('2026-07-11T09:00:00.000Z'),
    });
    let result = await runCliAsMain(root, ['decisions', 'promote', decision.id, '--authority', 'owner', '--approval-ref', 'phase-review-30']);
    assert.strictEqual(result.exitCode, 0, result.output);
    decision.record = (await loadStore()).readDecisionRecords(workDir).records.find((entry) => entry.meta.id === decision.id);
    fs.writeFileSync(path.join(phaseDir, '30-PLAN.md'), '# plan\n');
    result = await runCliAsMain(root, ['lifecycle-preflight', 'plan', '30']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const persisted = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8')).lastDecisionsDigest;
    assert.deepStrictEqual(persisted.records, [{
      id: decision.id,
      hash: decision.record.meta.hash,
      status: 'active',
      authority: 'owner_asserted',
      authority_fingerprint: decision.record.meta.authority_fingerprint,
    }]);
    const writeDispositionPlan = (hashLine = null, fingerprintLine = null) => fs.writeFileSync(path.join(phaseDir, '30-PLAN.md'), [
      '---',
      'status: planned',
      'decision_dispositions:',
      `  - id: ${decision.id}`,
      ...(hashLine ? [`    ${hashLine}`] : []),
      ...(fingerprintLine ? [`    ${fingerprintLine}`] : []),
      '    disposition: applied',
      '    note: ""',
      '---',
      '# plan',
    ].join('\n'));
    writeDispositionPlan(`hash: ${decision.record.meta.hash}`, `authority_fingerprint: ${decision.record.meta.authority_fingerprint}`);
    result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '30', '--expects-mutation', 'phase-status']);
    assert.strictEqual(result.exitCode, 0, result.output);
    let output = JSON.parse(result.output);
    assert.ok(!output.warnings.some((warning) => warning.code === 'decision_dispositions_missing'));
    assert.ok(!output.warnings.some((warning) => warning.code === 'decision_ack_stale'));

    for (const hashLine of ['hash: ""', null]) {
      writeDispositionPlan(hashLine, `authority_fingerprint: ${decision.record.meta.authority_fingerprint}`);
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
    assert.strictEqual(readDecisionRecords(workDir).records.find((entry) => entry.meta.id === decision.id).meta.hash, decision.record.meta.hash);
  });

  test('execute acknowledgement checks compare persisted and current authority projections bidirectionally', async () => {
    const root = createTempProject();
    dirs.push(root);
    const stateDir = path.join(root, '.work');
    const phaseDir = path.join(stateDir, 'phases', '31-authority');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'config.json'), '{}\n');
    fs.writeFileSync(path.join(stateDir, 'ROADMAP.md'), '- [ ] **Phase 31: Authority**\n');
    const store = await loadStore();
    const original = await writeOwnerRecord(stateDir, record('persisted-authority-a1b2', 'Persisted authority must be rechecked.', { for: 'phase:31' }), { repoRoot: root });
    const writePlan = (records) => fs.writeFileSync(path.join(phaseDir, '31-PLAN.md'), [
      '---', 'status: planned', 'decision_dispositions:',
      ...records.flatMap((entry) => [`  - id: ${entry.meta.id}`, `    hash: ${entry.meta.hash}`, `    authority_fingerprint: ${entry.meta.authority_fingerprint}`, '    disposition: applied', '    note: ""']),
      '---', '# plan',
    ].join('\n'));
    writePlan([original]);
    let result = await runCliAsMain(root, ['lifecycle-preflight', 'plan', '31']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const added = await writeOwnerRecord(stateDir, record('new-authority-c3d4', 'New asserted authority is stale until acknowledged.', { for: 'phase:31' }), { repoRoot: root });
    result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '31', '--expects-mutation', 'phase-status']);
    let output = JSON.parse(result.output);
    assert.match(output.warnings.find((warning) => warning.code === 'decision_ack_stale').message, /new-authority-c3d4/);

    writePlan([original, added]);
    result = await runCliAsMain(root, ['lifecycle-preflight', 'plan', '31']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const originalPath = path.join(stateDir, 'decisions', `${original.id}.md`);
    fs.writeFileSync(originalPath, fs.readFileSync(originalPath, 'utf-8').replace(/^authority_fingerprint: .*\n/m, 'authority_fingerprint: stale\n'));
    result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '31', '--expects-mutation', 'phase-status']);
    output = JSON.parse(result.output);
    assert.match(output.warnings.find((warning) => warning.code === 'decision_ack_stale').message, /persisted-authority-a1b2/);

    const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8'));
    state.lastDecisionsDigest.records = [];
    fs.writeFileSync(path.join(stateDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    result = await runCliAsMain(root, ['lifecycle-preflight', 'execute', '31', '--expects-mutation', 'phase-status']);
    output = JSON.parse(result.output);
    assert.ok(output.warnings.some((warning) => warning.code === 'decision_ack_stale'), output.warnings.map((warning) => warning.code).join(','));
  });

  test('compact help discovers the decision surface while the reference exposes all verbs', async () => {
    const root = createTempProject();
    dirs.push(root);
    const help = await runCliAsMain(root, ['help']);
    assert.strictEqual(help.exitCode, 0, help.output);
    assert.match(help.output, /docs\/USER-GUIDE\.md/);
    const guide = fs.readFileSync(path.join(ROOT, 'docs', 'USER-GUIDE.md'), 'utf-8');
    assert.match(guide, /workspine remember/);
    assert.match(guide, /workspine decisions/);
    const decisionsUsage = await runCliAsMain(root, ['decisions']);
    assert.notStrictEqual(decisionsUsage.exitCode, 0, decisionsUsage.output);
    for (const verb of ['query', 'promote', 'reject', 'invalidate']) {
      assert.match(decisionsUsage.output, new RegExp(`\\b${verb}\\b`),
        `command-specific decisions usage must expose ${verb}`);
    }
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    for (const line of readme.split(/\r?\n/).filter((line) => /npx -y workspine (?:remember|decisions)/.test(line))) {
      assert.match(line, /# \(experimental\)$/);
    }
  });

  test('lifecycle preflight carries the digest for every surface without breaking JSON output', async () => {
    const root = createTempProject();
    dirs.push(root);
    const workDir = path.join(root, '.work');
    const { writeDecisionRecord } = await loadStore();
    await writeOwnerRecord(workDir, record('preflight-rule-a1b2', 'Preflight must inject active decisions'), {
      now: new Date('2026-07-11T09:00:00.000Z'),
      repoRoot: root,
    });

    const result = await runCliAsMain(root, ['lifecycle-preflight', 'progress']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const output = JSON.parse(result.output);
    assert.match(output.decisionsDigest.text, /^DECISIONS DIGEST/);
    assert.ok(output.decisionsDigest.ids.includes('preflight-rule-a1b2'));
  });

  test('decision-record paths use shared path helpers rather than hardcoded roots', () => {
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

  test('legacy decision guidance uses the full migration route', () => {
    const cli = fs.readFileSync(DECISION_CLI_PATH, 'utf-8');
    assert.match(cli, /Run `npx -y workspine init --migrate` first/);
    assert.doesNotMatch(cli, /gsdd next --init/);
  });

  test('legacy .planning-only workspaces refuse every decision command without changing any bytes or members', async () => {
    const refusal = /Legacy \.planning\/ state is not an active Workspine root.+npx -y workspine init --migrate/i;
    const cases = [
      ['remember', 'Do not split decision authority', '--type', 'rule', '--scope', 'repo'],
      ['decisions', 'query', 'legacy poison'],
      ['decisions', 'promote', 'legacy-candidate-a1b2'],
      ['decisions', 'reject', 'legacy-candidate-a1b2'],
      ['decisions', 'invalidate', 'legacy-active-a1b2', '--reason', 'Legacy authority is retired'],
    ];

    for (const args of cases) {
      const root = createTempProject();
      dirs.push(root);
      const legacyDir = path.join(root, '.planning');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      fs.writeFileSync(path.join(legacyDir, 'sentinel.bin'), Buffer.from([0, 1, 255]));
      const before = snapshotTree(root);

      const result = await runCliAsMain(root, args);

      assert.strictEqual(result.exitCode, 1, `${args.join(' ')} unexpectedly succeeded:\n${result.output}`);
      assert.match(result.output, refusal);
      assert.deepStrictEqual(snapshotTree(root), before, `${args.join(' ')} changed legacy workspace bytes or membership`);
      assert.strictEqual(fs.existsSync(path.join(root, '.work')), false);
    }
  });

  test('after explicit migration package decisions use only .work and preserve legacy bytes', async () => {
    const root = createTempProject();
    dirs.push(root);
    const legacyDir = path.join(root, '.planning');
    const workDir = path.join(root, '.work');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const { readDecisionRecords, writeDecisionRecord } = await loadStore();
    fs.writeFileSync(path.join(legacyDir, 'sentinel.bin'), Buffer.from([0, 1, 255]));

    let result = await runCliAsMain(root, ['init', '--migrate', '--auto', '--tools', 'codex']);
    assert.strictEqual(result.exitCode, 0, result.output);
    result = await runCliAsMain(root, ['remember', 'Canonical work decision', '--type', 'rule', '--scope', 'repo']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const id = JSON.parse(result.stdout).record.id;
    result = await runCliAsMain(root, ['decisions', 'query', 'Canonical work decision']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, new RegExp(id));
    result = await runCliAsMain(root, ['decisions', 'promote', id, '--authority', 'owner', '--approval-ref', 'migration-review']);
    assert.strictEqual(result.exitCode, 0, result.output);

    const workRecords = readDecisionRecords(workDir).records;
    assert.strictEqual(workRecords.length, 1);
    assert.strictEqual(workRecords[0].meta.id, id);
    assert.strictEqual(workRecords[0].meta.status, 'active');
    assert.strictEqual(fs.existsSync(legacyDir), false);
    assert.deepStrictEqual(fs.readFileSync(path.join(workDir, 'sentinel.bin')), Buffer.from([0, 1, 255]));
  });
});
