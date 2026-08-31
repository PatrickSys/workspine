import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify, command, EvalError, fileSha256 } from './util.mjs';
import { findCheckpointWitness } from './codex.mjs';
export function buildPrompts() {
  const owner = 'Read the owner inputs at inputs/owner/TASK.md and inputs/owner/BRIEF.md.'; return {
    'a-plan': `$work-plan\n${owner} Plan this brownfield change, then stop after the plan is complete.`,
    'a-pause': `$work-pause\n${owner} Create the normal checkpoint for this completed plan, then stop.`,
    'b-resume-execute': `$work-resume and $work-execute\n${owner} Resume the approved plan and execute it, then stop.`,
    'c-verify': `$work-verify\n${owner} Verify the completed implementation, then stop.`,
    'c-progress': `$work-progress\n${owner} Report current progress read-only, then stop.`,
  };
}
export function captureCheckpoint(consumerRoot) {
  const file = path.join(path.resolve(consumerRoot), '.work', '.continue-here.md'), stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new EvalError('protocol_invalid', 'canonical checkpoint is missing');
  return { path: '.work/.continue-here.md', sha256: fileSha256(file), bytes: stat.size };
}
export function approvePlan({ consumerRoot, checkpoint, approvalRef }) {
  const root = path.resolve(consumerRoot), planRelative = '.work/brownfield-change/CHANGE.md';
  const planFile = path.join(root, ...planRelative.split('/'));
  const planStat = fs.lstatSync(planFile, { throwIfNoEntry: false });
  if (!planStat?.isFile() || planStat.isSymbolicLink()) throw new EvalError('protocol_invalid', 'canonical plan is missing');
  const expectedPlan = fileSha256(planFile);
  const expectedCheckpoint = captureCheckpoint(root).sha256;
  if (expectedCheckpoint !== checkpoint.sha256) throw new EvalError('protocol_invalid', 'checkpoint changed before approval');
  const cli = path.join(root, '.work', 'bin', 'gsdd.mjs');
  const result = command(process.execPath, [cli, 'lifecycle-transition', 'approve', '--plan', planRelative,
    '--authority', 'owner', '--approval-ref', approvalRef, '--json', '--no-update-notice'], { cwd: root });
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { throw new EvalError('protocol_invalid', 'approval output is malformed'); }
  const state = receipt.state;
  const workflow = state?.workflow;
  let persisted;
  try { persisted = JSON.parse(fs.readFileSync(path.join(root, '.work', 'state.json'), 'utf8')); }
  catch { throw new EvalError('protocol_invalid', 'persisted approval state is unreadable'); }
  if (receipt.status !== 'ok' || receipt.changed !== true || workflow?.authority !== 'owner'
    || workflow?.approval_ref !== approvalRef || workflow?.plan?.approved !== true
    || workflow.plan.path !== planRelative || workflow.plan.identity !== planRelative
    || canonicalStringify(persisted) !== canonicalStringify(state)) {
    throw new EvalError('protocol_invalid', 'approval state does not match owner authority');
  }
  if (fileSha256(planFile) !== expectedPlan || captureCheckpoint(root).sha256 !== expectedCheckpoint) {
    throw new EvalError('protocol_invalid', 'approval mutated bound plan or checkpoint');
  }
  return { ok: true, authority: 'owner', approval_ref: approvalRef, plan_path: planRelative,
    plan_sha256: expectedPlan, checkpoint_sha256: expectedCheckpoint };
}
export function validateTopology({ aPlan, aPause, b, cVerify, cProgress }) {
  const values = [aPlan, aPause, b, cVerify, cProgress];
  if (values.some(value => !value)) return { ok: false, reason: 'session_identity_missing' };
  if (aPlan !== aPause || cVerify !== cProgress) return { ok: false, reason: 'within_session_identity_mismatch' };
  if (new Set([aPlan, b, cVerify]).size !== 3) return { ok: false, reason: 'fresh_session_identity_reused' };
  return { ok: true };
}
export async function runJourney(options) {
  const prompts = options.prompts || buildPrompts();
  const capture = options.captureCheckpoint || (() => captureCheckpoint(options.consumerRoot));
  const approve = options.approve || (input => approvePlan({ consumerRoot: options.consumerRoot,
    approvalRef: options.approvalRef, ...input }));
  const witness = options.checkpointWitness || ((result, checkpoint) => findCheckpointWitness(result.events || [], {
    consumerRoot: options.consumerRoot, checkpointSha256: checkpoint.sha256, sessionId: result.sessionId,
  }));
  const turns = {};
  const run = async (id, sessionId = null) => {
    const result = await options.transport.runTurn({ id, prompt: prompts[id], sessionId,
      cwd: options.consumerRoot, runRoot: options.runRoot, hardTimeoutMs: options.hardTimeoutMs });
    turns[id] = result;
    if (id !== 'b-resume-execute') options.record?.(id, result);
    return result;
  };
  const aPlan = await run('a-plan');
  if (aPlan.outcome !== 'completed') return { outcome: aPlan.outcome, turns };
  const aPause = await run('a-pause', aPlan.sessionId);
  if (aPause.outcome !== 'completed') return { outcome: aPause.outcome, turns };
  if (aPause.sessionId !== aPlan.sessionId) return { outcome: 'protocol_invalid', failure_code: 'a_session_mismatch', turns };
  const checkpoint = capture();
  const approval = approve({ checkpoint });
  options.record?.('approval', approval);
  if (!approval?.ok || approval.checkpoint_sha256 !== checkpoint.sha256 || capture().sha256 !== checkpoint.sha256) {
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
  const topology = validateTopology({ aPlan: aPlan.sessionId, aPause: aPause.sessionId,
    b: b.sessionId, cVerify: cVerify.sessionId, cProgress: cProgress.sessionId });
  return topology.ok ? { outcome: 'completed', turns, checkpoint, checkpointRead, approval, topology }
    : { outcome: 'protocol_invalid', failure_code: topology.reason, turns, checkpoint, approval, topology };
}
