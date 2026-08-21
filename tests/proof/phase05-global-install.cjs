#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPOSITORY_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const RUNNER_RELATIVE = 'tests/proof/phase05-global-install.cjs';
const SUPPORTED_NODE_MAJOR = 22;
const TARGETS = Object.freeze(['claude', 'opencode', 'codex']);
const COMMAND_ORDER = Object.freeze([
  { id: 'repo-init', argv: ['init'], entrypoint: 'public' },
  { id: 'repo-control-map', argv: ['control-map', '--json'], entrypoint: 'generated-helper' },
  { id: 'repo-next', argv: ['next', '--json'], entrypoint: 'generated-helper' },
  { id: 'repo-health', argv: ['health'], entrypoint: 'public' },
  { id: 'repo-update', argv: ['update'], entrypoint: 'public' },
  ...TARGETS.map((target) => ({ id: `global-fresh-${target}`, argv: ['install', '--global', '--tools', target], target, phase: 'fresh', entrypoint: 'public' })),
  ...TARGETS.map((target) => ({ id: `global-repair-${target}`, argv: ['install', '--global', '--tools', target], target, phase: 'repair', entrypoint: 'public' })),
]);
const PROTECTED_INPUTS = Object.freeze([
  '.work.zip',
  'deep-research-report-decision-driven-second.md',
  'deep-research-report-decision-driven.md',
  'workspine.zip',
]);

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function losslessSorted(value) {
  if (Array.isArray(value)) return value.map(losslessSorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(ordinalCompare).map((key) => [key, losslessSorted(value[key])]));
  return value;
}

function packageMemberLedger(packed) {
  if (!Array.isArray(packed.files) || packed.files.length === 0) throw new Error('npm pack --json package object lacks a non-empty files member set');
  const seen = new Set();
  const members = packed.files.map((member, index) => {
    if (!member || typeof member !== 'object' || Array.isArray(member)) throw new Error(`npm pack --json member ${index} was not an object`);
    const memberPath = member.path;
    if (typeof memberPath !== 'string' || !memberPath || memberPath.includes('\\') || memberPath.includes('\0') || memberPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(memberPath)) throw new Error(`npm pack --json member ${index} has an invalid path`);
    const parts = memberPath.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`npm pack --json member ${index} has an invalid path: ${memberPath}`);
    if (!Number.isSafeInteger(member.size) || member.size < 0) throw new Error(`npm pack --json member ${index} has an invalid size`);
    if (!Number.isSafeInteger(member.mode) || member.mode < 0 || member.mode > 0o777) throw new Error(`npm pack --json member ${index} has an invalid mode`);
    if (seen.has(memberPath)) throw new Error(`npm pack --json member paths contained a duplicate: ${memberPath}`);
    seen.add(memberPath);
    return losslessSorted(member);
  });
  return members.sort((left, right) => ordinalCompare(left.path, right.path));
}

function fileIdentity(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    const identity = { type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file', size: stat.size, mode: stat.mode & 0o777 };
    if (identity.type === 'file') identity.sha256 = sha256Bytes(fs.readFileSync(filePath));
    if (identity.type === 'symlink') identity.target = fs.readlinkSync(filePath);
    return identity;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isContained(root, candidate, strict = false) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (strict && relative === '') return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolvedPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return path.resolve(filePath);
    throw error;
  }
}

function assertContainedPath(proofRoot, filePath, declaredConfigFiles = []) {
  const absolute = path.resolve(filePath);
  const resolved = resolvedPath(absolute);
  if (isContained(proofRoot, resolved)) return;
  const isDeclaredConfig = declaredConfigFiles.some((declared) => path.resolve(declared) === absolute);
  if (isDeclaredConfig && isContained(proofRoot, absolute) && !fs.existsSync(absolute)) return;
  throw new Error(`resolved isolated path escaped proof root: ${absolute} -> ${resolved}`);
}

function snapshotTree(root, proofRoot, declaredConfigFiles = []) {
  const entries = [];
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort(ordinalCompare)) {
      const fullPath = path.join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      assertContainedPath(proofRoot, fullPath, declaredConfigFiles);
      const stat = fs.lstatSync(fullPath);
      const entry = { path: relativePath, type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other', size: stat.size, mode: stat.mode & 0o777 };
      if (entry.type === 'file') entry.sha256 = sha256Bytes(fs.readFileSync(fullPath));
      if (entry.type === 'symlink') entry.target = fs.readlinkSync(fullPath);
      entries.push(entry);
      if (entry.type === 'directory') visit(fullPath, relativePath);
    }
  }
  visit(root);
  return entries;
}

function snapshotRoot(root, proofRoot, declaredConfigFiles = []) {
  const absolute = path.resolve(root);
  assertContainedPath(proofRoot, absolute, declaredConfigFiles);
  const identity = fileIdentity(absolute);
  if (!identity) return { path: absolute, type: 'missing', size: null, mode: null, entries: [] };
  const snapshot = { path: absolute, type: identity.type, size: identity.size, mode: identity.mode, entries: [] };
  if (identity.type === 'file') snapshot.sha256 = identity.sha256;
  if (identity.type === 'symlink') {
    snapshot.target = identity.target;
    return snapshot;
  }
  if (identity.type === 'directory') snapshot.entries = snapshotTree(absolute, proofRoot, declaredConfigFiles);
  return snapshot;
}

function snapshotRoots(roots, proofRoot, declaredConfigFiles = []) {
  return Object.fromEntries(Object.keys(roots).sort(ordinalCompare).map((name) => [name, snapshotRoot(roots[name], proofRoot, declaredConfigFiles)]));
}

function protectedSnapshot() {
  return Object.fromEntries(PROTECTED_INPUTS.map((relativePath) => [relativePath, fileIdentity(path.join(REPOSITORY_ROOT, relativePath))]));
}

function boundedOutput(value, max = 12000) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 120000,
    input: options.input,
  });
  const stdout = String(result.stdout || '');
  const receipt = {
    command,
    argv: args,
    cwd: options.cwd || REPOSITORY_ROOT,
    status: result.status,
    signal: result.signal || null,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdout: boundedOutput(stdout),
    stderr: boundedOutput(result.stderr),
  };
  if (options.captureRawStdout) receipt.stdoutRaw = stdout;
  return receipt;
}

function scrubEnvironment(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|NODE_PATH|GSDD_WORKSPACE_ROOT|npm_config_|NPM_CONFIG_|GIT_CONFIG|GIT_.*HELPER|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|CLAUDE_CONFIG_DIR|OPENCODE_CONFIG_DIR|CODEX_HOME|XDG_CONFIG_HOME|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP)$/.test(key)) delete env[key];
  }
  env.HOME = path.join(root, 'home');
  env.USERPROFILE = env.HOME;
  env.APPDATA = path.join(root, 'appdata');
  env.LOCALAPPDATA = path.join(root, 'localappdata');
  env.TEMP = path.join(root, 'temp');
  env.TMP = env.TEMP;
  env.XDG_CONFIG_HOME = path.join(root, 'xdg-config');
  env.CLAUDE_CONFIG_DIR = path.join(root, 'claude-config');
  env.OPENCODE_CONFIG_DIR = path.join(root, 'opencode-config');
  env.CODEX_HOME = path.join(root, 'codex-home');
  env.GSDD_TEST_HOME = path.join(root, 'gsdd-test-home');
  env.NPM_CONFIG_CACHE = path.join(root, 'npm-cache');
  env.NPM_CONFIG_PREFIX = path.join(root, 'npm-prefix');
  env.NPM_CONFIG_USERCONFIG = path.join(root, 'npmrc');
  env.NPM_CONFIG_GLOBALCONFIG = path.join(root, 'npm-globalrc');
  env.npm_config_cache = env.NPM_CONFIG_CACHE;
  env.npm_config_prefix = env.NPM_CONFIG_PREFIX;
  env.npm_config_userconfig = env.NPM_CONFIG_USERCONFIG;
  env.npm_config_globalconfig = env.NPM_CONFIG_GLOBALCONFIG;
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  env.npm_config_registry = 'http://127.0.0.1:9/closed';
  return env;
}

function ensureDirectories(root) {
  for (const name of ['home', 'appdata', 'localappdata', 'temp', 'xdg-config', 'claude-config', 'opencode-config', 'codex-home', 'gsdd-test-home', 'npm-cache', 'npm-prefix']) fs.mkdirSync(path.join(root, name), { recursive: true });
}

function safeRemove(root) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('gsdd-phase05-06r-')) throw new Error(`refusing cleanup outside exact temp prefix: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finish(receipt, proofRoot) {
  receipt.protectedAfter = protectedSnapshot();
  if (!sameSnapshot(receipt.protectedBefore, receipt.protectedAfter)) {
    receipt.classification = 'provenance_failure';
    receipt.reason = 'protected inputs changed during the run';
  }
  receipt.cleanup.status = safeRemove(proofRoot) ? 'passed' : 'failed';
  if (receipt.cleanup.status !== 'passed') {
    receipt.classification = 'provenance_failure';
    receipt.reason = 'isolated proof root cleanup failed';
  }
  return receipt;
}

function catalog() {
  return {
    schema: 'gsdd.phase05.global-install.v1',
    acceptance: false,
    classification: 'catalog_only',
    governancePreflight: { command: 'node bin/gsdd.mjs lifecycle-preflight plan 05', argv: ['bin/gsdd.mjs', 'lifecycle-preflight', 'plan', '05'], evidence: 'setup_only' },
    nodeIdentities: ['invoking-process.execPath', 'supported-major-floor-22'],
    commandOrder: COMMAND_ORDER,
    targets: TARGETS,
    exclusions: ['update-awareness', 'authenticated/model sessions', 'P05-07', 'P05-10', 'network/public registry', 'release/publication', 'Git mutation'],
  };
}

function development() {
  const runtimeExecutable = fs.realpathSync(process.execPath);
  const runtimeVersion = process.version;
  const runtimeMajor = Number(process.versions.node.split('.')[0]);
  const receipt = {
    schema: 'gsdd.phase05.global-install.v1',
    acceptance: false,
    classification: 'running',
    commandOrder: COMMAND_ORDER,
    targets: TARGETS,
    protectedBefore: protectedSnapshot(),
    node: { executable: runtimeExecutable, version: runtimeVersion, major: runtimeMajor },
    cleanup: { status: 'not_started' },
    claimLimit: 'One packed candidate, one local isolated consumer run under the invoking runtime, public init-health-update and per-target global install plus repeat repair, and generated-helper control-map/next only; no update-awareness, auth/model, network, release, Git mutation, or Phase-05 closure claim.',
  };
  if (!Number.isInteger(runtimeMajor) || runtimeMajor < SUPPORTED_NODE_MAJOR) {
    receipt.classification = 'setup_failed';
    receipt.reason = `invoking runtime ${runtimeVersion} is below the supported package floor Node ${SUPPORTED_NODE_MAJOR}`;
    receipt.protectedAfter = protectedSnapshot();
    receipt.cleanup.status = 'not_started_no_temp_root';
    return receipt;
  }

  const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase05-06r-'));
  receipt.proofRoot = proofRoot;
  const env = scrubEnvironment(proofRoot);
  ensureDirectories(proofRoot);
  const packageRoot = path.join(proofRoot, 'package-source');
  const installRoot = path.join(proofRoot, 'installed');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
  receipt.package = { name: packageJson.name, version: packageJson.version, declaredBin: packageJson.bin };
  const candidate = run('git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, env, timeout: 15000 });
  if (candidate.status !== 0 || !/^[0-9a-f]{40}$/i.test(candidate.stdout.trim())) { receipt.classification = 'setup_failed'; receipt.reason = 'candidate HEAD could not be reconciled'; receipt.candidate = candidate; return finish(receipt, proofRoot); }
  receipt.candidate = { head: candidate.stdout.trim() };
  const pack = run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'pack', '--ignore-scripts', '--audit=false', '--fund=false', '--json', '--pack-destination', packageRoot], { cwd: REPOSITORY_ROOT, env, timeout: 120000, captureRawStdout: true });
  const rawPackStdout = pack.stdoutRaw || '';
  delete pack.stdoutRaw;
  receipt.pack = pack;
  if (pack.status !== 0) { receipt.classification = 'setup_failed'; receipt.reason = 'local npm pack failed'; return finish(receipt, proofRoot); }
  let packJson;
  try { packJson = JSON.parse(rawPackStdout); } catch (error) { receipt.classification = 'provenance_failure'; receipt.reason = `npm pack --json output was not valid JSON: ${error.message}`; return finish(receipt, proofRoot); }
  if (!Array.isArray(packJson) || packJson.length !== 1 || !packJson[0] || typeof packJson[0] !== 'object' || Array.isArray(packJson[0])) { receipt.classification = 'provenance_failure'; receipt.reason = 'npm pack --json output was not one unambiguous package object'; return finish(receipt, proofRoot); }
  const packed = packJson[0];
  let memberLedger;
  try { memberLedger = packageMemberLedger(packed); } catch (error) { receipt.classification = 'provenance_failure'; receipt.reason = error.message; return finish(receipt, proofRoot); }
  if (typeof packed.filename !== 'string' || !packed.filename.trim() || typeof packed.integrity !== 'string' || !packed.integrity.trim()) { receipt.classification = 'provenance_failure'; receipt.reason = 'npm pack --json package object lacks non-empty filename or integrity'; return finish(receipt, proofRoot); }
  const tarballName = packed.filename.trim();
  if (path.basename(tarballName) !== tarballName) { receipt.classification = 'provenance_failure'; receipt.reason = `npm pack --json filename was not a contained tarball name: ${tarballName}`; return finish(receipt, proofRoot); }
  const tarball = path.join(packageRoot, tarballName);
  if (!fs.existsSync(tarball)) { receipt.classification = 'provenance_failure'; receipt.reason = `npm pack --json filename missing from pack destination: ${tarballName}`; return finish(receipt, proofRoot); }
  receipt.package.pack = { filename: tarballName, integrity: packed.integrity.trim(), memberLedger };
  receipt.package.tarball = { path: tarball, sha256: sha256Bytes(fs.readFileSync(tarball)) };
  const install = run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'install', '--global', '--ignore-scripts', '--offline', '--prefix', installRoot, tarball], { cwd: installRoot, env, timeout: 120000 });
  receipt.install = install;
  if (install.status !== 0) { receipt.classification = 'setup_failed'; receipt.reason = 'local tarball install failed'; return finish(receipt, proofRoot); }
  const installedPackage = path.join(installRoot, 'node_modules', packageJson.name);
  const installedEntryCandidate = path.join(installedPackage, 'bin', 'gsdd.mjs');
  if (!fs.existsSync(installedEntryCandidate)) { receipt.classification = 'provenance_failure'; receipt.reason = `installed entry missing: ${installedEntryCandidate}`; return finish(receipt, proofRoot); }
  let installedPackageJson;
  try {
    installedPackageJson = JSON.parse(fs.readFileSync(path.join(installedPackage, 'package.json'), 'utf8'));
  } catch (error) {
    receipt.classification = 'provenance_failure';
    receipt.reason = `installed package identity could not be read: ${error.message}`;
    return finish(receipt, proofRoot);
  }
  const installedPackageResolved = resolvedPath(installedPackage);
  const installedEntry = resolvedPath(installedEntryCandidate);
  const installRootResolved = resolvedPath(installRoot);
  if (!isContained(installRootResolved, installedPackageResolved, true) || !isContained(installRootResolved, installedEntry, true)) {
    receipt.classification = 'provenance_failure';
    receipt.reason = `real installed entry escaped isolated install root: ${installedEntry}`;
    return finish(receipt, proofRoot);
  }
  if (isContained(REPOSITORY_ROOT, installedPackageResolved) || isContained(REPOSITORY_ROOT, installedEntry)) {
    receipt.classification = 'provenance_failure';
    receipt.reason = `real installed entry resolved into the source repository: ${installedEntry}`;
    return finish(receipt, proofRoot);
  }
  if (installedPackageJson.name !== packageJson.name || installedPackageJson.version !== packageJson.version || JSON.stringify(losslessSorted(installedPackageJson.bin)) !== JSON.stringify(losslessSorted(packageJson.bin)) || installedPackageJson.bin?.gsdd !== 'bin/gsdd.mjs') {
    receipt.classification = 'provenance_failure';
    receipt.reason = 'installed package name, version, or bin identity drifted from the packed candidate';
    return finish(receipt, proofRoot);
  }
  const installedEntrySha256 = sha256Bytes(fs.readFileSync(installedEntry));
  const sourceEntrySha256 = sha256Bytes(fs.readFileSync(path.join(REPOSITORY_ROOT, 'bin', 'gsdd.mjs')));
  if (installedEntrySha256 !== sourceEntrySha256) {
    receipt.classification = 'provenance_failure';
    receipt.reason = 'real installed entry hash drifted from the candidate source entry';
    return finish(receipt, proofRoot);
  }
  receipt.installedEntry = {
    path: installedEntry,
    sha256: installedEntrySha256,
    packageRoot: installedPackageResolved,
    package: { name: installedPackageJson.name, version: installedPackageJson.version, declaredBin: installedPackageJson.bin },
  };

  const laneRoot = path.join(proofRoot, 'consumer');
  fs.mkdirSync(laneRoot, { recursive: true });
  const repoRoot = path.join(laneRoot, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  const helperPath = path.join(repoRoot, '.work', 'bin', 'gsdd.mjs');
  const lane = {
    id: 'invoking-runtime',
    executable: runtimeExecutable,
    version: runtimeVersion,
    repoRoot,
    generatedHelper: { intended: helperPath, resolved: null },
    isolatedRoots: null,
    snapshots: { before: null, after: null },
    commands: [],
  };
  const runtimeRoots = {};
  for (const spec of COMMAND_ORDER) {
    const cwd = spec.id.startsWith('repo-') ? repoRoot : path.join(laneRoot, `global-${spec.target}`);
    runtimeRoots[spec.id] = path.join(cwd, 'isolated-home');
  }
  const declaredConfigFiles = [env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG];
  const isolatedRoots = {
    appdata: env.APPDATA,
    claudeConfig: env.CLAUDE_CONFIG_DIR,
    codexHome: env.CODEX_HOME,
    gsddTestHome: env.GSDD_TEST_HOME,
    home: env.HOME,
    install: installRoot,
    localappdata: env.LOCALAPPDATA,
    npmCache: env.NPM_CONFIG_CACHE,
    npmGlobalConfig: env.NPM_CONFIG_GLOBALCONFIG,
    npmPrefix: env.NPM_CONFIG_PREFIX,
    npmUserConfig: env.NPM_CONFIG_USERCONFIG,
    opencodeConfig: env.OPENCODE_CONFIG_DIR,
    repo: repoRoot,
    temp: env.TEMP,
    xdgConfig: env.XDG_CONFIG_HOME,
    ...Object.fromEntries(Object.entries(runtimeRoots).map(([id, root]) => [`runtime:${id}`, root])),
  };
  try {
    for (const root of Object.values(isolatedRoots)) assertContainedPath(proofRoot, root, declaredConfigFiles);
    lane.isolatedRoots = isolatedRoots;
    lane.snapshots.before = snapshotRoots(isolatedRoots, proofRoot, declaredConfigFiles);
  } catch (error) {
    receipt.classification = 'provenance_failure';
    receipt.reason = `isolated root containment or before-snapshot failed: ${error.message}`;
    receipt.lanes = [lane];
    return finish(receipt, proofRoot);
  }
  let generatedHelper = null;
  for (const spec of COMMAND_ORDER) {
    const cwd = spec.id.startsWith('repo-') ? repoRoot : path.join(laneRoot, `global-${spec.target}`);
    fs.mkdirSync(cwd, { recursive: true });
    const before = fileIdentity(cwd);
    const entrypoint = spec.entrypoint === 'generated-helper' ? generatedHelper : installedEntry;
    const args = ['repo-init', 'repo-health', 'repo-update'].includes(spec.id)
      ? [...spec.argv, '--workspace-root', repoRoot]
      : spec.argv;
    if (!entrypoint) {
      receipt.classification = 'product_gap';
      receipt.reason = `${spec.id} requires the generated helper after repo init`;
      lane.commands.push({ ...spec, argv: args, cwd, before, after: fileIdentity(cwd), result: null });
      break;
    }
    const commandReceipt = run(runtimeExecutable, [entrypoint, ...args], { cwd, env: { ...env, GSDD_TEST_HOME: path.join(cwd, 'isolated-home') }, timeout: 120000 });
    const after = fileIdentity(cwd);
    lane.commands.push({ ...spec, argv: args, cwd, entrypoint, result: commandReceipt, before, after });
    if (commandReceipt.status !== 0) { receipt.classification = 'product_gap'; receipt.reason = `${spec.id} failed`; break; }
    if (spec.id === 'repo-init') {
      if (!fs.existsSync(helperPath)) { receipt.classification = 'product_gap'; receipt.reason = 'generated .work/bin/gsdd.mjs missing after repo init'; break; }
      generatedHelper = fs.realpathSync(helperPath);
      try {
        assertContainedPath(proofRoot, generatedHelper);
      } catch (error) {
        receipt.classification = 'provenance_failure';
        receipt.reason = `generated helper escaped the isolated proof root: ${error.message}`;
        break;
      }
      lane.generatedHelper.resolved = generatedHelper;
      lane.generatedHelper.sha256 = sha256Bytes(fs.readFileSync(generatedHelper));
    }
  }
  try {
    lane.snapshots.after = snapshotRoots(isolatedRoots, proofRoot, declaredConfigFiles);
  } catch (error) {
    receipt.classification = 'provenance_failure';
    receipt.reason = `isolated root containment or after-snapshot failed: ${error.message}`;
  }
  receipt.lanes = [lane];
  if (receipt.classification === 'running') receipt.classification = 'partial_evidence';
  return finish(receipt, proofRoot);
}

function main() {
  const mode = process.argv[2];
  let output;
  if (mode === '--catalog') output = catalog();
  else if (mode === '--development') output = development();
  else {
    console.error(`Usage: node ${RUNNER_RELATIVE} --catalog|--development`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.classification === 'setup_failed' || output.classification === 'product_gap' || output.classification === 'provenance_failure') process.exitCode = 1;
}

main();
