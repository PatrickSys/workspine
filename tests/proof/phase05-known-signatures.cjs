#!/usr/bin/env node
'use strict';

// Deliberately explicit Phase 05 proof. This is not ordinary test discovery:
// it repacks two immutable producers and only touches its disposable temp root.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPOSITORY_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const SELF_PATH = 'tests/proof/phase05-known-signatures.cjs';
const DEVELOPMENT_ARGUMENT = '--development-harness';
const FIXED_CANDIDATE = 'da8154e787453faabc31ae981c86e9ad8960aedc';
const HISTORICAL_COMMIT = 'cc7fc2c19af56815dec007702c5e9637b02a4713';
const HISTORICAL_TREE = '11bd2c32328ea1b396d3b5ea99da545a7b6d17ac';
const PACKAGE_VERSION = '0.32.0';
const HISTORICAL_PACKAGE_VERSION = '0.25.0';
const PACKAGE_BIN = 'bin/gsdd.mjs';
const TARBALL_SHA256 = '86cd25cd7bf6d44a6e60d3a7063afe31a76c2ba15d0f50709b63a2143f8301b0';
const PACKAGE_JSON_SHA256 = 'ec2a562ae51b7e14087c1d14c9eb6d48472e1ac4da9033b410418695a9788058';
const ENTRY_SHA256 = '2bb044333f94cccbce99439c106684329ff3be6d5d62880f206e63e4290d3728';
const OUTPUT_LIMIT_BYTES = 12 * 1024;
const COMMAND_BUDGET_MS = 120 * 1000;
const PROTECTED_INPUTS = Object.freeze([
  ['.work.zip', 356000, '36158acba6dda63a17dde4e5bc288fbd17e6297d3964f6729dc33baa72fb5f2b'],
  ['deep-research-report-decision-driven-second.md', 38875, '3e12c48f66065136830551acc80fb02afce59d7ff50f0b6c37627102f2dbd4d2'],
  ['deep-research-report-decision-driven.md', 36427, 'c6c1a6b58d0c90c933f4ac35d79feda7fc5a95805bfddca2a3f04da9bab904f8'],
  ['workspine.zip', 6691999, '83184a0ed5a6f46e6586a454ab06e5e2ac2bad3078fccc58f933ebcbf6d65127'],
]);
const PRODUCERS = Object.freeze({
  current: Object.freeze({ candidate: FIXED_CANDIDATE, package: `candidate@${PACKAGE_VERSION}`, tarballSha256: TARBALL_SHA256, packageJsonSha256: PACKAGE_JSON_SHA256, entrySha256: ENTRY_SHA256 }),
  historical: Object.freeze({ commit: HISTORICAL_COMMIT, tree: HISTORICAL_TREE, package: `historical-release@${HISTORICAL_PACKAGE_VERSION}`, nodeFloor: '>=20' }),
});
const CURRENT_INIT = Object.freeze(['init', '--workspace-root', '<root>', '--auto', '--tools', 'agents']);
const CURRENT_MIGRATE = Object.freeze(['init', '--workspace-root', '<root>', '--migrate', '--auto', '--tools', 'agents']);
const CURRENT_UPDATE = Object.freeze(['update', '--workspace-root', '<root>']);
const CURRENT_UPDATE_TEMPLATES = Object.freeze(['update', '--workspace-root', '<root>', '--templates']);
// Guidance text is derived from the pinned candidate's own installed package name (verified
// byte-exact against PACKAGE_JSON_SHA256 in installProducer) rather than a hardcoded literal,
// so this stays correct against whatever that frozen commit's package.json actually says.
const MIGRATION_GUIDANCE = (packageName) => `npx -y ${packageName} init --migrate`;
const SPLIT_ROOT_GUIDANCE = 'Both `.work/` and `.planning/` exist. Refusing split-root state. Resolve the two roots manually so only one remains; Workspine will not merge or delete either root.';
const MISSING_OWNERSHIP_GUIDANCE = 'generation manifest ownership is missing or corrupt. Restore a valid manifest or preserve the templates before retrying.';
const COMMIT_DOCS_GUIDANCE = 'Remove that user-owned ignore entry manually, then retry.';
const COLLISION_GUIDANCE = 'is not manifest-owned. Move or rename the consumer file, then retry.';
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

class ProofFailure extends Error {
  constructor(classification, message, cause = null) {
    super(message);
    this.classification = classification;
    this.cause = cause;
  }
}

function fail(classification, message, cause = null) { throw new ProofFailure(classification, message, cause); }
function requireCondition(condition, classification, message, cause = null) { if (!condition) fail(classification, message, cause); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function normalized(relativePath) { return relativePath.split(path.sep).join('/'); }
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!!relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function outputReceipt(value) {
  const bytes = Buffer.from(value || '');
  const truncated = bytes.length > OUTPUT_LIMIT_BYTES;
  const visible = truncated ? Buffer.concat([bytes.subarray(0, OUTPUT_LIMIT_BYTES / 2), Buffer.from('\n...[output truncated by proof runner]...\n'), bytes.subarray(bytes.length - (OUTPUT_LIMIT_BYTES / 2))]) : bytes;
  return { bytes: bytes.length, sha256: sha256(bytes), truncated, text: visible.toString('utf8') };
}
function command(file, args, options = {}) {
  const startedAt = Date.now();
  const result = childProcess.spawnSync(file, args, { cwd: options.cwd, env: options.env, encoding: 'buffer', windowsHide: true, timeout: COMMAND_BUDGET_MS, maxBuffer: 16 * 1024 * 1024 });
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
  const receipt = {
    command: file, args, cwd: options.cwd || process.cwd(), exitCode: result.status === null ? -1 : result.status,
    signal: result.signal || null, timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'), elapsedMs: Date.now() - startedAt,
    stdout: outputReceipt(result.stdout), stderr: outputReceipt(result.stderr),
  };
  Object.defineProperties(receipt, { _stdout: { value: Buffer.from(result.stdout || ''), enumerable: false }, _stderr: { value: Buffer.from(result.stderr || ''), enumerable: false } });
  return receipt;
}
function hostObservation() {
  if (process.platform !== 'win32') return { available: false, reason: 'process/port observer is implemented for the recorded Windows proof only' };
  const children = childProcess.spawnSync('wmic.exe', ['process', 'where', `(ParentProcessId=${process.pid})`, 'get', 'Name,ProcessId', '/format:csv'], { encoding: 'buffer', windowsHide: true, timeout: 2 * 1000, maxBuffer: 64 * 1024 });
  const ports = childProcess.spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'buffer', windowsHide: true, timeout: 2 * 1000, maxBuffer: 256 * 1024 });
  if (children.error || children.status !== 0 || ports.error || ports.status !== 0) return { available: false, reason: children.error?.message || ports.error?.message || `native observer exits ${children.status}/${ports.status}` };
  const childText = Buffer.from(children.stdout || '').toString('utf8');
  const descendants = childText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => /\d+$/.test(line)).map((line) => ({ name: line.replace(/,?\d+$/, '').replace(/^[^,]*,/, '').trim(), pid: Number(line.match(/(\d+)$/)[1]) }));
  const descendantsWithoutProbe = descendants.filter((entry) => entry.name.toLowerCase() !== 'wmic.exe');
  const childPids = new Set(descendantsWithoutProbe.map((entry) => entry.pid));
  const listeners = Buffer.from(ports.stdout || '').toString('utf8').split(/\r?\n/).filter((line) => /\sLISTENING\s+\d+\s*$/.test(line)).map((line) => Number(line.match(/(\d+)\s*$/)[1])).filter((pid) => childPids.has(pid));
  return { available: true, descendants: descendantsWithoutProbe, listeners, probes: { children: outputReceipt(children.stdout), ports: outputReceipt(ports.stdout) }, probeExclusions: ['WMIC.exe'] };
}
function observedCommand(file, args, options = {}) {
  const before = hostObservation(); const receipt = command(file, args, options); const after = hostObservation();
  if (after.available) requireCondition(after.descendants.length === 0 && after.listeners.length === 0, 'containment_failure', 'command left a runner-owned descendant or listener', { command: commandReceipt(receipt), after });
  return Object.assign(receipt, { processObservation: { before, after, claimLimit: after.available ? 'no direct runner-child or its listener observed after this synchronous command; no recursive descendant or universal port claim' : 'process/port attribution unavailable; no broader process/port containment claim' } });
}
function npmCommand(args, options) {
  requireCondition(fs.existsSync(NPM_CLI), 'setup_failure', `bundled npm CLI is unavailable: ${NPM_CLI}`);
  return command(process.execPath, [NPM_CLI, ...args], options);
}
function rawOutput(receipt, stream) { return receipt[`_${stream}`].toString('utf8'); }
function commandReceipt(receipt) { const { _stdout, _stderr, ...visible } = receipt; return visible; }
function requireSuccess(receipt, classification, description) {
  requireCondition(receipt.exitCode === 0 && !receipt.timedOut, classification, `${description} failed with exit ${receipt.exitCode}`, commandReceipt(receipt));
  return receipt;
}
function git(args) { return requireSuccess(command('git', args, { cwd: REPOSITORY_ROOT }), 'setup_failure', `git ${args.join(' ')}`); }

function snapshotTree(root) {
  const entries = [];
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort((left, right) => left.localeCompare(right, 'en'))) {
      const absolute = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'link', target: fs.readlinkSync(absolute) });
      else if (stat.isDirectory()) { entries.push({ path: `${relative}/`, type: 'directory' }); visit(absolute, relative); }
      else if (stat.isFile()) { const bytes = fs.readFileSync(absolute); entries.push({ path: relative, type: 'file', bytes: bytes.length, sha256: sha256(bytes) }); }
      else entries.push({ path: relative, type: 'other' });
    }
  }
  if (fs.existsSync(root)) visit(root);
  return entries;
}
function snapshotRoot(root) {
  const absolute = path.resolve(root);
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { path: absolute, type: 'link', target: fs.readlinkSync(absolute), entries: [] };
    if (stat.isDirectory()) return { path: absolute, type: 'directory', entries: snapshotTree(absolute) };
    if (stat.isFile()) { const bytes = fs.readFileSync(absolute); return { path: absolute, type: 'file', bytes: bytes.length, sha256: sha256(bytes), entries: [] }; }
    return { path: absolute, type: 'other', entries: [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: absolute, type: 'missing', entries: [] };
    throw error;
  }
}
function idempotenceSnapshot(root) {
  const snapshot = snapshotRoot(root);
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => {
      if (entry.type !== 'file' || entry.path !== '.work/generation-manifest.json') return entry;
      const manifest = readJson(path.join(root, '.work', 'generation-manifest.json'), 'product_mismatch');
      delete manifest.generatedAt;
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
      return { ...entry, bytes: bytes.length, sha256: sha256(bytes), normalizedVolatileGeneratedAt: true };
    }),
  };
}
function treeDigest(entries) { return sha256(Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8')); }
function snapshotReceipt(snapshot) { return { path: snapshot.path, type: snapshot.type, entryCount: snapshot.entries.length, entriesSha256: treeDigest(snapshot.entries) }; }
function migrationTreeDigest(entries) {
  const canonical = entries.map((entry) => entry.type === 'file'
    ? { path: entry.path, type: 'file', size: entry.bytes, sha256: entry.sha256 }
    : entry);
  return sha256(Buffer.from(canonical.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8'));
}
function protectedManifest() {
  return PROTECTED_INPUTS.map(([relativePath, expectedBytes, expectedHash]) => {
    const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath));
    requireCondition(bytes.length === expectedBytes && sha256(bytes) === expectedHash, 'provenance_failure', `protected input drifted: ${relativePath}`);
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
}
function repositoryStatusReceipt() {
  const tracked = git(['status', '--porcelain=v1', '--untracked-files=no', '--', '.']);
  const untracked = rawOutput(git(['ls-files', '--others', '--exclude-standard']), 'stdout').split(/\r?\n/).filter(Boolean).sort();
  return { trackedStatus: rawOutput(tracked, 'stdout'), untracked };
}
function hostRiskRoots() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return {
    repository: REPOSITORY_ROOT,
    userNpmrc: path.join(home, '.npmrc'),
    roamingNpmrc: path.join(appData, 'npm', 'npmrc'),
    localNpmCache: path.join(localAppData, 'npm-cache'),
  };
}
function boundedRiskSnapshot(root) {
  const absolute = path.resolve(root);
  try {
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return snapshotReceipt(snapshotRoot(absolute));
    const entries = fs.readdirSync(absolute).sort((left, right) => left.localeCompare(right, 'en')).map((name) => {
      const entry = fs.lstatSync(path.join(absolute, name));
      return { name, type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other', bytes: entry.isFile() ? entry.size : null };
    });
    return { path: absolute, type: 'directory', scope: 'bounded-immediate-children', entryCount: entries.length, entriesSha256: sha256(Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: absolute, type: 'missing', scope: 'bounded-immediate-children', entryCount: 0, entriesSha256: sha256(Buffer.alloc(0)) };
    throw error;
  }
}
function hostRiskReceipt() {
  const roots = hostRiskRoots();
  return { roots, snapshots: Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, boundedRiskSnapshot(root)])), canaries: { protectedInputs: protectedManifest(), repositoryStatus: repositoryStatusReceipt() }, claimLimit: 'repo status/protected-byte canaries plus bounded immediate-child ambient npm-risk snapshots; no recursive whole-home containment claim' };
}
function assertHostRiskExact(before) {
  const after = hostRiskReceipt();
  requireCondition(sameJson(before, after), 'containment_failure', 'declared repository or ambient npm-risk root changed during proof', { before, after });
  return after;
}
function candidateState(developmentMode) {
  const head = rawOutput(git(['rev-parse', '--verify', 'HEAD']), 'stdout').trim().toLowerCase();
  const tracked = git(['status', '--porcelain=v1', '--untracked-files=no', '--', '.']);
  requireCondition(rawOutput(tracked, 'stdout') === '', 'provenance_failure', 'tracked or index drift prevents proof');
  const untracked = rawOutput(git(['ls-files', '--others', '--exclude-standard']), 'stdout').split(/\r?\n/).filter(Boolean).sort();
  const allowed = PROTECTED_INPUTS.map(([relativePath]) => relativePath).concat(developmentMode ? [SELF_PATH] : []).sort();
  requireCondition(sameJson(untracked, allowed), 'provenance_failure', 'untracked inputs do not match protected/development allowlist', { untracked, allowed });
  if (developmentMode) requireCondition(head === FIXED_CANDIDATE, 'provenance_failure', `development mode requires candidate HEAD ${FIXED_CANDIDATE}, received ${head}`);
  else {
    const parents = rawOutput(git(['rev-list', '--parents', '-n', '1', head]), 'stdout').trim().split(/\s+/);
    requireCondition(parents.length === 2 && parents[1] === FIXED_CANDIDATE, 'provenance_failure', 'default mode requires one non-merge proof commit directly atop fixed candidate');
    const delta = rawOutput(git(['diff', '--name-only', `${FIXED_CANDIDATE}..${head}`]), 'stdout').split(/\r?\n/).filter(Boolean).sort();
    requireCondition(sameJson(delta, [SELF_PATH]), 'provenance_failure', 'default mode requires exactly the committed runner');
  }
  return { candidate: FIXED_CANDIDATE, proofRunnerHead: head, tracked: commandReceipt(tracked), untracked, protectedInputs: protectedManifest() };
}

const CASES = Object.freeze([
  { id: 'S1-current-idempotent', provenance: ['current_installed'], commands: [CURRENT_INIT, CURRENT_INIT, CURRENT_UPDATE], outcome: 'converge', allowed: ['declared-generated-refresh'], forbidden: ['unknown-adoption', 'nested-root', 'external-write'], receipts: ['manifest', 'health', 'next'], claimLimit: 'named current S1 fixture only' },
  { id: 'S2-config-v1-migrate', provenance: ['historical_installed', 'fixture_authored'], commands: [CURRENT_MIGRATE], outcome: 'converge', allowed: ['same-parent-rename', 'manifest-owned-refresh'], forbidden: ['consumer-byte-loss', 'external-write'], receipts: ['historical-raw-manifest', 'migration-receipt', 'health', 'next'], claimLimit: 'exact S2-config-v1 manifest only' },
  ...['missing_config', 'malformed_config', 'unsupported_init_version', 'nonempty_legacy_decisions', 'migration_receipt_exists', 'linked_legacy_entry'].map((reason) => ({ id: `S2-unsupported-${reason}`, provenance: ['fixture_authored'], commands: [CURRENT_MIGRATE], outcome: 'refuse', allowed: [], forbidden: ['all-fixture-write', 'external-write'], receipts: ['refusal-snapshot', 'legacy_unsupported-reason'], claimLimit: 'one named unsupported layout only' })),
  { id: 'S3-dual-conflict', provenance: ['historical_installed', 'fixture_authored'], commands: [CURRENT_MIGRATE, CURRENT_UPDATE], outcome: 'refuse', allowed: [], forbidden: ['all-fixture-write', 'external-write'], receipts: ['refusal-snapshot', 'split-root-message'], claimLimit: 'named dual-root fixture only' },
  { id: 'S4-current-bootstrap', provenance: ['fixture_authored'], commands: [CURRENT_INIT], outcome: 'converge', allowed: ['declared-generated-additions'], forbidden: ['consumer-byte-loss', 'external-write'], receipts: ['consumer-preservation', 'health', 'next'], claimLimit: 'named current bootstrap only' },
  { id: 'S4-missing-ownership', provenance: ['fixture_authored'], commands: [CURRENT_INIT], outcome: 'refuse', allowed: [], forbidden: ['all-fixture-write', 'external-write'], receipts: ['refusal-snapshot', 'ownership-guidance'], claimLimit: 'named missing ownership fixture only' },
  { id: 'S5-customized', provenance: ['current_installed', 'historical_installed', 'fixture_authored'], commands: [CURRENT_INIT, CURRENT_UPDATE_TEMPLATES, CURRENT_INIT, CURRENT_UPDATE_TEMPLATES], outcome: 'converge', allowed: ['recovery-before-replace', 'manifest-owned-refresh', 'configured-ignore'], forbidden: ['unknown-adoption', 'unknown-byte-loss', 'external-write'], receipts: ['recovery-receipt', 'tracking-idempotence', 'health', 'next'], claimLimit: 'named customized S5 fixture only' },
  { id: 'S5-commitdocs-true-ambiguous', provenance: ['current_installed', 'fixture_authored'], commands: [CURRENT_INIT], outcome: 'refuse', allowed: [], forbidden: ['all-fixture-write', 'external-write'], receipts: ['refusal-snapshot', 'commitDocs-guidance'], claimLimit: 'named commitDocs ambiguity only' },
  { id: 'S5-unknown-collision', provenance: ['current_installed', 'fixture_authored'], commands: [CURRENT_UPDATE_TEMPLATES], outcome: 'refuse', allowed: [], forbidden: ['all-fixture-write', 'external-write'], receipts: ['refusal-snapshot', 'collision-guidance'], claimLimit: 'named ownership collision only' },
]);

function validateCatalog() {
  const ids = CASES.map((fixture) => fixture.id);
  requireCondition(new Set(ids).size === ids.length, 'catalog_failure', 'fixture IDs are not unique');
  requireCondition(ids.includes('S1-current-idempotent') && ids.includes('S2-config-v1-migrate') && ids.includes('S3-dual-conflict') && ids.includes('S4-current-bootstrap') && ids.includes('S5-customized'), 'catalog_failure', 'catalog does not cover S1-S5');
  for (const fixture of CASES) {
    requireCondition(fixture.provenance.length > 0 && fixture.commands.length > 0 && fixture.receipts.length > 0, 'catalog_failure', `fixture ${fixture.id} is incomplete`);
    requireCondition(['converge', 'refuse'].includes(fixture.outcome), 'catalog_failure', `fixture ${fixture.id} has invalid outcome`);
    for (const argv of fixture.commands) requireCondition(argv.includes('--workspace-root') || fixture.id === 'S3-dual-conflict', 'catalog_failure', `fixture ${fixture.id} lacks an exact workspace command`);
  }
  requireCondition(PRODUCERS.current.tarballSha256 === TARBALL_SHA256 && PRODUCERS.historical.tree === HISTORICAL_TREE, 'catalog_failure', 'producer identity drifted');
  return { producers: PRODUCERS, fixtures: CASES.map(({ id, provenance, commands, outcome, allowed, forbidden, receipts, claimLimit }) => ({ id, provenance, commands, outcome, allowed, forbidden, receipts, claimLimit })) };
}

function catalogMode() {
  const before = protectedManifest();
  const catalog = validateCatalog();
  const after = protectedManifest();
  requireCondition(sameJson(before, after), 'catalog_failure', 'catalog changed protected inputs');
  process.stdout.write(`${JSON.stringify({ phase: '05-03', mode: 'catalog', acceptance: false, classification: 'catalog_non_acceptance_pass', noProductOrNetworkCommand: true, catalog }, null, 2)}\n`);
}

function safeRemove(proofRoot) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const realRoot = fs.realpathSync(proofRoot);
  requireCondition(isInside(tempRoot, realRoot), 'cleanup_failure', `refusing to remove outside OS temp: ${realRoot}`);
  requireCondition(path.basename(realRoot).startsWith('gsdd-phase05-known-signatures-'), 'cleanup_failure', `refusing unexpected proof root cleanup: ${realRoot}`);
  fs.rmSync(realRoot, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
  requireCondition(!fs.existsSync(realRoot), 'cleanup_failure', 'proof root remained after cleanup');
  return { target: realRoot, tempRoot };
}
function writeFile(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes, { flag: 'wx' });
}
function readJson(filePath, classification = 'fixture_failure') {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) { fail(classification, `invalid JSON: ${filePath}`, { message: error.message }); }
}
function isolatedEnvironment(proofRoot) {
  const home = path.join(proofRoot, 'home');
  const cache = path.join(proofRoot, 'npm-cache');
  const prefix = path.join(proofRoot, 'npm-prefix');
  const temporary = path.join(proofRoot, 'temp');
  const userConfig = path.join(proofRoot, 'npmrc');
  const globalConfig = path.join(proofRoot, 'npm-globalrc');
  for (const directory of [home, cache, prefix, temporary]) fs.mkdirSync(directory, { recursive: true });
  writeFile(userConfig, '# phase05 known-signatures local npm configuration\n');
  writeFile(globalConfig, '# phase05 known-signatures global npm configuration\n');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const env = {
    SystemRoot: systemRoot, WINDIR: systemRoot, ComSpec: process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe'),
    Path: process.env.Path || process.env.PATH || '', HOME: home, USERPROFILE: home, HOMEDRIVE: path.parse(home).root, HOMEPATH: path.relative(path.parse(home).root, home),
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: temporary, TMP: temporary,
    npm_config_cache: cache, npm_config_prefix: prefix, npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig,
    npm_config_registry: 'http://127.0.0.1:9/', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true',
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', NO_PROXY: '*', no_proxy: '*', CI: '1',
  };
  return { env, roots: { home, cache, prefix, temporary, userConfig, globalConfig }, receipt: { roots: { home, cache, prefix, temporary, userConfig, globalConfig }, allowlistedVariables: Object.keys(env).sort(), npmRegistry: env.npm_config_registry, npmIgnoreScripts: env.npm_config_ignore_scripts } };
}
function assertContained(proofRoot, namedRoots) {
  for (const [name, root] of Object.entries(namedRoots)) requireCondition(isInside(proofRoot, root), 'containment_failure', `${name} escaped proof root: ${root}`);
}
function archiveCommit(commit, destination, environment) {
  fs.mkdirSync(destination, { recursive: true });
  const archive = path.join(destination, 'source.tar');
  const result = observedCommand('git', ['archive', '--format=tar', '--output', archive, commit], { cwd: REPOSITORY_ROOT, env: environment.env });
  requireSuccess(result, 'producer_failure', `git archive ${commit}`);
  const extract = requireSuccess(observedCommand('tar', ['-xf', archive, '-C', destination], { cwd: REPOSITORY_ROOT, env: environment.env }), 'producer_failure', `extract archive ${commit}`);
  fs.unlinkSync(archive);
  return { archive: commandReceipt(result), extract: commandReceipt(extract) };
}
function packProducer(source, label, environment) {
  const pack = requireSuccess(observedCommand(process.execPath, [NPM_CLI, 'pack', '--ignore-scripts', '--json'], { cwd: source, env: environment.env }), 'producer_failure', `npm pack ${label}`);
  let data;
  try { data = JSON.parse(rawOutput(pack, 'stdout')); } catch (error) { fail('producer_failure', `npm pack ${label} did not produce JSON`, { output: commandReceipt(pack), message: error.message }); }
  requireCondition(Array.isArray(data) && data.length === 1 && typeof data[0].filename === 'string', 'producer_failure', `npm pack ${label} returned an unexpected package list`);
  const tarball = path.join(source, data[0].filename);
  requireCondition(fs.existsSync(tarball), 'producer_failure', `npm pack ${label} did not create ${data[0].filename}`);
  const members = Array.isArray(data[0].files) ? data[0].files : [];
  const requiredMembers = members.filter((member) => [PACKAGE_BIN, 'package.json'].includes(member.path));
  requireCondition(requiredMembers.length === 2, 'producer_failure', `npm pack ${label} did not expose package/bin members`);
  return { source, tarball, pack: commandReceipt(pack), packageIdentity: { filename: data[0].filename, memberCount: members.length, requiredMembers }, sha256: sha256(fs.readFileSync(tarball)) };
}
function installProducer(producer, destination, label, environment) {
  fs.mkdirSync(destination, { recursive: true });
  writeFile(path.join(destination, 'package.json'), `${JSON.stringify({ private: true, name: `phase05-${label}` })}\n`);
  const install = requireSuccess(observedCommand(process.execPath, [NPM_CLI, 'install', '--ignore-scripts', '--no-audit', '--no-fund', producer.tarball], { cwd: destination, env: environment.env }), 'producer_failure', `local tarball install ${label}`);
  // The installed node_modules subdirectory name is whatever the packed producer's own
  // package.json says, not a hardcoded literal - read it from the same source npm packed.
  const packageName = JSON.parse(fs.readFileSync(path.join(producer.source, 'package.json'), 'utf-8')).name;
  const entry = path.join(destination, 'node_modules', packageName, PACKAGE_BIN);
  requireCondition(fs.existsSync(entry), 'producer_failure', `installed ${label} entry missing`);
  const realEntry = fs.realpathSync(entry);
  requireCondition(isInside(destination, realEntry), 'containment_failure', `installed ${label} entry escaped install root`);
  return { install: commandReceipt(install), root: destination, entry: realEntry, entrySha256: sha256(fs.readFileSync(realEntry)), packageJsonSha256: sha256(fs.readFileSync(path.join(destination, 'node_modules', packageName, 'package.json'))), packageName };
}
function buildProducers(proofRoot, environment) {
  const currentSource = path.join(proofRoot, 'current-source');
  const currentArchive = archiveCommit(FIXED_CANDIDATE, currentSource, environment);
  const currentPacked = packProducer(currentSource, 'current', environment);
  requireCondition(currentPacked.sha256 === TARBALL_SHA256, 'provenance_failure', 'current fixed candidate did not repack to accepted 05-01 tarball', currentPacked);
  const current = installProducer(currentPacked, path.join(proofRoot, 'current-install'), 'current', environment);
  requireCondition(current.entrySha256 === ENTRY_SHA256 && current.packageJsonSha256 === PACKAGE_JSON_SHA256, 'provenance_failure', 'current installed package identity drifted', current);
  const historicalSource = path.join(proofRoot, 'historical-source');
  const tree = rawOutput(git(['rev-parse', `${HISTORICAL_COMMIT}^{tree}`]), 'stdout').trim();
  requireCondition(tree === HISTORICAL_TREE, 'provenance_failure', 'historical commit tree identity drifted', { tree, expected: HISTORICAL_TREE });
  const historicalArchive = archiveCommit(HISTORICAL_COMMIT, historicalSource, environment);
  const historicalPacked = packProducer(historicalSource, 'historical', environment);
  const historical = installProducer(historicalPacked, path.join(proofRoot, 'historical-install'), 'historical', environment);
  const historicalPackage = readJson(path.join(historical.root, 'node_modules', historical.packageName, 'package.json'), 'producer_failure');
  requireCondition(historicalPackage.version === HISTORICAL_PACKAGE_VERSION, 'provenance_failure', 'historical installed package version drifted', { actual: historicalPackage.version });
  return { current: { ...currentPacked, ...current, candidate: FIXED_CANDIDATE, archive: currentArchive }, historical: { ...historicalPacked, ...historical, commit: HISTORICAL_COMMIT, tree: HISTORICAL_TREE, archive: historicalArchive } };
}
function producerReceipt(producer) {
  return {
    archive: producer.archive,
    pack: producer.pack,
    install: producer.install,
    tarball: { sha256: producer.sha256, packageIdentity: producer.packageIdentity },
    installed: { root: producer.root, entry: producer.entry, entrySha256: producer.entrySha256, packageJsonSha256: producer.packageJsonSha256 },
  };
}
function runtimeReceipt() {
  return { node: { executable: process.execPath, version: process.version }, npm: { cli: NPM_CLI }, os: { platform: process.platform, release: os.release(), arch: process.arch }, shell: process.env.ComSpec || process.env.SHELL || 'not_recorded' };
}
function gitFixture(root, environment) {
  fs.mkdirSync(root, { recursive: true });
  requireSuccess(command('git', ['init', '--quiet'], { cwd: root, env: environment.env }), 'fixture_failure', `git init ${root}`);
}
function commandAt(entry, argv, root, environment) { return observedCommand(process.execPath, [entry, ...argv], { cwd: root, env: environment.env }); }
function currentArgs(template, root) { return template.map((value) => value === '<root>' ? root : value); }
function assertRefusal(receipt, before, root, expectedText, fixtureId) {
  requireCondition(receipt.exitCode !== 0, 'product_mismatch', `${fixtureId} unexpectedly succeeded`, commandReceipt(receipt));
  const output = `${receipt.stdout.text}\n${receipt.stderr.text}`;
  requireCondition(output.includes(expectedText), 'product_mismatch', `${fixtureId} did not emit exact refusal guidance`, { expectedText, output, command: commandReceipt(receipt) });
  const after = snapshotRoot(root);
  requireCondition(sameJson(before, after), 'product_mismatch', `${fixtureId} changed a refusal fixture`, { before, after, command: commandReceipt(receipt) });
  return { command: commandReceipt(receipt), before: snapshotReceipt(before), after: snapshotReceipt(after) };
}
function consumerEntry(root, relativePath) {
  const absolute = path.join(root, ...relativePath.split('/'));
  const stat = fs.lstatSync(absolute);
  if (stat.isDirectory()) return { path: relativePath.endsWith('/') ? relativePath : `${relativePath}/`, type: 'directory' };
  const bytes = fs.readFileSync(absolute);
  return { path: relativePath, type: 'file', bytes: bytes.length, sha256: sha256(bytes) };
}
function assertConsumerExact(root, entries, fixtureId) {
  for (const expected of entries) {
    const actual = consumerEntry(root, expected.path);
    const { provenance, ...identity } = expected;
    requireCondition(sameJson(actual, identity), 'product_mismatch', `${fixtureId} changed consumer-owned entry ${expected.path}`, { expected, actual });
  }
}
function ownedPathsFromManifest(manifest) {
  return new Set(ownedHashesFromManifest(manifest).keys());
}
function ownedHashesFromManifest(manifest) {
  const paths = new Map();
  if (manifest) paths.set('generation-manifest.json', null);
  for (const [group, files] of Object.entries(manifest?.templates || {})) {
    const directory = group === 'brownfieldChange' ? 'brownfield-change' : group;
    for (const [name, hash] of Object.entries(files || {})) paths.set(group === 'root' ? `templates/${name}` : `templates/${directory}/${name}`, hash);
  }
  for (const [name, hash] of Object.entries(manifest?.roles || {})) paths.set(`templates/roles/${name}`, hash);
  for (const [relativePath, hash] of Object.entries(manifest?.runtimeHelpers || {})) paths.set(relativePath, hash);
  return paths;
}
function pathOrAncestorIsOwned(relativePath, ownedPaths) {
  const clean = relativePath.replace(/\/$/, '');
  return [...ownedPaths].some((owned) => clean === owned || owned.startsWith(`${clean}/`) || clean.startsWith(`${owned}/`));
}
function assertS2FinalPolicy(root, preEntries, historicalManifest, fixtureId) {
  const currentManifest = readJson(path.join(root, '.work', 'generation-manifest.json'), 'product_mismatch');
  const historicalOwned = ownedPathsFromManifest(historicalManifest);
  const currentOwnedHashes = ownedHashesFromManifest(currentManifest);
  const currentOwned = new Set(currentOwnedHashes.keys());
  const expected = new Map(preEntries.map((entry) => [`.work/${entry.path}`, entry]));
  const actual = new Map(snapshotTree(path.join(root, '.work')).map((entry) => [`.work/${entry.path}`, entry]));
  const permitted = new Set(['.work/migration-receipt.json']);
  const managedObsoleteRemovals = [];
  for (const [pathName, before] of expected) {
    const after = actual.get(pathName);
    const relative = pathName.replace(/^\.work\//, '');
    if (!after) {
      const historicallyOwned = pathOrAncestorIsOwned(relative, historicalOwned);
      const currentlyOwned = pathOrAncestorIsOwned(relative, currentOwned);
      requireCondition(historicallyOwned && !currentlyOwned, 'product_mismatch', `${fixtureId} removed legacy entry without an owned obsolete-removal allowance`, { path: pathName, before, historicallyOwned, currentlyOwned });
      managedObsoleteRemovals.push({ path: pathName, prior: before, classification: 'historically_manifest_owned_managed_obsolete_removal' });
      continue;
    }
    if (!pathOrAncestorIsOwned(relative, historicalOwned)) requireCondition(sameJson(before, after), 'product_mismatch', `${fixtureId} changed non-generated legacy entry`, { path: pathName, before, after });
  }
  for (const [pathName, after] of actual) {
    if (expected.has(pathName) || permitted.has(pathName)) continue;
    const relative = pathName.replace(/^\.work\//, '');
    if (after.type === 'file') {
      const expectedHash = currentOwnedHashes.get(relative);
      requireCondition(typeof expectedHash === 'string' && expectedHash === after.sha256, 'product_mismatch', `${fixtureId} added undeclared or hash-mismatched managed file`, { path: pathName, after, expectedHash: expectedHash ?? null });
    } else if (after.type === 'directory') {
      const directory = relative.replace(/\/$/, '');
      requireCondition([...currentOwned].some((leaf) => leaf.startsWith(`${directory}/`)), 'product_mismatch', `${fixtureId} added directory that is not a current-managed leaf container`, { path: pathName, after, currentOwned: [...currentOwned].sort() });
    } else {
      fail('product_mismatch', `${fixtureId} added unsupported non-regular entry`, { path: pathName, after });
    }
  }
  return { baselineEntries: preEntries.length, baselineSha256: treeDigest(preEntries), historicalManifestOwnedPaths: [...historicalOwned].sort(), currentManifestOwnedPaths: [...currentOwned].sort(), managedObsoleteRemovals, permittedAddedPaths: [...permitted], finalEntries: actual.size, finalSha256: treeDigest([...actual.values()]) };
}
function parseFollowups(current, root, environment, fixtureId) {
  const health = commandAt(current.entry, ['health', '--workspace-root', root, '--json'], root, environment);
  requireSuccess(health, 'product_mismatch', `${fixtureId} health`);
  let healthJson;
  try { healthJson = JSON.parse(rawOutput(health, 'stdout')); } catch (error) { fail('product_mismatch', `${fixtureId} health did not emit JSON`, { message: error.message, output: commandReceipt(health) }); }
  requireCondition(healthJson.status !== 'broken' && Array.isArray(healthJson.errors) && healthJson.errors.length === 0, 'product_mismatch', `${fixtureId} health reported broken/errors`, healthJson);
  const next = commandAt(current.entry, ['next', '--json'], root, environment);
  requireSuccess(next, 'product_mismatch', `${fixtureId} next`);
  let nextJson;
  try { nextJson = JSON.parse(rawOutput(next, 'stdout')); } catch (error) { fail('product_mismatch', `${fixtureId} next did not emit JSON`, { message: error.message, output: commandReceipt(next) }); }
  const continuity = nextJson.continuity;
  requireCondition(nextJson.schema_version && nextJson.operation && continuity && continuity.workspace_root && continuity.state_root === '.work', 'product_mismatch', `${fixtureId} next receipt lacks active current continuity`, nextJson);
  requireCondition(continuity.posture && Object.hasOwn(continuity.posture, 'approval') && Object.hasOwn(continuity.posture, 'result') && Object.hasOwn(continuity.posture, 'verification'), 'product_mismatch', `${fixtureId} next posture is incomplete`, nextJson);
  return { health: commandReceipt(health), healthJson, next: commandReceipt(next), nextJson, posture: continuity.posture };
}
function historicalFixture(producers, proofRoot, environment) {
  const root = path.join(proofRoot, 'historical-emission');
  gitFixture(root, environment); const before = snapshotTree(root);
  const invoke = commandAt(producers.historical.entry, ['init', '--auto', '--tools', 'agents'], root, environment);
  requireSuccess(invoke, 'producer_failure', 'historical producer init');
  const planning = path.join(root, '.planning');
  requireCondition(fs.existsSync(planning), 'producer_failure', 'historical producer did not emit .planning');
  const raw = snapshotTree(root).filter((entry) => !entry.path.startsWith('.git/'));
  const planningRaw = snapshotTree(planning);
  requireCondition(!sameJson(before.filter((entry) => !entry.path.startsWith('.git/')), raw) && planningRaw.length > 0, 'producer_failure', 'historical producer emitted no classified raw output');
  const staleSkill = path.join(root, '.agents', 'skills', 'work-plan', 'SKILL.md');
  requireCondition(fs.existsSync(staleSkill), 'producer_failure', 'historical producer did not emit expected local skill');
  return { root, invoke: commandReceipt(invoke), rawManifest: raw, rawDigest: treeDigest(raw), planningRawManifest: planningRaw, planningRawDigest: treeDigest(planningRaw), staleSkill: { bytes: fs.readFileSync(staleSkill), sha256: sha256(fs.readFileSync(staleSkill)), path: '.agents/skills/work-plan/SKILL.md' } };
}
function copyHistoricalPlanning(history, targetRoot) { fs.cpSync(path.join(history.root, '.planning'), path.join(targetRoot, '.planning'), { recursive: true, dereference: false, errorOnExist: true }); }
function addConsumerS2Entries(root) {
  const entries = [
    { relativePath: '.planning/ROADMAP.md', type: 'file', bytes: Buffer.from('# Consumer roadmap\n'), provenance: 'fixture_authored:consumer-roadmap' },
    { relativePath: '.planning/phases/05/consumer.md', type: 'file', bytes: Buffer.from('consumer phase bytes\n'), provenance: 'fixture_authored:consumer-phase' },
    { relativePath: '.planning/consumer.bin', type: 'file', bytes: Buffer.from([0, 255, 19, 37]), provenance: 'fixture_authored:consumer-binary' },
    { relativePath: '.planning/consumer-empty', type: 'directory', provenance: 'fixture_authored:consumer-empty-directory' },
  ];
  for (const entry of entries) {
    const absolute = path.join(root, ...entry.relativePath.split('/'));
    if (entry.type === 'directory') fs.mkdirSync(absolute, { recursive: true });
    else writeFile(absolute, entry.bytes);
  }
  return entries.map((entry) => ({ ...consumerEntry(root, entry.relativePath), provenance: entry.provenance }));
}
function fixtureS1(producers, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S1-current-idempotent'); gitFixture(root, environment);
  const initial = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(initial, 'product_mismatch', 'S1 initial init');
  writeFile(path.join(root, 'team-sentinel.txt'), 'unknown team sentinel\n'); const sentinel = consumerEntry(root, 'team-sentinel.txt');
  const repeat = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(repeat, 'product_mismatch', 'S1 repeated init');
  const update = commandAt(producers.current.entry, currentArgs(CURRENT_UPDATE, root), root, environment); requireSuccess(update, 'product_mismatch', 'S1 update');
  requireCondition(fs.existsSync(path.join(root, '.work')) && !fs.existsSync(path.join(root, '.planning')), 'product_mismatch', 'S1 did not leave exactly one .work root');
  assertConsumerExact(root, [sentinel], 'S1-current-idempotent');
  return { fixture: 'S1-current-idempotent', commands: [commandReceipt(initial), commandReceipt(repeat), commandReceipt(update)], followups: parseFollowups(producers.current, root, environment, 'S1-current-idempotent') };
}
function fixtureS2(producers, history, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S2-config-v1-migrate'); gitFixture(root, environment); copyHistoricalPlanning(history, root);
  const consumer = addConsumerS2Entries(root); const historicalManifest = readJson(path.join(root, '.planning', 'generation-manifest.json'), 'producer_failure'); const pre = snapshotTree(path.join(root, '.planning')); const preDigest = migrationTreeDigest(pre);
  const migrate = commandAt(producers.current.entry, currentArgs(CURRENT_MIGRATE, root), root, environment); requireSuccess(migrate, 'product_mismatch', 'S2 migrate');
  requireCondition(!fs.existsSync(path.join(root, '.planning')) && fs.existsSync(path.join(root, '.work')), 'product_mismatch', 'S2 did not move to sole .work root');
  const receipt = readJson(path.join(root, '.work', 'migration-receipt.json'), 'product_mismatch');
  for (const [key, expected] of Object.entries({ signature: 'S2-config-v1', source: '.planning', destination: '.work', detected_init_version: 'v1.1', pre_migration_entry_count: pre.length, pre_migration_tree_sha256: preDigest, method: 'same-parent-rename' })) requireCondition(receipt[key] === expected, 'product_mismatch', `S2 migration receipt mismatch for ${key}`, receipt);
  requireCondition(/^\d{4}-\d\d-\d\dT/.test(receipt.migrated_at || ''), 'product_mismatch', 'S2 migration receipt lacks timestamp shape', receipt);
  const s2FinalPolicy = assertS2FinalPolicy(root, pre, historicalManifest, 'S2-config-v1-migrate');
  const migratedConsumer = consumer.map((entry) => ({ ...entry, path: entry.path.replace(/^\.planning\//, '.work/') }));
  assertConsumerExact(root, migratedConsumer, 'S2-config-v1-migrate');
  return { fixture: 'S2-config-v1-migrate', historicalRawPlanning: { entries: history.planningRawManifest, sha256: history.planningRawDigest }, fixtureAuthoredEntries: migratedConsumer, preMigration: { entries: pre.length, sha256: preDigest }, s2FinalPolicy, command: commandReceipt(migrate), receipt, followups: parseFollowups(producers.current, root, environment, 'S2-config-v1-migrate') };
}
function makeUnsupportedLegacy(root, reason) {
  const legacy = path.join(root, '.planning'); fs.mkdirSync(legacy, { recursive: true });
  if (reason === 'missing_config') return;
  if (reason === 'malformed_config') return writeFile(path.join(legacy, 'config.json'), '{not json');
  writeFile(path.join(legacy, 'config.json'), JSON.stringify({ initVersion: reason === 'unsupported_init_version' ? 'v9.9' : 'v1.1' }));
  if (reason === 'nonempty_legacy_decisions') writeFile(path.join(legacy, 'decisions', 'consumer.md'), 'consumer decision\n');
  if (reason === 'migration_receipt_exists') writeFile(path.join(legacy, 'migration-receipt.json'), '{}\n');
  if (reason === 'linked_legacy_entry') {
    writeFile(path.join(root, 'link-target.txt'), 'target\n');
    try { fs.symlinkSync(path.join(root, 'link-target.txt'), path.join(legacy, 'linked.txt')); } catch (error) { fail('fixture_failure', 'could not construct supported link refusal fixture', { code: error.code, message: error.message }); }
  }
}
function fixtureS2Unsupported(producers, proofRoot, environment, reason) {
  const id = `S2-unsupported-${reason}`; const root = path.join(proofRoot, 'fixtures', id); gitFixture(root, environment); makeUnsupportedLegacy(root, reason);
  const before = snapshotRoot(root); const result = commandAt(producers.current.entry, currentArgs(CURRENT_MIGRATE, root), root, environment);
  const receipt = assertRefusal(result, before, root, MIGRATION_GUIDANCE(producers.current.packageName), id);
  const output = `${result.stdout.text}\n${result.stderr.text}`;
  requireCondition(output.includes(`(${reason})`), 'product_mismatch', `${id} did not expose its exact legacy_unsupported reason`, { reason, output });
  return { fixture: id, reason, ...receipt };
}
function fixtureS3(producers, history, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S3-dual-conflict'); gitFixture(root, environment); copyHistoricalPlanning(history, root);
  writeFile(path.join(root, '.work', 'config.json'), JSON.stringify({ initVersion: 'v1.1', commitDocs: true, researchDepth: 'balanced', modelProfile: 'balanced' }));
  writeFile(path.join(root, '.work', 'consumer-owned.md'), 'independent current state\n');
  const before = snapshotRoot(root);
  const migrate = commandAt(producers.current.entry, currentArgs(CURRENT_MIGRATE, root), root, environment);
  const first = assertRefusal(migrate, before, root, SPLIT_ROOT_GUIDANCE, 'S3-dual-conflict init');
  const update = commandAt(producers.current.entry, currentArgs(CURRENT_UPDATE, root), root, environment);
  const second = assertRefusal(update, before, root, SPLIT_ROOT_GUIDANCE, 'S3-dual-conflict update');
  return { fixture: 'S3-dual-conflict', init: first, update: second };
}
function fixtureS4Bootstrap(producers, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S4-current-bootstrap'); gitFixture(root, environment);
  writeFile(path.join(root, '.work', 'config.json'), JSON.stringify({ initVersion: 'v1.1', commitDocs: true, researchDepth: 'balanced', modelProfile: 'balanced' }));
  writeFile(path.join(root, '.work', 'ROADMAP.md'), '# Consumer owned roadmap\n'); writeFile(path.join(root, '.work', 'phases', 'consumer.md'), 'consumer phase\n');
  const consumer = ['.work/config.json', '.work/ROADMAP.md', '.work/phases/consumer.md'].map((relativePath) => consumerEntry(root, relativePath));
  const init = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(init, 'product_mismatch', 'S4 current bootstrap');
  assertConsumerExact(root, consumer, 'S4-current-bootstrap');
  return { fixture: 'S4-current-bootstrap', commands: [commandReceipt(init)], followups: parseFollowups(producers.current, root, environment, 'S4-current-bootstrap') };
}
function fixtureS4MissingOwnership(producers, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S4-missing-ownership'); gitFixture(root, environment);
  writeFile(path.join(root, '.work', 'config.json'), JSON.stringify({ initVersion: 'v1.1', commitDocs: true }));
  writeFile(path.join(root, '.work', 'templates', 'delegates', 'mapper-tech.md'), 'unowned pre-existing generated-looking content\n');
  const before = snapshotRoot(root); const result = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment);
  return { fixture: 'S4-missing-ownership', ...assertRefusal(result, before, root, MISSING_OWNERSHIP_GUIDANCE, 'S4-missing-ownership') };
}
function sourceOwnedTarget(root) {
  const manifest = readJson(path.join(root, '.work', 'generation-manifest.json'), 'fixture_failure');
  const candidates = Object.entries(manifest.templates.delegates || {});
  requireCondition(candidates.length > 0, 'fixture_failure', 'fresh current init did not record a managed delegate');
  const [name] = candidates.sort(([left], [right]) => left.localeCompare(right, 'en'))[0];
  return `templates/delegates/${name}`;
}
function removeOwnership(root, targetPath) {
  const manifestPath = path.join(root, '.work', 'generation-manifest.json'); const manifest = readJson(manifestPath, 'fixture_failure');
  const parts = targetPath.split('/'); const group = parts[1] === 'delegates' ? 'delegates' : fail('fixture_failure', `unexpected fixture target: ${targetPath}`);
  delete manifest.templates[group][parts[2]]; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
function fixtureS5Customized(producers, history, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S5-customized'); gitFixture(root, environment);
  const initial = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(initial, 'product_mismatch', 'S5 initial init');
  const configPath = path.join(root, '.work', 'config.json'); const config = readJson(configPath, 'fixture_failure'); config.commitDocs = false; fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const trackingInit = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(trackingInit, 'product_mismatch', 'S5 commitDocs false tracking init');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); requireCondition(ignore.split(/\r?\n/).filter((line) => line === '.work/').length === 1, 'product_mismatch', 'S5 commitDocs false did not establish exactly one ignored .work entry');
  const stalePath = path.join(root, ...history.staleSkill.path.split('/'));
  requireCondition(fs.existsSync(stalePath), 'fixture_failure', 'S5 current generated local skill is missing before historical replacement');
  const currentSkillBytes = fs.readFileSync(stalePath); const currentSkillHash = sha256(currentSkillBytes);
  const targetPath = sourceOwnedTarget(root); const target = path.join(root, '.work', ...targetPath.split('/')); const modified = Buffer.from('S5 consumer modified managed bytes\n'); fs.writeFileSync(target, modified);
  const unknownPath = path.join(root, '.work', 'templates', 'team-owned.md'); writeFile(unknownPath, '# Team-owned unknown template\n'); const unknown = consumerEntry(root, '.work/templates/team-owned.md');
  fs.writeFileSync(stalePath, history.staleSkill.bytes); const staleBefore = sha256(history.staleSkill.bytes);
  const injectedSnapshot = snapshotReceipt(snapshotRoot(root));
  const refresh = commandAt(producers.current.entry, currentArgs(CURRENT_UPDATE_TEMPLATES, root), root, environment); requireSuccess(refresh, 'product_mismatch', 'S5 templates update');
  assertConsumerExact(root, [unknown], 'S5-customized');
  const manifest = readJson(path.join(root, '.work', 'generation-manifest.json'), 'product_mismatch');
  requireCondition(!Object.hasOwn(manifest.templates.root, 'team-owned.md'), 'product_mismatch', 'S5 unknown template became manifest-owned');
  const recovered = path.join(root, '.work', '.local', 'template-recovery'); const receipts = fs.readdirSync(recovered).filter((name) => name.endsWith('.json')).sort();
  requireCondition(receipts.length >= 1, 'product_mismatch', 'S5 lacks recovery receipt before managed replacement');
  const recoveryReceipt = readJson(path.join(recovered, receipts[0]), 'product_mismatch');
  const expectedNewHash = sha256(fs.readFileSync(target));
  requireCondition(recoveryReceipt.targetPath === targetPath && recoveryReceipt.action === 'replace' && recoveryReceipt.oldHash === sha256(modified) && recoveryReceipt.newHash === expectedNewHash && typeof recoveryReceipt.recoveryPath === 'string', 'product_mismatch', 'S5 recovery receipt is not exact', recoveryReceipt);
  const recoveryRelative = normalized(path.normalize(recoveryReceipt.recoveryPath));
  requireCondition(recoveryRelative.startsWith('.work/.local/template-recovery/') && !recoveryRelative.includes('..'), 'product_mismatch', 'S5 recovery path escaped the managed recovery root', recoveryReceipt);
  const recoveryAbsolute = path.resolve(root, ...recoveryRelative.split('/'));
  requireCondition(isInside(path.join(root, '.work', '.local', 'template-recovery'), recoveryAbsolute), 'product_mismatch', 'S5 recovery path resolved outside recovery root', { recoveryRelative, recoveryAbsolute });
  const recoveryBytes = fs.readFileSync(recoveryAbsolute);
  requireCondition(recoveryBytes.equals(modified), 'product_mismatch', 'S5 recovery bytes do not equal consumer modification');
  const sourceHash = manifest.templates.delegates[path.basename(targetPath)]; requireCondition(expectedNewHash === sourceHash, 'product_mismatch', 'S5 managed target did not become current source bytes');
  const observedSkillBytes = fs.readFileSync(stalePath); const observedSkillHash = sha256(observedSkillBytes);
  requireCondition(observedSkillBytes.equals(currentSkillBytes) && observedSkillHash === currentSkillHash, 'product_mismatch', 'S5 historical local skill did not refresh to the exact current generated bytes', { expectedCurrentHash: currentSkillHash, observedAfterHash: observedSkillHash, historicalHash: staleBefore });
  const afterRefresh = idempotenceSnapshot(root); const secondInit = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(secondInit, 'product_mismatch', 'S5 idempotent init');
  const secondRefresh = commandAt(producers.current.entry, currentArgs(CURRENT_UPDATE_TEMPLATES, root), root, environment); requireSuccess(secondRefresh, 'product_mismatch', 'S5 idempotent template update');
  requireCondition(sameJson(afterRefresh, idempotenceSnapshot(root)), 'product_mismatch', 'S5 retry changed a converged fixture beyond volatile manifest timestamp');
  return { fixture: 'S5-customized', commands: [commandReceipt(initial), commandReceipt(trackingInit), commandReceipt(refresh), commandReceipt(secondInit), commandReceipt(secondRefresh)], injectedSnapshot, firstRepairCommand: commandReceipt(refresh), targetPath, historicalSkill: { path: history.staleSkill.path, historicalSha256: staleBefore, expectedCurrentSha256: currentSkillHash, observedAfterSha256: observedSkillHash }, recoveryReceipt, followups: parseFollowups(producers.current, root, environment, 'S5-customized') };
}
function fixtureS5CommitDocs(producers, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S5-commitdocs-true-ambiguous'); gitFixture(root, environment);
  const initial = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(initial, 'product_mismatch', 'S5 commitDocs fixture initial init');
  fs.appendFileSync(path.join(root, '.gitignore'), '.work/\n'); const before = snapshotRoot(root); const result = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment);
  return { fixture: 'S5-commitdocs-true-ambiguous', initial: commandReceipt(initial), ...assertRefusal(result, before, root, COMMIT_DOCS_GUIDANCE, 'S5-commitdocs-true-ambiguous') };
}
function fixtureS5Collision(producers, proofRoot, environment) {
  const root = path.join(proofRoot, 'fixtures', 'S5-unknown-collision'); gitFixture(root, environment);
  const initial = commandAt(producers.current.entry, currentArgs(CURRENT_INIT, root), root, environment); requireSuccess(initial, 'product_mismatch', 'S5 collision fixture initial init');
  const targetPath = sourceOwnedTarget(root); removeOwnership(root, targetPath); const before = snapshotRoot(root); const result = commandAt(producers.current.entry, currentArgs(CURRENT_UPDATE_TEMPLATES, root), root, environment);
  return { fixture: 'S5-unknown-collision', initial: commandReceipt(initial), targetPath, ...assertRefusal(result, before, root, COLLISION_GUIDANCE, 'S5-unknown-collision') };
}
function runHarness(developmentMode) {
  const catalog = validateCatalog(); const candidate = candidateState(developmentMode); const protectedBefore = protectedManifest(); const hostRiskBefore = hostRiskReceipt(); const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase05-known-signatures-'));
  let cleanup = null;
  try {
    const environment = isolatedEnvironment(proofRoot); assertContained(proofRoot, environment.roots);
    const producers = buildProducers(proofRoot, environment); const history = historicalFixture(producers, proofRoot, environment);
    const results = [fixtureS1(producers, proofRoot, environment), fixtureS2(producers, history, proofRoot, environment)];
    for (const reason of ['missing_config', 'malformed_config', 'unsupported_init_version', 'nonempty_legacy_decisions', 'migration_receipt_exists', 'linked_legacy_entry']) results.push(fixtureS2Unsupported(producers, proofRoot, environment, reason));
    results.push(fixtureS3(producers, history, proofRoot, environment), fixtureS4Bootstrap(producers, proofRoot, environment), fixtureS4MissingOwnership(producers, proofRoot, environment), fixtureS5Customized(producers, history, proofRoot, environment), fixtureS5CommitDocs(producers, proofRoot, environment), fixtureS5Collision(producers, proofRoot, environment));
    requireCondition(results.length === CASES.length, 'harness_failure', 'executed fixture count differs from catalog');
    requireCondition(sameJson(protectedBefore, protectedManifest()), 'containment_failure', 'protected inputs changed during proof');
    const hostRiskAfter = assertHostRiskExact(hostRiskBefore);
    cleanup = safeRemove(proofRoot);
    return { phase: '05-03', acceptance: false, classification: 'non_acceptance_development_harness_pass', candidate, runtime: runtimeReceipt(), sanitizedEnvironment: environment.receipt, containment: { before: hostRiskBefore, after: hostRiskAfter, processPortClaimLimit: 'bounded synchronous Windows observations only; no universal process, port, or external containment claim' }, catalog, producers: { current: { candidate: producers.current.candidate, ...producerReceipt(producers.current) }, historical: { commit: producers.historical.commit, tree: producers.historical.tree, ...producerReceipt(producers.historical), init: history.invoke, rawOutputManifest: { entries: history.rawManifest, sha256: history.rawDigest }, rawPlanningManifest: { entries: history.planningRawManifest, sha256: history.planningRawDigest } } }, results, cleanup };
  } catch (error) {
    const receipt = error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack });
    let cleanupFailure = null; try { cleanup = safeRemove(proofRoot); } catch (cleanupError) { cleanupFailure = { message: cleanupError.message }; }
    fail(receipt.classification, receipt.message, { cause: receipt.cause, cleanup, cleanupFailure });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--catalog') return catalogMode();
  if (args.length === 2 && args[0] === DEVELOPMENT_ARGUMENT && args[1] === SELF_PATH) {
    process.stdout.write(`${JSON.stringify(runHarness(true), null, 2)}\n`);
    return;
  }
  if (args.length === 0) {
    const receipt = runHarness(false);
    receipt.acceptance = true;
    receipt.classification = 'acceptance_pass';
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  fail('usage', `expected --catalog, ${DEVELOPMENT_ARGUMENT} ${SELF_PATH}, or no arguments after the required proof commit`);
}

try { main(); } catch (error) {
  const failure = error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack });
  process.stderr.write(`${JSON.stringify({ phase: '05-03', acceptance: false, classification: failure.classification, error: failure.message, cause: failure.cause }, null, 2)}\n`);
  process.exitCode = 1;
}
