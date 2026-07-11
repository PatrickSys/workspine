import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import { evaluateLifecycleState } from './lifecycle-state.mjs';
import { resolveStateDir } from './state-dir.mjs';

export const WORK_DIR_NAME = '.work';

export const NEXT_STATES = Object.freeze([
  'ask_user',
  'research',
  'plan',
  'execute',
  'verify',
  'audit',
  'fix_gaps',
  'dogfood',
  'pause',
  'blocked',
  'complete',
]);

export const GRAPH_NODE_TYPES = Object.freeze([
  'goal',
  'milestone',
  'phase',
  'task',
  'decision',
  'question',
  'assumption',
  'evidence',
  'artifact',
  'dogfood_finding',
  'session_summary',
  'repo',
  'external_context',
]);

export const GRAPH_EDGE_TYPES = Object.freeze([
  'belongs_to',
  'blocks',
  'answers',
  'supports',
  'contradicts',
  'supersedes',
  'derived_from',
  'requires_decision',
  'verified_by',
  'deferred_to',
  'references',
]);

export const GRAPH_EVENT_TYPES = Object.freeze([
  'node_created',
  'node_updated',
  'edge_created',
  'question_answered',
  'decision_recorded',
  'evidence_recorded',
]);

export const PRIVACY_LEVELS = Object.freeze(['public', 'repo', 'local_only', 'secret_risk']);
export const SOURCE_TYPES = Object.freeze(['chat', 'file', 'command', 'web', 'ideaspine', 'codebase-context', 'manual']);

const DEFAULT_WORK_GITIGNORE = [
  '# Workspine local runtime state',
  'state.json',
  'graph/events.jsonl',
  'graph/index.json',
  'questions/open.json',
  'questions/answered.jsonl',
  'evidence/manifest.json',
  'focus/current.md',
  'dogfood/*.md',
  'handoff/current.md',
  '',
  '# Keep durable contract/research files trackable',
  '!goal.md',
  '!research/',
  '!research/**',
  '!milestone/',
  '!milestone/**',
  '!milestones/',
  '!milestones/**',
  '!.gitignore',
  '',
].join('\n');

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function repoRelative(cwd, filePath) {
  return normalizeSlashes(relative(cwd, filePath));
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function writeFileAtomic(filePath, content) {
  ensureDir(dirname(filePath));
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let fd = null;
  try {
    fd = openSync(tempPath, 'w');
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, filePath);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best effort cleanup after a failed durable write.
      }
    }
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best effort cleanup after a failed durable write.
      }
    }
    throw error;
  }
}

function appendFileDurable(filePath, content) {
  ensureDir(dirname(filePath));
  const fd = openSync(filePath, 'a');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeJsonIfMissing(filePath, value) {
  if (existsSync(filePath)) return false;
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return true;
}

function writeTextIfMissing(filePath, value) {
  if (existsSync(filePath)) return false;
  writeFileAtomic(filePath, value);
  return true;
}

export function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return { exists: false, ok: true, value: null, error: null };
  try {
    return { exists: true, ok: true, value: JSON.parse(readFileSync(filePath, 'utf-8')), error: null };
  } catch (error) {
    return { exists: true, ok: false, value: null, error: error.message };
  }
}

export function createGraphEvent({ actor = 'agent', type, privacy = 'repo', source = 'command', payload = {}, now = new Date() } = {}) {
  return {
    id: `evt_${now.toISOString().replace(/[^0-9]/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: now.toISOString(),
    actor,
    type,
    privacy,
    source,
    payload,
  };
}

export function validateGraphEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return ['event must be an object'];
  }
  for (const field of ['id', 'created_at', 'actor', 'type', 'privacy', 'source', 'payload']) {
    if (!(field in event)) errors.push(`missing ${field}`);
  }
  if (event.type && !GRAPH_EVENT_TYPES.includes(event.type)) errors.push(`unsupported event type ${event.type}`);
  if (event.privacy && !PRIVACY_LEVELS.includes(event.privacy)) errors.push(`unsupported privacy ${event.privacy}`);
  if (event.source && !SOURCE_TYPES.includes(event.source)) errors.push(`unsupported source ${event.source}`);
  if (event.payload && typeof event.payload !== 'object') errors.push('payload must be an object');
  const nodeType = event.payload?.node?.type;
  if (nodeType && !GRAPH_NODE_TYPES.includes(nodeType)) errors.push(`unsupported node type ${nodeType}`);
  const edgeType = event.payload?.edge?.type;
  if (edgeType && !GRAPH_EDGE_TYPES.includes(edgeType)) errors.push(`unsupported edge type ${edgeType}`);
  return errors;
}

export function appendGraphEvent(workDir, event) {
  const errors = validateGraphEvent(event);
  if (errors.length > 0) {
    throw new Error(`invalid graph event: ${errors.join('; ')}`);
  }
  const eventsPath = join(workDir, 'graph', 'events.jsonl');
  appendFileDurable(eventsPath, `${JSON.stringify(event)}\n`);
  return event;
}

export function readGraphEvents(workDir) {
  const eventsPath = join(workDir, 'graph', 'events.jsonl');
  if (!existsSync(eventsPath)) return { events: [], invalid: [] };
  const events = [];
  const invalid = [];
  const lines = readFileSync(eventsPath, 'utf-8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      const errors = validateGraphEvent(event);
      if (errors.length > 0) invalid.push({ line: index + 1, errors });
      else events.push(event);
    } catch (error) {
      invalid.push({ line: index + 1, errors: [error.message] });
    }
  });
  return { events, invalid };
}

export function rebuildGraphIndex(workDir, { now = new Date(), write = false } = {}) {
  const { events, invalid } = readGraphEvents(workDir);
  const nodes = {};
  const edges = [];
  for (const event of events) {
    const node = event.payload?.node;
    if (node?.id) {
      nodes[node.id] = {
        ...(nodes[node.id] || {}),
        ...node,
        last_event_id: event.id,
        updated_at: event.created_at,
      };
    }
    const edge = event.payload?.edge;
    if (edge?.from && edge?.to && edge?.type) {
      edges.push({ ...edge, event_id: event.id, created_at: event.created_at });
    }
  }
  const index = {
    schema_version: 1,
    rebuilt_at: now.toISOString(),
    event_count: events.length,
    invalid_event_count: invalid.length,
    nodes,
    edges,
    invalid_events: invalid,
  };
  if (write) {
    const indexPath = join(workDir, 'graph', 'index.json');
    writeFileAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
  return index;
}

export function getWorkPaths(cwd = process.cwd()) {
  const root = resolve(cwd);
  const workDir = join(root, WORK_DIR_NAME);
  return {
    root,
    workDir,
    goal: join(workDir, 'goal.md'),
    state: join(workDir, 'state.json'),
    events: join(workDir, 'graph', 'events.jsonl'),
    index: join(workDir, 'graph', 'index.json'),
    openQuestions: join(workDir, 'questions', 'open.json'),
    answeredQuestions: join(workDir, 'questions', 'answered.jsonl'),
    evidenceManifest: join(workDir, 'evidence', 'manifest.json'),
    focus: join(workDir, 'focus', 'current.md'),
    handoff: join(workDir, 'handoff', 'current.md'),
    milestoneDir: join(workDir, 'milestone'),
    rootGoal: join(root, 'goal.md'),
  };
}

export function ensureWorkStructure(cwd = process.cwd(), { now = new Date() } = {}) {
  const paths = getWorkPaths(cwd);
  const created = [];
  for (const dir of ['graph', 'decisions', 'questions', 'evidence', 'focus', 'dogfood', 'handoff', 'research']) {
    const fullPath = join(paths.workDir, dir);
    if (!existsSync(fullPath)) created.push(repoRelative(paths.root, fullPath));
    ensureDir(fullPath);
  }
  if (writeTextIfMissing(join(paths.workDir, '.gitignore'), DEFAULT_WORK_GITIGNORE)) created.push('.work/.gitignore');
  if (writeTextIfMissing(paths.goal, defaultGoalContent())) created.push('.work/goal.md');
  if (writeTextIfMissing(paths.rootGoal, defaultRootGoalPointer())) created.push('goal.md');
  if (writeJsonIfMissing(paths.state, defaultState(now))) created.push('.work/state.json');
  if (writeJsonIfMissing(paths.openQuestions, { schema_version: 1, questions: [] })) created.push('.work/questions/open.json');
  if (writeTextIfMissing(paths.answeredQuestions, '')) created.push('.work/questions/answered.jsonl');
  if (writeJsonIfMissing(paths.evidenceManifest, defaultEvidenceManifest())) created.push('.work/evidence/manifest.json');
  if (writeTextIfMissing(paths.events, '')) created.push('.work/graph/events.jsonl');
  if (readGraphEvents(paths.workDir).events.length === 0) {
    const event = createGraphEvent({
      actor: 'agent',
      type: 'node_created',
      privacy: 'repo',
      source: 'command',
      payload: {
        node: {
          id: 'goal:active',
          type: 'goal',
          title: 'Active Workspine goal',
          path: '.work/goal.md',
        },
      },
      now,
    });
    appendGraphEvent(paths.workDir, event);
  }
  rebuildGraphIndex(paths.workDir, { now, write: true });
  return { paths, created };
}

function defaultGoalContent() {
  return [
    '# Workspine Goal',
    '',
    'Status: draft',
    '',
    'Define the active milestone goal here. `gsdd next` uses this file as the canonical continuity contract.',
    '',
  ].join('\n');
}

function defaultRootGoalPointer() {
  return [
    '# Goal Pointer',
    '',
    'Canonical active goal: `.work/goal.md`',
    '',
  ].join('\n');
}

function defaultState(now) {
  return {
    schema_version: 1,
    status: 'active',
    current_state: 'plan',
    updated_at: now.toISOString(),
    loop: ['plan', 'execute', 'verify', 'audit', 'fix_gaps', 'dogfood'],
    privacy: {
      raw_transcript_ingestion: 'disabled',
      mutable_state_default: 'local_only',
    },
  };
}

function defaultEvidenceManifest() {
  return {
    schema_version: 1,
    evidence: [],
    verification: { status: 'not_started' },
    audit: { status: 'not_started' },
    dogfood: { status: 'not_started' },
    privacy: {
      raw_transcript_ingestion: 'disabled',
      raw_artifacts_safe_to_publish: false,
    },
  };
}

export function readOpenQuestions(workDir) {
  const result = readJsonIfExists(join(workDir, 'questions', 'open.json'));
  if (!result.ok) return { exists: result.exists, ok: false, questions: [], error: result.error };
  const raw = result.value;
  if (raw === null) return { exists: result.exists, ok: true, questions: [], error: null };
  if (!Array.isArray(raw) && !Array.isArray(raw?.questions)) {
    return {
      exists: result.exists,
      ok: false,
      questions: [],
      error: 'open questions must be an array or an object with a questions array',
    };
  }
  const questions = Array.isArray(raw) ? raw : raw.questions;
  return { exists: result.exists, ok: true, questions, error: null };
}

export function writeOpenQuestions(workDir, questions) {
  const filePath = join(workDir, 'questions', 'open.json');
  writeFileAtomic(filePath, `${JSON.stringify({ schema_version: 1, questions }, null, 2)}\n`);
}

export function addOpenQuestion(workDir, question, { now = new Date(), replace = false } = {}) {
  const current = readOpenQuestions(workDir);
  if (!current.ok) throw new Error(current.error);
  const id = question.id || `q_${now.toISOString().replace(/[^0-9]/g, '')}`;
  const existing = current.questions.find((item) => item.id === id);
  const entry = {
    id,
    question: question.question,
    default: question.default || null,
    rationale: question.rationale || null,
    gate: question.gate || 'product',
    blocking: question.blocking !== false,
    created_at: existing?.created_at || now.toISOString(),
  };
  if (existing && !replace) {
    if (sameQuestion(existing, entry)) {
      return { status: 'unchanged', question: existing, event: null, events: [] };
    }
    throw new Error(`question ${id} already exists with different content; pass --replace to overwrite it`);
  }
  const nextQuestions = current.questions.filter((item) => item.id !== id);
  nextQuestions.push(entry);
  writeOpenQuestions(workDir, nextQuestions);
  const event = appendGraphEvent(workDir, createGraphEvent({
    actor: 'agent',
    type: 'node_created',
    privacy: 'repo',
    source: 'command',
    payload: {
      node: {
        id: `question:${id}`,
        type: 'question',
        title: entry.question,
        blocking: entry.blocking,
        gate: entry.gate,
      },
    },
    now,
  }));
  rebuildGraphIndex(workDir, { now, write: true });
  return { status: 'ok', question: entry, event, events: [event] };
}

function sameQuestion(left, right) {
  return left.question === right.question &&
    (left.default || null) === (right.default || null) &&
    (left.rationale || null) === (right.rationale || null) &&
    (left.gate || 'product') === (right.gate || 'product') &&
    (left.blocking !== false) === (right.blocking !== false);
}

export function answerQuestion(workDir, id, answer, { now = new Date() } = {}) {
  const current = readOpenQuestions(workDir);
  if (!current.ok) throw new Error(current.error);
  const question = current.questions.find((item) => item.id === id);
  if (!question) {
    const alreadyAnswered = findAnsweredQuestion(workDir, id, answer);
    if (alreadyAnswered) {
      return { found: true, already_applied: true, question: alreadyAnswered, event: null, events: [] };
    }
    return { found: false, question: null, event: null, events: [] };
  }
  const remaining = current.questions.filter((item) => item.id !== id);
  writeOpenQuestions(workDir, remaining);
  const answered = {
    ...question,
    answer,
    answered_at: now.toISOString(),
  };
  const answeredPath = join(workDir, 'questions', 'answered.jsonl');
  appendFileDurable(answeredPath, `${JSON.stringify(answered)}\n`);
  const event = appendGraphEvent(workDir, createGraphEvent({
    actor: 'user',
    type: 'question_answered',
    privacy: 'repo',
    source: 'manual',
    payload: {
      question_id: id,
      answer,
      node: {
        id: `question:${id}`,
        type: 'question',
        title: question.question,
        answered: true,
      },
    },
    now,
  }));
  const edgeEvent = appendGraphEvent(workDir, createGraphEvent({
    actor: 'user',
    type: 'edge_created',
    privacy: 'repo',
    source: 'manual',
    payload: {
      edge: {
        from: `answer:${id}:${now.toISOString()}`,
        to: `question:${id}`,
        type: 'answers',
      },
    },
    now,
  }));
  rebuildGraphIndex(workDir, { now, write: true });
  return { found: true, question: answered, event, events: [event, edgeEvent] };
}

function findAnsweredQuestion(workDir, id, answer) {
  const answeredPath = join(workDir, 'questions', 'answered.jsonl');
  if (!existsSync(answeredPath)) return null;
  const lines = readFileSync(answeredPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.id === id && entry.answer === answer) return entry;
    } catch {
      return null;
    }
  }
  return null;
}

export function recordDecision(workDir, decision, { now = new Date(), replace = false } = {}) {
  const id = decision.id || `decision-${now.toISOString().slice(0, 10)}`;
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '-');
  const privacy = decision.privacy || 'repo';
  if (!PRIVACY_LEVELS.includes(privacy)) {
    throw new Error(`unsupported privacy ${privacy}`);
  }
  const filePath = join(workDir, 'decisions', `${safeId}.md`);
  const existingDecision = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  const createdAt = existingDecision && !replace
    ? existingDecision.match(/^created_at:\s*(.+)$/m)?.[1]?.trim() || now.toISOString()
    : now.toISOString();
  const body = [
    '---',
    `id: ${safeId}`,
    `created_at: ${createdAt}`,
    `privacy: ${privacy}`,
    decision.supersedes ? `supersedes: ${decision.supersedes}` : null,
    '---',
    '',
    `# ${decision.title || safeId}`,
    '',
    decision.body || '',
    '',
  ].filter((line) => line !== null).join('\n');
  if (existingDecision && !replace) {
    if (existingDecision === body) {
      return { status: 'unchanged', id: safeId, path: normalizeSlashes(relative(resolve(workDir, '..'), filePath)), event: null, events: [] };
    }
    throw new Error(`decision ${safeId} already exists with different content; pass --replace to overwrite it`);
  }
  writeFileAtomic(filePath, body);
  const event = appendGraphEvent(workDir, createGraphEvent({
    actor: 'user',
    type: 'decision_recorded',
    privacy,
    source: 'manual',
    payload: {
      node: {
        id: `decision:${safeId}`,
        type: 'decision',
        title: decision.title || safeId,
        path: normalizeSlashes(relative(dirname(workDir), filePath)).replace(/^\.work\//, '.work/'),
        supersedes: decision.supersedes || null,
      },
    },
    now,
  }));
  const events = [event];
  if (decision.supersedes) {
    events.push(appendGraphEvent(workDir, createGraphEvent({
      actor: 'user',
      type: 'edge_created',
      privacy,
      source: 'manual',
      payload: {
        edge: {
          from: `decision:${safeId}`,
          to: `decision:${decision.supersedes}`,
          type: 'supersedes',
        },
      },
      now,
    })));
  }
  rebuildGraphIndex(workDir, { now, write: true });
  return { status: 'ok', id: safeId, path: normalizeSlashes(relative(resolve(workDir, '..'), filePath)), event, events };
}

export function captureDogfoodFinding(workDir, finding, { now = new Date(), replace = false } = {}) {
  const id = finding.id || `dogfood-${now.toISOString().slice(0, 10)}`;
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '-');
  const filePath = join(workDir, 'dogfood', `${safeId}.md`);
  const existingFinding = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  const createdAt = existingFinding && !replace
    ? existingFinding.match(/^created_at:\s*(.+)$/m)?.[1]?.trim() || now.toISOString()
    : now.toISOString();
  const body = [
    '---',
    `id: ${safeId}`,
    `created_at: ${createdAt}`,
    'privacy: local_only',
    finding.backlog ? `backlog: ${finding.backlog}` : null,
    '---',
    '',
    `# ${finding.title || safeId}`,
    '',
    finding.body || '',
    '',
  ].filter((line) => line !== null).join('\n');
  if (existingFinding && !replace) {
    if (existingFinding === body) {
      return { status: 'unchanged', id: safeId, path: normalizeSlashes(relative(resolve(workDir, '..'), filePath)), event: null };
    }
    throw new Error(`dogfood finding ${safeId} already exists with different content; pass --replace to overwrite it`);
  }
  writeFileAtomic(filePath, body);

  const manifestPath = join(workDir, 'evidence', 'manifest.json');
  const manifest = readJsonIfExists(manifestPath);
  if (manifest.ok && manifest.value) {
    const nextManifest = {
      ...manifest.value,
      dogfood: {
        ...(manifest.value.dogfood || {}),
        status: 'captured',
        last_finding: `.work/dogfood/${safeId}.md`,
        captured_at: now.toISOString(),
      },
    };
    writeFileAtomic(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
  }

  const event = appendGraphEvent(workDir, createGraphEvent({
    actor: 'agent',
    type: 'node_created',
    privacy: 'local_only',
    source: 'manual',
    payload: {
      node: {
        id: `dogfood:${safeId}`,
        type: 'dogfood_finding',
        title: finding.title || safeId,
        path: `.work/dogfood/${safeId}.md`,
        backlog: finding.backlog || null,
      },
    },
    now,
  }));
  rebuildGraphIndex(workDir, { now, write: true });
  return { status: 'ok', id: safeId, path: normalizeSlashes(relative(resolve(workDir, '..'), filePath)), event };
}

export function inspectWorkContext(cwd = process.cwd()) {
  const paths = getWorkPaths(cwd);
  const state = readJsonIfExists(paths.state);
  const questions = readOpenQuestions(paths.workDir);
  const evidence = readJsonIfExists(paths.evidenceManifest);
  const graph = readGraphEvents(paths.workDir);
  const { dir: planningDir, name: stateDirName, migrationNotice } = resolveStateDir(paths.root);
  const lifecycle = evaluateLifecycleState({ planningDir });
  const planning = {
    exists: existsSync(planningDir),
    has_spec: existsSync(join(planningDir, 'SPEC.md')),
    has_roadmap: existsSync(join(planningDir, 'ROADMAP.md')),
    has_milestones: existsSync(join(planningDir, 'MILESTONES.md')),
    has_config: existsSync(join(planningDir, 'config.json')),
    has_brownfield_change: lifecycle.brownfieldChange.exists,
    non_phase_state: lifecycle.nonPhaseState,
    brownfield_change: lifecycle.brownfieldChange,
    current_phase: lifecycle.currentPhase?.number || null,
    next_phase: lifecycle.nextPhase?.number || null,
    counts: lifecycle.counts,
    phases: scanPhaseEvidence(planningDir),
    state_dir_name: stateDirName,
  };
  return {
    paths,
    exists: existsSync(paths.workDir),
    has_goal: existsSync(paths.goal),
    has_root_goal: existsSync(paths.rootGoal),
    state,
    questions,
    evidence,
    graph,
    planning,
    migration_notice: migrationNotice,
    milestone: inspectWorkMilestone(paths.workDir),
    focus_exists: existsSync(paths.focus),
    handoff_exists: existsSync(paths.handoff),
    decisions: listMarkdownFiles(join(paths.workDir, 'decisions')),
    dogfood: listMarkdownFiles(join(paths.workDir, 'dogfood')),
  };
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => normalizeSlashes(join(basename(dir), name)));
}

export function resolveActiveMilestoneDir(workDir) {
  const pluralDir = join(workDir, 'milestones');
  if (existsSync(pluralDir)) {
    let candidates = [];
    const candidateText = new Map();
    try {
      candidates = readdirSync(pluralDir).filter((name) => {
        const milestonePath = join(pluralDir, name, 'MILESTONE.md');
        if (!existsSync(milestonePath)) return false;
        try {
          candidateText.set(name, readTextIfExists(milestonePath) || '');
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      candidates = [];
    }
    if (candidates.length > 0) {
      const inProgress = candidates.filter((name) => {
        const text = candidateText.get(name) || '';
        return /^status:\s*in_progress\b/im.test(text);
      });
      const pool = inProgress.length > 0 ? inProgress : candidates;
      return join(pluralDir, pool.sort().at(-1));
    }
  }
  return join(workDir, 'milestone');
}

export function inspectWorkMilestone(workDir) {
  const milestoneDir = resolveActiveMilestoneDir(workDir);
  const roadmapPath = join(milestoneDir, 'ROADMAP.md');
  const auditPath = join(milestoneDir, 'AUDIT.md');
  const milestonePath = join(milestoneDir, 'MILESTONE.md');
  const roadmap = readTextIfExists(roadmapPath);
  const audit = readTextIfExists(auditPath);
  const phasesDir = join(milestoneDir, 'phases');
  const phases = [];
  if (existsSync(phasesDir)) {
    for (const dirName of readdirSync(phasesDir)) {
      const dirPath = join(phasesDir, dirName);
      let names = [];
      try {
        names = readdirSync(dirPath);
      } catch {
        continue;
      }
      phases.push({
        dir: dirName,
        plans: names.filter((name) => /-PLAN\.md$/i.test(name)),
        executes: names.filter((name) => /-EXECUTE\.md$/i.test(name)),
        verifies: names.filter((name) => /-VERIFY\.md$/i.test(name)),
      });
    }
  }
  const roadmapPhaseLines = (roadmap || '').split(/\r?\n/).filter((line) => /^\s*-\s+\[[ x-]\]\s+\*\*Phase\s+/i.test(line));
  const completePhaseLines = roadmapPhaseLines.filter((line) => /^\s*-\s+\[x\]/i.test(line));
  const auditStatus = (audit || '').match(/^Status:\s*(.+)$/im)?.[1]?.trim() || null;
  return {
    exists: existsSync(milestoneDir),
    dir: milestoneDir,
    has_milestone: existsSync(milestonePath),
    has_roadmap: existsSync(roadmapPath),
    has_audit: existsSync(auditPath),
    phase_count: phases.length,
    phase_packet_count: phases.reduce((count, phase) => count + phase.plans.length + phase.executes.length + phase.verifies.length, 0),
    roadmap_phase_count: roadmapPhaseLines.length,
    roadmap_complete_phase_count: completePhaseLines.length,
    roadmap_all_complete: roadmapPhaseLines.length > 0 && roadmapPhaseLines.length === completePhaseLines.length,
    audit_status: auditStatus,
    audit_passed: Boolean(auditStatus && /^passed\b/i.test(auditStatus)),
    phases,
  };
}

function scanPhaseEvidence(planningDir) {
  const phasesDir = join(planningDir, 'phases');
  if (!existsSync(phasesDir)) return [];
  const phases = [];
  for (const dirName of readdirSync(phasesDir)) {
    const dirPath = join(phasesDir, dirName);
    if (!existsSync(dirPath)) continue;
    let names = [];
    try {
      names = readdirSync(dirPath);
    } catch {
      continue;
    }
    phases.push({
      dir: dirName,
      plans: names.filter((name) => /-PLAN\.md$/i.test(name)),
      summaries: names.filter((name) => /-SUMMARY\.md$/i.test(name)),
      verifications: names.filter((name) => /-VERIFICATION\.md$/i.test(name)),
    });
  }
  return phases;
}
