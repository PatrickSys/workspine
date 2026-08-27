// Phase 16 live evaluation owner. Provider resolution, isolation, argv, receipts, cleanup, and redaction live here.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const PROTECTED_RELATIVE = 'tests/proof/phase05-concurrency.cjs';
const PROTECTED_SHA256 = 'C7C1D2B928C30367987B69E1678C834DE4EAF80E0B10420E8C0C32B9E24C7239';
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
const args = process.argv.slice(2);

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

const NETWORK_ATTEMPT_SCHEMA = 'phase16-network-attempt-v1';
const NETWORK_ATTEMPT_MAX_BYTES = 2048;
const NETWORK_ATTEMPT_KINDS = Object.freeze(new Set([
  'net.connect', 'net.createConnection', 'tls.connect',
  'dns.lookup', 'dns.resolve', 'dns.resolve4', 'dns.resolve6', 'dns.resolveAny', 'dns.resolveCaa', 'dns.resolveCname', 'dns.resolveMx', 'dns.resolveNaptr', 'dns.resolveNs', 'dns.resolvePtr', 'dns.resolveSoa', 'dns.resolveSrv', 'dns.resolveTxt', 'dns.reverse',
  'dns.promises.lookup', 'dns.promises.resolve', 'dns.promises.resolve4', 'dns.promises.resolve6', 'dns.promises.resolveAny', 'dns.promises.resolveCaa', 'dns.promises.resolveCname', 'dns.promises.resolveMx', 'dns.promises.resolveNaptr', 'dns.promises.resolveNs', 'dns.promises.resolvePtr', 'dns.promises.resolveSoa', 'dns.promises.resolveSrv', 'dns.promises.resolveTxt', 'dns.promises.reverse',
  'http.get', 'http.request', 'https.get', 'https.request', 'fetch',
  'undici.fetch', 'undici.request', 'undici.connect', 'undici.dispatch',
  'undici.stream', 'undici.pipeline', 'undici.upgrade',
]));

function makeNetworkGuard(file, { sentinelPath, nonce, role }) {
  need(path.isAbsolute(file) && path.isAbsolute(sentinelPath), 'infrastructure', 'network_guard_path_invalid', 'network guard paths must be absolute');
  need(typeof nonce === 'string' && /^[a-f0-9]{32}$/i.test(nonce), 'infrastructure', 'network_guard_nonce_invalid', 'network guard nonce is invalid');
  need(typeof role === 'string' && role.length > 0 && role.length <= 64, 'infrastructure', 'network_guard_role_invalid', 'network guard role is invalid');
  const safeKinds = JSON.stringify([...NETWORK_ATTEMPT_KINDS]);
  write(file, [
    "'use strict';",
    "const fs = require('node:fs');",
    `const sentinelPath = ${JSON.stringify(sentinelPath)}; const nonce = ${JSON.stringify(nonce)}; const role = ${JSON.stringify(role)}; const safeKinds = new Set(${safeKinds}); const abortProcess = process.abort.bind(process);`,
    "const blocked = (kind) => { const safeKind = safeKinds.has(kind) ? kind : null; const record = safeKind ? { schema: 'phase16-network-attempt-v1', nonce, pid: process.pid, role, kind: safeKind } : null; if (record) { try { const bytes = Buffer.from(JSON.stringify(record) + '\\n'); if (bytes.length <= 2048) fs.writeFileSync(sentinelPath, bytes, { flag: 'wx' }); } catch (error) { if (error?.code !== 'EEXIST') { /* blocking remains fail-closed when the witness cannot be sealed */ } } } abortProcess(); };",
    "const net = require('node:net'); const tls = require('node:tls'); const dns = require('node:dns'); const http = require('node:http'); const https = require('node:https');",
    "for (const key of ['connect', 'createConnection']) if (typeof net[key] === 'function') net[key] = () => blocked('net.' + key);",
    "if (typeof tls.connect === 'function') tls.connect = () => blocked('tls.connect');",
    "for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) if (typeof dns[key] === 'function') dns[key] = () => blocked('dns.' + key);",
    "if (dns.promises) for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) if (typeof dns.promises[key] === 'function') dns.promises[key] = () => blocked('dns.promises.' + key);",
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
    pid: Number.isInteger(result.pid) ? result.pid : null,
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
  // Marker text is provider-authored diagnostic output. Every network
  // classification must come from a current-operation guard sentinel.
}

function readNetworkAttemptSentinel(file, { nonce, role, pid, runDirectory, operationDirectory }) {
  if (!exists(file)) return null;
  need(path.isAbsolute(file), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel path must be absolute');
  need(path.isAbsolute(runDirectory) && path.isAbsolute(operationDirectory), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel directories must be absolute');
  need(inside(runDirectory, operationDirectory) && inside(operationDirectory, file), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel escaped its run or operation directory');
  let runStat; let operationStat; let runReal; let operationReal; let fileReal;
  try {
    runStat = fs.lstatSync(runDirectory); operationStat = fs.lstatSync(operationDirectory);
    runReal = fs.realpathSync(runDirectory); operationReal = fs.realpathSync(operationDirectory); fileReal = fs.realpathSync(file);
  } catch (error) { infrastructureFailure('network_guard_sentinel_invalid', 'network sentinel containment could not be resolved', { message: error.message }); }
  need(runStat.isDirectory() && !runStat.isSymbolicLink() && operationStat.isDirectory() && !operationStat.isSymbolicLink(), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel directories must be regular directories');
  need(inside(runReal, operationReal) && inside(operationReal, fileReal), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel reparse path escaped its run or operation directory');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { infrastructureFailure('network_guard_sentinel_invalid', 'network sentinel could not be inspected', { message: error.message }); }
  need(stat.isFile() && !stat.isSymbolicLink(), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel must be a regular file');
  const bytes = fs.readFileSync(file);
  need(bytes.length > 0 && bytes.length <= NETWORK_ATTEMPT_MAX_BYTES && bytes.at(-1) === 0x0a, 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel exceeds its bounded format');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { infrastructureFailure('network_guard_sentinel_invalid', 'network sentinel is not valid JSON'); }
  const expectedKeys = ['kind', 'nonce', 'pid', 'role', 'schema'];
  need(value && typeof value === 'object' && !Array.isArray(value) && stableStringify(Object.keys(value).sort()) === stableStringify(expectedKeys), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel has unexpected fields');
  need(Buffer.compare(bytes, Buffer.from(`${JSON.stringify(value)}\n`)) === 0, 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel is not canonical guard output');
  need(value.schema === NETWORK_ATTEMPT_SCHEMA && value.nonce === nonce && value.role === role && value.pid === pid, 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel is stale or bound to another process/role');
  need(NETWORK_ATTEMPT_KINDS.has(value.kind), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel kind is not allowlisted');
  return { kind: value.kind, sha256: sha(bytes), pid: value.pid, role: value.role, nonce: value.nonce };
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
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
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


const REAL_AGENT_PROVIDERS = Object.freeze({
  codex: Object.freeze({ command: 'codex', model: 'gpt-5.6-luna', reasoning: 'high' }),
  claude: Object.freeze({ command: 'claude', model: 'claude-sonnet-5', reasoning: 'high' }),
  opencode: Object.freeze({ command: 'opencode', model: 'openai/gpt-5.6-luna', reasoning: 'high' }),
});
const REAL_AGENT_WINDOWS_TARGETS = Object.freeze({
  codex: 'node_modules/@openai/codex/bin/codex.js',
  claude: 'node_modules/@anthropic-ai/claude-code/cli.js',
  opencode: 'node_modules/opencode-ai/bin/opencode.exe',
});

function realAgentWhereEntries(command, env = process.env, platform = process.platform, fixtureEntries = null) {
  if (fixtureEntries) return fixtureEntries.map(String);
  const probe = cp.spawnSync(platform === 'win32' ? 'where.exe' : 'which', [command], { env, encoding: 'utf8', windowsHide: true, shell: false, timeout: 5000 });
  return String(probe.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function realAgentRegularFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function realAgentResolvedPath(file) {
  try { return fs.realpathSync(file); } catch { return null; }
}

function realAgentWindowsShimTarget(shim, expectedTarget) {
  const shimPath = realAgentResolvedPath(shim);
  if (!shimPath || path.extname(shimPath).toLowerCase() !== '.cmd' || !realAgentRegularFile(shimPath)) return null;
  let source;
  try { source = fs.readFileSync(shimPath, 'utf8'); } catch { return null; }
  const references = [];
  const referencePattern = /%(?:~)?dp0%?[\\/]([^\r\n"']+)/ig;
  for (const match of source.matchAll(referencePattern)) {
    const relative = String(match[1]).trim().split(/\s+/)[0];
    if (!relative || !/^node_modules[\\/]/i.test(relative)) continue;
    if (relative.replaceAll('\\', '/').toLowerCase() !== expectedTarget.toLowerCase()) return null;
    const target = path.resolve(path.dirname(shimPath), relative);
    if (!references.includes(target)) references.push(target);
  }
  if (references.length !== 1) return null;
  const nodeModulesRoot = realAgentResolvedPath(path.join(path.dirname(shimPath), 'node_modules'));
  const targetPath = realAgentResolvedPath(references[0]);
  if (!nodeModulesRoot || !targetPath || !inside(nodeModulesRoot, targetPath) || !realAgentRegularFile(targetPath)) return null;
  const extension = path.extname(targetPath).toLowerCase();
  if (extension !== '.js' && extension !== '.exe') return null;
  return { shim_path: shimPath, node_modules_root: nodeModulesRoot, target_path: targetPath, target_kind: extension.slice(1) };
}

function realAgentResolveProvider(runtime, provider, env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const entries = realAgentWhereEntries(provider.command, env, platform, options.whereEntries);
  for (const entry of entries) {
    const candidate = realAgentResolvedPath(entry);
    if (!candidate || !realAgentRegularFile(candidate)) continue;
    if (platform !== 'win32') {
      return {
        runtime,
        logical_command: provider.command,
        command: candidate,
        prefix: [],
        source: 'PATH',
        source_kind: 'direct',
        source_path: candidate,
        target_path: candidate,
        target_kind: path.extname(candidate).slice(1).toLowerCase() || 'direct',
        shell: false,
      };
    }
    const extension = path.extname(candidate).toLowerCase();
    if (extension === '.exe') {
      return {
        runtime,
        logical_command: provider.command,
        command: candidate,
        prefix: [],
        source: 'PATH',
        source_kind: 'direct-exe',
        source_path: candidate,
        target_path: candidate,
        target_kind: 'exe',
        shell: false,
      };
    }
    if (extension !== '.cmd') continue;
    const target = realAgentWindowsShimTarget(candidate, REAL_AGENT_WINDOWS_TARGETS[runtime]);
    if (!target) continue;
    return {
      runtime,
      logical_command: provider.command,
      command: target.target_kind === 'js' ? process.execPath : target.target_path,
      prefix: target.target_kind === 'js' ? [target.target_path] : [],
      source: 'PATH',
      source_kind: 'cmd-shim',
      source_path: target.shim_path,
      target_path: target.target_path,
      target_kind: target.target_kind,
      shell: false,
    };
  }
  return null;
}

function realAgentProviderEvidence(descriptor, root = null, env = process.env) {
  if (!descriptor) return null;
  const scrubPath = (value) => scrub(value, root, env);
  const sourceSha = descriptor.source_path && realAgentRegularFile(descriptor.source_path) ? shaFile(descriptor.source_path) : null;
  const targetSha = descriptor.target_path && realAgentRegularFile(descriptor.target_path) ? shaFile(descriptor.target_path) : null;
  return {
    runtime: descriptor.runtime,
    logical_command: descriptor.logical_command,
    command: scrubPath(descriptor.command),
    prefix: descriptor.prefix.map(scrubPath),
    source: descriptor.source,
    source_kind: descriptor.source_kind,
    source_path: scrubPath(descriptor.source_path),
    source_sha256: sourceSha,
    target_path: scrubPath(descriptor.target_path),
    target_kind: descriptor.target_kind,
    target_sha256: targetSha,
    shell: false,
  };
}

function realAgentRunProvider(descriptor, argv, options) {
  need(descriptor && descriptor.shell === false && !/\.cmd$/i.test(descriptor.command) && !/\\cmd(?:\.exe)?$/i.test(descriptor.command), 'infrastructure', 'provider_resolution_unsafe', 'provider descriptor is not directly spawnable');
  return run(descriptor.command, [...descriptor.prefix, ...argv], options);
}

const REAL_AGENT_FORBIDDEN_RE = /(?:gold(?:en)?|solution(?:[_ -]?(?:patch|code))?|secret|holdout|oracle[_ -](?:path|content|command))/i;
const REAL_AGENT_ROOT_FORBIDDEN_RE = /(?:gold(?:en)?\s+(?:answer|patch|solution)|solution[_ -]?(?:patch|code)|holdout|oracle[_ -](?:path|content|command))/i;
// Fixed bounded policy for the approved scenarios: provider-readable paths,
// nondependency content entries, and nondependency content bytes.
const REAL_AGENT_ORACLE_PATH_CAP = 131072;
const REAL_AGENT_ORACLE_NONDEPENDENCY_ENTRY_CAP = 32768;
const REAL_AGENT_ORACLE_CONTENT_BYTE_CAP = 256 * 1024 * 1024;


function realAgentAssertOracleScanLimits({ pathEntries, nondependencyEntries, contentBytes, label = 'provider-readable root' }) {
  need(pathEntries <= REAL_AGENT_ORACLE_PATH_CAP, 'infrastructure', 'oracle_scan_unbounded', `${label} exceeds the bounded provider-readable path scan`, { count: pathEntries, cap: REAL_AGENT_ORACLE_PATH_CAP });
  need(nondependencyEntries <= REAL_AGENT_ORACLE_NONDEPENDENCY_ENTRY_CAP, 'infrastructure', 'oracle_scan_unbounded', `${label} exceeds the bounded nondependency content-entry scan`, { count: nondependencyEntries, cap: REAL_AGENT_ORACLE_NONDEPENDENCY_ENTRY_CAP });
  need(contentBytes <= REAL_AGENT_ORACLE_CONTENT_BYTE_CAP, 'infrastructure', 'oracle_scan_unbounded', `${label} exceeds the bounded nondependency content-byte scan`, { bytes: contentBytes, cap: REAL_AGENT_ORACLE_CONTENT_BYTE_CAP });
}

function realAgentOracleExcludedPath(relative) {
  const normalized = String(relative).replaceAll('\\', '/');
  const comparable = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return ['.git', 'isolated', 'contexts'].some((prefix) => comparable === prefix || comparable.startsWith(`${prefix}/`));
}

function realAgentAssertNoOracleExposure({ prompt = '', argv = [], env = {}, root, label = 'provider input', allowEnvNames = [] }) {
  const allowed = new Set(allowEnvNames);
  const values = [prompt, ...argv.map(String), ...Object.entries(env).filter(([key]) => !allowed.has(key)).flatMap(([key, value]) => [key, value])];
  need(!values.some((value) => REAL_AGENT_FORBIDDEN_RE.test(String(value))), 'infrastructure', 'oracle_packet_exposure', `${label} contains forbidden oracle material`);
  if (!root || !exists(root)) return;
  const rootPath = realAgentResolvedPath(root) || path.resolve(root);
  let pathEntries = 0;
  let nondependencyEntries = 0;
  let contentBytes = 0;
  function visit(full, relative, isRoot = false) {
    let stat;
    try { stat = fs.lstatSync(full); } catch (error) { infrastructureFailure('oracle_walk_failure', `${label} could not inspect a provider-readable path`, { path: slash(relative), message: error.message }); }
    const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    if (isRoot) {
      need(type === 'directory', 'infrastructure', 'oracle_walk_failure', `${label} provider-readable root is not a directory`, { path: slash(relative), type });
      for (const name of fs.readdirSync(full).sort()) visit(path.join(full, name), path.join(relative, name));
      return;
    }
    const visiblePath = slash(relative);
    if (realAgentOracleExcludedPath(visiblePath)) return;
    if (!['file', 'directory', 'link'].includes(type)) return;
    pathEntries += 1;
    realAgentAssertOracleScanLimits({ pathEntries, nondependencyEntries, contentBytes, label });
    need(!REAL_AGENT_ROOT_FORBIDDEN_RE.test(visiblePath), 'infrastructure', 'oracle_packet_exposure', `${label} can read a forbidden oracle path`, { path: visiblePath });
    if (type === 'directory') {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(full, name), path.join(relative, name));
      return;
    }
    let contentFile = full;
    let resolvedPath = null;
    if (type === 'link') {
      const target = fs.readlinkSync(full);
      need(!REAL_AGENT_ROOT_FORBIDDEN_RE.test(target), 'infrastructure', 'oracle_packet_exposure', `${label} can read a forbidden link target`, { path: visiblePath, target });
      resolvedPath = realAgentResolvedPath(full);
      need(resolvedPath && inside(rootPath, resolvedPath), 'infrastructure', 'oracle_link_unsafe', `${label} contains a link escaping the provider-readable root`, { path: visiblePath, target, resolved: resolvedPath });
      const resolvedRelative = slash(path.relative(rootPath, resolvedPath));
      need(!realAgentOracleExcludedPath(resolvedRelative), 'infrastructure', 'oracle_link_unsafe', `${label} contains a link into an excluded provider root`, { path: visiblePath, target, resolved: resolvedRelative });
      need(!REAL_AGENT_ROOT_FORBIDDEN_RE.test(resolvedRelative), 'infrastructure', 'oracle_packet_exposure', `${label} can read a forbidden link target path`, { path: visiblePath, target, resolved: resolvedRelative });
      need(realAgentRegularFile(resolvedPath), 'infrastructure', 'oracle_link_unsafe', `${label} contains a link that does not resolve to a regular file`, { path: visiblePath, target, resolved: resolvedPath });
      contentFile = resolvedPath;
    }
    const resolvedRelative = resolvedPath ? slash(path.relative(rootPath, resolvedPath)) : visiblePath;
    const dependency = [visiblePath, resolvedRelative].some((candidate) => candidate.split('/').some((segment) => segment.toLowerCase() === 'node_modules'));
    if (dependency) return;
    nondependencyEntries += 1;
    contentBytes += fs.statSync(contentFile).size;
    realAgentAssertOracleScanLimits({ pathEntries, nondependencyEntries, contentBytes, label });
    const text = fs.readFileSync(contentFile, 'utf8');
    need(!REAL_AGENT_ROOT_FORBIDDEN_RE.test(text), 'infrastructure', 'oracle_packet_exposure', `${label} can read forbidden oracle content`, { path: visiblePath });
  }
  visit(root, '.', true);
}


function realAgentInvocationArgv(runtime, root, prompt, role, provider) {
  return runtime === 'codex'
    ? ['exec', '--ephemeral', '--ignore-user-config', '--json', '--color', 'never', ...(role === 'execute' ? ['--approve-for-me'] : ['--sandbox', 'read-only']), '-m', provider.model, '-c', `model_reasoning_effort="${provider.reasoning}"`, '-C', root, prompt]
    : runtime === 'claude'
      ? ['-p', prompt, '--verbose', '--no-session-persistence', '--setting-sources', 'project', '--model', provider.model, '--effort', provider.reasoning, '--output-format', 'stream-json', '--input-format', 'text', '--permission-mode', 'dontAsk']
      : ['run', '--dir', root, '--model', provider.model, '--variant', provider.reasoning, '--format', 'json', prompt];
}

function realAgentFailureDiagnostic(result, proofRoot, env, secretValues = []) {
  const diagnosticLimit = 2000;
  const safeStreamJsonFlag = '--output-format=stream-json';
  const safeStreamJsonPlaceholder = '§'.repeat(safeStreamJsonFlag.length);
  let text = scrub(`${result.stderr || ''}\n${result.stdout || ''}`.trim(), proofRoot, env);
  for (const secret of secretValues) if (secret) text = text.split(String(secret)).join('<REDACTED_SECRET>');
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


function realAgentWriteReceipt(file, receipt) {
  need(file && path.isAbsolute(file), 'infrastructure', 'receipt_path_invalid', 'receipt path must be absolute', { file });
  need(!exists(file), 'infrastructure', 'receipt_exists', 'refusing to overwrite an existing receipt', { file: slash(file) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
}


// Task 16-05-02 admits only bounded, re-gradeable audit packs.  Provider
// execution remains an explicit later lane; --simulate and --verify-pack never
// resolve or invoke a provider.
const CORE_CAMPAIGN_SCHEMA_VERSION = 2;
const CORE_CAMPAIGN_CONTRACT = 'phase16-core-flows.v2';
const CORE_CAMPAIGN_APPROVAL = '16-05 owner approval 2026-08-26';
const HISTORICAL_SCENARIO_SHA256 = 'D66601B028C92CB520011DFE9DC669190FD45F3AE435BC722D2AF395DDDA4504';
const CALIBRATION_CONTRACT = 'phase16-calibration.v1';
const CALIBRATION_CASE_IDS = Object.freeze([
  'treesnap-greenfield', 'itsdangerous-fips-sha1', 'chi-bodyless-charset',
  'packed-readme-install', 'scripted-owner-broker', 'docusaurus-browser',
]);
const FRESH_PAUSE_RESUME_WITNESS = 'fresh-pause-resume';
const CRITICAL_WITNESSES = Object.freeze([
  'provider-events', 'generated-skill-observations', 'lifecycle-transitions',
  FRESH_PAUSE_RESUME_WITNESS, 'patch-diff', 'changed-file-hashes',
  'verifier-verdict', 'deterministic-grader', 'selected-artifacts', 'terminal-receipt',
]);
const AUDIT_PACK_SCHEMA_VERSION = 1;
const AUDIT_PACK_EVENT_CAP = 96;
const AUDIT_PACK_ARTIFACT_CAP = 16;
const AUDIT_PACK_CONTENT_CAP = 128 * 1024;
const SIMULATED_ROOT_TOKEN = '<SIMULATED_ROOT>';
const SAFE_TOKEN = /^<(?:SIMULATED_ROOT|ISOLATED_ROOT|EPHEMERAL_[A-Z0-9_]+)>/;

const CORE_RUNTIME_PINS = Object.freeze({
  codex: Object.freeze({ command: 'codex', model: 'gpt-5.6-luna', effort: 'high' }),
  claude: Object.freeze({ command: 'claude', model: 'claude-sonnet-5', effort: 'high' }),
  opencode: Object.freeze({ command: 'opencode', model: 'openai/gpt-5.6-luna', effort: 'high' }),
});
const CORE_JOURNEYS = Object.freeze({
  treesnap: Object.freeze({
    kind: 'core', title: 'Greenfield new-project treesnap journey',
    flow: Object.freeze(['setup', 'health', 'new-project', 'plan', 'execute', 'verify']),
    artifact_family: 'project-plan-summary-verification', timeout_seconds: 3300, process_count: 1,
  }),
  'brownfield-plan': Object.freeze({
    kind: 'core', title: 'Brownfield plan pause and fresh-resume journey',
    flow: Object.freeze(['setup', 'health', 'brownfield-plan', 'pause', 'fresh-resume', 'execute', 'verify', 'progress']),
    artifact_family: 'brownfield-change-checkpoint', timeout_seconds: 3300, process_count: 2,
  }),
  'brownfield-quick': Object.freeze({
    kind: 'core', title: 'Brownfield quick and verify journey',
    flow: Object.freeze(['setup', 'health', 'quick', 'verify']),
    artifact_family: 'quick-change', timeout_seconds: 3300, process_count: 1,
  }),
});
const SKILL_FOR_PHASE = Object.freeze({
  'new-project': 'work-new-project', plan: 'work-plan', 'brownfield-plan': 'work-plan', 'plan-check': 'work-plan',
  pause: 'work-pause', 'fresh-resume': 'work-resume', execute: 'work-execute', verify: 'work-verify',
  progress: 'work-progress', quick: 'work-quick',
});
const SKILL_WITNESS = 'generated-skill-observations';

function bindingFlow(binding) {
  if (binding.kind === 'core') return binding.flow;
  if (binding.run_id === 'owner-scripted-plan-check') return ['setup', 'health', 'plan'];
  if (binding.kind === 'packed-readme') return ['install', 'setup', 'health', 'update', 'rerun'];
  if (binding.kind === 'docusaurus-browser') return ['init-auto', 'health', 'new-project', 'plan', 'execute', 'verify', 'audit'];
  return ['setup', 'health'];
}

function bindingRequiredSkills(binding) {
  const flow = binding.journey_id === 'brownfield-quick' ? bindingFlow(binding).filter((phase) => phase !== 'verify') : bindingFlow(binding);
  return flow.map((phase) => SKILL_FOR_PHASE[phase]).filter(Boolean).filter((id, index, values) => values.indexOf(id) === index);
}

function bindingCriticalWitnesses(binding) {
  const required = bindingRequiredSkills(binding);
  const needsFreshResume = binding?.journey_id === 'brownfield-plan';
  return CRITICAL_WITNESSES.filter((id) => (id !== SKILL_WITNESS || required.length > 0) && (id !== FRESH_PAUSE_RESUME_WITNESS || needsFreshResume));
}

function journeyRequiredSkills(journeyId) {
  const journey = CORE_JOURNEYS[journeyId];
  if (!journey) return [];
  // quick owns semantic verification internally.  Keeping work-verify out of
  // this declaration prevents the harness from inventing a second verifier.
  const flow = journeyId === 'brownfield-quick' ? journey.flow.filter((phase) => phase !== 'verify') : journey.flow;
  return flow.map((phase) => SKILL_FOR_PHASE[phase]).filter(Boolean).filter((id, index, values) => values.indexOf(id) === index);
}

function journeyCriticalWitnesses(journeyId) {
  const required = journeyRequiredSkills(journeyId);
  return CRITICAL_WITNESSES.filter((id) => (id !== SKILL_WITNESS || required.length > 0) && (id !== FRESH_PAUSE_RESUME_WITNESS || journeyId === 'brownfield-plan'));
}

function bindingFingerprintPayload(binding) {
  return {
    run_id: binding.run_id,
    repetition: binding.repetition || 1,
    journey_id: binding.journey_id || null,
    flow: bindingFlow(binding),
    process_count: binding.process_count || (binding.journey_id ? CORE_JOURNEYS[binding.journey_id]?.process_count : 1),
    kind: binding.kind,
    runtime: binding.runtime,
    model: binding.model,
    effort: binding.effort,
    required_artifact_family: binding.required_artifact_family || null,
    timeout_seconds: binding.timeout_seconds,
    role_budgets_seconds: binding.role_budgets_seconds,
    critical_witnesses: bindingCriticalWitnesses(binding),
    required_skills: bindingRequiredSkills(binding),
  };
}

function bindingFingerprint(binding) { return sha(Buffer.from(stableStringify(bindingFingerprintPayload(binding)), 'utf8')); }

function exactKeys(value, allowed, label) {
  need(value && typeof value === 'object' && !Array.isArray(value), 'product', 'receipt_schema_invalid', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  need(stableStringify(actual) === stableStringify(expected), 'product', 'receipt_schema_invalid', `${label} has unknown or missing keys`, { actual, expected });
}

const RECEIPT_KEYS = Object.freeze(['schema_version', 'record_type', 'mode', 'provider_invoked', 'campaign', 'binding_fingerprint', 'run_id', 'journey_id', 'trial_kind', 'runtime', 'provider', 'critical_witnesses', 'audit_pack', 'terminal', 'claim_limit']);
const PACK_KEYS = Object.freeze(['schema_version', 'bounded', 'binding_fingerprint', 'critical_witnesses', 'required_skills', 'events', 'generated_skills', 'lifecycle', 'candidate', 'artifacts', 'selected_artifacts', 'verifier', 'deterministic_grader', 'advisory_judge']);
const TERMINAL_KEYS = Object.freeze(['status', 'receipt_count', 'failure_class', 'failure_code', 'message']);
const CORE_RUNTIME_IDS = Object.freeze(['codex', 'claude', 'opencode']);
const CORE_TRIAL_KINDS = new Set(['core', 'scripted-owner', 'packed-readme', 'docusaurus-browser']);
const CORE_ROLE_BUDGET_KEYS = Object.freeze(['plan_check', 'execute', 'independent_verify']);
const CORE_BINDING_CONTRACT = Object.freeze({
  core: Object.freeze({ timeout_seconds: 3300, role_budgets_seconds: Object.freeze({ plan_check: 900, execute: 1800, independent_verify: 600 }) }),
  'scripted-owner': Object.freeze({ timeout_seconds: 2400, role_budgets_seconds: Object.freeze({ plan_check: 600, execute: 1200, independent_verify: 600 }) }),
  'packed-readme': Object.freeze({ timeout_seconds: 2400, role_budgets_seconds: Object.freeze({ plan_check: 600, execute: 1200, independent_verify: 600 }) }),
  'docusaurus-browser': Object.freeze({ timeout_seconds: 6300, role_budgets_seconds: Object.freeze({ plan_check: 900, execute: 4500, independent_verify: 900 }) }),
});

function coreArg(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || fallback || '') : fallback;
}

function coreFlag(...names) { return names.some((name) => args.includes(name)); }

function coreCampaignFile(value) {
  const file = path.resolve(value || path.join(REPO, 'tests', 'evals', 'phase16-core-flows.json'));
  need(exists(file), 'infrastructure', 'campaign_missing', 'campaign contract is missing', { file: slash(file) });
  return file;
}

function coreValidateBinding(binding, journeys) {
  need(binding && typeof binding === 'object', 'product', 'binding_invalid', 'campaign binding must be an object');
  need(typeof binding.run_id === 'string' && /^[a-z0-9-]+$/.test(binding.run_id), 'product', 'binding_id_invalid', 'binding run_id must be a stable lowercase identifier');
  need(CORE_TRIAL_KINDS.has(binding.kind), 'product', 'binding_kind_invalid', `unsupported trial kind: ${binding.kind}`);
  need(typeof binding.runtime === 'string' && CORE_RUNTIME_IDS.includes(binding.runtime), 'product', 'binding_runtime_invalid', `unsupported runtime: ${binding.runtime}`);
  const pin = CORE_RUNTIME_PINS[binding.runtime];
  need(binding.model === pin.model && binding.effort === pin.effort, 'product', 'binding_runtime_pin_invalid', `runtime pin mismatch: ${binding.run_id}`);
  need(Number.isInteger(binding.timeout_seconds) && binding.timeout_seconds >= 60, 'product', 'binding_timeout_invalid', `invalid timeout: ${binding.run_id}`);
  need(binding.role_budgets_seconds && CORE_ROLE_BUDGET_KEYS.every((key) => Number.isInteger(binding.role_budgets_seconds[key]) && binding.role_budgets_seconds[key] >= 60), 'product', 'binding_budget_invalid', `invalid role budgets: ${binding.run_id}`);
  need(Object.values(binding.role_budgets_seconds).reduce((sum, value) => sum + value, 0) === binding.timeout_seconds, 'product', 'binding_budget_invalid', `role budgets do not partition timeout: ${binding.run_id}`);
  const fixedBudget = CORE_BINDING_CONTRACT[binding.kind];
  need(binding.timeout_seconds === fixedBudget.timeout_seconds && stableStringify(binding.role_budgets_seconds) === stableStringify(fixedBudget.role_budgets_seconds), 'product', 'binding_budget_contract_invalid', `binding does not use the approved fixed ceiling: ${binding.run_id}`);
  need(typeof binding.task_ceiling === 'string' && binding.task_ceiling.length >= 20, 'product', 'binding_ceiling_invalid', `task ceiling missing: ${binding.run_id}`);
  need(binding.grader_mode === 'deterministic-only' && binding.advisory_judge === false, 'product', 'binding_grader_invalid', `binding must use deterministic grading; advisory judging is controlled by the campaign: ${binding.run_id}`);
  need(stableStringify(binding.critical_witnesses) === stableStringify(bindingCriticalWitnesses(binding)), 'product', 'critical_witness_contract_invalid', `binding critical witness declaration mismatch: ${binding.run_id}`);
  need(stableStringify(binding.required_skills) === stableStringify(bindingRequiredSkills(binding)), 'product', 'required_skills_contract_invalid', `binding required skill declaration mismatch: ${binding.run_id}`);
  if (binding.kind === 'core') {
    need(typeof binding.journey_id === 'string' && journeys.has(binding.journey_id), 'product', 'binding_journey_invalid', `core binding references unknown journey: ${binding.run_id}`);
    const journey = journeys.get(binding.journey_id);
    need(binding.flow && stableStringify(binding.flow) === stableStringify(journey.flow), 'product', 'binding_flow_invalid', `core binding flow mismatch: ${binding.run_id}`);
    need(binding.required_artifact_family === journey.required_artifact_family, 'product', 'binding_artifact_invalid', `core binding artifact family mismatch: ${binding.run_id}`);
    need((binding.process_count || journey.process_count) === journey.process_count, 'product', 'binding_process_count_invalid', `binding process count mismatch: ${binding.run_id}`);
    need(binding.repetition === 1 || binding.repetition === 2, 'product', 'binding_repetition_invalid', `core binding repetition must be 1 or 2: ${binding.run_id}`);
  } else {
    need(!binding.journey_id && binding.repetition === 1, 'product', 'binding_shape_invalid', `non-core binding has core-only fields: ${binding.run_id}`);
  }
}

function coreReadCampaign(file) {
  let campaign;
  try { campaign = json(file); } catch (error) { throw new ProofFailure('infrastructure', 'campaign_schema_invalid', 'campaign contract is not valid JSON', { file: slash(file), message: error.message }); }
  const historical = path.basename(file).toLowerCase() === 'phase16-04a-scenarios.json' || campaign?.contract === 'phase16-real-agent-scenarios.v1';
  need(!historical, 'product', 'historical_campaign_rejected', 'the 16-04A scenario contract is historical evidence and cannot be used as live authority', { file: slash(file), sha256: shaFile(file), expected_sha256: HISTORICAL_SCENARIO_SHA256 });
  need(campaign && campaign.schema_version === CORE_CAMPAIGN_SCHEMA_VERSION && campaign.contract === CORE_CAMPAIGN_CONTRACT, 'product', 'campaign_schema_invalid', 'unsupported core-flow campaign contract', { schema_version: campaign?.schema_version, contract: campaign?.contract });
  need(campaign.approval_ref === CORE_CAMPAIGN_APPROVAL, 'product', 'campaign_approval_invalid', 'campaign approval reference is not the approved Task 16-05 reference');
  need(campaign.authority === 'live-evaluation' && campaign.execution === 'audit-pack-only-until-16-06', 'product', 'campaign_authority_invalid', 'campaign is not explicitly bounded to the Task 16-05-02 audit-pack lane');
  need(campaign.calibration && campaign.calibration.contract === CALIBRATION_CONTRACT && campaign.calibration.case_file === 'tests/evals/phase16-calibration-cases.json', 'product', 'calibration_contract_invalid', 'campaign does not point at the approved offline calibration contract');
  need(stableStringify(campaign.calibration.case_ids) === stableStringify(CALIBRATION_CASE_IDS), 'product', 'calibration_contract_invalid', 'campaign calibration case matrix drifted');
  const calibrationFile = path.resolve(REPO, campaign.calibration.case_file);
  need(exists(calibrationFile), 'infrastructure', 'calibration_contract_missing', 'offline calibration case file is missing', { file: slash(calibrationFile) });
  let calibration;
  try { calibration = json(calibrationFile); } catch (error) { infrastructureFailure('calibration_contract_invalid', 'offline calibration case file is not valid JSON', { message: error.message }); }
  need(calibration.contract === CALIBRATION_CONTRACT && calibration.approval_ref === CORE_CAMPAIGN_APPROVAL && Array.isArray(calibration.cases), 'product', 'calibration_contract_invalid', 'offline calibration case contract is not approved');
  const calibrationCases = new Map(calibration.cases.map((item) => [item.id, item]));
  need(stableStringify([...calibrationCases.keys()]) === stableStringify(CALIBRATION_CASE_IDS), 'product', 'calibration_contract_invalid', 'offline calibration case IDs do not match campaign');
  need(campaign.historical_scenario_sha256 === HISTORICAL_SCENARIO_SHA256, 'product', 'historical_hash_invalid', 'campaign does not pin the immutable historical scenario bytes');
  need(stableStringify(campaign.critical_witnesses) === stableStringify(CRITICAL_WITNESSES), 'product', 'critical_witness_contract_invalid', 'campaign does not declare the approved critical witness contract');
  need(campaign.advisory_judge && campaign.advisory_judge.enabled === true && campaign.advisory_judge.must_run_after === 'deterministic-grader' && campaign.advisory_judge.affects_verdict === false, 'product', 'advisory_contract_invalid', 'campaign advisory judge is not strictly post-grade and non-authoritative');
  need(Array.isArray(campaign.journeys) && campaign.journeys.length === 3, 'product', 'journey_count_invalid', 'campaign must contain exactly three core journeys');
  const journeys = new Map();
  for (const journey of campaign.journeys) {
    const fixed = CORE_JOURNEYS[journey?.id];
    need(fixed && journey.id === journey.id.toLowerCase(), 'product', 'journey_id_invalid', `unsupported journey: ${journey?.id}`);
    need(!journeys.has(journey.id), 'product', 'journey_duplicate', `duplicate journey: ${journey.id}`);
    need(journey.kind === fixed.kind && journey.title === fixed.title, 'product', 'journey_metadata_invalid', `journey metadata mismatch: ${journey.id}`);
    need(stableStringify(journey.flow) === stableStringify(fixed.flow), 'product', 'journey_flow_invalid', `journey flow mismatch: ${journey.id}`);
    need(journey.required_artifact_family === fixed.artifact_family && journey.timeout_seconds === fixed.timeout_seconds && journey.process_count === fixed.process_count, 'product', 'journey_contract_invalid', `journey contract mismatch: ${journey.id}`);
    need(Array.isArray(journey.critical_witnesses) && stableStringify(journey.critical_witnesses) === stableStringify(journeyCriticalWitnesses(journey.id)), 'product', 'critical_witness_contract_invalid', `journey critical witness contract mismatch: ${journey.id}`);
    need(stableStringify(journey.required_skills) === stableStringify(journeyRequiredSkills(journey.id)), 'product', 'required_skills_contract_invalid', `journey required skill declaration mismatch: ${journey.id}`);
    journeys.set(journey.id, journey);
  }
  need(stableStringify([...journeys.keys()].sort()) === stableStringify(Object.keys(CORE_JOURNEYS).sort()), 'product', 'journey_matrix_invalid', 'campaign journeys are not the exact three approved core journeys');
  need(Array.isArray(campaign.bindings) && campaign.bindings.length === 21, 'product', 'binding_count_invalid', 'campaign must contain exactly 21 trial bindings');
  const ids = new Set();
  for (const binding of campaign.bindings) {
    need(!ids.has(binding?.run_id), 'product', 'binding_duplicate', `duplicate binding: ${binding?.run_id}`); ids.add(binding?.run_id);
    need(CALIBRATION_CASE_IDS.includes(binding.calibration_case), 'product', 'calibration_binding_invalid', `binding calibration reference is missing: ${binding?.run_id}`);
    const calibrationCase = calibrationCases.get(binding.calibration_case);
    need(calibrationCase && calibrationCase.campaign_refs.includes(binding.run_id), 'product', 'calibration_binding_invalid', `binding is not covered by its calibration case: ${binding?.run_id}`);
    if (binding.kind === 'core') {
      need(/^[0-9a-f]{64}$/i.test(binding.calibration_digest), 'product', 'calibration_binding_invalid', `core binding calibration digest is missing: ${binding?.run_id}`);
      need(sha(Buffer.from(stableStringify(calibrationCase), 'utf8')) === binding.calibration_digest.toLowerCase(), 'product', 'calibration_binding_invalid', `binding calibration digest does not match its case: ${binding?.run_id}`);
    } else if (calibrationCase.admission === 'admitted-auxiliary') {
      need(/^[0-9a-f]{64}$/i.test(binding.calibration_digest), 'product', 'calibration_binding_invalid', `auxiliary binding calibration digest is missing: ${binding?.run_id}`);
      need(sha(Buffer.from(stableStringify(calibrationCase), 'utf8')) === binding.calibration_digest.toLowerCase(), 'product', 'calibration_binding_invalid', `auxiliary binding calibration digest does not match its case: ${binding?.run_id}`);
    } else {
      need(binding.calibration_digest === null && calibrationCase.admission === 'pending', 'product', 'calibration_pending_contract_invalid', `auxiliary binding must remain explicitly pending: ${binding?.run_id}`);
    }
    coreValidateBinding(binding, journeys);
  }
  const core = campaign.bindings.filter((binding) => binding.kind === 'core');
  need(core.length === 18, 'product', 'core_matrix_invalid', 'core matrix must contain 18 trials');
  for (const journey of journeys.keys()) for (const runtime of CORE_RUNTIME_IDS) {
    const rows = core.filter((binding) => binding.journey_id === journey && binding.runtime === runtime);
    need(rows.length === 2 && rows.every((binding) => [1, 2].includes(binding.repetition)), 'product', 'core_matrix_invalid', `core matrix must have two repetitions for ${journey}/${runtime}`);
  }
  const journeyProcesses = campaign.bindings.reduce((sum, binding) => sum + (binding.process_count || (binding.journey_id === 'brownfield-plan' ? 2 : 1)), 0);
  need(journeyProcesses === 27, 'product', 'process_count_invalid', 'campaign must account for exactly 27 top-level journey processes');
  need(campaign.process_contract && campaign.process_contract.journey_processes === 27 && campaign.process_contract.version_probes === 21 && campaign.process_contract.opencode_exports === 8, 'product', 'process_contract_invalid', 'campaign process accounting is not the approved 27-process contract');
  for (const kind of ['scripted-owner', 'packed-readme', 'docusaurus-browser']) need(campaign.bindings.filter((binding) => binding.kind === kind).length === 1, 'product', 'auxiliary_matrix_invalid', `${kind} must contain exactly one retained trial`);
  need(campaign.bindings.filter((binding) => binding.calibration_digest !== null).length === 20, 'product', 'calibration_admission_count_invalid', 'exactly 20 bindings must be calibrated before the browser gate');
  need(campaign.bindings.filter((binding) => binding.calibration_digest === null).length === 1, 'product', 'calibration_pending_count_invalid', 'exactly one browser binding must remain pending');
  return { campaign, journeys, bindings: campaign.bindings, file, sha256: shaFile(file) };
}

function coreDryRun(contract, binding) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-core-dry-run-'));
  const cleanup = { attempted: false, removed: false };
  try {
    const provider = CORE_RUNTIME_PINS[binding.runtime];
    const prompt = `Task 16-05-01 dry-run for ${binding.run_id}; provider execution is deferred until Task 16-05-02.`;
    const argv = binding.kind === 'core'
      ? realAgentInvocationArgv(binding.runtime, root, prompt, 'plan-check', { command: provider.command, model: provider.model, reasoning: provider.effort })
      : ['--dry-run', '--model', provider.model, '--effort', provider.effort, prompt];
    realAgentAssertNoOracleExposure({ prompt, argv, env: {}, root, label: 'core-flow dry-run invocation' });
    const redactedArgv = argv.map((value) => scrub(value, root, {}));
    const receipt = {
      schema_version: 2, record_type: 'terminal_receipt', mode: 'dry-run', provider_invoked: false,
      campaign: { contract: CORE_CAMPAIGN_CONTRACT, sha256: contract.sha256 },
      run_id: binding.run_id, trial_kind: binding.kind, runtime: binding.runtime,
      provider: { logical_command: provider.command, model: provider.model, effort: provider.effort, resolution: 'deferred_until_task_16_05_02' },
      argv: redactedArgv, isolation: { root: '<EPHEMERAL_DRY_RUN_ROOT>', provider_sandbox: 'not_claimed' },
      critical_witnesses: { status: 'deferred-to-simulation', required: CRITICAL_WITNESSES },
      cleanup, terminal: { status: 'passed', failure_class: null, failure_code: null, message: '21-binding construction and provider-free dry-run contract passed' },
      claim_limit: 'No provider execution or product claim; this is command construction only.',
    };
    return receipt;
  } finally {
    cleanup.attempted = true;
    try { fs.rmSync(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 25 }); cleanup.removed = !exists(root); } catch (error) { cleanup.error = error.message; }
  }
}

function auditSafeRelative(value, label) {
  const text = String(value || '');
  need(text && !path.isAbsolute(text) && !text.includes('\0'), 'product', 'path_escape', `${label} must be a relative path`, { path: text });
  const normalized = text.replaceAll('\\', '/');
  need(!normalized.split('/').includes('..'), 'product', 'path_escape', `${label} escapes its isolated root`, { path: normalized });
  need(!normalized.startsWith('/') && !/^[A-Za-z]:/.test(normalized), 'product', 'path_escape', `${label} contains an absolute path`, { path: normalized });
  return normalized;
}

function auditRedactionScan(value, label = 'audit pack') {
  if (typeof value === 'string') {
    need(!REAL_AGENT_FORBIDDEN_RE.test(value), 'product', 'hidden_input_leakage', `${label} contains forbidden hidden-input material`);
    need(!/(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|USERPROFILE|API[_-]?KEY|BEARER\s+)/i.test(value), 'product', 'unredacted_provider_event', `${label} contains an unredacted path or credential`);
    need(value.length <= AUDIT_PACK_CONTENT_CAP, 'product', 'audit_pack_unbounded', `${label} contains an over-sized string`);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) auditRedactionScan(item, label); return; }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /(?:^|_)(?:realpath|target_path)$/.test(key)) need(SAFE_TOKEN.test(item), 'product', 'path_escape', `${label}.${key} is not a redacted isolated-root token`, { path: item });
      auditRedactionScan(item, `${label}.${key}`);
    }
  }
}

function auditStableHash(value) { return sha(Buffer.from(stableStringify(value), 'utf8')); }

function auditArtifact(pathName, kind, content, selected = true) {
  const relative = auditSafeRelative(pathName, 'artifact path');
  need(content.length <= AUDIT_PACK_CONTENT_CAP, 'product', 'audit_pack_unbounded', `artifact is over the bounded content cap: ${relative}`);
  return { path: relative, kind, content, sha256: sha(content), selected };
}

function auditExpectedLifecycle(binding, journey) {
  const flow = bindingFlow(binding);
  return flow.map((phase, index) => ({
    sequence: index + 50,
    type: 'lifecycle_transition',
    from: index === 0 ? 'created' : flow[index - 1],
    to: phase,
    context_id: phase === 'fresh-resume' ? 'ctx-fresh-2' : 'ctx-initial',
    process_id: phase === 'fresh-resume' ? 'process-2' : 'process-1',
    session_id: phase === 'fresh-resume' ? 'session-2' : 'session-1',
    fresh_context: phase === 'fresh-resume',
  }));
}

function auditBuildSimulation(contract, binding) {
  const journey = binding.journey_id ? contract.journeys.get(binding.journey_id) : { flow: bindingFlow(binding), required_artifact_family: binding.required_artifact_family || binding.kind };
  const lifecycle = auditExpectedLifecycle(binding, journey);
  const requiredWitnesses = bindingCriticalWitnesses(binding);
  const requiredSkills = bindingRequiredSkills(binding);
  const fingerprint = bindingFingerprint(binding);
  const generatedSkills = requiredSkills.map((id, index) => ({
    id,
    path: `.agents/skills/${id}/SKILL.md`,
    stable_hash: sha(`name: ${id}\n# generated simulation skill\n`),
    read_sequence: 30 + (index * 2),
    invocation_sequence: 31 + (index * 2),
  }));
  const skillEvents = generatedSkills.flatMap((skill) => [
    { sequence: skill.read_sequence, type: 'skill_read', skill_id: skill.id, path: skill.path, realpath: `${SIMULATED_ROOT_TOKEN}/${skill.path}`, content_hash: skill.stable_hash },
    { sequence: skill.invocation_sequence, type: 'skill_invocation', skill_id: skill.id, invocation: `name: ${skill.id}`, path: skill.path },
  ]);
  const providerEvents = [
    { sequence: 1, type: 'provider_event', event: 'invocation', runtime: binding.runtime, command: '<PROVIDER_COMMAND>', argv: ['--model', binding.model, '--effort', binding.effort, '<PROMPT_REDACTED>'], stream: 'stdout' },
    { sequence: 2, type: 'provider_event', event: 'completed', runtime: binding.runtime, exit_code: 0, stream: 'stdout', content: '<PROVIDER_OUTPUT_REDACTED>' },
  ];
  const changedFileContent = 'export const observed = true;\n';
  const artifacts = [
    auditArtifact('project/PLAN.md', 'markdown', '# PLAN\n\nBounded simulated plan.\n'),
    auditArtifact('project/SUMMARY.md', 'markdown', '# SUMMARY\n\nBounded simulated summary.\n'),
    auditArtifact('project/VERIFICATION.md', 'markdown', '# VERIFICATION\n\nDeterministic checks passed.\n'),
    auditArtifact('project/patch.diff', 'patch', `diff --git a/src/observed.js b/src/observed.js\n--- a/src/observed.js\n+++ b/src/observed.js\n@@\n+${changedFileContent}`, true),
    auditArtifact('project/state.json', 'state', '{"phase":"verify","status":"passed"}\n', true),
  ];
  const changedFiles = [{ path: 'src/observed.js', content: changedFileContent, sha256: sha(changedFileContent) }];
  const candidateBody = { identity: 'simulated-candidate', changed_files: changedFiles.map(({ path, sha256 }) => ({ path, sha256 })), patch_sha256: artifacts.find((artifact) => artifact.kind === 'patch').sha256 };
  const candidate = { ...candidateBody, sha256: auditStableHash(candidateBody) };
  const artifactHashes = Object.fromEntries(artifacts.map((artifact) => [artifact.path, artifact.sha256]));
  const verifierBody = { status: 'passed', candidate_sha256: candidate.sha256, artifact_hashes: artifactHashes };
  const verifier = { ...verifierBody, verdict_sha256: auditStableHash(verifierBody) };
  const checks = requiredWitnesses.map((id) => ({ id, status: 'passed' }));
  const graderBody = { mode: 'deterministic', status: 'passed', checks, score: checks.length, maximum: checks.length, sequence: 90 };
  const deterministicGrader = { ...graderBody, output_sha256: auditStableHash(graderBody) };
  const advisoryBody = { status: 'passed', after: 'deterministic-grader', sequence: 100, input_grader_sha256: deterministicGrader.output_sha256, note: 'advisory only; cannot change deterministic result' };
  const advisoryJudge = { ...advisoryBody, output_sha256: auditStableHash(advisoryBody) };
  return {
    schema_version: AUDIT_PACK_SCHEMA_VERSION,
    bounded: true,
    critical_witnesses: requiredWitnesses,
    events: [...providerEvents, ...skillEvents, ...lifecycle],
    generated_skills: generatedSkills,
    lifecycle: { transitions: lifecycle, pause_resume: lifecycle.some((item) => item.to === 'fresh-resume') ? (() => { const pause = lifecycle.find((item) => item.to === 'pause'); const fresh = lifecycle.find((item) => item.to === 'fresh-resume'); const evidence = { pause_context_id: pause.context_id, resumed_context_id: fresh.context_id, pause_process_id: pause.process_id, resumed_process_id: fresh.process_id, pause_session_id: pause.session_id, resumed_session_id: fresh.session_id, continuity_hash: null }; const basis = { binding_fingerprint: fingerprint, ...evidence }; delete basis.continuity_hash; evidence.continuity_hash = auditStableHash(basis); return evidence; })() : null },
    binding_fingerprint: fingerprint,
    required_skills: requiredSkills,
    candidate: { ...candidate, changed_files: changedFiles },
    artifacts,
    selected_artifacts: artifacts.filter((artifact) => artifact.selected).map(({ path, kind, sha256 }) => ({ path, kind, sha256 })),
    verifier,
    deterministic_grader: deterministicGrader,
    advisory_judge: advisoryJudge,
  };
}

function auditValidatePack(receipt, contract) {
  need(receipt && receipt.record_type === 'terminal_receipt', 'product', 'incomplete_receipt', 'audit pack must contain one terminal receipt');
  exactKeys(receipt, RECEIPT_KEYS, 'terminal receipt');
  need(receipt.mode === 'simulate' && receipt.provider_invoked === false, 'product', 'provider_invoked', 'simulation audit pack must not invoke a provider');
  const binding = contract?.bindings.find((item) => item.run_id === receipt.run_id);
  need(binding, 'product', 'binding_missing', 'audit pack run_id is not present in the immutable campaign');
  need((binding.journey_id || null) === (receipt.journey_id || null) && binding.kind === receipt.trial_kind && binding.runtime === receipt.runtime, 'product', 'binding_contradiction', 'receipt identity does not match its immutable campaign binding');
  need(receipt.campaign?.contract === CORE_CAMPAIGN_CONTRACT && receipt.campaign?.sha256 === contract.sha256, 'product', 'campaign_contradiction', 'receipt campaign identity does not match the immutable campaign');
  exactKeys(receipt.campaign, ['contract', 'sha256'], 'receipt campaign');
  exactKeys(receipt.provider, ['logical_command', 'model', 'effort', 'resolution'], 'receipt provider');
  exactKeys(receipt.critical_witnesses, ['status', 'required'], 'receipt critical witnesses');
  exactKeys(receipt.terminal, TERMINAL_KEYS, 'terminal receipt terminal object');
  const requiredWitnesses = bindingCriticalWitnesses(binding);
  need(receipt.binding_fingerprint === bindingFingerprint(binding), 'product', 'binding_contradiction', 'receipt binding fingerprint does not match the immutable binding');
  need(stableStringify(receipt.critical_witnesses?.required) === stableStringify(requiredWitnesses), 'product', 'critical_witness_contract_invalid', 'receipt witness declaration does not match its binding');
  const pack = receipt.audit_pack;
  need(pack && pack.schema_version === AUDIT_PACK_SCHEMA_VERSION && pack.bounded === true, 'product', 'incomplete_receipt', 'bounded audit pack is missing');
  exactKeys(pack, PACK_KEYS, 'audit pack');
  need(pack.binding_fingerprint === bindingFingerprint(binding), 'product', 'binding_contradiction', 'audit pack binding fingerprint does not match the immutable binding');
  need(!pack.events?.some((event) => event.type === 'terminal_receipt' || event.record_type === 'terminal_receipt'), 'product', 'duplicate_terminal_receipt', 'audit pack contains an additional terminal receipt record');
  need(stableStringify(pack.critical_witnesses) === stableStringify(requiredWitnesses), 'product', 'critical_witness_contract_invalid', 'pack witness declaration does not match its binding');
  auditRedactionScan(receipt);
  need(Array.isArray(pack.events) && pack.events.length <= AUDIT_PACK_EVENT_CAP, 'product', 'audit_pack_unbounded', 'provider event list is missing or unbounded');
  need(pack.events.some((event) => event.type === 'provider_event' && event.event === 'invocation') && pack.events.some((event) => event.type === 'provider_event' && event.event === 'completed' && event.exit_code === 0), 'product', 'missing_provider_witness', 'structured provider invocation/completion witnesses are incomplete');
  const providerPin = CORE_RUNTIME_PINS[binding.runtime];
  need(receipt.provider.logical_command === providerPin.command && receipt.provider.model === binding.model && receipt.provider.effort === binding.effort && receipt.provider.resolution === 'not-invoked-simulation', 'product', 'provider_contradiction', 'receipt provider pin does not match its binding');
  const invocationEvent = pack.events.find((event) => event.type === 'provider_event' && event.event === 'invocation');
  exactKeys(invocationEvent, ['sequence', 'type', 'event', 'runtime', 'command', 'argv', 'stream'], 'provider invocation event');
  need(invocationEvent.runtime === binding.runtime && invocationEvent.command === '<PROVIDER_COMMAND>' && stableStringify(invocationEvent.argv) === stableStringify(['--model', binding.model, '--effort', binding.effort, '<PROMPT_REDACTED>']), 'product', 'provider_contradiction', 'provider invocation argv does not match its immutable binding');
  const completedEvent = pack.events.find((event) => event.type === 'provider_event' && event.event === 'completed');
  exactKeys(completedEvent, ['sequence', 'type', 'event', 'runtime', 'exit_code', 'stream', 'content'], 'provider completion event');
  need(completedEvent.runtime === binding.runtime && completedEvent.exit_code === 0, 'product', 'provider_contradiction', 'provider completion witness does not match its immutable binding');
  const sequences = pack.events.map((event) => event.sequence);
  need(sequences.every((value, index) => Number.isInteger(value) && (index === 0 || value > sequences[index - 1])), 'product', 'event_order_invalid', 'structured events must have strictly increasing sequence numbers');
  for (const event of pack.events) {
    if (event.path) auditSafeRelative(event.path, `${event.type} path`);
    if (event.realpath) need(SAFE_TOKEN.test(event.realpath), 'product', 'path_escape', 'event realpath is not a redacted isolated-root token', { realpath: event.realpath });
    need(event.is_reparse_point !== true, 'product', 'reparse_point_forbidden', 'reparse-point evidence cannot be admitted');
  }
  const requiredSkills = bindingRequiredSkills(binding);
  need(stableStringify(pack.required_skills) === stableStringify(requiredSkills), 'product', 'required_skills_contract_invalid', 'audit pack required skills do not match its immutable binding');
  need(Array.isArray(pack.generated_skills) && pack.generated_skills.length === requiredSkills.length, 'product', 'missing_skill_witness', 'generated skill reads/invocations are incomplete');
  const generatedSkillIds = [];
  for (const skill of pack.generated_skills) {
    exactKeys(skill, ['id', 'path', 'stable_hash', 'read_sequence', 'invocation_sequence'], 'generated skill witness');
    need(requiredSkills.includes(skill.id) && !generatedSkillIds.includes(skill.id), 'product', 'missing_skill_witness', `unexpected or duplicate generated skill: ${skill.id}`);
    generatedSkillIds.push(skill.id);
    auditSafeRelative(skill.path, 'generated skill path');
    const read = pack.events.find((event) => event.type === 'skill_read' && event.skill_id === skill.id);
    const invocation = pack.events.find((event) => event.type === 'skill_invocation' && event.skill_id === skill.id);
    need(read && invocation, 'product', 'missing_skill_witness', `generated skill read/invocation missing: ${skill.id}`);
    exactKeys(read, ['sequence', 'type', 'skill_id', 'path', 'realpath', 'content_hash'], 'generated skill read event');
    exactKeys(invocation, ['sequence', 'type', 'skill_id', 'invocation', 'path'], 'generated skill invocation event');
    need(read.path === skill.path && invocation.path === skill.path && invocation.invocation === `name: ${skill.id}`, 'product', 'skill_identity_mismatch', `generated skill identity/path mismatch: ${skill.id}`);
    need(read.content_hash === skill.stable_hash && read.sequence === skill.read_sequence && invocation.sequence === skill.invocation_sequence && read.sequence < invocation.sequence, 'product', 'skill_witness_contradiction', `generated skill content/order mismatch: ${skill.id}`);
  }
  need(stableStringify(generatedSkillIds) === stableStringify(requiredSkills), 'product', 'missing_skill_witness', 'generated skill witness order/set does not match required skills');
  const observedSkillIds = pack.events.filter((event) => event.type === 'skill_read' || event.type === 'skill_invocation').map((event) => event.skill_id);
  need(observedSkillIds.every((id) => requiredSkills.includes(id)) && observedSkillIds.length === requiredSkills.length * 2, 'product', 'missing_skill_witness', 'audit pack contains extra or missing skill observations');
  const transitions = pack.lifecycle?.transitions;
  need(Array.isArray(transitions) && transitions.length > 0, 'product', 'lifecycle_disorder', 'lifecycle transitions are missing');
  const lifecycleSequences = transitions.map((item) => item.sequence);
  need(lifecycleSequences.every((value, index) => Number.isInteger(value) && (index === 0 || value > lifecycleSequences[index - 1])), 'product', 'lifecycle_disorder', 'lifecycle transitions are out of order');
  const requiredFlow = bindingFlow(binding);
  let cursor = -1;
  for (const phase of requiredFlow) { const next = transitions.findIndex((item, index) => index > cursor && item.to === phase); need(next > cursor, 'product', 'lifecycle_disorder', `required lifecycle transition missing or disordered: ${phase}`); cursor = next; }
  if (requiredFlow.includes('fresh-resume')) {
    const pause = transitions.find((item) => item.to === 'pause');
    const fresh = transitions.find((item) => item.to === 'fresh-resume');
    const evidence = pack.lifecycle.pause_resume;
    need(pause && fresh && fresh.sequence > pause.sequence && fresh.fresh_context === true && evidence, 'product', 'pause_resume_invalid', 'fresh pause/resume evidence is missing or stale');
    exactKeys(evidence, ['pause_context_id', 'resumed_context_id', 'pause_process_id', 'resumed_process_id', 'pause_session_id', 'resumed_session_id', 'continuity_hash'], 'pause/resume evidence');
    need(pause.context_id === evidence.pause_context_id && fresh.context_id === evidence.resumed_context_id && fresh.process_id === evidence.resumed_process_id && pause.process_id === evidence.pause_process_id && fresh.session_id === evidence.resumed_session_id && pause.session_id === evidence.pause_session_id, 'product', 'pause_resume_invalid', 'pause/resume transition IDs do not match their evidence');
    need(evidence.pause_context_id !== evidence.resumed_context_id && evidence.pause_process_id !== evidence.resumed_process_id && evidence.pause_session_id !== evidence.resumed_session_id, 'product', 'pause_resume_invalid', 'fresh resume does not have a distinct process/session identity');
    const continuityBasis = { binding_fingerprint: bindingFingerprint(binding), pause_context_id: evidence.pause_context_id, resumed_context_id: evidence.resumed_context_id, pause_process_id: evidence.pause_process_id, resumed_process_id: evidence.resumed_process_id, pause_session_id: evidence.pause_session_id, resumed_session_id: evidence.resumed_session_id };
    need(evidence.continuity_hash === auditStableHash(continuityBasis), 'product', 'pause_resume_invalid', 'pause/resume continuity hash is disconnected from binding and exact IDs');
  }
  need(Array.isArray(pack.artifacts) && pack.artifacts.length > 0 && pack.artifacts.length <= AUDIT_PACK_ARTIFACT_CAP, 'product', 'missing_artifacts', 'selected artifacts are missing or unbounded');
  const artifactMap = new Map();
  for (const artifact of pack.artifacts) { auditSafeRelative(artifact.path, 'artifact path'); need(artifact.is_reparse_point !== true, 'product', 'reparse_point_forbidden', 'reparse-point artifact cannot be admitted'); need(typeof artifact.content === 'string' && sha(artifact.content) === artifact.sha256, 'product', 'artifact_hash_mismatch', `artifact hash mismatch: ${artifact.path}`); artifactMap.set(artifact.path, artifact); }
  need(pack.artifacts.some((artifact) => artifact.kind === 'patch' && artifact.path.endsWith('.diff')), 'product', 'patch_missing', 'patch/diff artifact is missing');
  need(Array.isArray(pack.selected_artifacts) && pack.selected_artifacts.length > 0, 'product', 'missing_artifacts', 'selected artifact witness is missing');
  for (const selected of pack.selected_artifacts) { const artifact = artifactMap.get(selected.path); need(artifact && artifact.selected && artifact.sha256 === selected.sha256, 'product', 'selected_artifact_invalid', `selected artifact mismatch: ${selected.path}`); }
  const candidateBody = { identity: pack.candidate?.identity, changed_files: (pack.candidate?.changed_files || []).map(({ path: filePath, sha256: fileSha }) => ({ path: auditSafeRelative(filePath, 'changed file path'), sha256: fileSha })), patch_sha256: pack.candidate?.patch_sha256 };
  need(pack.candidate && auditStableHash(candidateBody) === pack.candidate.sha256, 'product', 'candidate_hash_mismatch', 'candidate hash does not match changed-file and patch evidence');
  need(candidateBody.changed_files.length > 0 && candidateBody.changed_files.every(({ path: filePath, sha256: fileSha }) => { const item = pack.candidate.changed_files.find((entry) => entry.path === filePath); return item && typeof item.content === 'string' && sha(item.content) === fileSha; }), 'product', 'changed_file_hash_mismatch', 'changed-file hash evidence is missing or forged');
  const patch = pack.artifacts.find((artifact) => artifact.kind === 'patch');
  need(candidateBody.patch_sha256 === patch.sha256, 'product', 'patch_hash_mismatch', 'candidate patch hash does not match selected diff');
  const verifierBody = { status: pack.verifier?.status, candidate_sha256: pack.verifier?.candidate_sha256, artifact_hashes: pack.verifier?.artifact_hashes };
  need(pack.verifier && pack.verifier.status === 'passed' && pack.verifier.candidate_sha256 === pack.candidate.sha256 && auditStableHash(verifierBody) === pack.verifier.verdict_sha256, 'product', 'verifier_contradiction', 'structured verifier verdict contradicts candidate evidence');
  need(pack.verifier.artifact_hashes && Object.keys(pack.verifier.artifact_hashes).length === artifactMap.size, 'product', 'verifier_contradiction', 'verifier does not cover every selected artifact');
  for (const [filePath, fileSha] of Object.entries(pack.verifier.artifact_hashes || {})) need(artifactMap.get(filePath)?.sha256 === fileSha, 'product', 'verifier_contradiction', `verifier artifact hash mismatch: ${filePath}`);
  const grader = pack.deterministic_grader;
  need(grader && grader.mode === 'deterministic' && Array.isArray(grader.checks) && stableStringify(grader.checks.map((check) => check.id).sort()) === stableStringify([...requiredWitnesses].sort()), 'product', 'grader_incomplete', 'deterministic grader output is incomplete');
  const graderBody = { mode: grader.mode, status: grader.status, checks: grader.checks, score: grader.score, maximum: grader.maximum, sequence: grader.sequence };
  need(auditStableHash(graderBody) === grader.output_sha256, 'product', 'grader_contradiction', 'deterministic grader hash is invalid');
  const witnessEvidence = {
    'provider-events': pack.events.some((event) => event.type === 'provider_event' && event.event === 'invocation') && pack.events.some((event) => event.type === 'provider_event' && event.event === 'completed' && event.exit_code === 0),
    'generated-skill-observations': requiredSkills.length > 0 && Array.isArray(pack.generated_skills) && pack.generated_skills.length === requiredSkills.length,
    'lifecycle-transitions': Array.isArray(pack.lifecycle?.transitions) && pack.lifecycle.transitions.length > 0,
    'fresh-pause-resume': Boolean(pack.lifecycle?.pause_resume && requiredFlow.includes('fresh-resume')),
    'patch-diff': pack.artifacts.some((artifact) => artifact.kind === 'patch' && artifact.path.endsWith('.diff')),
    'changed-file-hashes': Boolean(pack.candidate?.changed_files?.length),
    'verifier-verdict': Boolean(pack.verifier?.status === 'passed'),
    'deterministic-grader': Boolean(grader),
    'selected-artifacts': Boolean(pack.selected_artifacts?.length),
    'terminal-receipt': Boolean(receipt.terminal?.status === 'passed' && receipt.terminal.receipt_count === 1),
  };
  for (const check of grader.checks) need(witnessEvidence[check.id] === true, 'product', check.id === FRESH_PAUSE_RESUME_WITNESS ? 'pause_resume_invalid' : 'missing_witness', `grader marked ${check.id} passed without its evidence`);
  need(grader.status === 'passed' && grader.checks.every((check) => check.status === 'passed') && grader.score === grader.maximum, 'product', 'deterministic_grader_failed', 'deterministic grader did not pass all critical checks');
  const advisory = pack.advisory_judge;
  need(advisory && advisory.after === 'deterministic-grader' && advisory.sequence > grader.sequence && advisory.input_grader_sha256 === grader.output_sha256, 'product', 'advisory_order_invalid', 'advisory judge did not run after completed deterministic grading');
  need(receipt.terminal?.status === 'passed' && receipt.terminal.receipt_count === 1, 'product', 'incomplete_receipt', 'terminal receipt is missing or duplicated');
  return { status: 'passed', deterministic: 'passed', advisory: 'ignored-for-verdict', events: pack.events.length, artifacts: pack.artifacts.length };
}

function coreSimulation(contract, binding) {
  const pack = auditBuildSimulation(contract, binding);
  const receipt = {
    schema_version: 2, record_type: 'terminal_receipt', mode: 'simulate', provider_invoked: false,
    campaign: { contract: CORE_CAMPAIGN_CONTRACT, sha256: contract.sha256 },
    binding_fingerprint: bindingFingerprint(binding),
    run_id: binding.run_id, journey_id: binding.journey_id || null, trial_kind: binding.kind, runtime: binding.runtime,
    provider: { logical_command: CORE_RUNTIME_PINS[binding.runtime].command, model: binding.model, effort: binding.effort, resolution: 'not-invoked-simulation' },
    critical_witnesses: { status: 'complete', required: bindingCriticalWitnesses(binding) },
    audit_pack: pack,
    terminal: { status: 'passed', receipt_count: 1, failure_class: null, failure_code: null, message: 'bounded simulated audit pack passed deterministic grading' },
    claim_limit: 'Provider-free simulation only; no provider, model, network, browser, release, or product reliability claim.',
  };
  auditValidatePack(receipt, contract);
  return receipt;
}

/*
 * Task 16-06-00B deliberately ends at the provider boundary.  Keep this seam
 * next to the existing resolver rather than teaching the audit-pack grader
 * about provider output: a provider cannot attest to Workspine lifecycle,
 * artifacts, verification, or grading.
 */
const LIVE_REVISION_CONTRACT = 'phase16-live-campaign-revision.v1';
const LIVE_ENV_NAMES = Object.freeze([
  'PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER', 'NUMBER_OF_PROCESSORS', 'LANG', 'LC_ALL', 'TZ',
]);

const LIVE_VALUE_OPTIONS = Object.freeze(new Set(['--run', '--campaign', '--campaign-revision', '--receipt', '--handoff']));
function liveValidateArguments() {
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    need(LIVE_VALUE_OPTIONS.has(option), 'infrastructure', 'unknown_flag', `unsupported live-run option: ${option}`);
    need(!seen.has(option), 'infrastructure', 'duplicate_option', `live-run option was repeated: ${option}`);
    seen.add(option);
    const value = args[++index];
    need(value && !String(value).startsWith('--'), 'infrastructure', 'option_value_missing', `live-run option requires one value: ${option}`);
  }
}

function liveAbsoluteFile(value, code, label) {
  const file = String(value || '');
  need(path.isAbsolute(file), 'infrastructure', code, `${label} must be absolute`, { path: file });
  need(exists(file), 'infrastructure', `${code}_missing`, `${label} is missing`, { path: slash(file) });
  const stat = fs.lstatSync(file);
  need(stat.isFile() && !stat.isSymbolicLink(), 'infrastructure', `${code}_unsafe`, `${label} must be a regular file`, { path: slash(file) });
  return file;
}

function liveHash(value, label) {
  const text = String(value || '');
  need(/^[0-9a-f]{64}$/i.test(text), 'infrastructure', 'revision_hash_invalid', `${label} must be a SHA-256`, { label });
  return text.toLowerCase();
}

function liveRevisionPath(value) {
  const file = liveAbsoluteFile(value, 'campaign_revision', 'campaign revision');
  const real = realAgentResolvedPath(file);
  need(real && real === file, 'infrastructure', 'campaign_revision_unsafe', 'campaign revision must not be a reparse path', { path: slash(file) });
  return file;
}

function liveCanonicalRevision(file) {
  let revision;
  try { revision = json(file); } catch (error) { infrastructureFailure('campaign_revision_invalid', 'campaign revision is not valid JSON', { message: error.message }); }
  need(revision && typeof revision === 'object' && !Array.isArray(revision), 'infrastructure', 'campaign_revision_invalid', 'campaign revision must be an object');
  need(revision.contract === LIVE_REVISION_CONTRACT && revision.schema_version === 1, 'infrastructure', 'campaign_revision_invalid', 'unsupported campaign revision contract');
  need(typeof revision.revision_id === 'string' && revision.revision_id.length > 0, 'infrastructure', 'campaign_revision_invalid', 'campaign revision id is missing');
  const canonical = fs.readFileSync(file);
  const revisionSha = sha(canonical);
  if (revision.revision_sha256) need(revisionSha === liveHash(revision.revision_sha256, 'campaign revision hash'), 'infrastructure', 'campaign_revision_hash_mismatch', 'campaign revision self-hash does not match its bytes');
  const candidate = revision.candidate || {};
  const artifact = candidate.artifact || candidate.package_artifact || {};
  const artifactPath = candidate.artifact_path || candidate.package_artifact_path || artifact.path;
  const artifactHash = candidate.artifact_sha256 || candidate.package_artifact_sha256 || artifact.sha256;
  const artifactFile = liveAbsoluteFile(artifactPath, 'candidate_artifact', 'candidate artifact');
  const expectedArtifactHash = liveHash(artifactHash, 'candidate artifact hash');
  need(shaFile(artifactFile) === expectedArtifactHash, 'infrastructure', 'candidate_artifact_hash_mismatch', 'candidate artifact hash does not match the revision');
  const entry = candidate.entry || candidate.package_entry || {};
  const entryPath = entry.path || candidate.entry_path;
  const entryHash = entry.sha256 || candidate.entry_sha256;
  need(typeof entryPath === 'string' && entryPath.length > 0, 'infrastructure', 'candidate_entry_missing', 'candidate package entry is missing');
  const memberLedger = candidate.members || candidate.member_ledger || candidate.artifact_members || artifact.members;
  const members = Array.isArray(memberLedger)
    ? memberLedger
    : memberLedger && typeof memberLedger === 'object'
      ? Object.entries(memberLedger).map(([memberPath, value]) => ({ path: memberPath, ...(typeof value === 'string' ? { sha256: value } : value) }))
      : null;
  need(Array.isArray(members) && members.length > 0, 'infrastructure', 'candidate_members_missing', 'candidate artifact member ledger is missing');
  const memberMap = new Map();
  for (const member of members) {
    const memberPath = liveMemberPath(member?.path || member?.name);
    const memberHash = liveHash(member?.sha256 || member?.hash, `candidate member ${memberPath}`);
    need(!memberMap.has(memberPath), 'infrastructure', 'candidate_members_duplicate', `candidate member is duplicated: ${memberPath}`);
    memberMap.set(memberPath, { path: memberPath, sha256: memberHash, size_bytes: member.size_bytes ?? member.bytes ?? null });
  }
  const sourceHashes = candidate.source_hashes || candidate.sources || revision.source_hashes;
  need(sourceHashes && typeof sourceHashes === 'object' && !Array.isArray(sourceHashes), 'infrastructure', 'candidate_sources_missing', 'candidate source hashes are missing');
  const normalizedSources = {};
  for (const [sourcePath, sourceValue] of Object.entries(sourceHashes)) {
    const relative = liveMemberPath(sourcePath);
    need(!Object.hasOwn(normalizedSources, relative), 'infrastructure', 'candidate_sources_duplicate', `candidate source is duplicated: ${relative}`);
    const sourceHash = typeof sourceValue === 'string' ? sourceValue : sourceValue?.sha256 || sourceValue?.hash;
    normalizedSources[relative] = liveHash(sourceHash, `candidate source ${relative}`);
  }
  need(Object.keys(normalizedSources).length > 0, 'infrastructure', 'candidate_sources_missing', 'candidate source hash ledger is empty');
  need(typeof entryHash === 'string', 'infrastructure', 'candidate_entry_missing', 'candidate package entry hash is missing');
  const runtimes = revision.runtimes || revision.runtime_pins;
  need(runtimes && typeof runtimes === 'object', 'infrastructure', 'runtime_pins_missing', 'runtime pins are missing');
  for (const runtime of CORE_RUNTIME_IDS) {
    const pin = runtimes[runtime];
    need(pin && typeof pin === 'object', 'infrastructure', 'runtime_pin_missing', `runtime pin is missing: ${runtime}`);
    need(pin.version, 'infrastructure', 'runtime_pin_missing', `runtime version pin is missing: ${runtime}`);
    liveRuntimeVersionPin(pin);
    for (const [key, nested] of [['executable_sha256', 'executable'], ['shim_sha256', 'shim'], ['target_sha256', 'target'], ['config_sha256', 'config']]) {
      const value = pin[key] ?? (pin[nested] && typeof pin[nested] === 'object' ? pin[nested].sha256 || pin[nested].hash : null);
      if (key !== 'shim_sha256' || process.platform === 'win32') need(value, 'infrastructure', 'runtime_pin_incomplete', `${runtime} ${key} is missing`);
      if (value != null) liveHash(value, `${runtime} ${key}`);
    }
    const configPath = pin.config_path || (pin.config && typeof pin.config === 'object' ? pin.config.path : null);
    const configHash = pin.config_sha256 || (pin.config && typeof pin.config === 'object' ? pin.config.sha256 || pin.config.hash : null);
    need(configPath && configHash, 'infrastructure', 'runtime_pin_incomplete', `${runtime} config pin is incomplete`);
    const configFile = liveAbsoluteFile(configPath, 'runtime_config', `${runtime} config`);
    need(shaFile(configFile) === liveHash(configHash, `${runtime} config hash`), 'infrastructure', 'runtime_pin_mismatch', `${runtime} config bytes differ from revision`);
  }
  const campaignPin = revision.campaign || {};
  if (campaignPin.path) {
    const campaignFile = liveAbsoluteFile(campaignPin.path, 'campaign_pin', 'revision campaign');
    if (campaignPin.sha256) need(shaFile(campaignFile) === liveHash(campaignPin.sha256, 'revision campaign hash'), 'infrastructure', 'campaign_pin_mismatch', 'revision campaign hash does not match');
  }
  return {
    revision,
    file,
    sha256: revisionSha,
    candidate: { ...candidate, artifact_path: artifactFile, artifact_sha256: expectedArtifactHash, entry_path: liveMemberPath(entryPath), entry_sha256: liveHash(entryHash, 'candidate entry hash'), members: memberMap, source_hashes: normalizedSources },
    runtimes,
  };
}

function liveMemberPath(value) {
  const raw = String(value || '').replaceAll('\\', '/');
  const segments = raw.split('/');
  need(!path.isAbsolute(raw) && !raw.startsWith('/') && !/^[A-Za-z]:/.test(raw) && !segments.includes('..') && !raw.includes('\0'), 'infrastructure', 'candidate_member_path_invalid', 'candidate member path must be a safe relative path', { path: raw });
  const text = segments.filter((segment) => segment && segment !== '.').join('/');
  need(text, 'infrastructure', 'candidate_member_path_invalid', 'candidate member path must not be empty', { path: raw });
  return text;
}

function liveTarEntries(file) {
  let bytes = fs.readFileSync(file);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { bytes = require('node:zlib').gunzipSync(bytes); } catch (error) { infrastructureFailure('candidate_artifact_invalid', 'candidate artifact gzip is invalid', { message: error.message }); }
  }
  const entries = [];
  const seen = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      zeroBlocks += 1;
      offset += 512;
      if (zeroBlocks === 2) break;
      continue;
    }
    need(zeroBlocks === 0, 'infrastructure', 'candidate_artifact_trailing', 'candidate artifact has nonzero bytes after its end marker');
    const checksumText = header.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim();
    need(/^[0-7]{1,7}$/.test(checksumText), 'infrastructure', 'candidate_artifact_checksum', 'candidate artifact tar header checksum is not octal');
    const storedChecksum = parseInt(checksumText, 8);
    let computedChecksum = 0;
    for (let index = 0; index < 512; index += 1) computedChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    need(Number.isFinite(storedChecksum) && storedChecksum === computedChecksum, 'infrastructure', 'candidate_artifact_checksum', 'candidate artifact tar header checksum is invalid');
    const readText = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim();
    const name = readText(0, 100);
    const prefix = readText(345, 155);
    const memberPath = liveMemberPath(prefix ? `${prefix}/${name}` : name);
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    need(/^[0-7]*$/.test(sizeText), 'infrastructure', 'candidate_artifact_size', 'candidate artifact tar member size is not octal');
    const size = sizeText ? parseInt(sizeText, 8) : 0;
    const type = String.fromCharCode(header[156] || 0);
    need(type === '\0' || type === '0' || type === '5', 'infrastructure', 'candidate_artifact_link', 'candidate artifact contains an unsupported link or special member', { path: memberPath, type });
    need(!seen.has(memberPath), 'infrastructure', 'candidate_artifact_duplicate', `candidate artifact member is duplicated: ${memberPath}`);
    seen.add(memberPath);
    entries.push({ path: memberPath, type: type === '5' ? 'directory' : 'file', size, content: type === '5' ? null : bytes.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  need(zeroBlocks === 2 && offset === bytes.length, 'infrastructure', 'candidate_artifact_truncated', 'candidate artifact must end with exactly two zero tar blocks and no trailing bytes');
  need(entries.length > 0, 'infrastructure', 'candidate_artifact_invalid', 'candidate artifact contains no members');
  return entries;
}

function liveBootstrapArtifact(revision, destination) {
  need(shaFile(revision.candidate.artifact_path) === revision.candidate.artifact_sha256, 'infrastructure', 'candidate_artifact_hash_mismatch', 'candidate artifact changed after revision validation');
  fs.mkdirSync(destination, { recursive: true });
  const entries = liveTarEntries(revision.candidate.artifact_path);
  const actual = new Map(entries.filter((item) => item.type === 'file').map((item) => [item.path, item]));
  need(actual.size === revision.candidate.members.size, 'infrastructure', 'candidate_member_mismatch', 'candidate artifact member count differs from its revision ledger');
  for (const [memberPath, expected] of revision.candidate.members) {
    const item = actual.get(memberPath);
    need(item && item.type === 'file' && sha(item.content) === expected.sha256, 'infrastructure', 'candidate_member_mismatch', `candidate artifact member hash mismatch: ${memberPath}`);
    if (expected.size_bytes != null) need(Number(expected.size_bytes) === item.size, 'infrastructure', 'candidate_member_mismatch', `candidate artifact member size mismatch: ${memberPath}`);
    const target = path.join(destination, ...memberPath.split('/'));
    need(inside(destination, target), 'infrastructure', 'candidate_member_path_invalid', 'candidate artifact member escaped its isolated root');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, item.content, { flag: 'wx' });
  }
  const entry = path.join(destination, ...revision.candidate.entry_path.split('/'));
  need(exists(entry) && shaFile(entry) === revision.candidate.entry_sha256, 'infrastructure', 'candidate_entry_mismatch', 'candidate package entry hash does not match its revision');
  for (const [sourcePath, sourceHash] of Object.entries(revision.candidate.source_hashes)) {
    const member = actual.get(sourcePath);
    need(member && member.type === 'file' && sha(member.content) === sourceHash, 'infrastructure', 'candidate_source_mismatch', `candidate source hash mismatch: ${sourcePath}`);
  }
  return { entry, members: actual };
}

function liveRevisionFiles(revision, roleRoot, runtimePin) {
  const files = revision.revision.auth_config_files || revision.revision.config_files || revision.revision.auth || [];
  need(Array.isArray(files), 'infrastructure', 'auth_config_invalid', 'revision auth/config allowlist must be an array');
  const copied = [];
  for (const item of files) {
    const source = liveAbsoluteFile(item?.path || item?.source, 'auth_config', 'allowlisted auth/config input');
    const expected = liveHash(item?.sha256 || item?.hash, `allowlisted auth/config input ${source}`);
    need(shaFile(source) === expected, 'infrastructure', 'auth_config_hash_mismatch', 'allowlisted auth/config input changed after revision freeze');
    const relative = liveMemberPath(item.destination || item.dest || path.basename(source));
    const target = path.join(roleRoot, 'config', ...relative.split('/'));
    need(inside(roleRoot, target), 'infrastructure', 'auth_config_path_escape', 'allowlisted auth/config destination escaped its isolated root');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    copied.push({ path: `<ISOLATED_ROOT>/config/${relative}`, sha256: expected });
  }
  const runtimeConfigPath = runtimePin.config_path || (runtimePin.config && typeof runtimePin.config === 'object' ? runtimePin.config.path : null);
  const runtimeConfigHash = runtimePin.config_sha256 || (runtimePin.config && typeof runtimePin.config === 'object' ? runtimePin.config.sha256 || runtimePin.config.hash : null);
  if (runtimeConfigPath) {
    const source = liveAbsoluteFile(runtimeConfigPath, 'runtime_config', `${runtimePin.runtime || 'runtime'} config`);
    const expected = liveHash(runtimeConfigHash, 'runtime config hash');
    need(shaFile(source) === expected, 'infrastructure', 'runtime_config_hash_mismatch', 'runtime config changed after revision freeze');
    const target = path.join(roleRoot, 'config', path.basename(source));
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    copied.push({ path: `<ISOLATED_ROOT>/config/${path.basename(source)}`, sha256: expected });
  }
  return copied;
}

function liveMinimalEnv(roleRoot, revisionId, runtime, pathAllowlist = []) {
  const env = {};
  for (const name of LIVE_ENV_NAMES) if (process.env[name]) env[name] = process.env[name];
  const nodeDir = path.dirname(process.execPath);
  // The resolver already selected an absolute executable. Do not carry the
  // owner's PATH into a provider context where it could discover more state.
  env.PATH = [...new Set((pathAllowlist.length ? pathAllowlist : [nodeDir]).map((item) => path.resolve(item)))].join(path.delimiter);
  const home = path.join(roleRoot, 'home');
  const config = path.join(roleRoot, 'config');
  const cache = path.join(roleRoot, 'cache');
  const temp = path.join(roleRoot, 'temp');
  for (const dir of [home, config, cache, temp]) fs.mkdirSync(dir, { recursive: true });
  env.HOME = home; env.USERPROFILE = home; env.TMP = temp; env.TEMP = temp;
  env.XDG_CONFIG_HOME = config; env.XDG_CACHE_HOME = cache; env.XDG_STATE_HOME = path.join(roleRoot, 'state');
  env.CODEX_HOME = path.join(config, 'codex'); env.CLAUDE_CONFIG_DIR = path.join(config, 'claude'); env.OPENCODE_CONFIG_DIR = path.join(config, 'opencode');
  env.NPM_CONFIG_USERCONFIG = path.join(config, 'npmrc');
  env.npm_config_offline = 'true'; env.npm_config_registry = 'http://127.0.0.1:9/';
  env.npm_config_update_notifier = 'false'; env.npm_config_audit = 'false'; env.npm_config_fund = 'false';
  // Hermetic evaluator journeys must not let normal phase-status, remember,
  // or scaffold discovery perform update-awareness registry checks.
  env.WORKSPINE_UPDATE_AWARENESS = '0';
  env.GSDD_UPDATE_AWARENESS = '0';
  env[`WORKSPINE_PHASE16_${String(revisionId).replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_RUNTIME`] = runtime;
  return env;
}

function liveToolchain(revision, providerPin, providerDescriptor) {
  const declared = revision.revision.toolchain || revision.revision.toolchain_pins || {};
  const resolveHost = (name) => {
    const probe = cp.spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { env: process.env, encoding: 'utf8', windowsHide: true, shell: false, timeout: 5000 });
    return String(probe.stdout || '').split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  };
  const files = {};
  const add = (name, spec, fallback) => {
    const source = typeof spec === 'string' ? spec : spec?.path || spec?.executable_path || fallback;
    need(source && path.isAbsolute(source), 'infrastructure', 'toolchain_pin_incomplete', `${name} toolchain path is missing`);
    const file = liveAbsoluteFile(source, 'toolchain_pin', `${name} toolchain executable`);
    const expected = typeof spec === 'object' ? spec.sha256 || spec.hash : null;
    need(expected, 'infrastructure', 'toolchain_pin_incomplete', `${name} toolchain hash is missing`);
    need(shaFile(file) === liveHash(expected, `${name} toolchain hash`), 'infrastructure', 'toolchain_pin_mismatch', `${name} toolchain bytes differ from revision`);
    files[name] = { path: file, sha256: liveHash(expected, `${name} toolchain hash`) };
  };
  add('node', declared.node || declared.Node, process.execPath);
  const npmFallback = npmCliPath();
  add('npm', declared.npm || declared.NPM, npmFallback);
  add('git', declared.git || declared.Git, resolveHost('git'));
  const optional = [['python', declared.python], ['go', declared.go]];
  for (const [name, spec] of optional) if (spec) add(name, spec, null);
  const providerPath = providerDescriptor?.source_path ? path.dirname(providerDescriptor.source_path) : path.dirname(providerPin.shim_path || providerPin.executable_path || providerDescriptor?.command || process.execPath);
  const declaredPath = revision.revision.path_allowlist || revision.revision.path_allowlist_entries || declared.path_allowlist;
  const entries = Array.isArray(declaredPath) && declaredPath.length ? declaredPath.map(String) : [providerPath, path.dirname(files.node.path), path.dirname(files.npm.path), path.dirname(files.git.path)];
  const normalized = entries.map((entry) => path.resolve(entry));
  need(new Set(normalized.map((entry) => process.platform === 'win32' ? entry.toLowerCase() : entry)).size === normalized.length, 'infrastructure', 'path_allowlist_duplicate', 'toolchain PATH allowlist contains duplicate entries');
  for (const entry of normalized) need(fs.existsSync(entry) && fs.statSync(entry).isDirectory(), 'infrastructure', 'path_allowlist_invalid', 'toolchain PATH allowlist entry is not a directory', { entry: slash(entry) });
  const contained = (file, label) => need(normalized.some((entry) => inside(entry, file)), 'infrastructure', 'path_allowlist_excludes_target', `${label} is outside the declared PATH allowlist`, { path: slash(file) });
  for (const [name, item] of Object.entries(files)) contained(item.path, `${name} executable`);
  contained(providerDescriptor.command, 'provider command');
  for (const item of providerDescriptor.prefix || []) contained(item, 'provider target');
  if (providerDescriptor.source_path) contained(providerDescriptor.source_path, 'provider shim');
  if (providerDescriptor.target_path) contained(providerDescriptor.target_path, 'provider target');
  return { files, path: normalized, hashes: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, item.sha256])) };
}

function liveSecretEnv(revision, env) {
  const declarations = revision.revision.secret_env || revision.revision.secret_environment || [];
  need(Array.isArray(declarations), 'infrastructure', 'secret_env_invalid', 'revision secret environment must be an array');
  const names = [];
  for (const item of declarations) {
    const sourceName = String(item?.source_name || item?.name || '');
    const targetName = String(item?.target_name || item?.name || '');
    need(/^[A-Z][A-Z0-9_]*$/.test(sourceName) && /^[A-Z][A-Z0-9_]*$/.test(targetName), 'infrastructure', 'secret_env_invalid', 'secret environment names are invalid');
    const value = process.env[sourceName];
    need(typeof value === 'string' && value.length > 0, 'infrastructure', 'secret_env_missing', `revision secret environment value is unavailable: ${sourceName}`);
    if (item.sha256) need(sha(value) === liveHash(item.sha256, `secret environment ${sourceName}`), 'infrastructure', 'secret_env_hash_mismatch', `secret environment value changed: ${sourceName}`);
    env[targetName] = value;
    names.push(targetName);
  }
  return names;
}

function liveParseCodex(stdout, requestedModel, argv) {
  const events = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } });
  need(events.length > 0 && events.every(Boolean), 'infrastructure', 'native_parse_invalid', 'Codex output is not valid JSONL');
  const types = events.map((event) => String(event.type || event.event || ''));
  const errorEvents = events.filter((event, index) => {
    const type = types[index];
    return type === 'turn.failed' || type === 'error' || type === 'reroute' || type === 'redirect' || (type === 'item.completed' && event.item?.type === 'error');
  });
  if (errorEvents.length > 0) {
    const errorText = errorEvents.map((event) => JSON.stringify(event)).join('\n');
    infrastructureFailure(/reroute|redirect/i.test(errorText) ? 'provider_reroute' : 'native_error', 'Codex output contains a native error or reroute event');
  }
  const allowedTypes = new Set(['thread.started', 'turn.started', 'turn.completed', 'item.started', 'item.updated', 'item.completed']);
  need(types.every((type) => allowedTypes.has(type)), 'infrastructure', 'native_sequence_invalid', 'Codex output contains an unknown event type');
  const threadIndex = types.indexOf('thread.started');
  const turnStartIndex = types.indexOf('turn.started');
  const turnCompleteIndex = types.indexOf('turn.completed');
  need(threadIndex === 0 && turnStartIndex > threadIndex && turnCompleteIndex > turnStartIndex, 'infrastructure', 'native_sequence_invalid', 'Codex output lacks a normal thread/turn sequence');
  need(types.filter((type) => type === 'thread.started').length === 1, 'infrastructure', 'native_sequence_invalid', 'Codex output must contain exactly one started thread');
  need(types.filter((type) => type === 'turn.started').length === 1 && types.filter((type) => type === 'turn.completed').length === 1, 'infrastructure', 'native_sequence_invalid', 'Codex output must contain exactly one completed turn');
  const thread = events[threadIndex];
  const turnStart = events[turnStartIndex];
  const turnComplete = events[turnCompleteIndex];
  need(typeof thread.thread_id === 'string' && thread.thread_id.length > 0, 'infrastructure', 'native_linkage_invalid', 'Codex thread.started lacks thread_id');
  if (turnStart.thread_id != null) need(turnStart.thread_id === thread.thread_id, 'infrastructure', 'native_linkage_invalid', 'Codex turn.started is not linked to its thread');
  if (turnComplete.thread_id != null) need(turnComplete.thread_id === thread.thread_id, 'infrastructure', 'native_linkage_invalid', 'Codex turn.completed is not linked to its thread');
  const turnId = turnStart.turn_id || turnStart.id || turnComplete.turn_id || turnComplete.id || null;
  if (turnStart.turn_id != null || turnComplete.turn_id != null || turnStart.id != null || turnComplete.id != null) need(turnId && (!turnStart.turn_id || turnStart.turn_id === turnId) && (!turnComplete.turn_id || turnComplete.turn_id === turnId), 'infrastructure', 'native_linkage_invalid', 'Codex turn lifecycle ids are not coherent');
  const itemEvents = events.filter((event) => /^item\./.test(String(event.type || '')));
  need(itemEvents.length > 0, 'infrastructure', 'native_linkage_invalid', 'Codex output contains no linked item events');
  const terminalKinds = new Set(['agent_message', 'reasoning', 'file_change']);
  const pairedKinds = new Set(['command_execution', 'mcp_tool_call', 'collab_tool_call', 'web_search', 'todo_list']);
  const itemKinds = new Set([...terminalKinds, ...pairedKinds]);
  const lifecycles = new Map();
  for (const event of itemEvents) {
    const item = event.item && typeof event.item === 'object' ? event.item : null;
    const itemId = event.item_id || item?.id || event.id;
    const itemKind = event.item_type || event.item_kind || item?.type || item?.kind;
    need(typeof itemId === 'string' && itemId.length > 0, 'infrastructure', 'native_linkage_invalid', 'Codex item event lacks an item id');
    need(typeof itemKind === 'string' && itemKinds.has(itemKind), 'infrastructure', 'native_linkage_invalid', `Codex item event has an unknown item kind: ${String(itemKind || '<missing>')}`);
    for (const key of ['thread_id', 'turn_id']) {
      const eventValue = event[key];
      const itemValue = item?.[key];
      if (eventValue != null && itemValue != null) need(eventValue === itemValue, 'infrastructure', 'native_linkage_invalid', `Codex item event has incoherent ${key} linkage`);
      const value = eventValue ?? itemValue;
      if (value != null) need(value === (key === 'thread_id' ? thread.thread_id : turnId), 'infrastructure', 'native_linkage_invalid', `Codex item event is not linked to its ${key}`);
    }
    const position = events.indexOf(event);
    need(position > turnStartIndex && position < turnCompleteIndex, 'infrastructure', 'native_sequence_invalid', 'Codex item event is outside the turn lifecycle');
    const state = lifecycles.get(itemId) || { kind: itemKind, started: false, completed: false };
    need(state.kind === itemKind, 'infrastructure', 'native_linkage_invalid', 'Codex item lifecycle changed kind for one item id');
    if (event.type === 'item.started') {
      need(!state.started && !state.completed, 'infrastructure', 'native_linkage_invalid', 'Codex item.started is duplicated or follows completion');
      state.started = true;
    } else if (event.type === 'item.updated') {
      need(itemKind === 'todo_list' && state.started && !state.completed, 'infrastructure', 'native_linkage_invalid', 'Codex item.updated must belong to an open todo_list lifecycle');
    } else {
      need(!state.completed, 'infrastructure', 'native_linkage_invalid', 'Codex item.completed is duplicated');
      if (pairedKinds.has(itemKind)) need(state.started, 'infrastructure', 'native_linkage_invalid', 'Codex paired item.completed is orphaned');
      state.completed = true;
    }
    lifecycles.set(itemId, state);
  }
  need(lifecycles.size > 0, 'infrastructure', 'native_linkage_invalid', 'Codex output contains no linked item lifecycle');
  need([...lifecycles.values()].every((state) => !pairedKinds.has(state.kind) || (state.started && state.completed)), 'infrastructure', 'native_linkage_invalid', 'Codex paired item lifecycle is incomplete');
  need([...lifecycles.values()].every((state) => !terminalKinds.has(state.kind) || !state.started || state.completed), 'infrastructure', 'native_linkage_invalid', 'Codex terminal item lifecycle is incomplete');
  need(argv.includes('-m') && argv[argv.indexOf('-m') + 1] === requestedModel, 'infrastructure', 'requested_model_not_accepted', 'Codex invocation did not carry the requested model flag');
  return { parser: 'codex-jsonl', event_types: types, thread_id: thread.thread_id, turn_id: turnId, identity: 'requested-model-accepted' };
}

function liveParseClaude(stdout, requestedModel) {
  const events = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } });
  need(events.length > 0 && events.every(Boolean), 'infrastructure', 'native_parse_invalid', 'Claude output is not valid stream JSON');
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
  const assistant = events.find((event) => event.type === 'assistant' && event.message && typeof event.message === 'object');
  const result = events.find((event) => event.type === 'result');
  need(init && assistant && result, 'infrastructure', 'native_sequence_invalid', 'Claude output lacks init, assistant, or result events');
  const session = init.session_id;
  need(session && assistant.session_id === session && result.session_id === session, 'infrastructure', 'native_session_mismatch', 'Claude session identities do not match');
  need(assistant.message.model === requestedModel, 'infrastructure', 'served_model_mismatch', 'Claude assistant model does not match the requested model');
  const modelUsage = result.modelUsage || result.model_usage;
  need(modelUsage && (Object.hasOwn(modelUsage, requestedModel) || modelUsage.model === requestedModel), 'infrastructure', 'served_model_missing', 'Claude result model usage does not identify the assistant model');
  return { parser: 'claude-stream-json', session_id: session, assistant_message_id: assistant.id || assistant.message?.id || null, result_session_id: result.session_id, assistant_model: requestedModel, identity: 'served-model-matched' };
}

function liveParseOpenCode(stdout, requestedModel) {
  const events = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } });
  need(events.length > 0 && events.every(Boolean), 'infrastructure', 'native_parse_invalid', 'OpenCode output is not valid JSON events');
  const allowed = new Set(['step_start', 'step_finish', 'text', 'reasoning', 'tool_use', 'error']);
  need(events.every((event) => allowed.has(String(event.type || ''))), 'infrastructure', 'native_sequence_invalid', 'OpenCode output contains an unsupported event type');
  need(!events.some((event) => event.type === 'error'), 'infrastructure', 'native_error', 'OpenCode output contains an error event');
  const sessions = new Set(events.map((event) => event.sessionID || event.session_id || event.part?.sessionID || event.data?.sessionID).filter(Boolean));
  need(sessions.size === 1, 'infrastructure', 'native_session_mismatch', 'OpenCode events do not bind to exactly one session');
  const messageIds = [...new Set(events.map((event) => event.messageID || event.messageId || event.message_id || event.part?.messageID || event.data?.messageID).filter(Boolean))];
  need(messageIds.length > 0, 'infrastructure', 'native_linkage_invalid', 'OpenCode events contain no assistant message identity');
  return { parser: 'opencode-json-events', session_id: [...sessions][0], assistant_message_ids: messageIds, model: requestedModel, identity: 'pending-sanitized-export' };
}

function liveOpenCodeModelMatches(provider, model, requested) {
  return typeof provider === 'string' && typeof model === 'string' && (model === requested || `${provider}/${model}` === requested || model === String(requested).split('/').slice(1).join('/'));
}

function liveParseOpenCodeExport(stdout, identity) {
  let document;
  try { document = JSON.parse(String(stdout)); } catch { infrastructureFailure('native_export_invalid', 'OpenCode export is not valid JSON'); }
  const messages = Array.isArray(document) ? document : document.messages;
  const infos = Array.isArray(messages) ? messages.map((event) => event.info || event.message || event) : null;
  const sessionId = (Array.isArray(document) ? null : document.info?.id || document.session_id || document.sessionID || document.session?.id) || infos?.map((event) => event.sessionID || event.session_id || event.session?.id).find(Boolean);
  need(sessionId === identity.session_id && Array.isArray(messages), 'infrastructure', 'native_export_mismatch', 'OpenCode export is not bound to the captured session');
  const get = (event, ...keys) => keys.map((key) => event?.[key]).find((value) => value != null);
  const assistant = infos.find((event) => get(event, 'role', 'message_role') === 'assistant' && identity.assistant_message_ids.includes(get(event, 'id', 'messageID', 'message_id')));
  const parentId = get(assistant, 'parentID', 'parent_id', 'parent');
  const user = infos.find((event) => get(event, 'role', 'message_role') === 'user' && get(event, 'id', 'messageID', 'message_id') === parentId);
  need(user && assistant, 'infrastructure', 'native_export_ancestry_mismatch', 'OpenCode export does not preserve user/assistant ancestry');
  need([user, assistant].every((event) => get(event, 'sessionID', 'session_id', 'session') === sessionId), 'infrastructure', 'native_export_mismatch', 'OpenCode export messages are not bound to the captured session');
  const provider = get(assistant, 'provider', 'provider_id', 'providerID');
  const model = get(assistant, 'model', 'model_id', 'modelID');
  need(liveOpenCodeModelMatches(provider, model, identity.model), 'infrastructure', 'native_export_identity_mismatch', 'OpenCode export provider/model differs from the requested model');
  return { parser: 'opencode-sanitized-export', session_id: '<SESSION_REDACTED>', user_message_id: '<USER_REDACTED>', assistant_message_id: '<ASSISTANT_REDACTED>', provider: '<PROVIDER_REDACTED>', model: identity.model, identity: 'served-model-matched' };
}

function liveSanitizeNative(runtime, native) {
  if (runtime !== 'opencode') return native;
  return { parser: native.parser, session_id: '<SESSION_REDACTED>', user_message_id: '<USER_REDACTED>', assistant_message_id: '<ASSISTANT_REDACTED>', provider: '<PROVIDER_REDACTED>', model: native.model, identity: native.identity, export: native.export };
}

function liveParseNative(runtime, stdout, requestedModel, argv) {
  if (runtime === 'codex') return liveParseCodex(stdout, requestedModel, argv);
  if (runtime === 'claude') return liveParseClaude(stdout, requestedModel);
  return liveParseOpenCode(stdout, requestedModel);
}

function liveValidateRuntimePin(runtime, descriptor, evidence, pin) {
  const executableHash = pin.executable_sha256 ?? (pin.executable && typeof pin.executable === 'object' ? pin.executable.sha256 || pin.executable.hash : null);
  const shimHash = pin.shim_sha256 ?? (pin.shim && typeof pin.shim === 'object' ? pin.shim.sha256 || pin.shim.hash : null);
  const targetHash = pin.target_sha256 ?? (pin.target && typeof pin.target === 'object' ? pin.target.sha256 || pin.target.hash : null);
  need(executableHash && targetHash && (process.platform !== 'win32' || shimHash), 'infrastructure', 'runtime_pin_incomplete', `${runtime} executable/shim/target pins are incomplete`);
  if (executableHash) need(evidence.target_sha256 === liveHash(executableHash, `${runtime} executable hash`), 'infrastructure', 'runtime_pin_mismatch', `${runtime} executable hash differs from revision`);
  if (shimHash) need(evidence.source_sha256 === liveHash(shimHash, `${runtime} shim hash`), 'infrastructure', 'runtime_pin_mismatch', `${runtime} shim hash differs from revision`);
  if (targetHash) need(evidence.target_sha256 === liveHash(targetHash, `${runtime} target hash`), 'infrastructure', 'runtime_pin_mismatch', `${runtime} target hash differs from revision`);
  const executablePath = pin.executable_path || (typeof pin.executable === 'string' ? pin.executable : null);
  const targetPath = pin.target_path || (typeof pin.target === 'string' ? pin.target : null);
  if (executablePath || targetPath) {
    const expected = path.resolve(executablePath || targetPath);
    need(path.resolve(descriptor.target_path) === expected, 'infrastructure', 'runtime_pin_mismatch', `${runtime} executable target differs from revision`);
  }
  const configPath = pin.config_path || (pin.config && typeof pin.config === 'object' ? pin.config.path : null);
  const configHash = pin.config_sha256 || (pin.config && typeof pin.config === 'object' ? pin.config.sha256 || pin.config.hash : null);
  need(configPath && configHash, 'infrastructure', 'runtime_pin_incomplete', `${runtime} config pin is incomplete`);
}

function liveValidatePinnedRuntimeFiles(runtime, pin) {
  const fileSpec = (key, nested) => ({
    path: pin[`${key}_path`] || (pin[nested] && typeof pin[nested] === 'object' ? pin[nested].path : (typeof pin[nested] === 'string' ? pin[nested] : null)),
    hash: pin[`${key}_sha256`] || (pin[nested] && typeof pin[nested] === 'object' ? pin[nested].sha256 || pin[nested].hash : null),
  });
  for (const [key, nested, required] of [['executable', 'executable', true], ['target', 'target', true], ['shim', 'shim', process.platform === 'win32']]) {
    const spec = fileSpec(key, nested);
    if (!required && !spec.path && !spec.hash) continue;
    need(spec.path && spec.hash, 'infrastructure', 'runtime_pin_incomplete', `${runtime} ${key} path/hash pin is incomplete`);
    const file = liveAbsoluteFile(spec.path, 'runtime_pin', `${runtime} ${key}`);
    need(shaFile(file) === liveHash(spec.hash, `${runtime} ${key} hash`), 'infrastructure', 'runtime_pin_mismatch', `${runtime} ${key} bytes differ from revision`);
  }
}

function liveRuntimeVersionPin(pin) {
  const value = typeof pin.version === 'object' ? pin.version.value || pin.version.name : pin.version;
  const hash = pin.version_sha256 || (pin.version && typeof pin.version === 'object' ? pin.version.sha256 || pin.version.hash : null);
  need(typeof value === 'string' && value.length > 0 && hash, 'infrastructure', 'runtime_version_pin_invalid', 'runtime version pin is incomplete');
  return { value, hash: liveHash(hash, 'runtime version output hash'), expectedOutput: pin.version_output || (pin.version && typeof pin.version === 'object' ? pin.version.output : null) };
}

function liveJourneyPrompt(binding, processIndex) {
  const journey = binding.journey_id || binding.kind;
  const phases = binding.journey_id === 'brownfield-plan'
    ? (processIndex === 1 ? ['setup', 'health', 'brownfield-plan', 'pause'] : ['resume', 'execute', 'verify', 'progress'])
    : (binding.flow || bindingFlow(binding));
  const processNote = binding.journey_id === 'brownfield-plan'
    ? (processIndex === 1 ? 'This is process A: pause after creating the plan/checkpoint; do not execute.' : 'This is process B: resume the same retained workspace, then execute, verify, and progress.')
    : 'Run the complete journey in this one process.';
  const input = binding.__input_paths || { source: '<CONSUMER_ROOT>/inputs/project', task: '<CONSUMER_ROOT>/inputs/owner/TASK.md', brief: '<CONSUMER_ROOT>/inputs/owner/BRIEF.md' };
  const cli = binding.kind === 'packed-readme' ? '<CONSUMER_ROOT>/inputs/workspine.tgz (install this yourself)' : '<CONSUMER_ROOT>/node_modules/workspine/bin/gsdd.mjs';
  const ownerAnswer = binding.kind === 'scripted-owner' ? ` Frozen owner answer/approval input: ${input.owner_answer}. Read it as the only deterministic owner response; do not invent or substitute an answer.` : '';
  return `Natural Workspine consumer journey ${journey}. ${processNote} Execute exactly these phases in order: ${phases.join(', ')}. Frozen project source: ${input.source}; owner task: ${input.task}; owner brief: ${input.brief}.${ownerAnswer} Workspine CLI: ${cli}. Use only these frozen inputs and the supplied workspace. Do not claim workflow verdicts or access the source checkout.`;
}

function liveJourneyArgv(binding, workspace, prompt, processIndex) {
  return realAgentInvocationArgv(binding.runtime, workspace, prompt, 'execute', { model: binding.model, reasoning: binding.effort });
}

function liveIdentityKey(runtime, native) {
  if (!native) return null;
  if (runtime === 'codex') return [native.thread_id, native.turn_id].filter(Boolean).join(':');
  if (runtime === 'claude') return [native.session_id, native.assistant_message_id, native.result_session_id].filter(Boolean).join(':');
  return [native.session_id, native.assistant_message_id].filter(Boolean).join(':');
}

function liveCaptureCheckpoint(workspace) {
  const file = path.join(workspace, '.work', '.continue-here.md');
  need(exists(file) && fs.statSync(file).isFile(), 'infrastructure', 'checkpoint_missing', 'brownfield process A did not leave .work/.continue-here.md');
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  need(bytes.length >= 64 && /current\s+task/i.test(text) && /evidence/i.test(text) && /next\s+action/i.test(text), 'infrastructure', 'checkpoint_not_substantive', 'brownfield pause checkpoint lacks the required substantive sections');
  return { path: '<CONSUMER_ROOT>/.work/' + path.basename(file), bytes: bytes.length, sha256: sha(bytes) };
}

function liveInputBundle(revision, binding, destination) {
  const bundles = revision.revision.consumer_input_bundles || revision.revision.consumer_inputs;
  const input = (bundles && !Array.isArray(bundles) ? bundles[binding.calibration_case] : null) || revision.revision.consumer_input_bundle || revision.revision.consumer_input || revision.revision.input_bundle;
  need(input && typeof input === 'object', 'infrastructure', 'consumer_input_bundle_missing', `frozen consumer input bundle is missing: ${binding.calibration_case}`);
  if (input.calibration_case) need(input.calibration_case === binding.calibration_case, 'infrastructure', 'consumer_input_bundle_binding_mismatch', 'frozen consumer input bundle is bound to another calibration case');
  const archive = liveAbsoluteFile(input.path || input.artifact_path || input.bundle_path, 'consumer_input_bundle', 'frozen consumer input bundle');
  const expectedArchive = liveHash(input.sha256 || input.artifact_sha256 || input.hash, 'frozen consumer input bundle hash');
  need(shaFile(archive) === expectedArchive, 'infrastructure', 'consumer_input_bundle_hash_mismatch', 'frozen consumer input bundle changed after revision freeze');
  const entries = liveTarEntries(archive);
  const ledger = input.members || input.member_ledger || input.artifact_members;
  need(ledger && typeof ledger === 'object', 'infrastructure', 'consumer_input_bundle_ledger_missing', 'frozen consumer input member ledger is missing');
  const expected = new Map();
  const expectedSizes = new Map();
  for (const item of (Array.isArray(ledger) ? ledger : Object.entries(ledger).map(([key, value]) => ({ path: key, ...(typeof value === 'string' ? { sha256: value } : value) })))) {
    const memberPath = liveMemberPath(item.path || item.name);
    need(!expected.has(memberPath), 'infrastructure', 'consumer_input_bundle_ledger_duplicate', `frozen consumer input member is duplicated: ${memberPath}`);
    expected.set(memberPath, liveHash(item.sha256 || item.hash, `consumer input member ${item.path}`));
    if (item.size_bytes != null || item.bytes != null) expectedSizes.set(memberPath, Number(item.size_bytes ?? item.bytes));
  }
  const actual = new Map(entries.filter((item) => item.type === 'file').map((item) => [item.path, item]));
  need(actual.size === expected.size && [...expected].every(([name, hash]) => actual.get(name) && sha(actual.get(name).content) === hash), 'infrastructure', 'consumer_input_bundle_member_mismatch', 'frozen consumer input member bytes differ from its ledger');
  for (const [name, size] of expectedSizes) need(Number.isInteger(size) && size >= 0 && actual.get(name).size === size, 'infrastructure', 'consumer_input_bundle_member_mismatch', `frozen consumer input member size differs from its ledger: ${name}`);
  const sourcePath = input.source_path || input.source || 'project';
  const taskPath = input.task_path || input.task || 'owner/TASK.md';
  const briefPath = input.brief_path || input.brief || 'owner/BRIEF.md';
  const configuredOwnerAnswerPath = input.owner_answer_path || input.approval_path || input.owner_answer || null;
  const ownerAnswerPath = binding.kind === 'scripted-owner' ? configuredOwnerAnswerPath : null;
  if (binding.kind === 'scripted-owner') need(ownerAnswerPath, 'infrastructure', 'owner_answer_missing', 'scripted-owner binding requires a frozen owner answer/approval input');
  const hasMaterial = (relative) => actual.has(liveMemberPath(relative)) || [...actual.keys()].some((name) => name.startsWith(`${liveMemberPath(relative)}/`));
  need(hasMaterial(sourcePath), 'infrastructure', 'consumer_input_bundle_member_missing', `frozen consumer input source is missing: ${sourcePath}`);
  for (const relative of [taskPath, briefPath]) need(actual.has(liveMemberPath(relative)), 'infrastructure', 'consumer_input_bundle_member_missing', `frozen consumer input member is missing: ${relative}`);
  const sourceMember = liveMemberPath(sourcePath);
  const taskMember = liveMemberPath(taskPath);
  const briefMember = liveMemberPath(briefPath);
  const memberHashes = Object.fromEntries([...expected.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const sourceHashes = Object.fromEntries(Object.entries(memberHashes).filter(([name]) => name === sourceMember || name.startsWith(`${sourceMember}/`)));
  const answerMember = ownerAnswerPath ? liveMemberPath(ownerAnswerPath) : null;
  if (answerMember) need(actual.has(answerMember), 'infrastructure', 'owner_answer_missing', `frozen owner answer/approval input is missing: ${ownerAnswerPath}`);
  const materializedRoot = `<CONSUMER_ROOT>/inputs`;
  liveBootstrapArtifact({ candidate: { artifact_path: archive, artifact_sha256: expectedArchive, members: new Map([...expected].map(([pathName, hash]) => [pathName, { path: pathName, sha256: hash }])), entry_path: [...expected.keys()][0], entry_sha256: [...expected.values()][0], source_hashes: Object.fromEntries(expected) } }, destination);
  return {
    archive: expectedArchive,
    members: expected.size,
    member_hashes: memberHashes,
    source: `${materializedRoot}/${sourceMember}`,
    source_sha256: sourceHashes[sourceMember] || null,
    source_hashes: sourceHashes,
    task: `${materializedRoot}/${taskMember}`,
    task_sha256: expected.get(taskMember),
    brief: `${materializedRoot}/${briefMember}`,
    brief_sha256: expected.get(briefMember),
    owner_answer: answerMember ? `${materializedRoot}/${answerMember}` : null,
    owner_answer_sha256: answerMember ? expected.get(answerMember) : null,
  };
}

const OWNER_AUTHORITY_FILES = Object.freeze(['.work/SPEC.md', '.work/ROADMAP.md', '.work/state.json']);

function liveRetainedRoot(receiptFile, runId) {
  need(path.isAbsolute(receiptFile) && typeof runId === 'string' && runId.length > 0, 'infrastructure', 'workspace_path_invalid', 'retained workspace inputs are invalid');
  return path.join(os.tmpdir(), `workspine-phase16-consumer-${sha(`${path.resolve(receiptFile)}\0${runId}`).slice(0, 24)}`);
}

function liveReserveRetainedRoot(root) {
  need(path.isAbsolute(root), 'infrastructure', 'workspace_path_invalid', 'retained workspace path must be absolute');
  try {
    fs.mkdirSync(root);
  } catch (error) {
    if (error?.code === 'EEXIST') infrastructureFailure('workspace_exists', 'refusing to reuse an existing retained consumer workspace');
    throw error;
  }
  return root;
}

function liveOwnerAuthoritySnapshot(root = REPO) {
  return Object.fromEntries(OWNER_AUTHORITY_FILES.map((relative) => {
    const file = path.join(root, ...relative.split('/'));
    return [relative, exists(file) ? shaFile(file) : null];
  }));
}

function liveOwnerAuthorityStatus(snapshot, root = REPO) {
  const changed = OWNER_AUTHORITY_FILES.filter((relative) => {
    const file = path.join(root, ...relative.split('/'));
    const current = exists(file) ? shaFile(file) : null;
    return current !== snapshot[relative];
  });
  return { status: changed.length === 0 ? 'unchanged' : 'changed', files: snapshot, changed };
}

function liveAssertOwnerAuthority(snapshot, root = REPO) {
  const status = liveOwnerAuthorityStatus(snapshot, root);
  need(status.status === 'unchanged', 'infrastructure', 'owner_authority_changed', 'source owner authority changed during provider execution', { changed: status.changed });
  return status;
}

function liveAssertRetainedRootIsolation(root, { sourceRoot = REPO, receiptDirectory = null } = {}) {
  need(path.isAbsolute(root), 'infrastructure', 'workspace_path_invalid', 'retained workspace path must be absolute');
  const rootReal = fs.realpathSync(root);
  const checkoutReal = fs.realpathSync(sourceRoot);
  const receiptRoot = receiptDirectory;
  const receiptReal = receiptRoot ? (exists(receiptRoot) ? fs.realpathSync(receiptRoot) : path.resolve(receiptRoot)) : null;
  need(!inside(rootReal, checkoutReal) && !inside(checkoutReal, rootReal), 'infrastructure', 'workspace_checkout_overlap', 'retained workspace overlaps the source checkout');
  need(!receiptReal || (!inside(rootReal, receiptReal) && !inside(receiptReal, rootReal)), 'infrastructure', 'workspace_receipt_overlap', 'retained workspace overlaps the receipt directory');
  let cursor = path.dirname(rootReal);
  while (true) {
    need(!exists(path.join(cursor, '.git')) && !exists(path.join(cursor, '.work')), 'infrastructure', 'workspace_authority_ancestor', 'retained workspace has a repository or planning authority ancestor');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return rootReal;
}

function liveRun(contract, binding, revision, receiptFile, handoffFile) {
  const runDir = path.dirname(receiptFile);
  const runRoot = liveRetainedRoot(receiptFile, binding.run_id);
  let providerInvoked = false;
  let descriptor = null;
  const processes = [];
  const cleanup = { attempted: false, removed: false };
  let evidence = null;
  let versionProbe = null;
  let completedReceipt = null;
  let workspaceToken = `workspace-${sha(binding.run_id).slice(0, 16)}`;
  let toolchain = null;
  let checkpoint = null;
  let inputBundle = null;
  let workspaceCreated = false;
  let ownerAuthority = null;
  let isolationVerified = false;
  try {
    need(binding.kind !== 'docusaurus-browser' || revision.revision.browser_calibration_digest, 'infrastructure', 'browser_pending', 'Docusaurus binding remains pending and cannot execute');
    liveReserveRetainedRoot(runRoot);
    workspaceCreated = true;
    const networkNonce = crypto.randomBytes(16).toString('hex');
    const networkOperationDir = path.join(runDir, `.network-attempt-${binding.run_id}-${networkNonce}`);
    const networkSentinel = path.join(networkOperationDir, 'attempt.json');
    need(inside(runDir, networkOperationDir) && !inside(runRoot, networkOperationDir) && !exists(networkSentinel), 'infrastructure', 'network_guard_sentinel_invalid', 'network sentinel must start absent and remain outside the consumer root');
    fs.mkdirSync(networkOperationDir, { recursive: true });
    liveAssertRetainedRootIsolation(runRoot, { receiptDirectory: runDir });
    isolationVerified = true;
    ownerAuthority = liveOwnerAuthoritySnapshot();
    inputBundle = liveInputBundle(revision, binding, path.join(runRoot, 'inputs'));
    binding.__input_paths = inputBundle;
    const packedArtifact = path.join(runRoot, 'inputs', 'workspine.tgz');
    fs.copyFileSync(revision.candidate.artifact_path, packedArtifact, fs.constants.COPYFILE_EXCL);
    if (binding.kind === 'packed-readme') {
      const readme = revision.revision.readme || revision.revision.consumer_readme || 'Install the frozen Workspine package from workspine.tgz.\n';
      write(path.join(runRoot, 'inputs', 'README.md'), String(readme));
    } else {
      liveBootstrapArtifact(revision, path.join(runRoot, 'candidate'));
    }
    liveValidatePinnedRuntimeFiles(binding.runtime, revision.runtimes[binding.runtime]);
    const providerPin = revision.runtimes[binding.runtime];
    const providerEntry = providerPin.shim_path || providerPin.executable_path || providerPin.target_path;
    descriptor = realAgentResolveProvider(binding.runtime, CORE_RUNTIME_PINS[binding.runtime], process.env, { whereEntries: [providerEntry] });
    need(descriptor, 'infrastructure', 'provider_not_found', `provider was not resolved: ${binding.runtime}`);
    evidence = realAgentProviderEvidence(descriptor, runRoot, process.env);
    liveValidateRuntimePin(binding.runtime, descriptor, evidence, providerPin);
    toolchain = liveToolchain(revision, providerPin, descriptor);
    const versionPin = liveRuntimeVersionPin(revision.runtimes[binding.runtime]);
    const versionRoot = path.join(runRoot, 'version-probe');
    const versionEnv = liveMinimalEnv(versionRoot, revision.revision.revision_id, binding.runtime, toolchain.path);
    const versionGuard = path.join(runRoot, 'network-guard-version.cjs');
    makeNetworkGuard(versionGuard, { sentinelPath: networkSentinel, nonce: networkNonce, role: 'version-probe' });
    versionEnv.NODE_OPTIONS = `--require=${versionGuard}`;
    liveRevisionFiles(revision, versionRoot, revision.runtimes[binding.runtime]);
    const versionResult = realAgentRunProvider(descriptor, ['--version'], { cwd: versionRoot, env: versionEnv, timeout: 30000 });
    providerInvoked = true;
    const versionAttempt = readNetworkAttemptSentinel(networkSentinel, { nonce: networkNonce, role: 'version-probe', pid: versionResult.pid, runDirectory: runDir, operationDirectory: networkOperationDir });
    if (versionAttempt) infrastructureFailure('network_violation', 'network guard observed an attempted connection', { network_attempt: versionAttempt });
    const versionOutput = String(versionResult.stdout || '');
    versionProbe = { status: versionResult.status, timed_out: versionResult.timed_out, stdout_sha256: sha(Buffer.from(versionOutput, 'utf8')), stderr_sha256: sha(Buffer.from(String(versionResult.stderr || ''), 'utf8')), output_bytes: Buffer.byteLength(versionOutput) + Buffer.byteLength(String(versionResult.stderr || '')) };
    need(!versionResult.timed_out && versionResult.status === 0, 'infrastructure', 'runtime_version_probe_failed', 'runtime version probe failed', versionProbe);
    need(versionOutput.includes(versionPin.value), 'infrastructure', 'runtime_version_mismatch', 'runtime version output does not contain the pinned version', versionProbe);
    need(versionProbe.stdout_sha256 === versionPin.hash, 'infrastructure', 'runtime_version_mismatch', 'runtime version output hash differs from the revision', versionProbe);
    for (const name of Object.keys(versionEnv)) delete versionEnv[name];
    let installRecord = null;
    let installed = { status: 0, timed_out: false };
    if (binding.kind !== 'packed-readme') {
      write(path.join(runRoot, 'package.json'), '{"name":"phase16-consumer","private":true}\n');
      const installEnv = liveMinimalEnv(path.join(runRoot, 'install-context'), revision.revision.revision_id, binding.runtime, toolchain.path);
      const installGuard = path.join(runRoot, 'network-guard-install.cjs');
      makeNetworkGuard(installGuard, { sentinelPath: networkSentinel, nonce: networkNonce, role: 'offline-install' });
      installEnv.NODE_OPTIONS = `--require=${installGuard}`;
      installed = run(toolchain.files.node.path, [toolchain.files.npm.path, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-save', packedArtifact], { cwd: runRoot, env: installEnv, timeout: 120000 });
      installRecord = commandRecord(installed, runRoot, installEnv);
      const installAttempt = readNetworkAttemptSentinel(networkSentinel, { nonce: networkNonce, role: 'offline-install', pid: installed.pid, runDirectory: runDir, operationDirectory: networkOperationDir });
      if (installAttempt) infrastructureFailure('network_violation', 'network guard observed an attempted connection', { network_attempt: installAttempt });
      need(installed.status === 0 && !installed.timed_out, 'infrastructure', 'consumer_install_failed', 'frozen package install failed in the retained consumer workspace', installRecord);
      need(exists(path.join(runRoot, 'node_modules', 'workspine', 'bin', 'gsdd.mjs')), 'infrastructure', 'installed_cli_missing', 'frozen Workspine CLI is not reachable from the consumer root');
    }
    const processCount = binding.journey_id === 'brownfield-plan' ? 2 : 1;
    for (let processIndex = 1; processIndex <= processCount; processIndex += 1) {
      const roleRoot = path.join(runRoot, 'contexts', `process-${processIndex}`);
      fs.mkdirSync(roleRoot, { recursive: true });
      const env = liveMinimalEnv(roleRoot, revision.revision.revision_id, binding.runtime, toolchain.path);
      const processRole = `process-${processIndex}`;
      const processGuard = path.join(runRoot, `network-guard-${processRole}.cjs`);
      makeNetworkGuard(processGuard, { sentinelPath: networkSentinel, nonce: networkNonce, role: processRole });
      env.NODE_OPTIONS = `--require=${processGuard}`;
      env.PHASE16_PROCESS_INDEX = String(processIndex);
      env.PHASE16_WORKSPACE_ROOT = runRoot;
      env.PHASE16_NPM_CLI = toolchain.files.npm.path;
      env.PHASE16_PACKED_ARTIFACT = packedArtifact;
      const configFiles = liveRevisionFiles(revision, roleRoot, revision.runtimes[binding.runtime]);
      const secretNames = liveSecretEnv(revision, env);
      const prompt = liveJourneyPrompt({ ...binding, __input_paths: inputBundle }, processIndex);
      const argv = liveJourneyArgv(binding, runRoot, prompt, processIndex);
      realAgentAssertNoOracleExposure({ prompt, argv, env, root: runRoot, label: `journey process ${processIndex} provider input`, allowEnvNames: secretNames });
      const installedCli = path.join(runRoot, 'node_modules', 'workspine', 'bin', 'gsdd.mjs');
      const preexistingInstalledCli = exists(installedCli);
      if (binding.kind === 'packed-readme') need(!preexistingInstalledCli, 'infrastructure', 'packed_preinstall_forbidden', 'packed README journey had an installed CLI before provider launch');
      else need(preexistingInstalledCli, 'infrastructure', 'installed_cli_missing', 'non-packed journey lacks the frozen installed Workspine CLI before provider launch');
      const budget = binding.timeout_seconds;
      need(Number.isInteger(budget) && budget >= 60, 'infrastructure', 'process_budget_invalid', `journey process budget is invalid: ${processIndex}`);
      const redactedArgv = argv.map((value) => scrub(value, runRoot, env));
      const started = Date.now();
      const result = realAgentRunProvider(descriptor, argv, { cwd: runRoot, env, timeout: budget * 1000 });
      providerInvoked = true;
      let exportResult = null;
      let exportInvocation = null;
      const outputResults = [result];
      const outputBytes = () => outputResults.reduce((total, item) => total + Buffer.byteLength(item.stdout || '') + Buffer.byteLength(item.stderr || ''), 0);
      const rawCap = Number(revision.revision.raw_output_limit_bytes || revision.revision.raw_output_cap_bytes || 262144);
      const retainedCap = Number(revision.revision.retained_event_limit_bytes || revision.revision.retained_event_cap_bytes || 65536);
      const providerRecord = commandRecord(result, roleRoot, env);
      const outputEvidence = { stdout_sha256: providerRecord.stdout_sha256, stderr_sha256: providerRecord.stderr_sha256, output_bytes: outputBytes() };
      const invocation = { process_index: processIndex, pid: result.pid, budget_seconds: budget, elapsed_ms: Date.now() - started, argv: redactedArgv, config_files: configFiles, secret_env_names: secretNames, status: result.status, signal: result.signal, error: result.error, output_bytes: outputBytes(), stdout_sha256: providerRecord.stdout_sha256, stderr_sha256: providerRecord.stderr_sha256, install_state: { preexisting_cli: preexistingInstalledCli, reachable_after: exists(installedCli) } };
      let native = null;
      let failure = null;
      let networkAttempt = null;
      let networkSentinelFailure = null;
      try { networkAttempt = readNetworkAttemptSentinel(networkSentinel, { nonce: networkNonce, role: processRole, pid: result.pid, runDirectory: runDir, operationDirectory: networkOperationDir }); }
      catch (error) { networkSentinelFailure = { failure_class: 'infrastructure', failure_code: error.code || 'network_guard_sentinel_invalid', message: error.message }; }
      if (networkSentinelFailure) failure = networkSentinelFailure;
      else if (networkAttempt) failure = { failure_class: 'infrastructure', failure_code: 'network_violation', message: 'network guard observed an attempted connection', network_attempt: networkAttempt };
      else if (!Number.isInteger(rawCap) || rawCap <= 0 || outputBytes() > rawCap) failure = { failure_class: 'infrastructure', failure_code: 'raw_output_cap', message: 'provider output exceeded the frozen raw-output cap' };
      else if (result.timed_out) failure = { failure_class: 'infrastructure', failure_code: 'provider_timeout', message: 'provider exceeded its role budget' };
      else if (result.status !== 0) failure = { failure_class: 'infrastructure', failure_code: 'provider_nonzero', message: 'provider exited nonzero' };
      else {
        try { native = liveParseNative(binding.runtime, result.stdout, binding.model, argv); } catch (error) { failure = { failure_class: error.kind || 'infrastructure', failure_code: error.code || 'native_parse_invalid', message: error.message }; }
      }
      if (!failure && binding.runtime === 'opencode') {
        const exportArgv = ['export', native.session_id, '--sanitize'];
        realAgentAssertNoOracleExposure({ prompt: 'sanitized OpenCode export', argv: exportArgv, env, root: roleRoot, label: 'OpenCode export input' });
        exportResult = realAgentRunProvider(descriptor, exportArgv, { cwd: path.join(roleRoot, 'candidate'), env, timeout: budget * 1000 });
        providerInvoked = true;
        outputResults.push(exportResult);
        exportInvocation = { argv: ['export', '<SESSION_REDACTED>', '--sanitize'], status: exportResult.status, timed_out: exportResult.timed_out, stdout_sha256: sha(String(exportResult.stdout || '')), stderr_sha256: sha(String(exportResult.stderr || '')) };
        let exportAttempt = null;
        try { exportAttempt = readNetworkAttemptSentinel(networkSentinel, { nonce: networkNonce, role: processRole, pid: exportResult.pid, runDirectory: runDir, operationDirectory: networkOperationDir }); }
        catch (error) { failure = { failure_class: 'infrastructure', failure_code: error.code || 'network_guard_sentinel_invalid', message: error.message }; }
        if (!failure && exportAttempt) { networkAttempt = exportAttempt; failure = { failure_class: 'infrastructure', failure_code: 'network_violation', message: 'network guard observed an attempted connection', network_attempt: exportAttempt }; }
        if (!failure && exportResult.timed_out) failure = { failure_class: 'infrastructure', failure_code: 'provider_timeout', message: 'OpenCode export exceeded its role budget' };
        else if (exportResult.status !== 0) failure = { failure_class: 'infrastructure', failure_code: 'provider_nonzero', message: 'OpenCode export exited nonzero' };
        else { try { native.export = liveParseOpenCodeExport(exportResult.stdout, native); native.identity = native.export.identity; } catch (error) { failure = { failure_class: error.kind || 'infrastructure', failure_code: error.code || 'native_export_invalid', message: error.message }; } }
        invocation.export = exportInvocation;
        outputEvidence.export_stdout_sha256 = exportInvocation.stdout_sha256;
        outputEvidence.export_stderr_sha256 = exportInvocation.stderr_sha256;
        outputEvidence.output_bytes = outputBytes();
        if (!failure && outputBytes() > rawCap) failure = { failure_class: 'infrastructure', failure_code: 'raw_output_cap', message: 'provider output exceeded the frozen raw-output cap' };
      }
      invocation.network_attempt = networkAttempt;
      outputEvidence.network_attempt = networkAttempt;
       const eventBytes = Buffer.byteLength(JSON.stringify({ invocation, native, failure }));
      if (!failure && (!Number.isInteger(retainedCap) || retainedCap <= 0 || eventBytes > retainedCap)) failure = { failure_class: 'infrastructure', failure_code: 'retained_event_cap', message: 'retained provider facts exceeded the frozen cap' };
      if (failure) outputEvidence.diagnostic = realAgentFailureDiagnostic(result, roleRoot, env, secretNames.map((name) => env[name]));
      if (!failure && binding.kind === 'packed-readme') need(exists(installedCli), 'infrastructure', 'packed_install_missing', 'packed README provider journey did not install the frozen Workspine CLI');
      processes.push({ process_index: processIndex, context: `<CONSUMER_ROOT>/contexts/process-${processIndex}`, invocation, native: native ? liveSanitizeNative(binding.runtime, native) : null, native_identity: liveIdentityKey(binding.runtime, native), output: outputEvidence, terminal: { status: failure ? 'failed' : 'completed', exit_code: result.status, timed_out: result.timed_out, failure_class: failure?.failure_class || null, failure_code: failure?.failure_code || null, message: failure?.message || null } });
      for (const name of secretNames) delete env[name];
      if (failure) infrastructureFailure(failure.failure_code, failure.message, { process_index: processIndex, ...outputEvidence, network_attempt: failure.network_attempt || null });
      if (binding.journey_id === 'brownfield-plan' && processIndex === 1) checkpoint = liveCaptureCheckpoint(runRoot);
    }
    if (binding.journey_id === 'brownfield-plan') {
      const identities = processes.map((item) => item.native_identity).filter(Boolean);
      need(identities.length === 2 && new Set(identities).size === 2, 'infrastructure', 'native_identity_not_distinct', 'brownfield processes did not produce distinct native identities');
    }
    ownerAuthority = liveAssertOwnerAuthority(ownerAuthority);
    completedReceipt = { schema_version: 2, record_type: 'provider_execution_receipt', mode: 'run', provider_invoked: providerInvoked, workflow_verdict: 'not_evaluated', campaign_revision: { revision_id: revision.revision.revision_id, sha256: revision.sha256 }, campaign: { contract: CORE_CAMPAIGN_CONTRACT, sha256: contract.sha256 }, binding_fingerprint: bindingFingerprint(binding), run_id: binding.run_id, journey_id: binding.journey_id || null, trial_kind: binding.kind, runtime: binding.runtime, workspace: { token: workspaceToken, locator: '<PRIVATE_CONSUMER_ROOT>', realpath_sha256: sha(fs.realpathSync(runRoot)), retained: true, prepared: true }, owner_authority: ownerAuthority, preparation: { frozen_artifact_sha256: revision.candidate.artifact_sha256, frozen_source_hashes: revision.candidate.source_hashes, input_bundle: inputBundle, install: { mode: binding.kind === 'packed-readme' ? 'provider-owned-offline-frozen-artifact' : 'offline-frozen-artifact', command_sha256: installRecord?.stdout_sha256 || null, status: installed.status } }, provider: { logical_command: CORE_RUNTIME_PINS[binding.runtime].command, runtime_version: revision.runtimes[binding.runtime].version || revision.runtimes[binding.runtime].version_string, version_probe: versionProbe, requested_model: binding.model, requested_effort: binding.effort, resolution: evidence, identity_claim: 'requested/native identity only' }, toolchain: { path_allowlist: toolchain.path.map(() => '<TOOLCHAIN_PATH>'), hashes: toolchain.hashes }, candidate: { commit: revision.candidate.commit || revision.revision.candidate?.commit || null, artifact_sha256: revision.candidate.artifact_sha256, member_count: revision.candidate.members.size, entry_path: `<CONSUMER_ROOT>/${revision.candidate.entry_path}`, entry_sha256: revision.candidate.entry_sha256, source_hashes: revision.candidate.source_hashes }, processes, process_count: processes.length, journey: { flow: bindingFlow(binding), process_count: processes.length, checkpoint }, isolation: { verified: isolationVerified, root: '<PRIVATE_CONSUMER_ROOT>', source_checkout_overlap: false, receipt_directory_overlap: false, authority_ancestors: { git: false, work: false }, provider_sandbox: 'not_claimed' }, cleanup, terminal: { status: 'provider_complete', receipt_count: 1, failure_class: null, failure_code: null, message: 'natural consumer journey provider execution completed; workflow was not evaluated' }, claim_limit: 'Provider execution only: native identity, process sequence, exit, timeout, bounded output, frozen installation, retained-root facts, and verified consumer-root location; no lifecycle, artifact, verifier, grader, workflow, or product claim.' };
    return { receipt: completedReceipt, retainedRoot: runRoot };
  } catch (error) {
    const authorityFailure = ownerAuthority && liveOwnerAuthorityStatus(ownerAuthority).status === 'changed';
    if (authorityFailure) error = new ProofFailure('infrastructure', 'owner_authority_changed', 'source owner authority changed during provider execution', { changed: liveOwnerAuthorityStatus(ownerAuthority).changed });
    error.providerInvoked = Boolean(error.providerInvoked || providerInvoked);
    error.providerEvidence = evidence;
    error.versionProbe = versionProbe;
    error.processes = processes;
    error.workspace_created = workspaceCreated;
    error.workspace = { token: workspaceToken, locator: '<PRIVATE_CONSUMER_ROOT>', realpath_sha256: exists(runRoot) ? sha(fs.realpathSync(runRoot)) : null, retained: workspaceCreated, prepared: workspaceCreated, created_by_run: workspaceCreated };
    error.toolchain = toolchain;
    error.checkpoint = checkpoint;
    error.cleanup = cleanup;
    error.ownerAuthority = ownerAuthority ? liveOwnerAuthorityStatus(ownerAuthority) : null;
    error.isolationVerified = isolationVerified;
    error.retainedRoot = runRoot;
    throw error;
  } finally {
    // 00B1 deliberately retains both successful and failed roots.  00C owns
    // observation, grading, and the sole later cleanup transition.
  }
}

function liveBuildHandoff(contract, binding, receiptFile, handoffFile, receipt, root) {
  need(handoffFile && path.isAbsolute(handoffFile), 'infrastructure', 'handoff_path_invalid', 'live run requires an absolute --handoff path');
  need(path.dirname(handoffFile) === path.dirname(receiptFile), 'infrastructure', 'handoff_path_invalid', 'handoff must share the provider receipt directory');
  need(!exists(handoffFile), 'infrastructure', 'handoff_exists', 'refusing to overwrite an existing handoff receipt', { path: slash(handoffFile) });
  need(receipt.workspace?.retained === true && ['provider_complete', 'failed'].includes(receipt.terminal?.status), 'infrastructure', 'handoff_not_ready', 'only a sealed retained provider receipt can be handed off');
  need(receipt.isolation?.verified === true, 'infrastructure', 'handoff_isolation_unverified', 'retained workspace isolation was not verified before handoff');
  const rootExists = Boolean(root && exists(root) && fs.statSync(root).isDirectory());
  need(rootExists, 'infrastructure', 'workspace_missing', 'retained consumer workspace does not exist for handoff');
  liveAssertRetainedRootIsolation(root, { receiptDirectory: path.dirname(receiptFile) });
  const bytes = fs.readFileSync(receiptFile);
  const handoff = {
    schema: 'phase16-retained-workspace-v1', state: receipt.terminal.status === 'failed' ? 'failed' : 'handed_off',
    run_id: binding.run_id, binding_fingerprint: bindingFingerprint(binding),
    campaign: { contract: CORE_CAMPAIGN_CONTRACT, sha256: contract.sha256 },
    workspace_token: receipt.workspace.token, workspace_locator: receipt.workspace.locator,
    workspace_realpath_sha256: receipt.workspace.realpath_sha256,
    provider_receipt_locator: `<RUN_DIR>/${path.basename(receiptFile)}`, provider_receipt_sha256: sha(bytes),
    native_process_identities: (receipt.processes || []).map((item) => item.native_identity),
    path_toolchain_hashes: receipt.toolchain?.hashes || {},
    checkpoint_sha256: receipt.journey.checkpoint?.sha256 || null,
    root_exists: rootExists, failure_code: receipt.terminal.failure_code || null, cleanup: { attempted: false, removed: false },
  };
  realAgentWriteReceipt(handoffFile, handoff);
  const reread = json(handoffFile);
  const providerReread = json(receiptFile);
  need(providerReread.binding_fingerprint === bindingFingerprint(binding) && providerReread.run_id === binding.run_id, 'infrastructure', 'handoff_binding_invalid', 'sealed provider receipt no longer matches its campaign binding');
  const expectedState = receipt.terminal.status === 'failed' ? 'failed' : 'handed_off';
  need(reread.state === expectedState && reread.provider_receipt_sha256 === sha(fs.readFileSync(receiptFile)), 'infrastructure', 'handoff_binding_invalid', 'handoff does not bind the sealed provider receipt or terminal state');
  need(reread.workspace_token === receipt.workspace.token && reread.root_exists === rootExists, 'infrastructure', 'handoff_binding_invalid', 'handoff workspace binding is invalid');
  return handoff;
}

function liveMain(contract) {
  let receiptFile = null;
  let revision = null;
  let binding = null;
  let providerInvoked = false;
  let handoffFile = null;
  try {
    receiptFile = coreArg('--receipt');
    need(receiptFile && path.isAbsolute(receiptFile), 'infrastructure', 'receipt_path_invalid', 'live run requires an absolute --receipt path');
    need(!exists(receiptFile), 'infrastructure', 'receipt_exists', 'refusing to overwrite an existing provider receipt', { path: slash(receiptFile) });
    handoffFile = coreArg('--handoff');
    need(handoffFile && path.isAbsolute(handoffFile), 'infrastructure', 'handoff_path_invalid', 'live run requires an absolute --handoff path');
    need(path.dirname(handoffFile) === path.dirname(receiptFile), 'infrastructure', 'handoff_path_invalid', 'handoff must share the provider receipt directory');
    need(!exists(handoffFile), 'infrastructure', 'handoff_exists', 'refusing to overwrite an existing handoff receipt', { path: slash(handoffFile) });
    liveValidateArguments();
    const revisionFile = coreArg('--campaign-revision');
    need(revisionFile && path.isAbsolute(revisionFile), 'infrastructure', 'campaign_revision_invalid', 'live run requires an absolute --campaign-revision path');
    revision = liveCanonicalRevision(liveRevisionPath(revisionFile));
    const runId = coreArg('--run');
    need(runId, 'product', 'run_required', 'live run requires one explicit --run binding');
    binding = contract.bindings.find((item) => item.run_id === runId);
    need(binding, 'product', 'run_unknown', `unknown campaign binding: ${runId}`);
    need(binding.calibration_digest !== null, 'infrastructure', 'calibration_pending', `binding remains pending: ${runId}`);
    const liveResult = liveRun(contract, binding, revision, receiptFile, handoffFile);
    const receipt = liveResult.receipt;
    realAgentWriteReceipt(receiptFile, receipt);
    liveBuildHandoff(contract, binding, receiptFile, handoffFile, receipt, liveResult.retainedRoot);
    need(exists(liveResult.retainedRoot), 'infrastructure', 'workspace_missing', 'retained consumer workspace disappeared before return');
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'provider_execution_failure', error.message, { stack: error.stack });
    const failed = { schema_version: 2, record_type: 'provider_execution_receipt', mode: 'run', provider_invoked: providerInvoked || Boolean(error.providerInvoked), workflow_verdict: 'not_evaluated', campaign_revision: revision ? { revision_id: revision.revision.revision_id, sha256: revision.sha256 } : null, campaign: { contract: CORE_CAMPAIGN_CONTRACT, sha256: contract.sha256 }, binding_fingerprint: binding ? bindingFingerprint(binding) : null, run_id: binding?.run_id || coreArg('--run'), journey_id: binding?.journey_id || null, trial_kind: binding?.kind || null, runtime: binding?.runtime || null, workspace: error.workspace || { token: null, locator: '<PRIVATE_CONSUMER_ROOT>', realpath_sha256: null, retained: false, prepared: false }, owner_authority: error.ownerAuthority || null, provider: { logical_command: binding ? CORE_RUNTIME_PINS[binding.runtime].command : null, version_probe: error.versionProbe || null, requested_model: binding?.model || null, requested_effort: binding?.effort || null, resolution: error.providerEvidence || null, identity_claim: error.providerEvidence ? 'requested/native identity only' : 'none' }, toolchain: error.toolchain ? { path_allowlist: error.toolchain.path?.map(() => '<TOOLCHAIN_PATH>') || [], hashes: error.toolchain.hashes || {} } : null, processes: error.processes || [], process_count: (error.processes || []).length, journey: { flow: binding ? bindingFlow(binding) : [], process_count: (error.processes || []).length, checkpoint: error.checkpoint || null }, isolation: { verified: Boolean(error.isolationVerified), root: '<PRIVATE_CONSUMER_ROOT>', provider_sandbox: 'not_claimed' }, cleanup: { attempted: false, removed: false }, terminal: { status: 'failed', receipt_count: 1, failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, claim_limit: 'No workflow claim: provider execution failed or was not admitted; workflow_verdict remains not_evaluated.' };
    if (receiptFile && path.isAbsolute(receiptFile) && !exists(receiptFile)) {
      try { realAgentWriteReceipt(receiptFile, failed); } catch { /* stdout remains the authoritative failure when the path is unsafe */ }
    }
    const retainedRoot = error.retainedRoot || null;
    if (receiptFile && handoffFile && binding && exists(receiptFile) && !exists(handoffFile) && error.workspace_created === true && retainedRoot && exists(retainedRoot)) {
      try {
        liveBuildHandoff(contract, binding, receiptFile, handoffFile, failed, retainedRoot);
      } catch (handoffError) {
        failed.terminal.evidence = { ...(failed.terminal.evidence || {}), handoff_failure: { failure_code: handoffError.code || 'handoff_validation_failed', message: handoffError.message } };
        try { realAgentWriteReceipt(receiptFile, failed); } catch { /* the JSON stdout below remains the failure record */ }
      }
    }
    process.stdout.write(`${JSON.stringify(failed, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function coreMain() {
  let receiptFile = null;
  try {
    const campaignFile = coreCampaignFile(coreArg('--campaign'));
    const contract = coreReadCampaign(campaignFile);
    need(!coreFlag('--real-agent'), 'product', 'legacy_mode_forbidden', 'the historical --real-agent mode is not an executable authority');
    if (coreFlag('--campaign-revision')) {
      liveMain(contract);
      return;
    }
    const verifyPackFile = coreArg('--verify-pack') || coreArg('--grade-pack');
    if (verifyPackFile) {
      const packFile = path.resolve(verifyPackFile);
      need(exists(packFile), 'infrastructure', 'audit_pack_missing', 'audit pack file is missing', { file: slash(packFile) });
      const verdict = auditValidatePack(json(packFile), contract);
      process.stdout.write(`${JSON.stringify({ ...verdict, provider_invoked: false, terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'audit pack re-graded deterministically' } }, null, 2)}\n`);
      return;
    }
    if (coreFlag('--check')) {
      const result = { schema_version: 2, record_type: 'campaign_check', mode: 'check', campaign: { contract: CORE_CAMPAIGN_CONTRACT, file: slash(campaignFile), sha256: contract.sha256 }, matrix: { journeys: contract.journeys.size, bindings: contract.bindings.length, core: contract.bindings.filter((binding) => binding.kind === 'core').length, auxiliary: 3, calibrated: 20, pending: 1 }, provider_invoked: false, critical_witnesses: CRITICAL_WITNESSES, terminal: { status: 'passed', failure_class: null, failure_code: null, message: '21-binding campaign schema and critical-witness contract passed; 20 calibrated, 1 browser-pending' }, claim_limit: 'Schema and command construction only; no provider or product claim.' };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (coreFlag('--simulate')) {
      const simulation = coreArg('--simulate');
      need(simulation === 'success', 'product', 'simulation_mode_invalid', 'only --simulate success is admitted');
      const runId = coreArg('--run', 'core-treesnap-codex-1');
      const binding = contract.bindings.find((item) => item.run_id === runId);
      need(binding, 'product', 'run_unknown', `unknown campaign binding: ${runId}`);
      receiptFile = coreArg('--receipt');
      need(receiptFile && path.isAbsolute(receiptFile), 'infrastructure', 'receipt_path_invalid', 'simulation requires an absolute --receipt path');
      const receipt = coreSimulation(contract, binding);
      realAgentWriteReceipt(receiptFile, receipt);
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }
    need(coreFlag('--dry-run'), 'infrastructure', 'dry_run_required', 'only --check, --simulate success, --verify-pack, or --dry-run are admitted; provider execution is deferred');
    const runId = coreArg('--run');
    need(runId, 'product', 'run_required', 'dry-run requires one explicit --run binding');
    const binding = contract.bindings.find((item) => item.run_id === runId);
    need(binding, 'product', 'run_unknown', `unknown campaign binding: ${runId}`);
    receiptFile = coreArg('--receipt');
    need(receiptFile && path.isAbsolute(receiptFile), 'infrastructure', 'receipt_path_invalid', 'dry-run requires an absolute --receipt path');
    const receipt = coreDryRun(contract, binding);
    realAgentWriteReceipt(receiptFile, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const failure = error instanceof ProofFailure ? error : new ProofFailure('infrastructure', 'core_flow_argument_failure', error.message, { stack: error.stack });
    const failed = { schema_version: 2, record_type: 'terminal_receipt', mode: coreFlag('--simulate') ? 'simulate' : 'dry-run', provider_invoked: false, terminal: { status: 'failed', receipt_count: 1, failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, claim_limit: 'No product claim: core-flow campaign validation, simulation, or dry-run failed.' };
    if (receiptFile && path.isAbsolute(receiptFile) && !exists(receiptFile)) realAgentWriteReceipt(receiptFile, failed);
    process.stdout.write(`${JSON.stringify(failed, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) coreMain();

// Pure native parsers are exported for the synthetic live matrix. Requiring
// this evaluator never runs a provider or campaign command.
module.exports = {
  readNetworkAttemptSentinel,
  liveMinimalEnv,
  realAgentResolveProvider,
  realAgentRunProvider,
  realAgentInvocationArgv,
  realAgentProviderEvidence,
  liveParseCodex,
  liveParseClaude,
  liveParseOpenCode,
  liveParseOpenCodeExport,
  liveParseNative,
  liveTarEntries,
  liveCanonicalRevision,
  liveBootstrapArtifact,
  liveMemberPath,
  liveRetainedRoot,
  liveReserveRetainedRoot,
  bindingFingerprint,
  liveOwnerAuthoritySnapshot,
  liveOwnerAuthorityStatus,
  liveAssertOwnerAuthority,
  liveAssertRetainedRootIsolation,
  liveBuildHandoff,
  bindingFlow,
  bindingRequiredSkills,
  liveCaptureCheckpoint,
};
