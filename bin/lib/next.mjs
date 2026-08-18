import { join, relative } from 'path';
import { existsSync } from 'fs';
import { output, parseFlagValue } from './cli-utils.mjs';
import { buildControlMap } from './control-map.mjs';
import { resolveStateDir, stateAuthorityGate } from './state-dir.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import {
  NEXT_STATES,
  addOpenQuestion,
  answerQuestion,
  captureDogfoodFinding,
  buildDecisionsDigest,
  ensureWorkStructure,
  getWorkPaths,
  inspectWorkContext,
  readJsonIfExists,
  rebuildGraphIndex,
  recordDecision,
} from './work-context.mjs';

const NEXT_USAGE = [
  'Usage:',
  '  gsdd next [--json] [--format auto|json|human]',
  '  gsdd next --init [--json] [--format auto|json|human]',
  '  gsdd next graph rebuild [--json] [--format auto|json|human]',
  '  gsdd next question add --id <id> --prompt <text> [--default <text>] [--gate <type>] [--blocking <true|false>] [--replace] [--json]',
  '  gsdd next question answer --id <id> --answer <text> [--json]',
  '  gsdd next decision record --id <id> --title <text> --body <text> [--supersedes <id>] [--privacy <public|repo|local_only|secret_risk>] [--replace] [--json]',
  '  gsdd next dogfood capture --id <id> --title <text> --body <text> [--backlog <pointer>] [--replace] [--json]',
].join('\n');

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function removeFlags(args, flags) {
  return args.filter((arg, index) => {
    if (flags.includes(arg)) return false;
    if (index > 0 && flags.includes(args[index - 1])) return false;
    return true;
  });
}

function boolFlagValue(value, fallback = true) {
  if (value === null || value === undefined) return fallback;
  if (String(value).toLowerCase() === 'false') return false;
  if (String(value).toLowerCase() === 'true') return true;
  return fallback;
}

function outputMode(args) {
  if (args.includes('--json')) return 'json';
  const format = parseFlagValue(args, '--format');
  const value = format.value || 'auto';
  if (!['auto', 'json', 'human'].includes(value)) {
    throw new Error('Usage: gsdd next [--json] [--format auto|json|human]');
  }
  if (value === 'json') return 'json';
  if (value === 'human') return 'human';
  return process.stdout.isTTY ? 'human' : 'json';
}

function packet(overrides) {
  const state = overrides.state || 'blocked';
  if (!NEXT_STATES.includes(state)) throw new Error(`unsupported next state: ${state}`);
  return {
    schema_version: 1,
    operation: 'next',
    state,
    reason: overrides.reason || '',
    confidence: overrides.confidence || 'medium',
    next_command: overrides.next_command || null,
    next_action: overrides.next_action || null,
    authority: overrides.authority || null,
    route_kind: overrides.route_kind || null,
    blocked_by: overrides.blocked_by || [],
    requires_user: Boolean(overrides.requires_user),
    questions: overrides.questions || [],
    constraints: overrides.constraints || [],
    evidence_required: overrides.evidence_required || [],
    artifacts_to_read: overrides.artifacts_to_read || [],
    artifacts_to_write: overrides.artifacts_to_write || [],
    error_code: overrides.error_code || null,
    repair_action: overrides.repair_action || null,
    repair_targets: overrides.repair_targets || [],
    repo_warnings: overrides.repo_warnings || [],
    privacy_notes: overrides.privacy_notes || [],
    inputs_considered: overrides.inputs_considered || [],
    inputs_skipped: overrides.inputs_skipped || [],
    trace_refs: overrides.trace_refs || [],
    continuity: overrides.continuity || null,
  };
}

function cliAction(argv, description) {
  return {
    type: 'cli_command',
    command: ['gsdd', ...argv].join(' '),
    argv,
    description,
  };
}

function workflowAction(skillId, description) {
  return {
    type: 'workflow_skill',
    skill_id: skillId,
    description,
  };
}

function manualReviewAction(targets, description) {
  return {
    type: 'manual_review',
    targets,
    description,
  };
}

function stateDirName(context) {
  return context?.planning?.state_dir_name || '.work';
}

function statePath(context, relativePath = '') {
  const dirName = stateDirName(context);
  return relativePath ? `${dirName}/${relativePath}` : dirName;
}

function milestonePath(context, relativePath = '') {
  const milestoneDir = context?.milestone?.dir;
  const root = context?.paths?.root;
  const resolvedDir = milestoneDir && root
    ? normalizeSlashes(relative(root, milestoneDir))
    : statePath(context, 'milestone');
  return relativePath ? `${resolvedDir}/${relativePath}` : resolvedDir;
}

function userQuestionAction(questionIds, description) {
  return {
    type: 'user_question',
    question_ids: questionIds,
    description,
  };
}

function summarizeControlMap(cwd) {
  try {
    const stateDir = resolveStateDir(cwd).dir;
    return buildControlMap({
      workspaceRoot: cwd,
      planningDir: stateDir,
    });
  } catch (error) {
    return {
      operation: 'control-map',
      error: error.message,
      risks: [{ code: 'control_map_failed', severity: 'warn', message: error.message }],
    };
  }
}

function readManifestStatus(context) {
  if (!context.evidence.ok) {
    return {
      manifest: null,
      error: context.evidence.error,
    };
  }
  return { manifest: context.evidence.value || {}, error: null };
}

function repoWarningsFromControlMap(controlMap) {
  return (controlMap.risks || [])
    .filter((risk) => risk.code === 'canonical_dirty' || risk.severity === 'block')
    .map((risk) => risk.message);
}

function controlMapBlockers(controlMap) {
  return (controlMap.risks || [])
    .filter((risk) => risk.severity === 'block')
    .map((risk) => risk.code);
}

function hasActiveBrownfieldChange(context) {
  return brownfieldPosture(context) === 'active';
}

function brownfieldPosture(context) {
  if (!context.planning.has_brownfield_change) return null;
  const status = String(context.planning.brownfield_change?.currentStatus || '').trim().toLowerCase();
  if (status === 'closed') return 'closed';
  if (status === 'ready_for_verification') return 'ready_for_verification';
  if (status === 'blocked') return 'blocked';
  return 'active';
}

function routeFromStateObject(stateValue) {
  const state = stateValue || {};
  const workflow = state.workflow || state.milestone || state;
  if (workflow.status === 'paused') return { state: 'pause', reason: 'Local `.work/state.json` marks work as paused.' };
  if (workflow.status === 'blocked') return { state: 'blocked', reason: 'Local `.work/state.json` marks work as blocked.' };
  if (workflow.human_gate && workflow.human_gate.approved !== true) {
    return {
      state: 'ask_user',
      reason: workflow.human_gate.reason || 'A recorded human gate requires approval before continuing.',
      questions: workflow.human_gate.question ? [workflow.human_gate] : [],
    };
  }
  if (workflow.plan?.approved === true && workflow.execution?.status !== 'complete') {
    return { state: 'execute', reason: 'A plan is approved and execution is not complete.' };
  }
  if (workflow.execution?.status === 'complete' && workflow.verification?.status !== 'passed') {
    return { state: 'verify', reason: 'Execution is complete and verification has not passed.' };
  }
  if (workflow.verification?.status === 'gaps_found' || workflow.audit?.status === 'gaps_found') {
    return { state: 'fix_gaps', reason: 'Verification or audit recorded gaps.' };
  }
  if (workflow.verification?.status === 'passed' && workflow.audit?.status !== 'passed') {
    return { state: 'audit', reason: 'Verification passed and milestone audit has not passed.' };
  }
  if (workflow.audit?.status === 'passed' && workflow.dogfood?.status !== 'captured') {
    return { state: 'dogfood', reason: 'Audit passed and no dogfood finding has been captured.' };
  }
  if (workflow.audit?.status === 'passed' && workflow.dogfood?.status === 'captured') {
    if (workflow.completion_approved === true) {
      return { state: 'complete', reason: 'Audit passed, dogfood was captured, and completion was approved.' };
    }
    return {
      state: 'ask_user',
      reason: 'Milestone appears complete, but declaring completion is a human gate.',
      questions: [{
        id: 'completion-approval',
        question: 'Approve declaring this milestone complete?',
        default: 'No automatic completion; review audit evidence first.',
        gate: 'completion',
        blocking: true,
      }],
    };
  }
  if (workflow.current_state && workflow.current_state !== 'plan' && NEXT_STATES.includes(workflow.current_state)) {
    if (workflow.current_state === 'complete' && workflow.completion_approved !== true) {
      return {
        state: 'ask_user',
        reason: 'Recorded state requests completion, but declaring completion is a human gate.',
        questions: [{
          id: 'completion-approval',
          question: 'Approve declaring this milestone complete?',
          default: 'No automatic completion; review audit evidence first.',
          gate: 'completion',
          blocking: true,
        }],
      };
    }
    return { state: workflow.current_state, reason: `Local \`.work/state.json\` requests ${workflow.current_state}.` };
  }
  return null;
}

function routeNext(ctx) {
  const context = inspectWorkContext(ctx.cwd);
  const controlMap = summarizeControlMap(ctx.cwd);
  const inputsConsidered = ['repo truth: control-map'];
  const inputsSkipped = [];
  const traceRefs = [];
  const constraints = [
    '`gsdd next` v1 is read-only unless an explicit mutating subcommand is used.',
    'No raw transcript ingestion, hosted memory, SQLite/vector DB, MCP memory server, or browser-provider implementation in this milestone.',
  ];
  const privacyNotes = [
    'Mutable `.work` runtime state is local-only by default.',
    'Raw transcript ingestion is disabled by default.',
  ];

  if (!context.has_goal) {
    return packet({
      state: 'ask_user',
      reason: 'No `.work/goal.md` continuity contract exists yet.',
      confidence: 'high',
      next_command: 'gsdd next --init',
      next_action: cliAction(['next', '--init'], 'Bootstrap `.work` explicitly after user approval.'),
      requires_user: true,
      questions: [{
        id: 'work-bootstrap',
        question: 'Initialize `.work/` as the canonical Workspine continuity root?',
        default: 'Yes: run `gsdd next --init`.',
        gate: 'bootstrap',
        blocking: true,
      }],
      constraints,
      artifacts_to_write: ['.work/goal.md', '.work/state.json', '.work/graph/events.jsonl', '.work/questions/open.json', '.work/evidence/manifest.json'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: ['.work files: missing'],
    });
  }

  inputsConsidered.push('.work/goal.md');
  if (context.state.exists) inputsConsidered.push('.work/state.json');
  else inputsSkipped.push('.work/state.json: missing');
  if (context.questions.ok && context.questions.exists) inputsConsidered.push('.work/questions/open.json');
  else if (context.questions.ok) inputsSkipped.push('.work/questions/open.json: missing');
  else inputsSkipped.push(`.work/questions/open.json: ${context.questions.error}`);
  if (context.evidence.exists) inputsConsidered.push('.work/evidence/manifest.json');
  else inputsSkipped.push('.work/evidence/manifest.json: missing');
  if (context.graph.events.length > 0) {
    inputsConsidered.push('.work/graph/events.jsonl');
    traceRefs.push(...context.graph.events.slice(-5).map((event) => event.id));
  } else {
    inputsSkipped.push('.work/graph/events.jsonl: no events');
  }
  if (context.focus_exists) inputsConsidered.push('.work/focus/current.md');
  else inputsSkipped.push('.work/focus/current.md: missing');
  if (context.handoff_exists) inputsConsidered.push('.work/handoff/current.md');
  else inputsSkipped.push('.work/handoff/current.md: missing');

  if (context.decisions.length > 0) inputsConsidered.push('.work/decisions/*.md');
  if (context.dogfood.length > 0) inputsConsidered.push('.work/dogfood/*.md');
  if (context.milestone?.has_milestone) inputsConsidered.push(milestonePath(context, 'MILESTONE.md'));
  else inputsSkipped.push(`${milestonePath(context, 'MILESTONE.md')}: missing`);
  if (context.milestone?.has_roadmap) inputsConsidered.push(milestonePath(context, 'ROADMAP.md'));
  else inputsSkipped.push(`${milestonePath(context, 'ROADMAP.md')}: missing`);
  if (context.milestone?.has_audit) inputsConsidered.push(milestonePath(context, 'AUDIT.md'));
  else inputsSkipped.push(`${milestonePath(context, 'AUDIT.md')}: missing`);
  if (context.milestone?.phase_packet_count > 0) inputsConsidered.push(milestonePath(context, 'phases/*'));
  if (context.planning.has_brownfield_change) inputsConsidered.push(statePath(context, 'brownfield-change/CHANGE.md'));

  if (context.graph.invalid.length > 0) {
    return packet({
      state: 'blocked',
      reason: 'The continuity graph contains invalid events; routing would be unsafe.',
      confidence: 'high',
      next_command: 'gsdd next graph rebuild',
      next_action: cliAction(['next', 'graph', 'rebuild'], 'Rebuild the deterministic graph index after malformed event lines are fixed.'),
      requires_user: false,
      constraints,
      evidence_required: ['Fix or remove malformed graph event lines, then rebuild the index.'],
      artifacts_to_read: ['.work/graph/events.jsonl'],
      artifacts_to_write: ['.work/graph/index.json'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  if (!context.state.ok) {
    return packet({
      state: 'blocked',
      reason: '`.work/state.json` is unparseable.',
      confidence: 'high',
      next_command: null,
      next_action: manualReviewAction(['.work/state.json'], 'Repair or replace malformed Workspine state JSON.'),
      requires_user: false,
      error_code: 'work_state_unparseable',
      repair_action: 'manual_review',
      repair_targets: ['.work/state.json'],
      constraints,
      artifacts_to_read: ['.work/state.json'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  if (!context.questions.ok) {
    return packet({
      state: 'blocked',
      reason: '`.work/questions/open.json` is unparseable.',
      confidence: 'high',
      next_command: null,
      next_action: manualReviewAction(['.work/questions/open.json'], 'Repair or replace malformed open-question JSON.'),
      requires_user: false,
      error_code: 'open_questions_unparseable',
      repair_action: 'manual_review',
      repair_targets: ['.work/questions/open.json'],
      constraints,
      artifacts_to_read: ['.work/questions/open.json'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  const blockingQuestions = context.questions.questions.filter((question) => question.blocking !== false);
  if (blockingQuestions.length > 0) {
    return packet({
      state: 'ask_user',
      reason: 'There are unresolved blocking questions in `.work/questions/open.json`.',
      confidence: 'high',
      next_command: 'gsdd next question answer --id <id> --answer <text>',
      next_action: cliAction(['next', 'question', 'answer', '--id', '<id>', '--answer', '<text>'], 'Answer the blocking question after the user decides.'),
      requires_user: true,
      questions: blockingQuestions,
      constraints,
      artifacts_to_read: ['.work/questions/open.json'],
      artifacts_to_write: ['.work/questions/answered.jsonl', '.work/graph/events.jsonl'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  const { manifest, error: manifestError } = readManifestStatus(context);
  if (manifestError) {
    return packet({
      state: 'blocked',
      reason: '`.work/evidence/manifest.json` is unparseable.',
      confidence: 'high',
      next_command: null,
      next_action: manualReviewAction(['.work/evidence/manifest.json'], 'Repair or replace malformed evidence manifest JSON.'),
      requires_user: false,
      error_code: 'evidence_manifest_unparseable',
      repair_action: 'manual_review',
      repair_targets: ['.work/evidence/manifest.json'],
      constraints,
      artifacts_to_read: ['.work/evidence/manifest.json'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  const trustGate = findTrustGate(manifest);
  if (trustGate) {
    return packet({
      state: 'ask_user',
      reason: trustGate.reason,
      confidence: 'high',
      next_command: null,
      next_action: userQuestionAction([trustGate.id], 'Resolve the trust-boundary approval before continuing.'),
      requires_user: true,
      questions: [trustGate],
      constraints,
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  const stateRoute = routeFromStateObject(context.state.value);
  if (stateRoute) {
    return enrichRoute(stateRoute, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs });
  }

  if (manifest?.verification?.status === 'gaps_found' || manifest?.audit?.status === 'gaps_found') {
    return enrichRoute({ state: 'fix_gaps', reason: 'Evidence manifest records verification or audit gaps.' }, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs });
  }

  if (manifest?.audit?.status === 'passed' && context.dogfood.length === 0) {
    return enrichRoute({ state: 'dogfood', reason: 'Evidence manifest records a passed audit and no dogfood finding exists.' }, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs });
  }

  if (manifest?.audit?.status === 'passed' && context.dogfood.length > 0) {
    return enrichRoute({
      state: 'ask_user',
      reason: 'Audit passed and dogfood was captured, but declaring completion is a human gate.',
      questions: [{
        id: 'completion-approval',
        question: 'Approve declaring this milestone complete?',
        default: 'No automatic completion; review audit evidence first.',
        gate: 'completion',
        blocking: true,
      }],
    }, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs });
  }

  const brownfieldStatus = brownfieldPosture(context);
  if (['active', 'blocked', 'ready_for_verification'].includes(brownfieldStatus) && context.milestone?.exists) {
    return packet({
      state: 'blocked',
      reason: `Active brownfield-change authority and ${milestonePath(context)} authority both exist; continuing would silently choose between two continuity roots.`,
      confidence: 'high',
      next_command: null,
      next_action: manualReviewAction([statePath(context, 'brownfield-change/CHANGE.md'), milestonePath(context, 'MILESTONE.md'), milestonePath(context, 'ROADMAP.md')], 'Resolve the authority conflict before routing to plan, execute, or verify.'),
      authority: 'blocked',
      route_kind: 'authority_conflict',
      blocked_by: ['brownfield_change', 'work_milestone'],
      requires_user: false,
      constraints,
      evidence_required: ['One continuity authority must be selected or archived before continuing.'],
      artifacts_to_read: [statePath(context, 'brownfield-change/CHANGE.md'), milestonePath(context, 'MILESTONE.md'), milestonePath(context, 'ROADMAP.md')],
      repo_warnings: repoWarningsFromControlMap(controlMap),
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  if (brownfieldStatus === 'blocked') {
    return packet({
      state: 'blocked',
      reason: 'Active bounded brownfield change is marked blocked; resolve the blocker recorded in CHANGE.md before planning or execution.',
      confidence: 'high',
      next_command: null,
      next_action: manualReviewAction([statePath(context, 'brownfield-change/CHANGE.md'), statePath(context, 'brownfield-change/HANDOFF.md')], 'Resolve the blocker and update the brownfield change status before continuing.'),
      authority: 'brownfield_change',
      route_kind: 'brownfield_change_blocked',
      blocked_by: ['brownfield_change'],
      requires_user: false,
      constraints,
      artifacts_to_read: [statePath(context, 'brownfield-change/CHANGE.md'), statePath(context, 'brownfield-change/HANDOFF.md')],
      artifacts_to_write: [statePath(context, 'brownfield-change/CHANGE.md'), statePath(context, 'brownfield-change/HANDOFF.md')],
      repo_warnings: repoWarningsFromControlMap(controlMap),
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  if (brownfieldStatus === 'ready_for_verification') {
    return packet({
      state: 'verify',
      reason: 'Active bounded brownfield change is ready for verification; verify the bounded closeout proof before more planning.',
      confidence: 'high',
      next_command: null,
      next_action: manualReviewAction([statePath(context, 'brownfield-change/CHANGE.md'), statePath(context, 'brownfield-change/VERIFICATION.md')], 'Verify the bounded brownfield change and update VERIFICATION.md.'),
      authority: 'brownfield_change',
      route_kind: 'brownfield_change_verification',
      requires_user: false,
      constraints,
      evidence_required: ['VERIFICATION.md must prove the CHANGE.md done-when and closeout path or record concrete gaps.'],
      artifacts_to_read: [
        statePath(context, 'brownfield-change/CHANGE.md'),
        statePath(context, 'brownfield-change/HANDOFF.md'),
        statePath(context, 'brownfield-change/VERIFICATION.md'),
      ],
      artifacts_to_write: [statePath(context, 'brownfield-change/VERIFICATION.md')],
      repo_warnings: repoWarningsFromControlMap(controlMap),
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  if (brownfieldStatus === 'active') {
    return packet({
      state: 'plan',
      reason: 'Active bounded brownfield change exists; route planning through the brownfield change lane before phase roadmap preflight.',
      confidence: 'high',
      next_command: 'gsdd-plan',
      next_action: workflowAction('gsdd-plan', 'Plan the active bounded brownfield change from CHANGE.md and HANDOFF.md without requiring unrelated ROADMAP phase membership.'),
      authority: 'brownfield_change',
      route_kind: 'brownfield_change',
      requires_user: false,
      constraints: [
        ...constraints,
        `Bounded brownfield changes use \`${statePath(context, 'brownfield-change/')}\`, not \`${statePath(context, 'phases/')}\` or ROADMAP checkboxes.`,
        'Promote to `gsdd-new-project` or `gsdd-new-milestone` only when the change no longer fits one active stream.',
      ],
      evidence_required: ['Plan must preserve the bounded CHANGE.md goal, scope, done-when, next action, and closeout path.'],
      artifacts_to_read: [
        statePath(context, 'brownfield-change/CHANGE.md'),
        statePath(context, 'brownfield-change/HANDOFF.md'),
        statePath(context, 'brownfield-change/VERIFICATION.md'),
        statePath(context, 'SPEC.md'),
        statePath(context, 'ROADMAP.md'),
      ],
      artifacts_to_write: [
        statePath(context, 'brownfield-change/CHANGE.md'),
        statePath(context, 'brownfield-change/HANDOFF.md'),
      ],
      repo_warnings: repoWarningsFromControlMap(controlMap),
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: inputsSkipped,
      trace_refs: traceRefs,
    });
  }

  if (hasUnverifiedSummaries(context.planning.phases)) {
    return enrichRoute({ state: 'verify', reason: `${statePath(context)} phase summaries exist without matching verification reports.` }, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs });
  }

  const workMilestoneRoute = routeFromWorkMilestone(context, manifest);
  if (workMilestoneRoute) {
    return enrichRoute(workMilestoneRoute, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs });
  }

  const legacyComplete = context.planning.has_spec && context.planning.has_roadmap && context.planning.has_milestones;
  if (!legacyComplete) {
    return packet({
      state: 'plan',
      reason: `\`.work/goal.md\` exists, but canonical ${statePath(context)} lifecycle truth is incomplete; create or refresh the Workspine-native plan from \`.work\`.`,
      confidence: context.planning.exists ? 'medium' : 'high',
      next_command: 'gsdd-plan',
      next_action: workflowAction('gsdd-plan', 'Plan the Workspine-native milestone from `.work` truth.'),
      authority: 'work',
      route_kind: 'work_native_plan',
      blocked_by: controlMapBlockers(controlMap),
      repo_warnings: repoWarningsFromControlMap(controlMap),
      requires_user: false,
      constraints: [
        ...constraints,
        `Do not infer normal ${statePath(context)} milestone progress when SPEC.md, ROADMAP.md, or MILESTONES.md are missing.`,
      ],
      evidence_required: ['Plan must map `.work/goal.md` requirements to implementation and verification artifacts.'],
      artifacts_to_read: ['.work/goal.md', '.work/research/2026-06-20-long-term-agent-harness-consistency.md'],
      artifacts_to_write: ['.work/focus/current.md', '.work/graph/events.jsonl'],
      privacy_notes: privacyNotes,
      inputs_considered: inputsConsidered,
      inputs_skipped: [
        ...inputsSkipped,
        !context.planning.has_spec ? `${statePath(context, 'SPEC.md')}: missing` : null,
        !context.planning.has_roadmap ? `${statePath(context, 'ROADMAP.md')}: missing` : null,
        !context.planning.has_milestones ? `${statePath(context, 'MILESTONES.md')}: missing` : null,
      ].filter(Boolean),
      trace_refs: traceRefs,
    });
  }

  return packet({
    state: 'plan',
    reason: 'Continuity contract and legacy lifecycle artifacts are present; plan the next approved work slice.',
    confidence: 'medium',
    next_command: 'gsdd-plan',
    next_action: workflowAction('gsdd-plan', 'Plan the next approved work slice.'),
    authority: 'planning',
    route_kind: 'phase_plan',
    blocked_by: controlMapBlockers(controlMap),
    repo_warnings: repoWarningsFromControlMap(controlMap),
    requires_user: false,
    constraints,
    artifacts_to_read: ['.work/goal.md', statePath(context, 'SPEC.md'), statePath(context, 'ROADMAP.md'), statePath(context, 'MILESTONES.md')],
    artifacts_to_write: ['.work/focus/current.md'],
    privacy_notes: privacyNotes,
    inputs_considered: inputsConsidered,
    inputs_skipped: inputsSkipped,
    trace_refs: traceRefs,
  });
}

function continuityProjection(context, route) {
  const checkpointReadback = context.checkpoint || {
    path: `${stateDirName(context)}/.continue-here.md`,
    status: 'absent',
    frontmatter: null,
    sections: null,
    judgment: null,
    errors: [],
  };
  const manifest = context.evidence.ok ? context.evidence.value : null;
  const state = context.state.ok ? context.state.value : null;
  const stateWorkflow = state?.workflow || state?.milestone || state || null;
  const stateSource = state?.workflow ? 'workflow' : state?.milestone ? 'milestone' : 'root';
  const trustGates = Array.isArray(manifest?.trust_gates) ? manifest.trust_gates : [];
  const unresolvedTrustGate = trustGates.find((gate) => gate?.approved !== true);
  const approval = unresolvedTrustGate
    ? { value: 'pending', source: `${stateDirName(context)}/evidence/manifest.json#trust_gates` }
    : stateWorkflow?.human_gate && Object.hasOwn(stateWorkflow.human_gate, 'approved')
      ? { value: stateWorkflow.human_gate.approved === true ? 'approved' : 'pending', source: `${stateDirName(context)}/state.json#${stateSource}.human_gate` }
      : stateWorkflow?.plan && Object.hasOwn(stateWorkflow.plan, 'approved')
        ? { value: stateWorkflow.plan.approved === true ? 'approved' : 'not_approved', source: `${stateDirName(context)}/state.json#${stateSource}.plan.approved` }
        : { value: 'not_recorded', source: 'structured_state_or_lifecycle_not_recorded' };
  const result = typeof stateWorkflow?.execution?.status === 'string'
    ? { value: stateWorkflow.execution.status, source: `${stateDirName(context)}/state.json#${stateSource}.execution.status` }
    : { value: 'not_recorded', source: 'structured_state_or_lifecycle_not_recorded' };
  const verification = typeof stateWorkflow?.verification?.status === 'string'
    ? { value: stateWorkflow.verification.status, source: `${stateDirName(context)}/state.json#${stateSource}.verification.status` }
    : typeof manifest?.verification?.status === 'string'
      ? { value: manifest.verification.status, source: `${stateDirName(context)}/evidence/manifest.json#verification.status` }
      : { value: 'not_recorded', source: 'structured_state_or_lifecycle_not_recorded' };
  const checkpoint = {
    ...checkpointReadback,
    narrative_identity: {
      workflow: checkpointReadback.frontmatter?.workflow || null,
      phase: checkpointReadback.frontmatter?.phase || null,
      authority: 'non_authoritative_checkpoint_prose',
    },
  };
  return {
    workspace_root: normalizeSlashes(context.paths.root),
    state_root: stateDirName(context),
    work_identity: {
      authority: route.authority || 'unknown',
      current_phase: context.planning.current_phase || null,
      next_phase: context.planning.next_phase || null,
      route_kind: route.route_kind || 'unknown',
    },
    checkpoint,
    posture: {
      approval,
      result,
      verification,
    },
    blockers: {
      codes: route.blocked_by || [],
      reason: ['blocked', 'ask_user'].includes(route.state) ? route.reason : null,
      questions: ['blocked', 'ask_user'].includes(route.state) ? route.questions || [] : [],
    },
    next_action: route.next_action || null,
  };
}

function hasDecisionsDigestSignal(digest) {
  const excluded = digest.counts?.excluded || {};
  return digest.records.length > 0
    || digest.counts?.eligible > 0
    || Object.values(excluded).some((count) => count > 0)
    || digest.counts?.invalid > 0
    || digest.legacyRecords.length > 0
    || digest.readErrors.length > 0
    || digest.truncated;
}

function projectDecisionsDigest(ctx, route) {
  const decisionsDigest = buildDecisionsDigest({ workDir: getWorkPaths(ctx.cwd).workDir });
  const inputsConsidered = hasDecisionsDigestSignal(decisionsDigest) && !route.inputs_considered.includes('.work/decisions/*.md')
    ? [...route.inputs_considered, '.work/decisions/*.md']
    : route.inputs_considered;
  const projectedRoute = { ...route, inputs_considered: inputsConsidered, decisionsDigest };
  return { ...projectedRoute, continuity: continuityProjection(inspectWorkContext(ctx.cwd), projectedRoute) };
}

function routeFromWorkMilestone(context, manifest) {
  const milestone = context.milestone;
  if (!milestone?.exists) return null;
  if (milestone.roadmap_all_complete && !milestone.audit_passed) {
    return {
      state: 'audit',
      reason: `Workspine-native \`${milestonePath(context)}\` roadmap is complete and needs milestone audit.`,
    };
  }
  if (milestone.audit_passed && context.dogfood.length === 0 && manifest?.dogfood?.status !== 'captured') {
    return {
      state: 'dogfood',
      reason: `Workspine-native \`${milestonePath(context)}\` audit passed and no dogfood finding has been captured.`,
    };
  }
  if (milestone.audit_passed && (context.dogfood.length > 0 || manifest?.dogfood?.status === 'captured')) {
    return {
      state: 'ask_user',
      reason: 'Workspine-native milestone audit passed and dogfood exists, but declaring completion is a human gate.',
      next_command: 'gsdd-complete-milestone',
      next_action: manualReviewAction([milestonePath(context, 'AUDIT.md'), milestonePath(context, 'ROADMAP.md'), '.work/evidence/manifest.json'], 'Review closure evidence with the user before running completion workflow.'),
      questions: [{
        id: 'completion-approval',
        question: 'Approve declaring this Workspine-native milestone complete?',
        default: `No automatic completion; review \`${milestonePath(context, 'AUDIT.md')}\` and evidence first.`,
        gate: 'completion',
        blocking: true,
      }],
      evidence_required: [`Human approval after reviewing \`${milestonePath(context, 'AUDIT.md')}\` and the scoped closure limits.`],
      artifacts_to_read: [milestonePath(context, 'AUDIT.md'), milestonePath(context, 'ROADMAP.md'), '.work/evidence/manifest.json'],
    };
  }
  if (milestone.has_roadmap && milestone.actionable_phase_packet_count > 0) {
    return {
      state: 'verify',
      reason: `Workspine-native \`${milestonePath(context)}\` has actionable phase packets that should be verified before closure.`,
    };
  }
  return null;
}

function enrichRoute(route, { context, controlMap, constraints, privacyNotes, inputsConsidered, inputsSkipped, traceRefs }) {
  const commands = {
    execute: workflowAction('gsdd-execute', 'Execute the approved Workspine plan.'),
    verify: workflowAction('gsdd-verify', 'Verify executed artifacts against the plan.'),
    audit: workflowAction('gsdd-audit-milestone', 'Audit milestone-level integration and closure evidence.'),
    fix_gaps: workflowAction('gsdd-plan', 'Plan amend/extend work from audit or verification findings.'),
    dogfood: cliAction(['next', 'dogfood', 'capture', '--id', '<id>', '--title', '<text>', '--body', '<text>'], 'Capture one bounded local dogfood finding.'),
    pause: manualReviewAction(['.work/handoff/current.md'], 'Update handoff before pausing.'),
    blocked: null,
    ask_user: null,
    complete: null,
  };
  const nextAction = route.next_action || commands[route.state] || null;
  return packet({
    state: route.state,
    reason: route.reason,
    confidence: route.state === 'blocked' || route.state === 'ask_user' ? 'high' : 'medium',
    next_command: route.next_command || actionToLegacyCommand(nextAction),
    next_action: nextAction,
    authority: route.authority || inferAuthorityForState(route.state, context),
    route_kind: route.route_kind || route.state,
    blocked_by: [...(route.blocked_by || []), ...controlMapBlockers(controlMap)],
    requires_user: route.state === 'ask_user',
    questions: route.questions || [],
    constraints,
    evidence_required: route.evidence_required || (route.state === 'verify' ? ['Verification report proving executed artifacts satisfy the plan.'] : []),
    artifacts_to_read: route.artifacts_to_read || defaultReadArtifacts(route.state, context),
    artifacts_to_write: route.artifacts_to_write || defaultWriteArtifacts(route.state),
    repo_warnings: repoWarningsFromControlMap(controlMap),
    privacy_notes: privacyNotes,
    inputs_considered: inputsConsidered,
    inputs_skipped: inputsSkipped,
    trace_refs: traceRefs,
  });
}

function inferAuthorityForState(state, context) {
  if (context.milestone?.exists) return 'work_milestone';
  if (hasActiveBrownfieldChange(context)) return 'brownfield_change';
  if (state === 'blocked') return 'blocked';
  return 'planning';
}

function actionToLegacyCommand(action) {
  if (!action) return null;
  if (action.type === 'cli_command') return action.command;
  if (action.type === 'workflow_skill') return action.skill_id;
  return null;
}

function defaultReadArtifacts(state, context) {
  if (state === 'execute') return ['.work/goal.md', '.work/focus/current.md'];
  if (state === 'verify') return context.milestone?.has_roadmap
    ? ['.work/goal.md', milestonePath(context, 'ROADMAP.md'), milestonePath(context, 'phases/*/*-VERIFY.md')]
    : ['.work/goal.md', '.work/evidence/manifest.json', statePath(context, 'phases/*/*-SUMMARY.md')];
  if (state === 'audit') return context.milestone?.has_roadmap
    ? ['.work/goal.md', milestonePath(context, 'ROADMAP.md'), milestonePath(context, 'phases/*/*-VERIFY.md')]
    : ['.work/goal.md', '.work/evidence/manifest.json', statePath(context, 'phases/**/*-VERIFICATION.md')];
  if (state === 'fix_gaps') return ['.work/evidence/manifest.json', '.work/*-MILESTONE-AUDIT.md', milestonePath(context, 'AUDIT.md')];
  if (state === 'dogfood') return ['.work/goal.md', '.work/evidence/manifest.json'];
  if (state === 'pause') return ['.work/handoff/current.md'];
  if (state === 'complete') return ['.work/goal.md', '.work/evidence/manifest.json', '.work/dogfood/'];
  if (state === 'ask_user') return context.questions.questions.length > 0 ? ['.work/questions/open.json'] : ['.work/state.json'];
  return ['.work/goal.md'];
}

function defaultWriteArtifacts(state) {
  if (state === 'verify') return ['.work/evidence/manifest.json'];
  if (state === 'audit') return ['.work/evidence/manifest.json'];
  if (state === 'fix_gaps') return ['.work/ROADMAP.md', '.work/phases/', '.work/focus/current.md', '.work/graph/events.jsonl'];
  if (state === 'dogfood') return ['.work/dogfood/*.md', '.work/graph/events.jsonl'];
  if (state === 'pause') return ['.work/handoff/current.md'];
  return [];
}

function hasUnverifiedSummaries(phases) {
  return phases.some((phase) => phase.summaries.length > 0 && phase.verifications.length === 0);
}

function findTrustGate(manifest) {
  const gates = Array.isArray(manifest?.trust_gates) ? manifest.trust_gates : [];
  const gate = gates.find((entry) => entry && entry.approved !== true);
  if (!gate) return null;
  return {
    id: gate.id || 'trust-boundary',
    question: gate.question || 'Approve crossing this trust boundary?',
    default: gate.default || 'Do not proceed without explicit approval.',
    gate: gate.gate || 'trust',
    blocking: true,
    reason: gate.reason || 'A trust boundary requires explicit approval.',
  };
}

const CARD_WIDTH = 62;
const DECISION_NOTICE_DETAIL_CAP = 3;

const STATE_LABELS = {
  research: 'Look into the problem before planning',
  plan: 'Plan the next piece of work',
  execute: 'Build the planned work',
  verify: 'Prove the last piece of work is done',
  audit: 'Check the whole milestone holds together',
  fix_gaps: 'Plan the gaps that checking found',
  dogfood: 'Use the result and record one honest finding',
  complete: 'Finish and archive the milestone',
  ask_user: 'Answer a question before work can continue',
  pause: 'Work is paused; pick it back up when ready',
  blocked: 'Work is stuck; clear the blocker below',
};

function cardFrame(text) {
  return `│${text.padEnd(CARD_WIDTH)}│`;
}

function pushCardLine(rows, indent, hang, text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    rows.push(cardFrame(' '.repeat(indent)));
    return;
  }
  let prefix = ' '.repeat(indent);
  let line = prefix;
  for (const word of words) {
    const candidate = line === prefix ? line + word : `${line} ${word}`;
    if (candidate.length <= CARD_WIDTH) {
      line = candidate;
    } else {
      rows.push(cardFrame(line));
      prefix = ' '.repeat(hang);
      line = prefix + word;
    }
  }
  rows.push(cardFrame(line));
}

export function renderNextCard(packetValue) {
  const top = `┌${'─'.repeat(CARD_WIDTH)}┐`;
  const rule = `├${'─'.repeat(CARD_WIDTH)}┤`;
  const bottom = `└${'─'.repeat(CARD_WIDTH)}┘`;
  const label = STATE_LABELS[packetValue.state] || packetValue.state;
  const action = (packetValue.next_action ? renderAction(packetValue.next_action) : null)
    || packetValue.next_command
    || '(nothing queued)';
  const waiting = packetValue.requires_user ? 'yes' : 'no';

  const rows = [top];
  rows.push(cardFrame('  Where things stand'));
  rows.push(rule);
  pushCardLine(rows, 2, 7, `Now: ${label}`);
  pushCardLine(rows, 2, 7, `Why: ${packetValue.reason || ''}`);
  rows.push(cardFrame(''));
  rows.push(cardFrame('  Do this next:'));
  pushCardLine(rows, 4, 4, action);
  rows.push(cardFrame(''));
  rows.push(cardFrame(`  Waiting on you:  ${waiting}`));
  rows.push(cardFrame(''));
  rows.push(cardFrame('  Stuck?  Run: gsdd next --format human'));
  if (hasDecisionsDigestSignal(packetValue.decisionsDigest || emptyDecisionsDigest())) {
    const digest = packetValue.decisionsDigest;
    const notices = decisionNotices(digest);
    const active = digest.counts.returned > 0
      ? `${digest.counts.returned} active`
      : 'no active decisions';
    rows.push(cardFrame(''));
    pushCardLine(rows, 2, 2, `Decisions: ${active}; ${notices.length} notice${notices.length === 1 ? '' : 's'}.`);
  }
  rows.push(bottom);
  return rows.join('\n');
}

function printHuman(packetValue) {
  console.log(renderNextCard(packetValue));
  if (packetValue.questions.length > 0) {
    console.log('\nQuestions:');
    for (const question of packetValue.questions) {
      console.log(`- ${question.id}: ${question.question || question.prompt}`);
      if (question.default) console.log(`  Default: ${question.default}`);
    }
  }
  if (packetValue.constraints.length > 0) {
    console.log('\nConstraints:');
    for (const constraint of packetValue.constraints) console.log(`- ${constraint}`);
  }
  if (packetValue.evidence_required.length > 0) {
    console.log('\nEvidence required:');
    for (const item of packetValue.evidence_required) console.log(`- ${item}`);
  }
  if (packetValue.repo_warnings.length > 0) {
    console.log('\nRepo risk:');
    for (const item of packetValue.repo_warnings) console.log(`- ${item}`);
  }
  if (packetValue.inputs_skipped.length > 0) {
    console.log('\nSkipped inputs:');
    for (const item of packetValue.inputs_skipped) console.log(`- ${item}`);
  }
  if (hasDecisionsDigestSignal(packetValue.decisionsDigest || emptyDecisionsDigest())) {
    printDecisionsDigest(packetValue.decisionsDigest);
  }
}

function emptyDecisionsDigest() {
  return {
    records: [],
    legacyRecords: [],
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
    readErrors: [],
  };
}

function decisionNotices(digest) {
  const excluded = digest.counts.excluded || {};
  const notices = [];
  for (const status of ['candidate', 'superseded', 'invalidated']) {
    const count = excluded[status] || 0;
    if (count > 0) notices.push({ message: `${count} ${status} decision${count === 1 ? '' : 's'} excluded.` });
  }
  const unreceipted = excluded.unreceipted_active || 0;
  if (unreceipted > 0) {
    const verb = unreceipted === 1 ? 'requires' : 'require';
    notices.push({
      message: `${unreceipted} unreceipted active decision${unreceipted === 1 ? '' : 's'} ${verb} owner review.`,
    });
  }
  const malformed = excluded.malformed_assertion || 0;
  if (malformed > 0) {
    const verb = malformed === 1 ? 'has' : 'have';
    notices.push({
      message: `${malformed} active decision${malformed === 1 ? '' : 's'} ${verb} malformed owner assertion${malformed === 1 ? '' : 's'} and require${malformed === 1 ? 's' : ''} review.`,
    });
  }
  const activeOmitted = Math.max(0, (digest.counts.eligible || 0) - (digest.counts.returned || 0));
  const stale = excluded.stale_flagged || 0;
  const conflict = excluded.conflict_flagged || 0;
  if (activeOmitted > 0 || digest.truncated || stale > 0 || conflict > 0) {
    const reviewFlags = [
      stale > 0 ? `${stale} stale-flagged` : null,
      conflict > 0 ? `${conflict} conflict-flagged` : null,
    ].filter(Boolean);
    notices.push({
      message: `${activeOmitted} additional active decision${activeOmitted === 1 ? '' : 's'} omitted by the digest cap${reviewFlags.length > 0 ? `; ${reviewFlags.join(' and ')} for review.` : '.'}`,
    });
  }
  if (digest.legacyRecords.length > 0) {
    const details = digest.legacyRecords
      .slice(0, DECISION_NOTICE_DETAIL_CAP)
      .map((record) => `Legacy metadata: ${record.id} (${record.path}; ${record.format}).`);
    notices.push({
      message: `${digest.legacyRecords.length} legacy decision record${digest.legacyRecords.length === 1 ? '' : 's'} ${digest.legacyRecords.length === 1 ? 'is' : 'are'} non-authoritative.`,
      details,
      omitted: digest.legacyRecords.length - details.length,
      omittedLabel: 'legacy metadata entries',
    });
  }
  const errorDetails = [...new Map((digest.readErrors || []).map((error) => [`${error.path}\u0000${error.code || 'unknown'}`, error])).values()];
  const invalidOrUnreadable = Math.max(digest.counts.invalid || 0, errorDetails.length);
  if (invalidOrUnreadable > 0) {
    const details = errorDetails
      .slice(0, DECISION_NOTICE_DETAIL_CAP)
      .map((error) => `Invalid/read error: ${error.path} (${error.code || 'unknown'}).`);
    notices.push({
      message: `${invalidOrUnreadable} invalid or unreadable decision record${invalidOrUnreadable === 1 ? '' : 's'} detected.`,
      details,
      omitted: Math.max(invalidOrUnreadable, errorDetails.length) - details.length,
      omittedLabel: 'invalid/read-error details',
    });
  }
  return notices;
}

function printDecisionsDigest(digest) {
  if (digest.records.length > 0) console.log(`\n${digest.text}`);
  const notices = decisionNotices(digest);
  if (notices.length > 0) {
    console.log('\nDecision notices:');
    for (const notice of notices) {
      console.log(`- ${notice.message}`);
      for (const detail of notice.details || []) console.log(`  - ${detail}`);
      if (notice.omitted > 0) console.log(`  - ${notice.omitted} additional ${notice.omittedLabel} omitted.`);
    }
  }
}

function renderAction(action) {
  if (action.type === 'cli_command') return action.command;
  if (action.type === 'workflow_skill') return action.skill_id;
  if (action.type === 'manual_review') return `review ${action.targets.join(', ')}`;
  if (action.type === 'user_question') return `answer ${action.question_ids.join(', ')}`;
  return action.description || action.type;
}

function requireFlag(args, name, usage = NEXT_USAGE) {
  const parsed = parseFlagValue(args, name);
  if (parsed.invalid || !parsed.value) {
    const error = new Error(usage);
    error.usage = true;
    throw error;
  }
  return parsed.value;
}

export function createCmdNext(ctx) {
  return function cmdNext(...args) {
    const workspace = resolveWorkspaceContext([], { cwd: ctx.cwd });
    const jsonMode = outputMode(args) === 'json';
    try {
      if (workspace.invalid) throw new Error(workspace.error);
      const { workspaceRoot, state } = workspace;
      const effectiveCtx = { ...ctx, cwd: workspaceRoot };
      const workPaths = getWorkPaths(effectiveCtx.cwd);
      const authorityGate = stateAuthorityGate(state);
      if (!authorityGate.allowed) throw new Error(authorityGate.message);
      if (args.includes('--help') || args.includes('-h')) {
        console.log(NEXT_USAGE);
        return;
      }

      if (args.includes('--init')) {
        const result = ensureWorkStructure(effectiveCtx.cwd);
        const index = rebuildGraphIndex(result.paths.workDir, { write: true });
        const response = {
          schema_version: 1,
          operation: 'next init',
          status: 'ok',
          changed: result.created.length > 0,
          created: result.created,
          work_dir: '.work',
          index: {
            event_count: index.event_count,
            invalid_event_count: index.invalid_event_count,
          },
          next: projectDecisionsDigest(effectiveCtx, routeNext(effectiveCtx)),
        };
        if (jsonMode) output(response);
        else {
          console.log(`Initialized .work (${result.created.length} created).`);
          printHuman(response.next);
        }
        return;
      }

      if (args[0] === 'graph' && args[1] === 'rebuild') {
        if (!existsSync(workPaths.workDir)) throw new Error('No `.work/` directory found. Run `gsdd next --init` first.');
        const index = rebuildGraphIndex(workPaths.workDir, { write: true });
        const response = {
          schema_version: 1,
          operation: 'next graph rebuild',
          status: index.invalid_event_count > 0 ? 'invalid_events' : 'ok',
          index,
        };
        if (jsonMode) output(response);
        else console.log(`Rebuilt .work graph index (${index.event_count} events, ${index.invalid_event_count} invalid).`);
        if (index.invalid_event_count > 0) process.exitCode = 1;
        return;
      }

      if (args[0] === 'question') {
        handleQuestion(effectiveCtx, args.slice(1), jsonMode);
        return;
      }

      if (args[0] === 'decision') {
        handleDecision(effectiveCtx, args.slice(1), jsonMode);
        return;
      }

      if (args[0] === 'dogfood') {
        handleDogfood(effectiveCtx, args.slice(1), jsonMode);
        return;
      }

      const filtered = removeFlags(args, ['--json', '--format']);
      if (filtered.length > 0) {
        console.error(NEXT_USAGE);
        process.exitCode = 1;
        return;
      }

      const result = projectDecisionsDigest(effectiveCtx, routeNext(effectiveCtx));
      if (jsonMode) output(result);
      else printHuman(result);
    } catch (error) {
      const response = {
        schema_version: 1,
        operation: 'next',
        status: 'error',
        error: error.message,
      };
      if (jsonMode) output(response);
      else console.error(error.usage ? error.message : `gsdd next failed: ${error.message}`);
      process.exitCode = 1;
    }
  };
}

function handleQuestion(ctx, args, jsonMode) {
  if (!existsSync(getWorkPaths(ctx.cwd).workDir)) throw new Error('No `.work/` directory found. Run `gsdd next --init` first.');
  if (args[0] === 'add') {
    const id = requireFlag(args, '--id');
    const question = requireFlag(args, '--prompt');
    const defaultValue = parseFlagValue(args, '--default').value;
    const gate = parseFlagValue(args, '--gate').value || 'product';
    const blocking = boolFlagValue(parseFlagValue(args, '--blocking').value, true);
    const replace = args.includes('--replace');
    const result = addOpenQuestion(getWorkPaths(ctx.cwd).workDir, {
      id,
      question,
      default: defaultValue,
      gate,
      blocking,
    }, { replace });
    const response = {
      schema_version: 1,
      operation: 'next question add',
      status: result.status,
      question: result.question,
      graph_event_id: result.event?.id || null,
      graph_event_ids: result.events.map((event) => event.id),
    };
    if (jsonMode) output(response);
    else console.log(`Added question ${result.question.id}.`);
    return;
  }
  if (args[0] === 'answer') {
    const id = requireFlag(args, '--id');
    const answer = requireFlag(args, '--answer');
    const result = answerQuestion(getWorkPaths(ctx.cwd).workDir, id, answer);
    const response = {
      schema_version: 1,
      operation: 'next question answer',
      status: result.already_applied ? 'already_applied' : result.found ? 'ok' : 'not_found',
      question: result.question,
      graph_event_id: result.event?.id || null,
      graph_event_ids: result.events?.map((event) => event.id) || [],
    };
    if (jsonMode) output(response);
    else console.log(result.found ? `Answered question ${id}.` : `Question ${id} not found.`);
    if (!result.found) process.exitCode = 1;
    return;
  }
  throw new Error(NEXT_USAGE);
}

function handleDecision(ctx, args, jsonMode) {
  if (!existsSync(getWorkPaths(ctx.cwd).workDir)) throw new Error('No `.work/` directory found. Run `gsdd next --init` first.');
  if (args[0] !== 'record') throw new Error(NEXT_USAGE);
  const id = requireFlag(args, '--id');
  const title = requireFlag(args, '--title');
  const body = requireFlag(args, '--body');
  const supersedes = parseFlagValue(args, '--supersedes').value;
  const privacy = parseFlagValue(args, '--privacy').value || 'repo';
  const replace = args.includes('--replace');
  const result = recordDecision(getWorkPaths(ctx.cwd).workDir, { id, title, body, supersedes, privacy }, { replace });
  const response = {
    schema_version: 1,
    operation: 'next decision record',
    status: result.status,
    decision: { id: result.id, path: normalizeSlashes(result.path) },
    graph_event_id: result.event?.id || null,
    graph_event_ids: result.events.map((event) => event.id),
  };
  if (jsonMode) output(response);
  else console.log(`Recorded decision ${result.id}.`);
}

function handleDogfood(ctx, args, jsonMode) {
  if (!existsSync(getWorkPaths(ctx.cwd).workDir)) throw new Error('No `.work/` directory found. Run `gsdd next --init` first.');
  if (args[0] !== 'capture') throw new Error(NEXT_USAGE);
  const id = requireFlag(args, '--id');
  const title = requireFlag(args, '--title');
  const body = requireFlag(args, '--body');
  const backlog = parseFlagValue(args, '--backlog').value;
  const replace = args.includes('--replace');
  const result = captureDogfoodFinding(getWorkPaths(ctx.cwd).workDir, { id, title, body, backlog }, { replace });
  const response = {
    schema_version: 1,
    operation: 'next dogfood capture',
    status: result.status,
    finding: { id: result.id, path: normalizeSlashes(result.path) },
    graph_event_id: result.event?.id || null,
  };
  if (jsonMode) output(response);
  else console.log(`Captured dogfood finding ${result.id}.`);
}

export function cmdNext(...args) {
  return createCmdNext({ cwd: process.cwd() })(...args);
}
