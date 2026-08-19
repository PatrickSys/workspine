#!/usr/bin/env node
'use strict';

// Private P05-07 development evidence.  This deliberately has no acceptance mode.
// Product commands below always use the one locally installed packed entry.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const SELF = 'tests/proof/phase05-lifecycle-routes.cjs';
const DEV = '--development-harness';
const UPDATE_CACHE_BYTES = Buffer.from('{"schema":1,"checkedAt":"2026-08-14T00:00:00.000Z","status":"available","latestVersion":"0.32.0","error":null}\n');
const STATIC_SOURCES = Object.freeze({
  newProject: 'distilled/workflows/new-project.md',
  newMilestone: 'distilled/workflows/new-milestone.md',
  change: 'distilled/templates/brownfield-change/CHANGE.md',
  handoff: 'distilled/templates/brownfield-change/HANDOFF.md',
  verification: 'distilled/templates/brownfield-change/VERIFICATION.md',
});
const CANDIDATE = '9dfc8ce97eec57ba99474fea1b1adcc992eb22a3';
const PARENT = '188e6f03d4ffde0c3056498ac496948d3a408b90';
const TARBALL_SHA256 = '503361505d9fbcd7ccc1cf8d8c5e3277f43d447fda64db3e7f23a06043c24c87';
const PACKAGE_MEMBERS = 114;
const ENTRY_SHA256 = '1ea6b30445cf22f717de9f2c89a962b057c80da72c363480342922ce420f12af';
const NPM = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const LIMIT = 16384;
const TIMEOUT = 120000;
const PROTECTED = Object.freeze([
  ['.work.zip', 356000, '36158acba6dda63a17dde4e5bc288fbd17e6297d3964f6729dc33baa72fb5f2b'],
  ['deep-research-report-decision-driven-second.md', 38875, '3e12c48f66065136830551acc80fb02afce59d7ff50f0b6c37627102f2dbd4d2'],
  ['deep-research-report-decision-driven.md', 36427, 'c6c1a6b58d0c90c933f4ac35d79feda7fc5a95805bfddca2a3f04da9bab904f8'],
  ['tests/proof/phase05-concurrency.cjs', 43618, 'c7c1d2b928c30367987b69e1678c834de4eaf80e0b10420e8c0c32b9e24c7239'],
  ['tests/proof/phase05-global-install.cjs', 12195, '27e6d1dbbddb0c205489ce7e09bca1605c2deee8a513d1c996a6cead48203b08'],
  ['tests/proof/phase05-runtime-windows.cjs', 16298, '72fa8ed442a07055130e0bbfc0bb2b3e679784fa4dd00106b91bf772d0a7d7fa'],
  ['workspine.zip', 6691999, '83184a0ed5a6f46e6586a454ab06e5e2ac2bad3078fccc58f933ebcbf6d65127'],
]);
const CASE_IDS = Object.freeze([
  'packed-workflow-quick-contract', 'seeded-next-execute-transition', 'verify-resume-continuity',
  'same-token-ambiguity-exact-selector', 'terminal-closure-roadmap-only', 'rigor-contract',
  'new-project-new-milestone-brownfield-contract',
]);
const HUMAN_GATE = Object.freeze({
  human_gate: 'seeded_workflow_fixture_not_human_review', approval_transition: 'workflow_contract_only',
  human_approval: 'not_observed', product_approval_state: 'not_present', authentication: 'not_proven', raw_executor_rejection: 'not_claimed',
});
class Failure extends Error { constructor(kind, message, cause = null) { super(message); this.kind = kind; this.cause = cause; } }
function fail(kind, message, cause) { throw new Failure(kind, message, cause); }
function need(ok, kind, message, cause) { if (!ok) fail(kind, message, cause); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function normalized(value) { if (Array.isArray(value)) return value.map(normalized); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])])); return value; }
function sameMap(a, b) { return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b)); }
function shaFile(file) { return sha(fs.readFileSync(file)); }
function slash(value) { return value.split(path.sep).join('/'); }
function inside(root, value) { const relative = path.relative(path.resolve(root), path.resolve(value)); return relative === '' || (!!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); }
function exists(value) { try { fs.lstatSync(value); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { flag: 'wx' }); }
function clip(value) { const buffer = Buffer.from(value || ''); const cut = buffer.length > LIMIT; const kept = cut ? Buffer.concat([buffer.subarray(0, LIMIT / 2), Buffer.from('\n...[truncated]...\n'), buffer.subarray(buffer.length - LIMIT / 2)]) : buffer; return { bytes: buffer.length, sha256: sha(buffer), truncated: cut, text: kept.toString('utf8') }; }
function run(command, args, options = {}) { const started = Date.now(); const result = cp.spawnSync(command, args, { cwd: options.cwd || REPO, env: options.env, encoding: 'buffer', windowsHide: true, timeout: TIMEOUT, maxBuffer: 32 * 1024 * 1024 }); if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error; const receipt = { command, args, cwd: options.cwd || REPO, exitCode: result.status === null ? -1 : result.status, signal: result.signal || null, timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'), elapsedMs: Date.now() - started, stdout: clip(result.stdout), stderr: clip(result.stderr) }; Object.defineProperties(receipt, { _out: { value: Buffer.from(result.stdout || ''), enumerable: false }, _err: { value: Buffer.from(result.stderr || ''), enumerable: false } }); return receipt; }
function text(receipt, stream = '_out') { return receipt[stream].toString('utf8'); }
function publicReceipt(receipt) { const { _out, _err, ...visible } = receipt; return visible; }
function success(receipt, kind, label) { need(receipt.exitCode === 0 && !receipt.timedOut, kind, `${label} failed`, publicReceipt(receipt)); return receipt; }
function parse(receipt, kind, label) { try { return JSON.parse(text(receipt)); } catch (error) { fail(kind, `${label} did not emit JSON`, { message: error.message, receipt: publicReceipt(receipt) }); } }
function lstatTree(root) { const absolute = path.resolve(root); if (!exists(absolute)) return { root: absolute, type: 'missing', entries: [] }; const entries = []; const visit = (full, relative) => { const stat = fs.lstatSync(full); const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'; entries.push({ path: slash(relative), type, mode: stat.mode, bytes: type === 'file' ? stat.size : null, sha256: type === 'file' ? sha(fs.readFileSync(full)) : null, link: type === 'link' ? fs.readlinkSync(full) : null }); if (type === 'directory') for (const name of fs.readdirSync(full).sort((a, b) => a.localeCompare(b, 'en'))) visit(path.join(full, name), path.join(relative, name)); }; const stat = fs.lstatSync(absolute); if (stat.isDirectory()) for (const name of fs.readdirSync(absolute).sort((a, b) => a.localeCompare(b, 'en'))) visit(path.join(absolute, name), name); else visit(absolute, '.'); return { root: absolute, type: stat.isDirectory() ? 'directory' : 'other', entries }; }
function delta(before, after) { const oldMap = new Map(before.entries.map((entry) => [entry.path, entry])); const newMap = new Map(after.entries.map((entry) => [entry.path, entry])); const changes = []; for (const [name, entry] of newMap) { if (!oldMap.has(name)) changes.push({ kind: 'added', path: name }); else if (!same(oldMap.get(name), entry)) changes.push({ kind: 'changed', path: name }); } for (const [name] of oldMap) if (!newMap.has(name)) changes.push({ kind: 'removed', path: name }); return changes.sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`, 'en')); }
function manifest() { return PROTECTED.map(([relative, bytes, hash]) => { const value = fs.readFileSync(path.join(REPO, relative)); need(value.length === bytes && sha(value) === hash, 'candidate_drift', `protected input drifted: ${relative}`); return { path: relative, bytes, sha256: hash }; }); }
function gitText(args) { return text(success(run('git', args, { cwd: REPO, env: process.env }), 'candidate_drift', `git ${args.join(' ')}`)).trim(); }
function canonical() { const head = gitText(['rev-parse', 'HEAD']); const parent = gitText(['rev-parse', `${CANDIDATE}^`]); const branch = gitText(['branch', '--show-current']); const upstream = gitText(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']); const main = gitText(['show-ref', '--verify', '--hash', 'refs/heads/main']); const recovery = gitText(['show-ref', '--verify', '--hash', 'refs/heads/recovery/workspine-relaunch-20260809']); const tracked = gitText(['status', '--porcelain=v1', '--untracked-files=no']); const index = run('git', ['diff', '--cached', '--quiet'], { cwd: REPO, env: process.env }); const untracked = gitText(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean).sort(); const allowed = PROTECTED.map(([name]) => name).concat(SELF).sort(); need(head === CANDIDATE && parent === PARENT && branch === 'recovery/workspine-relaunch-20260809' && upstream === 'origin/recovery/workspine-relaunch-20260809' && main === 'b7c8b7bd54e1764826cb55763440a676181bc851' && recovery === CANDIDATE && tracked === '' && index.exitCode === 0 && same(untracked, allowed), 'candidate_drift', 'canonical branch/ref/parent/index/tracked/untracked predicate drifted', { head, parent, branch, upstream, main, recovery, tracked, index: index.exitCode, untracked, allowed }); return { head, parent, branch, upstream, refs: { main, recovery }, index: 'clean', tracked, untracked, protectedInputs: manifest() }; }
function environment(root) { const home = path.join(root, 'home'), temp = path.join(root, 'temp'), cache = path.join(root, 'cache'), prefix = path.join(root, 'prefix'), npmrc = path.join(root, 'npmrc'), npmGlobalrc = path.join(root, 'npm-globalrc'), gitconfig = path.join(root, 'gitconfig'), guard = path.join(root, 'guard'); const npmConfig = Buffer.from('registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n'); for (const directory of [home, temp, cache, prefix, guard]) fs.mkdirSync(directory, { recursive: true }); write(npmrc, npmConfig); write(npmGlobalrc, npmConfig); write(gitconfig, ''); const npmAdmissionLedger = Object.freeze(['npmrc', 'npm-globalrc'].map((relativePath, index) => Object.freeze({ role: index === 0 ? 'user' : 'global', relativePath, absolutePath: fs.realpathSync(path.join(root, relativePath)), expectedBytes: npmConfig.length, expectedSha256: sha(npmConfig), regularFile: true, symbolicLink: false }))); const system = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'; const locatedGit = cp.spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], { encoding: 'utf8', windowsHide: true }); need(locatedGit.status === 0 && String(locatedGit.stdout).trim(), 'harness_failure', 'could not resolve Git for scrubbed proof environment'); const gitDirectory = path.dirname(String(locatedGit.stdout).trim().split(/\r?\n/)[0]); const nodeDirectory = path.dirname(process.execPath); const childPath = [guard, gitDirectory, nodeDirectory, path.join(system, 'System32'), system].join(path.delimiter); const env = { PATH: childPath, Path: childPath, PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD', SystemRoot: system, WINDIR: system, ComSpec: process.env.ComSpec || path.join(system, 'System32', 'cmd.exe'), HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'), TEMP: temp, TMP: temp, npm_config_cache: cache, npm_config_prefix: prefix, npm_config_userconfig: npmrc, npm_config_globalconfig: npmGlobalrc, npm_config_registry: 'http://127.0.0.1:9/', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: '0', NO_PROXY: '*', no_proxy: '*', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NODE_OPTIONS: undefined, NODE_PATH: undefined, CI: '1' }; return { env, roots: { home, temp, cache, prefix, npmrc, npmGlobalrc, gitconfig, guard }, npmAdmissionLedger }; }
function packInstall(root, isolated) { const source = path.join(root, 'candidate-source'), archive = path.join(root, 'candidate.tar'); const assertNpmAdmission = (stage) => { const rows = isolated.npmAdmissionLedger; need(Object.isFrozen(rows) && rows.length === 2 && rows[0].absolutePath !== rows[1].absolutePath, 'harness_failure', 'npm admission ledger did not retain two distinct config paths', rows); for (const row of rows) { const resolved = fs.realpathSync(row.absolutePath), stat = fs.lstatSync(row.absolutePath), bytes = fs.readFileSync(row.absolutePath); need(resolved === row.absolutePath && inside(root, resolved) && path.relative(root, resolved) === row.relativePath && stat.isFile() && !stat.isSymbolicLink() && bytes.length === row.expectedBytes && sha(bytes) === row.expectedSha256 && row.regularFile === true && row.symbolicLink === false, 'harness_failure', `npm ${row.role} config admission drifted before ${stage}`, { row, resolved, regularFile: stat.isFile(), symbolicLink: stat.isSymbolicLink(), bytes: bytes.length, sha256: sha(bytes) }); } }; fs.mkdirSync(source, { recursive: true }); success(run('git', ['archive', '--format=tar', '--output', archive, CANDIDATE], { cwd: REPO, env: isolated.env }), 'producer_failure', 'candidate archive'); success(run('tar', ['-xf', archive, '-C', source], { cwd: root, env: isolated.env }), 'producer_failure', 'candidate archive extract'); fs.unlinkSync(archive); assertNpmAdmission('npm pack'); const packed = parse(success(run(process.execPath, [NPM, 'pack', '--ignore-scripts', '--json'], { cwd: source, env: isolated.env }), 'producer_failure', 'npm pack'), 'producer_failure', 'npm pack'); need(Array.isArray(packed) && packed.length === 1 && Array.isArray(packed[0].files) && packed[0].files.length === PACKAGE_MEMBERS, 'provenance_failure', 'fixed package member tuple drifted', packed); const tarball = path.join(source, packed[0].filename); need(sha(fs.readFileSync(tarball)) === TARBALL_SHA256, 'provenance_failure', 'tarball identity drifted'); const install = path.join(root, 'install'); fs.mkdirSync(install, { recursive: true }); write(path.join(install, 'package.json'), '{"name":"phase05-lifecycle-routes","private":true}\n'); assertNpmAdmission('local tarball install'); success(run(process.execPath, [NPM, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', tarball], { cwd: install, env: isolated.env }), 'producer_failure', 'local tarball install'); const packageName = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name; const packageRoot = path.join(install, 'node_modules', packageName); const entry = fs.realpathSync(path.join(packageRoot, 'bin', 'gsdd.mjs')); need(inside(install, entry) && sha(fs.readFileSync(entry)) === ENTRY_SHA256, 'provenance_failure', 'installed entry provenance drifted', { entry }); return { source, install, packageRoot, entry, tarball: { sha256: TARBALL_SHA256, members: PACKAGE_MEMBERS, filename: packed[0].filename }, entrySha256: ENTRY_SHA256, npmAdmission: { ledger: isolated.npmAdmissionLedger, assertions: ['pre_npm_pack', 'pre_local_tarball_install'] } }; }
function invoke(installed, cwd, args, isolated) { need(!isolated.env.NODE_OPTIONS && !isolated.env.NODE_PATH, 'harness_failure', 'ambient Node loader/path retained'); const receipt = run(process.execPath, [installed.entry, ...args], { cwd, env: isolated.env }); need(same(sha(fs.readFileSync(installed.entry)), installed.entrySha256), 'containment_failure', 'installed entry changed'); return receipt; }
function initGit(root, isolated) { fs.mkdirSync(root, { recursive: true }); success(run('git', ['init', '--quiet'], { cwd: root, env: isolated.env }), 'fixture_failure', 'fixture git init'); success(run('git', ['config', 'user.name', 'Fixture User'], { cwd: root, env: isolated.env }), 'fixture_failure', 'fixture git name'); success(run('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root, env: isolated.env }), 'fixture_failure', 'fixture git email'); write(path.join(root, 'seed.txt'), 'seed\n'); success(run('git', ['add', '--', 'seed.txt'], { cwd: root, env: isolated.env }), 'fixture_failure', 'fixture seed stage'); success(run('git', ['commit', '--quiet', '-m', 'seed'], { cwd: root, env: isolated.env }), 'fixture_failure', 'fixture seed commit'); }
function baseWork(root, title = 'Exact lifecycle') { write(path.join(root, '.work', 'SPEC.md'), '# Spec\n'); write(path.join(root, '.work', 'config.json'), '{}\n'); write(path.join(root, '.work', 'ROADMAP.md'), `# Roadmap\n\n- [ ] **Phase 11: ${title}**\n`); }
function plan(root, dir = '11-exact', base = '11') { const relative = path.join('.work', 'phases', dir); write(path.join(root, relative, `${base}-PLAN.md`), `---\nphase: ${dir}\nplan: ${base}\nstatus: pending\nbrowser_proof_required: false\nbrowser_proof_rationale: no browser outcome\n---\n\n# ${dir}\n`); return { directory: path.join(root, relative), selector: `phases/${dir}`, plan: `phases/${dir}/${base}-PLAN.md` }; }
function checkpoint(root) { write(path.join(root, '.work', 'goal.md'), '# Goal\n'); write(path.join(root, '.work', '.continue-here.md'), ['---', 'workflow: phase', 'phase: 11-exact', 'timestamp: 2026-08-13T10:00:00.000Z', 'runtime: codex-cli', '---', '', '<current_state>', 'Seeded generic continuity.', '</current_state>', '', '<completed_work>', 'Planning is complete.', '</completed_work>', '', '<remaining_work>', 'Select execution explicitly.', '</remaining_work>', '', '<decisions>', 'Workflow seam only.', '</decisions>', '', '<blockers>', 'None.', '</blockers>', '', '<next_action>', 'Select the next workflow explicitly.', '</next_action>', ''].join('\n')); }
function nextSemantic(root, baseline, mode) { const label = mode === 'cold' ? 'cold next' : 'warm next'; need(mode === 'cold' || mode === 'warm', 'harness_failure', 'unknown next semantic mode'); const afterNext = lstatTree(root); const changes = delta(baseline, afterNext); const expectedCacheDelta = [{ kind: 'added', path: '.work/.local' }, { kind: 'added', path: '.work/.local/update-awareness.json' }]; if (mode === 'cold') { need(same(changes.map(({ kind, path: entryPath }) => ({ kind, path: entryPath })), expectedCacheDelta), 'product_mismatch', label + ' changed more than the accepted update-awareness cache entries', changes); need(same(changes.filter(({ kind }) => kind === 'changed'), []), 'product_mismatch', label + ' changed an existing fixture entry', changes); need(same(changes.filter(({ kind }) => kind === 'removed'), []), 'product_mismatch', label + ' removed a fixture entry', changes); } else { need(same(changes, []), 'product_mismatch', label + ' changed the saved warm fixture snapshot', changes); } const entries = new Map(afterNext.entries.map((entry) => [entry.path, entry])); const localEntry = entries.get('.work/.local'); const cacheEntry = entries.get('.work/.local/update-awareness.json'); need(localEntry && cacheEntry, 'product_mismatch', label + ' did not retain the update-awareness cache entries', afterNext); need(localEntry.type === 'directory' && (localEntry.mode & 0o170000) === 0o040000 && localEntry.link === null, 'product_mismatch', label + ' local cache entry is not a regular directory', localEntry); need(cacheEntry.type === 'file' && (cacheEntry.mode & 0o170000) === 0o100000 && cacheEntry.link === null, 'product_mismatch', label + ' cache entry is not a regular file', cacheEntry); const localEntries = afterNext.entries.filter(({ path: entryPath }) => entryPath === '.work/.local' || entryPath.startsWith('.work/.local/')).map(({ path: entryPath }) => entryPath); need(same(localEntries, ['.work/.local', '.work/.local/update-awareness.json']), 'product_mismatch', label + ' local cache contains an unexpected entry', localEntries); const verifyNode = (target, expected, nodeLabel, containment) => { let stat; try { stat = fs.lstatSync(target); } catch (error) { fail('product_mismatch', nodeLabel + ' could not be lstat\'ed', { message: error.message }); } const typeOk = expected === 'directory' ? stat.isDirectory() : stat.isFile(); need(typeOk && !stat.isSymbolicLink(), 'product_mismatch', nodeLabel + ' has an unexpected lstat type or link', { target, mode: stat.mode, symbolicLink: stat.isSymbolicLink() }); let resolved; try { resolved = fs.realpathSync(target); } catch (error) { fail('product_mismatch', nodeLabel + ' could not be realpathed', { message: error.message }); } need(resolved === containment || inside(containment, resolved), 'containment_failure', nodeLabel + ' realpath escaped its fixture root', { target, resolved, containment }); let resolvedStat; try { resolvedStat = fs.lstatSync(resolved); } catch (error) { fail('containment_failure', nodeLabel + ' realpath could not be re-lstat\'ed', { message: error.message }); } const resolvedTypeOk = expected === 'directory' ? resolvedStat.isDirectory() : resolvedStat.isFile(); need(resolvedTypeOk && !resolvedStat.isSymbolicLink(), 'containment_failure', nodeLabel + ' realpath has an unexpected type or link', { target, resolved, mode: resolvedStat.mode, symbolicLink: resolvedStat.isSymbolicLink() }); return resolved; }; const fixtureRoot = verifyNode(root, 'directory', 'fixture root', fs.realpathSync(root)); const workRoot = path.join(root, '.work'); const localDir = path.join(workRoot, '.local'); const cachePath = path.join(localDir, 'update-awareness.json'); const workRealpath = verifyNode(workRoot, 'directory', 'fixture .work', fixtureRoot); need(inside(fixtureRoot, workRealpath), 'containment_failure', 'fixture .work realpath was not strictly contained by the fixture root'); const localRealpath = verifyNode(localDir, 'directory', 'fixture .work/.local', workRealpath); need(inside(workRealpath, localRealpath), 'containment_failure', 'fixture .work/.local realpath was not strictly contained by fixture .work'); const cacheRealpath = verifyNode(cachePath, 'file', 'update-awareness cache', workRealpath); need(inside(workRealpath, cacheRealpath), 'containment_failure', 'update-awareness cache realpath was not strictly contained by fixture .work'); const parseVersion = (value) => { const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value ?? '')); if (!match) return null; const parts = match.slice(1).map(Number); return parts.every((part) => Number.isSafeInteger(part)) ? parts : null; }; const validCache = (value) => { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const keys = Object.keys(value).sort(); if (!same(keys, ['checkedAt', 'error', 'latestVersion', 'schema', 'status'])) return false; const checkedAt = Date.parse(value.checkedAt); if (value.schema !== 1 || typeof value.checkedAt !== 'string' || !Number.isFinite(checkedAt)) return false; if (new Date(checkedAt).toISOString() !== value.checkedAt) return false; if (!['available', 'unavailable'].includes(value.status)) return false; if (value.status === 'available' && (typeof value.latestVersion !== 'string' || !parseVersion(value.latestVersion) || value.error !== null)) return false; if (value.status === 'unavailable' && (value.latestVersion !== null || !new Set(['timeout', 'network', 'http', 'invalid', 'oversize', 'cache_write']).has(value.error))) return false; return true; }; let cache; try { cache = JSON.parse(fs.readFileSync(cacheRealpath, 'utf8')); } catch (error) { fail('product_mismatch', label + ' update-awareness cache was not valid JSON', { message: error.message }); } need(validCache(cache), 'product_mismatch', label + ' update-awareness cache schema drifted', cache); Object.defineProperty(afterNext, 'cacheReceipt', { value: { delta: mode === 'cold' ? expectedCacheDelta : [], snapshot: { entries: [localEntry, cacheEntry], value: cache }, entries: ['.work/.local', '.work/.local/update-awareness.json'] }, enumerable: false }); return afterNext; } function noWrite(before, root, label) { need(same(before, lstatTree(root)), 'product_mismatch', `${label} changed a read/refusal fixture`, { delta: delta(before, lstatTree(root)) }); }
function seedUpdateCache(root) { const cache = path.join(root, '.work', '.local', 'update-awareness.json'); write(cache, UPDATE_CACHE_BYTES); return cache; }
function cacheState(cache) { const directory = path.dirname(cache); const stat = fs.lstatSync(cache); const dirStat = fs.lstatSync(directory); need(dirStat.isDirectory() && !dirStat.isSymbolicLink() && stat.isFile() && !stat.isSymbolicLink(), 'containment_failure', 'update-awareness cache is not a regular contained directory/file'); const bytes = fs.readFileSync(cache); return { bytes: bytes.length, sha256: sha(bytes), value: bytes.toString('utf8') }; }
function assertCache(before, cache, label) { const after = cacheState(cache); need(same(after, before), 'product_mismatch', `${label} changed the seeded update-awareness cache`, { before, after }); }
function subset(actual, expected, label) { for (const [key, value] of Object.entries(expected)) { need(Object.hasOwn(actual, key), 'product_mismatch', `${label} omitted ${key}`, actual); if (value && typeof value === 'object' && !Array.isArray(value)) subset(actual[key], value, `${label}.${key}`); else need(same(actual[key], value), 'product_mismatch', `${label}.${key} drifted`, { expected: value, actual: actual[key] }); } }
function casePacked(installed, root, isolated) { initGit(root, isolated); const before = lstatTree(root); success(invoke(installed, root, ['init', '--auto', '--tools', 'agents'], isolated), 'product_mismatch', 'installed init'); const quick = path.join(root, '.agents', 'skills', 'work-quick', 'SKILL.md'); const routes = ['work-quick', 'work-plan', 'work-execute', 'work-verify', 'work-resume'].map((name) => { const file = path.join(root, '.agents', 'skills', name, 'SKILL.md'); const value = fs.readFileSync(file, 'utf8'); need(value.trim().length > 0 && value.includes(name), 'product_mismatch', `generated ${name} route is absent or empty`); return { route: name, sha256: sha(Buffer.from(value)) }; }); const readme = fs.readFileSync(path.join(installed.packageRoot, 'README.md'), 'utf8'); need(readme.includes('work-quick') && readme.includes('work-plan') && readme.includes('work-execute') && readme.includes('work-verify'), 'product_mismatch', 'packed README route surface is incomplete'); need(delta(before, lstatTree(root)).length > 0 && exists(quick), 'product_mismatch', 'init did not produce expected generated surfaces'); return { id: CASE_IDS[0], evidence: 'packed_static_generated_route_contract', routes, readmeSha256: sha(Buffer.from(readme)), claimLimit: 'not_blind_reader_or_native_agent_evidence' }; }
function caseTransition(installed, root, isolated) { initGit(root, isolated); baseWork(root); const exact = plan(root); checkpoint(root); const summary = path.join(exact.directory, '11-SUMMARY.md'); need(!exists(summary), 'product_mismatch', 'matching Summary exists before seeded next'); const before = lstatTree(root); const next = parse(success(invoke(installed, root, ['next', '--json'], isolated), 'product_mismatch', 'seeded next'), 'product_mismatch', 'seeded next'); need(next.continuity?.checkpoint?.status === 'valid' && next.continuity.checkpoint.sections.next_action === 'Select the next workflow explicitly.', 'product_mismatch', 'seeded next did not expose checkpoint'); const transition = nextSemantic(root, before, 'cold'); const afterNext = transition; need(!exists(summary), 'product_mismatch', 'matching Summary appeared before exact execute preflight'); const preflight = parse(success(invoke(installed, root, ['lifecycle-preflight', 'execute', exact.selector, '--plan', exact.plan, '--expects-mutation', 'phase-status'], isolated), 'product_mismatch', 'exact execute preflight'), 'product_mismatch', 'exact execute preflight'); need(preflight.allowed === true && preflight.plan === exact.plan, 'product_mismatch', 'exact execute preflight did not bind selected plan', preflight); const afterPreflight = lstatTree(root); need(same(delta(afterNext, afterPreflight), []), 'product_mismatch', 'exact execute preflight changed the post-next fixture', delta(afterNext, afterPreflight)); need(!exists(summary), 'product_mismatch', 'matching Summary appeared before post-preflight assertion'); write(summary, '# summary\n'); return { id: CASE_IDS[1], next: { checkpoint: next.continuity.checkpoint.status }, cache: transition.cacheReceipt, preflight: { plan: preflight.plan, authority: preflight.authority }, ...HUMAN_GATE }; }
function caseContinuity(installed, root, isolated) { initGit(root, isolated); baseWork(root); checkpoint(root); const generated = path.join(root, 'generated'); initGit(generated, isolated); success(invoke(installed, generated, ['init', '--auto', '--tools', 'agents'], isolated), 'product_mismatch', 'continuity generated init'); const verify = fs.readFileSync(path.join(generated, '.agents', 'skills', 'work-verify', 'SKILL.md'), 'utf8'); const resume = fs.readFileSync(path.join(generated, '.agents', 'skills', 'work-resume', 'SKILL.md'), 'utf8'); need(/continue|continuity/i.test(verify) && /explicit|select/i.test(resume) && /cleanup/i.test(resume), 'product_mismatch', 'verify/resume generated wording lacks deferred explicit continuation'); const nested = path.join(root, 'nested', 'deep'); fs.mkdirSync(nested, { recursive: true }); const nestedBefore = lstatTree(root); const one = parse(success(invoke(installed, nested, ['next', '--json'], isolated), 'product_mismatch', 'nested next'), 'product_mismatch', 'nested next'); const nestedAfter = nextSemantic(root, nestedBefore, 'cold'); const two = parse(success(invoke(installed, root, ['next', '--json'], isolated), 'product_mismatch', 'explicit-root next'), 'product_mismatch', 'explicit-root next'); nextSemantic(root, nestedAfter, 'warm'); need(same(one.continuity, two.continuity), 'product_mismatch', 'nested/explicit next continuity packets diverged'); need(fs.readFileSync(path.join(root, '.work', '.continue-here.md'), 'utf8').includes('Seeded generic continuity.'), 'product_mismatch', 'next altered checkpoint bytes'); return { id: CASE_IDS[2], packetParity: true, checkpointPreserved: true, verifyResumeGeneratedContract: true, claimLimit: 'not_native_or_interactive_resume' }; }
function ambiguityFixture(root, isolated) { initGit(root, isolated); baseWork(root); const first = plan(root, '11-first'); const second = plan(root, '11-second'); return { first, second }; }
function legacyCaseAmbiguity(installed, root, isolated) { const { first } = ambiguityFixture(root, isolated); const before = lstatTree(root); for (const args of [['lifecycle-preflight', 'execute', '11', '--expects-mutation', 'phase-status'], ['verify', '11']]) { const receipt = invoke(installed, root, args, isolated); need(receipt.exitCode !== 0, 'product_mismatch', 'bare colliding selector unexpectedly succeeded', publicReceipt(receipt)); const body = parse(receipt, 'product_mismatch', 'bare colliding selector'); const choices = body.choices || body.blockers?.[0]?.artifacts; need(/ambiguous_phase_selector/.test(JSON.stringify(body)) && same(choices, ['phases/11-first', 'phases/11-second']), 'product_mismatch', 'bare selector refusal choices drifted', body); noWrite(before, root, `bare ${args[0]}`); }
  const exact = parse(success(invoke(installed, root, ['lifecycle-preflight', 'execute', first.selector, '--plan', first.plan, '--expects-mutation', 'phase-status'], isolated), 'product_mismatch', 'exact ambiguity preflight'), 'product_mismatch', 'exact ambiguity preflight'); need(exact.allowed === true && exact.plan === first.plan, 'product_mismatch', 'exact selector did not bind only first plan', exact); noWrite(before, root, 'exact ambiguity preflight'); return { id: CASE_IDS[3], choices: ['phases/11-first', 'phases/11-second'], noWrite: true, exactPlan: exact.plan }; }
function legacyCaseClosure(installed, root, isolated) { initGit(root, isolated); baseWork(root); const exact = plan(root); const roadmap = path.join(root, '.work', 'ROADMAP.md'); const before = lstatTree(root); const initial = invoke(installed, root, ['phase-status', exact.selector, 'done'], isolated); need(initial.exitCode !== 0 && /incomplete_phase_closure/.test(`${text(initial)}${text(initial, '_err')}`), 'product_mismatch', 'premature closure did not refuse exact chain', publicReceipt(initial)); noWrite(before, root, 'premature closure'); write(path.join(exact.directory, '11-SUMMARY.md'), '# summary\n'); write(path.join(exact.directory, '11-VERIFICATION.md'), '---\nstatus: passed\n---\n# verification\n'); const chainBefore = lstatTree(root); success(invoke(installed, root, ['phase-status', exact.selector, 'done'], isolated), 'product_mismatch', 'exact terminal closure'); const changes = delta(chainBefore, lstatTree(root)); need(same(changes, [{ kind: 'changed', path: '.work/ROADMAP.md' }]) && fs.readFileSync(roadmap, 'utf8').includes('- [x] **Phase 11:'), 'product_mismatch', 'terminal closure changed more than selected ROADMAP', changes); return { id: CASE_IDS[4], early: 'incomplete_phase_closure', finalMutation: ['.work/ROADMAP.md'] }; }
function legacyCaseRigor(installed, root, isolated) { initGit(root, isolated); success(invoke(installed, root, ['init', '--auto', '--tools', 'agents'], isolated), 'product_mismatch', 'rigor init'); const levels = {}; for (const level of ['low', 'medium', 'high', 'max']) { success(invoke(installed, root, ['rigor', level], isolated), 'product_mismatch', `rigor ${level}`); const show = parse(success(invoke(installed, root, ['rigor', 'show'], isolated), 'product_mismatch', `rigor show ${level}`), 'product_mismatch', `rigor show ${level}`); need(show.rigorProfile === level && show.workflow && typeof show.workflow === 'object', 'product_mismatch', `rigor ${level} did not expose active gates`, show); if (level === 'max') need(same(show.effective, { plan: 'high', execute: 'high', verify: 'high' }) && /high rigor gates/.test(show.compatibility?.max || ''), 'product_mismatch', 'max did not resolve to high compatibility gates', show); levels[level] = { effective: show.effective, workflow: show.workflow, compatibility: show.compatibility || null }; }
  const config = path.join(root, '.work', 'config.json'); const value = JSON.parse(fs.readFileSync(config, 'utf8')); value.workflow = { ...(value.workflow || {}), showCode: true, askBeforeDecide: true }; fs.writeFileSync(config, `${JSON.stringify(value, null, 2)}\n`); const legacy = parse(success(invoke(installed, root, ['rigor', 'show'], isolated), 'product_mismatch', 'legacy rigor show'), 'product_mismatch', 'legacy rigor show'); need(same(legacy.deprecatedNoOps, { showCode: 'ignored deprecated no-op', askBeforeDecide: 'ignored deprecated no-op' }), 'product_mismatch', 'legacy no-op receipt drifted', legacy); return { id: CASE_IDS[5], levels, deprecatedNoOps: legacy.deprecatedNoOps, claimLimit: 'no_distinct_max_behavior' }; }
function legacyCaseNewProject(installed, root, isolated) { initGit(root, isolated); success(invoke(installed, root, ['init', '--auto', '--tools', 'agents'], isolated), 'product_mismatch', 'route init'); const routes = ['work-new-project', 'work-new-milestone'].map((name) => { const file = path.join(root, '.agents', 'skills', name, 'SKILL.md'); const value = fs.readFileSync(file, 'utf8'); need(value.trim().length > 0 && value.includes(name), 'product_mismatch', `${name} route absent`); return { route: name, sha256: sha(Buffer.from(value)) }; }); const brownfield = fs.readFileSync(path.join(root, '.work', 'templates', 'brownfield-change', 'CHANGE.md'), 'utf8'); need(/brownfield|new-project|new-milestone/i.test(brownfield), 'product_mismatch', 'brownfield route contract absent'); const config = JSON.parse(fs.readFileSync(path.join(root, '.work', 'config.json'), 'utf8')); need(config.autoAdvance === true, 'product_mismatch', 'auto init did not record bootstrap autoAdvance'); const helper = fs.readFileSync(path.join(root, '.work', 'bin', 'gsdd.mjs'), 'utf8'); need(helper.includes('lifecycle-preflight'), 'product_mismatch', 'generated helper lacks deterministic preflight route'); const runtime = fs.readFileSync(path.join(installed.packageRoot, 'bin', 'lib', 'init-runtime.mjs'), 'utf8'); need(/autoAdvance[\s\S]{0,500}never chains plan, execute, verify, release, or delivery/.test(runtime), 'product_mismatch', 'packed autoAdvance bootstrap limit absent'); return { id: CASE_IDS[6], routes, brownfieldRoute: 'generated_template_contract', autoAdvance: 'bootstrap_only', preflightAware: true, claimLimit: 'not_interactive_or_lifecycle_wide_automation' }; }
function cleanup(root) { const absolute = path.resolve(root), temp = path.resolve(os.tmpdir()); need(inside(temp, absolute) && path.basename(absolute).startsWith('gsdd-phase05-lifecycle-routes-'), 'cleanup_failure', 'unsafe runner cleanup target', { absolute, temp }); const residue = lstatTree(absolute); fs.rmSync(absolute, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 }); need(!exists(absolute), 'cleanup_failure', 'runner root remains after cleanup'); return { root: absolute, residueEntries: residue.entries.length, succeeded: true }; }
function catalog() { const before = manifest(); need(CASE_IDS.length === 7 && new Set(CASE_IDS).size === 7, 'catalog_failure', 'closed seven-case table drifted'); need(same(before, manifest()), 'catalog_failure', 'catalog changed protected inputs'); process.stdout.write(`${JSON.stringify({ phase: '05-07', acceptance: false, classification: 'catalog_only', candidateBinding: { candidate: CANDIDATE, tarballSha256: TARBALL_SHA256, members: PACKAGE_MEMBERS, installedEntryRequired: true }, cases: CASE_IDS.map((id) => ({ id })), nonClaims: { ...HUMAN_GATE, blind_reader: 'not_proven', native_agent: 'not_proven', interactive: 'not_proven', browser: 'not_proven' }, noProductNpmFixtureActivity: true }, null, 2)}\n`); }
function development() {
  const before = canonical();
  const selfBefore = shaFile(path.join(REPO, SELF));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase05-lifecycle-routes-'));
  let cleanupReceipt = null;
  let failureGuard = null;
  try {
    const isolated = environment(root);
    const canary = path.join(root, 'outside-canary');
    write(path.join(canary, 'canary.txt'), 'outside root canary\n');
    const canaryBefore = lstatTree(canary);
    const installed = packInstall(root, isolated);
    const cases = [
      casePacked(installed, path.join(root, 'fixtures', 'packed'), isolated),
      caseTransition(installed, path.join(root, 'fixtures', 'transition'), isolated),
      caseContinuity(installed, path.join(root, 'fixtures', 'continuity'), isolated),
      caseAmbiguity(installed, path.join(root, 'fixtures', 'ambiguity'), isolated),
      caseClosure(installed, path.join(root, 'fixtures', 'closure'), isolated),
      caseRigor(installed, path.join(root, 'fixtures', 'rigor'), isolated),
      caseNewProject(installed, path.join(root, 'fixtures', 'routes'), isolated),
    ];
    need(same(cases.map((item) => item.id), CASE_IDS), 'harness_failure', 'case order drifted');
    need(same(canaryBefore, lstatTree(canary)), 'containment_failure', 'outside-root canary changed');
    const after = canonical();
    const selfAfter = shaFile(path.join(REPO, SELF));
    need(selfAfter === selfBefore, 'candidate_drift', 'runner SELF hash changed during development', { before: selfBefore, after: selfAfter });
    failureGuard = { canonicalBefore: before, canonicalAfter: after, selfBefore, selfAfter };
    cleanupReceipt = cleanup(root);
    return { phase: '05-07', acceptance: false, classification: 'non_acceptance_development_harness_pass', candidate: before, after, installed: { tarball: installed.tarball, entry: installed.entry, entrySha256: installed.entrySha256, npmAdmission: installed.npmAdmission }, cases, cleanup: cleanupReceipt, failureGuard, nonClaims: { ...HUMAN_GATE, blind_reader: 'not_proven', native_agent: 'not_proven', interactive: 'not_proven', browser: 'not_proven', commit_push_publication: 'not_performed' } };
  } catch (error) {
    const original = error instanceof Failure ? error : new Failure('harness_failure', error.message, { stack: error.stack });
    try {
      const after = canonical();
      const selfAfter = shaFile(path.join(REPO, SELF));
      need(selfAfter === selfBefore, 'candidate_drift', 'runner SELF hash changed after failure', { before: selfBefore, after: selfAfter });
      failureGuard = { canonicalBefore: before, canonicalAfter: after, selfBefore, selfAfter };
    } catch (guardError) {
      original.kind = guardError.kind || 'candidate_drift';
      original.message = original.message + '; failure-path identity guard: ' + guardError.message;
      original.cause = { original: original.cause, guard: guardError.cause || guardError.message };
    }
    if (exists(root)) {
      try {
        cleanupReceipt = cleanup(root);
      } catch (cleanupError) {
        throw new Failure('cleanup_failure', cleanupError.message, { original: { kind: original.kind, message: original.message, cause: original.cause }, cleanup: cleanupError.message, failureGuard });
      }
    }
    original.cleanup = cleanupReceipt;
    original.failureGuard = failureGuard;
    throw original;
  }
}
function main() { const args = process.argv.slice(2); if (same(args, ['--catalog'])) return catalog(); if (same(args, [DEV, SELF])) { process.stdout.write(`${JSON.stringify(development(), null, 2)}\n`); return; } fail('usage_failure', `usage: node ${SELF} [--catalog|--development-harness ${SELF}]`); }

function caseAmbiguity(installed, root, isolated) {
  const firstAndSecond = ambiguityFixture(root, isolated);
  const cache = seedUpdateCache(root);
  const seeded = cacheState(cache);
  const before = lstatTree(root);
  const refusal = invoke(installed, root, ["lifecycle-preflight", "execute", "11", "--expects-mutation", "phase-status"], isolated);
  need(refusal.exitCode === 1 && !refusal.timedOut && text(refusal, "_err") === "", "product_mismatch", "bare colliding execute selector did not fail cleanly", publicReceipt(refusal));
  const refusalBody = parse(refusal, "product_mismatch", "bare colliding execute selector");
  subset(refusalBody, { surface: "execute", phase: "11", plan: null, reason: "ambiguous_phase_selector", status: "blocked", allowed: false }, "bare execute preflight");
  need(refusalBody.blockers?.[0]?.code === "ambiguous_phase_selector" && same(refusalBody.blockers[0].artifacts, ["phases/11-first", "phases/11-second"]), "product_mismatch", "bare execute ambiguity artifacts drifted", refusalBody);
  need(Array.isArray(refusalBody.warnings) && refusalBody.decisionsDigest && typeof refusalBody.decisionsDigest === "object" && refusalBody.controlMap && typeof refusalBody.controlMap === "object" && refusalBody.lifecycle && typeof refusalBody.lifecycle === "object", "product_mismatch", "bare execute preflight ambient fields drifted", refusalBody);
  noWrite(before, root, "bare lifecycle-preflight execute");
  assertCache(seeded, cache, "bare lifecycle-preflight execute");
  const verify = invoke(installed, root, ["verify", "11"], isolated);
  need(verify.exitCode === 1 && !verify.timedOut && text(verify, "_err") === "", "product_mismatch", "bare colliding verify selector did not fail cleanly", publicReceipt(verify));
  const verifyBody = parse(verify, "product_mismatch", "bare colliding verify selector");
  subset(verifyBody, { error: "ambiguous_phase_selector", phase: "11", choices: ["phases/11-first", "phases/11-second"] }, "verify ambiguity");
  noWrite(before, root, "bare verify");
  assertCache(seeded, cache, "bare verify");
  const exact = parse(success(invoke(installed, root, ["lifecycle-preflight", "execute", firstAndSecond.first.selector, "--plan", firstAndSecond.first.plan, "--expects-mutation", "phase-status"], isolated), "product_mismatch", "exact ambiguity preflight"), "product_mismatch", "exact ambiguity preflight");
  subset(exact, { surface: "execute", phase: "11", plan: firstAndSecond.first.plan, classification: "owned_write", ownedWrites: ["summary"], explicitLifecycleMutation: "phase-status", mutationRequest: "phase-status", authority: "planning", allowed: true, status: "allowed", reason: null, blockers: [], planningState: null }, "exact execute preflight");
  need(Array.isArray(exact.warnings) && exact.decisionsDigest && typeof exact.decisionsDigest === "object" && exact.controlMap && typeof exact.controlMap === "object" && exact.lifecycle && typeof exact.lifecycle === "object", "product_mismatch", "exact execute preflight ambient fields drifted", exact);
  noWrite(before, root, "exact ambiguity preflight");
  assertCache(seeded, cache, "exact ambiguity preflight");
  return { id: CASE_IDS[3], choices: ["phases/11-first", "phases/11-second"], cache: seeded, noWrite: true, exactPlan: exact.plan, verify: verifyBody };
}

function caseClosure(installed, root, isolated) {
  initGit(root, isolated);
  baseWork(root);
  const exact = plan(root);
  const cache = seedUpdateCache(root);
  const seeded = cacheState(cache);
  const roadmap = path.join(root, ".work", "ROADMAP.md");
  const before = lstatTree(root);
  const initial = invoke(installed, root, ["phase-status", exact.selector, "done"], isolated);
  need(initial.exitCode === 1 && !initial.timedOut && text(initial, "_err") === "", "product_mismatch", "premature closure did not refuse cleanly", publicReceipt(initial));
  const early = parse(initial, "product_mismatch", "premature closure");
  subset(early, { error: "incomplete_phase_closure", phase: "11", identity: "phases/11-exact", chains: [{ plan: "11-exact/11-PLAN.md", summary: null, verification: null, verificationStatus: null, verificationError: null, complete: false }] }, "premature closure");
  noWrite(before, root, "premature closure");
  assertCache(seeded, cache, "premature closure");
  write(path.join(exact.directory, "11-SUMMARY.md"), "# summary\n");
  write(path.join(exact.directory, "11-VERIFICATION.md"), "---\nstatus: passed\n---\n# verification\n");
  const chainBefore = lstatTree(root);
  const final = success(invoke(installed, root, ["phase-status", exact.selector, "done"], isolated), "product_mismatch", "exact terminal closure");
  need(text(final, "_err") === "", "product_mismatch", "exact terminal closure wrote stderr", publicReceipt(final));
  const finalBody = parse(final, "product_mismatch", "exact terminal closure");
  subset(finalBody, { phase: "11", identity: "phases/11-exact", status: "done", roadmap: ".work/ROADMAP.md", changed: true }, "terminal closure");
  const changes = delta(chainBefore, lstatTree(root));
  need(same(changes, [{ kind: "changed", path: ".work/ROADMAP.md" }]) && fs.readFileSync(roadmap, "utf8").includes("- [x] **Phase 11:"), "product_mismatch", "terminal closure changed more than selected ROADMAP", changes);
  assertCache(seeded, cache, "terminal closure");
  return { id: CASE_IDS[4], early, final: finalBody, cache: seeded, finalMutation: [".work/ROADMAP.md"] };
}

function caseRigor(installed, root, isolated) {
  initGit(root, isolated);
  success(invoke(installed, root, ["init", "--auto", "--tools", "agents"], isolated), "product_mismatch", "rigor init");
  const config = path.join(root, ".work", "config.json");
  const expected = {
    low: { researchDepth: "fast", workflow: { research: false, discuss: false, planCheck: false, verifier: true } },
    medium: { researchDepth: "balanced", workflow: { research: true, discuss: false, planCheck: true, verifier: true } },
    high: { researchDepth: "deep", workflow: { research: true, discuss: true, planCheck: true, verifier: true } },
    max: { rigorProfile: "max", researchDepth: "deep", workflow: { research: true, discuss: true, planCheck: true, verifier: true } },
  };
  const setters = {
    low: ["  - set rigor to low", "    researchDepth: balanced -> fast", "    research: true -> false", "    planCheck: true -> false"],
    medium: ["  - set rigor to medium", "    researchDepth: fast -> balanced", "    research: false -> true", "    planCheck: false -> true"],
    high: ["  - set rigor to high", "    researchDepth: balanced -> deep", "    discuss: false -> true"],
    max: ["  - set rigor to max (compatibility input; uses high gates)"],
  };
  const levels = {};
  for (const level of ["low", "medium", "high", "max"]) {
    const setter = invoke(installed, root, ["rigor", level], isolated);
    need(setter.exitCode === 0 && !setter.timedOut && text(setter, "_err") === "", "product_mismatch", "rigor " + level + " setter failed", publicReceipt(setter));
    const setterLines = text(setter).trimEnd().split(/\r?\n/);
    need(same(setterLines, setters[level]), "product_mismatch", "rigor " + level + " setter output drifted", { expected: setters[level], actual: setterLines });
    const value = JSON.parse(fs.readFileSync(config, "utf8"));
    subset(value, { rigorProfile: level, researchDepth: expected[level].researchDepth, workflow: expected[level].workflow }, "persisted rigor " + level);
    const beforeShow = lstatTree(root);
    const showReceipt = success(invoke(installed, root, ["rigor", "show"], isolated), "product_mismatch", "rigor show " + level);
    need(text(showReceipt, "_err") === "", "product_mismatch", "rigor show wrote stderr", publicReceipt(showReceipt));
    const show = parse(showReceipt, "product_mismatch", "rigor show " + level);
    const showKeys = Object.keys(show);
    need(showKeys.includes("rigorProfile") && showKeys.includes("rigorOverrides") && showKeys.includes("effective") && showKeys.includes("workflow") && showKeys.includes("deprecatedNoOps") && showKeys.every((key) => ["rigorProfile", "rigorOverrides", "effective", "workflow", "deprecatedNoOps", "compatibility"].includes(key)), "product_mismatch", "rigor show schema drifted", show);
    need(show.rigorProfile === level, "product_mismatch", "rigor show profile " + level + " drifted", show);
    need(sameMap(show.rigorOverrides, {}), "product_mismatch", "rigor show overrides " + level + " drifted", show);
    need(sameMap(show.deprecatedNoOps, {}), "product_mismatch", "rigor show deprecated no-ops " + level + " drifted", show);
    need(!Object.hasOwn(show, "researchDepth"), "product_mismatch", "rigor show exposed non-emitted researchDepth", show);
    need(sameMap(show.workflow, expected[level].workflow), "product_mismatch", "rigor show workflow " + level + " drifted", show);
    const expectedEffective = level === "max" ? { plan: "high", execute: "high", verify: "high" } : { plan: level, execute: level, verify: level };
    need(sameMap(show.effective, expectedEffective), "product_mismatch", "rigor show effective " + level + " drifted", show);
    if (level === "max") {
      need(Object.hasOwn(show, "compatibility") && sameMap(show.compatibility, { max: "Accepted for compatibility; it uses the current high rigor gates." }), "product_mismatch", "max compatibility drifted", show);
    } else {
      need(!Object.hasOwn(show, "compatibility"), "product_mismatch", "compatibility unexpectedly emitted for " + level, show);
    }
    noWrite(beforeShow, root, "rigor show " + level);
    levels[level] = { persisted: expected[level], show: { rigorProfile: show.rigorProfile, effective: show.effective, workflow: show.workflow, compatibility: show.compatibility || null } };
  }
  const value = JSON.parse(fs.readFileSync(config, "utf8"));
  value.workflow = { ...(value.workflow || {}), showCode: true, askBeforeDecide: true };
  fs.writeFileSync(config, JSON.stringify(value, null, 2) + "\n");
  const beforeLegacy = lstatTree(root);
  const legacyReceipt = success(invoke(installed, root, ["rigor", "show"], isolated), "product_mismatch", "legacy rigor show");
  const legacy = parse(legacyReceipt, "product_mismatch", "legacy rigor show");
  need(legacy.rigorProfile === "max", "product_mismatch", "legacy rigor profile drifted", legacy);
  need(sameMap(legacy.rigorOverrides, {}), "product_mismatch", "legacy rigor overrides drifted", legacy);
  need(sameMap(legacy.deprecatedNoOps, { showCode: "ignored deprecated no-op", askBeforeDecide: "ignored deprecated no-op" }), "product_mismatch", "legacy no-op receipt drifted", legacy);
  need(Object.hasOwn(legacy, "compatibility") && sameMap(legacy.compatibility, { max: "Accepted for compatibility; it uses the current high rigor gates." }), "product_mismatch", "legacy compatibility drifted", legacy);
  noWrite(beforeLegacy, root, "legacy rigor show");
  return { id: CASE_IDS[5], levels, deprecatedNoOps: legacy.deprecatedNoOps, claimLimit: "no_distinct_max_behavior" };
}

function caseNewProject(installed, root, isolated) {
  initGit(root, isolated);
  const staticPaths = Object.values(STATIC_SOURCES).map((relative) => path.join(REPO, relative));
  for (const file of staticPaths) need(exists(file), "harness_failure", "bound static source is absent: " + file);
  const staticText = Object.fromEntries(Object.entries(STATIC_SOURCES).map(([key, relative]) => [key, fs.readFileSync(path.join(REPO, relative), "utf8")]));
  const init = invoke(installed, root, ["init", "--auto", "--tools", "agents"], isolated);
  success(init, "product_mismatch", "route init");
  need(!exists(path.join(root, ".work", "SPEC.md")) && !exists(path.join(root, ".work", "ROADMAP.md")), "product_mismatch", "bootstrap init created lifecycle artifacts");
  const generatedPaths = [".agents/skills/work-new-project/SKILL.md", ".agents/skills/work-new-milestone/SKILL.md", ".agents/skills/work-execute/SKILL.md", ".agents/skills/work-verify/SKILL.md", ".work/bin/gsdd.mjs"];
  const routes = generatedPaths.map((relative) => {
    const file = path.join(root, relative);
    need(exists(file), "product_mismatch", "generated route missing: " + relative);
    const value = fs.readFileSync(file, "utf8");
    need(value.trim().length > 0, "product_mismatch", "generated route empty: " + relative);
    return { route: relative, sha256: sha(Buffer.from(value)) };
  });
  const tick = String.fromCharCode(96);
  const missingBrief = "Auto mode requires a project brief. Provide one via " + tick + "npx -y workspine init --auto --tools <runtime> --brief <path>" + tick + " or place it at " + tick + ".work/PROJECT_BRIEF.md" + tick + ".";
  const runtime = fs.readFileSync(path.join(installed.packageRoot, "bin", "lib", "init-runtime.mjs"), "utf8");
  need(staticText.newProject.includes(".work/PROJECT_BRIEF.md") && staticText.newProject.includes(missingBrief) && staticText.newProject.includes("brief-driven " + tick + "SPEC.md" + tick + " and " + tick + "ROADMAP.md" + tick + " bootstrap") && staticText.newProject.includes("Do NOT auto-progress into plan, execute, verify, release, or delivery.") && runtime.includes("never chains plan, execute, verify, release, or delivery"), "product_mismatch", "new-project bootstrap markers drifted");
  need(staticText.newMilestone.includes("node .work/bin/gsdd.mjs lifecycle-preflight new-milestone") && staticText.newMilestone.includes(".work/brownfield-change/CHANGE.md") && staticText.newMilestone.includes(".work/brownfield-change/HANDOFF.md") && staticText.newMilestone.includes(".work/brownfield-change/VERIFICATION.md"), "product_mismatch", "new-milestone source markers drifted");
  need(staticText.change.includes("one active medium-scope change only") && staticText.change.includes(".work/brownfield-change/CHANGE.md") && staticText.change.includes("one shared goal") && staticText.change.includes("closeout path") && staticText.change.includes("disjoint write ownership") && staticText.change.includes("/work-new-project") && staticText.change.includes("/work-new-milestone"), "harness_failure", "brownfield CHANGE markers drifted");
  need(staticText.handoff.includes("Operational state still lives in " + tick + "CHANGE.md" + tick + ".") && staticText.handoff.includes("preserved judgment input") && staticText.handoff.includes("must not become a second status or routing authority"), "harness_failure", "brownfield HANDOFF markers drifted");
  need(staticText.verification.includes("existing proof") && staticText.verification.includes("remaining gaps") && staticText.verification.includes("Preserve already-confirmed proof"), "harness_failure", "brownfield VERIFICATION markers drifted");
  const missingBefore = lstatTree(root);
  const newMilestoneMissing = invoke(installed, root, ["lifecycle-preflight", "new-milestone"], isolated);
  need(newMilestoneMissing.exitCode === 1 && !newMilestoneMissing.timedOut && text(newMilestoneMissing, "_err") === "", "product_mismatch", "missing new-milestone preflight did not block cleanly", publicReceipt(newMilestoneMissing));
  const missing = parse(newMilestoneMissing, "product_mismatch", "missing new-milestone preflight");
  subset(missing, { surface: "new-milestone", phase: null, classification: "owned_write", ownedWrites: ["spec", "roadmap", "phase-directories"], explicitLifecycleMutation: "none", mutationRequest: "none", authority: "planning", allowed: false, status: "blocked", reason: "missing_spec" }, "missing new-milestone preflight");
  need(same(missing.blockers?.map((item) => ({ code: item.code, artifacts: item.artifacts })), [{ code: "missing_spec", artifacts: [".work/SPEC.md"] }, { code: "missing_milestones", artifacts: [".work/MILESTONES.md"] }]), "product_mismatch", "missing new-milestone blockers drifted", missing);
  noWrite(missingBefore, root, "missing new-milestone preflight");
  write(path.join(root, ".work", "SPEC.md"), "# bounded spec\n");
  write(path.join(root, ".work", "MILESTONES.md"), "# milestones\n");
  const allowedBefore = lstatTree(root);
  const allowedReceipt = success(invoke(installed, root, ["lifecycle-preflight", "new-milestone"], isolated), "product_mismatch", "allowed new-milestone preflight");
  need(text(allowedReceipt, "_err") === "", "product_mismatch", "allowed new-milestone preflight wrote stderr", publicReceipt(allowedReceipt));
  const allowed = parse(allowedReceipt, "product_mismatch", "allowed new-milestone preflight");
  subset(allowed, { surface: "new-milestone", phase: null, classification: "owned_write", ownedWrites: ["spec", "roadmap", "phase-directories"], explicitLifecycleMutation: "none", mutationRequest: "none", authority: "planning", allowed: true, status: "allowed", reason: null, blockers: [], planningState: null }, "allowed new-milestone preflight");
  noWrite(allowedBefore, root, "allowed new-milestone preflight");
  const helper = fs.readFileSync(path.join(root, ".work", "bin", "gsdd.mjs"), "utf8");
  need(helper.includes("lifecycle-preflight") && helper.includes("phase-status"), "product_mismatch", "generated helper lifecycle registrations drifted");
  const executeSkill = fs.readFileSync(path.join(root, ".agents", "skills", "work-execute", "SKILL.md"), "utf8");
  const verifySkill = fs.readFileSync(path.join(root, ".agents", "skills", "work-verify", "SKILL.md"), "utf8");
  need(executeSkill.includes("node .work/bin/gsdd.mjs phase-status") && verifySkill.includes("node .work/bin/gsdd.mjs phase-status"), "product_mismatch", "generated phase-status invocation markers drifted");
  need(!exists(path.join(root, ".work", "ROADMAP.md")), "product_mismatch", "bootstrap created ROADMAP unexpectedly");
  return { id: CASE_IDS[6], routes, staticSources: Object.fromEntries(Object.entries(STATIC_SOURCES).map(([key, relative]) => [key, { path: relative, sha256: shaFile(path.join(REPO, relative)) }])), preflight: { missing, allowed }, brownfieldRoute: "bound_static_template_contract", autoAdvance: "bootstrap_only", claimLimit: "not_interactive_or_lifecycle_wide_automation" };
}

try { main(); } catch (error) { const failure = error instanceof Failure ? error : new Failure('harness_failure', error.message, { stack: error.stack }); process.stderr.write(`${JSON.stringify({ phase: '05-07', acceptance: false, classification: failure.kind, error: failure.message, cause: failure.cause || null, cleanup: failure.cleanup || null, failureGuard: failure.failureGuard || null, nonClaims: { ...HUMAN_GATE, blind_reader: 'not_proven', native_agent: 'not_proven', interactive: 'not_proven', browser: 'not_proven' } }, null, 2)}\n`); process.exitCode = 1; }
