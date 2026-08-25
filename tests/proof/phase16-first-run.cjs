'use strict';

// Phase 16-E: a bounded, black-box first-run proof.  This runner deliberately
// uses only the packed package entry after installation.  It inspects static
// generated workflow text; it never starts an agent or model.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const PROTECTED_RELATIVE = 'tests/proof/phase05-concurrency.cjs';
const PROTECTED_SHA256 = 'C7C1D2B928C30367987B69E1678C834DE4EAF80E0B10420E8C0C32B9E24C7239';
const WORKFLOW_GROUPS = Object.freeze({
  lifecycle: Object.freeze(['work-execute', 'work-verify', 'work-verify-work', 'work-audit-milestone', 'work-complete-milestone']),
  planning: Object.freeze(['work-new-project', 'work-new-milestone', 'work-map-codebase', 'work-plan', 'work-pause', 'work-resume', 'work-progress', 'work-quick']),
});
const WORKFLOWS = Object.freeze([...WORKFLOW_GROUPS.lifecycle, ...WORKFLOW_GROUPS.planning]);
const WORKFLOW_SOURCE = Object.freeze(Object.fromEntries(WORKFLOWS.map((id) => [id, `${id.slice('work-'.length)}.md`])));
const SOURCE_FILES = Object.freeze([
  'package.json', 'package-lock.json', 'bin/gsdd.mjs', 'bin/lib/setup.mjs',
  'bin/lib/init-flow.mjs', 'bin/lib/init-runtime.mjs', 'bin/lib/global-install.mjs',
  'bin/lib/global-manifest.mjs', 'bin/lib/health.mjs', 'bin/lib/health-truth.mjs',
  'bin/lib/runtime-freshness.mjs', 'bin/lib/manifest.mjs',
  ...fs.readdirSync(path.join(REPO, 'bin', 'lib')).filter((name) => name.endsWith('.mjs')).sort().map((name) => `bin/lib/${name}`),
  ...fs.readdirSync(path.join(REPO, 'bin', 'adapters')).filter((name) => name.endsWith('.mjs')).sort().map((name) => `bin/adapters/${name}`),
  ...fs.readdirSync(path.join(REPO, 'distilled', 'workflows')).filter((name) => name.endsWith('.md')).sort().map((name) => `distilled/workflows/${name}`),
]);
const LIMIT = 12000;
const NORMALIZATION_CONTRACT_VERSION = 'phase16.receipt-normalization.v1';
const args = process.argv.slice(2);
const SEED = args.includes('--seed') ? String(args[args.indexOf('--seed') + 1] || '') : '';

class ProofFailure extends Error {
  constructor(kind, code, message, evidence = null) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.evidence = evidence;
  }
}
const productFailure = (code, message, evidence) => { throw new ProofFailure('product', code, message, evidence); };
const infrastructureFailure = (code, message, evidence) => { throw new ProofFailure('infrastructure', code, message, evidence); };
const need = (value, kind, code, message, evidence) => { if (!value) (kind === 'product' ? productFailure : infrastructureFailure)(code, message, evidence); };
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const shaFile = (file) => sha(fs.readFileSync(file));
const slash = (value) => String(value).split(path.sep).join('/');
const exists = (file) => fs.existsSync(file);
const inside = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const clip = (value) => {
  const text = String(value || '');
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT / 2)}\n...[truncated]...\n${text.slice(-LIMIT / 2)}`;
};
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function npmCliPath() {
  const exec = fs.realpathSync(process.execPath);
  const candidate = process.platform === 'win32'
    ? path.join(path.dirname(exec), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : path.join(path.dirname(path.dirname(exec)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  need(exists(candidate), 'infrastructure', 'npm_resolution_failure', 'trusted npm-cli.js was not found', { candidate });
  need(inside(process.platform === 'win32' ? path.dirname(exec) : path.dirname(path.dirname(exec)), candidate), 'infrastructure', 'npm_resolution_failure', 'npm-cli.js escaped the Node installation', { candidate });
  return fs.realpathSync(candidate);
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { flag: 'wx' });
}

function makeNetworkGuard(file) {
  write(file, [
    "'use strict';",
    "const blocked = (kind) => { process.stderr.write('PHASE16_NETWORK_BLOCKED:' + kind + '\\n'); process.exitCode = 86; throw new Error('phase16 network blocked: ' + kind); };",
    "const net = require('node:net'); const tls = require('node:tls'); const dns = require('node:dns'); const http = require('node:http'); const https = require('node:https');",
    "for (const key of ['connect', 'createConnection']) if (typeof net[key] === 'function') net[key] = () => blocked('net.' + key);",
    "if (typeof tls.connect === 'function') tls.connect = () => blocked('tls.connect');",
    "for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) if (typeof dns[key] === 'function') dns[key] = () => blocked('dns.' + key);",
    "for (const mod of [http, https]) for (const key of ['get', 'request']) if (typeof mod[key] === 'function') mod[key] = () => blocked(mod === http ? 'http.' + key : 'https.' + key);",
    "if (typeof globalThis.fetch === 'function') globalThis.fetch = () => blocked('fetch');",
    "try { const undici = require('undici'); for (const key of ['fetch', 'request', 'connect', 'dispatch', 'stream', 'pipeline', 'upgrade']) if (typeof undici[key] === 'function') { try { undici[key] = () => blocked('undici.' + key); } catch {} } } catch {}",
  ].join('\n') + '\n');
}

function scrub(value, root, env) {
  let text = String(value || '');
  for (const [token, replacement] of [[root, '<PROOF_ROOT>'], [REPO, '<CHECKOUT>'], [env?.HOME, '<HOME>'], [env?.USERPROFILE, '<HOME>']]) {
    if (token) text = text.split(token).join(replacement);
  }
  return text.replace(/\b\d{4}-\d\d-\d\dT[^\s"']+/g, '<TIME>');
}

function run(command, argv, options) {
  const result = cp.spawnSync(command, argv, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  return {
    command: path.basename(command),
    argv: argv.map(String),
    cwd: options.cwd,
    status: result.status === null ? -1 : result.status,
    signal: result.signal || null,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    timed_out: result.error?.code === 'ETIMEDOUT',
    stdout,
    stderr,
  };
}

function commandRecord(result, root, env) {
  const stdout = scrub(result.stdout, root, env);
  const stderr = scrub(result.stderr, root, env);
  return {
    command: result.command,
    args: result.argv.map((arg) => scrub(arg, root, env)),
    cwd: scrub(result.cwd, root, env),
    status: result.status,
    signal: result.signal,
    timed_out: result.timed_out,
    error: result.error,
    stdout_sha256: sha(stdout),
    stderr_sha256: sha(stderr),
    stdout: result.status === 0 ? undefined : clip(stdout),
    stderr: result.status === 0 ? undefined : clip(stderr),
  };
}
function assertNoNetwork(result, record) {
  if (result.stderr.includes('PHASE16_NETWORK_BLOCKED') || result.stdout.includes('PHASE16_NETWORK_BLOCKED')) {
    infrastructureFailure('network_violation', 'network guard observed an attempted connection', record);
  }
}

function stableFileSha(full, relative, normalizeVolatile = false) {
  const bytes = fs.readFileSync(full);
  if (!normalizeVolatile) return sha(bytes);
  const text = bytes.toString('utf8');
  const normalizedText = text
    .replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z\b/g, '<VOLATILE_TIMESTAMP>')
    .replace(/\bevt_\d+_[a-z0-9]+\b/g, 'evt_<VOLATILE_EVENT>')
    .replace(/workspine-phase16-first-run-[^\\/"'\s]+/g, 'workspine-phase16-first-run-<PROOF_RUN>');
  if (!['generation-manifest.json', 'workspine-file-manifest.json'].includes(path.basename(relative)) && normalizedText === text) return sha(bytes);
  try {
    const parsed = JSON.parse(normalizedText);
    if (Object.hasOwn(parsed, 'generatedAt')) parsed.generatedAt = '<VOLATILE_TIMESTAMP>';
    if (['generation-manifest.json', 'workspine-file-manifest.json'].includes(path.basename(relative)) && parsed.files?.['commands/work-plan.md']) {
      parsed.files['commands/work-plan.md'] = '<VOLATILE_WORK_PLAN_COMMAND_HASH>';
    }
    return sha(JSON.stringify(parsed));
  } catch {
    return sha(normalizedText);
  }
}
function snapshotTree(root, normalizeVolatile = false) {
  const result = [];
  if (!exists(root)) return result;
  function visit(full, relative) {
    const stat = fs.lstatSync(full);
    const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    result.push({ path: slash(relative), type, bytes: type === 'file' ? stat.size : null, sha256: type === 'file' ? stableFileSha(full, relative, normalizeVolatile) : null, target: type === 'link' ? fs.readlinkSync(full) : null });
    if (type === 'directory') for (const name of fs.readdirSync(full).sort()) visit(path.join(full, name), path.join(relative, name));
  }
  visit(root, '.');
  return result;
}
function treeDigest(root) { return sha(JSON.stringify(snapshotTree(root, true))); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function normalizedReceipt(value) {
  const clone = JSON.parse(JSON.stringify(value));
  clone.run_id = '<RUN_ID>';
  delete clone.reproducibility;
  if (clone.normalization) delete clone.normalization.normalized_receipt_sha256;
  const snapshotHashKeys = new Set([
    'before_sha256',
    'after_sha256',
    'repo_before_sha256',
    'repo_after_sha256',
    'global_before_sha256',
    'global_after_sha256',
    'repo_before_setup_sha256',
    'repo_after_setup_sha256',
    'global_before_repo_setup_sha256',
    'global_after_repo_setup_sha256',
  ]);
  function replaceSnapshotHashes(node) {
    if (Array.isArray(node)) return node.map(replaceSnapshotHashes);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [
      key,
      snapshotHashKeys.has(key) ? '<RAW_SNAPSHOT_HASH>' : replaceSnapshotHashes(child),
    ]));
  }
  return replaceSnapshotHashes(clone);
}
function sealReceipt(receipt, candidateKey) {
  receipt.normalization = {
    contract_version: NORMALIZATION_CONTRACT_VERSION,
    nondeterministic_fields: [
      'run_id',
      'reproducibility',
      'records[*].snapshot.{before_sha256,after_sha256,repo_before_sha256,repo_after_sha256,global_before_sha256,global_after_sha256}',
      'initial_scope_evidence.*_before_sha256',
      'initial_scope_evidence.*_after_sha256',
      'normalized_final_repo_digest and normalized_final_global_digest use stable tree normalization',
      'normalized tree global manifests.files[commands/work-plan.md]',
    ],
    substitutions: {
      run_id: '<RUN_ID>',
      reproducibility: '<EXCLUDED_FROM_PRODUCT_HASH>',
      raw_snapshot_hashes: '<RAW_SNAPSHOT_HASH>',
      proof_temp_root_in_normalized_tree_hashes: 'workspine-phase16-first-run-<PROOF_RUN>',
      global_manifest_work_plan_command_hash: '<VOLATILE_WORK_PLAN_COMMAND_HASH>',
    },
  };
  const normalizedJson = stableStringify(normalizedReceipt(receipt));
  const normalizedHash = sha(normalizedJson);
  const sidecar = path.join(os.tmpdir(), `workspine-phase16-first-run-${SEED}-${candidateKey}.json`);
  let comparison;
  if (exists(sidecar)) {
    let previous;
    try { previous = json(sidecar); } catch (error) { infrastructureFailure('reproducibility_state_failure', 'durable reproducibility state is malformed', { sidecar, message: error.message }); }
    need(previous.candidate_key === candidateKey, 'infrastructure', 'reproducibility_state_failure', 'durable reproducibility state belongs to another candidate', previous);
    if (previous.normalized_receipt_sha256 !== normalizedHash || previous.normalized_receipt_json !== normalizedJson) {
      need(false, 'product', 'reproducibility_mismatch', 'second deterministic receipt differs from the first', { previous_hash: previous.normalized_receipt_sha256, current_hash: normalizedHash });
    }
    comparison = { status: 'passed', previous_normalized_receipt_sha256: previous.normalized_receipt_sha256, current_normalized_receipt_sha256: normalizedHash };
    fs.rmSync(sidecar, { force: true });
  } else {
    fs.writeFileSync(sidecar, JSON.stringify({ schema_version: 1, contract_version: NORMALIZATION_CONTRACT_VERSION, candidate_key: candidateKey, normalized_receipt_sha256: normalizedHash, normalized_receipt_json: normalizedJson }, null, 2), { flag: 'wx' });
    comparison = { status: 'pending_second_invocation', previous_normalized_receipt_sha256: null, current_normalized_receipt_sha256: normalizedHash };
  }
  receipt.normalization.normalized_receipt_sha256 = normalizedHash;
  receipt.reproducibility = comparison;
}

function sourceSnapshot() {
  const files = Object.fromEntries(SOURCE_FILES.map((relative) => {
    const file = path.join(REPO, ...relative.split('/'));
    need(fs.statSync(file).isFile(), 'infrastructure', 'source_input_missing', `source input is not a regular file: ${relative}`);
    return [relative, { bytes: fs.statSync(file).size, sha256: shaFile(file) }];
  }));
  const head = cp.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  need(head.status === 0 && /^[0-9a-f]{40}$/i.test(head.stdout.trim()), 'infrastructure', 'candidate_identity_failure', 'candidate HEAD could not be reconciled', { stderr: head.stderr });
  return { head: head.stdout.trim(), files };
}
function protectedSnapshot() {
  const file = path.join(REPO, ...PROTECTED_RELATIVE.split('/'));
  need(fs.lstatSync(file).isFile(), 'infrastructure', 'protected_input_failure', 'protected proof is not a regular file');
  const result = { path: PROTECTED_RELATIVE, bytes: fs.statSync(file).size, sha256: shaFile(file).toUpperCase() };
  need(result.sha256 === PROTECTED_SHA256, 'infrastructure', 'protected_input_failure', 'protected proof hash drifted', result);
  return result;
}

function isolatedEnv(root, guard) {
  const home = path.join(root, 'home');
  const temp = path.join(root, 'temp');
  const cache = path.join(root, 'npm-cache');
  const npmrc = path.join(root, 'npmrc');
  const globalrc = path.join(root, 'npm-globalrc');
  const gitconfig = path.join(root, 'gitconfig');
  for (const directory of [home, temp, cache]) fs.mkdirSync(directory, { recursive: true });
  write(npmrc, 'registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  write(globalrc, 'registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  write(gitconfig, '');
  const env = {
    ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    TEMP: temp, TMP: temp, npm_config_cache: cache, npm_config_userconfig: npmrc, npm_config_globalconfig: globalrc,
    npm_config_registry: 'http://127.0.0.1:9/', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: '0',
    WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', CI: '1', npm_config_offline: 'true', NPM_CONFIG_OFFLINE: 'true', NO_PROXY: '*', no_proxy: '*',
    HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '',
    NODE_OPTIONS: `--require=${guard}`,
  };
  for (const key of Object.keys(env)) if (/proxy/i.test(key) && key !== 'NO_PROXY' && key !== 'no_proxy') env[key] = '';
  for (const key of ['GSDD_WORKSPACE_ROOT', 'WORKSPINE_WORKSPACE_ROOT', 'WORKSPACE_ROOT', 'GSDD_STATE_DIR', 'WORKSPINE_STATE_DIR']) delete env[key];
  return env;
}

function runEntry(entry, cwd, argv, env, proofRoot, records) {
  const result = run(process.execPath, [entry, ...argv], { cwd, env });
  const record = { kind: 'command', scope: path.basename(cwd), argv, ...commandRecord(result, proofRoot, env) };
  records.push(record);
  assertNoNetwork(result, record);
  return { result, record };
}
function expectSuccess(entry, cwd, argv, env, proofRoot, records, label) {
  const response = runEntry(entry, cwd, argv, env, proofRoot, records);
  need(response.result.status === 0 && !response.result.timed_out, 'product', 'command_failed', `${label} failed`, response.record);
  return response;
}
function expectRefusal(entry, cwd, argv, env, proofRoot, records, label, signatures) {
  const response = runEntry(entry, cwd, argv, env, proofRoot, records);
  need(response.result.status !== 0 && !response.result.timed_out, 'product', 'refusal_missing', `${label} unexpectedly succeeded`, response.record);
  const output = scrub(`${response.result.stdout}\n${response.result.stderr}`, proofRoot, env);
  const crash = /(?:TypeError|ReferenceError|SyntaxError|Unhandled(?:Promise)?Rejection|node:internal|ERR_MODULE|at file:|\bat [A-Za-z]:\\)/i;
  need(!crash.test(output), 'product', 'refusal_crash_shape', `${label} produced an internal error shape`, { output: clip(output), record: response.record });
  const expected = Array.isArray(signatures) ? signatures : [signatures];
  const matched = expected.find((signature) => signature instanceof RegExp ? signature.test(output) : output.includes(String(signature)));
  need(matched, 'product', 'refusal_signature_missing', `${label} did not emit its expected bounded refusal`, { expected: expected.map(String), output: clip(output), record: response.record });
  response.record.refusal = { expected_signatures: expected.map(String), matched_signature: String(matched) };
  return response;
}

function packAndInstall(proofRoot, env, npm, sourceBefore) {
  const packDir = path.join(proofRoot, 'pack');
  const installDir = path.join(proofRoot, 'install');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  write(path.join(installDir, 'package.json'), '{"name":"phase16-consumer","private":true}\n');
  const packed = run(process.execPath, [npm, 'pack', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--pack-destination', packDir, '--json'], { cwd: REPO, env });
  const packRecord = commandRecord(packed, proofRoot, env);
  assertNoNetwork(packed, packRecord);
  need(packed.status === 0 && !packed.timed_out, 'infrastructure', 'pack_failure', 'offline npm pack failed', packRecord);
  let packJson;
  try { packJson = JSON.parse(packed.stdout); } catch (error) { infrastructureFailure('pack_output_failure', 'npm pack did not emit JSON', { message: error.message, output: clip(packed.stdout) }); }
  need(Array.isArray(packJson) && packJson.length === 1 && path.basename(packJson[0].filename) === packJson[0].filename, 'infrastructure', 'pack_identity_failure', 'npm pack did not produce one contained tarball', packJson);
  const tarball = path.join(packDir, packJson[0].filename);
  need(exists(tarball) && inside(packDir, tarball), 'infrastructure', 'pack_identity_failure', 'packed tarball is missing or escaped', { tarball });
  const installed = run(process.execPath, [npm, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-save', tarball], { cwd: installDir, env });
  const installRecord = commandRecord(installed, proofRoot, env);
  assertNoNetwork(installed, installRecord);
  need(installed.status === 0 && !installed.timed_out, 'infrastructure', 'install_failure', 'offline packed install failed', installRecord);
  const packageJson = json(path.join(REPO, 'package.json'));
  const packageRoot = path.join(installDir, 'node_modules', packageJson.name);
  const entry = path.join(packageRoot, 'bin', 'gsdd.mjs');
  need(exists(entry) && inside(installDir, entry), 'infrastructure', 'installed_entry_failure', 'installed package entry is missing or escaped', { entry });
  const installedPackage = json(path.join(packageRoot, 'package.json'));
  need(installedPackage.name === packageJson.name && installedPackage.version === packageJson.version && installedPackage.bin?.gsdd === 'bin/gsdd.mjs', 'infrastructure', 'installed_identity_failure', 'installed package identity drifted', installedPackage);
  need(shaFile(entry) === shaFile(path.join(REPO, 'bin', 'gsdd.mjs')), 'infrastructure', 'installed_entry_failure', 'installed entry differs from candidate source entry');
  const installedSourceHashes = {};
  for (const relative of SOURCE_FILES) {
    if (relative === 'package-lock.json') continue;
    const sourcePath = path.join(REPO, ...relative.split('/'));
    const installedPath = path.join(packageRoot, ...relative.split('/'));
    need(exists(installedPath) && fs.lstatSync(installedPath).isFile(), 'infrastructure', 'installed_source_missing', `packed installed source is missing: ${relative}`, { relative });
    const expected = sourceBefore.files[relative]?.sha256;
    const actual = shaFile(installedPath);
    need(expected && actual === expected, 'infrastructure', 'installed_source_mismatch', `packed installed source differs from candidate: ${relative}`, { relative, expected, actual, source_path: sourcePath });
    installedSourceHashes[relative] = actual;
  }
  return {
    packageRoot,
    entry: fs.realpathSync(entry),
    package: { name: packageJson.name, version: packageJson.version, declared_bin: packageJson.bin, package_json_sha256: shaFile(path.join(REPO, 'package.json')) },
    tarball: { filename: packJson[0].filename, sha256: shaFile(tarball), integrity: packJson[0].integrity || null },
    installed: { package_json_sha256: shaFile(path.join(packageRoot, 'package.json')), entry_sha256: shaFile(entry), source_hashes: installedSourceHashes },
  };
}

function treeHash(root) { return treeDigest(root); }
function generatedWorkflowRows(repoRoot, packageRoot) {
  return WORKFLOWS.map((id) => {
    const targetRelative = `.agents/skills/${id}/SKILL.md`;
    const target = path.join(repoRoot, ...targetRelative.split('/'));
    const packedRelative = `distilled/workflows/${WORKFLOW_SOURCE[id]}`;
    const packed = path.join(packageRoot, ...packedRelative.split('/'));
    need(fs.lstatSync(target).isFile() && inside(repoRoot, target), 'product', 'workflow_discovery_failure', `generated workflow target missing: ${id}`, { targetRelative });
    need(fs.lstatSync(packed).isFile() && inside(packageRoot, packed), 'infrastructure', 'workflow_pack_failure', `packed workflow source missing: ${id}`, { packedRelative });
    const content = fs.readFileSync(target, 'utf8');
    const packedContent = fs.readFileSync(packed, 'utf8');
    need(content.trim().length >= 160 && /[A-Za-z]{3}/.test(content), 'product', 'workflow_content_failure', `generated workflow is not substantive: ${id}`);
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const invocation = new RegExp(`(?:^|\\n)name:\\s*${escapedId}\\s*(?:\\n|$)`, 'm');
    const explicitInvocation = new RegExp(`(?:/|\\$)${escapedId}\\b`);
    need(invocation.test(content) || explicitInvocation.test(content), 'product', 'workflow_invocation_failure', `generated workflow invocation is missing: ${id}`);
    return { id, target_path: targetRelative, packed_source: packedRelative, substantive: true, invocation: invocation.test(content) ? `name: ${id}` : `/${id}`, stable_hash: sha(content), packed_source_hash: sha(packedContent) };
  });
}

function malformedAndCollision(entry, proofRoot, env, records) {
  const cases = [
    ['unknown', ['setup', '--nonsense']], ['duplicate', ['setup', '-y', '-y']],
    ['missing-value', ['setup', '--agent']], ['unexpected-positional', ['setup', 'unexpected']],
  ];
  for (const [kind, argv] of cases) {
    const root = path.join(proofRoot, `malformed-${kind}`);
    fs.mkdirSync(root, { recursive: true });
    const before = snapshotTree(root);
    const refusal = expectRefusal(entry, root, argv, env, proofRoot, records, `setup ${kind}`, {
      unknown: [/Unknown flag for `setup`/i],
      duplicate: [/Duplicate flag for `setup`/i],
      'missing-value': [/Flag --agent requires a value/i, /requires a value/i],
      'unexpected-positional': [/Malformed setup command shape/i],
    }[kind]);
    const after = snapshotTree(root);
    refusal.record.snapshot = { before_sha256: sha(JSON.stringify(before)), after_sha256: sha(JSON.stringify(after)), equal: same(before, after) };
    need(refusal.record.snapshot.equal, 'product', 'malformed_write', `malformed setup wrote bytes: ${kind}`);
  }
  const collision = path.join(proofRoot, 'collision');
  const collisionFile = path.join(collision, '.agents', 'skills', 'work-quick', 'SKILL.md');
  write(collisionFile, 'consumer-owned collision\n');
  const before = snapshotTree(collision);
  const refusal = expectRefusal(entry, collision, ['setup', '-y'], env, proofRoot, records, 'setup collision', [/collision|unmanaged|is not generation-manifest-owned|exists without a generation manifest/i]);
  const after = snapshotTree(collision);
  refusal.record.snapshot = { before_sha256: sha(JSON.stringify(before)), after_sha256: sha(JSON.stringify(after)), equal: same(before, after) };
  need(refusal.record.snapshot.equal, 'product', 'collision_write', 'collision refusal wrote bytes');
  return { malformed_cases: cases.map(([kind]) => kind), collision_refused: true };
}

// The real-agent lane is deliberately kept in this proof seam. It is an opt-in
// harness mode, not a consumer command or a provider abstraction. The scenario
// file is data-only; fixed functions below own preparation, provider invocation,
// and post-exit grading for the approved journeys.
const REAL_AGENT_SCHEMA_VERSION = 1;
const REAL_AGENT_GO_FALLBACK = path.join(REPO, '.work', 'phases', '16-safe-cohesive-first-run', '16-04-tools', 'go1.27.0', 'bin', 'go.exe');
function realAgentResolveTool(envName, candidates, fallback = null) {
  const requested = process.env[envName];
  if (requested && path.isAbsolute(requested) && exists(requested)) return { command: requested, prefix: [], source: 'explicit' };
  for (const candidate of candidates) {
    const probe = cp.spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [candidate], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const found = String(probe.stdout || '').split(/\r?\n/).map((item) => item.trim()).find((item) => item && !/WindowsApps/i.test(item));
    if (found) return { command: found, prefix: [], source: 'PATH' };
  }
  if (fallback && exists(fallback)) return { command: fallback, prefix: [], source: 'local-fallback' };
  return null;
}
function realAgentPythonTool(env = process.env) {
  const active = env.PHASE16_PYTHON;
  if (active && path.isAbsolute(active) && exists(active)) return { command: active, prefix: [], source: 'run-venv' };
  return realAgentResolveTool('WORKSPINE_EVAL_PYTHON', ['python', 'py']);
}
function realAgentGoTool() { return realAgentResolveTool('WORKSPINE_EVAL_GO', ['go'], REAL_AGENT_GO_FALLBACK); }
const REAL_AGENT_PROVIDERS = Object.freeze({
  codex: Object.freeze({ command: 'codex', model: 'gpt-5.6-luna', reasoning: 'high' }),
  claude: Object.freeze({ command: 'claude', model: 'claude-sonnet-5', reasoning: 'high' }),
  opencode: Object.freeze({ command: 'opencode', model: 'openai/gpt-5.6-luna', reasoning: 'high' }),
});
const REAL_AGENT_SCENARIOS = Object.freeze({
  'csv-quality-gate-greenfield': Object.freeze({ oracle_id: 'csv-quality-boundary', behaviors: Object.freeze(['csv_valid_result', 'csv_malformed_rejection', 'csv_alias_refusal']), flow: Object.freeze(['setup', 'health', 'new-project', 'plan', 'execute', 'verify']), artifact_family: 'project-plan-summary-verification' }),
  'update-health-quick': Object.freeze({ source_identity_sha256: '364cf8fde47d1959e4c2b193e2dd851431c7032c0083757369fcd4d3007f0c1f', oracle_id: 'p-limit-issue-22-behavior', behaviors: Object.freeze(['p_limit_issue_22', 'p_limit_notes_preserved', 'p_limit_managed_state']), flow: Object.freeze(['setup', 'health', 'update', 'quick', 'verify']), artifact_family: 'quick-change' }),
  'brownfield-plan-pause-resume': Object.freeze({ source_identity_sha256: 'd538b16f958abfea774a13d58cf5eff8c0cd34810c3c6ed48c4e2ec82f97014f', oracle_id: 'click-issue-1849-behavior', behaviors: Object.freeze(['click_issue_1849', 'click_pause_resume', 'click_candidate_scope']), flow: Object.freeze(['setup', 'health', 'brownfield-plan', 'pause', 'fresh-resume', 'execute', 'verify', 'progress']), artifact_family: 'brownfield-change-checkpoint' }),
  'h11-chunk-footer': Object.freeze({ source_identity_sha256: '6bb5cce244307db8836c81a3fcb032eed08854549590b30f8f21a1a5e91edc16', oracle_id: 'h11-chunk-footer-behavior', behaviors: Object.freeze(['h11_malformed_chunk_footer', 'h11_valid_chunk_regression']), flow: Object.freeze(['setup', 'plan', 'execute', 'verify']), artifact_family: 'plan-summary-verification' }),
  'chi-bodyless-charset': Object.freeze({ source_identity_sha256: 'f2fa17068e673b180f2de102158a896bba4eaac65316c0b9206d79384cc2ef20', oracle_id: 'chi-bodyless-charset-behavior', behaviors: Object.freeze(['chi_bodyless_charset', 'chi_bodyful_charset_regression']), flow: Object.freeze(['setup', 'quick', 'verify']), artifact_family: 'quick-change' }),
  'itsdangerous-fips-sha1': Object.freeze({ source_identity_sha256: 'd8e168860768429cf09b41ae75b7040e3748987fd3b3be1f2a509d835a3b0df9', oracle_id: 'itsdangerous-sha1-import-behavior', behaviors: Object.freeze(['itsdangerous_sha1_unavailable', 'itsdangerous_secure_default']), flow: Object.freeze(['setup', 'plan', 'execute', 'verify', 'security-review']), artifact_family: 'plan-summary-verification-security-review' }),
  'docusaurus-11122': Object.freeze({ source_identity_sha256: 'f7c31c6ece71a0a078aa9946506b270a60b1d264580040425cb7d87f7b09a139', oracle_id: 'docusaurus-11122-browser-behavior', behaviors: Object.freeze(['docusaurus_desktop_sidebar', 'docusaurus_mobile_sidebar', 'docusaurus_reload_category']), flow: Object.freeze(['setup', 'new-milestone', 'plan', 'execute', 'verify', 'audit-milestone', 'browser-proof']), artifact_family: 'milestone-plan-summary-verification-audit' }),
});
const REAL_AGENT_RUNS = Object.freeze({
  'r01-csv-codex': ['csv-quality-gate-greenfield', 'codex'], 'r02-csv-claude': ['csv-quality-gate-greenfield', 'claude'],
  'r03-update-opencode': ['update-health-quick', 'opencode'], 'r04-update-codex': ['update-health-quick', 'codex'],
  'r05-click-claude': ['brownfield-plan-pause-resume', 'claude'], 'r06-click-opencode': ['brownfield-plan-pause-resume', 'opencode'],
  'r07-h11-codex': ['h11-chunk-footer', 'codex'], 'r08-h11-claude': ['h11-chunk-footer', 'claude'],
  'r09-chi-opencode': ['chi-bodyless-charset', 'opencode'], 'r10-chi-codex': ['chi-bodyless-charset', 'codex'],
  'r11-itsdangerous-claude': ['itsdangerous-fips-sha1', 'claude'], 'r12-itsdangerous-opencode': ['itsdangerous-fips-sha1', 'opencode'],
  'r13-docusaurus-codex': ['docusaurus-11122', 'codex'], 'r14-docusaurus-claude': ['docusaurus-11122', 'claude'],
});
const REAL_AGENT_ARTIFACT_RE = /(?:^|[\\/])(?:SPEC|ROADMAP|PLAN|SUMMARY|VERIFICATION)\.md$|(?:^|[\\/])[^\\/]+-(?:PLAN|SUMMARY|VERIFICATION)\.md$/i;
const REAL_AGENT_FORBIDDEN_RE = /(?:gold(?:en)?|solution(?:[_ -]?(?:patch|code))?|secret|holdout|oracle[_ -](?:path|content|command))/i;
const REAL_AGENT_ROOT_FORBIDDEN_RE = /(?:gold(?:en)?\s+(?:answer|patch|solution)|solution[_ -]?(?:patch|code)|holdout|oracle[_ -](?:path|content|command))/i;
const REAL_AGENT_LIFECYCLE_NAMES = new Set(['SPEC.md', 'ROADMAP.md', 'PLAN.md', 'SUMMARY.md', 'VERIFICATION.md']);

function realAgentArg(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || fallback || '') : fallback;
}

function realAgentFlag(...names) { return names.some((name) => args.includes(name)); }

function readScenarioContract(file) {
  need(file && path.isAbsolute(path.resolve(file)), 'infrastructure', 'scenario_file_required', 'real-agent mode requires an explicit scenario file');
  need(exists(file), 'infrastructure', 'scenario_file_missing', 'scenario contract is missing', { file: slash(file) });
  let contract;
  try { contract = json(file); } catch (error) { infrastructureFailure('scenario_schema_invalid', 'scenario contract is not valid JSON', { file: slash(file), message: error.message }); }
  need(contract && contract.schema_version === REAL_AGENT_SCHEMA_VERSION && contract.contract === 'phase16-real-agent-scenarios.v1', 'product', 'scenario_schema_invalid', 'unsupported scenario contract version', { schema_version: contract?.schema_version, contract: contract?.contract });
  need(contract.approval_ref === '16-04A owner approval 2026-08-25', 'product', 'approval_ref_invalid', 'scenario contract approval reference is not the approved one');
  need(Array.isArray(contract.scenarios) && contract.scenarios.length === 7, 'product', 'scenario_count_invalid', 'scenario contract must contain exactly seven scenarios');
  need(Array.isArray(contract.runs) && contract.runs.length === 14, 'product', 'run_count_invalid', 'scenario contract must contain exactly fourteen run bindings');
  const scenarios = new Map();
  for (const scenario of contract.scenarios) {
    const fixed = REAL_AGENT_SCENARIOS[scenario?.id];
    need(fixed, 'product', 'scenario_id_invalid', `scenario is not one of the seven fixed journeys: ${scenario?.id}`);
    need(scenario && typeof scenario.id === 'string' && /^[a-z0-9-]+$/.test(scenario.id), 'product', 'scenario_id_invalid', 'scenario IDs must be stable lowercase identifiers');
    need(!scenarios.has(scenario.id), 'product', 'scenario_id_duplicate', `duplicate scenario ID: ${scenario.id}`);
    need(scenario.source && typeof scenario.source === 'object', 'product', 'scenario_source_missing', `scenario source missing: ${scenario.id}`);
    need(scenario.oracle_id === fixed.oracle_id, 'product', 'oracle_id_invalid', `oracle ID is not the fixed oracle for ${scenario.id}`);
    need(stableStringify(scenario.behavior_ids) === stableStringify(fixed.behaviors), 'product', 'behavior_ids_invalid', `behavior IDs are not the fixed oracle IDs for ${scenario.id}`);
    need(stableStringify(scenario.flow) === stableStringify(fixed.flow), 'product', 'scenario_flow_invalid', `flow does not match the fixed journey: ${scenario.id}`);
    need(scenario.required_artifact_family === fixed.artifact_family, 'product', 'artifact_family_invalid', `artifact family does not match the fixed journey: ${scenario.id}`);
    if (scenario.source.kind === 'pinned') {
      need(/^https:\/\//.test(scenario.source.repository || '') && /^[0-9a-f]{40}$/i.test(scenario.source.commit || ''), 'product', 'scenario_source_invalid', `pinned scenario source is not immutable: ${scenario.id}`);
      need(sha(`${scenario.source.repository}@${scenario.source.commit}`) === fixed.source_identity_sha256, 'product', 'scenario_source_invalid', `pinned scenario source is not the runner-owned baseline: ${scenario.id}`);
    } else {
      need(scenario.source.kind === 'generated' && scenario.source.name === 'empty-git-root', 'product', 'scenario_source_invalid', `unsupported generated source: ${scenario.id}`);
    }
    need(typeof scenario.public_task === 'string' && scenario.public_task.trim().length >= 20, 'product', 'scenario_task_missing', `public task missing: ${scenario.id}`);
    need(typeof scenario.public_symptom === 'string' && scenario.public_symptom.trim().length >= 10, 'product', 'scenario_symptom_missing', `public symptom missing: ${scenario.id}`);
    need(Array.isArray(scenario.flow) && scenario.flow.length >= 3 && scenario.flow.every((step) => typeof step === 'string' && step.length > 1), 'product', 'scenario_flow_invalid', `flow missing or empty: ${scenario.id}`);
    need(scenario.source.immutable === true, 'product', 'scenario_source_invalid', `scenario source must be immutable: ${scenario.id}`);
    need(Array.isArray(scenario.setup_commands) && scenario.setup_commands.length > 0 && scenario.setup_commands.every((command) => Array.isArray(command) && command.every((arg) => typeof arg === 'string')), 'product', 'scenario_setup_invalid', `setup commands missing: ${scenario.id}`);
    need(Array.isArray(scenario.public_checks) && scenario.public_checks.length > 0 && scenario.public_checks.every((check) => check && typeof check.id === 'string' && Array.isArray(check.argv)), 'product', 'scenario_public_checks_invalid', `public checks missing: ${scenario.id}`);
    need(Array.isArray(scenario.hidden_checks) && scenario.hidden_checks.length > 0 && scenario.hidden_checks.every((check) => check && typeof check.id === 'string' && typeof check.kind === 'string'), 'product', 'scenario_hidden_checks_invalid', `hidden checks missing: ${scenario.id}`);
    need(Array.isArray(scenario.allowed_change_paths) && scenario.allowed_change_paths.length > 0 && scenario.allowed_change_paths.every((item) => typeof item === 'string' && !path.isAbsolute(item)), 'product', 'scenario_allowlist_invalid', `allowed change paths missing: ${scenario.id}`);
    need(Number.isInteger(scenario.timeout_seconds) && scenario.timeout_seconds >= 60, 'product', 'scenario_timeout_invalid', `timeout missing: ${scenario.id}`);
    const roleBudgets = scenario.role_budgets_seconds;
    need(roleBudgets && ['plan_check', 'execute', 'independent_verify'].every((key) => Number.isInteger(roleBudgets[key]) && roleBudgets[key] >= 60) && roleBudgets.plan_check + roleBudgets.execute + roleBudgets.independent_verify === scenario.timeout_seconds, 'product', 'scenario_timeout_invalid', `role budgets must be positive integers that exactly partition the scenario timeout: ${scenario.id}`);
    need(typeof scenario.claim_limit === 'string' && scenario.claim_limit.length >= 20, 'product', 'scenario_claim_invalid', `claim limit missing: ${scenario.id}`);
    if (scenario.browser) {
      need(scenario.id === 'docusaurus-11122' && scenario.browser.required === true && scenario.browser.entry_route === '/tests/docs/tests/test-expansion/test-category-expansion' && scenario.browser.target_route === '/tests/docs/tests/test-expansion/menu-under-same-category' && stableStringify(scenario.browser.viewports) === '[[1280,800],[390,844]]', 'product', 'browser_contract_invalid', `browser contract invalid: ${scenario.id}`);
    }
    need(Array.isArray(scenario.behavior_ids) && scenario.behavior_ids.length === fixed.behaviors.length, 'product', 'behavior_ids_invalid', `behavior IDs missing: ${scenario.id}`);
    const serialized = JSON.stringify(scenario);
    const publicOnly = JSON.stringify({ id: scenario.id, title: scenario.title, source: scenario.source, public_task: scenario.public_task, public_symptom: scenario.public_symptom, flow: scenario.flow, required_artifact_family: scenario.required_artifact_family, setup_commands: scenario.setup_commands, public_checks: scenario.public_checks, allowed_change_paths: scenario.allowed_change_paths, preserve_paths: scenario.preserve_paths, claim_limit: scenario.claim_limit });
    need(!REAL_AGENT_FORBIDDEN_RE.test(serialized) && !REAL_AGENT_FORBIDDEN_RE.test(publicOnly), 'product', 'oracle_disclosure', `scenario contract exposes forbidden oracle material: ${scenario.id}`);
    need(!scenario.allowed_change_paths.some((item) => path.isAbsolute(item) || REAL_AGENT_FORBIDDEN_RE.test(item)), 'product', 'scenario_allowlist_invalid', `scenario allowlist exposes forbidden material: ${scenario.id}`);
    need(!scenario.setup_commands.flat().some((item) => REAL_AGENT_FORBIDDEN_RE.test(item)), 'product', 'oracle_disclosure', `scenario setup exposes forbidden oracle material: ${scenario.id}`);
    if (scenario.greenfield_input) {
      need(scenario.greenfield_input.brief_path === '.work/PROJECT_BRIEF.md' && scenario.greenfield_input.brief_source_path === 'PROJECT_BRIEF.md' && scenario.greenfield_input.brief_route === 'documented work-new-project auto route', 'product', 'greenfield_brief_invalid', 'greenfield brief route is not the documented route');
      need(Array.isArray(scenario.greenfield_input.task_inputs) && scenario.greenfield_input.task_inputs.length === 2 && scenario.greenfield_input.task_inputs.every((item) => item && typeof item.path === 'string' && typeof item.content === 'string' && !path.isAbsolute(item.path)), 'product', 'greenfield_seed_invalid', 'greenfield visible inputs must be two relative path/content fixtures');
      need(Array.isArray(scenario.greenfield_input.forbidden_seed_paths) && scenario.greenfield_input.forbidden_seed_paths.every((item) => REAL_AGENT_LIFECYCLE_NAMES.has(item)), 'product', 'preseed_contract_invalid', `greenfield seed contract is invalid: ${scenario.id}`);
    }
    scenarios.set(scenario.id, scenario);
  }
  need(stableStringify([...scenarios.keys()].sort()) === stableStringify(Object.keys(REAL_AGENT_SCENARIOS).sort()), 'product', 'scenario_matrix_invalid', 'scenario IDs are not the exact seven approved journeys');
  const runIds = new Set();
  const perScenario = new Map();
  for (const binding of contract.runs) {
    need(binding && typeof binding.run_id === 'string' && /^r\d{2}-[a-z0-9-]+$/.test(binding.run_id), 'product', 'run_id_invalid', 'run binding ID is invalid');
    const fixedRun = REAL_AGENT_RUNS[binding.run_id];
    need(fixedRun && binding.scenario_id === fixedRun[0] && binding.runtime === fixedRun[1], 'product', 'run_binding_invalid', `run binding is not one of the fourteen fixed bindings: ${binding.run_id}`);
    need(!runIds.has(binding.run_id), 'product', 'run_id_duplicate', `duplicate run ID: ${binding.run_id}`);
    need(scenarios.has(binding.scenario_id), 'product', 'run_scenario_missing', `run references unknown scenario: ${binding.scenario_id}`);
    need(REAL_AGENT_PROVIDERS[binding.runtime] && binding.runtime !== 'all', 'product', 'runtime_invalid', `unsupported runtime: ${binding.runtime}`);
    need(binding.model === REAL_AGENT_PROVIDERS[binding.runtime].model && binding.effort === REAL_AGENT_PROVIDERS[binding.runtime].reasoning, 'product', 'run_provider_invalid', `run provider pin does not match the fixed runtime: ${binding.run_id}`);
    need(Number.isInteger(binding.timeout_seconds) && binding.timeout_seconds === scenarios.get(binding.scenario_id).timeout_seconds, 'product', 'run_timeout_mismatch', `run timeout must match scenario: ${binding.run_id}`);
    runIds.add(binding.run_id);
    perScenario.set(binding.scenario_id, (perScenario.get(binding.scenario_id) || 0) + 1);
  }
  need([...scenarios.keys()].every((id) => perScenario.get(id) === 2), 'product', 'run_matrix_invalid', 'every scenario must have exactly two run bindings');
  return { contract, scenarios, runs: contract.runs, file, sha256: shaFile(file) };
}

function realAgentReceiptPath(value) {
  const file = value;
  need(file, 'infrastructure', 'receipt_required', 'real-agent mode requires an explicit --receipt path');
  need(path.isAbsolute(file), 'infrastructure', 'receipt_path_invalid', 'real-agent receipt path must be absolute', { file });
  return file;
}

function realAgentWriteReceipt(file, receipt) {
  need(!exists(file), 'infrastructure', 'receipt_exists', 'refusing to overwrite an existing real-agent receipt', { file: slash(file) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
}

function realAgentCommandAvailable(command) {
  const probe = cp.spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  return probe.status === 0 && Boolean(String(probe.stdout || '').trim());
}

function realAgentPaths(root, runtime) {
  const isolated = path.join(root, 'isolated');
  const paths = {
    temp: path.join(isolated, 'temp'),
    npm_cache: path.join(isolated, 'npm-cache'),
    npmrc: path.join(isolated, 'npmrc'),
    globalrc: path.join(isolated, 'globalrc'),
    output: path.join(isolated, 'output'),
    work_state: path.join(root, '.work'),
    context: path.join(root, 'contexts'),
    provider_state: path.join(isolated, 'provider-state'),
    plugins: path.join(isolated, 'plugins'),
    skills: path.join(isolated, 'skills'),
    python_env: path.join(isolated, 'python-env'),
  };
  for (const [key, value] of Object.entries(paths)) if (!['npmrc', 'globalrc', 'work_state'].includes(key)) fs.mkdirSync(value, { recursive: true });
  write(paths.npmrc, 'registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  write(paths.globalrc, 'registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  return paths;
}

function realAgentPreparationEnv(proofRoot) {
  const isolated = path.join(proofRoot, 'preparation');
  const temp = path.join(isolated, 'temp');
  const cache = path.join(isolated, 'npm-cache');
  const npmrc = path.join(isolated, 'npmrc');
  const globalrc = path.join(isolated, 'npm-globalrc');
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  write(npmrc, 'ignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  write(globalrc, 'ignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  const env = { ...process.env, TEMP: temp, TMP: temp, npm_config_cache: cache, npm_config_userconfig: npmrc, npm_config_globalconfig: globalrc, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', GIT_TERMINAL_PROMPT: '0', CI: '1' };
  for (const key of Object.keys(env)) if (/^(?:OPENAI|ANTHROPIC|OPENCODE|CODEX).*?(?:KEY|TOKEN|SECRET)|(?:API_KEY|AUTH_TOKEN)$/i.test(key)) delete env[key];
  return env;
}

function realAgentEnv(root, paths, runtime, baseEnv = process.env) {
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) if (baseEnv[key] !== undefined) env[key] = baseEnv[key];
  Object.assign(env, { TEMP: paths.temp, TMP: paths.temp, npm_config_cache: paths.npm_cache, npm_config_userconfig: paths.npmrc, npm_config_globalconfig: paths.globalrc, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', PHASE16_PROOF_ROOT: root, PHASE16_PLUGIN_DIR: paths.plugins, PHASE16_SKILLS_DIR: paths.skills, CI: '1' });
  if (runtime === 'opencode') {
    // OpenCode discovers OAuth in the normal owner profile, but all mutable
    // XDG/config/cache/plugin surfaces belong to this disposable run.
    env.XDG_CONFIG_HOME = path.join(paths.provider_state, 'config');
    env.XDG_STATE_HOME = path.join(paths.provider_state, 'state');
    env.XDG_CACHE_HOME = path.join(paths.provider_state, 'cache');
    env.OPENCODE_CONFIG_DIR = env.XDG_CONFIG_HOME;
    for (const value of [env.XDG_CONFIG_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME]) fs.mkdirSync(value, { recursive: true });
  } else {
    env.CODEX_OUTPUT_DIR = paths.output;
  }
  return env;
}

function realAgentAuthPreflight(runtime, env, root, binding, paths, testMode = false, dryRun = false, deadline = null) {
  const provider = REAL_AGENT_PROVIDERS[runtime];
  const denied = Object.keys(process.env).filter((key) => /(?:API_KEY|AUTH_TOKEN|SECRET|TOKEN)$/i.test(key) && !(key in env));
  const allowed = runtime === 'opencode' ? ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'] : ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'];
  const result = { runtime, command: provider.command, requested_model: provider.model, requested_reasoning: provider.reasoning, auth_source: runtime === 'opencode' ? 'owner-profile-oauth-discovery' : 'owner-profile-auth-discovery', allowed_environment_keys: allowed, denied_inherited_secret_key_names: denied, writable_roots: [root, paths?.temp, paths?.npm_cache, paths?.output, paths?.provider_state, paths?.plugins, paths?.skills, paths?.work_state], provider_available: realAgentCommandAvailable(provider.command), served_identity: null, status: 'unavailable' };
  if (dryRun) { result.status = 'not_checked_dry_run'; return result; }
  if (testMode) { result.status = 'test_mode'; result.provider_available = false; return result; }
  need(result.provider_available, 'infrastructure', 'provider_unavailable', `requested provider is not installed: ${runtime}`, result);
  const statusArgs = runtime === 'codex' ? ['login', 'status'] : runtime === 'claude' ? ['auth', 'status'] : ['auth', 'list'];
  const status = run(provider.command, statusArgs, { cwd: root, env, timeout: deadline ? Math.min(30000, realAgentRemaining(deadline, 'authentication preflight')) : 30000 });
  result.status_command = { argv: statusArgs, status: status.status, stdout_sha256: sha(status.stdout), stderr_sha256: sha(status.stderr) };
  const text = `${status.stdout}\n${status.stderr}`;
  result.authenticated = status.status === 0 && !status.error;
  need(result.authenticated, 'infrastructure', 'auth_unproven', `provider authentication could not be proven: ${runtime}`, result);
  result.status = 'passed';
  return result;
}

function realAgentRemaining(deadline, label) {
  const remaining = deadline - Date.now();
  need(remaining > 0, 'product', 'binding_deadline_exceeded', `aggregate binding deadline exceeded before ${label}`);
  return remaining;
}

function realAgentFreshRoot(proofRoot, scenario, runId, dryRun, env) {
  const root = path.join(proofRoot, 'runs', runId);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  if (scenario.source.kind === 'generated') {
    fs.mkdirSync(root, { recursive: true });
    write(path.join(root, ...scenario.greenfield_input.brief_source_path.split('/')), `${scenario.greenfield_input.brief_content}\n`);
    for (const input of scenario.greenfield_input.task_inputs) write(path.join(root, ...input.path.split('/')), input.content);
    const initialized = run('git', ['init', '--quiet'], { cwd: root, env, timeout: 30000 });
    need(initialized.status === 0, 'infrastructure', 'fresh_root_setup_failure', `git init failed for ${runId}`, { status: initialized.status, stderr: clip(initialized.stderr) });
  } else if (!dryRun) {
    fs.mkdirSync(root, { recursive: true });
    const initialized = run('git', ['init', '--quiet'], { cwd: root, env, timeout: 30000 });
    need(initialized.status === 0, 'infrastructure', 'source_clone_failure', `could not initialize pinned source for ${runId}`, { status: initialized.status, stderr: clip(initialized.stderr) });
    const remote = run('git', ['remote', 'add', 'origin', scenario.source.repository], { cwd: root, env, timeout: 30000 });
    need(remote.status === 0, 'infrastructure', 'source_clone_failure', `could not bind pinned source origin for ${runId}`, { status: remote.status, stderr: clip(remote.stderr) });
    const fetched = run('git', ['fetch', '--quiet', '--depth', '1', 'origin', scenario.source.commit], { cwd: root, env, timeout: 120000 });
    need(fetched.status === 0, 'infrastructure', 'source_clone_failure', `could not fetch the single pinned source commit for ${runId}`, { status: fetched.status, stderr: clip(fetched.stderr) });
    const checkout = run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: root, env, timeout: 120000 });
    need(checkout.status === 0, 'infrastructure', 'source_pin_failure', `could not pin source for ${runId}`, { status: checkout.status, stderr: clip(checkout.stderr) });
    const clean = run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, env, timeout: 30000 });
    need(clean.status === 0 && !String(clean.stdout || '').trim(), 'infrastructure', 'consumer_dirty', 'pinned consumer baseline is not clean before Workspine setup', { status: clean.status, stdout: clip(clean.stdout), stderr: clip(clean.stderr) });
  } else {
    fs.mkdirSync(root, { recursive: true });
    const initialized = run('git', ['init', '--quiet'], { cwd: root, env, timeout: 30000 });
    need(initialized.status === 0, 'infrastructure', 'fresh_root_setup_failure', `dry-run git init failed for ${runId}`, { status: initialized.status, stderr: clip(initialized.stderr) });
  }
  for (const relative of scenario.preserve_paths || []) {
    const target = path.join(root, ...relative.split('/'));
    if (!exists(target)) write(target, 'Owner notes: keep this file exactly as written.\nThe consumer owns these bytes.\n');
  }
  realAgentAssertNoLifecycle(root, runId);
  return root;
}

function realAgentAssertNoLifecycle(root, label) {
  const files = snapshotTree(root);
  need(!files.some((entry) => entry.type === 'file' && REAL_AGENT_ARTIFACT_RE.test(entry.path)), 'product', 'preseeded_lifecycle_artifact', `fresh root already contains lifecycle artifacts: ${label}`);
}

function realAgentSetup(root, scenario, packed, env, proofRoot, records, runtime, dryRun = false) {
  const commands = dryRun && scenario.source.kind === 'pinned'
    ? scenario.setup_commands.filter((command) => command[0] === 'workspine' && command[1] === 'setup')
    : scenario.setup_commands;
  for (const command of commands) {
    const expanded = command.map((value) => value === '$RUNTIME' ? runtime : value);
    const [name, ...rest] = expanded;
    let result;
    if (name === 'git') result = run('git', rest, { cwd: root, env, timeout: 120000 });
    else {
      const argv = name === 'workspine' ? rest : command;
      result = run(process.execPath, [packed.entry, ...argv], { cwd: root, env, timeout: 120000 });
    }
    const record = { kind: 'setup', scope: 'consumer-root', argv: expanded, ...commandRecord(result, proofRoot, env) };
    records.push(record);
    assertNoNetwork(result, record);
    need(result.status === 0 && !result.timed_out, 'product', 'scenario_setup_failed', `scenario setup command failed: ${expanded.join(' ')}`, record);
  }
  need(exists(path.join(root, '.work')), 'product', 'workspine_setup_missing', 'scenario setup did not create .work state');
  if (scenario.greenfield_input) {
    const brief = path.join(root, ...scenario.greenfield_input.brief_path.split('/'));
    need(exists(brief) && fs.readFileSync(brief, 'utf8').includes(scenario.greenfield_input.brief_content), 'product', 'greenfield_brief_missing', 'documented init --auto route did not populate .work/PROJECT_BRIEF.md');
  }
}

function realAgentPublicPrompt(scenario, role, root) {
  const roleInstructions = role === 'plan-check'
    ? 'Use the generated Workspine work-plan skill to inspect the repository and produce the approved plan/check artifacts only. Do not edit application source, tests, or implementation files.'
    : role === 'execute'
      ? `Use the generated Workspine skills for this flow (${scenario.flow.join(' -> ')}). Execute the approved change in the declared scope and record the required Workspine artifacts.`
      : 'Use the generated Workspine work-verify skill as an independent verifier. Run the declared checks and inspect the complete artifact chain. Do not edit application source, tests, or implementation files.';
  const prompt = [
    `You are the ${role} context for a bounded consumer task.`,
    `Work only in ${root}.`,
    roleInstructions,
    `Public task: ${scenario.public_task}`,
    `Observed symptom: ${scenario.public_symptom}`,
    `Required Workspine flow: ${scenario.flow.join(' -> ')}`,
    `Allowed change paths: ${scenario.allowed_change_paths.join(', ')}`,
    'Do not disclose hidden checks or modify files outside the allowed paths.',
  ].join('\n');
  realAgentAssertNoOracleExposure({ prompt, argv: [], env: {}, root, label: 'provider prompt' });
  return prompt;
}

function realAgentAssertNoOracleExposure({ prompt = '', argv = [], env = {}, root, label = 'provider input' }) {
  const values = [prompt, ...argv.map(String), ...Object.entries(env).flatMap(([key, value]) => [key, value])];
  need(!values.some((value) => REAL_AGENT_FORBIDDEN_RE.test(String(value))), 'infrastructure', 'oracle_packet_exposure', `${label} contains forbidden oracle material`);
  if (!root || !exists(root)) return;
  const rootEntries = snapshotTree(root).filter((entry) => entry.type === 'file' && entry.path !== '.' && !entry.path.startsWith('.git/') && !entry.path.startsWith('isolated/') && !entry.path.startsWith('contexts/'));
  need(rootEntries.length <= 4096, 'infrastructure', 'oracle_scan_unbounded', 'provider-readable root exceeds the bounded oracle scan', { count: rootEntries.length });
  for (const entry of rootEntries) {
    need(!REAL_AGENT_ROOT_FORBIDDEN_RE.test(entry.path), 'infrastructure', 'oracle_packet_exposure', `${label} can read a forbidden oracle path`, { path: entry.path });
    const file = path.join(root, ...entry.path.split('/'));
    if (entry.bytes > 256 * 1024) continue;
    const text = fs.readFileSync(file, 'utf8');
    need(!REAL_AGENT_ROOT_FORBIDDEN_RE.test(text), 'infrastructure', 'oracle_packet_exposure', `${label} can read forbidden oracle content`, { path: entry.path });
  }
}

function realAgentServedIdentity(runtime, result) {
  const events = String(result.stdout || '').split(/\r?\n/).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const candidates = [];
  for (const event of events) {
    if (runtime === 'claude' && event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') candidates.push(event.model);
    if (runtime === 'codex') {
      if (typeof event.model === 'string' && (event.type === 'thread.started' || event.type === 'turn.started' || event.type === 'turn.completed')) candidates.push(event.model);
      if (typeof event.model_id === 'string' && event.type === 'turn.started') candidates.push(event.model_id);
    }
    if (runtime === 'opencode') {
      if (typeof event.model === 'string' && (event.type === 'message' || event.type === 'response' || event.type === 'result')) candidates.push(event.model);
      if (typeof event.modelID === 'string' && (event.type === 'message' || event.type === 'response' || event.type === 'result')) candidates.push(event.modelID);
    }
  }
  return [...new Set(candidates)].length === 1 ? candidates[0] : null;
}

function realAgentInvocationArgv(runtime, root, prompt, role, provider) {
  return runtime === 'codex'
    ? ['exec', '--ephemeral', '--ignore-user-config', '--json', '--color', 'never', '--sandbox', role === 'execute' ? 'workspace-write' : 'read-only', ...(role === 'execute' ? ['--approve-for-me'] : []), '-m', provider.model, '-c', `model_reasoning_effort="${provider.reasoning}"`, '-C', root, prompt]
    : runtime === 'claude'
      ? ['-p', prompt, '--verbose', '--no-session-persistence', '--setting-sources', 'project', '--model', provider.model, '--effort', provider.reasoning, '--output-format', 'stream-json', '--input-format', 'text', '--permission-mode', 'dontAsk']
      : ['run', '--dir', root, '--model', provider.model, '--variant', provider.reasoning, '--format', 'json', prompt];
}

function realAgentFailureDiagnostic(result, proofRoot, env) {
  const diagnosticLimit = 2000;
  const safeStreamJsonFlag = '--output-format=stream-json';
  const safeStreamJsonPlaceholder = '§'.repeat(safeStreamJsonFlag.length);
  let text = scrub(`${result.stderr || ''}\n${result.stdout || ''}`.trim(), proofRoot, env);
  text = text.replace(/PHASE16_TEST_PROVIDER_EXIT/g, '__P16__');
  text = text
    .replace(/\bBearer\s+["']?[^"'\s,;]+["']?/gi, 'Bearer <REDACTED>')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b/g, '<REDACTED_CREDENTIAL>')
    .replace(/(["'])(authorization|api[_ -]?key|auth[_ -]?token|access[_ -]?token|secret)\1\s*:\s*(["'])[^"'\r\n]*\3/gi, '$1$2$1: $3<REDACTED>$3')
    .replace(/\b(authorization|api[_ -]?key|auth[_ -]?token|access[_ -]?token|secret)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi, '$1=<REDACTED>')
    .replace(/(^|\s)--output-format=stream-json(?=\s|$)/g, (_, prefix) => `${prefix}${safeStreamJsonPlaceholder}`)
    .replace(/[A-Za-z0-9_+/.=-]{20,}/g, '<REDACTED_OPAQUE>')
    .replace(/__P16__/g, 'PHASE16_TEST_PROVIDER_EXIT')
    .replaceAll(safeStreamJsonPlaceholder, safeStreamJsonFlag);
  if (text.length <= diagnosticLimit) return text || null;
  const marker = '\n...[truncated]...\n';
  const side = Math.floor((diagnosticLimit - marker.length) / 2);
  return `${text.slice(0, side)}${marker}${text.slice(-(diagnosticLimit - marker.length - side))}`;
}

function realAgentInvocation(runtime, root, context, role, scenario, env, timeout, testMode) {
  const provider = REAL_AGENT_PROVIDERS[runtime];
  const prompt = realAgentPublicPrompt(scenario, role, root);
  if (testMode === 'exit') return run(process.execPath, ['-e', "process.stderr.write('PHASE16_TEST_PROVIDER_EXIT\\n'); process.exit(23)"], { cwd: root, env, timeout });
  if (testMode === 'timeout') return run(process.execPath, ['-e', 'setTimeout(() => {}, 2147483647)'], { cwd: root, env, timeout: Math.min(timeout, 1000) });
  const roleEnv = { ...env, PHASE16_ROLE: role, PHASE16_CONTEXT_DIR: context };
  const argv = realAgentInvocationArgv(runtime, root, prompt, role, provider);
  realAgentAssertNoOracleExposure({ prompt, argv, env: roleEnv, root, label: `${runtime} invocation` });
  return run(provider.command, argv, { cwd: root, env: roleEnv, timeout });
}

function realAgentSeal(proofRoot, scenarioFile, scenario, binding, sourceIdentity, provider, paths) {
  const seal = { schema_version: 1, approval_ref: '16-04A owner approval 2026-08-25', stage: sourceIdentity.stage || 'sealed', head: sourceIdentity.head, consumer_head: sourceIdentity.consumer_head || null, consumer_origin: sourceIdentity.consumer_origin || null, consumer_clean: sourceIdentity.consumer_clean, consumer_history_count: sourceIdentity.consumer_history_count ?? null, packed_candidate_sha256: sourceIdentity.package_sha256, package_tarball_sha256: sourceIdentity.tarball_sha256, runner_sha256: shaFile(__filename), scenario_data_sha256: shaFile(scenarioFile), runtime: binding.runtime, runtime_help_sha256: provider.help_sha256 || null, runtime_version_sha256: provider.version_sha256 || null, scenario_id: scenario.id, run_id: binding.run_id, intended_writable_roots: [proofRoot, paths.output, paths.work_state], owner_profile_access: 'authentication-read; nonmutation not claimed', created_at: new Date().toISOString() };
  const file = path.join(proofRoot, 'seals', `${binding.run_id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(seal, null, 2)}\n`);
  return { file: slash(file), sha256: shaFile(file), ...seal };
}

function realAgentChangedFiles(before, after) {
  const old = new Map(before.map((entry) => [entry.path, entry]));
  const changed = [];
  for (const entry of after) {
    const prior = old.get(entry.path);
    if (!prior || prior.type !== entry.type || prior.sha256 !== entry.sha256 || prior.target !== entry.target) changed.push(entry.path);
    old.delete(entry.path);
  }
  changed.push(...old.keys());
  return changed.sort();
}
function realAgentVerifierImmutableArtifacts(root) {
  return snapshotTree(root).filter((entry) => entry.type === 'file' && /^(?:\.work\/(?:SPEC|ROADMAP)\.md|\.work\/phases\/.*-(?:PLAN|SUMMARY)\.md|\.work\/quick\/.*(?:LOG|SUMMARY)\.md|\.work\/brownfield-change\/(?:CHANGE|HANDOFF)\.md)$/i.test(entry.path));
}
function realAgentPathAllowed(relative, allowedPaths) {
  return allowedPaths.some((allowed) => {
    const normalized = allowed.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.includes('*')) return new RegExp(`^${normalized.split('*').map((part) => part.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*')}$`, 'i').test(relative.replace(/\\/g, '/'));
    return relative === allowed || relative.startsWith(`${normalized}/`);
  });
}

function realAgentFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const values = {};
  if (match) for (const line of match[1].split(/\r?\n/)) {
    const scalar = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (scalar) values[scalar[1]] = scalar[2].replace(/^['"]|['"]$/g, '');
  }
  return { text, values };
}

function realAgentArtifactGrade(root, scenario, lifecycle = null) {
  const workDir = path.join(root, '.work');
  const files = snapshotTree(workDir).filter((entry) => entry.type === 'file'
    && entry.path !== '.'
    && /\.md$/i.test(entry.path)
    && entry.bytes <= 1024 * 1024
    && !/^(?:templates|bin|node_modules)\//i.test(entry.path)).map((entry) => ({ ...entry, path: `.work/${entry.path}` }));
  need(files.length <= 2048, 'product', 'artifact_scan_unbounded', `bounded .work markdown scan exceeded its file limit: ${scenario.id}`);
  const byDirectory = new Map();
  for (const entry of files) {
    const directory = path.posix.dirname(entry.path);
    if (!byDirectory.has(directory)) byDirectory.set(directory, []);
    byDirectory.get(directory).push(entry);
  }
  const artifactType = (entry) => {
    const base = path.basename(entry.path).toUpperCase();
    for (const name of REAL_AGENT_LIFECYCLE_NAMES) if (base === name || base.endsWith(`-${name}`)) return name;
    return null;
  };
  const family = scenario.required_artifact_family;
  const required = [];
  if (family.includes('project')) required.push('SPEC.md', 'ROADMAP.md');
  if (family.includes('plan')) required.push('PLAN.md');
  if (family.includes('summary')) required.push('SUMMARY.md');
  if (family.includes('verification')) required.push('VERIFICATION.md');
  if (family === 'quick-change') required.push('SUMMARY.md');
  const rootRequired = family.includes('project') ? ['SPEC.md', 'ROADMAP.md'] : [];
  const chainRequired = [...new Set(required)].filter((name) => !rootRequired.includes(name));
  const entries = [...byDirectory.entries()].filter(([directory, candidates]) => {
    if (!/^\.work\/phases\/[^/]+$/i.test(directory)) return false;
    const types = new Set(candidates.map(artifactType).filter(Boolean));
    return chainRequired.every((name) => types.has(name));
  });
  const checks = rootRequired.map((name) => {
    const entry = files.find((candidate) => candidate.path === `.work/${name}`);
    if (!entry || entry.bytes < 200) return { name, present: false, files: [] };
    const { text } = realAgentFrontmatter(path.join(root, ...entry.path.split('/')));
    return { name, present: /^#\s+.+/m.test(text) && /(?:project|goal|requirement|roadmap|scope|success)/i.test(text), files: [entry.path] };
  });
  checks.push(...chainRequired.map((name) => {
    const valid = entries.flatMap(([, candidates]) => candidates.filter((entry) => artifactType(entry) === name)).filter((entry) => {
      if (entry.bytes < 200) return false;
      const { text, values } = realAgentFrontmatter(path.join(root, ...entry.path.split('/')));
      if (name === 'PLAN.md') return values.status === 'approved' && ['approved_by', 'approved_at', 'approval_ref'].every((key) => values[key]);
      if (name === 'SUMMARY.md') return /^(?:complete|completed|passed)$/i.test(values.status || '') && /(?:requirements-completed|completed|implementation|result)/i.test(text);
      if (name === 'VERIFICATION.md') return /^passed$/i.test(values.status || '') && values.runtime && values.assurance;
      return Boolean(values.status && /(?:goal|requirements?|success|scope|project)/i.test(text));
    });
    return { name, present: valid.length > 0, files: valid.map((entry) => entry.path) };
  }));
  if (family === 'quick-change') {
    const quick = files.filter((entry) => /^\.work\/quick\//i.test(entry.path));
    const log = quick.find((entry) => /(^|\/)LOG\.md$/i.test(entry.path));
    const summary = quick.find((entry) => /-SUMMARY\.md$/i.test(entry.path));
    checks.push({ name: '.work/quick/LOG.md', present: Boolean(log && /(?:done|passed|complete)/i.test(fs.readFileSync(path.join(root, ...log.path.split('/')), 'utf8'))), files: log ? [log.path] : [] });
    checks.push({ name: '.work/quick/*-SUMMARY.md', present: Boolean(summary && summary.bytes >= 200), files: summary ? [summary.path] : [] });
  }
  if (family.includes('brownfield')) {
    const change = files.find((entry) => entry.path === '.work/brownfield-change/CHANGE.md');
    const handoff = files.find((entry) => entry.path === '.work/brownfield-change/HANDOFF.md');
    const verification = files.find((entry) => entry.path === '.work/brownfield-change/VERIFICATION.md');
    checks.push({ name: '.work/brownfield-change/CHANGE.md', present: Boolean(change && change.bytes >= 200), files: change ? [change.path] : [] });
    checks.push({ name: '.work/brownfield-change/HANDOFF.md', present: Boolean(handoff && handoff.bytes >= 200), files: handoff ? [handoff.path] : [] });
    checks.push({ name: '.work/brownfield-change/VERIFICATION.md', present: Boolean(verification && verification.bytes >= 200 && /^passed$/i.test(realAgentFrontmatter(path.join(root, ...verification.path.split('/'))).values.status || '')), files: verification ? [verification.path] : [] });
  }
  if (family.includes('security-review')) {
    const verification = files.find((entry) => artifactType(entry) === 'VERIFICATION.md' && /(?:security|cryptograph|hash|sha-?1|scope)/i.test(fs.readFileSync(path.join(root, ...entry.path.split('/')), 'utf8')));
    checks.push({ name: 'security-review', present: Boolean(verification), files: verification ? [verification.path] : [] });
  }
  if (family.includes('milestone') && family.includes('audit')) {
    const audit = files.find((entry) => /^\.work\/(?:[^/]+-MILESTONE-AUDIT\.md|milestones\/[^/]+\/AUDIT\.md)$/i.test(entry.path) && entry.bytes >= 200);
    checks.push({ name: 'milestone-audit', present: Boolean(audit), files: audit ? [audit.path] : [] });
  }
  need(checks.every((check) => check.present), 'product', 'artifact_chain_missing', `required Workspine artifact chain/content/status is incomplete: ${scenario.id}`, { checks, present: files.map((entry) => entry.path) });
  const selectedPaths = new Set(checks.flatMap((check) => check.files || []));
  const substantive = files.filter((entry) => selectedPaths.has(entry.path));
  need(lifecycle && lifecycle.schema_version === 1 && lifecycle.operation === 'next' && typeof lifecycle.state === 'string' && lifecycle.state.length > 0 && typeof lifecycle.next_action !== 'undefined' && !lifecycle.error, 'product', 'lifecycle_evidence_missing', `next --json did not emit the documented lifecycle packet: ${scenario.id}`, lifecycle);
  return { status: 'passed', required: checks, lifecycle, files: substantive.map((entry) => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 })) };
}

function realAgentRunCommand(root, command, env, timeout, proofRoot, records, label) {
  const [name, ...argv] = command;
  const result = run(name === 'workspine' ? process.execPath : name, name === 'workspine' ? [path.join(root, '.work', 'bin', 'gsdd.mjs'), ...argv] : argv, { cwd: root, env, timeout });
  const record = { kind: 'oracle', scope: 'consumer-root', label, argv: command, ...commandRecord(result, proofRoot, env) };
  records.push(record);
  assertNoNetwork(result, record);
  return { result, record };
}

function realAgentBootstrap(root, scenario, env, proofRoot, records, paths) {
  let command = null;
  if (scenario.id === 'update-health-quick') command = ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (scenario.id === 'docusaurus-11122') command = ['corepack', 'yarn', 'install', '--frozen-lockfile'];
  if (scenario.id === 'chi-bodyless-charset') {
    const go = realAgentGoTool();
    need(go, 'infrastructure', 'go_runtime_unavailable', 'fixed Go runtime is unavailable');
    const modules = run(go.command, [...go.prefix, 'mod', 'download'], { cwd: root, env, timeout: 600000 });
    const record = { kind: 'bootstrap', scope: 'consumer-root', argv: ['go', 'mod', 'download'], runtime: { path: slash(go.command), source: go.source }, ...commandRecord(modules, proofRoot, env) };
    records.push(record); assertNoNetwork(modules, record);
    need(modules.status === 0 && !modules.timed_out, 'infrastructure', 'go_dependency_bootstrap_failed', 'Go module bootstrap failed', record);
    return { status: 'passed', record };
  }
  if (!command && !['brownfield-plan-pause-resume', 'h11-chunk-footer', 'itsdangerous-fips-sha1'].includes(scenario.id)) return { status: 'not_required' };
  if (!command) {
    const python = realAgentResolveTool('WORKSPINE_EVAL_PYTHON', ['python', 'py']);
    need(python, 'infrastructure', 'python_runtime_unavailable', 'fixed Python runtime is unavailable');
    const venv = run(python.command, [...python.prefix, '-m', 'venv', paths.python_env], { cwd: root, env, timeout: 180000 });
    const venvPython = path.join(paths.python_env, 'Scripts', 'python.exe');
    const venvRecord = { kind: 'bootstrap', scope: 'consumer-root', argv: ['python', '-m', 'venv', '<isolated-python-env>'], runtime: { path: slash(python.command), source: python.source }, ...commandRecord(venv, proofRoot, env) };
    records.push(venvRecord); need(venv.status === 0 && exists(venvPython), 'infrastructure', 'python_environment_bootstrap_failed', 'isolated Python environment could not be created', venvRecord);
    const deps = run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', 'pytest', '-e', '.'], { cwd: root, env, timeout: 600000 });
    const depsRecord = { kind: 'bootstrap', scope: 'consumer-root', argv: ['python', '-m', 'pip', 'install', '<scenario-dependencies>'], runtime: { path: slash(venvPython), source: 'run-venv' }, ...commandRecord(deps, proofRoot, env) };
    records.push(depsRecord); need(deps.status === 0 && !deps.timed_out, 'infrastructure', 'python_dependency_bootstrap_failed', `Python dependency bootstrap failed: ${scenario.id}`, depsRecord);
    return { status: 'passed', python: venvPython, records: [venvRecord, depsRecord] };
  }
  const [name, ...argv] = command;
  const result = run(name, argv, { cwd: root, env, timeout: Math.min(scenario.timeout_seconds * 1000, 600000) });
  const record = { kind: 'bootstrap', scope: 'consumer-root', argv: command, ...commandRecord(result, proofRoot, env) };
  records.push(record); assertNoNetwork(result, record);
  need(result.status === 0 && !result.timed_out, 'infrastructure', 'dependency_bootstrap_failed', `scenario dependency bootstrap failed: ${scenario.id}`, record);
  return { status: 'passed', record };
}

function realAgentCsvOracle(root, scenario, env, proofRoot, records) {
  const source = path.join(root, 'src', 'csv_quality.py');
  need(exists(source), 'product', 'oracle_behavior_failed', 'CSV oracle target was not created');
  const input = path.join(root, 'input.csv');
  const invalid = path.join(root, 'invalid.csv');
  const inputBefore = shaFile(input);
  const invalidBefore = shaFile(invalid);
  const fixture = Object.fromEntries(scenario.greenfield_input.task_inputs.map((item) => [item.path, item.content]));
  const expected = fixture['input.csv'].split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((cell) => cell.trim()).join(',')).join('\n') + '\n';
  const output = path.join(root, 'oracle-output.csv');
  const valid = realAgentRunCommand(root, ['python', 'src/csv_quality.py', 'input.csv', 'oracle-output.csv'], env, 120000, proofRoot, records, 'csv_valid_result');
  need(valid.result.status === 0 && exists(output), 'product', 'oracle_behavior_failed', 'CSV valid input did not produce an accepted result', valid.record);
  need(fs.readFileSync(output, 'utf8') === expected, 'product', 'oracle_behavior_failed', 'CSV valid result bytes were not the fixed normalized result');
  const malformed = path.join(root, 'oracle-malformed.csv');
  write(malformed, fixture['invalid.csv']);
  const rejected = path.join(root, 'oracle-rejected.csv');
  const bad = realAgentRunCommand(root, ['python', 'src/csv_quality.py', 'oracle-malformed.csv', 'oracle-rejected.csv'], env, 120000, proofRoot, records, 'csv_malformed_rejection');
  need(bad.result.status !== 0 && !exists(rejected), 'product', 'oracle_behavior_failed', 'CSV malformed input was accepted or wrote output', bad.record);
  const aliasBefore = shaFile(input);
  const alias = realAgentRunCommand(root, ['python', 'src/csv_quality.py', 'input.csv', 'input.csv'], env, 120000, proofRoot, records, 'csv_alias_refusal');
  need(alias.result.status !== 0 && shaFile(input) === aliasBefore, 'product', 'oracle_behavior_failed', 'CSV input/output alias was accepted or changed input', alias.record);
  need(shaFile(input) === inputBefore && shaFile(invalid) === invalidBefore, 'product', 'preserve_violation', 'CSV visible inputs were changed by the provider or oracle');
  return { status: 'passed', behavior_ids: REAL_AGENT_SCENARIOS['csv-quality-gate-greenfield'].behaviors };
}

function realAgentPLimitOracle(root, env, proofRoot, records) {
  need(exists(path.join(root, 'index.js')), 'product', 'oracle_behavior_failed', 'p-limit oracle target was not created');
  const notes = path.join(root, 'OWNER-NOTES.md');
  need(exists(notes), 'product', 'preserve_violation', 'consumer-owned OWNER-NOTES.md is missing');
  const notesBefore = shaFile(notes);
  const script = "const pLimit=require('./'); const limit=pLimit(1); let started=false; let release; const first=limit(()=>new Promise(resolve=>{started=true; release=resolve;})); const second=limit(()=>Promise.resolve()); if(started||limit.activeCount!==0||limit.pendingCount!==1) process.exit(31); Promise.resolve().then(async()=>{if(!started||limit.activeCount!==1||limit.pendingCount!==0) process.exit(32); release(); await Promise.all([first,second]); if(limit.activeCount!==0||limit.pendingCount!==0) process.exit(33);}).catch(()=>process.exit(34));";
  const result = run('node', ['-e', script], { cwd: root, env, timeout: 120000 });
  const record = { kind: 'oracle', scope: 'consumer-root', label: 'p_limit_issue_22', argv: ['node', '-e', '<fixed-oracle>'], ...commandRecord(result, proofRoot, env) };
  records.push(record);
  need(result.status === 0 && !result.timed_out, 'product', 'oracle_behavior_failed', 'p-limit issue 22 fixed oracle failed', record);
  need(shaFile(notes) === notesBefore, 'product', 'preserve_violation', 'consumer-owned OWNER-NOTES.md changed', record);
  const state = snapshotTree(path.join(root, '.work'));
  need(state.every((entry) => entry.path === '.' || !entry.path.startsWith('..')), 'product', 'state_containment', 'managed Workspine state escaped its root');
  return { status: 'passed', behavior_ids: REAL_AGENT_SCENARIOS['update-health-quick'].behaviors };
}

function realAgentPythonOracle(root, env, proofRoot, records, behaviorId, script, extraEnv = {}) {
  const python = realAgentPythonTool(env);
  need(python, 'infrastructure', 'python_runtime_unavailable', 'fixed Python runtime is unavailable');
  const result = run(python.command, [...python.prefix, '-S', '-c', script], { cwd: root, env: { ...env, PYTHONDONTWRITEBYTECODE: '1', ...extraEnv }, timeout: 180000 });
  const record = { kind: 'oracle', scope: 'consumer-root', label: behaviorId, runtime: { path: slash(python.command), source: python.source }, argv: ['python', '-S', '-c', '<fixed-oracle>'], ...commandRecord(result, proofRoot, env) };
  records.push(record);
  need(result.status === 0 && !result.timed_out, 'product', 'oracle_behavior_failed', `${behaviorId} fixed oracle failed`, record);
  return record;
}

function realAgentClickOracle(root, env, proofRoot, records) {
  const script = [
    'from click.utils import make_default_short_help',
    `cases=[('',10,''),('123 567 90',10,'123 567 90'),('123 567 9. aaaa bbb',10,'123 567 9.'),('123 567\\n\\n 9. aaaa bbb',10,'123 567'),('123 567 90123.',10,'123 567...'),('123 5678 xxxxxx',10,'123...'),('token in ~/.netrc ciao ciao',20,'token in ~/.netrc...'),('123 567 90 aaaa',10,'123 567...')]`,
    'for value,width,expected in cases:',
    '    got=make_default_short_help(value,width)',
    '    assert got==expected,(value,width,got,expected)',
    '    assert len(got)<=width,(value,width,got)',
    "for value in ('123 567 90','123 567 9. aaaa bbb'):",
    "    marked='\\n\\b\\n'+'  '.join(value.split(' '))+'\\n'",
    '    assert make_default_short_help(value,10)==make_default_short_help(marked,10)',
  ].join('\n');
  realAgentPythonOracle(root, env, proofRoot, records, 'click_issue_1849', script, { PYTHONPATH: path.join(root, 'src') });
  return { status: 'passed', behavior_ids: REAL_AGENT_SCENARIOS['brownfield-plan-pause-resume'].behaviors };
}

function realAgentH11Oracle(root, env, proofRoot, records) {
  const script = [
    'import h11',
    "bad=(b'3\\r\\nxxx__1a\\r\\n',b'3\\r\\nxxx\\r_1a\\r\\n',b'3\\r\\nxxx_\\n1a\\r\\n')",
    'for body in bad:',
    "    c=h11.Connection(h11.CLIENT); c.receive_data(b'HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n'+body)",
    "    assert isinstance(c.next_event(),h11.Response)",
    "    assert isinstance(c.next_event(),h11.Data)",
    '    try: c.next_event(); raise AssertionError(body)',
    '    except h11.RemoteProtocolError: pass',
    "c=h11.Connection(h11.CLIENT); c.receive_data(b'HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n3\\r\\nxxx\\r\\n0\\r\\n\\r\\n')",
    'assert isinstance(c.next_event(),h11.Response)',
    'assert isinstance(c.next_event(),h11.Data)',
    'assert isinstance(c.next_event(),h11.EndOfMessage)',
    'assert c.next_event() is h11.NEED_DATA',
  ].join('\n');
  realAgentPythonOracle(root, env, proofRoot, records, 'h11_malformed_chunk_footer', script, { PYTHONPATH: root });
  return { status: 'passed', behavior_ids: REAL_AGENT_SCENARIOS['h11-chunk-footer'].behaviors };
}

function realAgentChiOracle(root, env, proofRoot, records) {
  const go = realAgentGoTool();
  need(go, 'infrastructure', 'go_runtime_unavailable', 'fixed Go runtime is unavailable');
  const file = path.join(root, 'middleware', 'oracle_content_charset_test.go');
  write(file, `package middleware

import (
  "net/http"
  "net/http/httptest"
  "strings"
  "testing"
)

func TestOracleContentCharsetBodylessAndBodyful(t *testing.T) {
  next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
  handler := ContentCharset("UTF-8")(next)
  cases := []struct { name, body, contentType string; want int }{
    {"bodyless mismatched", "", "text/plain;charset=Latin-1", http.StatusNoContent},
    {"bodyless absent", "", "", http.StatusNoContent},
    {"bodyful mismatched", "x", "text/plain;charset=Latin-1", http.StatusUnsupportedMediaType},
    {"bodyful matching", "x", "text/plain;charset=UTF-8", http.StatusNoContent},
  }
  for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
      req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
      if tc.contentType != "" { req.Header.Set("Content-Type", tc.contentType) }
      if len(tc.body) == 0 && req.ContentLength != 0 { t.Fatalf("bodyless content length=%d", req.ContentLength) }
      if len(tc.body) != 0 && req.ContentLength == 0 { t.Fatalf("bodyful content length=%d", req.ContentLength) }
      res := httptest.NewRecorder(); handler.ServeHTTP(res, req)
      if res.Code != tc.want { t.Fatalf("status=%d want=%d", res.Code, tc.want) }
    })
  }
}
`);
  let result;
  try {
    result = run(go.command, [...go.prefix, 'test', './middleware', '-run', '^TestOracleContentCharsetBodylessAndBodyful$', '-count=1'], { cwd: root, env: { ...env, GOTOOLCHAIN: 'local' }, timeout: 180000 });
    const record = { kind: 'oracle', scope: 'consumer-root', label: 'chi_bodyless_charset', runtime: { path: slash(go.command), source: go.source }, argv: ['go', 'test', './middleware', '-run', '<fixed-oracle>', '-count=1'], ...commandRecord(result, proofRoot, env) };
    records.push(record);
    assertNoNetwork(result, record);
    need(result.status === 0 && !result.timed_out, 'product', 'oracle_behavior_failed', 'chi ContentCharset fixed oracle failed', record);
    return { status: 'passed', behavior_ids: REAL_AGENT_SCENARIOS['chi-bodyless-charset'].behaviors, record };
  } finally {
    try { fs.rmSync(file, { force: true }); } catch (error) { infrastructureFailure('oracle_cleanup_failure', 'chi oracle source could not be removed', { file: slash(file), message: error.message }); }
  }
}

function realAgentItsdangerousOracle(root, env, proofRoot, records) {
  const script = [
    'import hashlib,sys,types',
    'real_sha256=hashlib.sha256',
    'real_hashlib=hashlib',
    'class HashlibProxy(types.ModuleType):',
    '  def __getattribute__(self,name):',
    '    if name=="sha1": raise ValueError("FIPS: sha1 is unavailable")',
    '    return super().__getattribute__(name)',
    'proxy=HashlibProxy("hashlib")',
    'proxy.__dict__.update(real_hashlib.__dict__); proxy.__dict__.pop("sha1",None)',
    'sys.modules["hashlib"]=proxy',
    'import itsdangerous.signer as signer',
    'try: signer.Signer("secret").get_signature(b"value"); raise AssertionError("default SHA1 unexpectedly available")',
    'except ValueError: pass',
    'signature=signer.Signer("secret", digest_method=real_sha256).get_signature(b"value")',
    'assert isinstance(signature,bytes) and signature',
  ].join('\n');
  const record = realAgentPythonOracle(root, env, proofRoot, records, 'itsdangerous_sha1_unavailable', script, { PYTHONPATH: path.join(root, 'src') });
  return { status: 'passed', behavior_ids: REAL_AGENT_SCENARIOS['itsdangerous-fips-sha1'].behaviors, record };
}

function realAgentBehaviorOracle(root, scenario, env, proofRoot, records) {
  if (scenario.id === 'csv-quality-gate-greenfield') return realAgentCsvOracle(root, scenario, env, proofRoot, records);
  if (scenario.id === 'update-health-quick') return realAgentPLimitOracle(root, env, proofRoot, records);
  if (scenario.id === 'brownfield-plan-pause-resume') return realAgentClickOracle(root, env, proofRoot, records);
  if (scenario.id === 'h11-chunk-footer') return realAgentH11Oracle(root, env, proofRoot, records);
  if (scenario.id === 'chi-bodyless-charset') return realAgentChiOracle(root, env, proofRoot, records);
  if (scenario.id === 'itsdangerous-fips-sha1') return realAgentItsdangerousOracle(root, env, proofRoot, records);
  return { status: 'unavailable', code: 'oracle_unavailable', behavior_ids: scenario.behavior_ids };
}

function realAgentPublicChecks(root, scenario, env, proofRoot, records, packed, npm) {
  const results = [];
  for (const check of scenario.public_checks) {
    if (check.id === 'browser_route') continue;
    const [name, ...argv] = check.argv;
    const tool = name === 'python' ? realAgentPythonTool(env) : name === 'go' ? realAgentGoTool() : null;
    const command = name === 'workspine' ? process.execPath : name === 'npm' ? process.execPath : tool ? tool.command : name;
    const commandArgs = name === 'workspine' ? [packed.entry, ...argv] : name === 'npm' ? [npm, ...argv] : tool ? [...tool.prefix, ...argv] : argv;
    if (tool && !exists(command)) infrastructureFailure(`${name}_runtime_unavailable`, `fixed ${name} runtime is unavailable`, { path: command });
    const checkEnv = (name === 'python' && ['click_1849', 'h11_tests', 'itsdangerous_tests', 'import'].some((id) => id === check.id))
      ? { ...env, PYTHONPATH: scenario.id === 'itsdangerous-fips-sha1' ? path.join(root, 'src') : root }
      : env;
    const result = run(command, commandArgs, { cwd: root, env: checkEnv, timeout: Math.min(scenario.timeout_seconds * 1000, 300000) });
    const record = { kind: 'public-check', scope: 'consumer-root', check_id: check.id, argv: check.argv, runtime: tool ? { path: slash(command), source: tool.source } : null, ...commandRecord(result, proofRoot, env) };
    records.push(record);
    assertNoNetwork(result, record);
    need(result.status === 0 && !result.timed_out, 'product', 'public_check_failed', `public check failed: ${check.id}`, record);
    results.push({ id: check.id, status: 'passed', stdout_sha256: record.stdout_sha256, stderr_sha256: record.stderr_sha256 });
  }
  return { status: 'passed', checks: results };
}

function realAgentBrowserOracle(root, scenario, env, proofRoot, records) {
  if (!scenario.browser) return { status: 'not_required' };
  const npx = realAgentResolveTool('WORKSPINE_EVAL_NPX', ['npx']);
  need(npx, 'infrastructure', 'oracle_unavailable', 'installed npx is unavailable for the required Playwright CLI proof');
  const website = cp.spawn('corepack', ['yarn', 'workspace', 'website', 'start', '--no-open', '--port', '3001'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverOutput = ''; website.stdout.on('data', chunk => { serverOutput += chunk.toString(); }); website.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  const observations = [];
  const cli = (session, command, ...argv) => {
    const result = run(npx.command, [...npx.prefix, '--no-install', 'playwright', 'cli', `-s=${session}`, command, ...argv], { cwd: root, env, timeout: 120000 });
    const record = { kind: 'browser-oracle', scope: 'consumer-root', label: command, argv: ['npx', '--no-install', 'playwright', 'cli', `-s=${session}`, command, ...argv], ...commandRecord(result, proofRoot, env) };
    records.push(record); assertNoNetwork(result, record); need(result.status === 0 && !result.timed_out, 'product', 'oracle_behavior_failed', `Playwright CLI ${command} failed`, record); return result;
  };
  const value = (result) => { const lines = String(result.stdout || '').trim().split(/\r?\n/).reverse(); for (const line of lines) { try { return JSON.parse(line); } catch {} } return String(result.stdout || '').trim(); };
  try {
    let ready = false;
    const readyDeadline = Date.now() + 60000;
    while (Date.now() < readyDeadline && website.exitCode === null) {
      const probe = cp.spawnSync('curl.exe', ['-fsS', '-H', 'Accept: text/html', 'http://127.0.0.1:3001' + scenario.browser.entry_route], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      if (probe.status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    need(ready, 'infrastructure', 'browser_server_unavailable', 'pinned Docusaurus website did not become ready', { output: clip(serverOutput) });
    for (const [width, height] of scenario.browser.viewports) {
      const session = `phase16-${process.pid}-${width}`;
      cli(session, 'open', `http://127.0.0.1:3001${scenario.browser.entry_route}`);
      cli(session, 'resize', String(width), String(height));
      if (width < 600) cli(session, 'eval', '() => document.querySelector("button[aria-label*=navbar]")?.click()');
      cli(session, 'eval', '() => {const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Tests");if(b&&b.getAttribute("aria-expanded")==="true")b.click()}');
      cli(session, 'click', `a[href*="${scenario.browser.target_route.split('/').pop()}"]`);
      const state = value(cli(session, 'eval', '() => {const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Tests");const a=b?.getAttribute("aria-expanded");const c=[...document.querySelectorAll("a")].find(x=>x.textContent.includes("Another Menu"));return JSON.stringify({route:location.pathname,tests_aria_expanded:a,child_visible:!!c&&!!(c.offsetWidth||c.offsetHeight||c.getClientRects().length)})}'));
      cli(session, 'screenshot', '--filename', path.join('isolated', `browser-${width}.png`), '--full-page');
      const consoleErrors = value(cli(session, 'console', 'error')); const requests = value(cli(session, 'requests'));
      cli(session, 'reload');
      const reloaded = value(cli(session, 'eval', '() => JSON.stringify({route:location.pathname,tests_aria_expanded:(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Tests");return b?.getAttribute("aria-expanded")})(),child_visible:(()=>{const c=[...document.querySelectorAll("a")].find(x=>x.textContent.includes("Another Menu"));return !!c&&!!(c.offsetWidth||c.offsetHeight||c.getClientRects().length)})()})'));
      cli(session, 'close');
      const parsed = typeof state === 'string' ? JSON.parse(state) : state; const reload = typeof reloaded === 'string' ? JSON.parse(reloaded) : reloaded;
      const requestText = typeof requests === 'string' ? requests : JSON.stringify(requests);
      observations.push({ viewport: [width, height], route: parsed.route, target_route: scenario.browser.target_route, tests_aria_expanded: parsed.tests_aria_expanded, child_visible: parsed.child_visible, reload_route: reload.route, reload_tests_aria_expanded: reload.tests_aria_expanded, reload_child_visible: reload.child_visible, console_errors: consoleErrors, failed_requests: /\b(?:4\d\d|5\d\d)\b/.test(requestText) ? requestText : '', network_requests_sha256: sha(requestText), screenshot: `isolated/browser-${width}.png` });
    }
    need(observations.length === 2 && observations.every((item) => item.route === scenario.browser.target_route && item.reload_route === scenario.browser.target_route && item.tests_aria_expanded === 'true' && item.reload_tests_aria_expanded === 'true' && item.child_visible && item.reload_child_visible && !item.failed_requests), 'product', 'oracle_behavior_failed', 'Docusaurus browser observations did not satisfy the fixed route/visibility contract', { observations });
    return { status: 'passed', observations };
  } finally { if (website.exitCode === null) website.kill(); }
}

function realAgentCheck(contract) {
  const checks = [];
  const negative = [];
  const negativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-negative-'));
  try {
    write(path.join(negativeRoot, 'PLAN.md'), 'preseeded lifecycle artifact\n');
    try { realAgentAssertNoLifecycle(negativeRoot, 'check-preseed'); productFailure('negative_check_failed', 'preseeded lifecycle artifact was not rejected'); } catch (error) {
      need(error instanceof ProofFailure && error.code === 'preseeded_lifecycle_artifact', 'infrastructure', 'negative_check_failed', 'preseeded lifecycle negative check did not reject with the fixed code', { code: error.code });
      negative.push({ id: 'preseeded_lifecycle', status: 'passed', observed_code: error.code });
    }
    const scenario = contract.scenarios.get('csv-quality-gate-greenfield');
    try { realAgentPublicPrompt({ ...scenario, public_task: 'oracle path: secret holdout content' }, 'check', negativeRoot); productFailure('negative_check_failed', 'oracle material was accepted into provider prompt'); } catch (error) {
      need(error instanceof ProofFailure && error.code === 'oracle_packet_exposure', 'infrastructure', 'negative_check_failed', 'oracle visibility negative check did not reject with the fixed code', { code: error.code });
      negative.push({ id: 'oracle_visibility', status: 'passed', observed_code: error.code });
    }
    for (const [id, input] of [
      ['oracle_argv_visibility', { argv: ['--hidden', 'oracle path: secret holdout content'] }],
      ['oracle_env_visibility', { env: { PHASE16_ORACLE_CONTENT: 'secret holdout content' } }],
    ]) {
      try { realAgentAssertNoOracleExposure({ root: negativeRoot, label: id, ...input }); productFailure('negative_check_failed', `${id} was accepted`); } catch (error) {
        need(error instanceof ProofFailure && error.code === 'oracle_packet_exposure', 'infrastructure', 'negative_check_failed', `${id} did not reject with the fixed code`, { code: error.code });
        negative.push({ id, status: 'passed', observed_code: error.code });
      }
    }
    const oracleFile = path.join(negativeRoot, 'oracle-content.txt');
    write(oracleFile, 'holdout oracle content\n');
    try { realAgentAssertNoOracleExposure({ root: negativeRoot, label: 'oracle_root_visibility' }); productFailure('negative_check_failed', 'provider-readable oracle root was accepted'); } catch (error) {
      need(error instanceof ProofFailure && error.code === 'oracle_packet_exposure', 'infrastructure', 'negative_check_failed', 'provider-readable oracle root did not reject with the fixed code', { code: error.code });
      negative.push({ id: 'oracle_root_visibility', status: 'passed', observed_code: error.code });
    }
    const claudeArgv = realAgentInvocationArgv('claude', negativeRoot, 'fixed public prompt', 'plan-check', REAL_AGENT_PROVIDERS.claude);
    const streamJsonIndex = claudeArgv.indexOf('--output-format');
    need(claudeArgv[0] === '-p' && claudeArgv.includes('--verbose') && streamJsonIndex >= 0 && claudeArgv[streamJsonIndex + 1] === 'stream-json', 'infrastructure', 'negative_check_failed', 'Claude -p argv omitted --verbose or stream-json output format', { argv: claudeArgv });
    negative.push({ id: 'claude_stream_json_argv', status: 'passed', observed_code: 'verbose_stream_json' });
    const credential = 'opaqueCredentialValue1234567890';
    const quotedSecret = 'short value';
    const safeStreamJsonFlag = '--output-format=stream-json';
    const embeddedOpaque = 'abc--output-format=stream-jsonxyz';
    const diagnostic = realAgentFailureDiagnostic({ stderr: `PHASE16_TEST_PROVIDER_EXIT ${safeStreamJsonFlag} ${embeddedOpaque} Authorization: Bearer ${credential} "secret": "${quotedSecret}" ${'detail '.repeat(600)}`, stdout: '' }, negativeRoot, {});
    need(diagnostic && diagnostic.length <= 2000 && diagnostic.includes('PHASE16_TEST_PROVIDER_EXIT') && diagnostic.includes(safeStreamJsonFlag) && diagnostic.includes('...[truncated]...') && !diagnostic.includes(embeddedOpaque) && !diagnostic.includes(credential) && !diagnostic.includes(quotedSecret) && diagnostic.includes('<REDACTED>'), 'infrastructure', 'negative_check_failed', 'bounded provider diagnostic did not retain only the standalone safe CLI marker, redact embedded opaque text and credentials, and enforce its exact cap');
    negative.push({ id: 'failure_diagnostic_privacy', status: 'passed', observed_code: 'redacted_and_bounded' });
  } finally { fs.rmSync(negativeRoot, { recursive: true, force: true }); }
  for (const scenario of contract.scenarios.values()) {
    const fixed = REAL_AGENT_SCENARIOS[scenario.id];
    checks.push({ scenario_id: scenario.id, oracle_id: scenario.oracle_id, behavior_ids: scenario.behavior_ids, positive_schema: true, negative_preseeded_lifecycle: { status: 'passed', rule: 'fresh roots reject SPEC/ROADMAP/PLAN/SUMMARY/VERIFICATION before provider launch' }, negative_oracle_visibility: { status: 'passed', rule: 'public prompt and provider-readable roots contain no hidden oracle paths/content' }, fixed_flow: stableStringify(scenario.flow) === stableStringify(fixed.flow), fixed_artifact_family: scenario.required_artifact_family === fixed.artifact_family });
  }
  return { schema_version: REAL_AGENT_SCHEMA_VERSION, mode: 'real-agent', check: { status: 'passed', scenarios: checks, negative_checks: negative, scenario_count: 7, run_binding_count: 14, run_ids: contract.runs.map((binding) => binding.run_id), no_all_binding: !args.includes('--all'), package_claim: 'harness-only; no provider was invoked' }, terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'real-agent scenario contract and executable negative graders passed' } };
}

function realAgentPersistEvidence(proofRoot, receiptFile, root, receipt) {
  need(receiptFile, 'infrastructure', 'receipt_required', 'post-provider evidence requires the explicit receipt path');
  const directory = `${receiptFile}.evidence`;
  need(!exists(directory), 'infrastructure', 'evidence_exists', 'refusing to overwrite an existing post-provider evidence directory', { directory: slash(directory) });
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.mkdirSync(directory);
  const manifest = [];
  const copy = (source, relative) => {
    need(exists(source) && (inside(proofRoot, source) || inside(root, source)), 'infrastructure', 'evidence_source_invalid', 'evidence source is outside the bounded run roots', { source: slash(source) });
    const destination = path.join(directory, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, fs.readFileSync(source), { flag: 'wx' });
    manifest.push({ path: slash(relative), bytes: fs.statSync(destination).size, sha256: shaFile(destination) });
    return slash(destination);
  };
  if (receipt.seal?.file) {
    need(shaFile(path.resolve(receipt.seal.file)) === receipt.seal.sha256, 'infrastructure', 'seal_tampered', 'run seal changed after it was created');
    receipt.seal.file = copy(path.resolve(receipt.seal.file), 'seal.json');
  }
  const artifacts = receipt.graders?.workspine_artifact_chain?.files || [];
  for (const artifact of artifacts) {
    const relative = String(artifact.path || '').replace(/\\/g, '/');
    if (!/^\.work\/[A-Za-z0-9._/-]+\.md$/i.test(relative) || relative.includes('..')) continue;
    const persisted = copy(path.join(root, ...relative.split('/')), `lifecycle/${relative.slice('.work/'.length)}`);
    artifact.path = persisted;
  }
  for (const observation of receipt.graders?.browser?.observations || []) {
    if (!observation.screenshot || !/^isolated\/browser-\d+\.png$/i.test(observation.screenshot)) continue;
    const persisted = copy(path.join(root, ...observation.screenshot.split('/')), `browser/${path.basename(observation.screenshot)}`);
    observation.screenshot = persisted;
  }
  const evidenceManifest = { schema_version: 1, run_id: receipt.run_id, files: manifest };
  const manifestPath = path.join(directory, 'evidence-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(evidenceManifest, null, 2)}\n`, { flag: 'wx' });
  manifest.push({ path: 'evidence-manifest.json', bytes: fs.statSync(manifestPath).size, sha256: shaFile(manifestPath) });
  receipt.post_provider_evidence = { directory: slash(directory), manifest: slash(manifestPath), files: manifest.map((item) => item.path) };
}

function realAgentRun(contract, scenarioFile, binding, options) {
  const scenario = contract.scenarios.get(binding.scenario_id);
  const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), `workspine-phase16-real-${binding.run_id}-`));
  let receipt;
  let cleanup = { attempted: false, removed: false };
  let providerInvoked = false;
  let providerProbeInvoked = false;
  let preflight = null;
  let seal = null;
  let calls = [];
  let stage = 'preparation';
  let consumerRoot = null;
  let bindingDeadline = null;
  try {
    const npm = npmCliPath();
    const guard = path.join(proofRoot, 'network-guard.cjs');
    makeNetworkGuard(guard);
    const envBase = realAgentPreparationEnv(proofRoot);
    const root = realAgentFreshRoot(proofRoot, scenario, binding.run_id, options.dryRun, envBase);
    consumerRoot = root;
    const paths = realAgentPaths(root, binding.runtime);
    const env = realAgentEnv(root, paths, binding.runtime, envBase);
    const sourceBefore = sourceSnapshot();
    const protectedBefore = protectedSnapshot();
    const packed = packAndInstall(proofRoot, env, npm, sourceBefore);
    const sourceAfterPack = sourceSnapshot();
    const protectedAfterPack = protectedSnapshot();
    need(same(sourceBefore, sourceAfterPack) && same(protectedBefore, protectedAfterPack), 'infrastructure', 'source_mutation', 'candidate or protected source changed during real-agent pack/install');
    const records = [];
    realAgentSetup(root, scenario, packed, env, proofRoot, records, binding.runtime, options.dryRun);
    const bootstrap = options.dryRun && scenario.source.kind === 'pinned' ? {} : realAgentBootstrap(root, scenario, envBase, proofRoot, records, paths);
    if (bootstrap.python) env.PHASE16_PYTHON = bootstrap.python;
    const beforeProvider = snapshotTree(root);
    const generatedHelperBefore = shaFile(path.join(root, '.work', 'bin', 'gsdd.mjs'));
    const preserveBefore = Object.fromEntries((scenario.preserve_paths || []).map((relative) => [relative, exists(path.join(root, ...relative.split('/'))) ? shaFile(path.join(root, ...relative.split('/'))) : null]));
    const provider = { ...REAL_AGENT_PROVIDERS[binding.runtime] };
    const consumerHeadResult = run('git', ['rev-parse', 'HEAD'], { cwd: root, env, timeout: 30000 });
    const consumerHead = String(consumerHeadResult.stdout || '').trim();
    const pinnedIdentityRequired = scenario.source.kind === 'pinned' && !options.dryRun;
    if (pinnedIdentityRequired) need(consumerHead === scenario.source.commit, 'infrastructure', 'consumer_head_mismatch', 'fresh consumer is not at the declared pinned commit', { expected: scenario.source.commit, actual: consumerHead });
    const consumerOrigin = pinnedIdentityRequired ? run('git', ['remote', 'get-url', 'origin'], { cwd: root, env, timeout: 30000 }) : null;
    const consumerHistory = pinnedIdentityRequired ? run('git', ['rev-list', '--all', '--count'], { cwd: root, env, timeout: 30000 }) : null;
    if (pinnedIdentityRequired) {
      need(consumerOrigin?.status === 0 && String(consumerOrigin.stdout || '').trim() === scenario.source.repository, 'infrastructure', 'consumer_origin_mismatch', 'pinned consumer origin is not the declared immutable repository', { expected: scenario.source.repository, actual: String(consumerOrigin?.stdout || '').trim() });
      need(consumerHistory?.status === 0 && String(consumerHistory.stdout || '').trim() === '1', 'infrastructure', 'consumer_history_exposed', 'pinned consumer exposes commits beyond the declared task baseline', { count: String(consumerHistory?.stdout || '').trim() });
    }
    const identity = { head: sourceBefore.head, consumer_head: pinnedIdentityRequired ? consumerHead : null, consumer_origin: pinnedIdentityRequired ? String(consumerOrigin.stdout || '').trim() : null, consumer_clean: pinnedIdentityRequired ? true : null, consumer_history_count: pinnedIdentityRequired ? Number(String(consumerHistory.stdout || '').trim()) : null, package_sha256: packed.installed.entry_sha256, tarball_sha256: packed.tarball.sha256, stage: options.dryRun ? 'dry-run' : 'preflight' };
    stage = 'provider_preflight';
    bindingDeadline = Date.now() + binding.timeout_seconds * 1000;
    const testMode = options.providerTimeout ? 'timeout' : options.providerExit !== null ? 'exit' : null;
    providerProbeInvoked = !options.dryRun && !testMode;
    const providerHelp = options.dryRun || testMode ? { stdout: '', stderr: '', status: 0 } : run(provider.command, ['--help'], { cwd: root, env, timeout: Math.min(30000, realAgentRemaining(bindingDeadline, 'provider help preflight')) });
    const providerVersion = options.dryRun || testMode ? { stdout: '', stderr: '', status: 0 } : run(provider.command, ['--version'], { cwd: root, env, timeout: Math.min(30000, realAgentRemaining(bindingDeadline, 'provider version preflight')) });
    provider.help_sha256 = options.dryRun || testMode ? null : sha(`${providerHelp.stdout}\n${providerHelp.stderr}`);
    provider.version_sha256 = options.dryRun || testMode ? null : sha(`${providerVersion.stdout}\n${providerVersion.stderr}`);
    need(options.dryRun || (providerHelp.status === 0 && providerVersion.status === 0), 'infrastructure', 'provider_preflight_failed', 'provider help/version preflight failed', { help_status: providerHelp.status, version_status: providerVersion.status });
    preflight = realAgentAuthPreflight(binding.runtime, env, root, binding, paths, testMode, options.dryRun, bindingDeadline);
    identity.stage = options.dryRun ? 'dry-run' : 'sealed';
    seal = realAgentSeal(proofRoot, scenarioFile, scenario, binding, identity, provider, paths);
    if (options.dryRun) {
      receipt = { schema_version: 1, record_type: 'terminal_receipt', run_id: binding.run_id, scenario_id: scenario.id, mode: 'real-agent', provider_invoked: false, provider_probe_invoked: false, preflight, seal, setup: { packed: true, installed: true, fresh_root: true, setup_commands: records.filter((record) => record.kind === 'setup').length }, graders: { behavioral_oracle: 'not_run', workspine_artifact_chain: 'not_run', scope: 'not_run', source_containment: 'passed', served_identity: 'not_run', browser: scenario.browser ? 'not_run' : 'not_required' }, terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'dry-run packed, installed, and set up one fresh repo without provider invocation' }, claim_limit: 'Preparation only; no agent, model, source, workflow, browser, or product claim.' };
    } else {
      calls = [];
      for (const role of ['plan-check', 'execute', 'independent-verify']) {
        const context = path.join(paths.context, role);
        fs.mkdirSync(context, { recursive: true });
        stage = role;
        const roleBefore = snapshotTree(root);
        const verifierImmutableBefore = role === 'independent-verify' ? realAgentVerifierImmutableArtifacts(root) : null;
        const budgetKey = role === 'plan-check' ? 'plan_check' : role === 'independent-verify' ? 'independent_verify' : 'execute';
        const budget = Number(scenario.role_budgets_seconds?.[budgetKey]) || Math.floor(binding.timeout_seconds / 3);
        const roleTimeout = Math.min(budget * 1000, realAgentRemaining(bindingDeadline, `${role} role`));
        providerInvoked = !testMode;
        const result = realAgentInvocation(binding.runtime, root, context, role, scenario, env, roleTimeout, testMode);
        calls.push({ role, status: result.status, timed_out: result.timed_out, budget_seconds: budget, aggregate_deadline_at: new Date(bindingDeadline).toISOString(), stdout_sha256: sha(result.stdout), stderr_sha256: sha(result.stderr), served_identity: realAgentServedIdentity(binding.runtime, result), failure_diagnostic: result.status !== 0 || result.timed_out ? realAgentFailureDiagnostic(result, proofRoot, env) : null });
        if (role !== 'execute') {
          const roleChanges = realAgentChangedFiles(roleBefore, snapshotTree(root)).filter((entry) => !entry.startsWith('.work/') && !entry.startsWith('contexts/') && !entry.startsWith('isolated/') && !REAL_AGENT_ARTIFACT_RE.test(entry));
          need(roleChanges.length === 0, 'product', 'non_execute_scope_write', `${role} changed application or test files`, { role, paths: roleChanges });
        }
        if (role === 'independent-verify') need(same(verifierImmutableBefore, realAgentVerifierImmutableArtifacts(root)), 'product', 'verifier_rewrote_authority', 'independent verifier changed planning, execution-summary, quick-log, or brownfield authority artifacts');
        if (result.status !== 0 || result.timed_out) {
          receipt = { schema_version: 1, record_type: 'terminal_receipt', run_id: binding.run_id, scenario_id: scenario.id, mode: 'real-agent', provider_invoked: providerInvoked, provider_probe_invoked: providerProbeInvoked, preflight, seal, calls, terminal: { status: result.timed_out ? 'timeout' : 'failed', failure_class: 'provider', failure_code: result.timed_out ? 'provider_timeout' : 'provider_exit', message: result.timed_out ? 'provider exceeded the explicit run budget' : `provider exited with status ${result.status}` }, claim_limit: providerInvoked ? 'No product or workflow claim; provider execution did not complete.' : 'Synthetic provider-failure path only; no provider or product claim.' };
          break;
        }
      }
      if (!receipt) {
        need(shaFile(path.join(root, '.work', 'bin', 'gsdd.mjs')) === generatedHelperBefore, 'product', 'lifecycle_helper_mutated', 'provider changed the generated lifecycle grader helper');
        const after = snapshotTree(root);
        const changed = realAgentChangedFiles(beforeProvider, after).filter((entry) => !entry.startsWith('isolated/') && !entry.startsWith('contexts/'));
        const unsafe = changed.filter((entry) => !realAgentPathAllowed(entry, scenario.allowed_change_paths) && !REAL_AGENT_ARTIFACT_RE.test(entry));
        need(unsafe.length === 0, 'product', 'scope_violation', 'provider wrote outside the declared scenario scope', { paths: unsafe });
        for (const [relative, digest] of Object.entries(preserveBefore)) need(digest === (exists(path.join(root, ...relative.split('/'))) ? shaFile(path.join(root, ...relative.split('/'))) : null), 'product', 'preserve_violation', `provider changed preserved path: ${relative}`);
        stage = 'lifecycle';
        const lifecyclePacket = realAgentRunCommand(root, ['workspine', 'next', '--json'], env, 120000, proofRoot, records, 'lifecycle_next_json');
        let lifecycle = null; try { lifecycle = JSON.parse(lifecyclePacket.result.stdout); } catch {}
        need(lifecyclePacket.result.status === 0 && lifecycle && typeof lifecycle === 'object', 'product', 'lifecycle_evidence_missing', 'next --json did not emit a valid lifecycle packet', lifecyclePacket.record);
        const publicChecks = realAgentPublicChecks(root, scenario, env, proofRoot, records, packed, npm);
        const artifact = realAgentArtifactGrade(root, scenario, lifecycle);
        const behavior = realAgentBehaviorOracle(root, scenario, env, proofRoot, records);
        need(behavior.status === 'passed', 'product', behavior.code || 'oracle_unavailable', `behavioral oracle did not pass: ${scenario.id}`, behavior);
        const browser = realAgentBrowserOracle(root, scenario, env, proofRoot, records);
        need(browser.status === 'passed' || browser.status === 'not_required', 'product', browser.code || 'oracle_unavailable', `browser oracle did not pass: ${scenario.id}`, browser);
        const sourceAfter = sourceSnapshot();
        const protectedAfter = protectedSnapshot();
        need(same(sourceBefore, sourceAfter) && same(protectedBefore, protectedAfter), 'infrastructure', 'source_containment', 'candidate or protected source changed during provider execution');
        need(calls.every((call) => call.served_identity === provider.model), 'infrastructure', 'served_identity_unproven', 'one or more provider calls did not prove the requested served model', calls);
        receipt = { schema_version: 1, record_type: 'terminal_receipt', run_id: binding.run_id, scenario_id: scenario.id, mode: 'real-agent', provider_invoked: true, provider_probe_invoked: providerProbeInvoked, preflight, seal, calls, setup: records.filter((record) => record.kind === 'setup'), public_checks: publicChecks, graders: { behavioral_oracle: behavior, workspine_artifact_chain: artifact, scope: { status: 'passed', changed_paths: changed }, source_containment: { status: 'passed' }, served_identity: { status: 'passed', model: provider.model }, browser }, terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'provider execution and every required independent grader passed' }, claim_limit: `${scenario.claim_limit} Authenticated provider profile was read for login; profile nonmutation is not claimed. Oracle concealment covers provider prompts and the disposable consumer root, not hostile host-filesystem discovery.` };
      }
    }
  } catch (error) {
    const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'real_agent_harness_exception', error.message, { stack: error.stack });
    receipt = { schema_version: 1, record_type: 'terminal_receipt', run_id: binding.run_id, scenario_id: scenario.id, mode: 'real-agent', provider_invoked: providerInvoked, provider_probe_invoked: providerProbeInvoked, preflight, seal, calls, stage, terminal: { status: 'failed', failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, claim_limit: providerInvoked ? 'No product or workflow claim; provider execution or grading failed.' : 'No product claim: real-agent preparation terminated before provider execution.' };
  } finally {
    if (receipt && providerInvoked) {
      try { realAgentPersistEvidence(proofRoot, options.receiptFile, consumerRoot, receipt); }
      catch (error) {
        const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'evidence_persistence_failure', error.message);
        receipt.terminal = { status: 'failed', failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null };
      }
    }
    cleanup.attempted = true;
    try { fs.rmSync(proofRoot, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 }); cleanup.removed = !exists(proofRoot); } catch (error) {
      cleanup.error = error.message;
      if (receipt?.terminal?.status === 'passed') receipt.terminal = { status: 'failed', failure_class: 'infrastructure', failure_code: 'cleanup_failure', message: error.message };
    }
    if (receipt) receipt.cleanup = cleanup;
  }
  return receipt;
}

function realAgentMain() {
  let receiptFile = null;
  try {
    need(!args.includes('--offline'), 'infrastructure', 'mode_conflict', '--real-agent cannot be combined with --offline');
    need(!args.includes('--all'), 'product', 'all_runs_forbidden', 'real-agent mode accepts exactly one --run binding; --all is forbidden');
    const scenarioFile = path.resolve(realAgentArg('--scenario-file', path.join(REPO, 'tests', 'proof', 'phase16-real-agent-scenarios.json')));
    receiptFile = realAgentReceiptPath(realAgentArg('--receipt'));
    const contract = readScenarioContract(scenarioFile);
    if (realAgentFlag('--check')) {
      const receipt = realAgentCheck(contract);
      realAgentWriteReceipt(receiptFile, receipt);
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }
    const runId = realAgentArg('--run');
    need(runId && contract.runs.some((binding) => binding.run_id === runId), 'product', 'run_required', 'real-agent execution requires one explicit --run binding');
    const binding = contract.runs.find((item) => item.run_id === runId);
    const receipt = realAgentRun(contract, scenarioFile, binding, { receiptFile, dryRun: realAgentFlag('--dry-run'), providerExit: realAgentArg('--test-provider-exit', realAgentArg('--provider-exit')), providerTimeout: realAgentFlag('--test-provider-timeout', '--provider-timeout') });
    realAgentWriteReceipt(receiptFile, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.terminal.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'real_agent_argument_failure', error.message, { stack: error.stack });
    const receipt = { schema_version: 1, record_type: 'terminal_receipt', run_id: realAgentArg('--run') || null, mode: 'real-agent', provider_invoked: false, terminal: { status: 'failed', failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, claim_limit: 'No product claim: real-agent mode rejected its contract or arguments.' };
    if (receiptFile && !exists(receiptFile)) realAgentWriteReceipt(receiptFile, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function main() {
  if (realAgentFlag('--real-agent')) return realAgentMain();
  let proofRoot = null;
  let candidateKey = null;
  let cleanup = { attempted: false, removed: false };
  let receipt;
  try {
    need(args.includes('--offline'), 'infrastructure', 'offline_required', 'phase16 proof requires --offline');
    need(SEED === '1602', 'infrastructure', 'seed_required', 'phase16 proof requires --seed 1602', { seed: SEED });
    const npm = npmCliPath();
    const sourceBefore = sourceSnapshot();
    const protectedBefore = protectedSnapshot();
    const packageMeta = json(path.join(REPO, 'package.json'));
    candidateKey = sha(stableStringify({ head: sourceBefore.head, package: packageMeta.name, version: packageMeta.version, runner_sha256: shaFile(__filename) })).slice(0, 24);
    proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-first-run-'));
    const guard = path.join(proofRoot, 'network-guard.cjs');
    makeNetworkGuard(guard);
    const env = isolatedEnv(proofRoot, guard);
    const records = [];
    const packed = packAndInstall(proofRoot, env, npm, sourceBefore);
    const sourceAfterPack = sourceSnapshot();
    const protectedAfterPack = protectedSnapshot();
    need(same(sourceBefore, sourceAfterPack) && same(protectedBefore, protectedAfterPack), 'infrastructure', 'source_mutation', 'candidate or protected source changed during pack/install');
    const repoRoot = path.join(proofRoot, 'repo-scope');
    const globalCaller = path.join(proofRoot, 'global-caller');
    const globalHome = path.join(proofRoot, 'personal-agent-home');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(globalCaller, { recursive: true });
    const repoBeforeSetup = snapshotTree(repoRoot);
    const globalBeforeRepoSetup = snapshotTree(globalHome);
    const repoEnv = { ...env };
    expectSuccess(packed.entry, repoRoot, ['setup', '--yes'], repoEnv, proofRoot, records, 'project setup');
    const repoAfterSetup = snapshotTree(repoRoot);
    const globalAfterRepoSetup = snapshotTree(globalHome);
    need(!same(repoBeforeSetup, repoAfterSetup), 'product', 'setup_surface_failure', 'project setup produced no filesystem change');
    need(same(globalBeforeRepoSetup, globalAfterRepoSetup), 'product', 'cross_scope_write', 'project setup changed the personal-agent scope');
    need(exists(path.join(repoRoot, '.work', 'config.json')) && exists(path.join(repoRoot, '.agents', 'skills', 'work-quick', 'SKILL.md')), 'product', 'setup_surface_failure', 'project setup did not create the portable workspace surface');
    const workflows = generatedWorkflowRows(repoRoot, packed.packageRoot);
    const rerunBefore = snapshotTree(repoRoot);
    const rerun = expectSuccess(packed.entry, repoRoot, ['setup', '--yes'], repoEnv, proofRoot, records, 'project setup rerun');
    const rerunAfter = snapshotTree(repoRoot);
    rerun.record.snapshot = { before_sha256: sha(JSON.stringify(rerunBefore)), after_sha256: sha(JSON.stringify(rerunAfter)), equal: same(rerunBefore, rerunAfter) };
    need(rerun.record.snapshot.equal, 'product', 'setup_rerun_write', 'setup rerun changed bytes');
    const localOwned = path.join(repoRoot, '.agents', 'skills', 'work-plan', 'SKILL.md');
    const localOriginal = fs.readFileSync(localOwned);
    fs.appendFileSync(localOwned, '\nconsumer edit that update must recover\n');
    expectSuccess(packed.entry, repoRoot, ['update'], repoEnv, proofRoot, records, 'plain local update');
    need(Buffer.compare(localOriginal, fs.readFileSync(localOwned)) === 0, 'product', 'local_update_failure', 'plain local update did not recover the owned workflow');
    const localHealthBefore = snapshotTree(repoRoot);
    const localHealth = expectSuccess(packed.entry, repoRoot, ['health', '--json'], repoEnv, proofRoot, records, 'local health');
    const localHealthAfter = snapshotTree(repoRoot);
    localHealth.record.snapshot = { before_sha256: sha(JSON.stringify(localHealthBefore)), after_sha256: sha(JSON.stringify(localHealthAfter)), equal: same(localHealthBefore, localHealthAfter) };
    let localHealthPacket;
    try { localHealthPacket = JSON.parse(localHealth.result.stdout); } catch (error) { productFailure('health_output_failure', 'local health did not emit JSON', { message: error.message }); }
    need(localHealthPacket.status === 'healthy', 'product', 'health_status_failure', 'local health did not report healthy', localHealthPacket);
    need(localHealth.record.snapshot.equal, 'product', 'health_write', 'local health wrote bytes');
    const malformed = malformedAndCollision(packed.entry, proofRoot, repoEnv, records);

    const globalEnv = { ...env, GSDD_TEST_HOME: globalHome };
    const callerBeforeGlobal = snapshotTree(globalCaller);
    const globalSetup = expectSuccess(packed.entry, globalCaller, ['setup', '--global', '--all', '--yes'], globalEnv, proofRoot, records, 'global setup');
    const callerAfterGlobal = snapshotTree(globalCaller);
    globalSetup.record.snapshot = { before_sha256: sha(JSON.stringify(callerBeforeGlobal)), after_sha256: sha(JSON.stringify(callerAfterGlobal)), equal: same(callerBeforeGlobal, callerAfterGlobal) };
    need(same(callerBeforeGlobal, callerAfterGlobal), 'product', 'cross_scope_write', 'global setup changed its invoking repo');
    const globalOwned = path.join(globalHome, '.agents', 'skills', 'work-plan', 'SKILL.md');
    need(exists(globalOwned), 'product', 'global_setup_failure', 'global setup did not create shared owned skills');
    const repoBeforeGlobalUpdate = snapshotTree(repoRoot);
    const globalUpdate = expectSuccess(packed.entry, globalCaller, ['update', '--global'], globalEnv, proofRoot, records, 'plain global all-owned update');
    const repoAfterGlobalUpdate = snapshotTree(repoRoot);
    globalUpdate.record.snapshot = { before_sha256: sha(JSON.stringify(repoBeforeGlobalUpdate)), after_sha256: sha(JSON.stringify(repoAfterGlobalUpdate)), equal: same(repoBeforeGlobalUpdate, repoAfterGlobalUpdate) };
    need(globalUpdate.record.snapshot.equal, 'product', 'cross_scope_write', 'global update changed the repo scope');
    const globalOriginal = fs.readFileSync(globalOwned);
    fs.appendFileSync(globalOwned, '\nconsumer edit that global update must recover\n');
    const modifiedGlobalBefore = snapshotTree(globalHome);
    const refusal = expectRefusal(packed.entry, globalCaller, ['update', '--global'], globalEnv, proofRoot, records, 'modified global update refusal', [/modified by the user|selected set blocked/i]);
    refusal.record.snapshot = { before_sha256: sha(JSON.stringify(modifiedGlobalBefore)), after_sha256: sha(JSON.stringify(snapshotTree(globalHome))), equal: same(modifiedGlobalBefore, snapshotTree(globalHome)) };
    need(refusal.record.snapshot.equal, 'product', 'global_update_write', 'modified global update refusal wrote bytes');
    fs.writeFileSync(globalOwned, globalOriginal);
    expectSuccess(packed.entry, globalCaller, ['update', '--global'], globalEnv, proofRoot, records, 'global update after refusal');
    const globalHealthBefore = snapshotTree(globalHome);
    const globalHealth = expectSuccess(packed.entry, globalCaller, ['health', '--global', '--json'], globalEnv, proofRoot, records, 'global health');
    const globalHealthAfter = snapshotTree(globalHome);
    globalHealth.record.snapshot = { before_sha256: sha(JSON.stringify(globalHealthBefore)), after_sha256: sha(JSON.stringify(globalHealthAfter)), equal: same(globalHealthBefore, globalHealthAfter) };
    let globalHealthPacket;
    try { globalHealthPacket = JSON.parse(globalHealth.result.stdout); } catch (error) { productFailure('health_output_failure', 'global health did not emit JSON', { message: error.message }); }
    need(globalHealthPacket.status === 'healthy', 'product', 'global_health_failure', 'global health did not report healthy', globalHealthPacket);
    need(globalHealth.record.snapshot.equal, 'product', 'health_write', 'global health wrote bytes');
    const repoBeforePostGlobal = snapshotTree(repoRoot);
    const globalBeforePostRepo = snapshotTree(globalHome);
    const postGlobalHealth = expectSuccess(packed.entry, repoRoot, ['health', '--json'], repoEnv, proofRoot, records, 'post-global local health');
    const repoAfterPostGlobal = snapshotTree(repoRoot);
    const globalAfterPostRepo = snapshotTree(globalHome);
    postGlobalHealth.record.snapshot = { repo_before_sha256: sha(JSON.stringify(repoBeforePostGlobal)), repo_after_sha256: sha(JSON.stringify(repoAfterPostGlobal)), global_before_sha256: sha(JSON.stringify(globalBeforePostRepo)), global_after_sha256: sha(JSON.stringify(globalAfterPostRepo)), equal: same(repoBeforePostGlobal, repoAfterPostGlobal) && same(globalBeforePostRepo, globalAfterPostRepo) };
    need(postGlobalHealth.record.snapshot.equal, 'product', 'cross_scope_write', 'local health crossed into personal-agent scope');

    const legacy = path.join(proofRoot, 'migration');
    const legacyConfig = path.join(legacy, '.planning', 'config.json');
    write(legacyConfig, '{"initVersion":"v1.1"}\n');
    const legacyBefore = snapshotTree(legacy);
    const implicitMigration = expectRefusal(packed.entry, legacy, ['setup', '--yes'], repoEnv, proofRoot, records, 'migration refusal without explicit migrate', [/setup --migrate/i]);
    const afterImplicitMigration = snapshotTree(legacy);
    implicitMigration.record.snapshot = { before_sha256: sha(JSON.stringify(legacyBefore)), after_sha256: sha(JSON.stringify(afterImplicitMigration)), equal: same(legacyBefore, afterImplicitMigration) };
    need(implicitMigration.record.snapshot.equal, 'product', 'migration_write', 'implicit migration wrote bytes');
    const unconsentedMigration = expectRefusal(packed.entry, legacy, ['setup', '--migrate'], repoEnv, proofRoot, records, 'migration refusal without consent', [/Non-interactive setup requires -y\/--yes/i]);
    const afterUnconsentedMigration = snapshotTree(legacy);
    unconsentedMigration.record.snapshot = { before_sha256: sha(JSON.stringify(legacyBefore)), after_sha256: sha(JSON.stringify(afterUnconsentedMigration)), equal: same(legacyBefore, afterUnconsentedMigration) };
    need(unconsentedMigration.record.snapshot.equal, 'product', 'migration_write', 'migration without consent wrote bytes');
    expectSuccess(packed.entry, legacy, ['setup', '--migrate', '--yes'], repoEnv, proofRoot, records, 'consented migration');
    need(exists(path.join(legacy, '.work', 'migration-receipt.json')) && !exists(path.join(legacy, '.planning')), 'product', 'migration_failure', 'consented migration did not produce the bounded receipt');

    const sourceAfter = sourceSnapshot();
    const protectedAfter = protectedSnapshot();
    need(same(sourceBefore, sourceAfter), 'infrastructure', 'source_mutation', 'candidate source changed during packed proof');
    need(same(protectedBefore, protectedAfter), 'infrastructure', 'protected_mutation', 'protected proof changed during packed proof');
    const repoDigest = treeHash(repoRoot);
    const globalDigest = treeHash(globalHome);
    receipt = {
      schema_version: 1,
      record_type: 'terminal_receipt',
      run_id: `phase16-${SEED}-${Date.now()}-${process.pid}`,
      seed: SEED,
      mode: 'offline',
      candidate: { head: sourceBefore.head, package: packageMeta.name, version: packageMeta.version, entry_sha256: packed.installed.entry_sha256, tarball_sha256: packed.tarball.sha256 },
      package: { package_root: '<INSTALLED_PACKAGE>', entry: 'bin/gsdd.mjs', package: packed.package, tarball: packed.tarball, installed: packed.installed },
      workflows: { groups: WORKFLOW_GROUPS, rows: workflows, count: workflows.length, actual_agent_calls: 0, claim: 'generated-skill discovery/content/invocation only' },
      scenarios: { setup: true, setup_rerun_no_write: true, local_update_all_owned: true, global_update_all_owned: true, local_health_read_only: true, global_health_read_only: true, migration_refusal_and_consent: true, malformed_and_collision_refusal: malformed },
      cross_scope: { repo_unchanged_during_global: true, global_unchanged_during_repo: true, caller_repo_unchanged_during_global_setup: true },
      initial_scope_evidence: {
        repo_before_setup_sha256: sha(JSON.stringify(repoBeforeSetup)),
        repo_after_setup_sha256: sha(JSON.stringify(repoAfterSetup)),
        global_before_repo_setup_sha256: sha(JSON.stringify(globalBeforeRepoSetup)),
        global_after_repo_setup_sha256: sha(JSON.stringify(globalAfterRepoSetup)),
        repo_setup_changed_repo: !same(repoBeforeSetup, repoAfterSetup),
        repo_setup_left_global_unchanged: same(globalBeforeRepoSetup, globalAfterRepoSetup),
        normalized_final_repo_digest: repoDigest,
        normalized_final_global_digest: globalDigest,
      },
      snapshot_evidence: records.filter((record) => record.snapshot).map((record) => ({ scope: record.scope, argv: record.argv, snapshot: record.snapshot })),
      source: { before: sourceBefore, after: sourceAfter, unchanged: true },
      protected: { before: protectedBefore, after: protectedAfter, unchanged: true },
      records,
      cleanup,
      terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'bounded packed first-run proof passed' },
      claim_limit: 'Packed offline package-entry setup, generated-skill static surface, scoped update/health/refusal, source/protected integrity, and cross-scope isolation only; no actual-agent, model, network, release, or publication claim.',
    };
  } catch (error) {
    const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'harness_exception', error.message, { stack: error.stack });
    receipt = {
      schema_version: 1,
      record_type: 'terminal_receipt',
      run_id: `phase16-${SEED || 'unknown'}-${Date.now()}-${process.pid}`,
      seed: SEED || null,
      mode: args.includes('--offline') ? 'offline' : 'unknown',
      terminal: { status: 'failed', failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null },
      claim_limit: 'No product claim: the packed proof terminated before a complete receipt.',
    };
    process.exitCode = 1;
  } finally {
    if (proofRoot) {
      cleanup.attempted = true;
      try {
        const tempRoot = path.resolve(os.tmpdir());
        need(inside(tempRoot, proofRoot) && path.basename(proofRoot).startsWith('workspine-phase16-first-run-'), 'infrastructure', 'cleanup_target_failure', 'refusing cleanup outside the exact proof prefix', { proofRoot });
        fs.rmSync(proofRoot, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
        cleanup.removed = !exists(proofRoot);
      } catch (error) {
        cleanup.error = error.message;
        cleanup.removed = false;
        if (receipt?.terminal?.status === 'passed') {
          receipt.terminal = { status: 'failed', failure_class: 'infrastructure', failure_code: 'cleanup_failure', message: error.message };
          process.exitCode = 1;
        }
      }
    }
    if (receipt) {
      try {
        if (receipt.terminal?.status === 'passed') sealReceipt(receipt, candidateKey);
        else receipt.normalization = { contract_version: NORMALIZATION_CONTRACT_VERSION, nondeterministic_fields: ['run_id', 'reproducibility', 'raw snapshot hash fields listed in substitutions', 'proof temp root names inside normalized tree hashes', 'global manifest commands/work-plan.md hash'], substitutions: { run_id: '<RUN_ID>', reproducibility: '<EXCLUDED_FROM_PRODUCT_HASH>', raw_snapshot_hashes: '<RAW_SNAPSHOT_HASH>', proof_temp_root_in_normalized_tree_hashes: 'workspine-phase16-first-run-<PROOF_RUN>', global_manifest_work_plan_command_hash: '<VOLATILE_WORK_PLAN_COMMAND_HASH>' } };
      } catch (error) {
        const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'reproducibility_seal_failure', error.message);
        receipt.terminal = { status: 'failed', failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null };
        process.exitCode = 1;
      }
    }
    if (receipt) receipt.cleanup = cleanup;
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main();
