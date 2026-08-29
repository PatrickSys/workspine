'use strict';

// Task 16-08-01: provider-free rooted preparation for the one public case.
// Archive acquisition and control execution deliberately remain in the existing
// case seam; this file adds the real Git baseline and offline bundle proof.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const CORE = require('./phase16-core-flows.cjs');
const RECORDER = require('./phase16-codex-recorder.cjs');

const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const CASE_ID = 'itsdangerous-fips-sha1';
const CASE_CONTRACT = 'phase16-public-case-v1';
const CONTROLS_CONTRACT = 'phase16-itsdangerous-controls-v1';
const BUNDLE_CONTRACT = 'phase16-public-git-bundle-v1';
const MANIFEST_CONTRACT = 'phase16-public-cache-manifest-v1';
const DEFAULT_CONTROLS = path.join(REPO, '.work', 'phases', '16-safe-cohesive-first-run', '16-08-receipts', 'controls.json');
const WORKFLOWS = Object.freeze(['plan', 'pause', 'resume', 'execute', 'verify', 'progress']);
const APPROVAL_PLAN = '.work/brownfield-change/CHANGE.md';
const APPROVAL_REF = 'phase16-owner-active-goal-authorization';
const APPROVAL_CONTRACT = 'phase16-coordinator-approval-v1';

class RunnerFailure extends Error {
  constructor(code, message, evidence = null) {
    super(message);
    this.code = code;
    this.evidence = evidence;
  }
}

const fail = (code, message, evidence) => { throw new RunnerFailure(code, message, evidence); };
const exists = (file) => fs.existsSync(file);
const slash = (value) => String(value).split(path.sep).join('/');
const inside = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = (file) => sha(fs.readFileSync(file));
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const stableHash = (value) => sha(Buffer.from(stable(value), 'utf8'));

function absoluteFile(value, label) {
  const file = path.resolve(String(value || ''));
  if (!path.isAbsolute(file) || !exists(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    fail('case_file_invalid', `${label} must be an existing regular file`, { path: slash(file) });
  }
  return file;
}

function absoluteDirectory(value, label, { create = false, allowMissing = false } = {}) {
  const directory = path.resolve(String(value || ''));
  if (exists(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) fail('cache_unsafe', `${label} must be a non-link directory`, { path: slash(directory) });
  } else if (create) fs.mkdirSync(directory, { recursive: true });
  if (!exists(directory) && !allowMissing) fail('cache_invalid', `${label} does not exist`, { path: slash(directory) });
  return directory;
}

function command(command, argv, cwd, { timeout = 240000, env } = {}) {
  const result = cp.spawnSync(command, argv.map(String), {
    cwd, env, shell: false, encoding: 'utf8', windowsHide: true, timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error?.code === 'ETIMEDOUT') fail('git_timeout', `${command} timed out`, { argv });
  if (result.status !== 0) fail('git_command_failed', `${command} failed`, {
    argv, status: result.status, stderr: String(result.stderr || '').slice(-2000),
  });
  return String(result.stdout || '').trim();
}

function readCase(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail('case_schema_invalid', 'public case is not valid JSON', { message: error.message }); }
  if (data.id !== CASE_ID || data.contract !== CASE_CONTRACT) fail('case_pin_mismatch', 'only the pinned itsdangerous public case is supported');
  if (data.source?.repository !== 'https://github.com/pallets/itsdangerous.git') fail('case_pin_mismatch', 'source repository is not the pinned public upstream');
  return data;
}

function archiveLedger(entries, rootPrefix) {
  const members = entries.filter((entry) => !entry.directory && entry.member.startsWith(`${rootPrefix}/`))
    .map((entry) => ({ path: entry.member.slice(rootPrefix.length + 1), sha256: sha(entry.body), bytes: entry.body.length }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!members.length) fail('source_empty', 'pinned archive contains no source files');
  return { members, sha256: stableHash(members) };
}

function gitLedger(root, revision) {
  const names = command('git', ['ls-tree', '-r', '--name-only', revision], root).split(/\r?\n/).filter(Boolean).sort((left, right) => left.localeCompare(right));
  const members = names.map((member) => {
    const body = cp.spawnSync('git', ['show', `${revision}:${member}`], { cwd: root, encoding: null, windowsHide: true, shell: false, maxBuffer: 64 * 1024 * 1024 });
    if (body.status !== 0) fail('git_tree_invalid', `cannot read pinned Git member: ${member}`);
    const bytes = Buffer.from(body.stdout || '');
    return { path: member, sha256: sha(bytes), bytes: bytes.length };
  });
  return { members, sha256: stableHash(members) };
}

function verifyGitRoot(root, data, expectedArchiveLedger, { requireOrigin = true } = {}) {
  const revision = data.source.revision;
  if (requireOrigin) {
    const origin = command('git', ['remote', 'get-url', 'origin'], root);
    if (origin !== data.source.repository) fail('upstream_origin_mismatch', 'Git checkout origin is not the pinned public repository', { expected: data.source.repository, actual: origin });
  }
  const head = command('git', ['rev-parse', 'HEAD'], root);
  if (head !== revision) fail('upstream_head_mismatch', 'Git checkout is not at the pinned upstream revision', { expected: revision, actual: head });
  const status = cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false });
  if (status.status !== 0 || String(status.stdout || '').trim()) fail('git_root_dirty', 'pinned Git checkout is not clean', { status: String(status.stdout || '').trim() });
  const candidate = path.join(root, data.source.candidate_path);
  if (!exists(candidate) || !fs.lstatSync(candidate).isFile() || fs.lstatSync(candidate).isSymbolicLink()) fail('candidate_missing', 'pinned candidate is missing or unsafe');
  const pin = data.controls.variants.find((item) => item.id === 'baseline')?.candidate_sha256;
  if (!pin || fileSha(candidate) !== pin.toLowerCase()) fail('candidate_hash_mismatch', 'Git candidate bytes do not match the public case pin', { expected: pin, actual: fileSha(candidate) });
  const required = data.source.source_root.required_paths.map((item) => item.replace(/^project\//, ''));
  for (const item of required) {
    const target = path.join(root, item);
    if (!exists(target)) fail('required_path_missing', `required upstream path is missing: ${item}`);
  }
  const ledger = gitLedger(root, revision);
  if (stable(ledger.members) !== stable(expectedArchiveLedger.members) || ledger.sha256 !== expectedArchiveLedger.sha256) {
    fail('archive_git_mismatch', 'Git tree bytes do not agree with the verified archive bytes', { archive: expectedArchiveLedger.sha256, git: ledger.sha256 });
  }
  return { head, status: 'clean', candidate_sha256: fileSha(candidate), source_root_sha256: ledger.sha256, source_member_hashes: ledger.members };
}

function writeExclusive(file, value) {
  if (exists(file)) fail('receipt_exists', 'refusing to replace an existing create-exclusive receipt', { path: slash(file) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') fail('receipt_exists', 'refusing to replace an existing create-exclusive receipt'); throw error; }
}

function assertPreparedArchiveBinding(prepared, sourceArchive, archiveLedgerValue) {
  if (!prepared || prepared.source_archive_sha256 !== fileSha(sourceArchive)) fail('preparation_binding_mismatch', 'prepared archive hash does not match the reread archive bytes');
  if (prepared.source_root_sha256 !== archiveLedgerValue.sha256 || stable(prepared.source_member_hashes) !== stable(archiveLedgerValue.members)) {
    fail('preparation_binding_mismatch', 'prepared source ledger does not match the reread archive bytes');
  }
}

function validateControlsReceipt(controlsPath, data, prepared, caseFile) {
  let controls;
  try { controls = JSON.parse(fs.readFileSync(controlsPath, 'utf8')); } catch (error) { fail('controls_invalid', 'controls receipt is not valid JSON', { message: error.message }); }
  const expectedKeys = ['schema_version', 'record_type', 'contract', 'case_id', 'case_sha256', 'oracle', 'execution', 'mount_policy', 'roots', 'results', 'claim_limit'];
  if (stable(Object.keys(controls).sort()) !== stable(expectedKeys.slice().sort())) fail('controls_mismatch', 'controls receipt has unknown or missing fields');
  if (controls.schema_version !== 1 || controls.record_type !== 'phase16_controls_receipt' || controls.contract !== CONTROLS_CONTRACT || controls.case_id !== data.id || controls.case_sha256 !== fileSha(caseFile)) fail('controls_mismatch', 'controls receipt is not bound to the public case');
  if (!controls.oracle || controls.oracle.path !== data.oracle.path || controls.oracle.sha256 !== data.oracle.sha256.toLowerCase()) fail('controls_mismatch', 'controls receipt oracle pin does not match the public case');
  if (controls.execution !== 'black-box-provider-free' || controls.mount_policy !== 'never-live-agent-root') fail('controls_mismatch', 'controls receipt is not provider-free and isolated');
  const expectedIds = ['baseline', 'reference', 'mutant'];
  if (!controls.roots || stable(Object.keys(controls.roots).sort()) !== stable(expectedIds.slice().sort()) || expectedIds.some((id) => controls.roots[id] !== `<CASE_CACHE>/${data.id}/controls/${id}`)) fail('controls_mismatch', 'controls receipt roots are not isolated and case-bound');
  const expectedResults = prepared.control_results?.results;
  if (!Array.isArray(expectedResults) || !Array.isArray(controls.results) || controls.results.length !== 3 || stable(controls.results) !== stable(expectedResults)) fail('controls_mismatch', 'controls receipt results do not match the cached preparation');
  if (controls.results.some((item, index) => item.id !== expectedIds[index] || item.status !== (index === 1 ? 'pass' : 'fail') || item.expected !== (index === 1 ? 'green' : 'red'))) fail('controls_mismatch', 'controls receipt is not the required red/green/red control sequence');
  if (typeof controls.claim_limit !== 'string' || !/controls only/i.test(controls.claim_limit)) fail('controls_mismatch', 'controls receipt claim limit is missing');
  return controls;
}

function removeDisposableRoot(root, options = {}) {
  try {
    if (typeof options.removeDisposableRoot === 'function') {
      const result = options.removeDisposableRoot(root);
      if (result === false || exists(root)) fail('check_root_cleanup_failed', 'offline disposable check root was not removed');
    } else {
      fs.rmSync(root, { recursive: true, force: true });
      if (exists(root)) fail('check_root_cleanup_failed', 'offline disposable check root was not removed');
    }
    return { attempted: true, removed: true };
  } catch (error) {
    if (error instanceof RunnerFailure) throw error;
    fail('check_root_cleanup_failed', 'offline disposable check root cleanup failed', { message: error.message });
  }
}

function cleanupPreparationOutputs({ destination, destinationOwned, stage, controlsPath, controlsWritten, removePath }, originalError = null) {
  const failures = [];
  const remove = (target, label) => {
    if (!target || !exists(target)) return;
    try {
      const result = typeof removePath === 'function' ? removePath(target) : fs.rmSync(target, { recursive: true, force: true });
      if (result === false || exists(target)) failures.push({ label, message: 'path remained after cleanup' });
    } catch (error) { failures.push({ label, message: error.message }); }
  };
  remove(stage, 'preparation stage');
  if (originalError && destinationOwned) remove(destination, 'invocation-owned destination');
  if (originalError && controlsWritten) remove(controlsPath, 'invocation-owned controls receipt');
  if (failures.length) {
    throw new RunnerFailure('prepare_cleanup_failed', 'preparation cleanup failed', {
      original_failure: originalError ? { code: originalError.code || 'unknown', message: originalError.message } : null,
      cleanup_failures: failures,
    });
  }
}

function buildControlsReceipt(data, prepared, caseFile) {
  const results = prepared.control_results?.results;
  if (!Array.isArray(results) || results.length !== 3) fail('controls_missing', 'prepared public controls are missing');
  const expected = [['baseline', 'fail'], ['reference', 'pass'], ['mutant', 'fail']];
  if (results.some((item, index) => item.id !== expected[index][0] || item.status !== expected[index][1])) fail('controls_expectation_failed', 'baseline/reference/mutant controls did not produce red/green/red');
  const roots = Object.fromEntries(results.map((item) => [item.id, `<CASE_CACHE>/${data.id}/controls/${item.id}`]));
  const receipt = {
    schema_version: 1, record_type: 'phase16_controls_receipt', contract: CONTROLS_CONTRACT,
    case_id: data.id, case_sha256: fileSha(caseFile),
    oracle: { path: data.oracle.path, sha256: data.oracle.sha256.toLowerCase() },
    execution: 'black-box-provider-free', mount_policy: 'never-live-agent-root',
    roots, results: results.map((item) => ({ id: item.id, expected: item.expected, status: item.status, exit: item.exit, candidate_sha256: item.candidate_sha256, source_root_sha256: item.source_root_sha256, oracle_stdout_sha256: item.oracle_stdout_sha256, oracle_stderr_sha256: item.oracle_stderr_sha256 })),
    claim_limit: 'Controls only; no provider, workflow, product, benchmark, or release claim.',
  };
  return receipt;
}

function controlsReceipt(data, prepared, caseFile, controlsPath) {
  const receipt = buildControlsReceipt(data, prepared, caseFile);
  writeExclusive(controlsPath, receipt);
  return receipt;
}

async function preparePublicCase(caseFile, cacheValue, options = {}) {
  const file = absoluteFile(caseFile, 'public case');
  const data = readCase(file);
  const cache = absoluteDirectory(cacheValue, 'case cache', { create: true });
  const destination = path.join(cache, data.id);
  if (!inside(cache, destination)) fail('cache_unsafe', 'case destination escaped cache');
  if (exists(destination)) fail('cache_exists', 'refusing to replace an existing prepared case');

  let destinationOwned = false;
  let stage = null;
  let controlsWritten = false;
  let failure = null;
  const controlsPath = options.controls ? path.resolve(options.controls) : DEFAULT_CONTROLS;
  try {
    const prepareCore = options.corePrepare || CORE.preparePublicCase;
    const prepared = await prepareCore(file, cache, options);
    destinationOwned = true;
    if (!prepared || prepared.case_sha256 !== fileSha(file)) fail('preparation_binding_mismatch', 'existing case preparation was not bound to the case bytes');
    const sourceArchive = path.join(destination, 'source.tar.gz');
    const archiveLedgerValue = options.archiveLedger
      ? options.archiveLedger(sourceArchive, data)
      : archiveLedger(CORE.caseTarEntries(fs.readFileSync(sourceArchive)), data.source.root_prefix);
    const bindingCheck = options.postCoreBinding || assertPreparedArchiveBinding;
    bindingCheck(prepared, sourceArchive, archiveLedgerValue);
    stage = fs.mkdtempSync(path.join(cache, `.git-${data.id}-`));
    const upstream = path.join(stage, 'upstream');
    // The archive is the byte authority. Disable the Windows checkout filter so
    // CRLF conversion cannot make a valid upstream blob disagree with it.
    command('git', ['-c', 'core.autocrlf=false', 'clone', '--no-checkout', '--no-tags', data.source.repository, upstream], stage, { timeout: 300000 });
    command('git', ['config', 'core.autocrlf', 'false'], upstream);
    command('git', ['checkout', '--detach', data.source.revision], upstream);
    const gitProof = verifyGitRoot(upstream, data, archiveLedgerValue);
    const bundleStage = path.join(stage, 'source.bundle');
    // A detached checkout has no named ref; the ^! revset explicitly includes
    // the pinned commit so Git does not treat the bundle as empty.
    command('git', ['bundle', 'create', bundleStage, 'HEAD'], upstream);
    command('git', ['bundle', 'verify', bundleStage], upstream);
    const bundleHash = fileSha(bundleStage);
    fs.copyFileSync(bundleStage, path.join(destination, 'source.bundle'), fs.constants.COPYFILE_EXCL);
    // Seal controls first so their immutable hash can be included in the
    // create-exclusive cache manifest. No manifest rewrite is permitted.
    const controls = controlsReceipt(data, prepared, file, controlsPath);
    controlsWritten = true;
    const controlsHash = fileSha(controlsPath);
    const manifest = {
      schema_version: 1, record_type: 'phase16_public_cache_manifest', contract: MANIFEST_CONTRACT,
      case_id: data.id, case_sha256: fileSha(file), repository: data.source.repository, revision: data.source.revision,
      archive_sha256: fileSha(sourceArchive), archive_source_root_sha256: archiveLedgerValue.sha256,
      source_root_sha256: gitProof.source_root_sha256, candidate_sha256: gitProof.candidate_sha256,
      bundle_sha256: bundleHash, bundle_path: 'source.bundle', required_paths: data.source.source_root.required_paths,
      controls_receipt_sha256: controlsHash,
    };
    writeExclusive(path.join(destination, 'git-manifest.json'), manifest);
    return { ...prepared, git: { bundle_sha256: bundleHash, revision: data.source.revision, source_root_sha256: gitProof.source_root_sha256, candidate_sha256: gitProof.candidate_sha256, clean: true }, controls: { path: '<CONTROLS_RECEIPT>', sha256: manifest.controls_receipt_sha256, results: controls.results } };
  } catch (error) {
    // The destination and controls were created by this invocation; remove
    // only those partial outputs so a failed prepare cannot be mistaken for a
    // usable cache or leave a misleading private control receipt behind.
    failure = error;
    throw error;
  } finally {
    cleanupPreparationOutputs({ destination, destinationOwned, stage, controlsPath, controlsWritten, removePath: options.removePreparationPath }, failure);
  }
}

function checkPublicCase(caseFile, cacheValue, options = {}) {
  if (options.offline !== true) fail('offline_required', 'case checking requires explicit --offline');
  const file = absoluteFile(caseFile, 'public case');
  const data = readCase(file);
  const cache = absoluteDirectory(cacheValue, 'case cache', { allowMissing: true });
  const destination = path.join(cache, data.id);
  if (!inside(cache, destination) || !exists(destination) || !fs.statSync(destination).isDirectory()) fail('cache_missing', 'prepared case cache is missing');
  const prepared = CORE.checkPublicCase(file, cache, { offline: true, fixture: options.fixture === true });
  const manifestPath = path.join(destination, 'git-manifest.json');
  const bundle = path.join(destination, 'source.bundle');
  for (const required of [manifestPath, bundle]) if (!exists(required) || fs.lstatSync(required).isSymbolicLink()) fail('cache_manifest_missing', 'verified Git bundle manifest is missing or unsafe');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) { fail('cache_manifest_invalid', 'verified Git metadata is not valid JSON', { message: error.message }); }
  if (manifest.contract !== MANIFEST_CONTRACT || manifest.case_id !== data.id || manifest.case_sha256 !== fileSha(file) || manifest.revision !== data.source.revision) fail('cache_manifest_mismatch', 'Git manifest is not bound to the public case');
  if (fileSha(bundle) !== manifest.bundle_sha256) fail('cache_manifest_mismatch', 'Git bundle hash does not match the manifest');
  const controlsPath = options.controls ? path.resolve(options.controls) : DEFAULT_CONTROLS;
  if (!exists(controlsPath) || !fs.lstatSync(controlsPath).isFile() || fs.lstatSync(controlsPath).isSymbolicLink() || fileSha(controlsPath) !== manifest.controls_receipt_sha256) fail('cache_manifest_mismatch', 'immutable controls receipt does not match the manifest');
  validateControlsReceipt(controlsPath, data, JSON.parse(fs.readFileSync(path.join(destination, 'prepared.json'), 'utf8')), file);
  const checkRoot = fs.mkdtempSync(path.join(cache, `.offline-check-${data.id}-`));
  try {
    command('git', ['-c', 'core.autocrlf=false', 'clone', '--no-checkout', bundle, checkRoot], cache);
    command('git', ['config', 'core.autocrlf', 'false'], checkRoot);
    command('git', ['checkout', '--detach', data.source.revision], checkRoot);
    command('git', ['bundle', 'verify', bundle], checkRoot);
    const archiveLedgerValue = archiveLedger(CORE.caseTarEntries(fs.readFileSync(path.join(destination, 'source.tar.gz'))), data.source.root_prefix);
    if (fileSha(path.join(destination, 'source.tar.gz')) !== manifest.archive_sha256 || archiveLedgerValue.sha256 !== manifest.archive_source_root_sha256) fail('cache_manifest_mismatch', 'offline archive proof differs from the prepared manifest');
    const gitProof = verifyGitRoot(checkRoot, data, archiveLedgerValue, { requireOrigin: false });
    if (gitProof.source_root_sha256 !== manifest.source_root_sha256 || gitProof.candidate_sha256 !== manifest.candidate_sha256) fail('cache_manifest_mismatch', 'offline Git proof differs from the prepared manifest');
    const cleanup = removeDisposableRoot(checkRoot, options);
    return { ...prepared, git: { bundle_sha256: manifest.bundle_sha256, revision: data.source.revision, head: gitProof.head, clean: true, source_root_sha256: gitProof.source_root_sha256, candidate_sha256: gitProof.candidate_sha256 }, cleanup, terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'verified Git bundle cloned and checked offline' }, claim_limit: 'Pinned case acquisition, controls, and Git cache integrity only; no provider, workflow, product, benchmark, or release claim.' };
  } finally {
    if (exists(checkRoot)) removeDisposableRoot(checkRoot, options);
  }
}

const NATIVE_TOKEN_MULTIPLIER = 25;
const PLAN_TOKEN_CEILING = 6000000;
const PAUSE_TOKEN_CEILING = 2000000;
const TURN_PLAN = Object.freeze([
  // R1 retained 5,404,675 native tokens for the parent plan task; checker
  // children ran in separate sessions and are excluded. Use the next
  // whole-million bounded plan-only bucket; the 25x multiplier remains for
  // every other turn below.
  Object.freeze({ id: 'turn-a-plan', role: 'a-plan', skill: 'work-plan', skills: ['work-plan'], minutes: 30, tokens: PLAN_TOKEN_CEILING, session: 'A', initial: true }),
  Object.freeze({ id: 'turn-a-pause', role: 'a-pause', skill: 'work-pause', skills: ['work-pause'], minutes: 5, tokens: PAUSE_TOKEN_CEILING, session: 'A', initial: false }),
  Object.freeze({ id: 'turn-b-resume-execute', role: 'b-resume-execute', skill: 'work-resume', skills: ['work-resume', 'work-execute'], minutes: 20, tokens: 100000 * NATIVE_TOKEN_MULTIPLIER, session: 'B', initial: true }),
  Object.freeze({ id: 'turn-c-verify', role: 'c-verify', skill: 'work-verify', skills: ['work-verify'], minutes: 12, tokens: 60000 * NATIVE_TOKEN_MULTIPLIER, session: 'C', initial: true }),
  Object.freeze({ id: 'turn-c-progress', role: 'c-progress', skill: 'work-progress', skills: ['work-progress'], minutes: 5, tokens: 20000 * NATIVE_TOKEN_MULTIPLIER, session: 'C', initial: false }),
]);
const TURN_TOTAL_MINUTES = 72;
const TURN_TOTAL_TOKENS = TURN_PLAN.reduce((total, turn) => total + turn.tokens, 0);
const RETAINED_OUTPUT_BYTES = 1024 * 1024;
const EVALUATOR_LEDGER_CONTRACT = 'phase16-evaluator-ledger-v1';
const EVALUATOR_FILES = Object.freeze([
  'tests/evals/phase16-real-agent.cjs',
  'tests/evals/phase16-codex-recorder.cjs',
  'tests/evals/phase16-core-flows.cjs',
  'tests/evals/phase16-itsdangerous-observer.cjs',
]);
const CODEX_MODEL = 'gpt-5.6-luna';
const CODEX_EFFORT = 'high';
const CODEX_VERSION = 'codex-cli 0.149.1';
const CAPABILITY_CONTRACT = 'phase16-native-capability-v1';
const CAPABILITY_MARKER_PATH = '.work/eval-capability.json';
const CAPABILITY_MARKER_BYTES = Buffer.from('{"schema_version":1,"record_type":"phase16_capability_marker","case_id":"itsdangerous-fips-sha1","capability":"workspace-write","status":"pass"}\n', 'utf8');
const CAPABILITY_TURN = Object.freeze({ id: 'capability', role: 'capability-probe', skill: null, skills: [], minutes: 5, tokens: 20000 * NATIVE_TOKEN_MULTIPLIER, session: 'capability', initial: true });
const CAPABILITY_MAX_MINUTES = CAPABILITY_TURN.minutes;
const CAPABILITY_MAX_TOKENS = CAPABILITY_TURN.tokens;
function gitText(argv, cwd = REPO) {
  const result = cp.spawnSync('git', argv, { cwd, encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000 });
  if (result.status !== 0) fail('git_command_failed', `git ${argv.join(' ')} failed`, { stderr: String(result.stderr || '').slice(-2000) });
  return String(result.stdout || '').trim();
}
function diagnostic(value, root, env) {
  let text = String(value || '');
  for (const token of [root, env?.HOME, env?.USERPROFILE, REPO]) if (token) text = text.split(String(token)).join('<REDACTED_PATH>');
  return text.slice(-2000);
}
function codexProvider() {
  const descriptor = CORE.realAgentResolveProvider('codex', { command: 'codex' }, process.env);
  if (!descriptor) fail('provider_not_found', 'native Codex executable was not resolved');
  return descriptor;
}
function codexContract(descriptor) {
  const invoke = (argv) => CORE.realAgentRunProvider(descriptor, argv, { cwd: REPO, env: process.env, timeout: 30000 });
  const version = invoke(['--version']); const help = invoke(['exec', 'resume', '--help']);
  if (version.status !== 0 || String(version.stdout).trim() !== CODEX_VERSION || help.status !== 0 || !/SESSION_ID/.test(help.stdout) || !/--ignore-user-config/.test(help.stdout) || !/--json/.test(help.stdout)) fail('provider_contract_mismatch', 'resolved Codex does not match the frozen 0.149.1 resume contract');
  return { version: CODEX_VERSION, resume_help_sha256: sha(Buffer.from(help.stdout)) };
}
function resolvePython(options = {}) {
  const entries = options.entries || String(cp.spawnSync('where.exe', ['python'], { encoding: 'utf8', windowsHide: true, shell: false }).stdout || '').split(/\r?\n/).filter(Boolean);
  for (const candidate of entries.map((item) => path.resolve(item.trim())).filter((item) => item && !/[/\\]WindowsApps[/\\]/i.test(item))) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const probe = cp.spawnSync(candidate, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 });
    if (probe.status !== 0) continue;
    const identity = String(probe.stdout || '').trim();
    if (!identity || /[/\\]WindowsApps[/\\]/i.test(identity) || !exists(identity) || !fs.statSync(identity).isFile()) continue;
    return { path: fs.realpathSync(identity), sha256: fileSha(identity), identity: fs.realpathSync(identity), launcher: fs.realpathSync(candidate), probe_output: '<PYTHON>' };
  }
  fail('python_resolution_failure', 'no executable Python interpreter passed the identity probe', { candidates: entries });
}
function candidatePack(destination) {
  fs.mkdirSync(destination, { recursive: true });
  const npm = CORE.npmCliPath();
  const result = cp.spawnSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--pack-destination', destination, '--json'], { cwd: REPO, encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) fail('pack_failure', 'frozen candidate npm pack failed', { stderr: String(result.stderr || '').slice(-2000) });
  let rows;
  try { rows = JSON.parse(result.stdout); } catch (error) { fail('pack_output_failure', 'frozen candidate npm pack output was not JSON', { message: error.message }); }
  if (!Array.isArray(rows) || rows.length !== 1) fail('pack_identity_failure', 'frozen candidate did not produce one tarball');
  const file = path.join(destination, path.basename(rows[0].filename));
  if (!exists(file) || !inside(destination, file)) fail('pack_identity_failure', 'frozen candidate tarball escaped its staging directory');
  const members = CORE.liveTarEntries(file).filter((item) => item.type === 'file').map((item) => ({ path: item.path, sha256: sha(item.content), bytes: item.size })).sort((a, b) => a.path.localeCompare(b.path));
  return { path: file, sha256: fileSha(file), members, member_sha256: stableHash(members), npm: fs.realpathSync(npm) };
}
function sourceRef() {
  if (gitText(['branch', '--show-current']) !== 'main') fail('source_ref_mismatch', 'freeze may only be created on main');
  const head = gitText(['rev-parse', 'HEAD']);
  const origin = gitText(['rev-parse', 'origin/main']);
  if (head !== origin) fail('source_ref_mismatch', 'main and origin/main must be equal before freezing', { head, origin });
  return { head, origin };
}
function evaluatorFileLedger() {
  const files = Object.fromEntries(EVALUATOR_FILES.map((relative) => {
    const file = path.join(REPO, ...relative.split('/'));
    if (!exists(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('evaluator_binding_mismatch', `evaluator file is missing or unsafe: ${relative}`);
    return [relative, { bytes: fs.statSync(file).size, sha256: fileSha(file) }];
  }));
  return { contract: EVALUATOR_LEDGER_CONTRACT, files };
}
function validateEvaluatorLedger(ledger) {
  if (ledger?.contract !== EVALUATOR_LEDGER_CONTRACT || !ledger.files || stable(Object.keys(ledger.files).sort()) !== stable(EVALUATOR_FILES.slice().sort())) fail('evaluator_binding_mismatch', 'freeze evaluator ledger is missing or has an unexpected file set');
  for (const relative of EVALUATOR_FILES) {
    const expected = ledger.files[relative];
    const file = path.join(REPO, ...relative.split('/'));
    if (!expected || !Number.isInteger(expected.bytes) || !/^[0-9a-f]{64}$/i.test(String(expected.sha256 || '')) || !exists(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || expected.bytes !== fs.statSync(file).size || expected.sha256.toLowerCase() !== fileSha(file)) fail('evaluator_binding_mismatch', `evaluator file bytes differ from the freeze: ${relative}`);
  }
  return ledger;
}
function cacheBinding(caseFile, cacheValue, data, controlsPath) {
  const cache = absoluteDirectory(cacheValue, 'case cache');
  const destination = path.join(cache, data.id);
  const manifestPath = path.join(destination, 'git-manifest.json');
  const bundle = path.join(destination, 'source.bundle');
  if (!exists(manifestPath) || !exists(bundle)) fail('cache_manifest_missing', 'prepared public cache lacks its immutable bundle manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.case_sha256 !== fileSha(caseFile) || manifest.revision !== data.source.revision || fileSha(bundle) !== manifest.bundle_sha256) fail('cache_manifest_mismatch', 'prepared cache is not bound to the public case or pinned bundle');
  if (!exists(controlsPath) || fileSha(controlsPath) !== manifest.controls_receipt_sha256) fail('controls_mismatch', 'immutable controls receipt does not match the prepared cache');
  return { cache, destination, manifest, bundle, controls_sha256: fileSha(controlsPath), bundle_sha256: fileSha(bundle), source_archive_sha256: manifest.archive_sha256 };
}
function buildFreeze(caseFile, cacheValue, freezeFile, options = {}) {
  const file = absoluteFile(caseFile, 'public case');
  const data = readCase(file);
  const refs = sourceRef();
  const controlsPath = path.resolve(options.controls || DEFAULT_CONTROLS);
  const cache = cacheBinding(file, cacheValue, data, controlsPath);
  const source = CORE.sourceSnapshot();
  if (source.head !== refs.head) fail('source_ref_mismatch', 'source snapshot changed while freezing');
  const descriptor = options.provider || codexProvider();
  const python = options.python || resolvePython();
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-pack-'));
  try {
    const candidate = candidatePack(stage);
    const skillRoot = path.join(stage, 'skill-consumer'); fs.mkdirSync(skillRoot, { recursive: true }); fs.writeFileSync(path.join(skillRoot, 'package.json'), '{"name":"phase16-skill-check","private":true}\n');
    const install = cp.spawnSync(process.execPath, [candidate.npm, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-save', candidate.path], { cwd: skillRoot, encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000 });
    if (install.status !== 0) fail('skill_prepare_failed', 'frozen candidate could not be installed for skill witnesses');
    const skillCli = path.join(skillRoot, 'node_modules', 'workspine', 'bin', 'gsdd.mjs'); const init = cp.spawnSync(process.execPath, [skillCli, 'init', '--auto', '--tools', 'agents'], { cwd: skillRoot, encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000 });
    if (init.status !== 0) fail('skill_prepare_failed', 'frozen candidate could not generate repo-local skills');
    const skillIds = [...new Set(TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))]; const skills = Object.fromEntries(skillIds.map((id) => { const file = path.join(skillRoot, '.agents', 'skills', id, 'SKILL.md'); if (!exists(file)) fail('skill_prepare_failed', `generated skill is missing: ${id}`); return [id, fileSha(file)]; }));
    const freeze = {
      schema_version: 1, record_type: 'phase16_codex_freeze', contract: 'phase16-rooted-codex-freeze-v1', case_id: data.id,
      case: { path: `<CHECKOUT>/${slash(path.relative(REPO, file))}`, sha256: fileSha(file), oracle: data.oracle, input_bundle: { contract: data.input_bundle.contract, sha256: stableHash(data.input_bundle.members), members: Object.fromEntries(data.input_bundle.members.map((item) => [item.path, item.sha256])) } },
      source: { repository: data.source.repository, revision: data.source.revision, main: refs.head, origin_main: refs.origin, files: source.files },
      bundle: { path: '<PREPARED_CACHE>/source.bundle', sha256: cache.bundle_sha256, manifest_sha256: fileSha(path.join(cache.destination, 'git-manifest.json')), source_archive_sha256: cache.source_archive_sha256 },
      controls: { path: '<CONTROLS_RECEIPT>', sha256: cache.controls_sha256 },
      candidate: { sha256: candidate.sha256, member_sha256: candidate.member_sha256, members: candidate.members, package: { name: JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).name, version: JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version } },
      runtime: { provider: 'codex', model: CODEX_MODEL, effort: CODEX_EFFORT, cli_contract: codexContract(descriptor), executable: CORE.realAgentProviderEvidence(descriptor), python: { path: '<PYTHON>', sha256: python.sha256, identity: '<PYTHON>' }, auth_posture: 'authenticated-native-CODEX_HOME; ignore-user-config; credentials-not-copied' },
      toolchain: { node: { path: '<NODE>', sha256: fileSha(process.execPath) }, npm: { path: '<NPM>', sha256: fileSha(candidate.npm) }, git: { path: '<GIT>', sha256: fileSha(gitText(['--exec-path']).replace(/\r?\n/g, '') + (process.platform === 'win32' ? '\\git.exe' : '/git')) } },
      budgets: { turns: TURN_PLAN.map(({ id, role, skill, skills, minutes, tokens, session, initial }) => ({ id, role, skill, skills, wall_minutes: minutes, native_tokens: tokens, session, initial })), total_wall_minutes: TURN_TOTAL_MINUTES, total_native_tokens: TURN_TOTAL_TOKENS, retained_output_bytes: RETAINED_OUTPUT_BYTES },
      root_map: { run_root: '<RUN_ROOT>', consumer_root: '<RUN_ROOT>/consumer_root', tool_root: '<RUN_ROOT>/tool_root', receipts: '<RECEIPTS>' },
      sessions: { count: 3, turns: 5, workflow_count: 6, identities: 'native-only-distinct-A-B-and-C' }, provider_sandbox: 'not_claimed', workflow_verdict: 'not_evaluated', auth: { copied_to_consumer_root: false },
      skills,
      evaluator: evaluatorFileLedger(),
    };
    writeExclusive(freezeFile, freeze);
    return freeze;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
function readFreeze(file) {
  const freezeFile = absoluteFile(file, 'freeze');
  let freeze;
  try { freeze = JSON.parse(fs.readFileSync(freezeFile, 'utf8')); } catch (error) { fail('freeze_invalid', 'freeze is not valid JSON', { message: error.message }); }
  if (freeze.contract !== 'phase16-rooted-codex-freeze-v1' || freeze.case_id !== CASE_ID || freeze.workflow_verdict !== 'not_evaluated' || freeze.provider_sandbox !== 'not_claimed' || freeze.auth?.copied_to_consumer_root !== false || freeze.runtime?.provider !== 'codex') fail('freeze_invalid', 'freeze contract or claim posture is invalid');
  if (stable(freeze.budgets?.turns?.map((item) => [item.id, item.role, item.skill, item.skills, item.wall_minutes, item.native_tokens, item.session, item.initial])) !== stable(TURN_PLAN.map((item) => [item.id, item.role, item.skill, item.skills, item.minutes, item.tokens, item.session, item.initial]))) fail('freeze_budget_mismatch', 'freeze does not carry the fixed five-turn budgets');
  if (freeze.budgets?.total_wall_minutes !== TURN_TOTAL_MINUTES || freeze.budgets?.total_native_tokens !== TURN_TOTAL_TOKENS || freeze.budgets?.retained_output_bytes !== RETAINED_OUTPUT_BYTES || freeze.sessions?.count !== 3 || freeze.sessions?.turns !== 5 || freeze.root_map?.consumer_root !== '<RUN_ROOT>/consumer_root') fail('freeze_invalid', 'freeze fixed totals or root map are invalid');
  validateEvaluatorLedger(freeze.evaluator);
  if (!freeze.case?.sha256 || !freeze.case?.input_bundle?.sha256 || !freeze.bundle?.sha256 || !freeze.controls?.sha256 || !freeze.candidate?.sha256 || !freeze.candidate?.member_sha256 || !Array.isArray(freeze.candidate?.members) || !freeze.candidate.package?.name || !freeze.candidate.package?.version || !freeze.source?.main || !freeze.source?.origin_main || !freeze.source?.files || freeze.runtime?.cli_contract?.version !== CODEX_VERSION || !/^[0-9a-f]{64}$/i.test(freeze.runtime?.cli_contract?.resume_help_sha256 || '') || !freeze.runtime?.executable?.source_sha256 || !freeze.runtime?.executable?.target_sha256 || !freeze.toolchain?.node?.sha256 || !freeze.toolchain?.npm?.sha256 || !freeze.toolchain?.git?.sha256 || !freeze.runtime?.python?.sha256 || Object.keys(freeze.skills || {}).length !== 6 || Object.values(freeze.skills || {}).some((hash) => !/^[0-9a-f]{64}$/i.test(hash))) fail('freeze_invalid', 'freeze is missing an immutable case, source, bundle, controls, candidate, runtime, toolchain, or skill binding');
  return freeze;
}
function turnPrompt(context, turn) {
  const tokens = (turn.skills || [turn.skill]).map((skill) => `$${skill}`).join(' and ');
  const instructions = {
    'turn-a-plan': 'Plan only: read the bounded brownfield context and create the plan artifacts required by $work-plan, then stop. Do not modify product or source files. Do not create, consume, delete, or modify the pause checkpoint at .work/.continue-here.md. Do not approve the plan or transition lifecycle state to execute. Do not run $work-pause, $work-resume, $work-execute, $work-verify, or $work-progress.',
    'turn-a-pause': 'Pause only: write the canonical .work/.continue-here.md checkpoint for the completed plan, then stop. Do not plan, approve, resume, execute, verify, or report progress in this turn. Leave product and source files unchanged.',
    'turn-b-resume-execute': 'This is fresh process B: resume the retained workspace and execute only the already-approved plan, then stop. Do not plan, pause, approve, verify, or report progress in this turn.',
    'turn-c-verify': 'This is fresh process C: verify only the completed implementation and record the required verification evidence, then stop. Do not plan, pause, approve, resume, execute, or report progress in this turn.',
    'turn-c-progress': 'Progress only: perform the read-only progress report and stop. Do not plan, pause, approve, resume, execute, or verify; do not modify any file or lifecycle state.',
  }[turn.id];
  if (!instructions) fail('turn_prompt_unknown', `no stage-specific prompt contract exists for ${turn.id}`);
  return `${tokens}\nUse the owner TASK.md and BRIEF.md in inputs. ${instructions} Leave workflow_verdict untouched. Do not inspect evaluator internals or oracle material.`;
}

function capabilityPrompt(context, revision) {
  const marker = CAPABILITY_MARKER_BYTES.toString('utf8').replace(/\n$/, '');
  return [
    'Capability probe only. Do not use any skill, subagent, workflow, evaluator, oracle, network, or package operation.',
    'Read inputs/owner/TASK.md completely.',
    'Run exactly these repository checks from the consumer root: git rev-parse HEAD and git status --porcelain --untracked-files=all.',
    `Confirm the pinned HEAD is ${revision}.`,
    `Then write exactly these UTF-8 bytes to ${CAPABILITY_MARKER_PATH} (including the final LF, with no BOM):`,
    marker,
    'Do not create, delete, or modify any other file. End with a normal completed turn.',
  ].join('\n');
}
function skillWitness(context, turn) {
  return (turn.skills || [turn.skill]).map((id) => {
    const file = path.join(context.consumerRoot, '.agents', 'skills', id, 'SKILL.md');
    if (!exists(file) || !fs.statSync(file).isFile()) fail('skill_missing', `installed skill is missing: ${id}`);
    const sha256 = fileSha(file); const expected = context.expectedSkills?.[id] || context.freeze.skills?.[id];
    if (expected && expected !== sha256) fail('skill_hash_mismatch', `installed skill changed: ${id}`, { expected, actual: sha256 });
    return { id, path: `<CONSUMER_ROOT>/.agents/skills/${id}/SKILL.md`, sha256, bytes: fs.statSync(file).size };
  });
}
function runTurn(context, turn, sessionId = null, options = {}) {
  const skills = skillWitness(context, turn);
  const argv = RECORDER.buildCodexArgv({ cwd: context.consumerRoot, model: context.freeze.runtime.model, effort: context.freeze.runtime.effort, role: turn.role, sessionId });
  const input = turnPrompt(context, turn);
  for (const skill of turn.skills || [turn.skill]) if (!input.includes(`$${skill}`)) fail('skill_token_missing', `turn prompt lacks its exact skill token: ${skill}`);
  context.activeTurn = { skills, argv: argv.map((item) => diagnostic(item, context.runRoot, context.env)), cwd: '<CONSUMER_ROOT>', input_sha256: sha(Buffer.from(input)) };
  context.providerInvocations = (context.providerInvocations || 0) + 1;
  const recorded = RECORDER.recordCodexTurn({ turn, command: context.provider.command, prefix: context.provider.prefix, argv, cwd: context.consumerRoot, root: context.runRoot, env: context.env, prompt: input, skills: skills.map((item) => ({ token: `$${item.id}`, sha256: item.sha256 })), model: context.freeze.runtime.model, effort: context.freeze.runtime.effort, provider: context.provider, expectedSessionId: sessionId, maxTurnTokens: turn.tokens, maxOutputBytes: RETAINED_OUTPUT_BYTES, timeout: turn.minutes * 60000, characterizationOnly: Boolean(options.spawn), spawn: options.spawn });
  context.spawned = context.spawned || recorded.provider_invoked;
  context.activeReceipt = recorded;
  if (recorded.terminal.failure_code) { const error = new RunnerFailure(recorded.terminal.failure_code, recorded.terminal.message, { recorder: recorded }); error.receipt = recorded; throw error; }
  context.totalUsage = (context.totalUsage || 0) + recorded.usage.turn_tokens;
  return recorded;
}

function capabilityGitText(argv, cwd, options) {
  if (typeof options.gitText === 'function') return options.gitText(argv, cwd);
  return gitText(argv, cwd);
}

function capabilityReceipt({ caseId, revision, recorded, before, after, changed, head, status, characterizationOnly, failure = null }) {
  return {
    schema_version: 1,
    record_type: 'phase16_capability_receipt',
    contract: CAPABILITY_CONTRACT,
    case_id: caseId,
    capability: 'native-codex-workspace-write',
    provider_invoked: Boolean(recorded),
    characterization_only: characterizationOnly,
    workflow_verdict: 'not_evaluated',
    turn: recorded,
    marker: {
      path: `<CONSUMER_ROOT>/${CAPABILITY_MARKER_PATH}`,
      bytes: CAPABILITY_MARKER_BYTES.length,
      sha256: sha(CAPABILITY_MARKER_BYTES),
      exact: Boolean(after?.markerExact),
    },
    git: { expected_head: revision, head: head || null, status: status == null ? null : String(status) },
    snapshots: { pre_sha256: before ? stableHash(before) : null, post_sha256: after?.tree ? stableHash(after.tree) : null, changed_paths: changed || [] },
    terminal: failure
      ? { status: 'failed', failure_code: failure.code, message: failure.message }
      : { status: 'passed', failure_code: null, message: 'native Codex workspace-write capability probe passed' },
  };
}

function runCapability(caseFile, cacheValue, freezeFile, receiptDir, options = {}) {
  const freeze = readFreeze(freezeFile);
  const dir = path.resolve(receiptDir);
  fs.mkdirSync(dir, { recursive: true });
  const characterizationOnly = options.characterizationOnly === true;
  if ((options.prepareRun || options.spawn || options.gitText) && !characterizationOnly) fail('characterization_only_required', 'injected preparation, provider, or Git execution is characterization-only');
  const receiptFile = path.join(dir, 'capability.json');
  if (exists(receiptFile)) fail('receipt_exists', 'refusing to replace an existing create-exclusive capability receipt', { path: slash(receiptFile) });

  let context = null;
  let recorded = null;
  let before = null;
  let after = null;
  let changed = [];
  let head = null;
  let status = null;
  let data = null;
  let revision = null;
  try {
    context = options.prepareRun
      ? options.prepareRun(caseFile, cacheValue, freeze, { ...options, receiptDir: dir })
      : prepareRun(caseFile, cacheValue, freeze, { ...options, receiptDir: dir });
    if (!context || !context.consumerRoot || !exists(context.consumerRoot)) fail('consumer_root_invalid', 'capability probe consumer root is missing');
    // The public case and freeze are the authority for the expected upstream
    // revision. Never let an injected preparation context redefine that pin.
    data = readCase(absoluteFile(caseFile, 'public case'));
    revision = data.source?.revision;
    if (typeof revision !== 'string' || revision.length === 0) fail('source_ref_mismatch', 'capability probe has no pinned source revision');
    if (freeze.source?.revision && freeze.source.revision !== revision) fail('freeze_binding_mismatch', 'capability probe freeze is bound to a different upstream revision');
    const marker = path.join(context.consumerRoot, CAPABILITY_MARKER_PATH);
    if (!inside(context.consumerRoot, marker)) fail('consumer_root_invalid', 'capability marker escaped the consumer root');
    if (exists(marker)) fail('marker_exists', 'capability marker already exists in the consumer root');
    // Keep the parent directory in the pre-turn baseline so the only allowed
    // post-turn tree delta is the marker file itself.
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    before = CORE.snapshotTree(context.consumerRoot, true);
    const argv = RECORDER.buildCodexArgv({ cwd: context.consumerRoot, model: freeze.runtime.model, effort: freeze.runtime.effort, role: CAPABILITY_TURN.role, sessionId: null });
    const input = capabilityPrompt(context, revision);
    context.activeTurn = { argv: argv.map((item) => diagnostic(item, context.runRoot, context.env)), cwd: '<CONSUMER_ROOT>', input_sha256: sha(Buffer.from(input)), skills: [] };
    recorded = RECORDER.recordCodexTurn({
      turn: CAPABILITY_TURN,
      command: context.provider.command,
      prefix: context.provider.prefix,
      argv,
      cwd: context.consumerRoot,
      root: context.runRoot,
      env: context.env,
      prompt: input,
      skills: [],
      model: freeze.runtime.model,
      effort: freeze.runtime.effort,
      provider: context.provider,
      expectedSessionId: null,
      maxTurnTokens: CAPABILITY_MAX_TOKENS,
      maxOutputBytes: RETAINED_OUTPUT_BYTES,
      timeout: CAPABILITY_MAX_MINUTES * 60000,
      characterizationOnly,
      spawn: options.spawn,
    });
    context.spawned = context.spawned || recorded.provider_invoked;
    if (recorded.terminal.failure_code) fail(recorded.terminal.failure_code, recorded.terminal.message);
    after = { tree: CORE.snapshotTree(context.consumerRoot, true), markerExact: false };
    changed = changedPaths(before, after.tree);
    const forbiddenKinds = (recorded.native.item_kinds || []).filter((kind) => kind === 'collab_tool_call' || kind === 'web_search');
    if (forbiddenKinds.length) fail('capability_forbidden_tool', 'capability probe native evidence contains a forbidden collaboration or web-search item kind', { item_kinds: [...new Set(forbiddenKinds)] });
    if (changed.length !== 1 || changed[0] !== CAPABILITY_MARKER_PATH) fail('capability_scope_violation', 'capability probe changed a path other than the fixed marker', { changed });
    const markerBytes = fs.readFileSync(marker);
    after.markerExact = markerBytes.equals(CAPABILITY_MARKER_BYTES);
    if (!after.markerExact) fail('capability_marker_mismatch', 'capability marker bytes do not match the fixed contract', { expected_sha256: sha(CAPABILITY_MARKER_BYTES), actual_sha256: sha(markerBytes), expected_bytes: CAPABILITY_MARKER_BYTES.length, actual_bytes: markerBytes.length });
    head = capabilityGitText(['rev-parse', 'HEAD'], context.consumerRoot, options).trim();
    if (head !== revision) fail('capability_head_mismatch', 'capability probe consumer HEAD is not the pinned revision', { expected: revision, actual: head });
    status = capabilityGitText(['status', '--porcelain', '--untracked-files=all'], context.consumerRoot, options).trim();
    const receipt = capabilityReceipt({ caseId: data.id || CASE_ID, revision, recorded, before, after, changed, head, status, characterizationOnly });
    writeExclusive(receiptFile, receipt);
    return receipt;
  } catch (error) {
    const failure = error instanceof RunnerFailure ? error : new RunnerFailure(error.code || 'infrastructure', error.message, error.evidence || null);
    if (!exists(receiptFile)) {
      const receipt = capabilityReceipt({ caseId: data?.id || CASE_ID, revision: revision || freeze.source?.revision || freeze.source?.main || null, recorded, before, after, changed, head, status, characterizationOnly, failure });
      try { writeExclusive(receiptFile, receipt); } catch (writeError) { if (writeError.code !== 'receipt_exists') throw writeError; }
    }
    failure.provider_invoked = Boolean(context?.spawned || recorded);
    throw failure;
  }
}

function changedPaths(before, after) {
  const left = new Map(before.map((item) => [item.path, stable(item)])); const right = new Map(after.map((item) => [item.path, stable(item)]));
  return [...new Set([...left.keys(), ...right.keys()])].filter((key) => left.get(key) !== right.get(key));
}
function readPlanBoundaryArtifacts(root) {
  const statePath = path.join(root, '.work', 'state.json');
  let state = null;
  if (exists(statePath)) {
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (error) { fail('plan_state_invalid', 'plan lifecycle state is not valid JSON', { message: error.message }); }
  }
  const checkpoint = (relative) => {
    const file = path.join(root, ...relative.split('/'));
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, type: null, bytes: null, sha256: null };
      fail('plan_checkpoint_invalid', 'plan checkpoint could not be inspected', { path: relative, message: error.message });
    }
    const type = stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    return { exists: true, type, bytes: type === 'file' ? stat.size : null, sha256: type === 'file' ? fileSha(file) : null };
  };
  const checkpoints = Object.fromEntries(['.work/.continue-here.md', '.work/.continue-here.bak'].map((relative) => {
    return [relative, checkpoint(relative)];
  }));
  return { state, checkpoints };
}
function planLifecycleValues(state) {
  return {
    root_current_state: state?.current_state,
    root_phase: state?.phase,
    root_status: state?.status,
    workflow_current_state: state?.workflow?.current_state,
    workflow_phase: state?.workflow?.phase,
    workflow_status: state?.workflow?.status,
    workflow_execution_state: state?.workflow?.execution?.state,
    workflow_execution_status: state?.workflow?.execution?.status,
  };
}
function planApprovalValues(state) {
  return {
    root_approved: state?.approved,
    root_approval_ref: state?.approval_ref,
    plan_approved: state?.plan?.approved,
    plan_approval_ref: state?.plan?.approval_ref,
    workflow_approved: state?.workflow?.approved,
    workflow_approval_ref: state?.workflow?.approval_ref,
    workflow_plan_approved: state?.workflow?.plan?.approved,
    workflow_plan_approval_ref: state?.workflow?.plan?.approval_ref,
  };
}
function assertPlanScope(root, before, after) {
  const changed = changedPaths(before.tree, after.tree);
  const product = changed.filter((item) => item !== '.work' && !item.startsWith('.work/'));
  if (product.length) fail('plan_product_mutation', 'plan changed product or undeclared consumer bytes', { changed: product });
  const beforeBoundary = before.boundary || readPlanBoundaryArtifacts(root);
  const afterBoundary = after.boundary || readPlanBoundaryArtifacts(root);
  const checkpointChanged = Object.keys(afterBoundary.checkpoints).filter((relative) => stable(afterBoundary.checkpoints[relative]) !== stable(beforeBoundary.checkpoints[relative]));
  if (checkpointChanged.length) fail('plan_checkpoint_mutation', 'plan created, consumed, or modified a pause checkpoint', { changed: checkpointChanged });
  const beforeApproval = planApprovalValues(beforeBoundary.state);
  const afterApproval = planApprovalValues(afterBoundary.state);
  const newlyApproved = Object.keys(afterApproval).filter((key) => {
    const afterValue = afterApproval[key]; const beforeValue = beforeApproval[key];
    return (key.endsWith('_approved') ? afterValue === true : typeof afterValue === 'string' && afterValue.trim().length > 0)
      && !((key.endsWith('_approved') ? beforeValue === true : typeof beforeValue === 'string' && beforeValue.trim().length > 0));
  });
  if (newlyApproved.length) fail('plan_owner_approval', 'plan turn self-asserted owner approval', { path: '.work/state.json', fields: newlyApproved });
  const beforeStates = planLifecycleValues(beforeBoundary.state); const afterStates = planLifecycleValues(afterBoundary.state);
  const executionStates = new Set(['execute', 'running', 'in_progress']);
  const newlyExecuting = Object.keys(afterStates).filter((key) => executionStates.has(afterStates[key]) && !executionStates.has(beforeStates[key]));
  if (newlyExecuting.length) fail('plan_state_transition', 'plan turn transitioned lifecycle state into execution', { path: '.work/state.json', fields: newlyExecuting, values: Object.fromEntries(newlyExecuting.map((key) => [key, afterStates[key]])) });
  const lifecycleStates = new Set(['plan', 'pause', 'fresh-resume', 'resume', 'execute', 'running', 'in_progress', 'verify', 'progress', 'audit', 'complete']);
  const rootStates = Object.entries(afterStates).filter(([key, value]) => key.startsWith('root_') && lifecycleStates.has(value));
  const workflowStates = Object.entries(afterStates).filter(([key, value]) => key.startsWith('workflow_') && lifecycleStates.has(value));
  if (rootStates.length && workflowStates.length && rootStates.some(([, value]) => workflowStates.some(([, workflowValue]) => workflowValue !== value))) fail('plan_state_transition', 'plan lifecycle state has conflicting root and workflow representations', { path: '.work/state.json', root: Object.fromEntries(rootStates), workflow: Object.fromEntries(workflowStates) });
  if (Object.values(afterBoundary.checkpoints).some((item) => item.exists && item.type !== 'file')) fail('plan_checkpoint_mutation', 'plan checkpoint evidence is not a regular file', { checkpoints: afterBoundary.checkpoints });
}
function assertPauseScope(before, after) {
  const changed = changedPaths(before, after);
  const forbidden = changed.filter((item) => !item.startsWith('.work/') && item !== '.work');
  if (forbidden.length) fail('pause_product_mutation', 'pause changed product or undeclared consumer bytes', { changed: forbidden });
}

function approvalStateEvidence(state) {
  return {
    current_state: state?.current_state ?? null,
    workflow_current_state: state?.workflow?.current_state ?? null,
    workflow_authority: state?.workflow?.authority ?? null,
    workflow_plan_path: state?.workflow?.plan?.path ?? null,
    workflow_plan_identity: state?.workflow?.plan?.identity ?? null,
    workflow_plan_approved: state?.workflow?.plan?.approved ?? null,
    workflow_approval_ref: state?.workflow?.approval_ref ?? null,
    workflow_execution_status: state?.workflow?.execution?.status ?? null,
  };
}

function approvalCommandEvidence() {
  return {
    executable: '<NODE>',
    argv: ['<TOOL_ROOT>/node_modules/workspine/bin/gsdd.mjs', 'lifecycle-transition', 'approve', '--plan', APPROVAL_PLAN, '--authority', 'owner', '--approval-ref', APPROVAL_REF, '--json'],
    cwd: '<CONSUMER_ROOT>',
    shell: false,
  };
}

function regularFileShaOrNull(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return fileSha(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function requireRegularFileSha(file, label) {
  const digest = regularFileShaOrNull(file);
  if (!digest) fail('approval_plan_artifact_missing', `${label} must be an existing regular non-symlink file`, { path: `<CONSUMER_ROOT>/${APPROVAL_PLAN}` });
  return digest;
}

function approvalReceipt({ response = null, result = null, before = null, after = null, changed = [], planReceipt = {}, planArtifact = {}, failure = null, characterizationOnly }) {
  return {
    schema_version: 1,
    record_type: 'phase16_coordinator_approval_receipt',
    contract: APPROVAL_CONTRACT,
    case_id: CASE_ID,
    target: 'approve',
    plan: `<CONSUMER_ROOT>/${APPROVAL_PLAN}`,
    authority: 'owner',
    approval_ref: APPROVAL_REF,
    command: approvalCommandEvidence(),
    plan_receipt: {
      path: '<RECEIPTS>/turn-a-plan.json',
      expected_sha256: planReceipt.expected_sha256 ?? null,
      observed_sha256: planReceipt.observed_sha256 ?? null,
    },
    plan_artifact: {
      path: `<CONSUMER_ROOT>/${APPROVAL_PLAN}`,
      expected_sha256: planArtifact.expected_sha256 ?? null,
      observed_sha256: planArtifact.observed_sha256 ?? null,
    },
    result: {
      status: response?.status ?? null,
      output_status: result?.status ?? null,
      changed: result?.changed ?? null,
      target: result?.target ?? null,
      error_code: result?.error_code ?? null,
      provider_invoked: result?.provider_invoked === true,
      failure_code: failure?.code || null,
    },
    state: {
      before: approvalStateEvidence(before?.boundary?.state),
      after: approvalStateEvidence(after?.boundary?.state),
      output: approvalStateEvidence(result?.state),
    },
    changed_paths: changed,
    characterization_only: Boolean(characterizationOnly),
    workflow_verdict: 'not_evaluated',
  };
}

function runCoordinatorApproval(context, options = {}) {
  const receiptFile = path.join(context.receiptDir, 'approval.json');
  if (typeof options.approvePlan === 'function' && options.characterizationOnly !== true) fail('characterization_only_required', 'injected approval execution is characterization-only');
  const planReceiptFile = path.join(context.receiptDir, 'turn-a-plan.json');
  let planReceipt = { expected_sha256: null, observed_sha256: null };
  const planArtifactFile = path.join(context.consumerRoot, ...APPROVAL_PLAN.split('/'));
  let planArtifact = { expected_sha256: null, observed_sha256: null };
  const before = { tree: CORE.snapshotTree(context.consumerRoot, true), boundary: readPlanBoundaryArtifacts(context.consumerRoot) };
  const providerInvocations = context.providerInvocations || 0;
  let response = null;
  let result = null;
  let after = before;
  let changed = [];
  try {
    if (!exists(planReceiptFile) || !fs.lstatSync(planReceiptFile).isFile() || fs.lstatSync(planReceiptFile).isSymbolicLink()) fail('approval_plan_receipt_missing', 'sealed turn-a-plan receipt is missing or unsafe');
    planReceipt.expected_sha256 = fileSha(planReceiptFile);
    planArtifact.expected_sha256 = requireRegularFileSha(planArtifactFile, 'generated brownfield CHANGE.md');
    response = typeof options.approvePlan === 'function'
      ? options.approvePlan(context, { plan: APPROVAL_PLAN, authority: 'owner', approvalRef: APPROVAL_REF })
      : (() => {
        if (!context.cli || typeof context.cli !== 'string') fail('approval_cli_missing', 'installed candidate CLI is missing from the preparation context');
        return cp.spawnSync(process.execPath, [context.cli, 'lifecycle-transition', 'approve', '--plan', APPROVAL_PLAN, '--authority', 'owner', '--approval-ref', APPROVAL_REF, '--json'], {
          cwd: context.consumerRoot,
          env: context.env,
          encoding: 'utf8',
          windowsHide: true,
          shell: false,
          timeout: 120000,
          maxBuffer: 4 * 1024 * 1024,
        });
      })();
    after = { tree: CORE.snapshotTree(context.consumerRoot, true), boundary: readPlanBoundaryArtifacts(context.consumerRoot) };
    planReceipt.observed_sha256 = exists(planReceiptFile) && fs.lstatSync(planReceiptFile).isFile() && !fs.lstatSync(planReceiptFile).isSymbolicLink() ? fileSha(planReceiptFile) : null;
    planArtifact.observed_sha256 = regularFileShaOrNull(planArtifactFile);
    if (planReceipt.observed_sha256 !== planReceipt.expected_sha256) fail('approval_plan_receipt_mutation', 'coordinator approval rewrote or deleted the sealed plan receipt', { expected_sha256: planReceipt.expected_sha256, observed_sha256: planReceipt.observed_sha256 });
    if (planArtifact.observed_sha256 !== planArtifact.expected_sha256) fail('approval_plan_artifact_mutation', 'coordinator approval rewrote, deleted, or replaced the generated brownfield plan artifact', { expected_sha256: planArtifact.expected_sha256, observed_sha256: planArtifact.observed_sha256 });
    changed = changedPaths(before.tree, after.tree);
    const product = changed.filter((item) => item !== '.work' && !item.startsWith('.work/'));
    if (product.length) fail('approval_product_mutation', 'coordinator approval changed product or undeclared consumer bytes', { changed: product });
    const checkpointChanged = Object.keys(after.boundary.checkpoints).filter((relative) => stable(after.boundary.checkpoints[relative]) !== stable(before.boundary.checkpoints[relative]));
    if (checkpointChanged.length) fail('approval_checkpoint_mutation', 'coordinator approval created, consumed, or modified a pause checkpoint', { changed: checkpointChanged });
    if ((context.providerInvocations || 0) !== providerInvocations || response?.provider_invoked === true) fail('approval_provider_invoked', 'coordinator approval invoked the provider or reported provider execution');
    if (!response || typeof response.status !== 'number' || response.status !== 0) fail('approval_command_failed', 'coordinator approval command failed', { status: response?.status ?? null });
    if (typeof response.stdout !== 'string') fail('approval_output_malformed', 'coordinator approval did not return JSON stdout');
    try { result = JSON.parse(response.stdout); } catch (error) { fail('approval_output_malformed', 'coordinator approval stdout was not valid JSON', { message: error.message }); }
    if (!result || Array.isArray(result) || result.operation !== 'lifecycle-transition' || result.target !== 'approve' || result.status !== 'ok' || result.changed !== true) fail('approval_result_invalid', 'coordinator approval result was not a fresh successful approve transition', { status: result?.status ?? null, changed: result?.changed ?? null, target: result?.target ?? null });
    const outputState = approvalStateEvidence(result.state);
    const state = approvalStateEvidence(after.boundary.state);
    if (outputState.current_state !== state.current_state || outputState.workflow_current_state !== state.workflow_current_state || outputState.workflow_authority !== state.workflow_authority || outputState.workflow_plan_path !== state.workflow_plan_path || outputState.workflow_plan_identity !== state.workflow_plan_identity || outputState.workflow_plan_approved !== state.workflow_plan_approved || outputState.workflow_approval_ref !== state.workflow_approval_ref || outputState.workflow_execution_status !== state.workflow_execution_status) fail('approval_state_mismatch', 'coordinator approval output state differs from the retained workspace state');
    if (state.current_state !== 'execute' || state.workflow_current_state !== 'execute' || state.workflow_authority !== 'owner' || state.workflow_plan_path !== APPROVAL_PLAN || state.workflow_plan_identity !== APPROVAL_PLAN || state.workflow_plan_approved !== true || state.workflow_approval_ref !== APPROVAL_REF || state.workflow_execution_status !== 'in_progress') fail('approval_state_invalid', 'coordinator approval did not record the expected owner approval state, plan identity, reference, and execution status');
    const receipt = approvalReceipt({ response, result, before, after, changed, planReceipt, planArtifact, characterizationOnly: options.characterizationOnly });
    writeExclusive(receiptFile, receipt);
    context.approval = receipt;
    return receipt;
  } catch (error) {
    const failure = error instanceof RunnerFailure ? error : new RunnerFailure(error.code || 'approval_failed', error.message, error.evidence || null);
    if (planReceipt.expected_sha256) planReceipt.observed_sha256 = exists(planReceiptFile) && fs.lstatSync(planReceiptFile).isFile() && !fs.lstatSync(planReceiptFile).isSymbolicLink() ? fileSha(planReceiptFile) : null;
    if (planArtifact.expected_sha256) planArtifact.observed_sha256 = regularFileShaOrNull(planArtifactFile);
    if (!exists(receiptFile)) {
      const receipt = approvalReceipt({ response, result, before, after, changed, planReceipt, planArtifact, failure, characterizationOnly: options.characterizationOnly });
      writeExclusive(receiptFile, receipt);
      context.approval = receipt;
    }
    failure.receipt = context.approval || null;
    throw failure;
  }
}

function prepareRun(caseFile, cacheValue, freeze, options = {}) {
  const file = absoluteFile(caseFile, 'public case'); const data = readCase(file);
  validateEvaluatorLedger(freeze?.evaluator);
  const refs = sourceRef();
  if (refs.head !== freeze.source.main || refs.origin !== freeze.source.origin_main) fail('source_ref_mismatch', 'current main and origin/main differ from the freeze');
  const cache = cacheBinding(file, cacheValue, data, options.controls || DEFAULT_CONTROLS);
  if (cache.bundle_sha256 !== freeze.bundle.sha256 || fileSha(file) !== freeze.case.sha256 || cache.controls_sha256 !== freeze.controls.sha256 || stableHash(data.input_bundle.members) !== freeze.case.input_bundle.sha256) fail('freeze_binding_mismatch', 'run inputs differ from the freeze');
  const source = CORE.sourceSnapshot();
  if (source.head !== freeze.source.main || stable(source.files) !== stable(freeze.source.files)) fail('source_ref_mismatch', 'checkout bytes differ from the frozen candidate');
  const runRoot = options.runRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-run-'));
  const consumerRoot = path.join(runRoot, 'consumer_root'); const toolStage = path.join(runRoot, 'tool-stage');
  fs.mkdirSync(runRoot, { recursive: true });
  gitText(['-c', 'core.autocrlf=false', 'clone', '--no-checkout', '--no-tags', cache.bundle, consumerRoot], runRoot);
  gitText(['config', 'core.autocrlf', 'false'], consumerRoot); gitText(['checkout', '--detach', data.source.revision], consumerRoot); gitText(['remote', 'set-url', 'origin', data.source.repository], consumerRoot);
  if (gitText(['rev-parse', 'HEAD'], consumerRoot) !== data.source.revision || gitText(['status', '--porcelain'], consumerRoot)) fail('consumer_root_invalid', 'prepared consumer root is not the pinned clean checkout');
  const inputRoot = path.join(consumerRoot, 'inputs'); fs.mkdirSync(path.join(inputRoot, 'owner'), { recursive: true });
  for (const item of data.input_bundle.members) fs.writeFileSync(path.join(inputRoot, ...item.path.split('/')), item.content, { flag: 'wx' });
  const provider = options.provider || codexProvider(); const sourceBefore = CORE.sourceSnapshot();
  const npmPath = CORE.npmCliPath(); const gitPath = process.platform === 'win32' ? path.join(gitText(['--exec-path']), 'git.exe') : path.join(gitText(['--exec-path']), 'git');
  const toolDirs = [...new Set([path.dirname(process.execPath), path.dirname(npmPath), path.dirname(gitPath), path.dirname(resolvePython().path), path.dirname(provider.command), ...(provider.prefix || []).map((item) => path.dirname(item)), ...(process.platform === 'win32' && process.env.SystemRoot ? [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot] : [])].map((item) => path.resolve(item)))];
  const env = { PATH: toolDirs.join(path.delimiter), CODEX_HOME: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), HOME: process.env.HOME || os.homedir(), USERPROFILE: process.env.USERPROFILE || os.homedir(), SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0' };
  if (fileSha(process.execPath) !== freeze.toolchain.node.sha256 || fileSha(npmPath) !== freeze.toolchain.npm.sha256 || fileSha(gitPath) !== freeze.toolchain.git.sha256) fail('toolchain_binding_mismatch', 'verified toolchain bytes differ from the freeze'); const installed = CORE.packAndInstall(toolStage, env, CORE.npmCliPath(), sourceBefore);
  const candidateHash = installed.tarball.sha256;
  if (candidateHash !== freeze.candidate.sha256) fail('candidate_hash_mismatch', 'packed candidate changed after freeze', { expected: freeze.candidate.sha256, actual: candidateHash });
  const packed = CORE.liveTarEntries(path.join(toolStage, 'pack', path.basename(installed.tarball.filename))).filter((item) => item.type === 'file').map((item) => ({ path: item.path, sha256: sha(item.content), bytes: item.size })).sort((a, b) => a.path.localeCompare(b.path));
  if (stableHash(packed) !== freeze.candidate.member_sha256) fail('candidate_members_mismatch', 'packed candidate members changed after freeze');
  const cli = path.join(installed.packageRoot, 'bin', 'gsdd.mjs');
  const init = cp.spawnSync(process.execPath, [cli, 'init', '--auto', '--tools', 'agents'], { cwd: consumerRoot, env, input: '', encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000, maxBuffer: 1024 * 1024 });
  if (init.status !== 0) fail('generated_skills_setup_failed', 'installed Workspine could not prepare repo-local skills', { stderr: String(init.stderr || '').slice(-2000) });
  const evidence = CORE.realAgentProviderEvidence(provider);
  if (stable(evidence) !== stable(freeze.runtime.executable)) fail('provider_binding_mismatch', 'resolved Codex executable differs from the freeze');
  if (stable(codexContract(provider)) !== stable(freeze.runtime.cli_contract)) fail('provider_contract_mismatch', 'resolved Codex runtime contract differs from the freeze');
  const python = resolvePython(); if (python.sha256 !== freeze.runtime.python.sha256) fail('python_binding_mismatch', 'resolved Python differs from the freeze');
  const context = { freeze, data, runRoot, consumerRoot, toolRoot: path.join(toolStage, 'install'), cli, receiptDir: options.receiptDir, provider, env, python, totalUsage: 0, sessions: {}, providerInvocations: 0, spawned: false, sourceBefore, cache, inputRoot };
  context.skills = Object.fromEntries([...new Set(TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))].map((skill) => [skill, fileSha(path.join(consumerRoot, '.agents', 'skills', skill, 'SKILL.md'))])); context.expectedSkills = freeze.skills || null;
  return context;
}

function runFrozen(caseFile, cacheValue, freezeFile, receiptDir, options = {}) {
  const OBSERVER = options.observer || require('./phase16-itsdangerous-observer.cjs');
  const freeze = readFreeze(freezeFile); const dir = path.resolve(receiptDir); fs.mkdirSync(dir, { recursive: true });
  const characterizationOnly = options.characterizationOnly === true;
  if ((options.prepareRun || options.spawn || options.approvePlan) && !characterizationOnly) fail('characterization_only_required', 'injected preparation, provider, or approval execution is characterization-only');
  for (const name of [...TURN_PLAN.map((turn) => `${turn.id}.json`), 'preparation.json', 'approval.json', 'handoff.json', 'terminal.json', 'oracle.json', 'observation.json', 'grade.json', 'regrade.json', 'regrade-compare.json']) if (exists(path.join(dir, name))) fail('receipt_exists', `refusing to overwrite an existing receipt: ${name}`);
  const turns = []; let current = null; let failure = null; let context = null;
  try {
    context = options.prepareRun ? options.prepareRun(caseFile, cacheValue, freeze, { ...options, receiptDir: dir }) : prepareRun(caseFile, cacheValue, freeze, { ...options, receiptDir: dir });
    writeExclusive(path.join(dir, 'preparation.json'), { schema_version: 1, record_type: 'phase16_preparation_receipt', case_id: CASE_ID, consumer_root: '<CONSUMER_ROOT>', tool_root: '<TOOL_ROOT>', bundle_sha256: freeze.bundle.sha256, controls_sha256: freeze.controls.sha256, candidate_sha256: freeze.candidate.sha256, generated_skills: [...new Set(TURN_PLAN.flatMap((turn) => turn.skills || [turn.skill]))], python: context.python ? { identity: '<PYTHON>', sha256: context.python.sha256 } : null, auth_copied: false, characterization_only: characterizationOnly, workflow_verdict: 'not_evaluated' });
    let pauseBaseline = null;
    for (const turn of TURN_PLAN) {
      current = turn; const before = CORE.snapshotTree(context.consumerRoot, true); const beforeBoundary = turn.id === 'turn-a-plan' ? readPlanBoundaryArtifacts(context.consumerRoot) : null; if (!pauseBaseline) pauseBaseline = before; const expectedSession = turn.initial ? null : context.sessions[turn.session];
      if (!turn.initial && !expectedSession) fail('resume_checkpoint_missing', `${turn.id} lacks its prior native session identity`);
      let recorded = null; let turnError = null;
      try { recorded = runTurn(context, turn, expectedSession, options); } catch (error) { turnError = error; }
      const after = CORE.snapshotTree(context.consumerRoot, true); const afterBoundary = turn.id === 'turn-a-plan' ? readPlanBoundaryArtifacts(context.consumerRoot) : null; let gateFailure = null;
      if (turn.id === 'turn-a-plan') {
        try { assertPlanScope(context.consumerRoot, { tree: before, boundary: beforeBoundary }, { tree: after, boundary: afterBoundary }); }
        catch (error) {
          if (turnError) error.receipt = turnError.receipt || context.activeReceipt || null;
          throw error;
        }
      }
      if (turnError) throw turnError;
      if (turn.initial) {
        if (!recorded.native.thread_id || Object.values(context.sessions).includes(recorded.native.thread_id)) gateFailure = new RunnerFailure('session_identity_collision', `${turn.id} introduced a native identity already used by an earlier top-level process`);
        else context.sessions[turn.session] = recorded.native.thread_id;
      }
      if (!turn.initial && recorded.native.thread_id !== expectedSession) gateFailure = new RunnerFailure('resume_session_mismatch', `${turn.id} resumed the wrong native session`);
      if (context.totalUsage > TURN_TOTAL_TOKENS) gateFailure = new RunnerFailure('total_token_excess', 'native turn usage exceeded the total budget');
      const turnEvidence = { ...recorded.turn, pre_snapshot_sha256: stableHash(before), post_snapshot_sha256: stableHash(after) };
      if (turn.id === 'turn-a-pause') { turnEvidence.changed_paths = changedPaths(pauseBaseline, after); turnEvidence.allowed_root = '<CONSUMER_ROOT>/.work'; try { turnEvidence.checkpoint = CORE.liveCaptureCheckpoint(context.consumerRoot); assertPauseScope(pauseBaseline, after); } catch (error) { gateFailure = gateFailure || error; turnEvidence.checkpoint = turnEvidence.checkpoint || null; } }
      const receipt = RECORDER.deepFreeze({ ...recorded, turn: turnEvidence, characterization_only: characterizationOnly });
      writeExclusive(path.join(dir, `${turn.id}.json`), receipt); turns.push(receipt);
      if (gateFailure) fail(gateFailure.code || 'turn_gate_failed', gateFailure.message, gateFailure.evidence);
      if (turn.id === 'turn-a-plan') runCoordinatorApproval(context, { ...options, approvePlan: options.approvePlan || context.approvePlan, characterizationOnly });
    }
    if (new Set(Object.values(context.sessions)).size !== 3) fail('session_identity_invalid', 'A, B, and C native sessions must be distinct');
    const approvalSha = fileSha(path.join(dir, 'approval.json'));
    const terminal = { schema_version: 1, record_type: 'phase16_terminal_receipt', case_id: CASE_ID, turn_count: turns.length, provider_invoked: Boolean(context.spawned), characterization_only: characterizationOnly, workflow_verdict: 'not_evaluated', approval_sha256: approvalSha, terminal: { status: 'provider_complete' } };
    const terminalSha = sha(Buffer.from(`${JSON.stringify(terminal, null, 2)}\n`));
    const handoff = { schema_version: 1, record_type: 'phase16_codex_handoff', case_id: CASE_ID, sessions: context.sessions, turns: turns.map((item) => ({ id: item.turn.id, sha256: fileSha(path.join(dir, `${item.turn.id}.json`)) })), approval_sha256: approvalSha, terminal_sha256: terminalSha, characterization_only: characterizationOnly, workflow_verdict: 'not_evaluated', retained_root: '<CONSUMER_ROOT>' };
    let observer = null;
    if (!characterizationOnly && options.observe !== false) {
      try {
        observer = OBSERVER.observeAndGrade({ caseFile, freezeFile, receiptDir: dir, consumerRoot: context.consumerRoot, controlsFile: options.controls || DEFAULT_CONTROLS, python: context.python.path, pythonWitness: context.python, publicResult: options.publicResult, terminalValue: terminal, handoffValue: handoff });
      } catch (error) {
        if (options.publicResult && !exists(options.publicResult)) OBSERVER.writeExclusive(options.publicResult, OBSERVER.observerFailureProjection({ receiptDir: dir }));
        throw error;
      }
    }
    writeExclusive(path.join(dir, 'terminal.json'), terminal);
    writeExclusive(path.join(dir, 'handoff.json'), handoff);
    return { preparation: { status: 'passed', characterization_only: characterizationOnly, workflow_verdict: 'not_evaluated' }, provider_invoked: Boolean(context.spawned), characterization_only: characterizationOnly, turns, handoff, observer };
  } catch (error) {
    if (error instanceof RunnerFailure) failure = error;
    else { failure = new RunnerFailure(error.code || 'infrastructure', error.message, error.evidence || null); failure.kind = error.kind || 'infrastructure'; }
    failure.provider_invoked = Boolean(context?.spawned);
    if (current && !exists(path.join(dir, `${current.id}.json`)) && (error.receipt || context?.activeReceipt)) writeExclusive(path.join(dir, `${current.id}.json`), error.receipt || context.activeReceipt);
    const sealed = current && exists(path.join(dir, `${current.id}.json`)) ? { turn: current.id, sha256: fileSha(path.join(dir, `${current.id}.json`)) } : null;
    const terminal = { schema_version: 1, record_type: 'phase16_terminal_receipt', case_id: CASE_ID, turn_count: turns.length + (current && !turns.some((item) => item.turn === current.id) ? 1 : 0), provider_invoked: Boolean(context?.spawned), characterization_only: characterizationOnly, workflow_verdict: 'not_evaluated', approval_sha256: exists(path.join(dir, 'approval.json')) ? fileSha(path.join(dir, 'approval.json')) : null, terminal: { status: 'failed', failure_code: failure.code, message: failure.message, evidence: failure.evidence || null, sealed_turn: sealed } };
    if (!exists(path.join(dir, 'terminal.json'))) writeExclusive(path.join(dir, 'terminal.json'), terminal);
    if (!characterizationOnly && options.publicResult && !exists(options.publicResult) && !exists(path.join(dir, 'handoff.json'))) {
      OBSERVER.writeEarlyProjection(options.publicResult, { caseId: CASE_ID, revision: freeze.source?.revision || '93ae366874bbd4f69d90495c45b2cd336387496c', terminal });
    }
    throw failure;
  }
}

function catalog() {
  return {
    schema_version: 1, record_type: 'phase16_real_agent_catalog', mode: 'catalog', provider_invoked: false,
    case: { id: CASE_ID, contract: CASE_CONTRACT, repository: 'https://github.com/pallets/itsdangerous.git', revision: '93ae366874bbd4f69d90495c45b2cd336387496c', oracle: 'tests/evals/cases/itsdangerous-fips-sha1-oracle.py' },
    workflows: [...WORKFLOWS], modes: ['--catalog', '--prepare', '--check', '--freeze', '--capability', '--run'], network: { prepare: 'pinned-https-only', check: 'offline-only', freeze: 'provider-free', capability: 'native-codex-only', run: 'native-codex-only' },
    claim_limit: 'Catalog, prepare, check, and freeze are provider-free; capability claims only one native Codex read/write probe; run claims native Codex execution evidence. No provider workflow, product, benchmark, or release claim.',
  };
}

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!['--catalog', '--prepare', '--check', '--freeze', '--capability', '--run', '--case', '--cache', '--controls', '--offline', '--receipts', '--provider', '--public-result'].includes(key)) fail('unknown_flag', `unsupported option: ${key}`);
    if (['--catalog', '--prepare', '--check', '--capability', '--run', '--offline'].includes(key)) { if (flags.has(key)) fail('duplicate_flag', `duplicate option: ${key}`); flags.set(key, true); }
    else { const value = argv[++i]; if (!value || value.startsWith('--')) fail('option_value_missing', `${key} requires a value`); flags.set(key, value); }
  }
  return flags;
}

async function main(argv = process.argv.slice(2)) {
  let mode;
  try {
    const flags = parseArgs(argv);
    const modes = (flags.has('--run') || flags.has('--capability')
      ? ['--run', '--capability']
      : ['--catalog', '--prepare', '--check', '--freeze']).filter((item) => flags.has(item));
    if (modes.length !== 1) fail('usage', 'choose exactly one evaluator mode');
    mode = modes[0];
    if (mode === '--catalog') {
      if (argv.length !== 1) fail('usage', '--catalog takes no other options');
      process.stdout.write(`${JSON.stringify(catalog(), null, 2)}\n`); return 0;
    }
    if (flags.has('--public-result') && mode !== '--run') fail('unsupported_until_observer', '--public-result is only available for the complete rooted run');
    if (!flags.has('--case') || !flags.has('--cache')) fail('usage', `${mode} requires --case and --cache`);
    if (mode === '--prepare' && flags.has('--offline')) fail('usage', '--prepare cannot use --offline');
    if (mode === '--check' && !flags.has('--offline')) fail('offline_required', '--check requires --offline');
    if (mode === '--freeze' && !flags.has('--freeze')) fail('usage', '--freeze requires a destination value');
    if (mode === '--capability' && (!flags.has('--freeze') || !flags.has('--receipts'))) fail('usage', '--capability requires --freeze and --receipts');
    if (mode === '--run' && (!flags.has('--freeze') || !flags.has('--receipts'))) fail('usage', '--run requires --freeze and --receipts');
    if ((mode === '--run' || mode === '--capability') && flags.get('--provider') !== 'codex') fail('usage', `${mode} requires --provider codex`);
    const result = mode === '--prepare'
      ? await preparePublicCase(flags.get('--case'), flags.get('--cache'), { controls: flags.get('--controls') })
      : mode === '--check' ? checkPublicCase(flags.get('--case'), flags.get('--cache'), { offline: true, controls: flags.get('--controls') })
        : mode === '--freeze' ? buildFreeze(flags.get('--case'), flags.get('--cache'), flags.get('--freeze'), { controls: flags.get('--controls') })
          : mode === '--capability' ? runCapability(flags.get('--case'), flags.get('--cache'), flags.get('--freeze'), flags.get('--receipts'), { controls: flags.get('--controls') })
            : runFrozen(flags.get('--case'), flags.get('--cache'), flags.get('--freeze'), flags.get('--receipts'), { controls: flags.get('--controls'), publicResult: flags.get('--public-result') });
    process.stdout.write(`${JSON.stringify({ schema_version: 1, record_type: 'phase16_real_agent_receipt', mode: mode.slice(2), provider_invoked: mode === '--run' || mode === '--capability' ? Boolean(result?.provider_invoked) : false, network: mode === '--prepare' ? 'pinned-https-only' : mode === '--check' ? 'offline' : mode === '--run' || mode === '--capability' ? 'native-codex-only' : 'provider-free-preparation', case_id: CASE_ID, preparation: result, terminal: { status: mode === '--run' || mode === '--capability' ? 'provider_complete' : 'passed', failure_class: null, failure_code: null, message: mode === '--prepare' ? 'pinned upstream Git checkout and controls prepared' : mode === '--capability' ? 'native Codex workspace-write capability probe completed' : 'bounded Task 16-08 coordinator completed' }, workflow_verdict: 'not_evaluated', claim_limit: catalog().claim_limit }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const failure = error instanceof RunnerFailure ? error : new RunnerFailure('infrastructure', error.message);
    process.stdout.write(`${JSON.stringify({ schema_version: 1, record_type: 'phase16_real_agent_receipt', mode: mode ? mode.slice(2) : null, provider_invoked: Boolean(failure.provider_invoked), network: mode === '--prepare' ? 'pinned-https-only' : mode === '--check' ? 'offline' : mode === '--run' || mode === '--capability' ? 'native-codex-only' : null, case_id: CASE_ID, terminal: { status: 'failed', failure_class: 'infrastructure', failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, workflow_verdict: 'not_evaluated', claim_limit: catalog().claim_limit }, null, 2)}\n`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { catalog, preparePublicCase, checkPublicCase, archiveLedger, gitLedger, verifyGitRoot, assertPreparedArchiveBinding, validateControlsReceipt, removeDisposableRoot, cleanupPreparationOutputs, writeExclusive, stableHash, RunnerFailure, DEFAULT_CONTROLS, NATIVE_TOKEN_MULTIPLIER, PLAN_TOKEN_CEILING, PAUSE_TOKEN_CEILING, TURN_PLAN, TURN_TOTAL_MINUTES, TURN_TOTAL_TOKENS, RETAINED_OUTPUT_BYTES, EVALUATOR_LEDGER_CONTRACT, EVALUATOR_FILES, evaluatorFileLedger, validateEvaluatorLedger, CAPABILITY_TURN, CAPABILITY_CONTRACT, CAPABILITY_MARKER_PATH, CAPABILITY_MARKER_BYTES, CAPABILITY_MAX_MINUTES, CAPABILITY_MAX_TOKENS, APPROVAL_PLAN, APPROVAL_REF, APPROVAL_CONTRACT, buildFreeze, readFreeze, prepareRun, runTurn, runCapability, capabilityProbe: runCapability, runCoordinatorApproval, runFrozen, codexTurnArgv: RECORDER.buildCodexArgv, turnPrompt, capabilityPrompt, resolvePython, candidatePack, changedPaths };
