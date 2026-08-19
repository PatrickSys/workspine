#!/usr/bin/env node
'use strict';

// Explicit Phase 05 proof command. It is intentionally outside ordinary test
// discovery: it starts a private loopback registry and launches npx children.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const REPOSITORY_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const SELF_PATH = 'tests/proof/phase05-blind-npx.cjs';
const DEVELOPMENT_ARGUMENT = '--development-harness';
const FIXED_CANDIDATE = '6cbfb2adfc1e3933ff4f4da0a4322206ff7c1c6e';
// PACKAGE_NAME/PACKAGE_FILENAME are resolved in materializeAndPack from the pinned candidate's
// own package.json (verified there against PACKAGE_NAME_SHA256), not hardcoded here.
let PACKAGE_NAME;
const PACKAGE_NAME_SHA256 = '3d6ba3e906da8acdf14e02590217a79bb10a106074c6d50c721dae4fe0e78694';
const PACKAGE_VERSION = '0.32.0';
let PACKAGE_FILENAME;
const PACKAGE_BIN = 'bin/gsdd.mjs';
const PACKAGE_JSON_SHA256 = 'ec2a562ae51b7e14087c1d14c9eb6d48472e1ac4da9033b410418695a9788058';
const README_SHA256 = 'c96ff2362341b0ee7599ec4db72b0bbe31a654934afe136f20927b0dfe37cc60';
const ENTRY_SHA256 = '2bb044333f94cccbce99439c106684329ff3be6d5d62880f206e63e4290d3728';
const TARBALL_SHA256 = '86cd25cd7bf6d44a6e60d3a7063afe31a76c2ba15d0f50709b63a2143f8301b0';
const TARBALL_SRI = 'sha512-x4LuaxRNmFCSlHYevyVQ7H5W+vt77Lz681Nci+XmgShSpbyyZF2bqhwT1ec5hW3RdknrpZWqq1fKnBaqvxhZxw==';
const TARBALL_MEMBERS = 113;
const OUTPUT_LIMIT_BYTES = 12 * 1024;
const RAW_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const COMMAND_BUDGET_MS = 120 * 1000;
const REAP_GRACE_MS = 5 * 1000;
const REGISTRY_CLOSE_MS = 5 * 1000;
const NEXT_STATES = Object.freeze(['ask_user', 'research', 'plan', 'execute', 'verify', 'audit', 'fix_gaps', 'dogfood', 'pause', 'blocked', 'complete']);
const PROTECTED_INPUTS = Object.freeze([
  ['.work.zip', 356000, '36158acba6dda63a17dde4e5bc288fbd17e6297d3964f6729dc33baa72fb5f2b'],
  ['deep-research-report-decision-driven-second.md', 38875, '3e12c48f66065136830551acc80fb02afce59d7ff50f0b6c37627102f2dbd4d2'],
  ['deep-research-report-decision-driven.md', 36427, 'c6c1a6b58d0c90c933f4ac35d79feda7fc5a95805bfddca2a3f04da9bab904f8'],
  ['workspine.zip', 6691999, '83184a0ed5a6f46e6586a454ab06e5e2ac2bad3078fccc58f933ebcbf6d65127'],
]);

// These are the exact outputs reached in the retained 05-01 user-root escape.
// They are read-only snapshots; this runner never creates host-root canaries.
const KNOWN_USER_ROOT_RISKS = Object.freeze([
  'AGENTS.md',
  '.work/generation-manifest.json',
  '.work/bin/gsdd', '.work/bin/gsdd.cmd', '.work/bin/gsdd.mjs', '.work/bin/gsdd.ps1',
  ...['atomic-write', 'candidate-provenance', 'cli-utils', 'control-map', 'decision-cli', 'file-ops', 'git-identity', 'lifecycle-preflight', 'lifecycle-state', 'next', 'phase', 'state-dir', 'work-context', 'workspace-root'].map((name) => `.work/bin/lib/${name}.mjs`),
  ...['audit-milestone', 'complete-milestone', 'execute', 'map-codebase', 'new-milestone', 'new-project', 'pause', 'plan', 'progress', 'quick', 'resume', 'verify', 'verify-work'].map((name) => `.agents/skills/gsdd-${name}/SKILL.md`),
]);

class ProofFailure extends Error {
  constructor(classification, message, cause = null) {
    super(message);
    this.classification = classification;
    this.cause = cause;
  }
}

function fail(classification, message, cause = null) {
  throw new ProofFailure(classification, message, cause);
}

function requireCondition(condition, classification, message, cause = null) {
  if (!condition) fail(classification, message, cause);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha512Sri(bytes) {
  return `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
}

function normalized(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!!relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function outputReceipt(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  const truncated = bytes.length > OUTPUT_LIMIT_BYTES;
  const visible = !truncated ? bytes : Buffer.concat([
    bytes.subarray(0, OUTPUT_LIMIT_BYTES / 2),
    Buffer.from('\n...[output truncated by proof runner]...\n', 'utf8'),
    bytes.subarray(bytes.length - (OUTPUT_LIMIT_BYTES / 2)),
  ]);
  return { bytes: bytes.length, sha256: sha256(bytes), truncated, text: visible.toString('utf8') };
}

function rawOutput(result, stream) {
  return result[`_${stream}`].toString('utf8');
}

function commandReceipt(result) {
  return {
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: Boolean(result.timedOut),
    outputLimitExceeded: Boolean(result.outputLimitExceeded),
    childTreeReaped: result.childTreeReaped !== false,
    termination: result.termination || null,
    elapsedMs: result.elapsedMs,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function command(file, args, options = {}) {
  const startedAt = Date.now();
  const result = childProcess.spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const receipt = {
    command: file,
    args,
    cwd: options.cwd || process.cwd(),
    exitCode: result.status === null ? -1 : result.status,
    signal: result.signal || null,
    timedOut: false,
    elapsedMs: Date.now() - startedAt,
    stdout: outputReceipt(result.stdout || Buffer.alloc(0)),
    stderr: outputReceipt(result.stderr || Buffer.alloc(0)),
  };
  Object.defineProperties(receipt, {
    _stdout: { value: Buffer.from(result.stdout || ''), enumerable: false },
    _stderr: { value: Buffer.from(result.stderr || ''), enumerable: false },
  });
  return receipt;
}

function requireSuccess(result, classification, description) {
  if (result.exitCode !== 0) throw new ProofFailure(classification, `${description} failed with exit ${result.exitCode}`, commandReceipt(result));
  return result;
}

function git(args) {
  return requireSuccess(command('git', args, { cwd: REPOSITORY_ROOT }), 'setup_failure', `git ${args.join(' ')}`);
}

function snapshotTree(root) {
  const output = [];
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const fullPath = path.join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) output.push({ path: relativePath, type: 'link', target: fs.readlinkSync(fullPath) });
      else if (stat.isDirectory()) {
        output.push({ path: `${relativePath}/`, type: 'directory' });
        visit(fullPath, relativePath);
      } else if (stat.isFile()) output.push({ path: relativePath, type: 'file', bytes: stat.size, sha256: sha256(fs.readFileSync(fullPath)) });
      else output.push({ path: relativePath, type: 'other' });
    }
  }
  if (fs.existsSync(root)) visit(root);
  return output;
}

function snapshotRoot(root) {
  const absolutePath = path.resolve(root);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { path: absolutePath, exists: false, type: 'missing', realPath: null, entries: [] };
    fail('harness_failure', `could not snapshot declared root: ${absolutePath}`, { code: error.code, message: error.message });
  }
  if (stat.isSymbolicLink()) return { path: absolutePath, exists: true, type: 'link', target: fs.readlinkSync(absolutePath), realPath: null, entries: [] };
  if (stat.isDirectory()) return { path: absolutePath, exists: true, type: 'directory', realPath: fs.realpathSync(absolutePath), entries: snapshotTree(absolutePath) };
  if (stat.isFile()) {
    const bytes = fs.readFileSync(absolutePath);
    return { path: absolutePath, exists: true, type: 'file', bytes: bytes.length, sha256: sha256(bytes), realPath: fs.realpathSync(absolutePath), entries: [] };
  }
  return { path: absolutePath, exists: true, type: 'other', realPath: null, entries: [] };
}

function snapshotRoots(roots) {
  return Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, snapshotRoot(root)]));
}

function protectedManifest() {
  return PROTECTED_INPUTS.map(([relativePath, expectedBytes, expectedHash]) => {
    const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath));
    requireCondition(bytes.length === expectedBytes, 'provenance_failure', `${relativePath} byte length drifted`);
    requireCondition(sha256(bytes) === expectedHash, 'provenance_failure', `${relativePath} SHA-256 drifted`);
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function hostUserRoot() {
  const home = fs.realpathSync(os.homedir());
  const repositoryDerived = fs.realpathSync(path.resolve(REPOSITORY_ROOT, '..', '..'));
  requireCondition(home === repositoryDerived, 'setup_failure', 'host user-root and repository-derived user-root disagree', { home, repositoryDerived });
  return home;
}

function userRootRiskSnapshot() {
  const root = hostUserRoot();
  return { root, entries: Object.fromEntries(KNOWN_USER_ROOT_RISKS.map((relativePath) => [relativePath, snapshotRoot(path.join(root, relativePath))])) };
}

function assertSameSnapshot(before, after, classification, message) {
  requireCondition(JSON.stringify(before) === JSON.stringify(after), classification, message);
}

function requireNonemptyRegularFile(filePath, classification, description) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') fail(classification, `${description} is missing`);
    fail(classification, `${description} could not be inspected`, { code: error.code, message: error.message });
  }
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, classification, `${description} was not a nonempty regular file`);
  return stat;
}

function requireAbsentPath(filePath, classification, description) {
  try {
    fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    fail(classification, `${description} could not be inspected`, { code: error.code, message: error.message });
  }
  fail(classification, `${description} exists (including a dangling link)`);
}

function writeCanary(filePath, name) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`phase05 blind-npx ${name} canary\n`, 'utf8');
  fs.writeFileSync(filePath, bytes, { flag: 'wx' });
  return { path: filePath, bytes: bytes.length, sha256: sha256(bytes) };
}

function verifyCanaries(canaries) {
  for (const canary of canaries) {
    requireCondition(fs.existsSync(canary.path), 'containment_failure', `canary was removed: ${canary.path}`);
    const bytes = fs.readFileSync(canary.path);
    requireCondition(bytes.length === canary.bytes && sha256(bytes) === canary.sha256, 'containment_failure', `canary changed: ${canary.path}`);
  }
}

function assertContainedRoots(proofRoot, roots) {
  for (const [name, root] of Object.entries(roots)) {
    requireCondition(isInside(proofRoot, root), 'containment_failure', `${name} root escaped proof root: ${root}`);
    const parent = fs.existsSync(root) && fs.lstatSync(root).isDirectory() ? root : path.dirname(root);
    requireCondition(isInside(proofRoot, parent), 'containment_failure', `${name} root parent escaped proof root: ${parent}`);
  }
}

function safeRemove(proofRoot) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const realRoot = fs.realpathSync(proofRoot);
  requireCondition(isInside(tempRoot, realRoot), 'cleanup_failure', `refusing to remove path outside OS temp: ${realRoot}`);
  requireCondition(path.basename(realRoot).startsWith('gsdd-phase05-blind-npx-'), 'cleanup_failure', `refusing to remove unexpected temp root: ${realRoot}`);
  fs.rmSync(realRoot, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
  return { target: realRoot, tempRoot };
}

function candidateState(developmentMode) {
  const head = rawOutput(git(['rev-parse', '--verify', 'HEAD']), 'stdout').trim().toLowerCase();
  requireCondition(/^[0-9a-f]{40}$/.test(head), 'provenance_failure', 'HEAD did not resolve to a full commit');
  const tracked = git(['status', '--porcelain=v1', '--untracked-files=no', '--', '.']);
  requireCondition(rawOutput(tracked, 'stdout') === '', 'provenance_failure', 'tracked or index drift prevents proof');
  const untracked = rawOutput(git(['ls-files', '--others', '--exclude-standard']), 'stdout').split(/\r?\n/).filter(Boolean).sort();
  const allowed = PROTECTED_INPUTS.map(([relativePath]) => relativePath).concat(developmentMode ? [SELF_PATH] : []).sort();
  requireCondition(JSON.stringify(untracked) === JSON.stringify(allowed), 'provenance_failure', 'untracked inputs do not match the protected/development allowlist', { untracked, allowed });
  if (developmentMode) {
    requireCondition(head === FIXED_CANDIDATE, 'provenance_failure', `development mode requires candidate HEAD ${FIXED_CANDIDATE}, received ${head}`);
  } else {
    const parentLine = rawOutput(git(['rev-list', '--parents', '-n', '1', head]), 'stdout').trim().split(/\s+/);
    requireCondition(parentLine.length === 2 && parentLine[0] === head && parentLine[1] === FIXED_CANDIDATE, 'provenance_failure', 'default mode requires one non-merge proof-runner commit directly atop the fixed candidate', { parentLine });
    const runnerDelta = rawOutput(git(['diff', '--name-only', `${FIXED_CANDIDATE}..${head}`]), 'stdout').split(/\r?\n/).filter(Boolean).sort();
    requireCondition(JSON.stringify(runnerDelta) === JSON.stringify([SELF_PATH]), 'provenance_failure', 'default mode requires exactly the committed proof-runner delta', { runnerDelta });
  }
  return { candidate: FIXED_CANDIDATE, proofRunnerHead: head, trackedStatus: commandReceipt(tracked), untracked, protectedInputs: protectedManifest() };
}

function isolatedEnvironment(root) {
  const home = path.join(root, 'home');
  const cache = path.join(root, 'npm-cache');
  const prefix = path.join(root, 'npm-prefix');
  const temp = path.join(root, 'temp');
  const userConfig = path.join(root, 'npmrc');
  const globalConfig = path.join(root, 'npm-globalrc');
  const runtimeConfig = path.join(root, 'runtime-config');
  const guardBin = path.join(root, 'guard-bin');
  for (const directory of [home, cache, prefix, temp, runtimeConfig, guardBin]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(userConfig, '# phase05 blind npx userconfig\n', { flag: 'wx' });
  fs.writeFileSync(globalConfig, '# phase05 blind npx globalconfig\n', { flag: 'wx' });
  const canaries = [
    writeCanary(path.join(home, 'HOME-CANARY.txt'), 'home'),
    writeCanary(path.join(cache, 'CACHE-CANARY.txt'), 'cache'),
    writeCanary(path.join(prefix, 'PREFIX-CANARY.txt'), 'prefix'),
    writeCanary(path.join(temp, 'TEMP-CANARY.txt'), 'temp'),
    writeCanary(path.join(runtimeConfig, 'RUNTIME-CANARY.txt'), 'runtime'),
    { path: userConfig, bytes: fs.statSync(userConfig).size, sha256: sha256(fs.readFileSync(userConfig)) },
    { path: globalConfig, bytes: fs.statSync(globalConfig).size, sha256: sha256(fs.readFileSync(globalConfig)) },
  ];
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const sentinel = 'GSDD_PHASE05_AMBIENT_GSDD_GUARD';
  const nodeExecutable = fs.realpathSync(process.execPath);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(guardBin, 'node.cmd'), `@echo off\r\n"${nodeExecutable}" %*\r\n`, { flag: 'wx' });
    fs.writeFileSync(path.join(guardBin, 'gsdd.cmd'), `@echo ${sentinel} 1>&2\r\nexit /b 97\r\n`, { flag: 'wx' });
  } else {
    fs.writeFileSync(path.join(guardBin, 'node'), `#!/bin/sh\nexec "${nodeExecutable}" "$@"\n`, { flag: 'wx', mode: 0o700 });
    fs.writeFileSync(path.join(guardBin, 'gsdd'), `#!/bin/sh\necho ${sentinel} >&2\nexit 97\n`, { flag: 'wx', mode: 0o700 });
  }
  canaries.push(
    { path: process.platform === 'win32' ? path.join(guardBin, 'node.cmd') : path.join(guardBin, 'node'), bytes: fs.statSync(process.platform === 'win32' ? path.join(guardBin, 'node.cmd') : path.join(guardBin, 'node')).size, sha256: sha256(fs.readFileSync(process.platform === 'win32' ? path.join(guardBin, 'node.cmd') : path.join(guardBin, 'node'))) },
    { path: process.platform === 'win32' ? path.join(guardBin, 'gsdd.cmd') : path.join(guardBin, 'gsdd'), bytes: fs.statSync(process.platform === 'win32' ? path.join(guardBin, 'gsdd.cmd') : path.join(guardBin, 'gsdd')).size, sha256: sha256(fs.readFileSync(process.platform === 'win32' ? path.join(guardBin, 'gsdd.cmd') : path.join(guardBin, 'gsdd'))) },
  );
  const systemPath = [guardBin, path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter);
  const roots = { home, cache, prefix, userConfig, globalConfig, temp, runtimeConfig, guardBin };
  return {
    roots,
    canaries,
    guard: { bin: guardBin, sentinel, npxCmd: resolveNpxCmd(), childPath: systemPath, excludedAmbientNodeDirectory: path.dirname(nodeExecutable) },
    env: {
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      ComSpec: process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe'),
      PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
      PATH: systemPath,
      Path: systemPath,
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: path.join(runtimeConfig, 'xdg-config'),
      XDG_CACHE_HOME: path.join(runtimeConfig, 'xdg-cache'),
      XDG_DATA_HOME: path.join(runtimeConfig, 'xdg-data'),
      CODEX_HOME: path.join(runtimeConfig, 'codex'),
      CLAUDE_CONFIG_DIR: path.join(runtimeConfig, 'claude'),
      CLAUDE_HOME: path.join(runtimeConfig, 'claude'),
      OPENCODE_CONFIG_DIR: path.join(runtimeConfig, 'opencode'),
      OPENCODE_DATA_DIR: path.join(runtimeConfig, 'opencode'),
      NPM_CONFIG_CACHE: cache,
      npm_config_cache: cache,
      NPM_CONFIG_PREFIX: prefix,
      npm_config_prefix: prefix,
      NPM_CONFIG_USERCONFIG: userConfig,
      npm_config_userconfig: userConfig,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      npm_config_globalconfig: globalConfig,
      TMP: temp,
      TEMP: temp,
      TMPDIR: temp,
      NPM_CONFIG_AUDIT: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_IGNORE_SCRIPTS: 'true',
      NPM_CONFIG_PACKAGE_LOCK: 'false',
      NPM_CONFIG_PREFER_ONLINE: 'true',
      NPM_CONFIG_FETCH_RETRIES: '0',
      NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: '1',
      NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: '1',
      NO_PROXY: '*',
      no_proxy: '*',
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '',
      http_proxy: '', https_proxy: '', all_proxy: '',
      NPM_CONFIG_PROXY: '', NPM_CONFIG_HTTPS_PROXY: '',
      npm_config_proxy: '', npm_config_https_proxy: '',
    },
  };
}

function materializeAndPack(proofRoot) {
  const archive = path.join(proofRoot, 'candidate.tar');
  const source = path.join(proofRoot, 'candidate-source');
  const packed = path.join(proofRoot, 'packed');
  fs.mkdirSync(source);
  fs.mkdirSync(packed);
  const archiveResult = git(['archive', '--format=tar', '--output', archive, FIXED_CANDIDATE]);
  requireSuccess(command('tar', ['-xf', archive, '-C', source]), 'setup_failure', 'candidate git archive extraction');
  requireCondition(!fs.existsSync(path.join(source, '.git')), 'provenance_failure', 'git archive materialization contained .git');
  const packageJsonBytes = fs.readFileSync(path.join(source, 'package.json'));
  const packageJson = JSON.parse(packageJsonBytes.toString('utf8'));
  requireCondition(sha256(packageJson.name) === PACKAGE_NAME_SHA256 && packageJson.version === PACKAGE_VERSION && packageJson.bin && packageJson.bin.gsdd === PACKAGE_BIN, 'provenance_failure', 'candidate package identity drifted');
  PACKAGE_NAME = packageJson.name;
  PACKAGE_FILENAME = `${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`;
  requireCondition(sha256(packageJsonBytes) === PACKAGE_JSON_SHA256, 'provenance_failure', 'candidate package.json bytes drifted');
  const readmeBytes = fs.readFileSync(path.join(source, 'README.md'));
  requireCondition(sha256(readmeBytes) === README_SHA256, 'provenance_failure', 'candidate README bytes drifted');
  const entryBytes = fs.readFileSync(path.join(source, PACKAGE_BIN));
  requireCondition(sha256(entryBytes) === ENTRY_SHA256, 'provenance_failure', 'candidate entry bytes drifted');
  const packEnvironment = isolatedEnvironment(path.join(proofRoot, 'pack-environment'));
  assertContainedRoots(proofRoot, packEnvironment.roots);
  const packBefore = snapshotRoots(packEnvironment.roots);
  const npmCli = resolveNpmCli(process.execPath);
  const pack = requireSuccess(command(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', packed], { cwd: source, env: packEnvironment.env }), 'setup_failure', 'npm pack');
  const packAfter = snapshotRoots(packEnvironment.roots);
  verifyCanaries(packEnvironment.canaries);
  let packJson;
  try { packJson = JSON.parse(rawOutput(pack, 'stdout').trim()); } catch (error) { fail('setup_failure', 'npm pack did not return JSON', { message: error.message, stdout: pack.stdout }); }
  requireCondition(Array.isArray(packJson) && packJson.length === 1, 'provenance_failure', 'npm pack did not produce exactly one tarball');
  const record = packJson[0];
  requireCondition(record.filename === PACKAGE_FILENAME, 'provenance_failure', 'packed tarball filename drifted');
  const tarball = path.join(packed, record.filename);
  const tarballBytes = fs.readFileSync(tarball);
  const memberList = rawOutput(requireSuccess(command('tar', ['-tf', tarball]), 'setup_failure', 'tarball member listing'), 'stdout').split(/\r?\n/).filter(Boolean);
  requireCondition(memberList.length === TARBALL_MEMBERS, 'provenance_failure', 'tarball member count drifted', { expected: TARBALL_MEMBERS, actual: memberList.length });
  requireCondition(sha256(tarballBytes) === TARBALL_SHA256, 'provenance_failure', 'tarball SHA-256 drifted');
  requireCondition(sha512Sri(tarballBytes) === TARBALL_SRI && record.integrity === TARBALL_SRI, 'provenance_failure', 'tarball SRI drifted');
  return {
    archive: { path: archive, sha256: sha256(fs.readFileSync(archive)), command: commandReceipt(archiveResult) },
    source,
    tarball,
    package: { name: packageJson.name, version: packageJson.version, bin: packageJson.bin.gsdd, packageJsonSha256: sha256(packageJsonBytes), readmeSha256: sha256(readmeBytes), entrySha256: sha256(entryBytes), tarballSha256: sha256(tarballBytes), tarballSri: sha512Sri(tarballBytes), members: memberList.length, listedMembers: memberList },
    pack: commandReceipt(pack),
    packEnvironment: { roots: packEnvironment.roots, canaries: packEnvironment.canaries, snapshots: { before: packBefore, after: packAfter } },
  };
}

function createConsumerRepository(proofRoot, tarball) {
  const consumer = path.join(proofRoot, 'consumer');
  fs.mkdirSync(consumer);
  const init = requireSuccess(command('git', ['init', '--quiet'], { cwd: consumer }), 'setup_failure', 'fresh consumer git init');
  const extract = requireSuccess(command('tar', ['-xf', tarball, '-C', consumer, '--strip-components=1', 'package/README.md']), 'setup_failure', 'packed README extraction');
  const entries = fs.readdirSync(consumer).sort();
  requireCondition(JSON.stringify(entries) === JSON.stringify(['.git', 'README.md']), 'blind_input_failure', 'fresh consumer contained more than .git and packed README', { entries });
  const readme = fs.readFileSync(path.join(consumer, 'README.md'));
  requireCondition(sha256(readme) === README_SHA256, 'provenance_failure', 'consumer README did not equal packed candidate README');
  requireCondition(readme.includes(`npx -y ${PACKAGE_NAME} init`), 'blind_input_failure', 'packed README did not expose the literal first command');
  return { root: consumer, gitInit: commandReceipt(init), readmeExtraction: commandReceipt(extract), entries, readmeSha256: sha256(readme) };
}

function resolveNpmCli(nodeExecutable) {
  const candidate = path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  requireCondition(fs.existsSync(candidate), 'setup_failure', `bundled npm CLI was not found beside ${nodeExecutable}`);
  return fs.realpathSync(candidate);
}

function resolveNpxCmd() {
  const nodeDirectory = path.dirname(fs.realpathSync(process.execPath));
  const candidate = process.platform === 'win32' ? path.join(nodeDirectory, 'npx.cmd') : path.join(nodeDirectory, 'npx');
  requireCondition(fs.existsSync(candidate), 'setup_failure', `current Node runtime does not provide its colocated npx surface: ${candidate}`);
  const selected = fs.realpathSync(candidate);
  requireCondition(path.dirname(selected) === nodeDirectory, 'setup_failure', 'resolved npx surface was not colocated with the recorded Node executable');
  requireCondition(path.basename(selected).toLowerCase() === (process.platform === 'win32' ? 'npx.cmd' : 'npx'), 'setup_failure', 'resolved npx surface name drifted');
  return selected;
}

function windowsQuote(value) {
  const string = String(value);
  if (!/[\s"]/u.test(string)) return string;
  return `"${string.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, '$1$1')}"`;
}

function npxInvocation(logicalArgs) {
  const initArgs = ['-y', PACKAGE_NAME, 'init'];
  const nextArgs = ['-y', PACKAGE_NAME, 'next', '--json'];
  requireCondition(JSON.stringify(logicalArgs) === JSON.stringify(initArgs) || JSON.stringify(logicalArgs) === JSON.stringify(nextArgs), 'harness_failure', 'npx logical argv was not one of the exact approved command arrays', { logicalArgs, initArgs, nextArgs });
  if (process.platform === 'win32') {
    const npxCmd = resolveNpxCmd();
    const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe');
    const commandLine = [windowsQuote(npxCmd), ...logicalArgs.map(windowsQuote)].join(' ');
    return { command: comspec, args: ['/d', '/s', '/c', commandLine], npxCmd, comspec, commandLine, logicalArgs };
  }
  return { command: resolveNpxCmd(), args: logicalArgs, npxCmd: resolveNpxCmd(), comspec: null, commandLine: null, logicalArgs };
}

function outputCapture() {
  return { bytes: 0, hash: crypto.createHash('sha256'), chunks: [], retainedBytes: 0, exceeded: false };
}

function appendOutput(capture, chunk) {
  const bytes = Buffer.from(chunk);
  capture.bytes += bytes.length;
  capture.hash.update(bytes);
  if (capture.retainedBytes < RAW_OUTPUT_LIMIT_BYTES) {
    const retained = bytes.subarray(0, Math.min(bytes.length, RAW_OUTPUT_LIMIT_BYTES - capture.retainedBytes));
    capture.chunks.push(retained);
    capture.retainedBytes += retained.length;
  }
  if (capture.bytes > RAW_OUTPUT_LIMIT_BYTES) capture.exceeded = true;
}

function capturedOutputReceipt(capture) {
  const retained = Buffer.concat(capture.chunks);
  const display = outputReceipt(retained);
  return {
    bytes: capture.bytes,
    sha256: capture.hash.digest('hex'),
    rawLimitBytes: RAW_OUTPUT_LIMIT_BYTES,
    retainedBytes: capture.retainedBytes,
    truncated: capture.retainedBytes < capture.bytes || display.truncated,
    text: display.text,
  };
}

function terminateChildTree(record, reason) {
  if (record.termination) return record.termination;
  const termination = { reason, pid: record.pid, platform: process.platform, attempted: true, method: null, result: null };
  if (process.platform === 'win32') {
    termination.method = 'taskkill /PID <exact-pid> /T /F';
    const taskkill = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe');
    const result = childProcess.spawnSync(taskkill, ['/PID', String(record.pid), '/T', '/F'], { encoding: 'buffer', windowsHide: true, timeout: REAP_GRACE_MS, maxBuffer: OUTPUT_LIMIT_BYTES });
    termination.result = { status: result.status, signal: result.signal || null, error: result.error ? result.error.message : null, stdout: outputReceipt(result.stdout || Buffer.alloc(0)), stderr: outputReceipt(result.stderr || Buffer.alloc(0)) };
  } else {
    termination.method = 'kill process group for exact spawned leader';
    try { process.kill(-record.pid, 'SIGTERM'); termination.result = { sent: true }; } catch (error) { termination.result = { sent: false, error: error.message }; }
  }
  record.termination = termination;
  return termination;
}

function runAsyncCommand(invocation, options, activeChildren) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    let reapTimer = null;
    let timeout = null;
    let collectorsFinalized = false;
    const stdout = outputCapture();
    const stderr = outputCapture();
    const child = childProcess.spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { child, pid: child.pid, closed: false, termination: null };
    activeChildren.add(record);
    const onStdout = (chunk) => { appendOutput(stdout, chunk); if (stdout.exceeded) requestTermination('raw_stdout_limit'); };
    const onStderr = (chunk) => { appendOutput(stderr, chunk); if (stderr.exceeded) requestTermination('raw_stderr_limit'); };
    const finalizeCollectors = () => {
      if (collectorsFinalized) return;
      collectorsFinalized = true;
      child.stdout.removeListener('data', onStdout);
      child.stderr.removeListener('data', onStderr);
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const finish = (error, status, signal, childTreeReaped) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(reapTimer);
      finalizeCollectors();
      const stdoutReceipt = capturedOutputReceipt(stdout);
      const stderrReceipt = capturedOutputReceipt(stderr);
      const receipt = {
        command: invocation.command,
        args: invocation.args,
        cwd: options.cwd,
        exitCode: status === null || status === undefined ? -1 : status,
        signal: signal || null,
        timedOut,
        outputLimitExceeded: stdout.exceeded || stderr.exceeded,
        childTreeReaped,
        termination: record.termination,
        elapsedMs: Date.now() - startedAt,
        stdin: 'closed',
        stdout: stdoutReceipt,
        stderr: stderrReceipt,
      };
      Object.defineProperties(receipt, { _stdout: { value: Buffer.concat(stdout.chunks), enumerable: false }, _stderr: { value: Buffer.concat(stderr.chunks), enumerable: false } });
      if (error) reject(new ProofFailure('setup_failure', `could not launch child: ${error.message}`, { invocation, receipt }));
      else resolve(receipt);
    };
    const requestTermination = (reason) => {
      terminateChildTree(record, reason);
      if (!reapTimer) reapTimer = setTimeout(() => finish(null, null, null, false), REAP_GRACE_MS);
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('error', (error) => { record.closed = true; activeChildren.delete(record); finish(error, null, null, true); });
    child.once('close', (status, signal) => { record.closed = true; activeChildren.delete(record); finish(null, status, signal, true); });
    timeout = setTimeout(() => { timedOut = true; requestTermination('timeout'); }, options.timeoutMs);
  });
}

function startRegistry(tarball, packageIdentity) {
  const requests = [];
  const tarballBytes = fs.readFileSync(tarball);
  const tarballShasum = crypto.createHash('sha1').update(tarballBytes).digest('hex');
  let unexpected = null;
  let port = null;
  const sockets = new Set();
  const allowed = new Set([`/${PACKAGE_NAME}`, `/${PACKAGE_NAME}/`, `/${PACKAGE_NAME}/-/${PACKAGE_FILENAME}`]);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const event = { method: request.method, path: pathname, remoteAddress: request.socket.remoteAddress || null, status: null };
    requests.push(event);
    const loopback = event.remoteAddress === '127.0.0.1' || event.remoteAddress === '::ffff:127.0.0.1';
    if (!loopback || !allowed.has(pathname) || (request.method !== 'GET' && request.method !== 'HEAD')) {
      unexpected = { ...event, reason: !loopback ? 'non_loopback' : !allowed.has(pathname) ? 'undeclared_endpoint' : 'undeclared_method' };
      event.status = 404;
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'phase05 isolated registry denies this request' }));
      return;
    }
    if (pathname === `/${PACKAGE_NAME}/-/${PACKAGE_FILENAME}`) {
      event.status = 200;
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': tarballBytes.length, 'cache-control': 'no-store' });
      if (request.method === 'HEAD') response.end(); else response.end(tarballBytes);
      return;
    }
    const packument = Buffer.from(JSON.stringify({
      name: PACKAGE_NAME,
      'dist-tags': { latest: PACKAGE_VERSION },
      versions: {
        [PACKAGE_VERSION]: {
          name: PACKAGE_NAME,
          version: PACKAGE_VERSION,
          bin: { gsdd: PACKAGE_BIN },
          dist: { tarball: `http://127.0.0.1:${port}/${PACKAGE_NAME}/-/${PACKAGE_FILENAME}`, integrity: TARBALL_SRI, shasum: tarballShasum },
        },
      },
    }), 'utf8');
    event.status = 200;
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': packument.length, 'cache-control': 'no-store' });
    if (request.method === 'HEAD') response.end(); else response.end(packument);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new ProofFailure('registry_protocol_failure', `could not start loopback registry: ${error.message}`)));
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve({ server, port, registryUrl: `http://127.0.0.1:${port}/`, requests, sockets, unexpected: () => unexpected, packageIdentity });
    });
  });
}

function closeRegistry(registry) {
  if (!registry || !registry.server.listening) return Promise.resolve({ attempted: Boolean(registry), closed: true, destroyedSockets: 0, timedOut: false });
  return new Promise((resolve) => {
    let settled = false;
    let deadline = null;
    const destroyedSockets = registry.sockets.size;
    for (const socket of registry.sockets) socket.destroy();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };
    deadline = setTimeout(() => finish({ attempted: true, closed: false, destroyedSockets, timedOut: true, error: 'registry close deadline exceeded' }), REGISTRY_CLOSE_MS);
    registry.server.close((error) => finish({ attempted: true, closed: !registry.server.listening && !error, destroyedSockets, timedOut: false, error: error ? error.message : null }));
  });
}

function findInstalledPackage(cacheRoot) {
  const npxRoot = path.join(cacheRoot, '_npx');
  requireCondition(fs.existsSync(npxRoot), 'provenance_failure', 'npx cache did not create _npx');
  const matches = [];
  for (const directory of fs.readdirSync(npxRoot).sort()) {
    const candidate = path.join(npxRoot, directory, 'node_modules', PACKAGE_NAME);
    if (fs.existsSync(candidate)) matches.push(fs.realpathSync(candidate));
  }
  requireCondition(matches.length === 1, 'provenance_failure', 'isolated npx cache did not contain exactly one package installation', { matches });
  return matches[0];
}

function bindInstalledCandidate(cacheRoot) {
  let resolvedCacheRoot;
  let resolvedNpxRoot;
  try {
    resolvedCacheRoot = fs.realpathSync(cacheRoot);
    resolvedNpxRoot = fs.realpathSync(path.join(cacheRoot, '_npx'));
  } catch (error) {
    fail('provenance_failure', 'isolated npx cache roots could not be resolved before installed-package binding', { cacheRoot, code: error.code, message: error.message });
  }
  const packageRoot = findInstalledPackage(cacheRoot);
  requireCondition(isInside(resolvedCacheRoot, packageRoot), 'provenance_failure', 'resolved npx package root escaped the isolated cache root', { resolvedCacheRoot, packageRoot });
  requireCondition(isInside(resolvedNpxRoot, packageRoot), 'provenance_failure', 'resolved npx package root escaped the isolated cache _npx root', { resolvedNpxRoot, packageRoot });
  const packageJsonBytes = fs.readFileSync(path.join(packageRoot, 'package.json'));
  const packageJson = JSON.parse(packageJsonBytes.toString('utf8'));
  const entry = fs.realpathSync(path.join(packageRoot, PACKAGE_BIN));
  requireCondition(isInside(packageRoot, entry), 'provenance_failure', 'installed entry escaped isolated package root');
  requireCondition(!isInside(REPOSITORY_ROOT, entry), 'provenance_failure', 'installed entry resolved to source checkout');
  requireCondition(packageJson.name === PACKAGE_NAME && packageJson.version === PACKAGE_VERSION && packageJson.bin && packageJson.bin.gsdd === PACKAGE_BIN, 'provenance_failure', 'installed npx package metadata differs from candidate');
  requireCondition(sha256(packageJsonBytes) === PACKAGE_JSON_SHA256, 'provenance_failure', 'installed npx package.json bytes differ from candidate');
  requireCondition(sha256(fs.readFileSync(entry)) === ENTRY_SHA256, 'provenance_failure', 'installed npx entry bytes differ from candidate');
  const binDirectory = path.join(path.dirname(packageRoot), '.bin');
  const binName = process.platform === 'win32' ? 'gsdd.cmd' : 'gsdd';
  const binPath = path.join(binDirectory, binName);
  requireCondition(fs.existsSync(binPath), 'provenance_failure', 'npx cache omitted the gsdd bin shim');
  const binStat = fs.lstatSync(binPath);
  const binBytes = fs.readFileSync(binPath);
  if (binStat.isSymbolicLink()) {
    requireCondition(fs.realpathSync(binPath) === entry, 'provenance_failure', 'npx cache gsdd bin symlink did not resolve to the accepted installed entry');
  } else {
    const renderedTarget = process.platform === 'win32' ? `..\\${PACKAGE_NAME}\\bin\\gsdd.mjs` : `../${PACKAGE_NAME}/bin/gsdd.mjs`;
    requireCondition(binBytes.toString('utf8').replace(/\\/g, '/').includes(renderedTarget.replace(/\\/g, '/')), 'provenance_failure', 'npx cache gsdd bin shim did not name the accepted installed entry');
  }
  return {
    packageRoot,
    cacheRoots: { cacheRoot: resolvedCacheRoot, npxRoot: resolvedNpxRoot },
    entry,
    packageJsonSha256: sha256(packageJsonBytes),
    entrySha256: sha256(fs.readFileSync(entry)),
    package: { name: packageJson.name, version: packageJson.version, bin: packageJson.bin.gsdd },
    cacheBin: { path: binPath, type: binStat.isSymbolicLink() ? 'link' : 'file', sha256: sha256(binBytes), target: binStat.isSymbolicLink() ? fs.readlinkSync(binPath) : null, acceptedEntrySha256: ENTRY_SHA256 },
  };
}

function verifyConsumerResult(consumer, init, next) {
  requireCondition(/GSDD initialized|setting up GSDD workflow/i.test(rawOutput(init, 'stdout')), 'product_behavior_failure', 'bare npx init output was not recognizable');
  for (const lane of ['gsdd-new-project', 'gsdd-quick', 'gsdd-map-codebase']) {
    requireCondition(rawOutput(init, 'stdout').includes(lane), 'product_behavior_failure', `bare npx init output omitted documented starting lane ${lane}`);
  }
  const work = path.join(consumer.root, '.work');
  requireCondition(fs.existsSync(work) && fs.lstatSync(work).isDirectory(), 'product_behavior_failure', 'bare npx init did not create .work');
  requireAbsentPath(path.join(consumer.root, '.planning'), 'product_behavior_failure', 'bare npx init legacy .planning path');
  requireCondition(fs.readdirSync(consumer.root).filter((name) => name === '.work').length === 1, 'product_behavior_failure', 'consumer did not contain exactly one .work root');
  for (const lane of ['gsdd-new-project', 'gsdd-quick', 'gsdd-map-codebase']) {
    requireNonemptyRegularFile(path.join(consumer.root, '.agents', 'skills', lane, 'SKILL.md'), 'product_behavior_failure', `portable starting lane ${lane} SKILL.md`);
  }
  requireNonemptyRegularFile(path.join(work, 'bin', 'gsdd.mjs'), 'product_behavior_failure', 'repo-local portable helper');
  let nextJson;
  try { nextJson = JSON.parse(rawOutput(next, 'stdout').trim()); } catch (error) { fail('product_behavior_failure', 'bare npx next --json did not return JSON', { message: error.message, stdout: next.stdout }); }
  requireCondition(nextJson && typeof nextJson === 'object' && !nextJson.error, 'product_behavior_failure', 'next packet was an error packet');
  requireCondition(nextJson.schema_version === 1 && nextJson.operation === 'next', 'product_behavior_failure', 'next packet schema or operation drifted');
  requireCondition(typeof nextJson.state === 'string' && nextJson.state.trim() && typeof nextJson.reason === 'string' && nextJson.reason.trim(), 'product_behavior_failure', 'next packet omitted a nonempty state or reason');
  requireCondition(NEXT_STATES.includes(nextJson.state), 'product_behavior_failure', 'next packet state was not one of the accepted source states', { state: nextJson.state, accepted: NEXT_STATES });
  const action = nextJson.next_action;
  requireCondition(action && typeof action === 'object' && !Array.isArray(action) && typeof action.type === 'string' && action.type.trim() && typeof action.description === 'string' && action.description.trim(), 'product_behavior_failure', 'next packet omitted a structured next_action type or description');
  const actionPayloads = {
    cli_command: () => Array.isArray(action.argv) && action.argv.length > 0 && action.argv.every((value) => typeof value === 'string' && value.trim()),
    workflow_skill: () => typeof action.skill_id === 'string' && action.skill_id.trim(),
    manual_review: () => Array.isArray(action.targets) && action.targets.length > 0 && action.targets.every((value) => typeof value === 'string' && value.trim()),
    user_question: () => Array.isArray(action.question_ids) && action.question_ids.length > 0 && action.question_ids.every((value) => typeof value === 'string' && value.trim()),
  };
  requireCondition(Object.prototype.hasOwnProperty.call(actionPayloads, action.type) && actionPayloads[action.type](), 'product_behavior_failure', 'next packet next_action lacked its required type-specific payload', { action });
  const configPath = path.join(work, 'config.json');
  requireNonemptyRegularFile(configPath, 'product_behavior_failure', 'generated .work/config.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) { fail('product_behavior_failure', 'generated .work/config.json was not parseable JSON', { message: error.message }); }
  requireCondition(config.initVersion === 'v1.1' && typeof config.rigorProfile === 'string' && config.rigorProfile.trim() && config.workflow && typeof config.workflow === 'object' && !Array.isArray(config.workflow) && config.gitProtocol && typeof config.gitProtocol === 'object' && !Array.isArray(config.gitProtocol), 'product_behavior_failure', 'generated .work/config.json did not contain the required durable init contract');
  return { workspaceTree: snapshotTree(consumer.root), nextJson };
}

function asProofFailure(error) {
  return error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function terminateRemainingChildren(activeChildren) {
  const before = [...activeChildren].map((record) => ({ pid: record.pid, closed: record.closed }));
  for (const record of activeChildren) terminateChildTree(record, 'final_guard');
  if (activeChildren.size) await wait(REAP_GRACE_MS);
  return { before, remaining: [...activeChildren].map((record) => ({ pid: record.pid, closed: record.closed, termination: record.termination })) };
}

function containmentAfterSnapshot(consumer, isolation) {
  return {
    repository: snapshotTree(REPOSITORY_ROOT),
    protected: protectedManifest(),
    userRootRisk: userRootRiskSnapshot(),
    writableRoots: consumer && isolation ? snapshotRoots({ consumer: consumer.root, ...isolation.roots }) : null,
  };
}

function assertContainment(before, after, isolation) {
  if (isolation) verifyCanaries(isolation.canaries);
  assertSameSnapshot(before.repository, after.repository, 'containment_failure', 'consumer execution changed repository bytes');
  assertSameSnapshot(before.protected, after.protected, 'containment_failure', 'consumer execution changed protected inputs');
  assertSameSnapshot(before.userRootRisk, after.userRootRisk, 'containment_failure', 'consumer execution changed a known user-root risk output');
}

async function main() {
  const args = process.argv.slice(2);
  const developmentMode = args.length === 2 && args[0] === DEVELOPMENT_ARGUMENT && args[1] === SELF_PATH;
  if (args.length !== 0 && !developmentMode) throw new ProofFailure('invalid_invocation', `Use no arguments, or exactly ${DEVELOPMENT_ARGUMENT} ${SELF_PATH}`);
  const receipt = {
    schema: 'gsdd.phase05.blind-npx.v1',
    invocationMode: developmentMode ? 'development_harness' : 'default_clean_commit',
    acceptance: false,
    classification: 'running',
    claimLimit: 'Exact candidate through a private loopback registry and closed-stdin bare npx only; no public npm, interactive wizard, native-agent, comprehension, other-machine, release, or relaunch claim.',
    platform: { os: process.platform, arch: process.arch, node: process.version, shell: process.env.ComSpec || null },
    commands: [],
  };
  const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase05-blind-npx-'));
  const activeChildren = new Set();
  let registry = null;
  let consumer = null;
  let isolation = null;
  let before = null;
  let primaryFailure = null;
  let proofChecksPassed = false;
  let cleanup = { attempted: false, success: false };
  try {
    receipt.candidate = candidateState(developmentMode);
    before = { repository: snapshotTree(REPOSITORY_ROOT), protected: protectedManifest(), userRootRisk: userRootRiskSnapshot(), writableRoots: null };
    const artifact = materializeAndPack(proofRoot);
    receipt.artifact = artifact;
    consumer = createConsumerRepository(proofRoot, artifact.tarball);
    receipt.consumer = consumer;
    isolation = isolatedEnvironment(path.join(proofRoot, 'consumer-environment'));
    assertContainedRoots(proofRoot, { consumer: consumer.root, ...isolation.roots });
    before.writableRoots = snapshotRoots({ consumer: consumer.root, ...isolation.roots });
    receipt.isolation = { roots: isolation.roots, canaries: isolation.canaries, guard: isolation.guard };
    requireCondition(!isolation.guard.childPath.split(path.delimiter).map((entry) => path.resolve(entry)).includes(path.resolve(isolation.guard.excludedAmbientNodeDirectory)), 'provenance_failure', 'child PATH retained the ambient Node/global-shim directory');
    registry = await startRegistry(artifact.tarball, artifact.package);
    receipt.registry = { host: '127.0.0.1', port: registry.port, url: registry.registryUrl, routes: [`/${PACKAGE_NAME}`, `/${PACKAGE_NAME}/`, `/${PACKAGE_NAME}/-/${PACKAGE_FILENAME}`], requests: registry.requests };
    isolation.env.NPM_CONFIG_REGISTRY = registry.registryUrl;
    isolation.env.npm_config_registry = registry.registryUrl;
    const startedAt = Date.now();
    const deadline = startedAt + COMMAND_BUDGET_MS;
    const runNpx = async (logicalArgs, description) => {
      const remaining = deadline - Date.now();
      requireCondition(remaining > 0, 'budget_failure', `120-second post-registry budget elapsed before ${description}`);
      const invocation = npxInvocation(logicalArgs);
      const result = await runAsyncCommand(invocation, { cwd: consumer.root, env: isolation.env, timeoutMs: remaining }, activeChildren);
      const evidence = { description, logicalArgs, invocation: { npxCmd: invocation.npxCmd, comspec: invocation.comspec, commandLine: invocation.commandLine, physicalCommand: invocation.command, physicalArgs: invocation.args }, ...commandReceipt(result) };
      receipt.commands.push(evidence);
      requireCondition(registry.unexpected() === null, 'registry_protocol_failure', 'npx made an undeclared or non-loopback registry request', registry.unexpected());
      requireCondition(!`${result.stdout.text}\n${result.stderr.text}`.includes(isolation.guard.sentinel), 'provenance_failure', 'ambient global gsdd guard was invoked instead of the isolated npx cache entry', evidence);
      if (result.outputLimitExceeded) fail('output_limit_failure', `${description} exceeded the raw output capture limit`, evidence);
      if (result.timedOut) fail('budget_failure', `${description} exceeded remaining post-registry command budget`, evidence);
      if (!result.childTreeReaped) fail('cleanup_failure', `${description} child tree did not reap within its bounded deadline`, evidence);
      requireSuccess(result, 'product_behavior_failure', description);
      return result;
    };
    const init = await runNpx(['-y', PACKAGE_NAME, 'init'], `literal npx -y ${PACKAGE_NAME} init`);
    const installed = bindInstalledCandidate(isolation.roots.cache);
    const next = await runNpx(['-y', PACKAGE_NAME, 'next', '--json'], `literal npx -y ${PACKAGE_NAME} next --json`);
    receipt.postRegistryBudget = { limitMs: COMMAND_BUDGET_MS, elapsedMs: Date.now() - startedAt, remainingMs: Math.max(0, deadline - Date.now()) };
    requireCondition(receipt.postRegistryBudget.elapsedMs <= COMMAND_BUDGET_MS, 'budget_failure', 'post-registry commands exceeded 120-second budget');
    requireCondition(registry.unexpected() === null, 'registry_protocol_failure', 'npx made an undeclared or non-loopback registry request', registry.unexpected());
    requireCondition(registry.requests.some((request) => request.path === `/${PACKAGE_NAME}` || request.path === `/${PACKAGE_NAME}/`), 'registry_protocol_failure', 'npx did not request the one-package packument');
    requireCondition(registry.requests.some((request) => request.path === `/${PACKAGE_NAME}/-/${PACKAGE_FILENAME}`), 'registry_protocol_failure', 'npx did not request the one-package tarball');
    receipt.installed = installed;
    receipt.result = verifyConsumerResult(consumer, init, next);
    proofChecksPassed = true;
  } catch (error) {
    primaryFailure = asProofFailure(error);
  } finally {
    let finalFailure = primaryFailure;
    receipt.children = await terminateRemainingChildren(activeChildren);
    if (receipt.children.remaining.length) {
      finalFailure = new ProofFailure('cleanup_failure', 'tracked child process tree remained after the exact-PID final guard', { originalFailure: primaryFailure, children: receipt.children });
    }
    try {
      receipt.registryClosure = await closeRegistry(registry);
      if (registry) receipt.registry.requests = registry.requests;
      if (!receipt.registryClosure.closed || receipt.registryClosure.timedOut) finalFailure = new ProofFailure('cleanup_failure', 'loopback registry did not close within its bounded deadline', { originalFailure: finalFailure, registryClosure: receipt.registryClosure });
    } catch (error) {
      receipt.registryClosure = { attempted: true, closed: false, error: error.message };
      finalFailure = new ProofFailure('cleanup_failure', 'loopback registry close failed', { originalFailure: finalFailure, error: error.message });
    }
    if (before) {
      try {
        const after = containmentAfterSnapshot(consumer, isolation);
        receipt.snapshots = { before, after };
        assertContainment(before, after, isolation);
      } catch (error) {
        const containment = asProofFailure(error);
        finalFailure = new ProofFailure('containment_failure', containment.message, { originalFailure: finalFailure, containmentCause: containment.cause || null });
      }
    }
    try {
      cleanup.attempted = true;
      if (receipt.children.remaining.length) throw new Error('refusing proof-root cleanup while a tracked child process tree remains');
      cleanup.validation = safeRemove(proofRoot);
      cleanup.success = !fs.existsSync(proofRoot);
    } catch (error) {
      cleanup.error = error.message;
      finalFailure = new ProofFailure('cleanup_failure', 'guarded proof-root cleanup failed', { originalFailure: finalFailure, error: error.message });
    }
    receipt.cleanup = cleanup;
    if (!cleanup.success) {
      finalFailure = new ProofFailure('cleanup_failure', 'guarded proof-root cleanup did not verify removal', { originalFailure: finalFailure, cleanup });
    }
    if (finalFailure) {
      receipt.acceptance = false;
      receipt.classification = finalFailure.classification;
      receipt.failure = { message: finalFailure.message, cause: finalFailure.cause || null };
      process.exitCode = 1;
    } else {
      receipt.acceptance = !developmentMode && proofChecksPassed;
      receipt.classification = developmentMode ? 'non_acceptance_development_harness_pass' : 'acceptance_pass';
    }
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }
}

main().catch((error) => {
  const failure = error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack });
  process.stdout.write(`${JSON.stringify({ schema: 'gsdd.phase05.blind-npx.v1', acceptance: false, classification: failure.classification, failure: { message: failure.message, cause: failure.cause || null } }, null, 2)}\n`);
  process.exitCode = 1;
});
