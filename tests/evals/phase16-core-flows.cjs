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
const SKILL_FOR_PHASE = Object.freeze({
  'new-project': 'work-new-project', plan: 'work-plan', 'brownfield-plan': 'work-plan', 'plan-check': 'work-plan',
  pause: 'work-pause', 'fresh-resume': 'work-resume', execute: 'work-execute', verify: 'work-verify',
  progress: 'work-progress', quick: 'work-quick',
});
const SKILL_WITNESS = 'generated-skill-observations';

function bindingFlow(binding) {
  if (binding.kind === 'core') return binding.flow;
  if (binding.run_id === 'owner-scripted-pause-resume') return ['setup', 'health', 'pause', 'fresh-resume', 'verify'];
  if (binding.run_id === 'owner-scripted-plan-check') return ['setup', 'health', 'plan-check'];
  if (binding.run_id === 'owner-scripted-verify') return ['setup', 'health', 'verify'];
  return ['setup', 'health'];
}

function bindingRequiredSkills(binding) {
  return bindingFlow(binding).map((phase) => SKILL_FOR_PHASE[phase]).filter(Boolean).filter((id, index, values) => values.indexOf(id) === index);
}

function bindingCriticalWitnesses(binding) {
  const required = bindingRequiredSkills(binding);
  const needsFreshResume = binding?.journey_id === 'brownfield-plan' || binding?.run_id === 'owner-scripted-pause-resume';
  return CRITICAL_WITNESSES.filter((id) => (id !== SKILL_WITNESS || required.length > 0) && (id !== FRESH_PAUSE_RESUME_WITNESS || needsFreshResume));
}

function journeyRequiredSkills(journeyId) {
  const journey = CORE_JOURNEYS[journeyId];
  return journey ? journey.flow.map((phase) => SKILL_FOR_PHASE[phase]).filter(Boolean).filter((id, index, values) => values.indexOf(id) === index) : [];
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
    need(journey.required_artifact_family === fixed.artifact_family && journey.timeout_seconds === fixed.timeout_seconds, 'product', 'journey_contract_invalid', `journey contract mismatch: ${journey.id}`);
    need(Array.isArray(journey.critical_witnesses) && stableStringify(journey.critical_witnesses) === stableStringify(journeyCriticalWitnesses(journey.id)), 'product', 'critical_witness_contract_invalid', `journey critical witness contract mismatch: ${journey.id}`);
    need(stableStringify(journey.required_skills) === stableStringify(journeyRequiredSkills(journey.id)), 'product', 'required_skills_contract_invalid', `journey required skill declaration mismatch: ${journey.id}`);
    journeys.set(journey.id, journey);
  }
  need(stableStringify([...journeys.keys()].sort()) === stableStringify(Object.keys(CORE_JOURNEYS).sort()), 'product', 'journey_matrix_invalid', 'campaign journeys are not the exact three approved core journeys');
  need(Array.isArray(campaign.bindings) && campaign.bindings.length === 27, 'product', 'binding_count_invalid', 'campaign must contain exactly 27 trial bindings');
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
  for (const kind of ['scripted-owner', 'packed-readme', 'docusaurus-browser']) need(campaign.bindings.filter((binding) => binding.kind === kind).length === 3, 'product', 'auxiliary_matrix_invalid', `${kind} must contain exactly three trials`);
  need(campaign.bindings.filter((binding) => binding.calibration_digest !== null).length === 24, 'product', 'calibration_admission_count_invalid', 'exactly 24 bindings must be calibrated before the browser gate');
  need(campaign.bindings.filter((binding) => binding.calibration_digest === null).length === 3, 'product', 'calibration_pending_count_invalid', 'exactly three browser bindings must remain pending');
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
      argv: redactedArgv, isolation: { root: '<EPHEMERAL_DRY_RUN_ROOT>', provider_readable_paths: [], writable_roots: ['<EPHEMERAL_DRY_RUN_ROOT>'] },
      critical_witnesses: { status: 'deferred-to-simulation', required: CRITICAL_WITNESSES },
      cleanup, terminal: { status: 'passed', failure_class: null, failure_code: null, message: '27-binding construction and provider-free dry-run contract passed' },
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
  const journey = binding.journey_id ? contract.journeys.get(binding.journey_id) : { flow: ['setup', 'health', 'plan-check', 'execute', 'verify'], required_artifact_family: binding.required_artifact_family || binding.kind };
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

function coreMain() {
  let receiptFile = null;
  try {
    const campaignFile = coreCampaignFile(coreArg('--campaign'));
    const contract = coreReadCampaign(campaignFile);
    need(!coreFlag('--real-agent'), 'product', 'legacy_mode_forbidden', 'the historical --real-agent mode is not an executable authority');
    const verifyPackFile = coreArg('--verify-pack') || coreArg('--grade-pack');
    if (verifyPackFile) {
      const packFile = path.resolve(verifyPackFile);
      need(exists(packFile), 'infrastructure', 'audit_pack_missing', 'audit pack file is missing', { file: slash(packFile) });
      const verdict = auditValidatePack(json(packFile), contract);
      process.stdout.write(`${JSON.stringify({ ...verdict, provider_invoked: false, terminal: { status: 'passed', failure_class: null, failure_code: null, message: 'audit pack re-graded deterministically' } }, null, 2)}\n`);
      return;
    }
    if (coreFlag('--check')) {
      const result = { schema_version: 2, record_type: 'campaign_check', mode: 'check', campaign: { contract: CORE_CAMPAIGN_CONTRACT, file: slash(campaignFile), sha256: contract.sha256 }, matrix: { journeys: contract.journeys.size, bindings: contract.bindings.length, core: contract.bindings.filter((binding) => binding.kind === 'core').length, auxiliary: 9, calibrated: 24, pending: 3 }, provider_invoked: false, critical_witnesses: CRITICAL_WITNESSES, terminal: { status: 'passed', failure_class: null, failure_code: null, message: '27-binding campaign schema and critical-witness contract passed; 24 calibrated, 3 browser-pending' }, claim_limit: 'Schema and command construction only; no provider or product claim.' };
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

coreMain();

