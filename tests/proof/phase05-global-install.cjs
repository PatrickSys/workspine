#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPOSITORY_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const RUNNER_RELATIVE = 'tests/proof/phase05-global-install.cjs';
const NODE_20_VERSION = 'v20.0.0';
const TARGETS = Object.freeze(['claude', 'opencode', 'codex']);
const COMMAND_ORDER = Object.freeze([
  { id: 'repo-init', argv: ['init'] },
  { id: 'repo-health', argv: ['health'] },
  { id: 'repo-update', argv: ['update'] },
  ...TARGETS.map((target) => ({ id: `global-fresh-${target}`, argv: ['install', '--global', '--tools', target], target, phase: 'fresh' })),
  ...TARGETS.map((target) => ({ id: `global-repair-${target}`, argv: ['install', '--global', '--tools', target], target, phase: 'repair' })),
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
  return {
    command,
    argv: args,
    cwd: options.cwd || REPOSITORY_ROOT,
    status: result.status,
    signal: result.signal || null,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdout: boundedOutput(result.stdout),
    stderr: boundedOutput(result.stderr),
  };
}

function locateNode20() {
  const candidates = [];
  const add = (candidate) => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (!candidates.includes(resolved)) candidates.push(resolved);
  };
  add(process.env.GSDD_NODE20_PATH);
  add(path.join(process.env.NVM_HOME || '', 'v20.0.0', 'node.exe'));
  add(path.join(process.env.APPDATA || '', 'nvm', 'v20.0.0', 'node.exe'));
  add(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'));
  const found = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const result = run(candidate, ['--version'], { cwd: REPOSITORY_ROOT, timeout: 15000 });
    found.push({ executable: candidate, result });
    if (result.status === 0 && result.stdout.trim() === NODE_20_VERSION) return { executable: fs.realpathSync(candidate), probe: result, candidates: found };
  }
  return { executable: null, probe: null, candidates: found };
}

function scrubEnvironment(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|NODE_PATH|npm_config_|NPM_CONFIG_|GIT_CONFIG|GIT_.*HELPER|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|CLAUDE_CONFIG_DIR|OPENCODE_CONFIG_DIR|CODEX_HOME|XDG_CONFIG_HOME|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP)$/.test(key)) delete env[key];
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

function catalog() {
  return {
    schema: 'gsdd.phase05.global-install.v1',
    acceptance: false,
    classification: 'catalog_only',
    governancePreflight: { command: 'node bin/gsdd.mjs lifecycle-preflight plan 05', argv: ['bin/gsdd.mjs', 'lifecycle-preflight', 'plan', '05'], evidence: 'setup_only' },
    nodeIdentities: [NODE_20_VERSION, 'current-supported-node'],
    commandOrder: COMMAND_ORDER,
    targets: TARGETS,
    exclusions: ['update-awareness', 'authenticated/model sessions', 'P05-07', 'P05-10', 'network/public registry', 'release/publication', 'Git mutation'],
  };
}

function development() {
  const receipt = {
    schema: 'gsdd.phase05.global-install.v1',
    acceptance: false,
    classification: 'running',
    commandOrder: COMMAND_ORDER,
    targets: TARGETS,
    protectedBefore: protectedSnapshot(),
    node: { current: { executable: fs.realpathSync(process.execPath), version: process.version }, node20: null },
    cleanup: { status: 'not_started' },
    claimLimit: 'One packed candidate, one local isolated runner, repo init-health-update and per-target global install plus repeat repair only; no update-awareness, auth/model, network, release, Git mutation, or Phase-05 closure claim.',
  };
  const node20 = locateNode20();
  receipt.node.node20 = node20;
  if (!node20.executable) {
    receipt.classification = 'setup_failed';
    receipt.reason = `exact ${NODE_20_VERSION} executable unavailable; network/download fallback is prohibited`;
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
  const pack = run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'pack', '--ignore-scripts', '--audit=false', '--fund=false', '--pack-destination', packageRoot], { cwd: REPOSITORY_ROOT, env, timeout: 120000 });
  receipt.pack = pack;
  if (pack.status !== 0) { receipt.classification = 'setup_failed'; receipt.reason = 'local npm pack failed'; receipt.protectedAfter = protectedSnapshot(); receipt.cleanup.status = safeRemove(proofRoot) ? 'passed' : 'failed'; return receipt; }
  const tarballName = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  const tarball = path.join(packageRoot, tarballName);
  receipt.package.tarball = { path: tarball, sha256: sha256Bytes(fs.readFileSync(tarball)) };
  const install = run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'install', '--global', '--ignore-scripts', '--offline', '--prefix', installRoot, tarball], { cwd: installRoot, env, timeout: 120000 });
  receipt.install = install;
  if (install.status !== 0) { receipt.classification = 'setup_failed'; receipt.reason = 'local tarball install failed'; receipt.protectedAfter = protectedSnapshot(); receipt.cleanup.status = safeRemove(proofRoot) ? 'passed' : 'failed'; return receipt; }
  const installedEntry = path.join(installRoot, 'node_modules', packageJson.name, 'bin', 'gsdd.mjs');
  if (!fs.existsSync(installedEntry)) { receipt.classification = 'provenance_failure'; receipt.reason = `installed entry missing: ${installedEntry}`; receipt.protectedAfter = protectedSnapshot(); receipt.cleanup.status = safeRemove(proofRoot) ? 'passed' : 'failed'; return receipt; }
  receipt.installedEntry = { path: fs.realpathSync(installedEntry), sha256: sha256Bytes(fs.readFileSync(installedEntry)) };

  const lanes = [];
  for (const nodeLane of [{ id: 'node20.0.0', executable: node20.executable }, { id: 'current-supported-node', executable: process.execPath }]) {
    const laneRoot = path.join(proofRoot, nodeLane.id);
    fs.mkdirSync(laneRoot, { recursive: true });
    const repoRoot = path.join(laneRoot, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });
    const lane = { id: nodeLane.id, executable: nodeLane.executable, version: run(nodeLane.executable, ['--version'], { cwd: laneRoot, env, timeout: 15000 }), commands: [] };
    if (lane.version.status !== 0 || lane.version.stdout.trim() !== (nodeLane.id === 'node20.0.0' ? NODE_20_VERSION : process.version)) { receipt.classification = 'setup_failed'; receipt.reason = `runtime identity mismatch for ${nodeLane.id}`; lanes.push(lane); break; }
    for (const spec of COMMAND_ORDER) {
      const cwd = spec.id.startsWith('repo-') ? repoRoot : path.join(laneRoot, `global-${spec.target}`);
      fs.mkdirSync(cwd, { recursive: true });
      const before = fileIdentity(cwd);
      const commandReceipt = run(nodeLane.executable, [installedEntry, ...spec.argv], { cwd, env: { ...env, GSDD_TEST_HOME: path.join(cwd, 'isolated-home') }, timeout: 120000 });
      const after = fileIdentity(cwd);
      lane.commands.push({ ...spec, cwd, before, after, result: commandReceipt });
      if (commandReceipt.status !== 0) { receipt.classification = 'product_gap'; receipt.reason = `${spec.id} failed`; break; }
    }
    lanes.push(lane);
    if (receipt.classification !== 'running') break;
  }
  receipt.lanes = lanes;
  receipt.protectedAfter = protectedSnapshot();
  receipt.cleanup.status = safeRemove(proofRoot) ? 'passed' : 'failed';
  if (receipt.classification === 'running') receipt.classification = 'partial_evidence';
  return receipt;
}

function main() {
  const mode = process.argv[2];
  let output;
  if (mode === '--catalog') output = catalog();
  else if (mode === '--development') output = development();
  else {
    console.error('Usage: node tests/proof/phase05-global-install.cjs --catalog|--development');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.classification === 'setup_failed' || output.classification === 'product_gap' || output.classification === 'provenance_failure') process.exitCode = 1;
}

main();
