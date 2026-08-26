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
    shell: false,
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

function main() {
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
