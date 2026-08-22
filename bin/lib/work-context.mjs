import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  lstatSync,
  writeFileSync,
  writeSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { basename, dirname, join, relative, resolve } from 'path';
import { collectNativePhaseArtifacts, evaluateLifecycleState, partitionPlanChains } from './lifecycle-state.mjs';
import { resolveStateDir, stateAuthorityGate, STATE_DIR_NAME } from './state-dir.mjs';
import { writeFileAtomic as replaceFileAtomically } from './atomic-write.mjs';

export const WORK_DIR_NAME = STATE_DIR_NAME;

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

export const DECISION_RECORD_TYPES = Object.freeze(['decision', 'lesson', 'rule']);
export const DECISION_RECORD_STATUSES = Object.freeze(['candidate', 'active', 'superseded', 'invalidated']);
export const DECISION_RECORD_SCOPES = Object.freeze(['repo', 'global']);
export const DECISION_AUTHORITY_CLASSIFICATIONS = Object.freeze([
  'candidate',
  'owner_asserted',
  'unreceipted_active',
  'malformed_assertion',
  'non_authoritative',
]);
const DECISION_STALE_AFTER_DAYS = 90;
const DECISION_DIGEST_MAX_RECORDS = 10;
const DECISION_DIGEST_MAX_LINES = 15;
const APPROVAL_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/;
const SENSITIVE_APPROVAL_REF_RE = /(secret|token|password|passwd|bearer|api[-_]?key|credential|private[-_]?key)/i;
const TOKEN_SHAPED_APPROVAL_REF_RE = /^(?:sk(?:[-_]|$)|pk(?:[-_]|$)|gh[pousr]_|github_pat_|xox[baprs]-|eyJ|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{16,})/i;

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
  replaceFileAtomically(filePath, content);
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

export function persistDecisionsDigest(workDir, {
  phase = null,
  digest,
  now = new Date(),
} = {}) {
  const statePath = join(workDir, 'state.json');
  const existing = readJsonIfExists(statePath);
  if (!existing.ok) throw new Error(`cannot persist decisions digest: ${existing.error}`);
  const state = existing.value && typeof existing.value === 'object' && !Array.isArray(existing.value)
    ? { ...existing.value }
    : defaultState(now);
  state.lastDecisionsDigest = {
    phase,
    emitted_at: now.toISOString(),
    records: (digest?.records || []).map((record) => ({
      id: record.id,
      hash: record.hash,
      status: record.status,
      authority: record.authority,
      authority_fingerprint: record.authority_fingerprint,
    })),
  };
  writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state.lastDecisionsDigest;
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

const WORKFLOW_DEFAULTS = Object.freeze({
  plan: { approved: false },
  execution: { status: 'not_started' },
  verification: { status: 'not_started' },
  audit: { status: 'not_started' },
  dogfood: { status: 'not_started' },
});

function workflowStateWithDefaults(workflow = {}) {
  const input = workflow && typeof workflow === 'object' && !Array.isArray(workflow) ? workflow : {};
  const merged = { ...input };
  for (const [key, defaults] of Object.entries(WORKFLOW_DEFAULTS)) {
    merged[key] = { ...defaults, ...(input[key] && typeof input[key] === 'object' && !Array.isArray(input[key]) ? input[key] : {}) };
  }
  return merged;
}

function transitionError(code, message, evidence = []) {
  const error = new Error(message);
  error.code = code;
  error.evidence = evidence;
  return error;
}

/**
 * Persist one validated lifecycle transition without changing any other state
 * fields. Callers must validate artifact identity and authority before calling
 * this seam; the expected values below provide the final stale/replay guard.
 */
export function transitionWorkflowState(workDir, {
  target,
  planPath = null,
  planIdentity = null,
  artifactPath = null,
  artifactIdentity = null,
  authority = null,
  approvalRef = null,
  reason = null,
  question = null,
  approved = null,
  now = new Date(),
} = {}) {
  const statePath = join(workDir, 'state.json');
  const current = readJsonIfExists(statePath);
  if (!current.exists) throw transitionError('missing_state', '`.work/state.json` is missing.', ['.work/state.json']);
  if (!current.ok || !current.value || typeof current.value !== 'object' || Array.isArray(current.value)) {
    throw transitionError('unparseable_state', '`.work/state.json` is not a JSON object.', ['.work/state.json']);
  }
  const state = current.value;
  const workflow = workflowStateWithDefaults(state.workflow);
  const normalizedTarget = String(target || '').trim().toLowerCase();
  const allowed = new Set(['plan', 'execute', 'verify', 'audit', 'next', 'fix_gaps', 'blocked', 'ask_user', 'approve']);
  if (!allowed.has(normalizedTarget)) throw transitionError('unsupported_transition', `Unsupported lifecycle transition: ${target}.`);

  const expectedPlan = planPath || planIdentity;
  const recordedPlan = workflow.plan.path || workflow.plan.identity || null;
  if (recordedPlan && expectedPlan && recordedPlan !== expectedPlan) {
    throw transitionError('stale_state', 'Recorded plan authority does not match the supplied plan artifact.', [String(recordedPlan), String(expectedPlan)]);
  }
  if (artifactPath && artifactIdentity) {
    const recordedArtifact = normalizedTarget === 'verify'
      ? workflow.execution.artifact || workflow.execution.identity
      : workflow.verification.artifact || workflow.verification.identity;
    if (recordedArtifact && recordedArtifact !== artifactPath && recordedArtifact !== artifactIdentity) {
      throw transitionError('stale_state', 'Recorded lifecycle artifact does not match the supplied artifact.', [String(recordedArtifact), String(artifactPath)]);
    }
  }

  const next = JSON.parse(JSON.stringify(state));
  next.workflow = workflow;
  next.workflow.plan = { ...workflow.plan };
  next.workflow.execution = { ...workflow.execution };
  next.workflow.verification = { ...workflow.verification };
  next.workflow.audit = { ...workflow.audit };
  next.workflow.dogfood = { ...workflow.dogfood };
  const normalizedPlan = planPath || planIdentity || null;
  const normalizedArtifact = artifactPath || artifactIdentity || null;
  if (normalizedPlan) {
    next.workflow.plan.path = planPath || workflow.plan.path || null;
    next.workflow.plan.identity = planIdentity || workflow.plan.identity || normalizedPlan;
  }
  if (authority) next.workflow.authority = authority;
  if (approvalRef) next.workflow.approval_ref = approvalRef;

  const effectiveTarget = normalizedTarget === 'approve' ? 'execute' : normalizedTarget === 'next' ? 'audit' : normalizedTarget;
  const currentState = workflow.current_state || state.current_state || 'plan';
  const allowedPredecessors = {
    plan: ['plan', 'fix_gaps', 'blocked', 'ask_user'],
    execute: ['plan', 'execute'],
    verify: ['execute', 'verify'],
    audit: ['verify', 'audit'],
    fix_gaps: ['verify', 'audit', 'fix_gaps'],
    blocked: ['plan', 'execute', 'verify', 'audit', 'fix_gaps', 'blocked', 'ask_user'],
    ask_user: ['plan', 'execute', 'verify', 'audit', 'fix_gaps', 'ask_user'],
  };
  if (allowedPredecessors[effectiveTarget] && !allowedPredecessors[effectiveTarget].includes(currentState)) {
    throw transitionError('out_of_order', `Cannot transition from ${currentState} to ${effectiveTarget}; resolve the recorded lifecycle posture first.`, ['.work/state.json']);
  }
  if (effectiveTarget === 'plan') {
    next.workflow.plan.approved = approved === true;
    next.workflow.execution.status = 'not_started';
    next.workflow.current_state = 'plan';
  } else if (effectiveTarget === 'execute') {
    if (next.workflow.plan.approved !== true && approved !== true) {
      throw transitionError('not_approved', 'The plan artifact is not approved; approve the plan before execution.', [normalizedPlan || '.work/state.json']);
    }
    next.workflow.plan.approved = true;
    next.workflow.execution.status = 'in_progress';
    next.workflow.current_state = 'execute';
  } else if (effectiveTarget === 'verify') {
    next.workflow.execution.status = 'complete';
    if (normalizedArtifact) {
      next.workflow.execution.artifact = artifactPath || workflow.execution.artifact || null;
      next.workflow.execution.identity = artifactIdentity || workflow.execution.identity || normalizedArtifact;
    }
    next.workflow.current_state = 'verify';
  } else if (effectiveTarget === 'audit') {
    next.workflow.verification.status = 'passed';
    if (normalizedArtifact) {
      next.workflow.verification.artifact = artifactPath || workflow.verification.artifact || null;
      next.workflow.verification.identity = artifactIdentity || workflow.verification.identity || normalizedArtifact;
    }
    next.workflow.current_state = 'audit';
  } else if (effectiveTarget === 'fix_gaps') {
    next.workflow.verification.status = 'gaps_found';
    if (normalizedArtifact) {
      next.workflow.verification.artifact = artifactPath || workflow.verification.artifact || null;
      next.workflow.verification.identity = artifactIdentity || workflow.verification.identity || normalizedArtifact;
    }
    next.workflow.current_state = 'fix_gaps';
  } else if (effectiveTarget === 'blocked') {
    if (!String(reason || '').trim()) throw transitionError('missing_reason', 'A blocked transition requires --reason.', ['--reason']);
    next.workflow.status = 'blocked';
    next.workflow.reason = String(reason).trim();
    next.workflow.current_state = 'blocked';
  } else if (effectiveTarget === 'ask_user') {
    if (!String(reason || question || '').trim()) throw transitionError('missing_gate', 'A human gate requires --reason or --question.', ['--reason', '--question']);
    next.workflow.status = 'active';
    next.workflow.human_gate = {
      approved: false,
      reason: String(reason || question).trim(),
      question: question ? String(question).trim() : null,
    };
    next.workflow.current_state = 'ask_user';
  }
  next.current_state = next.workflow.current_state;
  next.status = next.workflow.status === 'blocked' ? 'blocked' : (next.status || 'active');
  const beforeComparable = { ...state, updated_at: null };
  const nextComparable = { ...next, updated_at: null };
  if (JSON.stringify(beforeComparable) === JSON.stringify(nextComparable)) {
    return { status: 'replayed', changed: false, state };
  }
  next.updated_at = now.toISOString();
  writeFileAtomic(statePath, `${JSON.stringify(next, null, 2)}\n`);
  return { status: 'ok', changed: true, state: next };
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
    checkpoint: join(workDir, '.continue-here.md'),
    milestoneDir: join(workDir, 'milestone'),
    rootGoal: join(root, 'goal.md'),
  };
}

export function ensureWorkStructure(cwd = process.cwd(), { now = new Date(), rebuildIndex = true } = {}) {
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
  if (rebuildIndex || !existsSync(paths.index)) {
    rebuildGraphIndex(paths.workDir, { now, write: true });
  }
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
    workflow: {
      plan: { approved: false },
      execution: { status: 'not_started' },
      verification: { status: 'not_started' },
      audit: { status: 'not_started' },
      dogfood: { status: 'not_started' },
    },
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

// Decision records are deliberately file-first. This is separate from the older graph-event
// `recordDecision` API above so existing next/graph callers keep their established contract.
export function writeDecisionRecord(workDir, input, {
  now = new Date(),
  replace = false,
  repoRoot = resolve(workDir, '..'),
  random = createDecisionRandomSuffix,
  session = null,
  agent = null,
} = {}) {
  const timestamp = toIsoDate(now);
  const record = normalizeDecisionInput({ ...input, session: input.session || session, agent: input.agent || agent }, { timestamp, repoRoot });
  const decisionDir = join(workDir, 'decisions');
  ensureDir(decisionDir);

  if (record.supersedes) {
    const predecessor = readDecisionRecordById(workDir, record.supersedes);
    if (!predecessor) {
      throw new Error(`cannot supersede missing decision record ${record.supersedes}`);
    }
  }

  let id = record.id || null;
  let filePath = null;
  let existing = null;
  let complete = null;
  let written = false;
  const maxAttempts = record.id ? 1 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    id = record.id || createDecisionId(record.decision, random);
    filePath = join(decisionDir, `${id}.md`);
    existing = record.id && existsSync(filePath)
      ? parseDecisionRecord(readFileSync(filePath, 'utf-8'), filePath)
      : null;
    if (existing && !replace) {
      if (existing.body === record.body && existing.meta.decision === record.decision) {
        return {
          status: 'unchanged',
          id,
          path: decisionRecordPath(workDir, filePath),
          record: existing,
          duplicateWarnings: [],
        };
      }
      throw new Error(`decision record ${id} already exists with different content; pass replace to overwrite it`);
    }

    complete = {
      ...record,
      id,
      created_at: existing?.meta.created_at || timestamp,
      updated_at: timestamp,
      last_verified: record.last_verified || existing?.meta.last_verified || timestamp,
    };
    complete.hash = hashDecisionBody(complete.body);
    const serialized = renderDecisionRecord(complete);
    if (existing && replace) {
      writeFileAtomic(filePath, serialized);
      written = true;
      break;
    }
    try {
      writeFileSync(filePath, serialized, { flag: 'wx' });
      written = true;
      break;
    } catch (error) {
      if (!record.id && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  if (!written) throw new Error('could not allocate a collision-free decision id after 3 attempts');

  let superseded = null;
  if (complete.supersedes) {
    superseded = transitionSupersededRecord(workDir, complete.supersedes, complete.id, timestamp);
  }

  return {
    status: 'ok',
    id,
    path: decisionRecordPath(workDir, filePath),
    record: parseDecisionRecord(renderDecisionRecord(complete), filePath),
    superseded,
    duplicateWarnings: findDecisionIdentityOverlaps(workDir, complete),
  };
}

export function readDecisionRecords(workDir, { reader = null } = {}) {
  const decisionDir = join(workDir, 'decisions');
  const fsReader = reader || { existsSync, readdirSync, readFileSync };
  let hasDirectory = false;
  try {
    hasDirectory = (fsReader.existsSync || existsSync)(decisionDir);
  } catch (error) {
    return {
      records: [],
      legacyRecords: [],
      invalid: [],
      readErrors: [{ path: decisionRecordPath(workDir, decisionDir), code: error.code || 'directory_read_error' }],
      directoryUnreadable: true,
    };
  }
  if (!hasDirectory) return { records: [], legacyRecords: [], invalid: [], readErrors: [], directoryUnreadable: false };

  let entries;
  try {
    entries = (fsReader.readdirSync || readdirSync)(decisionDir, { withFileTypes: true });
  } catch (error) {
    return {
      records: [],
      legacyRecords: [],
      invalid: [],
      readErrors: [{ path: decisionRecordPath(workDir, decisionDir), code: error.code || 'directory_read_error' }],
      directoryUnreadable: true,
    };
  }

  const records = [];
  const legacyRecords = [];
  const invalid = [];
  const readErrors = [];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const isFile = typeof entry === 'string' || typeof entry.isFile !== 'function' || entry.isFile();
    if (!isFile || !name?.endsWith('.md')) continue;
    const filePath = join(decisionDir, name);
    try {
      const content = (fsReader.readFileSync || readFileSync)(filePath, 'utf-8');
      try {
        records.push(parseDecisionRecord(content, filePath));
      } catch (typedError) {
        const legacy = parseLegacyDecisionRecord(content, filePath, workDir);
        if (!legacy) throw typedError;
        legacyRecords.push(legacy);
      }
    } catch (error) {
      const path = decisionRecordPath(workDir, filePath);
      invalid.push({ path, error: error.message });
      readErrors.push({ path, code: error.code || 'invalid_decision_record' });
    }
  }
  return { records, legacyRecords, invalid, readErrors, directoryUnreadable: false };
}

export function recallDecisions({
  workDir,
  terms = '',
  paths = [],
  type = null,
  status = null,
  limit = Infinity,
  now = new Date(),
} = {}) {
  if (!workDir) throw new Error('workDir is required');
  const scanned = readDecisionRecords(workDir);
  const termQuery = normalizeSearchTerms(terms);
  const pathQuery = normalizeDecisionPaths(paths);
  const requestedTypes = normalizeFilter(type);
  const requestedStatuses = normalizeFilter(status);
  const graph = buildDecisionEdgeMap(scanned.records);
  const staleCutoff = new Date(toIsoDate(now)).getTime() - (DECISION_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const direct = scanned.records
    .filter((record) => record.meta.status !== 'invalidated')
    .filter((record) => requestedTypes.length === 0 || requestedTypes.includes(record.meta.type))
    .filter((record) => requestedStatuses.length === 0 || requestedStatuses.includes(record.meta.status))
    .map((record) => scoreDecisionRecord(record, { terms: termQuery, paths: pathQuery }))
    .filter((result) => result.matches);

  const selected = new Map(direct.map((result) => [result.record.meta.id, result]));
  const queue = direct.map((result) => ({ id: result.record.meta.id, distance: 0 }));
  while (queue.length > 0) {
    const current = queue.shift();
    const neighbours = graph.neighbours.get(current.id) || [];
    for (const neighbourId of neighbours) {
      if (selected.has(neighbourId)) continue;
      const record = graph.byId.get(neighbourId);
      if (!record || record.meta.status === 'invalidated') continue;
      if (requestedTypes.length > 0 && !requestedTypes.includes(record.meta.type)) continue;
      if (requestedStatuses.length > 0 && !requestedStatuses.includes(record.meta.status)) continue;
      const scored = scoreDecisionRecord(record, { terms: termQuery, paths: pathQuery });
      selected.set(neighbourId, { ...scored, matches: true, chainDistance: current.distance + 1, score: scored.score - (current.distance + 1) });
      queue.push({ id: neighbourId, distance: current.distance + 1 });
    }
  }

  const records = [...selected.values()]
    .map((result) => decorateRecallResult(result, graph, staleCutoff))
    .sort(compareRecallResults)
    .slice(0, Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : Infinity);

  return {
    records,
    legacyRecords: scanned.legacyRecords,
    invalid: scanned.invalid,
    query: { terms: String(terms || ''), paths: pathQuery, type: requestedTypes, status: requestedStatuses },
  };
}

export function buildDecisionsDigest({ workDir, phase = null, paths = [], now = new Date(), reader = null } = {}) {
  const scanned = readDecisionRecords(workDir, { reader });
  if (scanned.directoryUnreadable) {
    const digest = {
      records: [],
      legacyRecords: [],
      text: renderDecisionsDigest([]),
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
      truncated: false,
      readErrors: scanned.readErrors,
      ids: [],
    };
    Object.defineProperty(digest, 'directoryUnreadable', { value: true, enumerable: false });
    return digest;
  }
  const phaseRef = phase ? `phase:${phase}`.toLowerCase() : null;
  const pathRefs = normalizeDecisionPaths(paths);
  const graph = buildDecisionEdgeMap(scanned.records);
  const staleCutoff = new Date(toIsoDate(now)).getTime() - (DECISION_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const scoped = scanned.records
    .filter((record) => {
      if (pathRefs.length === 0) return true;
      const forRef = String(record.meta.for || '').trim().toLowerCase();
      if (forRef === '' || forRef === 'repo:current') return true;
      const refs = `${forRef} ${record.meta.links || ''}`;
      return pathRefs.some((pathRef) => refs.includes(pathRef) || pathRef.includes(refs));
    })
    .map((record) => {
      const result = decorateRecallResult({ record, matches: true, score: 0, pathHits: 0, chainDistance: 0 }, graph, staleCutoff);
      const recordRefs = `${record.meta.for || ''} ${record.meta.links || ''}`.toLowerCase();
      const phaseOverlap = phaseRef && recordRefs.includes(phaseRef) ? 1 : 0;
      const pathOverlap = pathRefs.some((pathRef) => recordRefs.includes(pathRef)) ? 1 : 0;
      return { ...result, phaseOverlap, pathOverlap, digestRecency: recencyValue(record.meta.updated_at) };
    })
    // Scope outranks recency, in tiers. A weighted sum cannot work here: recencyValue is an epoch
    // millisecond count, so any additive scope weight small enough to be a weight is ~1e-11 of the
    // total and can never reorder anything.
    .sort((left, right) => (
      (right.phaseOverlap - left.phaseOverlap)
      || (right.pathOverlap - left.pathOverlap)
      || (right.digestRecency - left.digestRecency)
      || compareRecallResults(left, right)
    ));
  const authoritativeActive = scoped.filter((result) => (
    result.record.meta.status === 'active' && result.authority.authoritative
  ));
  const returnedResults = authoritativeActive.slice(0, DECISION_DIGEST_MAX_RECORDS);
  const returnedIds = new Set(returnedResults.map((result) => result.record.meta.id));
  const excluded = {
    candidate: 0,
    superseded: 0,
    invalidated: 0,
    stale_flagged: 0,
    conflict_flagged: 0,
    unreceipted_active: 0,
    malformed_assertion: 0,
    legacy: scanned.legacyRecords.length,
  };
  for (const result of scoped) {
    const status = result.record.meta.status;
    if (status === 'invalidated') excluded.invalidated += 1;
    else if (status === 'superseded') excluded.superseded += 1;
    else if (status === 'candidate') excluded.candidate += 1;
    else if (status === 'active') {
      if (result.authority.classification === 'unreceipted_active') excluded.unreceipted_active += 1;
      else if (result.authority.classification === 'malformed_assertion') excluded.malformed_assertion += 1;
      else if (!returnedIds.has(result.record.meta.id)) {
        if (result.flags.includes('conflict')) excluded.conflict_flagged += 1;
        else if (result.flags.includes('stale')) excluded.stale_flagged += 1;
      }
    }
  }
  const records = returnedResults.map((result) => ({
    id: result.record.meta.id,
    hash: result.record.meta.hash,
    status: result.record.meta.status,
    authority: result.authority.classification,
    authority_fingerprint: result.authority.fingerprint,
  }));
  const activeResults = returnedResults;
  return {
    records,
    legacyRecords: scanned.legacyRecords,
    text: renderDecisionsDigest(activeResults),
    counts: {
      eligible: authoritativeActive.length,
      returned: records.length,
      excluded,
      invalid: scanned.invalid.length,
    },
    truncated: authoritativeActive.length > records.length,
    readErrors: scanned.readErrors,
    ids: records.map((record) => record.id),
  };
}

export function renderDecisionsDigest(results, { heading = 'DECISIONS DIGEST' } = {}) {
  const lines = [`${heading} (${results.length} active)`];
  for (const result of results.slice(0, DECISION_DIGEST_MAX_RECORDS)) {
    lines.push(formatDecisionResultLine(result));
  }
  return lines.slice(0, DECISION_DIGEST_MAX_LINES).join('\n');
}

export function renderDecisionQueryResults(results) {
  const noun = results.length === 1 ? 'record' : 'records';
  return [
    `DECISION QUERY RESULTS (${results.length} ${noun})`,
    ...results.map((result) => formatDecisionResultLine(result, { includeStatus: true })),
  ].join('\n');
}

function formatDecisionResultLine(result, { includeStatus = false } = {}) {
  const legacy = result.record.meta.legacy_ref ? ` [${result.record.meta.legacy_ref}]` : '';
  const status = includeStatus ? ` [status: ${result.record.meta.status}]` : '';
  const authority = includeStatus ? ` [authority: ${result.authority?.classification || classifyDecisionAuthority(result.record).classification}]` : '';
  const flags = result.flags.length > 0 ? ` (${result.flags.join(', ')})` : '';
  return `- ${result.record.meta.id}${legacy}${status}${authority} — ${result.record.meta.decision}${flags}`;
}

export function parseDecisionRecord(content, filePath = null) {
  const envelope = parseDecisionFrontmatter(content);
  if (!envelope) throw new Error('decision record requires YAML-style frontmatter');
  const { meta, body } = envelope;
  for (const field of ['id', 'type', 'status', 'scope', 'decision', 'why', 'for', 'provenance', 'created_at', 'updated_at', 'last_verified', 'hash']) {
    if (!meta[field]) throw new Error(`decision record is missing ${field}`);
  }
  if (!DECISION_RECORD_TYPES.includes(meta.type)) throw new Error(`unsupported decision record type ${meta.type}`);
  if (!DECISION_RECORD_STATUSES.includes(meta.status)) throw new Error(`unsupported decision record status ${meta.status}`);
  if (!DECISION_RECORD_SCOPES.includes(meta.scope)) throw new Error(`unsupported decision record scope ${meta.scope}`);
  const normalizedBody = body.replace(/\n$/, '');
  if (hashDecisionBody(normalizedBody) !== meta.hash) throw new Error(`decision record hash mismatch for ${meta.id}`);
  return { meta, body: normalizedBody, filePath };
}

function parseDecisionFrontmatter(content) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(\n?)([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`invalid decision frontmatter line: ${line}`);
    const key = line.slice(0, separator).trim();
    if (Object.hasOwn(meta, key)) throw new Error(`duplicate decision frontmatter key: ${key}`);
    meta[key] = line.slice(separator + 1).trim();
  }
  return { frontmatter: match[1], meta, separator: match[2], body: match[3] };
}

function parseLegacyDecisionRecord(content, filePath, workDir) {
  let envelope;
  try {
    envelope = parseDecisionFrontmatter(content);
  } catch {
    return null;
  }
  if (!envelope || envelope.separator !== '\n') return null;
  const lines = envelope.frontmatter.split('\n');
  if (lines.length !== 3 && lines.length !== 4) return null;
  if (!lines[0].startsWith('id: ') || !lines[1].startsWith('created_at: ') || !lines[2].startsWith('privacy: ')) return null;
  if (lines.length === 4 && !lines[3].startsWith('supersedes: ')) return null;
  const id = lines[0].slice('id: '.length);
  const createdAt = lines[1].slice('created_at: '.length);
  const privacy = lines[2].slice('privacy: '.length);
  const supersedes = lines.length === 4 ? lines[3].slice('supersedes: '.length) : null;
  const expectedFrontmatter = [
    `id: ${id}`,
    `created_at: ${createdAt}`,
    `privacy: ${privacy}`,
    supersedes === null ? null : `supersedes: ${supersedes}`,
  ].filter((line) => line !== null).join('\n');
  if (envelope.frontmatter !== expectedFrontmatter) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(id) || basename(filePath, '.md') !== id) return null;
  if (!PRIVACY_LEVELS.includes(privacy) || (supersedes !== null && !/^[A-Za-z0-9._-]+$/.test(supersedes))) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) return null;
  try {
    if (new Date(createdAt).toISOString() !== createdAt) return null;
  } catch {
    return null;
  }
  if (!/^\n# (?=[^\n]*\S)[^\n]*\n\n[\s\S]*\n$/.test(envelope.body)) return null;
  return { id, path: decisionRecordPath(workDir, filePath), format: 'next_graph_v1' };
}

export function hashDecisionBody(body) {
  return createHash('sha256').update(String(body || '').replace(/\r\n/g, '\n')).digest('hex');
}

export function isValidApprovalReference(value) {
  const normalized = normalizeApprovalReference(value);
  return Boolean(normalized)
    && APPROVAL_REF_RE.test(normalized)
    && !SENSITIVE_APPROVAL_REF_RE.test(normalized)
    && !TOKEN_SHAPED_APPROVAL_REF_RE.test(normalized)
    && !/^[a-f0-9]{32,}$/i.test(normalized);
}

export function normalizeApprovalReference(value) {
  return String(value || '').trim();
}

export function computeDecisionAuthorityFingerprint({
  id,
  bodyHash,
  authority,
  approvalRef,
  approvedAt,
} = {}) {
  return createHash('sha256')
    .update([id, bodyHash, authority, approvalRef, approvedAt].map((value) => String(value || '')).join('\u0000'))
    .digest('hex');
}

export function classifyDecisionAuthority(record) {
  const meta = record?.meta || record || {};
  const status = meta.status;
  if (status === 'candidate') {
    const hasAssertion = ['approval_authority', 'approval_ref', 'approval_body_hash', 'approved_at', 'authority_fingerprint']
      .some((field) => Object.hasOwn(meta, field));
    return hasAssertion
      ? { classification: 'malformed_assertion', authoritative: false, fingerprint: null, reason: 'candidate carries approval metadata' }
      : { classification: 'candidate', authoritative: false, fingerprint: null, reason: 'candidate requires explicit owner assertion' };
  }
  if (status !== 'active') {
    return { classification: 'non_authoritative', authoritative: false, fingerprint: null, reason: `status is ${status || 'unknown'}` };
  }

  const fields = ['approval_authority', 'approval_ref', 'approval_body_hash', 'approved_at', 'authority_fingerprint'];
  const present = fields.filter((field) => Object.hasOwn(meta, field));
  if (present.length === 0) {
    return { classification: 'unreceipted_active', authoritative: false, fingerprint: null, reason: 'active record has no owner assertion' };
  }
  let approvedAtIsCanonical = false;
  try {
    approvedAtIsCanonical = toIsoDate(meta.approved_at) === meta.approved_at;
  } catch {
    approvedAtIsCanonical = false;
  }
  if (present.length !== fields.length
    || meta.approval_authority !== 'owner'
    || !isValidApprovalReference(meta.approval_ref)
    || meta.approval_body_hash !== meta.hash
    || !approvedAtIsCanonical) {
    return { classification: 'malformed_assertion', authoritative: false, fingerprint: null, reason: 'active record has malformed owner assertion' };
  }
  const fingerprint = computeDecisionAuthorityFingerprint({
    id: meta.id,
    bodyHash: meta.hash,
    authority: meta.approval_authority,
    approvalRef: meta.approval_ref,
    approvedAt: meta.approved_at,
  });
  if (meta.authority_fingerprint !== fingerprint) {
    return { classification: 'malformed_assertion', authoritative: false, fingerprint: null, reason: 'owner assertion fingerprint does not match' };
  }
  return { classification: 'owner_asserted', authoritative: true, fingerprint, reason: null };
}

export function transitionDecisionRecord(workDir, id, operation, {
  reason = null,
  authority = null,
  approvalRef = null,
  now = new Date(),
} = {}) {
  const record = readDecisionRecordById(workDir, id);
  if (!record) throw new Error(`decision record not found: ${id}`);
  const currentStatus = record.meta.status;
  const allowed = {
    promote: 'candidate',
    reject: 'candidate',
    invalidate: 'active',
  }[operation];
  if (!allowed) throw new Error(`unsupported decision operation ${operation}`);
  if (operation === 'promote') {
    approvalRef = normalizeApprovalReference(approvalRef);
    if (authority !== 'owner' || !isValidApprovalReference(approvalRef)) {
      throw new Error('promote requires --authority owner --approval-ref <non-sensitive-ref>');
    }
    const classification = classifyDecisionAuthority(record);
    if (!['candidate', 'unreceipted_active'].includes(classification.classification)) {
      if (classification.classification === 'malformed_assertion') {
        throw new Error('cannot promote record with malformed owner assertion; review the record before retrying');
      }
      if (classification.classification === 'owner_asserted') {
        throw new Error(`cannot promote record with status ${currentStatus}; record is already owner-asserted`);
      }
    }
    if (!['candidate', 'active'].includes(currentStatus)) {
      throw new Error(`cannot promote record with status ${currentStatus}`);
    }
  } else if (currentStatus !== allowed) {
    throw new Error(`cannot ${operation} record with status ${currentStatus}`);
  }
  if (operation === 'invalidate' && !String(reason || '').trim()) {
    throw new Error('invalidate requires --reason <text>');
  }

  const next = {
    ...record.meta,
    status: operation === 'promote' ? 'active' : 'invalidated',
    updated_at: now.toISOString(),
    hash: record.meta.hash,
    body: record.body,
  };
  if (operation === 'promote') {
    next.approval_authority = authority;
    next.approval_ref = approvalRef;
    next.approval_body_hash = record.meta.hash;
    next.approved_at = now.toISOString();
    next.authority_fingerprint = computeDecisionAuthorityFingerprint({
      id: record.meta.id,
      bodyHash: record.meta.hash,
      authority,
      approvalRef,
      approvedAt: next.approved_at,
    });
  } else next.invalidation_reason = String(reason || 'rejected').trim();
  writeFileAtomic(record.filePath, renderDecisionRecord(next));
  return parseDecisionRecord(renderDecisionRecord(next), record.filePath);
}

function normalizeDecisionInput(input = {}, { timestamp, repoRoot }) {
  const type = input.type || 'decision';
  const status = input.status || 'candidate';
  const scope = input.scope || 'repo';
  if (!DECISION_RECORD_TYPES.includes(type)) throw new Error(`unsupported decision record type ${type}`);
  if (!DECISION_RECORD_STATUSES.includes(status)) throw new Error(`unsupported decision record status ${status}`);
  if (!DECISION_RECORD_SCOPES.includes(scope)) throw new Error(`unsupported decision record scope ${scope}`);

  const decision = oneLine(input.decision || input.title, 'decision');
  const why = oneLine(input.why || 'Captured for recall and explicit verification.', 'why');
  const rawBody = String(input.body || '').replace(/\r\n/g, '\n').trimEnd();
  if (!rawBody.trim()) throw new Error('decision record body is required');
  const body = ensureDecisionEvidenceSection(rawBody);
  const id = input.id ? normalizeDecisionId(input.id) : null;
  const provenance = buildDecisionProvenance(repoRoot, input.provenance, input.session, input.agent);
  return {
    id,
    type,
    status,
    scope,
    decision,
    why,
    for: oneLine(input.for || input.forRefs || 'repo:current', 'for'),
    links: formatDecisionLinks(input.links),
    people: input.people ? oneLine(input.people, 'people') : null,
    supersedes: input.supersedes ? normalizeDecisionId(input.supersedes) : null,
    superseded_by: input.superseded_by ? normalizeDecisionId(input.superseded_by) : null,
    legacy_ref: input.legacy_ref ? oneLine(input.legacy_ref, 'legacy_ref') : null,
    source: input.source ? oneLine(input.source, 'source') : null,
    approval_authority: input.approval_authority ? oneLine(input.approval_authority, 'approval_authority') : null,
    approval_ref: input.approval_ref ? oneLine(input.approval_ref, 'approval_ref') : null,
    approval_body_hash: input.approval_body_hash ? oneLine(input.approval_body_hash, 'approval_body_hash') : null,
    approved_at: input.approved_at ? oneLine(input.approved_at, 'approved_at') : null,
    authority_fingerprint: input.authority_fingerprint ? oneLine(input.authority_fingerprint, 'authority_fingerprint') : null,
    provenance,
    created_at: timestamp,
    updated_at: timestamp,
    last_verified: input.last_verified ? toIsoDate(input.last_verified) : timestamp,
    body,
  };
}

function ensureDecisionEvidenceSection(body) {
  const header = body.match(/^## Evidence\s*$/m);
  if (!header) return `## Evidence\n\n${body}`;
  if (!body.slice(header.index + header[0].length).trim()) throw new Error('decision record body is required');
  return body;
}

function renderDecisionRecord(record) {
  const frontmatter = [
    ['id', record.id],
    ['type', record.type],
    ['status', record.status],
    ['scope', record.scope],
    ['decision', record.decision],
    ['why', record.why],
    ['for', record.for],
    ['links', record.links],
    ['people', record.people],
    ['supersedes', record.supersedes],
    ['superseded_by', record.superseded_by],
    ['legacy_ref', record.legacy_ref],
    ['source', record.source],
    ['approval_authority', record.approval_authority],
    ['approval_ref', record.approval_ref],
    ['approval_body_hash', record.approval_body_hash],
    ['approved_at', record.approved_at],
    ['authority_fingerprint', record.authority_fingerprint],
    ['invalidation_reason', record.invalidation_reason],
    ['provenance', record.provenance],
    ['created_at', record.created_at],
    ['updated_at', record.updated_at],
    ['last_verified', record.last_verified],
    ['hash', record.hash],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${oneLine(value, key)}`);
  return ['---', ...frontmatter, '---', record.body, ''].join('\n');
}

function transitionSupersededRecord(workDir, predecessorId, successorId, timestamp) {
  const predecessor = readDecisionRecordById(workDir, predecessorId);
  if (!predecessor) throw new Error(`cannot supersede missing decision record ${predecessorId}`);
  const next = {
    ...predecessor.meta,
    status: 'superseded',
    superseded_by: successorId,
    updated_at: timestamp,
    hash: hashDecisionBody(predecessor.body),
    body: predecessor.body,
  };
  writeFileAtomic(predecessor.filePath, renderDecisionRecord(next));
  return { id: predecessorId, path: decisionRecordPath(workDir, predecessor.filePath) };
}

function readDecisionRecordById(workDir, id) {
  const filePath = join(workDir, 'decisions', `${normalizeDecisionId(id)}.md`);
  if (!existsSync(filePath)) return null;
  return parseDecisionRecord(readFileSync(filePath, 'utf-8'), filePath);
}

function findDecisionIdentityOverlaps(workDir, candidate) {
  const candidateTokens = identityTokens(candidate.decision);
  if (candidateTokens.length === 0) return [];
  return readDecisionRecords(workDir).records
    .filter((record) => record.meta.id !== candidate.id && record.meta.status !== 'invalidated')
    .map((record) => {
      const existingTokens = identityTokens(record.meta.decision);
      const overlap = candidateTokens.filter((token) => existingTokens.includes(token));
      const ratio = overlap.length / Math.min(candidateTokens.length, Math.max(1, existingTokens.length));
      return { id: record.meta.id, overlap, ratio };
    })
    .filter((entry) => entry.overlap.length >= 2 && entry.ratio >= 0.6)
    .map((entry) => ({ ...entry, suggestion: `consider supersedes: ${entry.id}` }));
}

function buildDecisionEdgeMap(records) {
  const byId = new Map(records.map((record) => [record.meta.id, record]));
  const neighbours = new Map(records.map((record) => [record.meta.id, new Set()]));
  const successors = new Map(records.map((record) => [record.meta.id, new Set()]));
  const connect = (from, to) => {
    if (!byId.has(from) || !byId.has(to)) return;
    neighbours.get(from).add(to);
    neighbours.get(to).add(from);
    successors.get(from).add(to);
  };
  for (const record of records) {
    if (record.meta.supersedes) connect(record.meta.supersedes, record.meta.id);
    if (record.meta.superseded_by) connect(record.meta.id, record.meta.superseded_by);
  }
  return {
    byId,
    neighbours: new Map([...neighbours.entries()].map(([id, values]) => [id, [...values]])),
    successors: new Map([...successors.entries()].map(([id, values]) => [id, [...values]])),
  };
}

function scoreDecisionRecord(record, { terms, paths }) {
  const searchable = `${record.meta.id}\n${record.meta.decision}\n${record.meta.why}\n${stripBoilerplateFor(record.meta.for)}\n${record.meta.links || ''}`.toLowerCase();
  const refs = `${record.meta.for}\n${record.meta.links || ''}`.toLowerCase();
  const pathHits = paths.filter((path) => refs.includes(path) || path.includes(refs)).length;
  if (paths.length > 0 && pathHits === 0) return { record, matches: false, score: 0, pathHits: 0, chainDistance: 0 };
  if (!terms.phrase && terms.tokens.length === 0) return { record, matches: true, score: pathHits * 20, pathHits, chainDistance: 0 };
  const phraseHit = terms.phrase ? searchable.includes(terms.phrase) : false;
  const tokenHits = terms.tokens.filter((token) => searchable.includes(token));
  const threshold = terms.tokens.length <= 1 ? 1 : Math.max(1, Math.ceil(terms.tokens.length * 0.25));
  const matches = phraseHit || tokenHits.length >= threshold;
  return {
    record,
    matches,
    score: (phraseHit ? 100 : 0) + (tokenHits.length * 10) + (pathHits * 20),
    pathHits,
    chainDistance: 0,
  };
}

function stripBoilerplateFor(value) {
  return String(value || '').replace(/\brepo:current\b/gi, '');
}

function decorateRecallResult(result, graph, staleCutoff) {
  const successorIds = (graph.successors.get(result.record.meta.id) || [])
    .filter((id) => ['candidate', 'active'].includes(graph.byId.get(id)?.meta.status));
  const stale = new Date(result.record.meta.last_verified).getTime() < staleCutoff;
  const flags = [];
  if (stale) flags.push('stale');
  if (successorIds.length >= 2) flags.push('conflict');
  return {
    ...result,
    stale,
    flags,
    conflictSuccessors: successorIds,
    authority: classifyDecisionAuthority(result.record),
  };
}

function compareRecallResults(left, right) {
  return right.score - left.score ||
    left.chainDistance - right.chainDistance ||
    recencyValue(right.record.meta.updated_at) - recencyValue(left.record.meta.updated_at) ||
    left.record.meta.id.localeCompare(right.record.meta.id);
}

function normalizeSearchTerms(terms) {
  const phrase = String(Array.isArray(terms) ? terms.join(' ') : terms || '').trim().toLowerCase();
  const stopWords = new Set(['a', 'an', 'and', 'are', 'did', 'for', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'we', 'what', 'which', 'why', 'with']);
  const tokens = [...new Set((phrase.match(/[a-z0-9_./:-]+/g) || []).flatMap((token) => {
    const components = token.split('/');
    return components.length > 1 && components.every((component) => /^[a-z0-9-]+$/.test(component))
      ? components
      : [token];
  }).filter((token) => token.length > 1 && !stopWords.has(token)))];
  return { phrase, tokens };
}

function normalizeDecisionPaths(paths) {
  const values = Array.isArray(paths) ? paths : [paths];
  return values
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => normalizeSlashes(value).trim().toLowerCase())
    .filter(Boolean);
}

function normalizeFilter(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function createDecisionId(decision, random) {
  return `${slugifyDecision(decision)}-${String(random()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, '0')}`;
}

function createDecisionRandomSuffix() {
  return randomBytes(3).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
}

function slugifyDecision(value) {
  const slug = String(value || 'decision').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return slug || 'decision';
}

function normalizeDecisionId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*-[a-z0-9]{4}$/.test(id)) {
    throw new Error(`decision record id must be slug-4char: ${value}`);
  }
  return id;
}

function buildDecisionProvenance(repoRoot, label, session, agent) {
  const branch = readGitValue(repoRoot, ['branch', '--show-current']) || 'detached';
  const head = readGitValue(repoRoot, ['rev-parse', 'HEAD']) || 'unknown';
  const parts = [label || null, `branch=${branch}`, `head=${head}`, `session=${session || process.env.CODEX_SESSION_ID || 'unknown'}`, `agent=${agent || process.env.CODEX_AGENT_ID || 'gsdd'}`];
  return parts.filter(Boolean).join('; ');
}

function readGitValue(repoRoot, args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function formatDecisionLinks(links) {
  if (!links) return null;
  if (typeof links === 'string') return oneLine(links, 'links');
  return ['code', 'commit', 'pr']
    .filter((key) => links[key])
    .map((key) => `${key}=${oneLine(links[key], `links.${key}`)}`)
    .join(', ') || null;
}

function oneLine(value, field) {
  const normalized = String(value || '').replace(/\s*\r?\n\s*/g, ' ').trim();
  if (!normalized) throw new Error(`decision record ${field} is required`);
  return normalized;
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ISO date: ${value}`);
  return date.toISOString();
}

function identityTokens(value) {
  return [...new Set((String(value || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((token) => !['decision', 'record', 'rule'].includes(token)))];
}

function decisionRecordPath(workDir, filePath) {
  return normalizeSlashes(relative(resolve(workDir, '..'), filePath));
}

function recencyValue(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
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

const CHECKPOINT_FRONTMATTER_FIELDS = Object.freeze(['workflow', 'phase', 'timestamp', 'runtime']);
const CHECKPOINT_REQUIRED_SECTIONS = Object.freeze([
  'current_state',
  'completed_work',
  'remaining_work',
  'decisions',
  'blockers',
  'next_action',
]);
const CHECKPOINT_JUDGMENT_SECTIONS = Object.freeze([
  'active_constraints',
  'unresolved_uncertainty',
  'decision_posture',
  'anti_regression',
]);
const CHECKPOINT_ERROR_LIMIT = 12;
const CHECKPOINT_MAX_BYTES = 256 * 1024;

function checkpointError(errors, message) {
  if (errors.length < CHECKPOINT_ERROR_LIMIT) errors.push(message);
}

function parseCheckpointFrontmatter(content, errors) {
  if (!content.startsWith('---\n')) {
    checkpointError(errors, 'checkpoint must begin with a YAML frontmatter delimiter');
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    checkpointError(errors, 'checkpoint frontmatter is not closed');
    return { frontmatter: {}, body: '' };
  }
  const frontmatter = {};
  const seen = new Set();
  const lines = content.slice(4, end).split('\n');
  for (const line of lines) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!match) {
      checkpointError(errors, 'invalid checkpoint frontmatter line');
      continue;
    }
    const [, key, value] = match;
    if (!CHECKPOINT_FRONTMATTER_FIELDS.includes(key)) {
      checkpointError(errors, `unsupported checkpoint frontmatter field: ${key}`);
      continue;
    }
    if (seen.has(key)) {
      checkpointError(errors, `duplicate checkpoint frontmatter field: ${key}`);
      continue;
    }
    seen.add(key);
    if (!value.trim()) checkpointError(errors, `empty checkpoint frontmatter field: ${key}`);
    frontmatter[key] = value.trim();
  }
  for (const key of CHECKPOINT_FRONTMATTER_FIELDS) {
    if (!seen.has(key)) checkpointError(errors, `missing checkpoint frontmatter field: ${key}`);
  }
  if (frontmatter.workflow && !['phase', 'quick', 'generic'].includes(frontmatter.workflow)) {
    checkpointError(errors, 'unsupported checkpoint workflow');
  }
  if (frontmatter.timestamp && Number.isNaN(Date.parse(frontmatter.timestamp))) {
    checkpointError(errors, 'invalid checkpoint timestamp');
  }
  return { frontmatter, body: content.slice(end + 5) };
}

function extractCheckpointSections(content, sectionNames, errors, label = 'checkpoint') {
  const sections = {};
  for (const name of sectionNames) {
    const matcher = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
    const matches = [...content.matchAll(matcher)];
    if (matches.length === 0) {
      checkpointError(errors, `missing ${label} section: ${name}`);
      continue;
    }
    if (matches.length > 1) {
      checkpointError(errors, `duplicate ${label} section: ${name}`);
      continue;
    }
    sections[name] = matches[0][1].trim();
  }
  return sections;
}

/**
 * Read the explicit pause checkpoint without modifying it. Its prose is local
 * continuity context only; lifecycle and repository artifacts remain authority.
 */
export function readContinuityCheckpoint(planningDir) {
  const resolvedPlanningDir = resolve(planningDir);
  const workspaceRoot = resolve(resolvedPlanningDir, '..');
  const checkpointPath = join(resolvedPlanningDir, '.continue-here.md');
  const path = normalizeSlashes(relative(workspaceRoot, checkpointPath));
  const base = { path, status: 'absent', frontmatter: null, sections: null, judgment: null, errors: [] };

  try {
    const entry = lstatSync(checkpointPath);
    if (!entry.isFile()) return { ...base, status: 'unreadable', errors: ['cannot read checkpoint'] };
    if (entry.size > CHECKPOINT_MAX_BYTES) return { ...base, status: 'malformed', errors: ['checkpoint exceeds read limit'] };
  } catch (error) {
    if (error?.code === 'ENOENT') return base;
    return { ...base, status: 'unreadable', errors: ['cannot read checkpoint'] };
  }

  let content;
  try {
    content = readFileSync(checkpointPath, 'utf-8').replace(/\r\n/g, '\n');
  } catch {
    return { ...base, status: 'unreadable', errors: ['cannot read checkpoint'] };
  }

  const errors = [];
  const { frontmatter, body } = parseCheckpointFrontmatter(content, errors);
  const sections = extractCheckpointSections(body, CHECKPOINT_REQUIRED_SECTIONS, errors);
  const judgmentMatches = [...body.matchAll(/<judgment>([\s\S]*?)<\/judgment>/g)];
  let judgment = null;
  if (judgmentMatches.length > 1) {
    checkpointError(errors, 'duplicate checkpoint judgment block');
  } else if (judgmentMatches.length === 1) {
    judgment = extractCheckpointSections(judgmentMatches[0][1], CHECKPOINT_JUDGMENT_SECTIONS, errors, 'checkpoint judgment');
  }

  return {
    path,
    status: errors.length === 0 ? 'valid' : 'malformed',
    frontmatter,
    sections,
    judgment,
    errors,
  };
}

export function inspectWorkContext(cwd = process.cwd()) {
  const paths = getWorkPaths(cwd);
  const state = readJsonIfExists(paths.state);
  const questions = readOpenQuestions(paths.workDir);
  const evidence = readJsonIfExists(paths.evidenceManifest);
  const graph = readGraphEvents(paths.workDir);
  const stateRoot = resolveStateDir(paths.root);
  const { dir: planningDir, name: stateDirName, migrationNotice } = stateRoot;
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
    phases: scanPhaseEvidence(planningDir, lifecycle),
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
    state_root: stateRoot,
    authority_gate: stateAuthorityGate(stateRoot),
    migration_notice: migrationNotice,
    checkpoint: readContinuityCheckpoint(planningDir),
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
  const phaseEntries = [];
  if (existsSync(phasesDir)) {
    for (const dirName of readdirSync(phasesDir)) {
      const dirPath = join(phasesDir, dirName);
      let names = [];
      try {
        names = readdirSync(dirPath);
      } catch {
        continue;
      }
      phaseEntries.push(dirName);
    }
  }
  const artifacts = collectNativePhaseArtifacts({ workspaceRoot: resolve(workDir, '..'), phasesDir });
  for (const artifact of artifacts) {
    if (!phaseEntries.includes(artifact.dir)) phaseEntries.push(artifact.dir);
  }
  const { currentArtifacts, historicalArtifacts } = partitionPlanChains(artifacts, { companionKinds: ['execute', 'verification'] });
  const phases = phaseEntries.map((dir) => ({
    dir,
    plans: currentArtifacts.filter((artifact) => artifact.dir === dir && artifact.kind === 'plan').map((artifact) => artifact.name),
    executes: currentArtifacts.filter((artifact) => artifact.dir === dir && artifact.kind === 'execute').map((artifact) => artifact.name),
    verifies: currentArtifacts.filter((artifact) => artifact.dir === dir && artifact.kind === 'verification').map((artifact) => artifact.name),
    historical_plans: historicalArtifacts.filter((artifact) => artifact.dir === dir && artifact.kind === 'plan').map((artifact) => artifact.name),
    historical_executes: historicalArtifacts.filter((artifact) => artifact.dir === dir && artifact.kind === 'execute').map((artifact) => artifact.name),
    historical_verifies: historicalArtifacts.filter((artifact) => artifact.dir === dir && artifact.kind === 'verification').map((artifact) => artifact.name),
  }));
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
    actionable_phase_packet_count: phases.reduce((count, phase) => count + phase.plans.length + phase.executes.length, 0),
    historical_phase_packet_count: phases.reduce((count, phase) => count + phase.historical_plans.length + phase.historical_executes.length + phase.historical_verifies.length, 0),
    roadmap_phase_count: roadmapPhaseLines.length,
    roadmap_complete_phase_count: completePhaseLines.length,
    roadmap_all_complete: roadmapPhaseLines.length > 0 && roadmapPhaseLines.length === completePhaseLines.length,
    audit_status: auditStatus,
    audit_passed: Boolean(auditStatus && /^passed\b/i.test(auditStatus)),
    phases,
  };
}

function scanPhaseEvidence(planningDir, lifecycle) {
  const byDir = new Map();
  const phasesDir = join(planningDir, 'phases');
  if (existsSync(phasesDir)) {
    for (const dir of readdirSync(phasesDir)) {
      try {
        readdirSync(join(phasesDir, dir));
      } catch {
        continue;
      }
      byDir.set(dir, {
        dir,
        plans: [], summaries: [], verifications: [],
        historical_plans: [], historical_summaries: [],
      });
    }
  }
  for (const artifact of [...lifecycle.phaseArtifacts, ...lifecycle.historicalPhaseArtifacts]) {
    if (!byDir.has(artifact.dir)) byDir.set(artifact.dir, {
      dir: artifact.dir,
      plans: [], summaries: [], verifications: [],
      historical_plans: [], historical_summaries: [],
    });
  }
  for (const artifact of lifecycle.phaseArtifacts) {
    const phase = byDir.get(artifact.dir);
    if (artifact.kind === 'plan') phase.plans.push(artifact.name);
    if (artifact.kind === 'summary') phase.summaries.push(artifact.name);
    if (artifact.kind === 'verification') phase.verifications.push(artifact.name);
  }
  for (const artifact of lifecycle.historicalPhaseArtifacts) {
    const phase = byDir.get(artifact.dir);
    if (artifact.kind === 'plan') phase.historical_plans.push(artifact.name);
    if (artifact.kind === 'summary') phase.historical_summaries.push(artifact.name);
  }
  return [...byDir.values()];
}
