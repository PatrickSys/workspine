#!/usr/bin/env node
'use strict';

// Explicit Phase 05 proof command. It is deliberately outside tests/*.test.cjs
// because it downloads one official runtime and must never become ordinary CI.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const REPOSITORY_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const DEVELOPMENT_ARGUMENT = '--development-harness';
const SELF_PATH = 'tests/proof/phase05-packed-artifact.cjs';
const NODE_20_VERSION = '20.0.0';
const NODE_20_BASE_URL = `https://nodejs.org/dist/v${NODE_20_VERSION}`;
const NODE_20_ARCHIVE = `node-v${NODE_20_VERSION}-win-x64.zip`;
const OUTPUT_LIMIT_BYTES = 12 * 1024;
const PROTECTED_INPUTS = Object.freeze([
  ['.work.zip', 356000, '36158acba6dda63a17dde4e5bc288fbd17e6297d3964f6729dc33baa72fb5f2b'],
  ['deep-research-report-decision-driven-second.md', 38875, '3e12c48f66065136830551acc80fb02afce59d7ff50f0b6c37627102f2dbd4d2'],
  ['deep-research-report-decision-driven.md', 36427, 'c6c1a6b58d0c90c933f4ac35d79feda7fc5a95805bfddca2a3f04da9bab904f8'],
  ['workspine.zip', 6691999, '83184a0ed5a6f46e6586a454ab06e5e2ac2bad3078fccc58f933ebcbf6d65127'],
]);

class ProofFailure extends Error {
  constructor(classification, message, cause) {
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
  const visible = !truncated
    ? bytes
    : Buffer.concat([
      bytes.subarray(0, OUTPUT_LIMIT_BYTES / 2),
      Buffer.from('\n...[output truncated by proof runner]...\n', 'utf8'),
      bytes.subarray(bytes.length - (OUTPUT_LIMIT_BYTES / 2)),
    ]);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    truncated,
    text: visible.toString('utf8'),
  };
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
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function safeRemove(proofRoot) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const realRoot = fs.realpathSync(proofRoot);
  requireCondition(isInside(tempRoot, realRoot), 'cleanup_failure', `refusing to remove path outside OS temp: ${realRoot}`);
  requireCondition(path.basename(realRoot).startsWith('gsdd-phase05-packed-'), 'cleanup_failure', `refusing to remove unexpected temp root: ${realRoot}`);
  fs.rmSync(realRoot, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
  return { target: realRoot, tempRoot };
}

function command(file, args, options = {}) {
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
  if (result.exitCode !== 0) {
    throw new ProofFailure(classification, `${description} failed with exit ${result.exitCode}`, result);
  }
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
      if (stat.isSymbolicLink()) {
        output.push({ path: relativePath, type: 'link', target: fs.readlinkSync(fullPath) });
      } else if (stat.isDirectory()) {
        output.push({ path: `${relativePath}/`, type: 'directory' });
        visit(fullPath, relativePath);
      } else if (stat.isFile()) {
        output.push({ path: relativePath, type: 'file', bytes: stat.size, sha256: sha256(fs.readFileSync(fullPath)) });
      } else {
        output.push({ path: relativePath, type: 'other' });
      }
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
    if (error?.code === 'ENOENT') {
      return { path: absolutePath, exists: false, type: 'missing', realPath: null, entries: [] };
    }
    fail('harness_failure', `could not snapshot declared root: ${absolutePath}`, { message: error.message, code: error.code });
  }
  if (stat.isSymbolicLink()) {
    return { path: absolutePath, exists: true, type: 'link', target: fs.readlinkSync(absolutePath), realPath: null, entries: [] };
  }
  if (stat.isDirectory()) {
    return { path: absolutePath, exists: true, type: 'directory', realPath: fs.realpathSync(absolutePath), entries: snapshotTree(absolutePath) };
  }
  if (stat.isFile()) {
    const bytes = fs.readFileSync(absolutePath);
    return { path: absolutePath, exists: true, type: 'file', bytes: bytes.length, sha256: sha256(bytes), realPath: fs.realpathSync(absolutePath), entries: [] };
  }
  return { path: absolutePath, exists: true, type: 'other', realPath: null, entries: [] };
}

function snapshotRoots(roots) {
  return Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, snapshotRoot(root)]));
}

function snapshotRootSelfCheck(proofRoot) {
  const root = path.join(proofRoot, 'snapshot-root-self-check');
  const regularFile = path.join(root, 'regular-file');
  const linkTarget = path.join(root, 'link-target');
  const link = path.join(root, 'root-link');
  fs.mkdirSync(root);
  fs.writeFileSync(regularFile, 'snapshot root regular file\n');
  fs.mkdirSync(linkTarget);
  fs.writeFileSync(path.join(linkTarget, 'target-file'), 'snapshot root junction target\n');
  try {
    fs.symlinkSync(linkTarget, link, 'junction');
  } catch (error) {
    fail('harness_failure', 'snapshot root self-check could not create a disposable directory junction', { message: error.message, code: error.code });
  }
  const expectedLinkTarget = fs.readlinkSync(link);
  requireCondition(fs.realpathSync(link) === fs.realpathSync(linkTarget), 'harness_failure', 'snapshot root self-check junction did not resolve to its disposable target');
  const fileSnapshot = snapshotRoot(regularFile);
  const linkSnapshot = snapshotRoot(link);
  requireCondition(fileSnapshot.type === 'file' && fileSnapshot.entries.length === 0 && fileSnapshot.sha256 === sha256(fs.readFileSync(regularFile)), 'harness_failure', 'snapshot root self-check did not record a regular-file root safely');
  requireCondition(linkSnapshot.type === 'link' && linkSnapshot.entries.length === 0 && linkSnapshot.target === expectedLinkTarget, 'harness_failure', 'snapshot root self-check did not record a junction root safely');
  return { root, regularFile: fileSnapshot, link: linkSnapshot };
}

function writeCanary(filePath, name) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`phase05 ${name} canary\n`, 'utf8');
  fs.writeFileSync(filePath, bytes, { flag: 'wx' });
  return { path: filePath, bytes: bytes.length, sha256: sha256(bytes) };
}

function verifyCanaries(canaries) {
  for (const canary of canaries) {
    requireCondition(fs.existsSync(canary.path), 'containment_failure', `ambient canary was removed: ${canary.path}`);
    const bytes = fs.readFileSync(canary.path);
    requireCondition(bytes.length === canary.bytes && sha256(bytes) === canary.sha256, 'containment_failure', `ambient canary changed: ${canary.path}`);
  }
}

function assertContainedRoots(laneRoot, roots) {
  for (const [name, root] of Object.entries(roots)) {
    requireCondition(isInside(laneRoot, root), 'containment_failure', `${name} root escaped lane root: ${root}`);
    const parent = fs.existsSync(root) && fs.lstatSync(root).isDirectory() ? root : path.dirname(root);
    requireCondition(isInside(laneRoot, parent), 'containment_failure', `${name} root parent escaped lane root: ${parent}`);
  }
}

function ambientWorkspaceDiscovery(startDir, temporaryRoot) {
  let current = path.resolve(startDir);
  const stop = path.resolve(temporaryRoot);
  while (true) {
    const git = path.join(current, '.git');
    const work = path.join(current, '.work');
    const planning = path.join(current, '.planning');
    if (fs.existsSync(git) || fs.existsSync(work) || fs.existsSync(planning)) return current;
    if (current === stop) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function protectedManifest() {
  return PROTECTED_INPUTS.map(([relativePath, expectedBytes, expectedHash]) => {
    const absolutePath = path.join(REPOSITORY_ROOT, relativePath);
    const bytes = fs.readFileSync(absolutePath);
    const actual = { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
    requireCondition(actual.bytes === expectedBytes, 'provenance_failure', `${relativePath} byte length drifted`);
    requireCondition(actual.sha256 === expectedHash, 'provenance_failure', `${relativePath} SHA-256 drifted`);
    return actual;
  });
}

function candidateState(developmentMode) {
  const commit = rawOutput(git(['rev-parse', '--verify', 'HEAD']), 'stdout').trim().toLowerCase();
  requireCondition(/^[0-9a-f]{40}$/.test(commit), 'provenance_failure', 'HEAD did not resolve to a full commit');
  const tracked = git(['status', '--porcelain=v1', '--untracked-files=no', '--', '.']);
  requireCondition(rawOutput(tracked, 'stdout') === '', 'provenance_failure', 'tracked or index drift prevents packing the candidate');
  const untracked = rawOutput(git(['ls-files', '--others', '--exclude-standard']), 'stdout').split(/\r?\n/).filter(Boolean).sort();
  const allowed = PROTECTED_INPUTS.map(([relativePath]) => relativePath).concat(developmentMode ? [SELF_PATH] : []).sort();
  requireCondition(JSON.stringify(untracked) === JSON.stringify(allowed), 'provenance_failure', 'untracked inputs do not match the protected/dev allowlist', { untracked, allowed });
  return {
    commit,
    trackedStatus: commandReceipt(tracked),
    untracked,
    protectedInputs: protectedManifest(),
  };
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'gsdd-phase05-proof' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} returned ${response.statusCode}`));
        return;
      }
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.setTimeout(30000, () => request.destroy(new Error(`GET ${url} timed out`)));
    request.on('error', reject);
  });
}

function parseOfficialHash(shasums) {
  const line = shasums.split(/\r?\n/).find((entry) => entry.endsWith(`  ${NODE_20_ARCHIVE}`));
  if (!line) fail('missing_evidence', `Official SHASUMS256.txt does not name ${NODE_20_ARCHIVE}`);
  const hash = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/i.test(hash)) fail('missing_evidence', 'Official SHA-256 entry was malformed');
  return hash.toLowerCase();
}

function resolveNpmCli(nodeExecutable) {
  const candidate = path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(candidate)) throw new ProofFailure('setup_failure', `Bundled npm CLI was not found beside ${nodeExecutable}`);
  return fs.realpathSync(candidate);
}

function isolatedEnvironment(root, nodeExecutable) {
  const home = path.join(root, 'home');
  const cache = path.join(root, 'npm-cache');
  const prefix = path.join(root, 'npm-prefix');
  const temp = path.join(root, 'sibling-temp');
  const userConfig = path.join(root, 'npmrc');
  const ambient = path.join(root, 'ambient-canaries');
  for (const directory of [home, cache, prefix, temp, ambient]) fs.mkdirSync(directory, { recursive: true });
  const canaries = [
    writeCanary(path.join(home, 'HOME-CANARY.txt'), 'home'),
    writeCanary(path.join(cache, 'CACHE-CANARY.txt'), 'cache'),
    writeCanary(path.join(prefix, 'PREFIX-CANARY.txt'), 'prefix'),
    writeCanary(path.join(temp, 'TEMP-CANARY.txt'), 'temp'),
    writeCanary(path.join(ambient, 'AMBIENT-CANARY.txt'), 'ambient'),
  ];
  const userConfigBytes = Buffer.from('# phase05 userconfig canary\n', 'utf8');
  fs.writeFileSync(userConfig, userConfigBytes, { flag: 'wx' });
  canaries.push({ path: userConfig, bytes: userConfigBytes.length, sha256: sha256(userConfigBytes) });
  for (const name of ['codex', 'claude', 'opencode', 'xdg-config', 'xdg-cache', 'xdg-data']) {
    fs.mkdirSync(path.join(ambient, name), { recursive: true });
    fs.writeFileSync(path.join(ambient, name, 'CANARY.txt'), `phase05-${name}\n`);
  }
  const nodeDirectory = path.dirname(nodeExecutable);
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const systemPath = [nodeDirectory, path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter);
  return {
    roots: { home, cache, prefix, userConfig, temp, ambient },
    canaries,
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
      XDG_CONFIG_HOME: path.join(ambient, 'xdg-config'),
      XDG_CACHE_HOME: path.join(ambient, 'xdg-cache'),
      XDG_DATA_HOME: path.join(ambient, 'xdg-data'),
      CODEX_HOME: path.join(ambient, 'codex'),
      CLAUDE_CONFIG_DIR: path.join(ambient, 'claude'),
      CLAUDE_HOME: path.join(ambient, 'claude'),
      OPENCODE_CONFIG_DIR: path.join(ambient, 'opencode'),
      OPENCODE_DATA_DIR: path.join(ambient, 'opencode'),
      NPM_CONFIG_CACHE: cache,
      npm_config_cache: cache,
      NPM_CONFIG_PREFIX: prefix,
      npm_config_prefix: prefix,
      NPM_CONFIG_USERCONFIG: userConfig,
      npm_config_userconfig: userConfig,
      TMP: temp,
      TEMP: temp,
      TMPDIR: temp,
      NPM_CONFIG_AUDIT: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_IGNORE_SCRIPTS: 'true',
      NPM_CONFIG_PACKAGE_LOCK: 'false',
      NO_PROXY: '*',
    },
  };
}

function materializeCandidate(commit, proofRoot) {
  const archive = path.join(proofRoot, 'candidate.tar');
  const source = path.join(proofRoot, 'candidate-source');
  fs.mkdirSync(source);
  const archiveResult = git(['archive', '--format=tar', '--output', archive, commit]);
  requireSuccess(command('tar', ['-xf', archive, '-C', source]), 'setup_failure', 'candidate git archive extraction');
  requireCondition(!fs.existsSync(path.join(source, '.git')), 'provenance_failure', 'git archive materialization must not contain .git');
  requireCondition(fs.existsSync(path.join(source, 'package.json')), 'provenance_failure', 'materialized candidate is missing package.json');
  return { archive, source, archiveResult };
}

async function portableNode20(proofRoot) {
  const downloadDirectory = path.join(proofRoot, 'node20-download');
  const extractionDirectory = path.join(proofRoot, 'node20-runtime');
  fs.mkdirSync(downloadDirectory);
  fs.mkdirSync(extractionDirectory);
  const shasumsFile = path.join(downloadDirectory, 'SHASUMS256.txt');
  const archiveFile = path.join(downloadDirectory, NODE_20_ARCHIVE);
  try {
    await download(`${NODE_20_BASE_URL}/SHASUMS256.txt`, shasumsFile);
    await download(`${NODE_20_BASE_URL}/${NODE_20_ARCHIVE}`, archiveFile);
  } catch (error) {
    throw new ProofFailure('missing_evidence', 'Official Node 20.0.0 download was unavailable', { message: error.message });
  }
  const expectedHash = parseOfficialHash(fs.readFileSync(shasumsFile, 'utf8'));
  const actualHash = sha256(fs.readFileSync(archiveFile));
  if (actualHash !== expectedHash) {
    throw new ProofFailure('missing_evidence', 'Official Node 20.0.0 archive checksum mismatch', { expectedHash, actualHash });
  }
  requireSuccess(command('tar', ['-xf', archiveFile, '-C', extractionDirectory]), 'setup_failure', 'official Node 20.0.0 archive extraction');
  const nodeExecutable = path.join(extractionDirectory, `node-v${NODE_20_VERSION}-win-x64`, 'node.exe');
  if (!fs.existsSync(nodeExecutable)) throw new ProofFailure('setup_failure', 'Extracted Node 20.0.0 executable was not found');
  return { nodeExecutable: fs.realpathSync(nodeExecutable), archiveFile, expectedHash, actualHash };
}

function runLane(label, nodeExecutable, npmCli, tarball, proofRoot, repositorySnapshot, candidateIdentity, receiptLanes) {
  const laneRoot = path.join(proofRoot, `consumer-${label}`);
  const installRoot = path.join(laneRoot, 'installed');
  const workspace = path.join(laneRoot, 'nested', 'workspace');
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(laneRoot, '.git'));
  const isolation = isolatedEnvironment(laneRoot, nodeExecutable);
  const writableRoots = { workspace, ...isolation.roots };
  assertContainedRoots(laneRoot, writableRoots);
  requireCondition(!fs.existsSync(path.join(workspace, '.work')) && !fs.existsSync(path.join(workspace, '.planning')), 'harness_failure', `${label} consumer workspace was not fresh`);
  const ambientDiscovery = ambientWorkspaceDiscovery(workspace, isolation.roots.temp);
  requireCondition(ambientDiscovery === laneRoot && ambientDiscovery !== workspace, 'harness_failure', `${label} sibling TEMP/ancestor marker regression was not armed`, { ambientDiscovery, workspace, temp: isolation.roots.temp });
  const before = {
    repository: repositorySnapshot,
    protected: protectedManifest(),
    writableRoots: snapshotRoots(writableRoots),
    ambient: snapshotTree(isolation.roots.ambient),
  };
  const evidence = {
    label,
    laneRoot,
    workspaceAuthority: { explicit: workspace, ambientDiscovery, temporaryRoot: isolation.roots.temp, workspaceFresh: true },
    node: { executable: nodeExecutable },
    npm: { cli: npmCli },
    environmentRoots: writableRoots,
    canaries: isolation.canaries,
    commands: [],
    snapshots: { before },
  };
  receiptLanes.push(evidence);
  const record = (description, result) => {
    evidence.commands.push({ description, ...commandReceipt(result) });
    return result;
  };
  const nodeVersion = requireSuccess(record('node version', command(nodeExecutable, ['--version'], { cwd: workspace, env: isolation.env })), 'setup_failure', `${label} node version`);
  const nodeVersionText = rawOutput(nodeVersion, 'stdout').trim();
  if (label === 'node20.0.0') requireCondition(nodeVersionText === 'v20.0.0', 'setup_failure', `portable runtime was not literal v20.0.0: ${nodeVersionText}`);
  const npmVersion = requireSuccess(record('npm version', command(nodeExecutable, [npmCli, '--version'], { cwd: installRoot, env: isolation.env })), 'setup_failure', `${label} npm version`);
  const npmConfig = {};
  for (const key of ['cache', 'prefix', 'userconfig']) {
    const result = requireSuccess(record(`npm config get ${key}`, command(nodeExecutable, [npmCli, 'config', 'get', key], { cwd: installRoot, env: isolation.env })), 'setup_failure', `${label} npm config get ${key}`);
    npmConfig[key] = { value: rawOutput(result, 'stdout').trim(), command: commandReceipt(result) };
  }
  const install = requireSuccess(record('tarball install', command(nodeExecutable, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', '--package-lock=false', '--prefix', installRoot, tarball], { cwd: installRoot, env: isolation.env })), 'setup_failure', `${label} tarball install`);
  const entry = path.join(installRoot, 'node_modules', candidateIdentity.name, candidateIdentity.declaredBin);
  const resolvedEntry = fs.realpathSync(entry);
  const resolvedPackage = fs.realpathSync(path.join(installRoot, 'node_modules', candidateIdentity.name));
  requireCondition(isInside(resolvedPackage, resolvedEntry), 'provenance_failure', `${label} CLI entry escaped installed package`);
  requireCondition(!isInside(REPOSITORY_ROOT, resolvedEntry), 'provenance_failure', `${label} CLI entry resolved to source checkout`);
  const installedPackageBytes = fs.readFileSync(path.join(resolvedPackage, 'package.json'));
  const installedPackage = JSON.parse(installedPackageBytes.toString('utf8'));
  const installedEntryHash = sha256(fs.readFileSync(resolvedEntry));
  requireCondition(installedPackage.name === candidateIdentity.name, 'provenance_failure', `${label} installed package name drifted`);
  requireCondition(installedPackage.version === candidateIdentity.version, 'provenance_failure', `${label} installed package version drifted`);
  requireCondition(installedPackage.bin?.gsdd === candidateIdentity.declaredBin, 'provenance_failure', `${label} installed gsdd bin mapping drifted`);
  requireCondition(installedEntryHash === candidateIdentity.entrySha256, 'provenance_failure', `${label} installed entry bytes differ from materialized candidate`);
  const execute = (cliCommand, args, description) => {
    const workspaceArgs = cliCommand === 'init' || cliCommand === 'health'
      ? ['--workspace-root', workspace]
      : [];
    const argv = [resolvedEntry, cliCommand, ...workspaceArgs, ...args];
    requireCondition(argv[1] === cliCommand, 'harness_failure', `${label} runner moved the CLI command from argv[2]`);
    if (workspaceArgs.length > 0) {
      requireCondition(argv[2] === '--workspace-root' && argv[3] === workspace, 'harness_failure', `${label} runner did not place command-scoped workspace authority after ${cliCommand}`);
    }
    const result = record(description, command(nodeExecutable, argv, { cwd: workspace, env: isolation.env }));
    return requireSuccess(result, 'failed_product_evidence', `${label} ${description}`);
  };
  const help = execute('help', [], 'help');
  requireCondition(/\bgsdd\b/i.test(rawOutput(help, 'stdout')), 'failed_product_evidence', `${label} help output was not recognizable`);
  const init = execute('init', ['--auto', '--tools', 'agents'], 'init');
  requireCondition(/GSDD initialized|setting up GSDD workflow/i.test(rawOutput(init, 'stdout')), 'failed_product_evidence', `${label} init output was not recognizable`);
  evidence.initWorkspaceTree = snapshotTree(workspace);
  requireCondition(fs.existsSync(path.join(workspace, '.work')), 'failed_product_evidence', `${label} init did not create .work`);
  requireCondition(!fs.existsSync(path.join(workspace, '.planning')), 'failed_product_evidence', `${label} init unexpectedly created .planning`);
  requireCondition(fs.readdirSync(workspace).filter((name) => name === '.work').length === 1, 'failed_product_evidence', `${label} init did not leave exactly one workspace .work`);
  const health = execute('health', ['--json'], 'health');
  let healthJson;
  try {
    healthJson = JSON.parse(rawOutput(health, 'stdout').trim());
  } catch (error) {
    fail('failed_product_evidence', `${label} health --json did not return JSON`, { stdout: health.stdout, message: error.message });
  }
  const after = {
    repository: snapshotTree(REPOSITORY_ROOT),
    protected: protectedManifest(),
    writableRoots: snapshotRoots(writableRoots),
    ambient: snapshotTree(isolation.roots.ambient),
  };
  verifyCanaries(isolation.canaries);
  requireCondition(JSON.stringify(after.repository) === JSON.stringify(repositorySnapshot), 'containment_failure', `${label} consumer execution changed the repository`);
  requireCondition(JSON.stringify(after.protected) === JSON.stringify(before.protected), 'containment_failure', `${label} consumer execution changed a protected input`);
  requireCondition(JSON.stringify(after.ambient) === JSON.stringify(before.ambient), 'containment_failure', `${label} consumer execution changed an ambient canary root`);
  for (const result of evidence.commands) {
    requireCondition(!result.cwd.includes(REPOSITORY_ROOT), 'provenance_failure', `${label} consumer cwd used source checkout`);
    requireCondition(!String(isolation.env.PATH).includes(REPOSITORY_ROOT), 'provenance_failure', `${label} consumer PATH used source checkout`);
    requireCondition(!`${result.stdout.text}\n${result.stderr.text}`.includes(REPOSITORY_ROOT), 'provenance_failure', `${label} consumer output leaked source checkout path`);
  }
  Object.assign(evidence, {
    node: { executable: nodeExecutable, version: nodeVersionText, versionCommand: commandReceipt(nodeVersion) },
    npm: { cli: npmCli, version: rawOutput(npmVersion, 'stdout').trim(), versionCommand: commandReceipt(npmVersion), resolvedConfig: npmConfig },
    installed: {
      packageRoot: resolvedPackage,
      entry: resolvedEntry,
      entrySha256: installedEntryHash,
      packageJsonSha256: sha256(installedPackageBytes),
      package: { name: installedPackage.name, version: installedPackage.version, declaredBin: installedPackage.bin?.gsdd },
      tarballSha256: candidateIdentity.tarballSha256,
    },
    install: commandReceipt(install),
    health: healthJson,
    snapshots: { before, after },
  });
  return evidence;
}

async function main() {
  const args = process.argv.slice(2);
  const developmentMode = args.length === 2 && args[0] === DEVELOPMENT_ARGUMENT && args[1] === SELF_PATH;
  if (args.length !== 0 && !developmentMode) throw new ProofFailure('invalid_invocation', `Use no arguments, or exactly ${DEVELOPMENT_ARGUMENT} ${SELF_PATH}`);
  const receipt = {
    schema: 'gsdd.phase05.packed-artifact.v1',
    acceptance: !developmentMode,
    classification: 'running',
    claimLimit: 'Exact committed candidate on recorded Windows Node 20.0.0 and current Node only; no registry, bare-npx, native-agent, interruption, concurrency, other-machine, or relaunch claim.',
    platform: { os: process.platform, arch: process.arch, shell: process.env.ComSpec || null },
    commands: [],
  };
  const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase05-packed-'));
  let cleanup = { attempted: false, success: false };
  try {
    receipt.snapshotRootSelfCheck = snapshotRootSelfCheck(proofRoot);
    receipt.candidate = candidateState(developmentMode);
    const repositorySnapshot = snapshotTree(REPOSITORY_ROOT);
    const materialized = materializeCandidate(receipt.candidate.commit, proofRoot);
    receipt.materialized = {
      source: materialized.source,
      archive: materialized.archive,
      archiveSha256: sha256(fs.readFileSync(materialized.archive)),
      sourceHasGitDirectory: fs.existsSync(path.join(materialized.source, '.git')),
    };
    const currentNode = fs.realpathSync(process.execPath);
    const currentNpm = resolveNpmCli(currentNode);
    const packEnvironmentRoot = path.join(proofRoot, 'pack-environment');
    const packEnvironment = isolatedEnvironment(packEnvironmentRoot, currentNode);
    assertContainedRoots(proofRoot, packEnvironment.roots);
    const packBefore = snapshotRoots(packEnvironment.roots);
    const packDirectory = path.join(proofRoot, 'packed');
    fs.mkdirSync(packDirectory);
    const pack = requireSuccess(command(currentNode, [currentNpm, 'pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory], { cwd: materialized.source, env: packEnvironment.env }), 'setup_failure', 'npm pack');
    receipt.commands.push(commandReceipt(pack));
    const packAfter = snapshotRoots(packEnvironment.roots);
    verifyCanaries(packEnvironment.canaries);
    receipt.packEnvironment = {
      roots: packEnvironment.roots,
      canaries: packEnvironment.canaries,
      snapshots: { before: packBefore, after: packAfter },
    };
    const packJson = JSON.parse(rawOutput(pack, 'stdout').trim());
    requireCondition(packJson.length === 1, 'provenance_failure', 'npm pack must produce exactly one tarball');
    const packRecord = packJson[0];
    const tarball = path.join(packDirectory, packRecord.filename);
    const tarballBytes = fs.readFileSync(tarball);
    const packageJson = JSON.parse(fs.readFileSync(path.join(materialized.source, 'package.json'), 'utf8'));
    requireCondition(packageJson.name === 'gsdd-cli', 'provenance_failure', 'candidate package name drifted');
    requireCondition(packageJson.bin?.gsdd === 'bin/gsdd.mjs', 'provenance_failure', 'candidate gsdd bin mapping drifted');
    const materializedEntry = path.join(materialized.source, packageJson.bin.gsdd);
    requireCondition(fs.existsSync(materializedEntry), 'provenance_failure', 'materialized gsdd entry is missing');
    receipt.package = {
      name: packageJson.name,
      version: packageJson.version,
      declaredBin: packageJson.bin.gsdd,
      materialized: {
        packageJsonSha256: sha256(fs.readFileSync(path.join(materialized.source, 'package.json'))),
        entrySha256: sha256(fs.readFileSync(materializedEntry)),
      },
      tarball: { filename: packRecord.filename, sha256: sha256(tarballBytes), integrity: sha512Sri(tarballBytes), npmIntegrity: packRecord.integrity, members: (packRecord.files || []).map((entry) => entry.path).sort() },
    };
    requireCondition(receipt.package.tarball.integrity === packRecord.integrity, 'provenance_failure', 'npm pack integrity did not match computed tarball integrity');
    requireCondition(receipt.package.tarball.members.includes(packageJson.bin.gsdd), 'provenance_failure', 'tarball does not contain declared gsdd entry');
    const portable = await portableNode20(proofRoot);
    receipt.node20Bootstrap = { archive: NODE_20_ARCHIVE, expectedSha256: portable.expectedHash, actualSha256: portable.actualHash, executable: portable.nodeExecutable };
    receipt.lanes = [];
    const candidateIdentity = {
      name: receipt.package.name,
      version: receipt.package.version,
      declaredBin: receipt.package.declaredBin,
      entrySha256: receipt.package.materialized.entrySha256,
      tarballSha256: receipt.package.tarball.sha256,
    };
    runLane('node20.0.0', portable.nodeExecutable, resolveNpmCli(portable.nodeExecutable), tarball, proofRoot, repositorySnapshot, candidateIdentity, receipt.lanes);
    runLane('current-node', currentNode, currentNpm, tarball, proofRoot, repositorySnapshot, candidateIdentity, receipt.lanes);
    receipt.classification = developmentMode ? 'non_acceptance_development_harness_pass' : 'acceptance_pass';
  } catch (error) {
    const failure = error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack });
    receipt.classification = failure.classification;
    receipt.failure = { message: failure.message, cause: failure.cause || null };
    process.exitCode = 1;
  } finally {
    try {
      cleanup.attempted = true;
      cleanup.validation = safeRemove(proofRoot);
      cleanup.success = !fs.existsSync(proofRoot);
    } catch (error) {
      cleanup.error = error.message;
      receipt.classification = 'cleanup_failure';
      process.exitCode = 1;
    }
    receipt.cleanup = cleanup;
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }
}

main();
