#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexTransport } from './codex.mjs';
import { gradeWorkspace } from './grade.mjs';
import { buildPrompts, runJourney } from './journey.mjs';
import { cleanupIsolatedCodexHome, createIsolatedCodexHome, restoreIsolatedCodexHomePosture, verifyFrozenCandidate } from './prepare.mjs';
import { ReceiptChain, verifySeal } from './seal.mjs';
import { canonicalStringify, command, EvalError, fileSha256, readJson, sha256 } from './util.mjs';
const SOURCE_FILES = ['cli.mjs', 'util.mjs', 'prepare.mjs', 'codex.mjs', 'journey.mjs', 'grade.mjs', 'seal.mjs'];
const TURN_RECEIPTS = { 'a-plan': [100, 'a-plan'], 'a-pause': [110, 'a-pause'],
  approval: [120, 'approval'], 'b-resume-execute': [200, 'b-resume-execute'],
  'c-verify': [300, 'c-verify'], 'c-progress': [310, 'c-progress'] };
function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--') || rest[index + 1] == null) throw new EvalError('evaluator_invalid', `invalid argument: ${rest[index]}`);
    flags[rest[index].slice(2)] = rest[index + 1];
  }
  return { mode, flags };
}
function characterize() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const lines = SOURCE_FILES.reduce((sum, file) => sum + fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length - 1, 0);
  if (lines > 800) throw new EvalError('evaluator_invalid', `primary evaluator exceeds 800 lines: ${lines}`);
  return { schema_version: 1, mode: 'characterize', provider_invoked: false, primary_source_lines: lines,
    stages: ['a-plan', 'a-pause', 'approval', 'b-resume-execute', 'c-verify', 'c-progress'],
    session_topology: { A: ['a-plan', 'a-pause'], B: ['b-resume-execute'], C: ['c-verify', 'c-progress'] },
    public_fields: ['disposition', 'failure_domain'], seal_layer: 'terminal_ordered_links' };
}
function readFreeze(file) {
  const freeze = readJson(path.resolve(file));
  for (const key of ['schema_version', 'run_id', 'consumer_root', 'run_root', 'workspine_root', 'candidate_tarball',
    'expected_candidate', 'baseline_manifest', 'allowed_paths', 'oracle', 'approval_ref', 'hard_timeout_ms',
    'codex_source_home', 'codex_home_parent', 'prompts', 'skill_hashes', 'case_hashes', 'tool_versions'])
    if (freeze[key] == null) throw new EvalError('evaluator_invalid', `freeze field is missing: ${key}`);
  verifyFrozenCandidate({ repoRoot: freeze.workspine_root, tarball: freeze.candidate_tarball, expected: freeze.expected_candidate });
  return freeze;
}
function qualify(freezeFile, runRoot) {
  const freeze = readFreeze(freezeFile);
  if (path.resolve(runRoot) !== path.resolve(freeze.run_root)) throw new EvalError('evaluator_invalid', 'run root mismatch');
  const chain = new ReceiptChain(runRoot, freeze.run_id);
  const { codex_source_home: _sourceHome, codex_home_parent: _homeParent, ...sealedFreeze } = freeze;
  chain.append(0, 'manifest', 'manifest', { freeze_sha256: fileSha256(freezeFile), freeze: sealedFreeze });
  let isolated = null;
  try {
    isolated = createIsolatedCodexHome({ sourceHome: freeze.codex_source_home, parent: freeze.codex_home_parent, runId: freeze.run_id });
    const env = { ...process.env, CODEX_HOME: isolated.home };
    const login = command('codex', ['login', 'status'], { env, allowFailure: true, timeoutMs: 30_000 });
    const version = command('codex', ['--version'], { env, allowFailure: true, timeoutMs: 30_000 });
    const isolatedOk = restoreIsolatedCodexHomePosture(isolated.home);
    const ok = login.status === 0 && version.status === 0 && isolatedOk;
    chain.append(10, 'qualification', 'qualification', { ok, provider_invoked: false, posture: isolated.posture,
      codex_version: version.stdout.trim(), login_status: login.status, isolated_home_unchanged: isolatedOk });
    if (!ok) throw new EvalError('environment_invalid', 'Codex qualification failed');
    return { ok, home: isolated.home };
  } catch (error) {
    if (!fs.existsSync(path.join(runRoot, 'receipts', '010-qualification.json'))) chain.append(10, 'qualification', 'qualification', { ok: false, provider_invoked: false, failure_code: error.code || 'qualification_error' });
    chain.terminal(error.code === 'evaluator_invalid' ? 'evaluator_invalid' : 'environment_invalid', { failure_code: error.code || 'codex_qualification_failed' });
    if (isolated) cleanupIsolatedCodexHome(isolated.home, freeze.codex_home_parent);
    throw error;
  }
}
function appendTurn(chain, id, value) {
  if (id === 'checkpoint-witness') return;
  const [sequence, name] = TURN_RECEIPTS[id];
  const payload = id === 'approval' ? value : {
    outcome: value.outcome, failure_code: value.failure_code || null, session_id: value.sessionId || null,
    turn_id: value.turnId || null, usage: value.usage, event_stream_sha256: value.eventsFile ? fileSha256(value.eventsFile) : null,
    checkpoint_witness: value.checkpoint_witness || null,
  };
  chain.append(sequence, name, id === 'approval' ? 'approval' : 'turn', payload);
}
async function run(freezeFile, runRoot) {
  const freeze = readFreeze(freezeFile);
  if (path.resolve(runRoot) !== path.resolve(freeze.run_root)) throw new EvalError('evaluator_invalid', 'run root mismatch');
  const chain = new ReceiptChain(runRoot, freeze.run_id, { resume: true });
  const manifest = readJson(path.join(runRoot, 'receipts', '000-manifest.json'));
  if (manifest.payload?.freeze_sha256 !== fileSha256(freezeFile)) throw new EvalError('evaluator_invalid', 'freeze changed after qualification');
  for (const receipt of ['000-manifest.json', '010-qualification.json']) {
    if (!fs.existsSync(path.join(runRoot, 'receipts', receipt))) throw new EvalError('evaluator_invalid', 'successful qualification prefix is missing');
  }
  if (readJson(path.join(runRoot, 'receipts', '010-qualification.json')).payload.ok !== true
    || fs.existsSync(path.join(runRoot, 'receipts', '900-terminal-seal.json'))) {
    throw new EvalError('evaluator_invalid', 'qualification did not authorize a journey');
  }
  if (fs.existsSync(path.join(runRoot, 'receipts', '100-a-plan.json'))) throw new EvalError('evaluator_invalid', 'journey was already invoked');
  const home = path.join(path.resolve(freeze.codex_home_parent), `workspine-codex-${freeze.run_id}`);
  const transport = new CodexTransport({ model: 'gpt-5.6-luna', effort: 'high', env: { ...process.env, CODEX_HOME: home } });
  try {
    const homeFiles = fs.readdirSync(home), auth = fs.lstatSync(path.join(home, 'auth.json'), { throwIfNoEntry: false });
    if (homeFiles.length !== 1 || homeFiles[0] !== 'auth.json' || !auth?.isFile() || auth.isSymbolicLink()) throw new EvalError('environment_invalid', 'qualified CODEX_HOME posture changed');
    const result = await runJourney({ transport, consumerRoot: freeze.consumer_root, runRoot, hardTimeoutMs: freeze.hard_timeout_ms,
      approvalRef: freeze.approval_ref, prompts: freeze.prompts || buildPrompts(), record: (id, value) => appendTurn(chain, id, value) });
    if (result.outcome !== 'completed') return chain.terminal(result.outcome, { failure_code: result.failure_code || null });
    const grade = gradeWorkspace({ consumerRoot: freeze.consumer_root, baselineManifest: freeze.baseline_manifest,
      allowedPaths: freeze.allowed_paths, oracle: freeze.oracle, approvalRef: freeze.approval_ref, genericReproduction: freeze.generic_reproduction });
    chain.append(400, 'oracle', 'oracle', grade.oracle);
    chain.append(410, 'grade', 'grade', grade);
    const regrade = gradeWorkspace({ consumerRoot: freeze.consumer_root, baselineManifest: freeze.baseline_manifest,
      allowedPaths: freeze.allowed_paths, oracle: freeze.oracle, approvalRef: freeze.approval_ref, genericReproduction: freeze.generic_reproduction });
    chain.append(420, 'regrade', 'regrade', { grade_sha256: regrade.grade_sha256, matches: regrade.grade_sha256 === grade.grade_sha256 });
    if (regrade.grade_sha256 !== grade.grade_sha256) return chain.terminal('evaluator_invalid', { failure_code: 'regrade_mismatch' });
    return chain.terminal(grade.outcome, { grade_sha256: grade.grade_sha256, final_tree_sha256: grade.final_manifest.sha256,
      patch_sha256: grade.patch_sha256, oracle_result_sha256: sha256(canonicalStringify(grade.oracle)),
      generic_reproduction_sha256: grade.generic_reproduction_sha256 },
    { genericReproductionSha256: grade.generic_reproduction_sha256 });
  } catch (error) {
    const outcome = ['provider_invalid', 'protocol_invalid', 'evaluator_invalid', 'environment_invalid'].includes(error.code)
      ? error.code : 'evaluator_invalid';
    return chain.terminal(outcome, { failure_code: error.code || 'untyped_evaluator_error', message: String(error.message || error).slice(0, 1000) });
  } finally {
    cleanupIsolatedCodexHome(home, freeze.codex_home_parent);
  }
}
function calibrate(caseFile) {
  const file = path.resolve(caseFile);
  const value = readJson(file);
  if (!value.id || !value.calibration?.executable || !Array.isArray(value.calibration.args)) {
    throw new EvalError('evaluator_invalid', 'case calibration command is missing');
  }
  const result = command(value.calibration.executable,
    value.calibration.args.map(arg => String(arg).replaceAll('{case}', file)), { cwd: path.dirname(file), allowFailure: true });
  let controls;
  try { controls = JSON.parse(result.stdout); } catch { throw new EvalError('evaluator_invalid', 'calibration output is malformed'); }
  if (result.status !== 0 || controls.network_accessed !== false || controls.baseline !== 'red' || controls.witness !== 'green'
    || !Array.isArray(controls.mutants) || controls.mutants.length < 1 || controls.mutants.some(row => row.result !== 'red')) {
    throw new EvalError('evaluator_invalid', 'calibration controls failed');
  }
  return { ok: true, provider_invoked: false, case: value.id, case_sha256: fileSha256(file), controls_sha256: sha256(canonicalStringify(controls)) };
}
function regrade(runRoot) {
  const manifest = readJson(path.join(path.resolve(runRoot), 'receipts', '000-manifest.json'));
  const freeze = manifest.payload.freeze;
  const grade = gradeWorkspace({ consumerRoot: freeze.consumer_root, baselineManifest: freeze.baseline_manifest,
    allowedPaths: freeze.allowed_paths, oracle: freeze.oracle, approvalRef: freeze.approval_ref, genericReproduction: freeze.generic_reproduction });
  const sealed = readJson(path.join(path.resolve(runRoot), 'receipts', '410-grade.json'));
  if (grade.grade_sha256 !== sealed.payload.grade_sha256) throw new EvalError('evaluator_invalid', 'offline regrade mismatch');
  return { ok: true, provider_invoked: false, grade_sha256: grade.grade_sha256 };
}
export async function main(argv = process.argv.slice(2)) {
  const { mode, flags } = parseArgs(argv);
  if (mode === 'characterize') return characterize();
  if (mode === 'qualify') return qualify(flags.freeze, flags['run-root']);
  if (mode === 'run') return run(flags.freeze, flags['run-root']);
  if (mode === 'regrade') return regrade(flags['run-root']);
  if (mode === 'validate-result') return { ok: true, provider_invoked: false, ...verifySeal(flags['run-root']) };
  if (mode === 'calibrate') return calibrate(flags.case);
  throw new EvalError('evaluator_invalid', `unsupported mode: ${mode || '<missing>'}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => process.stdout.write(`${canonicalStringify(value)}\n`)).catch(error => {
    process.stderr.write(`${canonicalStringify({ code: error.code || 'evaluator_invalid', message: error.message })}\n`);
    process.exitCode = 1;
  });
}
