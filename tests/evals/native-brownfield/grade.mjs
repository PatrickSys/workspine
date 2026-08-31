import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify, command, EvalError, fileSha256, sha256, toPosix, treeManifest } from './util.mjs';
const SETUP_PREFIXES = ['.agents/', '.work/', 'inputs/', 'node_modules/'];
const VALID_REPRODUCTION = Symbol('validated generic Workspine reproduction');
export function evaluateScope(actualPaths, allowedPaths) {
  const allowed = new Set(allowedPaths.map(toPosix));
  const actual = [...new Set(actualPaths.map(toPosix))].sort();
  const unexpected = actual.filter(file => !allowed.has(file));
  return { ok: unexpected.length === 0, actual, unexpected };
}
export function changedPaths(before, after) {
  const left = new Map((before?.files || []).map(row => [row.path, row]));
  const right = new Map((after?.files || []).map(row => [row.path, row]));
  return [...new Set([...left.keys(), ...right.keys()])].filter(file => {
    const a = left.get(file), b = right.get(file);
    return !a || !b || canonicalStringify(a) !== canonicalStringify(b);
  }).sort();
}
export function validateGenericReproduction(binding) {
  if (!binding) return null;
  const file = path.resolve(binding.path || ''), stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || fileSha256(file) !== binding.sha256) throw new EvalError('evaluator_invalid', 'generic reproduction receipt binding is invalid');
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt.schema_version !== 1 || receipt.record_type !== 'generic_workspine_reproduction'
    || receipt.status !== 'confirmed' || receipt.task_independent !== true || receipt.hidden_witness_used !== false
    || !receipt.failure_code || !/^[0-9a-f]{64}$/i.test(receipt.evidence_sha256 || '')) {
    throw new EvalError('evaluator_invalid', 'generic reproduction receipt is not independently valid');
  }
  return { [VALID_REPRODUCTION]: true, sha256: binding.sha256 };
}
export function classifyGrade({ oraclePassed, scopePassed, workflowPassed, genericReproduction }) {
  if (oraclePassed && scopePassed && workflowPassed) return 'product_green';
  if (oraclePassed && scopePassed && !workflowPassed && genericReproduction?.[VALID_REPRODUCTION] === true) return 'workspine_red';
  return 'task_red';
}
export function observeWorkflow(consumerRoot, approvalRef) {
  const root = path.resolve(consumerRoot);
  const required = ['.work/brownfield-change/CHANGE.md', '.work/brownfield-change/HANDOFF.md',
    '.work/brownfield-change/VERIFICATION.md', '.work/state.json'];
  const artifacts = Object.fromEntries(required.map(relative => {
    const file = path.join(root, ...relative.split('/'));
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return [relative, stat?.isFile() && !stat.isSymbolicLink() ? fileSha256(file) : null];
  }));
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(root, '.work', 'state.json'), 'utf8')); } catch {}
  const workflow = state?.workflow, plan = '.work/brownfield-change/CHANGE.md', verification = '.work/brownfield-change/VERIFICATION.md', ok = Object.values(artifacts).every(Boolean) && state?.current_state === 'audit' && workflow?.current_state === 'audit'
    && workflow?.authority === 'workflow' && typeof approvalRef === 'string' && Boolean(approvalRef.trim()) && workflow?.approval_ref === approvalRef
    && workflow?.plan?.approved === true && workflow.plan.path === plan && workflow.plan.identity === plan
    && workflow?.execution?.status === 'complete' && workflow.execution.artifact === verification && workflow.execution.identity === verification
    && workflow?.verification?.status === 'passed' && workflow.verification.artifact === verification && workflow.verification.identity === verification;
  return { ok, artifacts, state_projection: state ? {
    current_state: state.current_state, authority: workflow?.authority || null, approval_ref: workflow?.approval_ref || null,
    plan_approved: workflow?.plan?.approved ?? null, execution_status: workflow?.execution?.status || null,
    verification_status: workflow?.verification?.status || null,
  } : null };
}
export function runOracle(consumerRoot, oracle) {
  if (!oracle?.executable || !Array.isArray(oracle.args)) throw new EvalError('evaluator_invalid', 'oracle command is missing');
  const result = command(oracle.executable, oracle.args.map(value => String(value).replaceAll('{root}', path.resolve(consumerRoot))), {
    cwd: path.resolve(consumerRoot), allowFailure: true, timeoutMs: oracle.timeout_ms || 120_000,
  });
  return { passed: result.status === 0, exit_code: result.status,
    stdout_sha256: sha256(result.stdout), stderr_sha256: sha256(result.stderr) };
}
export function gradeWorkspace({ consumerRoot, baselineManifest, allowedPaths, oracle, approvalRef, genericReproduction: binding }) {
  const finalManifest = treeManifest(path.resolve(consumerRoot), relative => SETUP_PREFIXES.some(prefix => relative.startsWith(prefix)) || relative === '.git');
  const scope = evaluateScope(changedPaths(baselineManifest, finalManifest), allowedPaths);
  const oracleResult = runOracle(consumerRoot, oracle);
  const workflow = observeWorkflow(consumerRoot, approvalRef);
  const patch = command('git', ['diff', '--binary', 'HEAD', '--'], { cwd: path.resolve(consumerRoot), allowFailure: true });
  const genericReproduction = validateGenericReproduction(binding);
  const outcome = classifyGrade({ oraclePassed: oracleResult.passed, scopePassed: scope.ok,
    workflowPassed: workflow.ok, genericReproduction });
  const grade = { outcome, oracle: oracleResult, scope, workflow, final_manifest: finalManifest,
    patch_sha256: patch.status === 0 ? sha256(patch.stdout) : null,
    generic_reproduction_sha256: genericReproduction?.sha256 || null };
  return { ...grade, grade_sha256: sha256(canonicalStringify(grade)) };
}
