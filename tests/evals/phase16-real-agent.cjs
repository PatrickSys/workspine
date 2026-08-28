'use strict';

// Task 16-08-01: provider-free rooted preparation for the one public case.
// Archive acquisition and control execution deliberately remain in the existing
// case seam; this file adds the real Git baseline and offline bundle proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const CORE = require('./phase16-core-flows.cjs');

const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const CASE_ID = 'itsdangerous-fips-sha1';
const CASE_CONTRACT = 'phase16-public-case-v1';
const CONTROLS_CONTRACT = 'phase16-itsdangerous-controls-v1';
const BUNDLE_CONTRACT = 'phase16-public-git-bundle-v1';
const MANIFEST_CONTRACT = 'phase16-public-cache-manifest-v1';
const DEFAULT_CONTROLS = path.join(REPO, '.work', 'phases', '16-safe-cohesive-first-run', '16-08-receipts', 'controls.json');
const WORKFLOWS = Object.freeze(['plan', 'pause', 'resume', 'execute', 'verify', 'progress']);

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

function catalog() {
  return {
    schema_version: 1, record_type: 'phase16_real_agent_catalog', mode: 'catalog', provider_invoked: false,
    case: { id: CASE_ID, contract: CASE_CONTRACT, repository: 'https://github.com/pallets/itsdangerous.git', revision: '93ae366874bbd4f69d90495c45b2cd336387496c', oracle: 'tests/evals/cases/itsdangerous-fips-sha1-oracle.py' },
    workflows: [...WORKFLOWS], modes: ['--catalog', '--prepare', '--check'], network: { prepare: 'pinned-https-only', check: 'offline-only' },
    claim_limit: 'Pinned public itsdangerous case acquisition, isolated red/green/red controls, and Git cache integrity only; no provider, workflow, product, benchmark, or release claim.',
  };
}

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!['--catalog', '--prepare', '--check', '--case', '--cache', '--controls', '--offline'].includes(key)) fail('unknown_flag', `unsupported option: ${key}`);
    if (['--catalog', '--prepare', '--check', '--offline'].includes(key)) { if (flags.has(key)) fail('duplicate_flag', `duplicate option: ${key}`); flags.set(key, true); }
    else { const value = argv[++i]; if (!value || value.startsWith('--')) fail('option_value_missing', `${key} requires a value`); flags.set(key, value); }
  }
  return flags;
}

async function main(argv = process.argv.slice(2)) {
  let mode;
  try {
    const flags = parseArgs(argv);
    const modes = ['--catalog', '--prepare', '--check'].filter((item) => flags.has(item));
    if (modes.length !== 1) fail('usage', 'choose exactly one of --catalog, --prepare, or --check');
    mode = modes[0];
    if (mode === '--catalog') {
      if (argv.length !== 1) fail('usage', '--catalog takes no other options');
      process.stdout.write(`${JSON.stringify(catalog(), null, 2)}\n`); return 0;
    }
    if (!flags.has('--case') || !flags.has('--cache')) fail('usage', `${mode} requires --case and --cache`);
    if (mode === '--prepare' && flags.has('--offline')) fail('usage', '--prepare cannot use --offline');
    if (mode === '--check' && !flags.has('--offline')) fail('offline_required', '--check requires --offline');
    const result = mode === '--prepare'
      ? await preparePublicCase(flags.get('--case'), flags.get('--cache'), { controls: flags.get('--controls') })
      : checkPublicCase(flags.get('--case'), flags.get('--cache'), { offline: true, controls: flags.get('--controls') });
    process.stdout.write(`${JSON.stringify({ schema_version: 1, record_type: 'phase16_real_agent_receipt', mode: mode.slice(2), provider_invoked: false, network: mode === '--prepare' ? 'pinned-https-only' : 'offline', case_id: CASE_ID, preparation: result, terminal: { status: 'passed', failure_class: null, failure_code: null, message: mode === '--prepare' ? 'pinned upstream Git checkout and controls prepared' : result.terminal.message }, claim_limit: catalog().claim_limit }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const failure = error instanceof RunnerFailure ? error : new RunnerFailure('infrastructure', error.message);
    process.stdout.write(`${JSON.stringify({ schema_version: 1, record_type: 'phase16_real_agent_receipt', mode: mode ? mode.slice(2) : null, provider_invoked: false, network: mode === '--prepare' ? 'pinned-https-only' : mode === '--check' ? 'offline' : null, case_id: CASE_ID, terminal: { status: 'failed', failure_class: 'infrastructure', failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, claim_limit: catalog().claim_limit }, null, 2)}\n`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { catalog, preparePublicCase, checkPublicCase, archiveLedger, gitLedger, verifyGitRoot, assertPreparedArchiveBinding, validateControlsReceipt, removeDisposableRoot, cleanupPreparationOutputs, writeExclusive, stableHash, RunnerFailure, DEFAULT_CONTROLS };
