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

function realAgentAssertNoOracleExposure({ prompt = '', argv = [], env = {}, root, label = 'provider input' }) {
  const values = [prompt, ...argv.map(String), ...Object.entries(env).flatMap(([key, value]) => [key, value])];
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


function realAgentWriteReceipt(file, receipt) {
  need(file && path.isAbsolute(file), 'infrastructure', 'receipt_path_invalid', 'receipt path must be absolute', { file });
  need(!exists(file), 'infrastructure', 'receipt_exists', 'refusing to overwrite an existing receipt', { file: slash(file) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
}


// Task 16-05-01 deliberately admits only construction and dry-run checks. The
// old 16-04A contract is historical evidence, not an executable campaign.
const CORE_CAMPAIGN_SCHEMA_VERSION = 1;
const CORE_CAMPAIGN_CONTRACT = 'phase16-core-flows.v1';
const CORE_CAMPAIGN_APPROVAL = '16-05 owner approval 2026-08-26';
const HISTORICAL_SCENARIO_SHA256 = 'D66601B028C92CB520011DFE9DC669190FD45F3AE435BC722D2AF395DDDA4504';
const CORE_RUNTIME_PINS = Object.freeze({
  codex: Object.freeze({ command: 'codex', model: 'gpt-5.6-luna', effort: 'high' }),
  claude: Object.freeze({ command: 'claude', model: 'claude-sonnet-5', effort: 'high' }),
  opencode: Object.freeze({ command: 'opencode', model: 'openai/gpt-5.6-luna', effort: 'high' }),
});
const CORE_JOURNEYS = Object.freeze({
  treesnap: Object.freeze({
    kind: 'core', title: 'Greenfield new-project treesnap journey',
    flow: Object.freeze(['setup', 'health', 'new-project', 'plan', 'execute', 'verify']),
    artifact_family: 'project-plan-summary-verification', timeout_seconds: 3300,
  }),
  'brownfield-plan': Object.freeze({
    kind: 'core', title: 'Brownfield plan pause and fresh-resume journey',
    flow: Object.freeze(['setup', 'health', 'brownfield-plan', 'pause', 'fresh-resume', 'execute', 'verify', 'progress']),
    artifact_family: 'brownfield-change-checkpoint', timeout_seconds: 3300,
  }),
  'brownfield-quick': Object.freeze({
    kind: 'core', title: 'Brownfield quick and verify journey',
    flow: Object.freeze(['setup', 'health', 'quick', 'verify']),
    artifact_family: 'quick-change', timeout_seconds: 3300,
  }),
});
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
  need(binding.grader_mode === 'deterministic-only' && binding.advisory_judge === false, 'product', 'binding_grader_invalid', `binding is not deterministic-only: ${binding.run_id}`);
  need(Array.isArray(binding.critical_witnesses) && binding.critical_witnesses.length === 0, 'product', 'critical_witnesses_present', `critical witnesses must be deferred: ${binding.run_id}`);
  if (binding.kind === 'core') {
    need(typeof binding.journey_id === 'string' && journeys.has(binding.journey_id), 'product', 'binding_journey_invalid', `core binding references unknown journey: ${binding.run_id}`);
    const journey = journeys.get(binding.journey_id);
    need(binding.flow && stableStringify(binding.flow) === stableStringify(journey.flow), 'product', 'binding_flow_invalid', `core binding flow mismatch: ${binding.run_id}`);
    need(binding.required_artifact_family === journey.required_artifact_family, 'product', 'binding_artifact_invalid', `core binding artifact family mismatch: ${binding.run_id}`);
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
  need(campaign.authority === 'live-evaluation' && campaign.execution === 'dry-run-only-until-16-05-02', 'product', 'campaign_authority_invalid', 'campaign is not explicitly bounded to the Task 16-05-01 dry-run lane');
  need(campaign.historical_scenario_sha256 === HISTORICAL_SCENARIO_SHA256, 'product', 'historical_hash_invalid', 'campaign does not pin the immutable historical scenario bytes');
  need(Array.isArray(campaign.journeys) && campaign.journeys.length === 3, 'product', 'journey_count_invalid', 'campaign must contain exactly three core journeys');
  const journeys = new Map();
  for (const journey of campaign.journeys) {
    const fixed = CORE_JOURNEYS[journey?.id];
    need(fixed && journey.id === journey.id.toLowerCase(), 'product', 'journey_id_invalid', `unsupported journey: ${journey?.id}`);
    need(!journeys.has(journey.id), 'product', 'journey_duplicate', `duplicate journey: ${journey.id}`);
    need(journey.kind === fixed.kind && journey.title === fixed.title, 'product', 'journey_metadata_invalid', `journey metadata mismatch: ${journey.id}`);
    need(stableStringify(journey.flow) === stableStringify(fixed.flow), 'product', 'journey_flow_invalid', `journey flow mismatch: ${journey.id}`);
    need(journey.required_artifact_family === fixed.artifact_family && journey.timeout_seconds === fixed.timeout_seconds, 'product', 'journey_contract_invalid', `journey contract mismatch: ${journey.id}`);
    need(Array.isArray(journey.critical_witnesses) && journey.critical_witnesses.length === 0, 'product', 'critical_witnesses_present', `journey critical witnesses must be deferred: ${journey.id}`);
    journeys.set(journey.id, journey);
  }
  need(stableStringify([...journeys.keys()].sort()) === stableStringify(Object.keys(CORE_JOURNEYS).sort()), 'product', 'journey_matrix_invalid', 'campaign journeys are not the exact three approved core journeys');
  need(Array.isArray(campaign.bindings) && campaign.bindings.length === 27, 'product', 'binding_count_invalid', 'campaign must contain exactly 27 trial bindings');
  const ids = new Set();
  for (const binding of campaign.bindings) { need(!ids.has(binding?.run_id), 'product', 'binding_duplicate', `duplicate binding: ${binding?.run_id}`); ids.add(binding?.run_id); coreValidateBinding(binding, journeys); }
  const core = campaign.bindings.filter((binding) => binding.kind === 'core');
  need(core.length === 18, 'product', 'core_matrix_invalid', 'core matrix must contain 18 trials');
  for (const journey of journeys.keys()) for (const runtime of CORE_RUNTIME_IDS) {
    const rows = core.filter((binding) => binding.journey_id === journey && binding.runtime === runtime);
    need(rows.length === 2 && rows.every((binding) => [1, 2].includes(binding.repetition)), 'product', 'core_matrix_invalid', `core matrix must have two repetitions for ${journey}/${runtime}`);
  }
  for (const kind of ['scripted-owner', 'packed-readme', 'docusaurus-browser']) need(campaign.bindings.filter((binding) => binding.kind === kind).length === 3, 'product', 'auxiliary_matrix_invalid', `${kind} must contain exactly three trials`);
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
      schema_version: 1, record_type: 'terminal_receipt', mode: 'dry-run', provider_invoked: false,
      campaign: { contract: CORE_CAMPAIGN_CONTRACT, sha256: contract.sha256 },
      run_id: binding.run_id, trial_kind: binding.kind, runtime: binding.runtime,
      provider: { logical_command: provider.command, model: provider.model, effort: provider.effort, resolution: 'deferred_until_task_16_05_02' },
      argv: redactedArgv, isolation: { root: '<EPHEMERAL_DRY_RUN_ROOT>', provider_readable_paths: [], writable_roots: ['<EPHEMERAL_DRY_RUN_ROOT>'] },
      critical_witnesses: { status: 'deferred', count: 0 },
      cleanup, terminal: { status: 'passed', failure_class: null, failure_code: null, message: '27-binding construction and dry-run contract passed' },
      claim_limit: 'No provider execution, product behavior, critical-witness, artifact, or reliability claim; Task 16-05-01 contract construction only.',
    };
    return receipt;
  } finally {
    cleanup.attempted = true;
    try { fs.rmSync(root, { recursive: true, force: false, maxRetries: 3, retryDelay: 25 }); cleanup.removed = !exists(root); } catch (error) { cleanup.error = error.message; }
  }
}

function coreMain() {
  let receiptFile = null;
  try {
    const campaignFile = coreCampaignFile(coreArg('--campaign'));
    const contract = coreReadCampaign(campaignFile);
    need(!coreFlag('--real-agent'), 'product', 'legacy_mode_forbidden', 'the historical --real-agent mode is not an executable authority');
    if (coreFlag('--check')) {
      const result = { schema_version: 1, record_type: 'campaign_check', mode: 'check', campaign: { contract: CORE_CAMPAIGN_CONTRACT, file: slash(campaignFile), sha256: contract.sha256 }, matrix: { journeys: contract.journeys.size, bindings: contract.bindings.length, core: contract.bindings.filter((binding) => binding.kind === 'core').length, auxiliary: 9 }, provider_invoked: false, critical_witnesses: 'deferred-to-task-16-05-02', terminal: { status: 'passed', failure_class: null, failure_code: null, message: '27-binding campaign schema passed' }, claim_limit: 'Schema and command construction only; no provider or product claim.' };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    need(coreFlag('--dry-run'), 'infrastructure', 'dry_run_required', 'Task 16-05-01 permits only --check or --dry-run; provider execution is deferred');
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
    const failed = { schema_version: 1, record_type: 'terminal_receipt', mode: 'dry-run', provider_invoked: false, terminal: { status: 'failed', failure_class: failure.kind, failure_code: failure.code, message: failure.message, evidence: failure.evidence || null }, claim_limit: 'No product claim: core-flow campaign validation or dry-run failed.' };
    if (receiptFile && path.isAbsolute(receiptFile) && !exists(receiptFile)) realAgentWriteReceipt(receiptFile, failed);
    process.stdout.write(`${JSON.stringify(failed, null, 2)}\n`);
    process.exitCode = 1;
  }
}

coreMain();

