'use strict';

// The observer is deliberately case-specific. It consumes sealed runner bytes
// and a retained consumer root; it never resolves, imports, or invokes a provider.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CASE_ID = 'itsdangerous-fips-sha1';
const CASE_REVISION = '93ae366874bbd4f69d90495c45b2cd336387496c';
const CASE_SHA256 = 'e77f420a8036a80b1ff96f9c6a96ffb3f9e4d32e724d4a33604a24119bb97c3f';
const ORACLE_SHA256 = '21a66bfd5b2d00c0199a5b4fbba75af507c112ff4f8717f7f13e3ee498ca1a11';
const CASE_CONTRACT = 'phase16-public-case-v1';
const OBSERVATION_CONTRACT = 'phase16-itsdangerous-observation-v1';
const ORACLE_CONTRACT = 'phase16-itsdangerous-oracle-v1';
const GRADE_CONTRACT = 'phase16-itsdangerous-grade-v1';
const REGRADE_CONTRACT = 'phase16-itsdangerous-regrade-v1';
const PROJECTION_CONTRACT = 'phase16-itsdangerous-public-result-v1';
const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const EVALUATOR_LEDGER_CONTRACT = 'phase16-evaluator-ledger-v1';
const EVALUATOR_FILES = Object.freeze([
  'tests/evals/phase16-real-agent.cjs',
  'tests/evals/phase16-codex-recorder.cjs',
  'tests/evals/phase16-core-flows.cjs',
  'tests/evals/phase16-itsdangerous-observer.cjs',
]);
const WORKFLOW_STEPS = Object.freeze(['turn-a-plan', 'turn-a-pause', 'turn-b-resume-execute', 'turn-c-verify', 'turn-c-progress']);
const DISPOSITIONS = Object.freeze(['passed', 'product_red', 'infrastructure_invalid', 'identity_unknown', 'human_needed']);
const PLAN_TOKEN_CEILING = 6000000;
const PAUSE_TOKEN_CEILING = 1000000;
const TURN_CONTRACT = Object.freeze([
  ['turn-a-plan', 'a-plan', 'work-plan', ['work-plan'], 30, PLAN_TOKEN_CEILING, 'A', true],
  ['turn-a-pause', 'a-pause', 'work-pause', ['work-pause'], 5, PAUSE_TOKEN_CEILING, 'A', false],
  ['turn-b-resume-execute', 'b-resume-execute', 'work-resume', ['work-resume', 'work-execute'], 20, 2500000, 'B', true],
  ['turn-c-verify', 'c-verify', 'work-verify', ['work-verify'], 12, 1500000, 'C', true],
  ['turn-c-progress', 'c-progress', 'work-progress', ['work-progress'], 5, 500000, 'C', false],
]);
const TURN_TOTAL_WALL_MINUTES = 72;
const TURN_TOTAL_NATIVE_TOKENS = 11500000;

function expectedNativeArgv(turn, sessionId = null) {
  const base = turn[7]
    ? ['exec', '--approve-for-me', '-C', '<REDACTED_PATH>']
    : ['exec', '--approve-for-me', 'resume', sessionId];
  return [...base, '--ignore-user-config', '--json', ...(turn[7] ? ['--color', 'never'] : []), '-m', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="high"', '-'];
}

function validateNativeArgv(receipt, expectedTurn, sessions) {
  const expectedSession = expectedTurn[7] ? null : sessions?.[expectedTurn[6]];
  if (!expectedTurn[7] && !expectedSession) fail('turn_argv_invalid', `resumed turn lacks its declared session: ${expectedTurn[0]}`);
  if (!Array.isArray(receipt.invocation?.argv) || stable(receipt.invocation.argv) !== stable(expectedNativeArgv(expectedTurn, expectedSession))) fail('turn_argv_invalid', `native argv does not match the fixed ${expectedTurn[0]} grammar`);
}

class ObserverFailure extends Error {
  constructor(code, message, evidence = null) {
    super(message);
    this.code = code;
    this.evidence = evidence;
  }
}

const fail = (code, message, evidence = null) => { throw new ObserverFailure(code, message, evidence); };
const exists = (file) => fs.existsSync(file);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = (file) => sha256(fs.readFileSync(file));
const text = (file) => fs.readFileSync(file, 'utf8');
const slash = (value) => String(value).split(path.sep).join('/');
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const stableHash = (value) => sha256(Buffer.from(stable(value), 'utf8'));

function writeExclusive(file, value) {
  if (exists(file)) fail('receipt_exists', 'refusing to replace an existing observer receipt', { path: slash(file) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') fail('receipt_exists', 'refusing to replace an existing observer receipt'); throw error; }
}

function readJson(file, code = 'receipt_invalid') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(code, 'observer receipt is not valid JSON', { message: error.message }); }
}

function readCase(caseFile) {
  const data = readJson(caseFile, 'case_invalid');
  if (fileSha(caseFile) !== CASE_SHA256 || data.id !== CASE_ID || data.contract !== CASE_CONTRACT || data.source?.revision !== CASE_REVISION || data.oracle?.path !== 'tests/evals/cases/itsdangerous-fips-sha1-oracle.py' || data.oracle?.sha256?.toLowerCase() !== ORACLE_SHA256) fail('case_pin_mismatch', 'observer only accepts the pinned public itsdangerous case');
  if (data.source?.repository !== 'https://github.com/pallets/itsdangerous.git') fail('case_pin_mismatch', 'observer only accepts the pinned public upstream');
  return data;
}

function validHash(value) { return /^[0-9a-f]{64}$/i.test(String(value || '')); }

function validateEvaluatorLedger(ledger) {
  if (ledger?.contract !== EVALUATOR_LEDGER_CONTRACT || !ledger.files || stable(Object.keys(ledger.files).sort()) !== stable(EVALUATOR_FILES.slice().sort())) fail('evaluator_binding_mismatch', 'freeze evaluator ledger is missing or has an unexpected file set');
  for (const relative of EVALUATOR_FILES) {
    const expected = ledger.files[relative];
    const file = path.join(REPO, ...relative.split('/'));
    if (!expected || !Number.isInteger(expected.bytes) || !validHash(expected.sha256) || !exists(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || expected.bytes !== fs.statSync(file).size || expected.sha256.toLowerCase() !== fileSha(file)) fail('evaluator_binding_mismatch', `evaluator file bytes differ from the freeze: ${relative}`);
  }
  return ledger;
}

function validateFreeze(data, freeze, caseFile, controlsFile = null) {
  if (freeze.schema_version !== 1 || freeze.contract !== 'phase16-rooted-codex-freeze-v1' || freeze.case_id !== CASE_ID || freeze.provider_sandbox !== 'not_claimed' || freeze.workflow_verdict !== 'not_evaluated') fail('freeze_binding_mismatch', 'freeze contract or claim posture is not exact');
  validateEvaluatorLedger(freeze.evaluator);
  if (freeze.case?.sha256 !== fileSha(caseFile) || freeze.case?.oracle?.path !== data.oracle.path || freeze.case?.oracle?.sha256?.toLowerCase() !== data.oracle.sha256.toLowerCase() || freeze.case?.input_bundle?.contract !== data.input_bundle.contract || !validHash(freeze.case?.input_bundle?.sha256)) fail('freeze_binding_mismatch', 'freeze case, oracle, or input binding drifted');
  if (!validHash(freeze.bundle?.sha256) || !validHash(freeze.bundle?.manifest_sha256) || !validHash(freeze.controls?.sha256) || !validHash(freeze.candidate?.sha256) || !validHash(freeze.candidate?.member_sha256)) fail('freeze_binding_mismatch', 'freeze lacks immutable bundle, controls, or candidate hashes');
  const expectedInputs = Object.fromEntries((data.input_bundle.members || []).map((item) => [item.path, item.sha256.toLowerCase()]));
  if (freeze.case.input_bundle.members && stable(freeze.case.input_bundle.members) !== stable(expectedInputs)) fail('freeze_binding_mismatch', 'freeze input-member hashes differ from the pinned case');
  if (!Array.isArray(freeze.candidate?.members) || freeze.candidate.members.some((item) => !item.path || !validHash(item.sha256)) || stableHash(freeze.candidate.members) !== freeze.candidate.member_sha256) fail('freeze_binding_mismatch', 'freeze candidate member ledger is invalid');
  if (freeze.source?.repository !== data.source.repository || freeze.source?.revision !== data.source.revision || freeze.source?.main !== freeze.source?.origin_main || !freeze.source?.files || Object.values(freeze.source.files).some((item) => !item || !Number.isInteger(item.bytes) || !validHash(item.sha256)) || !freeze.runtime?.executable?.source_sha256 || !freeze.runtime?.executable?.target_sha256 || !validHash(freeze.runtime.executable.source_sha256) || !validHash(freeze.runtime.executable.target_sha256)) fail('freeze_binding_mismatch', 'freeze source or executable binding is incomplete');
  if (freeze.runtime?.provider !== 'codex' || freeze.runtime?.model !== 'gpt-5.6-luna' || freeze.runtime?.effort !== 'high' || freeze.runtime?.cli_contract?.version !== 'codex-cli 0.149.1' || !validHash(freeze.runtime?.cli_contract?.resume_help_sha256) || !validHash(freeze.runtime?.python?.sha256) || freeze.runtime?.python?.path !== '<PYTHON>' || freeze.runtime?.python?.identity !== '<PYTHON>' || freeze.runtime?.auth_posture !== 'authenticated-native-CODEX_HOME; ignore-user-config; credentials-not-copied' || freeze.auth?.copied_to_consumer_root !== false) fail('freeze_binding_mismatch', 'freeze runtime or Python binding is incomplete');
  if (freeze.candidate?.package?.name !== 'workspine' || !freeze.candidate.package.version || freeze.toolchain?.node?.sha256 == null || freeze.toolchain?.npm?.sha256 == null || freeze.toolchain?.git?.sha256 == null || !validHash(freeze.toolchain.node.sha256) || !validHash(freeze.toolchain.npm.sha256) || !validHash(freeze.toolchain.git.sha256)) fail('freeze_binding_mismatch', 'freeze toolchain binding is incomplete');
  const turns = freeze.budgets?.turns?.map((item) => [item.id, item.role, item.skill, item.skills, item.wall_minutes, item.native_tokens, item.session, item.initial]);
  if (stable(turns) !== stable(TURN_CONTRACT) || freeze.budgets?.total_wall_minutes !== TURN_TOTAL_WALL_MINUTES || freeze.budgets?.total_native_tokens !== TURN_TOTAL_NATIVE_TOKENS || freeze.budgets?.retained_output_bytes !== 1048576 || freeze.sessions?.count !== 3 || freeze.sessions?.turns !== 5 || freeze.root_map?.run_root !== '<RUN_ROOT>' || freeze.root_map?.consumer_root !== '<RUN_ROOT>/consumer_root' || freeze.root_map?.tool_root !== '<RUN_ROOT>/tool_root' || freeze.root_map?.receipts !== '<RECEIPTS>') fail('freeze_binding_mismatch', 'freeze budgets, root map, or turn contract drifted');
  if (controlsFile && (!exists(controlsFile) || fileSha(controlsFile) !== freeze.controls.sha256)) fail('freeze_binding_mismatch', 'freeze controls hash does not match the sealed controls receipt');
}

function runGit(root, argv) {
  const result = cp.spawnSync('git', argv, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  if (result.status !== 0) fail('git_observation_failed', `git ${argv.join(' ')} failed`, { stderr: String(result.stderr || '').slice(-2000) });
  return String(result.stdout || '').trim();
}

function gitScope(root) {
  const top = fs.realpathSync(runGit(root, ['rev-parse', '--show-toplevel']));
  const head = runGit(root, ['rev-parse', 'HEAD']);
  const status = runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const staged = runGit(root, ['diff', '--cached', '--name-status']);
  const unstaged = runGit(root, ['diff', '--name-status']);
  const parse = (value) => value.split(/\r?\n/).filter(Boolean).map((line) => { const relative = line.slice(3); const file = path.join(root, relative); const stat = exists(file) ? fs.lstatSync(file) : null; return { status: line.slice(0, 2).trim(), path: relative, bytes: stat?.isFile() ? stat.size : null, sha256: stat?.isFile() ? fileSha(file) : null }; });
  return { top, head, status, staged: parse(staged), unstaged: parse(unstaged), all: parse(status), status_sha256: sha256(Buffer.from(status)) };
}

function capabilityStatusPaths(status) {
  return String(status || '').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const match = line.match(/^(?:\?\?|[ MADRCU?!]{1,2})\s+(.*)$/);
    if (!match) fail('capability_invalid', 'capability Git status contains an unparseable path');
    return match[1].split(/\s+->\s+/).map((item) => item.replace(/^"(.*)"$/, '$1'));
  });
}

function gitBlobSha(root, revision, member) {
  const result = cp.spawnSync('git', ['show', `${revision}:${member}`], { cwd: root, encoding: null, shell: false, windowsHide: true, timeout: 30000 });
  if (result.status !== 0) fail('git_observation_failed', `cannot read Git member: ${member}`);
  return sha256(Buffer.from(result.stdout || ''));
}

function snapshotFiles(root, relative = '') {
  const full = path.join(root, relative);
  if (!exists(full)) return [];
  const stat = fs.lstatSync(full);
  const name = slash(relative || '.');
  const result = [{ path: name, type: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', bytes: stat.isFile() ? stat.size : null, sha256: stat.isFile() ? fileSha(full) : null }];
  if (stat.isDirectory()) for (const entry of fs.readdirSync(full).sort()) result.push(...snapshotFiles(root, path.join(relative, entry)));
  return result;
}

function parseFrontmatter(content, label) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('brownfield_grammar_invalid', `${label} lacks canonical frontmatter`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) fields[item[1]] = item[2].replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireSections(content, label, sections) {
  for (const section of sections) {
    const heading = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'im').exec(content);
    if (!heading) fail('brownfield_grammar_invalid', `${label} lacks its ${section} section`);
    const tail = content.slice(heading.index + heading[0].length);
    const nextHeading = /^##\s+/im.exec(tail);
    const body = tail.slice(0, nextHeading ? nextHeading.index : tail.length);
    if (body.replace(/[-*\s\[\]]/g, '').length < 12) fail('brownfield_grammar_invalid', `${label} has no substantive ${section} section`);
  }
  if (/\[Short Title\]|\[path\]|\[notes\]|\[What this slice does\]|\[Disjoint write set\]|State the single cohesive outcome|Boundaries that the next session must keep|Open questions that still affect/i.test(content)) fail('brownfield_grammar_invalid', `${label} still contains template placeholders`);
}

function brownfield(root, data = null) {
  const directory = path.join(root, '.work', 'brownfield-change');
  const files = {};
  for (const name of ['CHANGE.md', 'HANDOFF.md', 'VERIFICATION.md']) {
    const file = path.join(directory, name);
    if (!exists(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('brownfield_missing', `canonical ${name} is missing`);
    files[name] = { bytes: fs.statSync(file).size, sha256: fileSha(file) };
  }
  const change = text(path.join(directory, 'CHANGE.md'));
  const handoff = text(path.join(directory, 'HANDOFF.md'));
  const verification = text(path.join(directory, 'VERIFICATION.md'));
  const changeFm = parseFrontmatter(change, 'CHANGE.md');
  const handoffFm = parseFrontmatter(handoff, 'HANDOFF.md');
  const verificationFm = parseFrontmatter(verification, 'VERIFICATION.md');
  if (!/^CHANGE-\d+$/.test(changeFm.change || '') || !['active', 'ready_for_verification', 'closed'].includes(changeFm.status) || changeFm.type !== 'medium_scope_brownfield') fail('brownfield_grammar_invalid', 'CHANGE.md has invalid operational frontmatter');
  if (handoffFm.status || handoffFm.type || /^##\s+Current Status/m.test(handoff) || /^##\s+Done When/m.test(handoff)) fail('brownfield_authority_split', 'HANDOFF.md introduces competing operational authority');
  if (handoffFm.change !== changeFm.change || verificationFm.change !== changeFm.change || !validDate(handoffFm.updated) || !validDate(verificationFm.verified)) fail('brownfield_grammar_invalid', 'brownfield artifact IDs or calendar dates do not cross-bind');
  if (!['pending', 'passed', 'gaps_found', 'human_needed'].includes(verificationFm.status)) fail('brownfield_grammar_invalid', 'VERIFICATION.md has invalid status');
  requireSections(change, 'CHANGE.md', ['Goal', 'Why This Exists', 'In Scope', 'Out of Scope', 'Structural Promotion Triggers', 'Done When', 'Current Status', 'Next Action', 'PR Slice Ownership']);
  requireSections(handoff, 'HANDOFF.md', ['Active Constraints', 'Unresolved Uncertainty', 'Decision Posture', 'Anti-Regression', 'Next Action']);
  requireSections(verification, 'VERIFICATION.md', ['Goal Verification', 'Evidence', 'Artifact Checks', 'Gaps', 'Widening Reuse', 'Human Verification', 'Closeout Decision']);
  if (!/CHANGE\.md.{0,120}(?:only )?operational authority/i.test(handoff) && !/CHANGE\.md.{0,120}operational continuity/i.test(handoff)) fail('brownfield_authority_split', 'brownfield authority split is not explicit');
  if (data) {
    const goalTerms = String(data.task?.goal || '').toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 5).slice(0, 3);
    const combined = `${change}\n${handoff}\n${verification}`.toLowerCase();
    if (goalTerms.some((term) => !combined.includes(term)) || !(data.task?.allowed_paths || []).every((item) => change.includes(item))) fail('brownfield_binding_mismatch', 'brownfield artifacts do not bind the pinned task goal and scope');
  }
  return { files, status: changeFm.status, verification_status: verificationFm.status };
}

function checkpoint(root) {
  const file = path.join(root, '.work', '.continue-here.md');
  if (!exists(file) || fs.statSync(file).size < 64) fail('checkpoint_missing', 'complete handoff lacks a substantive checkpoint');
  const value = text(file);
  if (!/current\s+task/i.test(value) || !/evidence/i.test(value) || !/next\s+action/i.test(value)) fail('checkpoint_invalid', 'checkpoint lacks current task, evidence, or next action');
  return { bytes: Buffer.byteLength(value), sha256: fileSha(file) };
}

function inputBundle(root, data) {
  const expected = new Map((data.input_bundle?.members || []).map((item) => [item.path, item.sha256.toLowerCase()]));
  if (!expected.size) fail('input_bundle_invalid', 'pinned owner input bundle is missing');
  const observed = [];
  for (const [relative, expectedHash] of expected) {
    const file = path.join(root, 'inputs', ...relative.split('/'));
    if (!exists(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || fileSha(file) !== expectedHash) fail('input_bundle_invalid', `owner input bytes differ from the pinned bundle: ${relative}`);
    observed.push({ path: `inputs/${relative}`, sha256: fileSha(file), bytes: fs.statSync(file).size });
  }
  const ownerRoot = path.join(root, 'inputs');
  for (const item of snapshotFiles(ownerRoot).filter((entry) => entry.type === 'file')) if (!expected.has(item.path.replace(/\\/g, '/'))) fail('input_bundle_invalid', `unexpected owner input member: ${item.path}`);
  return observed;
}

function completeHandoff({ caseFile, freezeFile, receiptDir, consumerRoot, controlsFile = null, terminalValue = null, handoffValue = null }) {
  const data = readCase(caseFile);
  const freeze = readJson(freezeFile, 'freeze_invalid');
  if (freeze.case_id !== CASE_ID || freeze.workflow_verdict !== 'not_evaluated' || freeze.provider_sandbox !== 'not_claimed') fail('freeze_invalid', 'freeze is not a non-authoritative rooted Codex freeze');
  validateFreeze(data, freeze, caseFile, controlsFile);
  const terminalFile = path.join(receiptDir, 'terminal.json');
  const handoffFile = path.join(receiptDir, 'handoff.json');
  const preparationFile = path.join(receiptDir, 'preparation.json');
  if (!exists(preparationFile) || (!terminalValue && !exists(terminalFile)) || (!handoffValue && !exists(handoffFile))) fail('handoff_missing', 'complete handoff receipts are missing');
  const preparation = readJson(preparationFile); const terminal = terminalValue || readJson(terminalFile); const handoff = handoffValue || readJson(handoffFile);
  if (preparation.record_type !== 'phase16_preparation_receipt' || preparation.case_id !== CASE_ID || preparation.workflow_verdict !== 'not_evaluated' || preparation.characterization_only === true || preparation.bundle_sha256 !== freeze.bundle.sha256 || preparation.controls_sha256 !== freeze.controls.sha256 || preparation.candidate_sha256 !== freeze.candidate.sha256 || preparation.python?.sha256 !== freeze.runtime.python.sha256) fail('preparation_invalid', 'preparation receipt is not bound to the frozen candidate, controls, and Python witness');
  if (terminal.record_type !== 'phase16_terminal_receipt' || terminal.terminal?.status !== 'provider_complete' || terminal.turn_count !== 5 || terminal.workflow_verdict !== 'not_evaluated' || terminal.provider_invoked !== true) fail('handoff_incomplete', 'terminal receipt does not prove complete provider handoff');
  if (handoff.record_type !== 'phase16_codex_handoff' || handoff.case_id !== CASE_ID || handoff.workflow_verdict !== 'not_evaluated' || handoff.characterization_only === true) fail('handoff_invalid', 'handoff is missing its non-characterization contract');
  const terminalSha = terminalValue ? sha256(Buffer.from(`${JSON.stringify(terminalValue, null, 2)}\n`)) : fileSha(terminalFile);
  const handoffSha = handoffValue ? sha256(Buffer.from(`${JSON.stringify(handoffValue, null, 2)}\n`)) : fileSha(handoffFile);
  if (handoff.terminal_sha256 !== terminalSha || handoff.retained_root !== '<CONSUMER_ROOT>') fail('handoff_binding_mismatch', 'handoff is not bound to terminal and retained-root witness');
  if (stable(handoff.sessions) !== stable({ A: handoff.sessions?.A, B: handoff.sessions?.B, C: handoff.sessions?.C }) || !handoff.sessions?.A || !handoff.sessions?.B || !handoff.sessions?.C || new Set([handoff.sessions.A, handoff.sessions.B, handoff.sessions.C]).size !== 3) fail('handoff_identity_invalid', 'handoff lacks three distinct native sessions');
  if (!Array.isArray(handoff.turns) || handoff.turns.length !== 5 || stable(handoff.turns.map((item) => item.id)) !== stable(WORKFLOW_STEPS)) fail('handoff_turns_invalid', 'handoff does not contain the exact five ordered turns');
  const turns = handoff.turns.map((item, index) => {
    const file = path.join(receiptDir, `${WORKFLOW_STEPS[index]}.json`);
    if (!exists(file) || item.sha256 !== fileSha(file)) fail('turn_receipt_invalid', `turn receipt is missing or not hash-bound: ${WORKFLOW_STEPS[index]}`);
    const receipt = readJson(file);
    if (receipt.characterization_only === true || receipt.workflow_verdict !== 'not_evaluated' || receipt.terminal?.status !== 'provider_complete' || !receipt.native?.thread_id || !receipt.native?.turn_id) fail('turn_receipt_invalid', `turn receipt is not a complete native receipt: ${WORKFLOW_STEPS[index]}`);
    const expectedTurn = TURN_CONTRACT[index];
    if (receipt.turn?.id !== expectedTurn[0] || receipt.turn?.role !== expectedTurn[1] || receipt.turn?.skill !== expectedTurn[2] || stable(receipt.turn?.skills) !== stable(expectedTurn[3]) || receipt.turn?.session !== expectedTurn[6] || receipt.turn?.initial !== expectedTurn[7] || !receipt.invocation?.argv?.includes('-m') || !receipt.invocation.argv.includes('gpt-5.6-luna')) fail('turn_receipt_invalid', `turn receipt is not bound to the fixed turn contract: ${WORKFLOW_STEPS[index]}`);
    validateNativeArgv(receipt, expectedTurn, handoff.sessions);
    if (expectedTurn[0] === 'turn-a-pause' && receipt.turn?.checkpoint?.path !== '<CONSUMER_ROOT>/.work/.continue-here.md') fail('checkpoint_invalid', 'pause receipt does not carry the canonical checkpoint path');
    return { id: WORKFLOW_STEPS[index], thread_id: receipt.native.thread_id, turn_id: receipt.native.turn_id, sha256: item.sha256 };
  });
  if (turns[0].thread_id !== handoff.sessions.A || turns[1].thread_id !== handoff.sessions.A || turns[2].thread_id !== handoff.sessions.B || turns[3].thread_id !== handoff.sessions.C || turns[4].thread_id !== handoff.sessions.C) fail('handoff_identity_invalid', 'turn receipts do not link to the declared sessions');
  const origin = runGit(consumerRoot, ['remote', 'get-url', 'origin']);
  if (origin !== data.source.repository) fail('upstream_origin_mismatch', 'retained Git root origin is not the pinned public upstream', { expected: data.source.repository, actual: origin });
  const scope = gitScope(consumerRoot);
  if (scope.top !== fs.realpathSync(consumerRoot) || scope.head !== data.source.revision) fail('consumer_root_invalid', 'retained root is not the pinned public Git checkout');
  const candidatePath = data.source.candidate_path;
  const baseline = data.controls?.variants?.find((item) => item.id === 'baseline')?.candidate_sha256;
  if (!baseline || gitBlobSha(consumerRoot, data.source.revision, candidatePath) !== baseline.toLowerCase()) fail('baseline_binding_mismatch', 'retained Git baseline candidate does not match the public case pin');
  for (const required of data.source.source_root?.required_paths || []) if (!exists(path.join(consumerRoot, required.replace(/^project\//, '')))) fail('required_path_missing', `retained Git root lacks required path: ${required}`);
  return { data, freeze, preparation, terminal, handoff, turns, scope, baseline_candidate_sha256: baseline.toLowerCase(), terminal_sha256: terminalSha, handoff_sha256: handoffSha };
}

function allowedPaths(data, scope) {
  const allowed = [...data.task.allowed_paths, 'inputs/owner/TASK.md', 'inputs/owner/BRIEF.md', '.work/.continue-here.md', '.work/brownfield-change/CHANGE.md', '.work/brownfield-change/HANDOFF.md', '.work/brownfield-change/VERIFICATION.md'];
  const allowedPrefix = ['.agents/skills/'];
  const all = scope.all.map((item) => item.path);
  const forbidden = all.filter((item) => !allowed.includes(item) && !allowedPrefix.some((prefix) => item.startsWith(prefix)));
  const product = all.filter((item) => item === data.task.allowed_paths[0]);
  return { allowed, all, forbidden, product };
}

function runOracle({ data, caseFile, consumerRoot, python = data.runtime?.command || 'python', pythonWitness = null, oraclePath, spawn = cp.spawnSync }) {
  const oracle = oraclePath || path.resolve(__dirname, 'cases', 'itsdangerous-fips-sha1-oracle.py');
  if (!exists(oracle) || fileSha(oracle) !== data.oracle.sha256.toLowerCase()) fail('oracle_binding_mismatch', 'pinned oracle bytes are missing or changed');
  if (pythonWitness && (!pythonWitness.path || pythonWitness.sha256 !== fileSha(pythonWitness.path) || pythonWitness.identity !== pythonWitness.path)) fail('python_binding_mismatch', 'observer Python identity does not match the verified prepareRun witness');
  const pythonPath = pythonWitness?.path || python;
  const env = { PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  for (const name of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  const result = spawn(pythonPath, [oracle, '--source', consumerRoot], { cwd: consumerRoot, encoding: 'utf8', shell: false, windowsHide: true, timeout: 240000, env });
  const stdout = String(result.stdout || ''); const stderr = String(result.stderr || '');
  let semantic;
  try { semantic = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || ''); } catch (error) { fail('oracle_parse_failed', 'pinned oracle did not return semantic JSON', { message: error.message }); }
  if (!semantic || !['pass', 'fail'].includes(semantic.status) || !semantic.checks || typeof semantic.checks !== 'object') fail('oracle_semantics_invalid', 'pinned oracle semantic result is incomplete');
  if ((semantic.status === 'pass' && result.status !== 0) || (semantic.status === 'fail' && result.status === 0)) fail('oracle_semantics_invalid', 'pinned oracle exit status disagrees with its semantic result');
  const sourceTree = runGit(consumerRoot, ['ls-tree', '-r', '--full-tree', 'HEAD']);
  return { schema_version: 1, record_type: 'phase16_itsdangerous_oracle_receipt', contract: ORACLE_CONTRACT, case_id: CASE_ID, case_sha256: fileSha(caseFile), oracle_sha256: fileSha(oracle), source_revision: data.source.revision, source_root_sha256: sha256(Buffer.from(sourceTree)), process: { exit_code: Number.isInteger(result.status) ? result.status : null, stderr_sha256: sha256(Buffer.from(stderr)) }, stdout_sha256: sha256(Buffer.from(stdout)), semantic };
}

function observe({ caseFile, freezeFile, receiptDir, consumerRoot, controlsFile = null, python, pythonWitness, oraclePath, spawn = cp.spawnSync, terminalValue = null, handoffValue = null }) {
  const handoff = completeHandoff({ caseFile, freezeFile, receiptDir, consumerRoot, controlsFile, terminalValue, handoffValue });
  if (!pythonWitness || pythonWitness.sha256 !== handoff.freeze.runtime.python.sha256 || !pythonWitness.path || fs.realpathSync(pythonWitness.path) !== fs.realpathSync(pythonWitness.identity || pythonWitness.path)) fail('python_binding_mismatch', 'observer did not receive the verified prepareRun Python identity');
  const scope = allowedPaths(handoff.data, handoff.scope);
  if (scope.forbidden.length) fail('git_scope_invalid', 'retained root contains out-of-scope Git changes', { forbidden: scope.forbidden });
  if (scope.product.length !== 1) fail('candidate_missing', 'retained root does not expose exactly one allowed product change');
  const artifact = brownfield(consumerRoot, handoff.data); const check = checkpoint(consumerRoot); const inputs = inputBundle(consumerRoot, handoff.data);
  const oracle = runOracle({ data: handoff.data, caseFile, consumerRoot, python, pythonWitness, oraclePath, spawn });
  const oracleFile = path.join(receiptDir, 'oracle.json');
  writeExclusive(oracleFile, oracle);
  const candidatePath = path.join(consumerRoot, handoff.data.task.allowed_paths[0]);
  if (!exists(candidatePath) || !fs.lstatSync(candidatePath).isFile() || fs.lstatSync(candidatePath).isSymbolicLink()) fail('candidate_missing', 'retained root candidate is missing or unsafe');
  const observation = {
    schema_version: 1, record_type: 'phase16_itsdangerous_observation', contract: OBSERVATION_CONTRACT, case_id: CASE_ID,
    case: { sha256: fileSha(caseFile), revision: handoff.data.source.revision, oracle_sha256: oracle.oracle_sha256 },
    freeze_sha256: fileSha(freezeFile), terminal_sha256: handoff.terminal_sha256, handoff_sha256: handoff.handoff_sha256,
    retained_root: fs.realpathSync(consumerRoot), git: { top_level: handoff.scope.top, head: handoff.scope.head, status: handoff.scope.status, status_sha256: handoff.scope.status_sha256, staged: handoff.scope.staged, unstaged: handoff.scope.unstaged, scope, candidate_sha256: exists(candidatePath) ? fileSha(candidatePath) : null },
    turns: handoff.turns, sessions: { count: 3, turns: 5 }, checkpoint: check, inputs, brownfield: artifact,
    oracle: { path: oracleFile, sha256: fileSha(oracleFile), semantic: oracle.semantic },
    claim_limit: 'Actual retained-root Git scope, canonical brownfield artifacts, and the pinned itsdangerous oracle only; no broader benchmark, model, or release claim.',
  };
  const observationFile = path.join(receiptDir, 'observation.json');
  writeExclusive(observationFile, observation);
  return { observationFile, oracleFile, observation };
}

function gradeValue(observation) {
  if (observation.record_type !== 'phase16_itsdangerous_observation' || observation.contract !== OBSERVATION_CONTRACT || observation.case_id !== CASE_ID) fail('observation_invalid', 'observation contract is invalid');
  if (observation.case?.revision !== CASE_REVISION || observation.case?.sha256 !== CASE_SHA256 || !validHash(observation.freeze_sha256) || !validHash(observation.terminal_sha256) || !validHash(observation.handoff_sha256) || typeof observation.retained_root !== 'string' || observation.git?.top_level !== observation.retained_root || !observation.git.scope || !observation.brownfield?.files || !observation.checkpoint?.sha256 || stable(observation.turns?.map((item) => item.id)) !== stable(WORKFLOW_STEPS) || observation.turns?.some((item) => !validHash(item.sha256) || !item.thread_id || !item.turn_id) || stable(observation.sessions) !== stable({ count: 3, turns: 5 }) || !observation.oracle?.semantic?.checks || !validHash(observation.oracle?.sha256) || observation.case.oracle_sha256 !== ORACLE_SHA256 || !['pass', 'fail'].includes(observation.oracle.semantic.status)) fail('observation_invalid', 'observation is missing immutable grading inputs');
  const checks = { git_root: observation.git?.top_level === observation.retained_root, pinned_head: observation.git?.head === observation.case?.revision, git_scope: observation.git?.scope?.forbidden?.length === 0, brownfield: Boolean(observation.brownfield?.files?.['CHANGE.md'] && observation.brownfield?.files?.['HANDOFF.md'] && observation.brownfield?.files?.['VERIFICATION.md']), checkpoint: Boolean(observation.checkpoint?.sha256), oracle_import: observation.oracle?.semantic?.checks?.import_with_sha1_unavailable === true, oracle_explicit_sha256: observation.oracle?.semantic?.checks?.explicit_sha256_signer === true, oracle_default_rejected: observation.oracle?.semantic?.checks?.default_sha1_rejected === true, oracle_tests: observation.oracle?.semantic?.checks?.upstream_tests_pass === true };
  const productChecks = ['oracle_import', 'oracle_explicit_sha256', 'oracle_default_rejected', 'oracle_tests'];
  const disposition = observation.identity?.status === 'unknown' ? 'identity_unknown' : observation.human_needed === true ? 'human_needed' : checks.git_root && checks.pinned_head && checks.git_scope && checks.brownfield && checks.checkpoint ? (productChecks.every((key) => checks[key]) ? 'passed' : 'product_red') : 'infrastructure_invalid';
  return { checks, disposition };
}

function grade({ observationFile, gradeFile }) {
  const observation = readJson(observationFile, 'observation_invalid');
  if (observation.provider_invoked === false || observation.characterization_only === true || Object.hasOwn(observation, 'provider_grade') || Object.hasOwn(observation, 'workflow_verdict') && observation.workflow_verdict !== 'not_evaluated') fail('observation_invalid', 'provider-authored or characterization observation cannot be graded');
  const value = gradeValue(observation);
  const result = { schema_version: 1, record_type: 'phase16_itsdangerous_grade', contract: GRADE_CONTRACT, case_id: CASE_ID, observation_sha256: fileSha(observationFile), oracle_sha256: observation.oracle.sha256, checks: value.checks, disposition: value.disposition, claim_limit: 'Deterministic grade of immutable observer/oracle bytes only; no provider-authored verdict is accepted.' };
  if (gradeFile) writeExclusive(gradeFile, result);
  return result;
}

function regrade({ observationFile, regradeFile }) {
  const value = grade({ observationFile });
  const result = { schema_version: 1, record_type: 'phase16_itsdangerous_regrade', contract: REGRADE_CONTRACT, case_id: CASE_ID, observation_sha256: value.observation_sha256, oracle_sha256: value.oracle_sha256, checks: value.checks, disposition: value.disposition, provider_invoked: false, retained_root_required: false };
  if (regradeFile) writeExclusive(regradeFile, result);
  return result;
}

function regradeChild({ observationFile, regradeFile }) {
  const env = { PATH: '' };
  for (const name of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  const result = cp.spawnSync(process.execPath, [__filename, '--regrade', '--observation', observationFile, '--output', regradeFile], { cwd: path.parse(process.execPath).dir, env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || !exists(regradeFile)) fail('regrade_failed', 'isolated provider-free regrade child failed', { status: result.status, stderr: String(result.stderr || '').slice(-1000) });
  return readJson(regradeFile, 'regrade_invalid');
}

const PUBLIC_KEYS = new Set(['schema_version', 'record_type', 'contract', 'case_id', 'upstream_revision', 'candidate_sha256', 'runtime', 'workflow', 'oracle', 'terminal_fact', 'disposition', 'stages', 'claim_limit']);
function assertPublicSafe(value, key = null) {
  if (key && !PUBLIC_KEYS.has(key) && key !== 'provider' && key !== 'model' && key !== 'effort' && key !== 'sessions' && key !== 'turns' && key !== 'steps' && key !== 'id' && key !== 'disposition' && key !== 'status' && key !== 'checks' && key !== 'import_with_sha1_unavailable' && key !== 'explicit_sha256_signer' && key !== 'default_sha1_rejected' && key !== 'upstream_tests_pass' && key !== 'observation' && key !== 'oracle' && key !== 'grade' && key !== 'regrade') fail('projection_private_field', `public projection contains an unallowlisted field: ${key}`);
  if (typeof value === 'string' && (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value) || /(?:HOME|USERPROFILE|CODEX_HOME|password|credential|prompt|transcript|pid|session_id|nonce)/i.test(value))) fail('projection_leak', 'public projection contains a private locator or diagnostic value');
  if (Array.isArray(value)) value.forEach((item) => assertPublicSafe(item));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([child, item]) => assertPublicSafe(item, child));
  return value;
}

function project({ observation, grade: gradeReceipt, regrade: regradeReceipt, outputFile, freeze, observationFile, regradeFile, compareFile }) {
  if (!gradeReceipt || gradeReceipt.contract !== GRADE_CONTRACT || !DISPOSITIONS.includes(gradeReceipt.disposition) || Object.hasOwn(gradeReceipt, 'provider_invoked') || Object.hasOwn(gradeReceipt, 'workflow_verdict')) fail('grade_invalid', 'public projection requires the sealed independent grade contract');
  if (observation.case?.revision !== CASE_REVISION || observation.case?.sha256 !== CASE_SHA256 || !validHash(gradeReceipt.observation_sha256)) fail('grade_invalid', 'public projection is not pinned to the public case or observed bytes');
  if (freeze && (freeze.case?.sha256 !== observation.case.sha256 || freeze.source?.revision !== observation.case.revision || freeze.runtime?.provider !== 'codex' || freeze.runtime?.model !== 'gpt-5.6-luna' || freeze.runtime?.effort !== 'high')) fail('freeze_binding_mismatch', 'public projection is not bound to the exact case and runtime freeze');
  if (observationFile && gradeReceipt.observation_sha256 !== fileSha(observationFile)) fail('grade_invalid', 'grade is not bound to the observed bytes');
  const expected = gradeValue(observation);
  if (stable(gradeReceipt.checks) !== stable(expected.checks) || gradeReceipt.disposition !== expected.disposition || gradeReceipt.oracle_sha256 !== observation.oracle.sha256) fail('grade_invalid', 'grade semantics do not match the immutable observation');
  if (!regradeReceipt || regradeReceipt.contract !== REGRADE_CONTRACT || regradeReceipt.observation_sha256 !== gradeReceipt.observation_sha256 || regradeReceipt.disposition !== gradeReceipt.disposition || stable(regradeReceipt.checks) !== stable(gradeReceipt.checks) || regradeReceipt.provider_invoked !== false || regradeReceipt.retained_root_required !== false) fail('regrade_invalid', 'projection regrade is not bound to the sealed grade');
  if (!regradeFile || !exists(regradeFile) || stable(readJson(regradeFile, 'regrade_invalid')) !== stable(regradeReceipt)) fail('regrade_invalid', 'regrade receipt bytes are not bound to the sealed regrade');
  const compared = compareFile && exists(compareFile) ? readJson(compareFile, 'regrade_invalid') : null;
  if (!compared || compared.contract !== REGRADE_CONTRACT || compared.normalized_equal !== true || compared.canonical_regrade_sha256 !== fileSha(regradeFile) || stable(compared.regrade) !== stable(regradeReceipt)) fail('regrade_invalid', 'public projection requires the sealed deterministic regrade comparison');
  const freezeValue = freeze || null;
  const result = { schema_version: 1, record_type: 'phase16_public_result', contract: PROJECTION_CONTRACT, case_id: CASE_ID, upstream_revision: observation.case.revision, candidate_sha256: observation.git.candidate_sha256 || null, runtime: { provider: 'codex', model: freezeValue?.runtime?.model || 'gpt-5.6-luna', effort: freezeValue?.runtime?.effort || 'high' }, workflow: { sessions: 3, turns: 5, steps: WORKFLOW_STEPS.map((id) => ({ id, disposition: 'observed' })) }, oracle: { status: observation.oracle.semantic.status, checks: observation.oracle.semantic.checks }, disposition: gradeReceipt.disposition, stages: { observation: 'sealed', oracle: 'sealed', grade: 'sealed', regrade: 'sealed' }, claim_limit: 'One pinned itsdangerous retained-root Codex vertical only; this projection is not a general benchmark, model-identity, security, or release claim.' };
  assertPublicSafe(result);
  if (outputFile) writeExclusive(outputFile, result);
  return result;
}

function earlyProjection({ caseId = CASE_ID, revision = '93ae366874bbd4f69d90495c45b2cd336387496c', terminal = {} } = {}) {
  if (caseId !== CASE_ID || revision !== '93ae366874bbd4f69d90495c45b2cd336387496c') fail('case_pin_mismatch', 'early projection is hard-pinned to the public case and revision');
  const status = terminal.status === 'failed' ? 'infrastructure_invalid' : 'human_needed';
  const result = { schema_version: 1, record_type: 'phase16_public_result', contract: PROJECTION_CONTRACT, case_id: caseId, upstream_revision: revision, candidate_sha256: null, runtime: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high' }, workflow: { sessions: null, turns: null, steps: [] }, oracle: { status: 'not_produced_due_to_early_terminal', checks: 'not_produced_due_to_early_terminal' }, disposition: status, stages: { observation: 'not_produced_due_to_early_terminal', oracle: 'not_produced_due_to_early_terminal', grade: 'not_produced_due_to_early_terminal', regrade: 'not_produced_due_to_early_terminal' }, claim_limit: 'Early terminal only; no workflow, product, oracle, benchmark, model, or release claim.' };
  return assertPublicSafe(result);
}

function writeEarlyProjection(file, details) { writeExclusive(file, earlyProjection(details)); }

function observerFailureProjection({ receiptDir = null } = {}) {
  const stage = (name, missing) => receiptDir && exists(path.join(receiptDir, `${name}.json`)) ? 'sealed' : missing;
  return assertPublicSafe({ schema_version: 1, record_type: 'phase16_public_result', contract: PROJECTION_CONTRACT, case_id: CASE_ID, upstream_revision: '93ae366874bbd4f69d90495c45b2cd336387496c', candidate_sha256: null, runtime: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high' }, workflow: { sessions: 3, turns: 5, steps: [] }, oracle: { status: stage('oracle', 'not_produced_due_to_observer_failure'), checks: stage('oracle', 'not_produced_due_to_observer_failure') }, disposition: 'infrastructure_invalid', stages: { observation: stage('observation', 'failed'), oracle: stage('oracle', 'not_produced_due_to_observer_failure'), grade: stage('grade', 'not_produced_due_to_observer_failure'), regrade: stage('regrade', 'not_produced_due_to_observer_failure') }, claim_limit: 'Observer failure only; no workflow, product, oracle, benchmark, model, or release claim.' });
}

function observeAndGrade(options) {
  const observed = observe(options);
  const gradeFile = path.join(options.receiptDir, 'grade.json');
  const gradeReceipt = grade({ observationFile: observed.observationFile, gradeFile });
  const regradeFile = path.join(options.receiptDir, 'regrade.json');
  const regradeReceipt = regradeChild({ observationFile: observed.observationFile, regradeFile });
  const compareFile = path.join(options.receiptDir, 'regrade-compare.json');
  const secondFile = path.join(options.receiptDir, '.regrade-second.json');
  const second = regradeChild({ observationFile: observed.observationFile, regradeFile: secondFile });
  if (stable(second) !== stable(regradeReceipt)) fail('regrade_nondeterministic', 'provider-free regrade changed between runs');
  fs.rmSync(secondFile, { force: true });
  writeExclusive(compareFile, { schema_version: 1, record_type: 'phase16_itsdangerous_regrade_compare', contract: REGRADE_CONTRACT, case_id: CASE_ID, canonical_regrade_sha256: fileSha(regradeFile), normalized_equal: true, regrade: second });
  const projection = project({ observation: observed.observation, grade: gradeReceipt, regrade: regradeReceipt, observationFile: observed.observationFile, regradeFile, compareFile, outputFile: options.publicResult, freeze: options.freezeFile ? readJson(options.freezeFile, 'freeze_invalid') : null });
  return { observation: observed.observationFile, oracle: observed.oracleFile, grade: gradeFile, regrade: regradeFile, regradeCompare: compareFile, projection, disposition: gradeReceipt.disposition };
}

// Observe only the first plan turn after a provider terminal. This deliberately
// has no oracle or complete-handoff path: a product red here means that a
// provider-authored plan turn changed the declared candidate before the run
// could reach execution, not that the candidate behavior was evaluated.
function observePartialPlan({ caseFile, freezeFile, receiptDir, consumerRoot, capabilityFile = path.join(receiptDir, 'capability.json'), preparationFile = path.join(receiptDir, 'preparation.json'), turnFile = path.join(receiptDir, 'turn-a-plan.json'), terminalFile = path.join(receiptDir, 'terminal.json'), observationFile = path.join(receiptDir, 'partial-observation.json'), gradeFile = path.join(receiptDir, 'partial-grade.json'), workPlanFile = path.join(consumerRoot, '.agents', 'skills', 'work-plan', 'SKILL.md') }) {
  const data = readCase(caseFile);
  const freeze = readJson(freezeFile, 'freeze_invalid');
  if (freeze.schema_version !== 1 || freeze.contract !== 'phase16-rooted-codex-freeze-v1' || freeze.case_id !== CASE_ID || freeze.provider_sandbox !== 'not_claimed' || freeze.workflow_verdict !== 'not_evaluated') fail('freeze_binding_mismatch', 'partial observer freeze contract is not exact');
  validateEvaluatorLedger(freeze.evaluator);
  if (freeze.case?.sha256 !== CASE_SHA256 || freeze.source?.repository !== data.source.repository || freeze.source?.revision !== CASE_REVISION || freeze.source?.main !== freeze.source?.origin_main || freeze.runtime?.provider !== 'codex' || freeze.runtime?.model !== 'gpt-5.6-luna' || freeze.runtime?.effort !== 'high' || !validHash(freeze.bundle?.sha256) || !validHash(freeze.controls?.sha256) || !validHash(freeze.candidate?.sha256) || !validHash(freeze.runtime?.python?.sha256) || freeze.skills?.['work-plan'] == null) fail('freeze_binding_mismatch', 'partial observer freeze does not bind the pinned case and runtime');
  if (!exists(consumerRoot) || !fs.statSync(consumerRoot).isDirectory()) fail('consumer_root_invalid', 'partial observer consumer root is missing');
  if (!exists(workPlanFile) || !fs.statSync(workPlanFile).isFile() || fs.lstatSync(workPlanFile).isSymbolicLink() || fileSha(workPlanFile) !== freeze.skills['work-plan']) fail('skill_hash_mismatch', 'installed work-plan skill is not freeze-bound');
  if (!/\*\*Planning stops here:\*\*\s+`work-plan` ends after the plan artifact is written\./i.test(text(workPlanFile))) fail('plan_contract_invalid', 'installed work-plan contract does not stop before implementation');
  if (!exists(preparationFile) || !exists(turnFile) || !exists(terminalFile)) fail('partial_receipt_missing', 'partial observer requires preparation, plan-turn, and terminal receipts');
  if (!exists(capabilityFile)) fail('capability_missing', 'partial observer requires the sealed capability receipt');
  const capability = readJson(capabilityFile, 'capability_invalid');
  const markerPath = '.work/eval-capability.json';
  if (capability.schema_version !== 1 || capability.record_type !== 'phase16_capability_receipt' || capability.contract !== 'phase16-native-capability-v1' || capability.case_id !== CASE_ID || capability.capability !== 'native-codex-workspace-write' || capability.provider_invoked !== true || capability.characterization_only === true || capability.workflow_verdict !== 'not_evaluated' || capability.turn?.provider_invoked !== true || capability.turn?.characterization_only === true || capability.turn?.native?.parse_error !== null || capability.turn?.native?.thread_id == null || capability.turn?.terminal?.status !== 'provider_complete' || capability.terminal?.status !== 'passed' || capability.terminal?.failure_code != null || capability.marker?.exact !== true || capability.marker?.bytes !== 145 || !validHash(capability.marker?.sha256) || capability.snapshots?.pre_sha256 == null || capability.snapshots?.post_sha256 == null || stable(capability.snapshots?.changed_paths) !== stable([markerPath]) || capability.git?.expected_head !== CASE_REVISION || capability.git?.head !== CASE_REVISION || typeof capability.git?.status !== 'string') fail('capability_invalid', 'capability receipt is not an exact passed parser-clean pinned setup witness');
  const setupPaths = capabilityStatusPaths(capability.git.status);
  if (!setupPaths.includes(markerPath) || setupPaths.some((item) => item === data.source.candidate_path)) fail('capability_invalid', 'capability setup baseline does not contain the exact marker or is product-tainted');
  const preparation = readJson(preparationFile); const turn = readJson(turnFile); const terminal = readJson(terminalFile);
  const terminalFailure = String(terminal.terminal?.failure_code || turn.terminal?.failure_code || 'partial_terminal');
  const timeout = Boolean(turn.process?.timed_out) || /(?:^|_)(?:timeout|timed_out)(?:$|_)/i.test(terminalFailure);
  if (preparation.record_type !== 'phase16_preparation_receipt' || preparation.case_id !== CASE_ID || preparation.characterization_only === true || preparation.workflow_verdict !== 'not_evaluated' || preparation.bundle_sha256 !== freeze.bundle.sha256 || preparation.controls_sha256 !== freeze.controls.sha256 || preparation.candidate_sha256 !== freeze.candidate.sha256 || preparation.python?.sha256 !== freeze.runtime.python.sha256) fail('partial_preparation_invalid', 'partial preparation receipt is not bound to the freeze');
  if (turn.record_type !== 'phase16_codex_turn_receipt' || turn.provider_invoked !== true || turn.characterization_only === true || turn.workflow_verdict !== 'not_evaluated' || turn.turn?.id !== 'turn-a-plan' || turn.turn?.role !== 'a-plan' || turn.turn?.skill !== 'work-plan' || stable(turn.turn?.skills) !== stable(['work-plan']) || turn.turn?.session !== 'A' || turn.turn?.initial !== true || (!turn.native?.thread_id && !timeout) || !Array.isArray(turn.invocation?.argv) || !turn.invocation.argv.includes('-m') || !turn.invocation.argv.includes('gpt-5.6-luna') || turn.terminal?.status !== 'failed') fail('partial_turn_invalid', 'partial plan-turn receipt is not a sealed provider terminal');
  if (terminal.record_type !== 'phase16_terminal_receipt' || terminal.case_id !== CASE_ID || terminal.provider_invoked !== true || terminal.workflow_verdict !== 'not_evaluated' || terminal.turn_count !== 1 || terminal.terminal?.status !== 'failed' || terminal.terminal?.sealed_turn?.turn !== 'turn-a-plan') fail('partial_terminal_invalid', 'partial terminal receipt does not seal exactly the first plan turn');
  if (exists(path.join(receiptDir, 'turn-a-pause.json')) || exists(path.join(receiptDir, 'handoff.json')) || exists(path.join(receiptDir, 'turn-b-resume-execute.json')) || exists(path.join(receiptDir, 'turn-c-verify.json')) || exists(path.join(receiptDir, 'turn-c-progress.json'))) fail('partial_predecessor', 'partial observer refuses evidence preceded by pause, resume, verify, progress, or handoff');
  const planArtifacts = allowedPaths(data, { all: [] }).allowed.filter((item) => item.startsWith('.work/brownfield-change/')).sort();
  const brownfieldEvidence = brownfield(consumerRoot, data);
  if (brownfieldEvidence.status !== 'active' || brownfieldEvidence.verification_status !== 'pending') fail('plan_artifact_invalid', 'partial observer requires active planning and pending verification artifacts');
  const scope = gitScope(consumerRoot);
  if (scope.top !== fs.realpathSync(consumerRoot) || scope.head !== CASE_REVISION || runGit(consumerRoot, ['remote', 'get-url', 'origin']) !== data.source.repository) fail('consumer_root_invalid', 'partial observer root is not the pinned upstream checkout');
  const baseline = data.controls?.variants?.find((item) => item.id === 'baseline')?.candidate_sha256;
  if (!baseline || gitBlobSha(consumerRoot, CASE_REVISION, data.source.candidate_path) !== baseline.toLowerCase()) fail('baseline_binding_mismatch', 'partial observer baseline does not match the pinned case');
  // gitScope retains the existing observer contract, but its diagnostic
  // status text is intentionally trimmed. Re-read names through Git's
  // name-only seams here so a leading porcelain status column cannot drop the
  // first character of a changed path.
  const changedNames = [...new Set([
    ...runGit(consumerRoot, ['diff', '--name-only']).split(/\r?\n/),
    ...runGit(consumerRoot, ['diff', '--cached', '--name-only']).split(/\r?\n/),
    ...runGit(consumerRoot, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
  ].map((item) => item.trim()).filter(Boolean))];
  const productPath = 'src/itsdangerous/signer.py';
  const product = changedNames.filter((item) => item === productPath);
  const plan = changedNames.filter((item) => planArtifacts.includes(item));
  const newlyIntroduced = changedNames.filter((item) => !setupPaths.includes(item) && !planArtifacts.includes(item));
  const forbidden = changedNames.filter((item) => !setupPaths.includes(item) && !planArtifacts.includes(item) && item !== productPath);
  if (forbidden.length || newlyIntroduced.length !== 1 || product.length !== 1) fail('git_scope_invalid', 'partial observer found out-of-scope retained-root changes', { forbidden, setup_paths: setupPaths });
  if (fileSha(path.join(consumerRoot, data.source.candidate_path)) === baseline.toLowerCase()) fail('candidate_missing', 'partial observer requires one changed declared product candidate');
  const classified = { allowed: [...setupPaths, ...planArtifacts], all: changedNames, setup: changedNames.filter((item) => setupPaths.includes(item)), plan, newly_introduced: newlyIntroduced, forbidden, product };
  const disposition = 'product_red';
  const checks = { case_pin: true, freeze: true, capability: true, preparation: true, provider_plan_terminal: true, no_predecessor: true, work_plan_contract: true, product_mutation: true, timeout_observed: timeout };
  const observation = { schema_version: 1, record_type: 'phase16_itsdangerous_partial_observation', contract: 'phase16-itsdangerous-partial-observation-v1', case_id: CASE_ID, case: { sha256: fileSha(caseFile), revision: CASE_REVISION }, freeze_sha256: fileSha(freezeFile), capability_sha256: fileSha(capabilityFile), preparation_sha256: fileSha(preparationFile), turn_sha256: fileSha(turnFile), terminal_sha256: fileSha(terminalFile), retained_root: fs.realpathSync(consumerRoot), git: { top_level: scope.top, head: scope.head, status: scope.status, status_sha256: scope.status_sha256, scope: classified, candidate_sha256: fileSha(path.join(consumerRoot, data.source.candidate_path)) }, turn: { id: 'turn-a-plan', ...(turn.native.thread_id ? { thread_id: turn.native.thread_id } : {}) }, terminal: { status: 'failed', timeout, failure_code: terminalFailure }, checks, oracle: { status: 'not_produced_due_to_partial_terminal' }, claim_limit: 'One partial rooted plan observation only; no oracle, complete workflow, model, benchmark, security, or release claim.' };
  writeExclusive(observationFile, observation);
  const grade = { schema_version: 1, record_type: 'phase16_itsdangerous_partial_grade', contract: 'phase16-itsdangerous-partial-grade-v1', case_id: CASE_ID, observation_sha256: fileSha(observationFile), checks, disposition, terminal_fact: timeout ? 'timeout' : 'partial_terminal', provider_invoked: false, retained_root_required: false, claim_limit: 'Deterministic grade of one sealed partial plan observation; no oracle or complete workflow claim.' };
  writeExclusive(gradeFile, grade);
  const projection = assertPublicSafe({ schema_version: 1, record_type: 'phase16_public_result', contract: PROJECTION_CONTRACT, case_id: CASE_ID, upstream_revision: CASE_REVISION, candidate_sha256: observation.git.candidate_sha256, runtime: { provider: 'codex', model: 'not_claimed', effort: 'not_claimed' }, workflow: { sessions: 1, turns: 1, steps: [{ id: 'turn-a-plan', disposition: 'partial' }] }, oracle: { status: 'not_produced_due_to_partial_terminal', checks: 'not_produced_due_to_partial_terminal' }, terminal_fact: timeout ? 'timeout' : 'partial_terminal', disposition, stages: { observation: 'sealed', oracle: 'not_produced_due_to_partial_terminal', grade: 'sealed', regrade: 'not_produced_due_to_partial_terminal' }, claim_limit: 'One partial rooted plan observation only; no oracle, complete workflow, model, benchmark, security, or release claim.' });
  return { observationFile, gradeFile, observation, grade, projection, disposition };
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2); const mode = argv[0]; const value = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : null; };
    if (mode === '--early') { process.stdout.write(`${JSON.stringify(earlyProjection(), null, 2)}\n`); process.exitCode = 0; }
    else if (mode === '--regrade') { const result = regrade({ observationFile: value('--observation'), regradeFile: value('--output') }); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = 0; }
    else throw new ObserverFailure('usage', 'observer supports --early or --regrade');
  } catch (error) { process.stdout.write(`${JSON.stringify({ record_type: 'phase16_observer_receipt', terminal: { status: 'failed', failure_code: error.code || 'observer_failure', message: error.message } }, null, 2)}\n`); process.exitCode = 1; }
}

module.exports = {
  ObserverFailure, writeExclusive, readCase, validateFreeze, gitScope, gitBlobSha, brownfield, completeHandoff, runOracle,
  observe, observeRun: observe, gradeValue, grade, gradeObservation: grade, regrade,
  regradeObservation: regrade, regradeChild, project, projectPublic: project, earlyProjection,
  writeEarlyProjection, observerFailureProjection, observeAndGrade, stable, stableHash, assertPublicSafe, allowedPaths,
  WORKFLOW_STEPS, DISPOSITIONS, PLAN_TOKEN_CEILING, PAUSE_TOKEN_CEILING, TURN_CONTRACT, TURN_TOTAL_WALL_MINUTES, TURN_TOTAL_NATIVE_TOKENS, EVALUATOR_LEDGER_CONTRACT, EVALUATOR_FILES, validateEvaluatorLedger, observePartialPlan,
};
