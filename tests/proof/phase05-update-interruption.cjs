#!/usr/bin/env node
'use strict';

// Explicit Phase 05 proof, deliberately outside ordinary test discovery. It
// repacks one immutable candidate and injects only the three named fs faults.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPOSITORY_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const SELF_PATH = 'tests/proof/phase05-update-interruption.cjs';
const DEVELOPMENT_ARGUMENT = '--development-harness';
const FIXED_CANDIDATE = '9457b9ff3f2504a8b4efcb9f0dde9f884836c14d';
const PACKAGE_VERSION = '0.32.0';
const PACKAGE_BIN = 'bin/gsdd.mjs';
const TARBALL_SHA256 = '86cd25cd7bf6d44a6e60d3a7063afe31a76c2ba15d0f50709b63a2143f8301b0';
const PACKAGE_JSON_SHA256 = 'ec2a562ae51b7e14087c1d14c9eb6d48472e1ac4da9033b410418695a9788058';
const README_SHA256 = 'c96ff2362341b0ee7599ec4db72b0bbe31a654934afe136f20927b0dfe37cc60';
const ENTRY_SHA256 = '2bb044333f94cccbce99439c106684329ff3be6d5d62880f206e63e4290d3728';
const PACKAGE_MEMBERS = 113;
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const COMMAND_BUDGET_MS = 120000;
const OUTPUT_LIMIT_BYTES = 12288;
const TARGET_RELATIVE = '.work/templates/delegates/plan-checker.md';
const PROTECTED_INPUTS = Object.freeze([
  ['.work.zip', 356000, '36158acba6dda63a17dde4e5bc288fbd17e6297d3964f6729dc33baa72fb5f2b'],
  ['deep-research-report-decision-driven-second.md', 38875, '3e12c48f66065136830551acc80fb02afce59d7ff50f0b6c37627102f2dbd4d2'],
  ['deep-research-report-decision-driven.md', 36427, 'c6c1a6b58d0c90c933f4ac35d79feda7fc5a95805bfddca2a3f04da9bab904f8'],
  ['workspine.zip', 6691999, '83184a0ed5a6f46e6586a454ab06e5e2ac2bad3078fccc58f933ebcbf6d65127'],
]);
const CASES = Object.freeze(['control-s5-recovery', 'fault-render-read', 'fault-target-rename', 'fault-manifest-rename']);
const FAULT_KINDS = Object.freeze(['render-read', 'target-rename', 'manifest-rename']);

class ProofFailure extends Error {
  constructor(classification, message, cause = null) { super(message); this.classification = classification; this.cause = cause; }
}
function fail(classification, message, cause = null) { throw new ProofFailure(classification, message, cause); }
function need(value, classification, message, cause = null) { if (!value) fail(classification, message, cause); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function canonicalOwnership(value) {
  if (Array.isArray(value)) return value.map(canonicalOwnership);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort((left, right) => left.localeCompare(right)).map((key) => [key, canonicalOwnership(value[key])]));
  return value;
}
function sameOwnership(left, right) { return same(canonicalOwnership(left), canonicalOwnership(right)); }
function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function outputReceipt(value) {
  const bytes = Buffer.from(value || ''); const truncated = bytes.length > OUTPUT_LIMIT_BYTES;
  const visible = truncated ? Buffer.concat([bytes.subarray(0, OUTPUT_LIMIT_BYTES / 2), Buffer.from('\n...[truncated by proof runner]...\n'), bytes.subarray(bytes.length - OUTPUT_LIMIT_BYTES / 2)]) : bytes;
  return { bytes: bytes.length, sha256: sha256(bytes), truncated, text: visible.toString('utf8') };
}
function run(file, args, options = {}) {
  const started = Date.now();
  const result = childProcess.spawnSync(file, args, { cwd: options.cwd, env: options.env, encoding: 'buffer', windowsHide: true, timeout: COMMAND_BUDGET_MS, maxBuffer: 16 * 1024 * 1024 });
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
  const receipt = { command: file, args, cwd: options.cwd || process.cwd(), exitCode: result.status === null ? -1 : result.status, signal: result.signal || null, timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'), elapsedMs: Date.now() - started, stdout: outputReceipt(result.stdout), stderr: outputReceipt(result.stderr) };
  Object.defineProperties(receipt, { _stdout: { value: Buffer.from(result.stdout || ''), enumerable: false }, _stderr: { value: Buffer.from(result.stderr || ''), enumerable: false } });
  return receipt;
}
function visible(receipt) { const { _stdout, _stderr, ...value } = receipt; return value; }
function raw(receipt, stream) { return receipt[`_${stream}`].toString('utf8'); }
function success(receipt, classification, description) { need(receipt.exitCode === 0 && !receipt.timedOut, classification, `${description} failed with exit ${receipt.exitCode}`, visible(receipt)); return receipt; }
function git(args, options = {}) { return success(run('git', args, { cwd: options.cwd || REPOSITORY_ROOT, env: options.env }), 'setup_failure', `git ${args.join(' ')}`); }
function write(filePath, bytes, flag = 'wx') { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, bytes, { flag }); }
function readJson(filePath, classification = 'harness_failure') { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) { fail(classification, `invalid JSON ${filePath}`, { message: error.message }); } }
function entry(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return { type: 'link', path: filePath, target: fs.readlinkSync(filePath) };
    if (stat.isDirectory()) return { type: 'directory', path: filePath, mode: stat.mode & 0o777 };
    if (stat.isFile()) { const bytes = fs.readFileSync(filePath); return { type: 'file', path: filePath, mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) }; }
    return { type: 'other', path: filePath, mode: stat.mode & 0o777 };
  } catch (error) { if (error.code === 'ENOENT') return { type: 'missing', path: filePath }; throw error; }
}
function snapshot(root) {
  const output = [];
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort((a, b) => a.localeCompare(b, 'en'))) {
      const absolute = path.join(directory, name); const relative = prefix ? `${prefix}/${name}` : name; const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) output.push({ path: relative, type: 'link', target: fs.readlinkSync(absolute) });
      else if (stat.isDirectory()) { output.push({ path: `${relative}/`, type: 'directory', mode: stat.mode & 0o777 }); visit(absolute, relative); }
      else if (stat.isFile()) { const bytes = fs.readFileSync(absolute); output.push({ path: relative, type: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) }); }
      else output.push({ path: relative, type: 'other', mode: stat.mode & 0o777 });
    }
  }
  if (fs.existsSync(root)) visit(root);
  return output;
}
function snapshotRoot(root) {
  const observed = entry(root);
  return { root: observed, entries: observed.type === 'directory' ? snapshot(root) : [] };
}
function normalizedSnapshot(root) {
  return snapshot(root).map((value) => {
    if (value.type !== 'file' || value.path !== '.work/generation-manifest.json') return value;
    const manifest = readJson(path.join(root, value.path), 'product_mismatch'); delete manifest.generatedAt;
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2)); return { ...value, bytes: bytes.length, sha256: sha256(bytes), normalizedGeneratedAt: true };
  });
}
function digest(value) { return sha256(Buffer.from(value.map((item) => JSON.stringify(item)).join('\n'))); }
function snapshotDelta(before, after) {
  const left = new Map(before.map((value) => [value.path, value])); const right = new Map(after.map((value) => [value.path, value]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().filter((key) => !same(left.get(key) || null, right.get(key) || null)).map((key) => ({ path: key, before: left.get(key) || null, after: right.get(key) || null }));
}
function assertExactDelta(before, after, expected, description) {
  const delta = snapshotDelta(before, after);
  need(same(delta, expected), 'product_mismatch', `${description} had an undeclared filesystem delta`, { expected, actual: delta });
  return delta;
}
function protectedManifest() {
  return PROTECTED_INPUTS.map(([relative, length, expected]) => { const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relative)); need(bytes.length === length && sha256(bytes) === expected, 'provenance_failure', `protected input drifted: ${relative}`); return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }; });
}
function statusReceipt(development) {
  const head = raw(git(['rev-parse', 'HEAD']), 'stdout').trim();
  need(raw(git(['status', '--porcelain=v1', '--untracked-files=no', '--', '.']), 'stdout') === '', 'provenance_failure', 'tracked/index drift prevents proof');
  const untracked = raw(git(['ls-files', '--others', '--exclude-standard']), 'stdout').split(/\r?\n/).filter(Boolean).sort();
  const allowed = PROTECTED_INPUTS.map(([filePath]) => filePath).concat(development ? [SELF_PATH] : []).sort();
  need(same(untracked, allowed), 'provenance_failure', 'untracked set is not the protected/development allowlist', { untracked, allowed });
  if (development) need(head === FIXED_CANDIDATE, 'provenance_failure', `development requires ${FIXED_CANDIDATE}, got ${head}`);
  else { const parents = raw(git(['rev-list', '--parents', '-n', '1', head]), 'stdout').trim().split(/\s+/); const delta = raw(git(['diff', '--name-only', `${FIXED_CANDIDATE}..${head}`]), 'stdout').split(/\r?\n/).filter(Boolean).sort(); need(parents.length === 2 && parents[1] === FIXED_CANDIDATE && same(delta, [SELF_PATH]), 'provenance_failure', 'acceptance requires one runner-only child of fixed candidate', { head, parents, delta }); }
  return { candidate: FIXED_CANDIDATE, proofRunnerHead: head, untracked, protectedInputs: protectedManifest() };
}
function catalog() {
  const before = protectedManifest();
  need(CASES.length === 4 && FAULT_KINDS.length === 3, 'catalog_failure', 'closed matrix is incomplete');
  need(same(before, protectedManifest()), 'catalog_failure', 'catalog altered protected input');
  process.stdout.write(`${JSON.stringify({ phase: '05-05', acceptance: false, classification: 'catalog_only', noProductOrNpmCommand: true, candidate: FIXED_CANDIDATE, package: { identity: `gsdd-cli@${PACKAGE_VERSION}`, tarballSha256: TARBALL_SHA256, packageJsonSha256: PACKAGE_JSON_SHA256, readmeSha256: README_SHA256, entrySha256: ENTRY_SHA256, members: PACKAGE_MEMBERS }, cases: CASES, faultKinds: FAULT_KINDS, claimLimits: ['no-signal-handling', 'no-abrupt-process-termination', 'no-power-loss-safety', 'no-multi-file-transactionality', 'no-concurrency-safety'] }, null, 2)}\n`);
}
function environment(root) {
  const home = path.join(root, 'home'); const temporary = path.join(root, 'temp'); const cache = path.join(root, 'npm-cache'); const prefix = path.join(root, 'npm-prefix'); const userconfig = path.join(root, 'npmrc'); const globalconfig = path.join(root, 'npm-globalrc'); const gitconfig = path.join(root, 'gitconfig');
  for (const directory of [home, temporary, cache, prefix]) fs.mkdirSync(directory, { recursive: true }); write(userconfig, '# isolated phase05 proof\n'); write(globalconfig, '# isolated phase05 proof\n'); write(gitconfig, '[credential]\n\thelper = \n');
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const env = { SystemRoot: systemRoot, WINDIR: systemRoot, ComSpec: process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe'), Path: process.env.Path || process.env.PATH || '', HOME: home, USERPROFILE: home, HOMEDRIVE: path.parse(home).root, HOMEPATH: path.relative(path.parse(home).root, home), APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: temporary, TMP: temporary, npm_config_cache: cache, npm_config_prefix: prefix, npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig, npm_config_registry: 'http://127.0.0.1:9/', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: '0', NO_PROXY: '*', no_proxy: '*', CI: '1' };
  return { env, roots: { home, temporary, cache, prefix, userconfig, globalconfig, gitconfig }, receipt: { roots: { home, temporary, cache, prefix, userconfig, globalconfig, gitconfig }, removedLoaderVariables: ['NODE_OPTIONS', 'NODE_PATH'], npmRegistry: env.npm_config_registry, scriptsDisabled: true } };
}
function archiveAndInstall(root, isolated) {
  const source = path.join(root, 'source'); fs.mkdirSync(source, { recursive: true }); const archive = path.join(root, 'candidate.tar');
  success(run('git', ['archive', '--format=tar', '--output', archive, FIXED_CANDIDATE], { cwd: REPOSITORY_ROOT, env: isolated.env }), 'provenance_failure', 'git archive fixed candidate'); success(run('tar', ['-xf', archive, '-C', source], { cwd: root, env: isolated.env }), 'provenance_failure', 'extract fixed candidate'); fs.unlinkSync(archive);
  const pack = success(run(process.execPath, [NPM_CLI, 'pack', '--ignore-scripts', '--json'], { cwd: source, env: isolated.env }), 'provenance_failure', 'npm pack'); let packet; try { packet = JSON.parse(raw(pack, 'stdout')); } catch (error) { fail('provenance_failure', 'npm pack did not emit JSON', { message: error.message, pack: visible(pack) }); }
  need(Array.isArray(packet) && packet.length === 1 && packet[0].files?.length === PACKAGE_MEMBERS, 'provenance_failure', 'packed member list drifted', packet); const tarball = path.join(source, packet[0].filename); need(sha256(fs.readFileSync(tarball)) === TARBALL_SHA256, 'provenance_failure', 'tarball hash drifted');
  const install = path.join(root, 'install'); fs.mkdirSync(install, { recursive: true }); write(path.join(install, 'package.json'), '{"private":true,"name":"phase05-update-interruption"}\n'); const installed = success(run(process.execPath, [NPM_CLI, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: install, env: isolated.env }), 'provenance_failure', 'local tarball install');
  const packageRoot = path.join(install, 'node_modules', 'gsdd-cli'); const entryPath = fs.realpathSync(path.join(packageRoot, PACKAGE_BIN)); need(inside(install, entryPath), 'containment_failure', 'installed entry escaped local install');
  const packageJson = fs.readFileSync(path.join(packageRoot, 'package.json')); const packageMeta = readJson(path.join(packageRoot, 'package.json'), 'provenance_failure'); const readme = fs.readFileSync(path.join(packageRoot, 'README.md')); const entryBytes = fs.readFileSync(entryPath); const workflowPath = path.join(packageRoot, 'bin', 'lib', 'workflows.mjs'); const workflowBytes = fs.readFileSync(workflowPath, 'utf8'); const frameworkMatch = workflowBytes.match(/^export const FRAMEWORK_VERSION = '([^']+)';$/m); need(sha256(packageJson) === PACKAGE_JSON_SHA256 && sha256(readme) === README_SHA256 && sha256(entryBytes) === ENTRY_SHA256, 'provenance_failure', 'installed artifact bytes drifted'); need(packageMeta.name === 'gsdd-cli' && packageMeta.version === PACKAGE_VERSION && packageMeta.bin?.gsdd === PACKAGE_BIN && frameworkMatch, 'provenance_failure', 'installed package metadata/framework declaration drifted', { name: packageMeta.name, version: packageMeta.version, bin: packageMeta.bin, workflowPath });
  return { source, packageRoot, installRoot: install, entry: entryPath, frameworkVersion: frameworkMatch[1], tarball: { path: tarball, sha256: sha256(fs.readFileSync(tarball)), members: packet[0].files.length }, pack: visible(pack), install: visible(installed), packageJsonSha256: sha256(packageJson), readmeSha256: sha256(readme), entrySha256: sha256(entryBytes), packageMeta: { name: packageMeta.name, version: packageMeta.version, bin: packageMeta.bin }, workflow: { path: workflowPath, sha256: sha256(Buffer.from(workflowBytes)), frameworkVersion: frameworkMatch[1] } };
}
function assertManifestMatchesExpected(root, manifest, expected, label) {
  need(manifest.frameworkVersion === expected.frameworkVersion && sameOwnership(manifest.templates, expected.templates) && sameOwnership(manifest.roles, expected.roles) && sameOwnership(manifest.runtimeHelpers, expected.runtimeHelpers), 'product_mismatch', `${label} manifest does not equal independently derived installed ownership`, { expected: { frameworkVersion: expected.frameworkVersion, templates: expected.templates, roles: expected.roles, runtimeHelpers: expected.runtimeHelpers }, actual: { frameworkVersion: manifest.frameworkVersion, templates: manifest.templates, roles: manifest.roles, runtimeHelpers: manifest.runtimeHelpers } });
  assertRecordedOwnership(root, manifest);
}
function initFixture(root, installed, isolated, external) {
  fs.mkdirSync(root, { recursive: true }); success(run('git', ['init', '--quiet'], { cwd: root, env: isolated.env }), 'fixture_failure', 'fixture git init'); need(raw(git(['remote'], { cwd: root, env: isolated.env }), 'stdout').trim() === '', 'fixture_failure', 'fixture acquired remote'); const initial = invoke(installed, root, ['init', '--auto', '--tools', 'agents'], isolated, { paths: external.isolatedRootPaths, roots: external.isolatedRoots }); success(initial, 'product_mismatch', 'fixture init');
  const target = path.join(root, ...TARGET_RELATIVE.split('/')); const manifest = path.join(root, '.work', 'generation-manifest.json'); need(entry(target).type === 'file' && entry(manifest).type === 'file' && !fs.existsSync(path.join(root, '.planning')), 'product_mismatch', 'fixture did not form expected current workspace'); assertManifestMatchesExpected(root, readJson(manifest, 'product_mismatch'), external.expectedOwnership, 'initial'); write(path.join(root, 'team-sentinel.txt'), 'team-owned sentinel\n');
  return { target, manifest, initial: visible(initial), sentinel: entry(path.join(root, 'team-sentinel.txt')) };
}
function preload(root, config) {
  const configPath = path.join(root, `fault-${config.kind}.json`); const preloadPath = path.join(root, `fault-${config.kind}.cjs`); write(configPath, `${JSON.stringify(config)}\n`);
  const body = "'use strict';\nconst fs=require('node:fs');\nconst {syncBuiltinESMExports}=require('node:module');\nconst path=require('node:path');\nconst config=JSON.parse(fs.readFileSync(process.env.PHASE05_FAULT_CONFIG,'utf8'));\nlet hits=0;\nfunction trip(kind,target){hits+=1; if(hits!==1){process.stderr.write('PHASE05_FAULT_REPEAT '+kind+' '+target+'\\n'); throw new Error('PHASE05 fault matched more than once');} process.stderr.write('PHASE05_FAULT '+kind+' '+target+'\\n'); const error=new Error('bounded injected '+kind); error.code='EIO'; throw error;}\nif(config.kind==='render-read'){const original=fs.readFileSync; fs.readFileSync=function(file,...rest){if(path.resolve(String(file))===config.target) trip(config.kind,config.target); return original.call(this,file,...rest);};}\nelse {const original=fs.renameSync; fs.renameSync=function(source,destination){const from=path.resolve(String(source)); const to=path.resolve(String(destination)); const name=path.basename(from); if(to===config.target && path.dirname(from)===path.dirname(to) && new RegExp('^\\\\.'+config.basename.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')+'\\\\.\\\\d+\\\\.[0-9a-f-]+\\\\.tmp$','i').test(name)) trip(config.kind,config.target); return original.call(this,source,destination);};}\nsyncBuiltinESMExports();\n";
  write(preloadPath, body); return { configPath, preloadPath, configSha256: sha256(fs.readFileSync(configPath)), preloadSha256: sha256(fs.readFileSync(preloadPath)) };
}
function faultRoot(fixtureRoot) {
  // The preload/config are runner inputs, not fixture state. Keep them as a
  // proof-root sibling so a fixture snapshot cannot mistake runner setup for a
  // product write.
  return path.join(path.dirname(path.dirname(fixtureRoot)), 'faults', path.basename(fixtureRoot));
}
function assertImmediateInvariant(invariant) {
  for (const [name, expected] of Object.entries(invariant.roots)) need(same(expected, snapshotRoot(invariant.paths[name])), 'containment_failure', `immutable proof input changed after product child: ${name}`, { name, before: expected, after: snapshotRoot(invariant.paths[name]) });
}
function invoke(installed, cwd, args, isolated, invariant, fault = null) {
  const env = { ...isolated.env }; const argv = [];
  if (fault) { env.PHASE05_FAULT_CONFIG = fault.configPath; argv.push('--require', fault.preloadPath); }
  argv.push(installed.entry, ...args);
  for (const key of ['NODE_OPTIONS', 'NODE_PATH']) need(env[key] === undefined, 'harness_failure', `child environment retained ${key}`);
  if (fault) {
    need(same(argv.slice(0, 3), ['--require', fault.preloadPath, installed.entry]) && env.PHASE05_FAULT_CONFIG === fault.configPath, 'harness_failure', 'instrumented child lost exact preload/entry binding', { argv, expectedPreload: fault.preloadPath, entry: installed.entry, faultConfig: env.PHASE05_FAULT_CONFIG });
  } else {
    need(argv[0] === installed.entry && !argv.includes('--require') && !argv.includes('--import') && !argv.includes('--loader') && env.PHASE05_FAULT_CONFIG === undefined, 'harness_failure', 'clean child was not loader-free installed-entry invocation', { argv, inheritedFaultConfig: env.PHASE05_FAULT_CONFIG || null });
  }
  const receipt = run(process.execPath, argv, { cwd, env }); assertImmediateInvariant(invariant);
  receipt.execution = fault
    ? { mode: 'instrumented', entry: installed.entry, exactPreload: fault.preloadPath, faultConfig: fault.configPath, argvPrefix: argv.slice(0, 3), loaderFreeEnvironment: ['NODE_OPTIONS', 'NODE_PATH'].every((key) => env[key] === undefined) }
    : { mode: 'clean', entry: installed.entry, argvPrefix: argv.slice(0, 1), loaderFreeEnvironment: ['NODE_OPTIONS', 'NODE_PATH', 'PHASE05_FAULT_CONFIG'].every((key) => env[key] === undefined) };
  if (fault) { const lines = raw(receipt, 'stderr').split(/\r?\n/); const matches = lines.filter((line) => line === `PHASE05_FAULT ${fault.kind} ${fault.target}`); const repeats = lines.filter((line) => line === `PHASE05_FAULT_REPEAT ${fault.kind} ${fault.target}`); need(matches.length === 1 && repeats.length === 0, 'harness_failure', 'fault did not emit exactly one exact receipt without a repeat', { expected: `PHASE05_FAULT ${fault.kind} ${fault.target}`, stderr: receipt.stderr, matches, repeats }); }
  return receipt;
}
function assertSentinel(root, expected) { need(same(entry(path.join(root, 'team-sentinel.txt')), expected), 'containment_failure', 'unknown team sentinel changed'); }
function assertNoTemps(root) { const entries = snapshot(root); need(!entries.some((value) => value.type === 'file' && /(^|\/)\.[^/]+\.\d+\.[0-9a-f-]+\.tmp$/i.test(value.path)), 'product_mismatch', 'atomic temp survived failure', entries.filter((value) => /\.tmp$/i.test(value.path))); }
function assertExternalExact(before, root, canary) {
  need(same(before.repository, snapshot(REPOSITORY_ROOT)), 'containment_failure', 'repository tree changed during proof'); need(same(canary, before.canary), 'containment_failure', 'runner external canary changed'); need(same(protectedManifest(), before.protected), 'containment_failure', 'protected input changed during proof'); need(!fs.existsSync(path.join(root, '.planning')), 'product_mismatch', 'foreign planning root appeared');
  assertImmediateInvariant({ paths: before.isolatedRootPaths, roots: before.isolatedRoots });
}
function recoveryPaths(root, target, oldBytes, newBytes) {
  const targetPath = TARGET_RELATIVE.replace(/^\.work\//, ''); const identity = sha256(Buffer.from(`${targetPath}\0${sha256(oldBytes)}\0${sha256(newBytes)}\0replace`)); const directory = path.join(root, '.work', '.local', 'template-recovery'); return { directory, bytes: path.join(directory, `${identity}.original`), receipt: path.join(directory, `${identity}.json`), identity };
}
function localizedTemplate(installed) {
  // Template ownership hashes the exact destination bytes, not raw framework
  // source bytes: this source has the state-root token localized on install.
  return fs.readFileSync(path.join(installed.packageRoot, 'distilled', 'templates', 'delegates', 'plan-checker.md'));
}
function assertRecovery(root, target, original, sourceBytes) {
  const expected = recoveryPaths(root, target, original, sourceBytes); need(entry(expected.bytes).type === 'file' && fs.readFileSync(expected.bytes).equals(original), 'product_mismatch', 'recovery original is absent or not byte exact', expected); const receipt = readJson(expected.receipt, 'product_mismatch'); need(receipt.targetPath === 'templates/delegates/plan-checker.md' && receipt.action === 'replace' && receipt.oldHash === sha256(original) && receipt.newHash === sha256(sourceBytes) && receipt.recoveryPath === `.work/.local/template-recovery/${expected.identity}.original`, 'product_mismatch', 'recovery receipt mismatch', receipt); return { ...expected, receipt: entry(expected.receipt) };
}
function assertRecoveryExpectation(root, original, sourceBytes) {
  const expected = recoveryPaths(root, null, original, sourceBytes);
  const receipt = Buffer.from(JSON.stringify({ targetPath: 'templates/delegates/plan-checker.md', action: 'replace', oldHash: sha256(original), newHash: sha256(sourceBytes), recoveryPath: `.work/.local/template-recovery/${expected.identity}.original` }, null, 2));
  const delta = [
    { path: '.work/.local/', before: null, after: { path: '.work/.local/', type: 'directory', mode: 438 } },
    { path: '.work/.local/template-recovery/', before: null, after: { path: '.work/.local/template-recovery/', type: 'directory', mode: 438 } },
    { path: `.work/.local/template-recovery/${expected.identity}.json`, before: null, after: { path: `.work/.local/template-recovery/${expected.identity}.json`, type: 'file', mode: 438, bytes: receipt.length, sha256: sha256(receipt) } },
    { path: `.work/.local/template-recovery/${expected.identity}.original`, before: null, after: { path: `.work/.local/template-recovery/${expected.identity}.original`, type: 'file', mode: 438, bytes: original.length, sha256: sha256(original) } },
  ].sort((left, right) => left.path.localeCompare(right.path));
  return { expected, delta };
}
function recordedOwnership(manifest) {
  const paths = new Map();
  for (const [group, files] of Object.entries(manifest.templates || {})) {
    const directory = group === 'root' ? 'templates' : group === 'brownfieldChange' ? 'templates/brownfield-change' : `templates/${group}`;
    for (const [name, hash] of Object.entries(files || {})) paths.set(`${directory}/${name}`, hash);
  }
  for (const [name, hash] of Object.entries(manifest.roles || {})) paths.set(`templates/roles/${name}`, hash);
  for (const [relativePath, hash] of Object.entries(manifest.runtimeHelpers || {})) paths.set(relativePath, hash);
  return paths;
}
function ownershipKeySets(manifest) {
  return { templates: Object.fromEntries(Object.entries(manifest.templates || {}).sort(([a], [b]) => a.localeCompare(b)).map(([group, files]) => [group, Object.keys(files || {}).sort()])), roles: Object.keys(manifest.roles || {}).sort(), runtimeHelpers: Object.keys(manifest.runtimeHelpers || {}).sort() };
}
function assertRecordedOwnership(root, manifest) {
  for (const [relativePath, expectedHash] of recordedOwnership(manifest)) {
    const actual = entry(path.join(root, '.work', ...relativePath.split('/')));
    need(actual.type === 'file' && actual.sha256 === expectedHash, 'product_mismatch', `manifest ownership does not match installed file ${relativePath}`, { relativePath, expectedHash, actual });
  }
}
function localizeTemplate(content, stateDirName = '.work') {
  if (stateDirName === '.work') return String(content);
  return String(content).replace(/\.work(?=\/|\\\\|`|'|"|\)|\]|\}|,|\.|:|;|\s|$)/g, stateDirName);
}
function expectedOwnershipFromInstalled(installed, isolated, invariant) {
  const templates = { delegates: {}, research: {}, codebase: {}, brownfieldChange: {}, root: {} }; const roles = {};
  const groups = [
    ['delegates', path.join(installed.packageRoot, 'distilled', 'templates', 'delegates')],
    ['research', path.join(installed.packageRoot, 'distilled', 'templates', 'research')],
    ['codebase', path.join(installed.packageRoot, 'distilled', 'templates', 'codebase')],
    ['brownfieldChange', path.join(installed.packageRoot, 'distilled', 'templates', 'brownfield-change')],
    ['root', path.join(installed.packageRoot, 'distilled', 'templates')],
  ];
  for (const [group, directory] of groups) {
    const names = fs.readdirSync(directory, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith('.md')).map((item) => item.name).sort();
    for (const name of names) templates[group][name] = sha256(Buffer.from(localizeTemplate(fs.readFileSync(path.join(directory, name), 'utf8'))));
  }
  const rolesDirectory = path.join(installed.packageRoot, 'agents');
  for (const name of fs.readdirSync(rolesDirectory, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith('.md') && item.name !== 'README.md' && !item.name.startsWith('_')).map((item) => item.name).sort()) roles[name] = sha256(Buffer.from(localizeTemplate(fs.readFileSync(path.join(rolesDirectory, name), 'utf8'))));
  const renderingPath = path.join(installed.packageRoot, 'bin', 'lib', 'rendering.mjs');
  const probeSource = `import { buildPlanningCliHelperEntries } from ${JSON.stringify(pathToFileURL(renderingPath).href)}; const entries=buildPlanningCliHelperEntries({packageName:'gsdd-cli',packageVersion:${JSON.stringify(PACKAGE_VERSION)},stateDirName:'.work'}); process.stdout.write(JSON.stringify(entries.map(({relativePath,content})=>({relativePath,content}))));`;
  const probe = success(run(process.execPath, ['--input-type=module', '--eval', probeSource], { cwd: installed.installRoot, env: isolated.env }), 'harness_failure', 'installed rendering helper probe');
  need(probe.args[0] === '--input-type=module' && !probe.args.includes('--require') && !probe.args.includes('--import') && !probe.args.includes('--loader') && isolated.env.NODE_OPTIONS === undefined && isolated.env.NODE_PATH === undefined, 'harness_failure', 'installed rendering helper probe was not loader-free');
  assertImmediateInvariant(invariant);
  let helperEntries; try { helperEntries = JSON.parse(raw(probe, 'stdout')); } catch (error) { fail('harness_failure', 'installed rendering helper probe did not emit JSON', { message: error.message, probe: visible(probe) }); }
  need(Array.isArray(helperEntries) && helperEntries.every((item) => typeof item.relativePath === 'string' && typeof item.content === 'string'), 'harness_failure', 'installed rendering helper probe emitted malformed entries');
  const runtimeHelpers = {}; for (const item of helperEntries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) { need(!Object.hasOwn(runtimeHelpers, item.relativePath), 'harness_failure', `installed rendering helper probe duplicated ${item.relativePath}`); runtimeHelpers[item.relativePath] = sha256(Buffer.from(item.content)); }
  return { frameworkVersion: installed.frameworkVersion, templates, roles, runtimeHelpers, probe: { command: visible(probe), renderingSha256: sha256(fs.readFileSync(renderingPath)), outputSha256: probe.stdout.sha256 } };
}
function semanticSnapshot(root) { return { tree: normalizedSnapshot(root), digest: digest(normalizedSnapshot(root)) }; }
function cleanUpdate(installed, root, isolated, external, description) { const receipt = invoke(installed, root, ['update', '--templates'], isolated, { paths: external.isolatedRootPaths, roots: external.isolatedRoots }); success(receipt, 'product_mismatch', description); return visible(receipt); }
function control(root, installed, isolated, external) {
  const fixture = initFixture(root, installed, isolated, external); const original = Buffer.from('consumer changed managed template\n'); fs.writeFileSync(fixture.target, original); const source = localizedTemplate(installed); const first = cleanUpdate(installed, root, isolated, external, 'clean modified-template update'); const recovery = assertRecovery(root, fixture.target, original, source); need(fs.readFileSync(fixture.target).equals(source), 'product_mismatch', 'clean control did not install source bytes'); const after = semanticSnapshot(root); const second = cleanUpdate(installed, root, isolated, external, 'clean retry update'); need(same(after, semanticSnapshot(root)), 'product_mismatch', 'clean control repeat was not stable beyond generatedAt'); assertSentinel(root, fixture.sentinel); assertNoTemps(root); assertExternalExact(external, root, external.canary); return { case: 'control-s5-recovery', initial: fixture.initial, first, second, recovery, normalizedDigest: after.digest };
}
function renderRead(root, installed, isolated, external) {
  const fixture = initFixture(root, installed, isolated, external); const before = snapshot(root); const source = path.join(installed.packageRoot, 'distilled', 'templates', 'delegates', 'plan-checker.md'); const fault = { kind: 'render-read', target: path.resolve(source), basename: path.basename(source), ...preload(faultRoot(root), { kind: 'render-read', target: path.resolve(source), basename: path.basename(source) }) }; const failed = invoke(installed, root, ['update', '--templates'], isolated, { paths: external.isolatedRootPaths, roots: external.isolatedRoots }, fault); need(failed.exitCode !== 0 && !failed.timedOut, 'product_mismatch', 'render-read fault unexpectedly succeeded', visible(failed)); const failedAfter = snapshot(root); need(same(before, failedAfter), 'product_mismatch', 'render-read failure changed fixture', { delta: snapshotDelta(before, failedAfter) }); need(!fs.existsSync(path.join(root, '.work', '.local', 'template-recovery')), 'product_mismatch', 'render-read created recovery evidence'); assertNoTemps(root); const retry = cleanUpdate(installed, root, isolated, external, 'render-read clean retry'); const after = semanticSnapshot(root); const repeat = cleanUpdate(installed, root, isolated, external, 'render-read repeat clean retry'); need(same(after, semanticSnapshot(root)), 'product_mismatch', 'render-read retry was not stable'); need(!fs.existsSync(path.join(root, '.work', '.local', 'template-recovery')), 'product_mismatch', 'render-read clean retry created recovery evidence'); assertSentinel(root, fixture.sentinel); assertExternalExact(external, root, external.canary); return { case: 'fault-render-read', fault: { kind: fault.kind, target: fault.target, preloadSha256: fault.preloadSha256, configSha256: fault.configSha256 }, failed: visible(failed), retry, repeat, normalizedDigest: after.digest };
}
function targetRename(root, installed, isolated, external) {
  const fixture = initFixture(root, installed, isolated, external); const original = Buffer.from('consumer changed managed template\n'); fs.writeFileSync(fixture.target, original); const oldManifest = fs.readFileSync(fixture.manifest); const source = localizedTemplate(installed); const before = snapshot(root); const recoveryExpectation = assertRecoveryExpectation(root, original, source); const fault = { kind: 'target-rename', target: path.resolve(fixture.target), basename: path.basename(fixture.target), ...preload(faultRoot(root), { kind: 'target-rename', target: path.resolve(fixture.target), basename: path.basename(fixture.target) }) }; const failed = invoke(installed, root, ['update', '--templates'], isolated, { paths: external.isolatedRootPaths, roots: external.isolatedRoots }, fault); need(failed.exitCode !== 0 && !failed.timedOut, 'product_mismatch', 'target-rename fault unexpectedly succeeded', visible(failed)); need(fs.readFileSync(fixture.target).equals(original) && fs.readFileSync(fixture.manifest).equals(oldManifest), 'product_mismatch', 'target rename failure did not preserve old target/manifest'); const recovery = assertRecovery(root, fixture.target, original, source); const failureDelta = assertExactDelta(before, snapshot(root), recoveryExpectation.delta, 'target rename failure'); assertNoTemps(root); assertSentinel(root, fixture.sentinel); const retry = cleanUpdate(installed, root, isolated, external, 'target-rename clean retry'); need(fs.readFileSync(fixture.target).equals(source), 'product_mismatch', 'target-rename retry did not converge target'); const recoveryAfter = assertRecovery(root, fixture.target, original, source); const after = semanticSnapshot(root); const repeat = cleanUpdate(installed, root, isolated, external, 'target-rename repeat retry'); need(same(after, semanticSnapshot(root)), 'product_mismatch', 'target-rename retry was not stable'); assertExternalExact(external, root, external.canary); return { case: 'fault-target-rename', fault: { kind: fault.kind, target: fault.target, preloadSha256: fault.preloadSha256, configSha256: fault.configSha256 }, failed: visible(failed), failureDelta, recovery, retry, recoveryAfter, repeat, normalizedDigest: after.digest };
}
function manifestRename(root, installed, isolated, external) {
  const fixture = initFixture(root, installed, isolated, external); const originalManifest = readJson(fixture.manifest, 'fixture_failure'); const manifest = { ...originalManifest, frameworkVersion: 'proof-stale-framework-version' }; fs.writeFileSync(fixture.manifest, `${JSON.stringify(manifest, null, 2)}\n`); const seeded = fs.readFileSync(fixture.manifest); const before = snapshot(root); const fault = { kind: 'manifest-rename', target: path.resolve(fixture.manifest), basename: path.basename(fixture.manifest), ...preload(faultRoot(root), { kind: 'manifest-rename', target: path.resolve(fixture.manifest), basename: path.basename(fixture.manifest) }) }; const failed = invoke(installed, root, ['update', '--templates'], isolated, { paths: external.isolatedRootPaths, roots: external.isolatedRoots }, fault); need(failed.exitCode !== 0 && !failed.timedOut, 'product_mismatch', 'manifest-rename fault unexpectedly succeeded', visible(failed)); need(fs.readFileSync(fixture.manifest).equals(seeded), 'product_mismatch', 'manifest rename failure did not preserve seeded manifest'); need(same(before, snapshot(root)), 'product_mismatch', 'manifest rename failure changed fixture beyond seeded manifest'); need(!fs.existsSync(path.join(root, '.work', '.local', 'template-recovery')), 'product_mismatch', 'manifest fault created recovery evidence'); assertNoTemps(root); const retry = cleanUpdate(installed, root, isolated, external, 'manifest-rename clean retry'); const repaired = readJson(fixture.manifest, 'product_mismatch'); assertManifestMatchesExpected(root, originalManifest, external.expectedOwnership, 'original'); assertManifestMatchesExpected(root, repaired, external.expectedOwnership, 'repaired'); const originalNormalized = { ...originalManifest }; delete originalNormalized.generatedAt; const repairedNormalized = { ...repaired }; delete repairedNormalized.generatedAt; need(same(repairedNormalized, originalNormalized), 'product_mismatch', 'manifest retry did not semantically restore the original manifest beyond generatedAt', { repaired: repairedNormalized, original: originalNormalized }); const after = semanticSnapshot(root); const repeat = cleanUpdate(installed, root, isolated, external, 'manifest-rename repeat retry'); need(same(after, semanticSnapshot(root)), 'product_mismatch', 'manifest retry was not stable'); assertSentinel(root, fixture.sentinel); assertExternalExact(external, root, external.canary); return { case: 'fault-manifest-rename', fault: { kind: fault.kind, target: fault.target, preloadSha256: fault.preloadSha256, configSha256: fault.configSha256 }, failed: visible(failed), retry, repeat, seededManifestSha256: sha256(seeded), installedFrameworkVersion: installed.frameworkVersion, normalizedDigest: after.digest };
}
function safeRemove(root) { const temporary = fs.realpathSync(os.tmpdir()); const real = fs.realpathSync(root); need(inside(temporary, real) && path.basename(real).startsWith('gsdd-phase05-update-interruption-'), 'cleanup_failure', `refusing unexpected proof cleanup ${real}`); fs.rmSync(real, { recursive: true, force: false, maxRetries: 2, retryDelay: 150 }); need(!fs.existsSync(real), 'cleanup_failure', 'proof root survived cleanup'); return { root: real, temporary }; }
function execute(development) {
  const state = statusReceipt(development); const protectedBefore = protectedManifest(); const repositoryBefore = snapshot(REPOSITORY_ROOT); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase05-update-interruption-')); let cleanup = null;
  try {
    const isolated = environment(root); for (const value of Object.values(isolated.roots)) need(inside(root, value), 'containment_failure', 'sanitized root escaped proof root'); const canary = path.join(root, 'external-canary.txt'); write(canary, 'phase05 external canary\n'); const installed = archiveAndInstall(root, isolated); const isolatedRootPaths = { ...isolated.roots, source: installed.source, install: installed.installRoot, packageRoot: installed.packageRoot }; const isolatedRoots = Object.fromEntries(Object.entries(isolatedRootPaths).map(([name, rootPath]) => [name, snapshotRoot(rootPath)])); const external = { protected: protectedBefore, repository: repositoryBefore, canary: entry(canary), isolatedRootPaths, isolatedRoots }; external.expectedOwnership = expectedOwnershipFromInstalled(installed, isolated, { paths: isolatedRootPaths, roots: isolatedRoots }); const results = [control(path.join(root, 'fixtures', 'control'), installed, isolated, external), renderRead(path.join(root, 'fixtures', 'render-read'), installed, isolated, external), targetRename(path.join(root, 'fixtures', 'target-rename'), installed, isolated, external), manifestRename(path.join(root, 'fixtures', 'manifest-rename'), installed, isolated, external)]; need(results.length === CASES.length && same(results.map((value) => value.case), CASES), 'harness_failure', 'case matrix did not complete'); need(same(protectedBefore, protectedManifest()), 'containment_failure', 'protected inputs changed'); cleanup = safeRemove(root); return { phase: '05-05', acceptance: !development, classification: development ? 'non_acceptance_development_harness_pass' : 'acceptance_pass', candidate: state, environment: isolated.receipt, isolatedRootLedger: isolatedRoots, installed: { tarball: installed.tarball, packageJsonSha256: installed.packageJsonSha256, readmeSha256: installed.readmeSha256, entrySha256: installed.entrySha256, packageMeta: installed.packageMeta, workflow: installed.workflow, pack: installed.pack, install: installed.install }, expectedOwnership: { frameworkVersion: external.expectedOwnership.frameworkVersion, templates: external.expectedOwnership.templates, roles: external.expectedOwnership.roles, runtimeHelpers: external.expectedOwnership.runtimeHelpers, probe: external.expectedOwnership.probe }, cases: results, cleanup, claimLimits: ['bounded single fs read/rename EIO only', 'no signal, abrupt termination, power-loss, multi-file transaction, concurrency, or Windows-shell claim'] };
  } catch (error) { const failure = error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack }); if (fs.existsSync(root)) { try { cleanup = safeRemove(root); } catch (cleanupError) { failure.classification = 'cleanup_failure'; failure.cause = { prior: failure.cause, cleanup: cleanupError.message }; } } failure.cleanup = cleanup; throw failure; }
}
function main() { const args = process.argv.slice(2); if (same(args, ['--catalog'])) return catalog(); const development = same(args, [DEVELOPMENT_ARGUMENT, SELF_PATH]); if (!development && args.length) fail('usage_failure', `usage: node ${SELF_PATH} [--catalog|${DEVELOPMENT_ARGUMENT} ${SELF_PATH}]`); process.stdout.write(`${JSON.stringify(execute(development), null, 2)}\n`); }
try { main(); } catch (error) { const failure = error instanceof ProofFailure ? error : new ProofFailure('harness_failure', error.message, { stack: error.stack }); process.stderr.write(`${JSON.stringify({ phase: '05-05', acceptance: false, classification: failure.classification, error: failure.message, cause: failure.cause, cleanup: failure.cleanup || null }, null, 2)}\n`); process.exitCode = 1; }
