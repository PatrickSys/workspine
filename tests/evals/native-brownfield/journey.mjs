import fs from 'node:fs';
import path from 'node:path';
import { EvalError, fileSha256 } from './util.mjs';
import { findCheckpointWitness } from './codex.mjs';
export const BROWNFIELD_PLAN_IDENTITY = '.work/brownfield-change/CHANGE.md';
export function classifyPlanSelection(plan = {}, approvalExpected = false) {
  const selectedPath = typeof plan.path === 'string' && plan.path.trim() ? plan.path : null;
  const identity = typeof plan.identity === 'string' && plan.identity.trim() ? plan.identity : null;
  const approved = plan.approved === true;
  const reason = approved && !approvalExpected ? 'plan_preapproved_outside_harness' : (!selectedPath || !identity ? 'selected_plan_identity_missing'
    : (selectedPath !== identity || selectedPath !== BROWNFIELD_PLAN_IDENTITY ? 'selected_plan_identity_mismatch' : null));
  return { ok: !reason, ...(reason ? { reason } : {}), path: selectedPath, identity, approved, expected_path: BROWNFIELD_PLAN_IDENTITY };
}
export function buildPrompts({ approvalRef = 'owner-eval-approval', plainRequest = true } = {}) {
  const owner = 'Read the owner inputs at inputs/owner/TASK.md and inputs/owner/BRIEF.md.'; return {
    'a-plan': plainRequest ? `${owner} Please plan the requested multi-step repair and its regression verification. Keep to the supplied write scope and carry my approved decisions into a fresh session. Present the plan for my approval, then stop.` : `$work-plan\n${owner} Plan this brownfield change, then stop after the plan is complete.`,
    approval: `I approve the plan you presented. Use approval reference ${approvalRef}. Record my approval, then stop.`,
    'a-pause': `$work-pause\n${owner} Create the normal checkpoint for this completed plan, then stop.`,
    'b-resume-execute': `${owner} Continue the approved work from the previous session, then stop.`,
    'c-verify': `$work-verify\n${owner} Verify the completed implementation, then stop.`,
    'c-progress': `$work-progress\n${owner} Report current progress read-only, then stop.`,
  };
}
export function captureCheckpoint(consumerRoot) {
  const file = path.join(path.resolve(consumerRoot), '.work', '.continue-here.md'), stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new EvalError('protocol_invalid', 'canonical checkpoint is missing');
  return { path: '.work/.continue-here.md', sha256: fileSha256(file), bytes: stat.size };
}
export function readSelectedPlanIdentity(consumerRoot) {
  const file = path.join(path.resolve(consumerRoot), '.work', 'state.json'), stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) return { ok: false, evaluatorFailure: true, reason: 'lifecycle_state_missing' };
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { ok: false, evaluatorFailure: true, reason: 'lifecycle_state_unreadable' }; }
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const plan = state?.workflow?.plan;
  if (!object(state) || ('workflow' in state && !object(state.workflow))
    || (state.workflow && 'plan' in state.workflow && !object(plan))
    || (plan && (['path', 'identity'].some(key => plan[key] != null && typeof plan[key] !== 'string')
      || ('approved' in plan && typeof plan.approved !== 'boolean')))) {
    return { ok: false, evaluatorFailure: true, reason: 'lifecycle_state_malformed' };
  }
  return classifyPlanSelection(plan);
}
export function observeApproval({ consumerRoot, checkpoint, approvalRef, presentedPlanSha256 }) {
  const selection = readSelectedPlanIdentity(consumerRoot);
  if (selection.evaluatorFailure) return selection;
  const selected = classifyPlanSelection(selection, true);
  if (!selected.ok) return { ...selected, plan_selection: selected };
  const root = path.resolve(consumerRoot), state = JSON.parse(fs.readFileSync(path.join(root, '.work/state.json'), 'utf8'));
  const workflow = state.workflow, plan = workflow.plan, file = path.join(root, BROWNFIELD_PLAN_IDENTITY);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false }), hash = stat?.isFile() && !stat.isSymbolicLink() ? fileSha256(file) : null;
  const unchanged = Boolean(hash) && hash === presentedPlanSha256;
  const ok = unchanged && plan.approved === true && plan.approved_sha256 === hash
    && workflow.authority === 'owner' && workflow.approval_ref === approvalRef;
  return { ok, reason: ok ? null : (!unchanged ? 'approval_plan_mutated' : 'approval_not_bound'), authority: workflow.authority,
    approval_ref: workflow.approval_ref, plan_path: plan.path, plan_identity: plan.identity,
    plan_approved: plan.approved, approved_sha256: plan.approved_sha256 || null, expected_approval_ref: approvalRef,
    plan_sha256: hash, presented_plan_sha256: presentedPlanSha256, checkpoint_sha256: checkpoint ? captureCheckpoint(root).sha256 : null };
}
export function validateTopology({ aPlan, aPause, b, cVerify, cProgress }) {
  const values = [aPlan, aPause, b, cVerify, cProgress];
  if (values.some(value => !value)) return { ok: false, reason: 'session_identity_missing' };
  if (aPlan !== aPause || cVerify !== cProgress) return { ok: false, reason: 'within_session_identity_mismatch' };
  if (new Set([aPlan, b, cVerify]).size !== 3) return { ok: false, reason: 'fresh_session_identity_reused' };
  return { ok: true };
}
export async function runJourney(options) {
  const prompts = options.prompts || buildPrompts({ approvalRef: options.approvalRef });
  const capture = options.captureCheckpoint || (() => captureCheckpoint(options.consumerRoot));
  const observe = options.observeApproval || (input => observeApproval({ consumerRoot: options.consumerRoot, approvalRef: options.approvalRef, ...input }));
  const selectPlan = options.selectPlan || (() => readSelectedPlanIdentity(options.consumerRoot));
  const planHash = options.capturePlanSha256 || (() => fileSha256(path.join(options.consumerRoot, BROWNFIELD_PLAN_IDENTITY)));
  const witness = options.checkpointWitness || ((result, checkpoint) => findCheckpointWitness(result.events || [], {
    consumerRoot: options.consumerRoot, checkpointSha256: checkpoint.sha256, sessionId: result.sessionId,
  }));
  const turns = {};
  const run = async (id, sessionId = null) => {
    const result = await options.transport.runTurn({ id, prompt: prompts[id], sessionId,
      cwd: options.consumerRoot, runRoot: options.runRoot, hardTimeoutMs: options.hardTimeoutMs });
    turns[id] = result;
    if (['a-plan', 'a-pause'].includes(id) && result.outcome === 'completed') {
      result.lane_selection = selectPlan();
      if (id === 'a-plan' && result.lane_selection?.ok) result.plan_sha256 = planHash();
    }
    if (!['b-resume-execute', 'approval'].includes(id)) options.record?.(id, result);
    return result;
  };
  const selectionFailure = selection => {
    if (selection?.evaluatorFailure) return { outcome: 'protocol_invalid', failure_code: selection.reason, turns, stopped_before_approval: true };
    const assessed = classifyPlanSelection(selection);
    if (selection?.ok !== assessed.ok || (selection?.reason && selection.reason !== assessed.reason)
      || selection?.expected_path !== BROWNFIELD_PLAN_IDENTITY) return { outcome: 'protocol_invalid', failure_code: 'selection_evidence_conflict', turns };
    return assessed.ok ? null : { outcome: 'task_red', failure_code: assessed.reason, turns, planSelection: assessed, stopped_before_approval: true };
  };
  const aPlan = await run('a-plan');
  if (aPlan.outcome !== 'completed') return { outcome: aPlan.outcome, turns };
  const initialFailure = selectionFailure(aPlan.lane_selection);
  if (initialFailure) return initialFailure;
  const presentedPlanSha256 = aPlan.plan_sha256;
  const aPause = await run('a-pause', aPlan.sessionId);
  if (aPause.outcome !== 'completed') return { outcome: aPause.outcome, turns };
  if (aPause.sessionId !== aPlan.sessionId) return { outcome: 'protocol_invalid', failure_code: 'a_session_mismatch', turns };
  const planSelection = aPause.lane_selection, pausedFailure = selectionFailure(planSelection);
  if (pausedFailure) return pausedFailure;
  const checkpoint = capture(), approvalTurn = await run('approval', aPlan.sessionId);
  const approval = { ...observe({ checkpoint, presentedPlanSha256 }), turn: approvalTurn };
  options.record?.('approval', approval);
  if (approvalTurn.outcome !== 'completed') return { outcome: approvalTurn.outcome, turns, checkpoint, approval };
  if (approvalTurn.sessionId !== aPlan.sessionId) return { outcome: 'protocol_invalid', failure_code: 'approval_session_mismatch', turns, checkpoint, approval };
  if (!approval.ok) return { outcome: approval.evaluatorFailure ? 'protocol_invalid' : 'task_red', failure_code: approval.reason,
    turns, checkpoint, approval, planSelection, stopped_before_execution: true };
  if (approval.checkpoint_sha256 !== checkpoint.sha256 || capture().sha256 !== checkpoint.sha256) {
    return { outcome: 'protocol_invalid', failure_code: 'approval_checkpoint_mutation', turns };
  }
  const b = await run('b-resume-execute');
  if (b.outcome !== 'completed') { options.record?.('b-resume-execute', b); return { outcome: b.outcome, turns, checkpoint, approval }; }
  if (b.sessionId === aPlan.sessionId) { options.record?.('b-resume-execute', b); return { outcome: 'protocol_invalid', failure_code: 'b_session_reused', turns, checkpoint, approval }; }
  const checkpointRead = witness(b, checkpoint);
  options.record?.('b-resume-execute', { ...b, checkpoint_witness: checkpointRead });
  if (!checkpointRead?.ok) return { outcome: 'protocol_invalid', failure_code: checkpointRead?.reason, turns, checkpoint, approval };
  const cVerify = await run('c-verify');
  if (cVerify.outcome !== 'completed') return { outcome: cVerify.outcome, turns, checkpoint, approval };
  if ([aPlan.sessionId, b.sessionId].includes(cVerify.sessionId)) return { outcome: 'protocol_invalid', failure_code: 'c_session_reused', turns, checkpoint, approval };
  const cProgress = await run('c-progress', cVerify.sessionId);
  if (cProgress.outcome !== 'completed') return { outcome: cProgress.outcome, turns, checkpoint, approval };
  const topology = validateTopology({ aPlan: aPlan.sessionId, aPause: aPause.sessionId, b: b.sessionId, cVerify: cVerify.sessionId, cProgress: cProgress.sessionId });
  return topology.ok ? { outcome: 'completed', turns, checkpoint, checkpointRead, approval, planSelection, topology }
    : { outcome: 'protocol_invalid', failure_code: topology.reason, turns, checkpoint, approval, planSelection, topology };
}
