'use strict';

// Phase 08: one packed, disposable consumer proof.  This is an acceptance
// oracle for CLI/helper seams, not an agent/model workflow runner.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'phase08-hello-proof');
const SEED = (process.argv.find((value) => value === '--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : null) || '0801';
const SCENARIOS = ['greenfield', 'quick', 'brownfield', 'new-milestone-gate', 'repeat-greenfield', 'broken-fixture', 'cleanup'];
const LIMIT = 48 * 1024;

class Failure extends Error {
  constructor(code, message, evidence = null) { super(message); this.code = code; this.evidence = evidence; }
}
const fail = (code, message, evidence) => { throw new Failure(code, message, evidence); };
const need = (value, code, message, evidence) => { if (!value) fail(code, message, evidence); };
const exists = (file) => fs.existsSync(file);
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const shaFile = (file) => sha(fs.readFileSync(file));
const slash = (value) => value.split(path.sep).join('/');
const inside = (root, file) => { const a = path.resolve(root); const b = path.resolve(file); return b === a || b.startsWith(`${a}${path.sep}`); };
const clip = (value) => { const text = Buffer.from(value || '').toString('utf8'); return text.length > LIMIT ? `${text.slice(0, LIMIT / 2)}\n...[truncated]...\n${text.slice(-LIMIT / 2)}` : text; };
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function npmLayout(platform, execPath) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const execDir = pathApi.dirname(execPath);
  return platform === 'win32'
    ? pathApi.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : pathApi.join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
}
function resolveNpmCli() {
  const execPath = fs.realpathSync(process.execPath);
  const execDir = path.dirname(execPath);
  const trustedRoot = process.platform === 'win32' ? execDir : path.dirname(execDir);
  const layoutPath = npmLayout(process.platform, execPath);
  const rawEnv = process.env.npm_execpath;
  const rawCandidates = [
    ...(rawEnv ? [{ source: 'npm_execpath', path: rawEnv }] : []),
    { source: `${process.platform}-layout`, path: layoutPath },
  ];
  const candidates = [];
  for (const candidate of rawCandidates) {
    const value = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    const endsWithNpmCli = /[\\/]npm-cli\.js$/i.test(value);
    const absolute = value && path.isAbsolute(value);
    const present = Boolean(value && exists(value));
    if (candidate.source === 'npm_execpath' && (!endsWithNpmCli || !absolute || !present)) {
      fail('npm_resolution_failure', 'npm_execpath is not an existing absolute npm-cli.js', {
        source: candidate.source, path: value || null, ends_with_npm_cli: endsWithNpmCli, absolute: Boolean(absolute), exists: present,
      });
    }
    if (!endsWithNpmCli || !absolute || !present) {
      candidates.push({ source: candidate.source, path: value || null, exists: present, accepted: false });
      continue;
    }
    const stat = fs.lstatSync(value);
    need(stat.isFile() && !stat.isSymbolicLink(), 'npm_resolution_failure', 'npm candidate is not a regular non-link file', { source: candidate.source, path: value });
    const canonical = fs.realpathSync(value);
    need(inside(trustedRoot, canonical), 'npm_resolution_failure', 'npm candidate is outside the active Node installation', { source: candidate.source, path: canonical, trusted_root: trustedRoot });
    const row = { source: candidate.source, path: canonical, exists: true, accepted: true };
    candidates.push(row);
  }
  const accepted = candidates.filter((candidate) => candidate.accepted);
  const unique = [...new Map(accepted.map((candidate) => [process.platform === 'win32' ? candidate.path.toLowerCase() : candidate.path, candidate])).values()];
  need(unique.length === 1, 'npm_resolution_failure', unique.length === 0 ? 'no trusted npm-cli.js candidate exists' : 'npm-cli.js candidates are ambiguous', { candidates });
  return { platform: process.platform, node_exec_path: execPath, trusted_root: trustedRoot, layout_path: path.resolve(layoutPath), candidates, selected_path: unique[0].path, selected_source: unique[0].source };
}
let npmResolution = null;
let NPM = null;
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); let content = value; if (file.endsWith('.continue-here.md')) content = ['---', 'workflow: phase', 'phase: 01', 'timestamp: 2026-08-23T00:00:00.000Z', 'runtime: codex-cli', '---', '<current_state>Active.</current_state>', '<completed_work>Seeded.</completed_work>', '<remaining_work>Verify.</remaining_work>', '<decisions>Bounded.</decisions>', '<blockers>None.</blockers>', '<next_action>Verify.</next_action>', ''].join('\n'); fs.writeFileSync(file, content, { flag: 'wx' }); }
function copyTree(source, target) { fs.cpSync(source, target, { recursive: true, errorOnExist: true, dereference: false }); }
function tree(root) {
  const result = [];
  function visit(full, relative) {
    const stat = fs.lstatSync(full);
    const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    result.push({ path: slash(relative), type, bytes: type === 'file' ? stat.size : null, sha256: type === 'file' ? shaFile(full) : null });
    if (type === 'directory') for (const name of fs.readdirSync(full).sort()) visit(path.join(full, name), path.join(relative, name));
  }
  if (exists(root)) visit(root, '.');
  return result;
}
function fixtureSnapshot(root) {
  const rows = tree(root).filter((row) => row.path !== '.' && row.type === 'file');
  need(rows.length >= 5 && rows.every((row) => row.type === 'file'), 'fixture_failure', 'copied fixture is incomplete or linked');
  return rows.map(({ path: relative, bytes, sha256: digest }) => ({ path: relative, bytes, sha256: digest }));
}
function normalized(value, root) {
  if (typeof value === 'string') return value.replaceAll(root, '<ROOT>').replaceAll(REPO, '<CHECKOUT>').replaceAll(/\d{4}-\d\d-\d\dT[^" ]+/g, '<TIME>');
  if (Array.isArray(value)) return value.map((item) => normalized(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['run_id', 'elapsed_ms', 'timestamp', 'stdout_sha256'].includes(key)).map(([key, item]) => [key, normalized(item, root)]));
  return value;
}
function run(command, args, options) {
  const started = Date.now();
  const result = cp.spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: 'buffer', windowsHide: true, timeout: options.timeout || 120000, maxBuffer: 32 * 1024 * 1024 });
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  return { command, args, cwd: options.cwd, exit_code: result.status === null ? -1 : result.status, signal: result.signal || null, timed_out: Boolean(timedOut), elapsed_ms: Date.now() - started, stdout: clip(result.stdout), stderr: clip(result.stderr) };
}
function assertRun(receipt, label) { need(receipt.exit_code === 0 && !receipt.timed_out, 'consumer_failure', `${label} failed`, receipt); return receipt; }
function parseOutput(receipt, label) { try { return JSON.parse(receipt.stdout); } catch (error) { fail('consumer_failure', `${label} did not emit JSON`, { message: error.message, receipt }); } }
function envFor(root, guard) {
  const home = path.join(root, 'home'); const temp = path.join(root, 'temp'); const cache = path.join(root, 'npm-cache');
  const npmrc = path.join(root, 'npmrc'); const globalrc = path.join(root, 'npm-globalrc'); const gitconfig = path.join(root, 'gitconfig');
  for (const dir of [home, temp, cache]) fs.mkdirSync(dir, { recursive: true });
  write(npmrc, 'registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  write(globalrc, 'registry=http://127.0.0.1:9/\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\n');
  write(gitconfig, '');
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, npm_config_cache: cache, npm_config_userconfig: npmrc, npm_config_globalconfig: globalrc, npm_config_registry: 'http://127.0.0.1:9/', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: '0', WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', CI: '1', NODE_DISABLE_COMPILE_CACHE: '1', NODE_OPTIONS: `--require=${guard}` };
  for (const key of ['GSDD_WORKSPACE_ROOT', 'WORKSPINE_WORKSPACE_ROOT', 'WORKSPACE_ROOT', 'GSDD_STATE_DIR', 'WORKSPINE_STATE_DIR']) delete env[key];
  for (const key of Object.keys(env)) if (/proxy/i.test(key) && key !== 'NO_PROXY' && key !== 'no_proxy') env[key] = '';
  return { env, roots: { home, temp, cache, npmrc, globalrc, gitconfig } };
}
function makeNetworkGuard(file) {
  write(file, [
    "'use strict';",
    "const blocked = (kind) => { process.stderr.write('PHASE08_NETWORK_BLOCKED:' + kind + '\\n'); process.exitCode = 86; throw new Error('phase08 network blocked: ' + kind); };",
    "const net = require('node:net'); const tls = require('node:tls'); const dns = require('node:dns'); const http = require('node:http'); const https = require('node:https');",
    "for (const key of ['connect','createConnection']) if (typeof net[key] === 'function') net[key] = (...args) => blocked('net.' + key);",
    "for (const key of ['connect']) if (typeof tls[key] === 'function') tls[key] = (...args) => blocked('tls.' + key);",
    "for (const key of ['lookup','resolve','resolve4','resolve6','reverse']) if (typeof dns[key] === 'function') dns[key] = (...args) => blocked('dns.' + key);",
    "for (const mod of [http, https]) for (const key of ['get','request']) if (typeof mod[key] === 'function') mod[key] = (...args) => blocked('http.' + key);",
  ].join('\n') + '\n');
}
function gitSnapshot(env) {
  const output = (args) => { const result = cp.spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', windowsHide: true }); need(result.status === 0, 'containment_failure', `git ${args.join(' ')} failed`, { stderr: result.stderr }); return result.stdout; };
  return { head: output(['rev-parse', 'HEAD']).trim(), status: output(['status', '--porcelain=v1', '--untracked-files=all']), show_ref: output(['show-ref', '--head']) };
}
function protectedSnapshot() {
  const relative = 'tests/proof/phase05-concurrency.cjs';
  const file = path.join(REPO, ...relative.split('/'));
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { path: relative, type: 'missing', mode: null, bytes: null, sha256: null };
    throw error;
  }
  need(stat.isFile(), 'containment_failure', 'protected input is not a regular file', {
    path: relative,
    type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'other',
  });
  const bytes = fs.readFileSync(file);
  return { path: relative, type: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) };
}
function sourceSnapshot(env) { return { git: gitSnapshot(env), protected: protectedSnapshot() }; }
function assertConsumerGitAbsent(roots) {
  const checked = Object.fromEntries(Object.entries(roots).map(([id, root]) => [id, !tree(root).some((row) => row.path === '.git' || row.path.startsWith('.git/'))]));
  need(Object.values(checked).every(Boolean), 'containment_failure', 'consumer root contains Git state', checked);
  return checked;
}
function installSourceFixtureReadGuard() {
  const readFileSync = fs.readFileSync; const statSync = fs.statSync;
  fs.readFileSync = function guardedRead(file, ...args) { need(!inside(FIXTURE, file), 'containment_failure', 'source fixture read admitted after pack', { file: String(file) }); return readFileSync.call(this, file, ...args); };
  fs.statSync = function guardedStat(file, ...args) { need(!inside(FIXTURE, file), 'containment_failure', 'source fixture stat admitted after pack', { file: String(file) }); return statSync.call(this, file, ...args); };
}
function commandRecord(receipt, root) { return { command: path.basename(receipt.command), args: receipt.args.map((arg) => typeof arg === 'string' && inside(root, arg) ? slash(path.relative(root, arg)) : String(arg).replaceAll(REPO, '<CHECKOUT>')), cwd: inside(root, receipt.cwd) ? slash(path.relative(root, receipt.cwd) || '.') : '<CHECKOUT>', exit_code: receipt.exit_code, stdout_sha256: sha(Buffer.from(receipt.stdout)), stderr_sha256: sha(Buffer.from(receipt.stderr)) }; }
function artifact(root, relative) {
  const file = path.join(root, relative); need(inside(root, file) && exists(file), 'artifact_failure', `missing artifact ${relative}`); const bytes = fs.readFileSync(file); need(bytes.length > 8 && /[A-Za-z]{3}/.test(bytes.toString('utf8')), 'artifact_failure', `artifact ${relative} is not substantive`); return { path: slash(relative), bytes: bytes.length, sha256: sha(bytes), substantive: true };
}
function invoke(entry, cwd, args, isolated, root) {
  if (args[0] === 'init' && !args.includes('--workspace-root')) args = ['init', '--workspace-root', cwd, ...args.slice(1)];
  need(args.every((arg) => !String(arg).includes(REPO)), 'containment_failure', 'post-pack command names source checkout', { args });
  need(args.every((arg) => !String(arg).includes(FIXTURE)), 'containment_failure', 'post-pack command names source fixture', { args });
  const receipt = run(process.execPath, [entry, ...args], { cwd, env: isolated.env });
  return { ...commandRecord(receipt, root), raw: receipt };
}
function writeFixtureInputs(root, kind) {
  const base = path.join(root, '.work');
  write(path.join(base, 'SPEC.md'), '# Hello proof spec\n\nBuild small CLI.\n\nThe fixture builder writes this test input.\n');
  write(path.join(base, 'ROADMAP.md'), '# Hello proof roadmap\n\n- [ ] **Phase 01: Hello proof**\n');
  const plan = path.join(base, 'phases', '01-foundation', '01-01-PLAN.md');
  write(plan, '---\nphase: 01-foundation\nplan: 01\nstatus: pending\nbrowser_proof_required: false\nbrowser_proof_rationale: no browser\n---\n\n# Hello proof plan\n\nSubstantive fixture input.\n');
  return { plan, base, kind };
}
function rewrite(file, from, to) { const value = fs.readFileSync(file, 'utf8'); need(value.includes(from), 'fixture_failure', `cannot rewrite fixture input ${file}`); fs.writeFileSync(file, value.replace(from, to)); }
function generatedSurfaces(root) {
  return ['work-new-project', 'work-plan', 'work-execute', 'work-verify', 'work-audit-milestone'].map((name) => artifact(root, `.agents/skills/${name}/SKILL.md`));
}
function transition(entry, root, args, isolated, base) { const result = invoke(entry, root, args, isolated, base); assertRun(result.raw, args.slice(0, 2).join(' ')); const packet = parseOutput(result.raw, args.slice(0, 2).join(' ')); if (typeof packet.state !== 'string') packet.state = packet.current_state || packet.state?.current_state; if (packet.current_state === undefined) packet.current_state = packet.state; const { raw, ...bounded } = result; return { ...bounded, packet }; }
function installCandidate(root, pack) {
  write(path.join(root, 'package.json'), '{"name":"phase08-consumer","private":true}\n');
  const guard = path.join(root, 'network-guard.cjs'); makeNetworkGuard(guard); const isolated = envFor(root, guard);
  const result = run(process.execPath, [NPM, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-save', pack.tarball], { cwd: root, env: isolated.env });
  assertRun(result, 'npm install');
  const packageRoot = path.join(root, 'node_modules', pack.package);
  const entry = path.join(packageRoot, 'bin', 'gsdd.mjs'); need(exists(entry) && inside(root, entry), 'candidate_identity_failure', 'installed entry missing or escaped');
  return { entry, packageRoot, isolated, install: commandRecord(result, root), installed_package_sha256: shaFile(path.join(packageRoot, 'package.json')), installed_entry_sha256: shaFile(entry) };
}
function packCandidate(root, sourceBefore) {
  const packRoot = path.join(root, 'pack'); fs.mkdirSync(packRoot, { recursive: true }); const guard = path.join(root, 'pack-network-guard.cjs'); makeNetworkGuard(guard); const isolated = envFor(root, guard);
  const result = run(process.execPath, [NPM, 'pack', '--ignore-scripts', '--offline', '--pack-destination', packRoot, '--json'], { cwd: REPO, env: isolated.env }); assertRun(result, 'npm pack'); const packet = parseOutput(result, 'npm pack'); need(Array.isArray(packet) && packet.length === 1 && path.basename(packet[0].filename) === packet[0].filename, 'candidate_identity_failure', 'npm pack JSON drifted'); const tarball = path.join(packRoot, packet[0].filename); need(exists(tarball) && inside(packRoot, tarball), 'candidate_identity_failure', 'pack tarball missing or escaped'); return { package: sourceBefore.package, version: sourceBefore.version, tarball, pack_sha256: shaFile(tarball), pack: commandRecord(result, root) };
}
function sourceIdentity() { const meta = json(path.join(REPO, 'package.json')); const snapshot = sourceSnapshot(process.env); return { package: meta.name, version: meta.version, head: snapshot.git.head, protected: snapshot.protected, git: snapshot.git }; }
function greenfield(root, pack, seed) {
  const copied = path.join(root, 'fixture'); const sourceBefore = fixtureSnapshot(copied); const candidate = installCandidate(root, pack); const base = root;
  const init = invoke(candidate.entry, root, ['init', '--auto', '--tools', 'claude', '--brief', path.join(copied, 'brief.md'), '--no-update-notice'], candidate.isolated, root); assertRun(init.raw, 'init');
  need(exists(path.join(root, '.work')) && !exists(path.join(root, '.planning')) && exists(path.join(root, '.work', 'bin', 'gsdd.mjs')), 'product_mismatch', 'init did not create one .work root and generated helper', { expected_root: root, root_names: fs.readdirSync(root), cwd_probe: run(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: root, env: candidate.isolated.env }), init: init.raw, work_tree: tree(root).filter((item) => item.path.startsWith('.work')).slice(0, 120) });
  const surfaces = generatedSurfaces(root); const health = invoke(candidate.entry, root, ['health', '--json', '--no-update-notice'], candidate.isolated, root); assertRun(health.raw, 'health'); const healthPacket = parseOutput(health.raw, 'health'); need(healthPacket.status === 'healthy', 'product_mismatch', 'health is not healthy', healthPacket);
  const appDefault = run(process.execPath, ['index.js'], { cwd: copied, env: candidate.isolated.env }); const appNamed = run(process.execPath, ['index.js', '--name', 'Ada'], { cwd: copied, env: candidate.isolated.env }); const appTest = run(process.execPath, [NPM, 'test', '--offline'], { cwd: copied, env: candidate.isolated.env }); assertRun(appDefault, 'fixture default'); assertRun(appNamed, 'fixture named'); assertRun(appTest, 'fixture test'); need(appDefault.stdout === 'Hello, world!\n' && appNamed.stdout === 'Hello, Ada!\n', 'fixture_failure', 'fixture greeting output drifted');
  const inputs = writeFixtureInputs(root, 'greenfield'); const planRel = '.work/phases/01-foundation/01-01-PLAN.md';
  const planPacket = transition(candidate.entry, root, ['lifecycle-transition', 'plan', '--plan', planRel, '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(planPacket.packet.current_state === 'plan', 'lifecycle_contract_failure', 'greenfield plan state drifted', planPacket.packet); const approvalPacket = transition(candidate.entry, root, ['lifecycle-transition', 'approve', '--plan', planRel, '--authority', 'owner', '--approval-ref', 'phase08-fixture', '--json', '--no-update-notice'], candidate.isolated, root); need(approvalPacket.packet.current_state === 'plan', 'lifecycle_contract_failure', 'greenfield approval state drifted', approvalPacket.packet); const executePacket = transition(candidate.entry, root, ['lifecycle-transition', 'execute', '--plan', planRel, '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(executePacket.packet.current_state === 'execute', 'lifecycle_contract_failure', 'greenfield execute state drifted', executePacket.packet);
  const summaryRel = '.work/phases/01-foundation/01-01-SUMMARY.md'; write(path.join(root, summaryRel), '---\nphase: 01-foundation\nplan: 01\nstatus: complete\n---\n\n# Summary\n\nFixture inputs complete.\n'); const verifyPacket = transition(candidate.entry, root, ['lifecycle-transition', 'verify', '--plan', planRel, '--artifact', summaryRel, '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(verifyPacket.packet.current_state === 'verify', 'lifecycle_contract_failure', 'greenfield verify state drifted', verifyPacket.packet);
  const verificationRel = '.work/phases/01-foundation/01-01-VERIFICATION.md'; write(path.join(root, verificationRel), '---\nphase: 01-foundation\nstatus: passed\n---\n\n# Verification\n\nPassed.\n'); const auditPacket = transition(candidate.entry, root, ['lifecycle-transition', 'audit', '--plan', planRel, '--artifact', verificationRel, '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(auditPacket.packet.current_state === 'audit', 'lifecycle_contract_failure', 'greenfield audit state drifted', auditPacket.packet);
  const auditRel = '.work/milestone/AUDIT.md'; write(path.join(root, auditRel), '---\nstatus: passed\n---\n\n# Audit\n\nPassed.\n'); const next = transition(candidate.entry, root, ['next', '--json', '--no-update-notice'], candidate.isolated, root); need(next.packet.state === 'dogfood' && next.packet.route_kind === 'dogfood' && next.packet.reason === 'Workspine-native `.work/milestone` audit passed and no dogfood finding has been captured.', 'lifecycle_contract_failure', 'greenfield next route is not artifact-backed dogfood', next.packet);
  const artifacts = [artifact(root, '.work/SPEC.md'), artifact(root, '.work/ROADMAP.md'), artifact(root, planRel), artifact(root, summaryRel), artifact(root, verificationRel), artifact(root, auditRel)];
  return { scenario_id: seed === 'repeat' ? 'repeat-greenfield' : 'greenfield', claim: 'packed_cli_helper_lifecycle_mechanics_only', fixture_input_hashes: sourceBefore, init: { ...init, raw: undefined }, health: { command: { ...health, raw: undefined }, status: healthPacket.status }, generated_surfaces: surfaces, fixture: { default: appDefault.stdout, named: appNamed.stdout, test: appTest.stdout }, new_project_contract: { claim: 'generated_workflow_contract_only', surfaces: surfaces.map((item) => item.path) }, transitions: [planPacket, approvalPacket, executePacket, verifyPacket, auditPacket], next: { state: next.packet.state, route_kind: next.packet.route_kind, next_action: next.packet.next_action || next.packet.next_command || null }, artifacts, cleanup_input_hashes: fixtureSnapshot(copied), candidate: { ...pack, installed_package_sha256: candidate.installed_package_sha256, installed_entry_sha256: candidate.installed_entry_sha256 }, claim_limit: 'No model, agent, workflow text, or arbitrary-CWD claim.' };
}
function quick(root, pack) {
  const copied = path.join(root, 'fixture'); const candidate = installCandidate(root, pack); const init = invoke(candidate.entry, root, ['init', '--auto', '--tools', 'claude', '--no-update-notice'], candidate.isolated, root); assertRun(init.raw, 'quick init'); const skills = ['work-quick', 'work-progress', 'work-resume'].map((name) => artifact(root, `.agents/skills/${name}/SKILL.md`)); writeFixtureInputs(root, 'quick'); const quickBase = path.join(root, '.work', 'quick', '001-hello-proof'); write(path.join(quickBase, '001-PLAN.md'), '# Quick plan\n\nSubstantive test input.\n'); write(path.join(quickBase, '001-SUMMARY.md'), '---\nstatus: complete\n---\n# Quick summary\n'); write(path.join(quickBase, '001-VERIFICATION.md'), '---\nstatus: passed\n---\n# Quick verification\n'); write(path.join(root, '.work', 'quick', 'LOG.md'), '# Quick log\n\npassed\n'); const progress = transition(candidate.entry, root, ['lifecycle-preflight', 'progress', '--json', '--no-update-notice'], candidate.isolated, root); const next = transition(candidate.entry, root, ['next', '--json', '--no-update-notice'], candidate.isolated, root); need(progress.packet.allowed === true && next.packet.state === 'plan' && next.packet.route_kind === 'work_native_plan', 'quick_contract_failure', 'Quick route contract drifted', { progress: progress.packet, next: next.packet }); return { scenario_id: 'quick', claim: 'workflow_contract_plus_persisted_artifact_readback_only', generated_skills: skills, artifacts: [artifact(root, '.work/quick/001-hello-proof/001-PLAN.md'), artifact(root, '.work/quick/001-hello-proof/001-SUMMARY.md'), artifact(root, '.work/quick/001-hello-proof/001-VERIFICATION.md'), artifact(root, '.work/quick/LOG.md')], progress: progress.packet, next: { state: next.packet.state, route_kind: next.packet.route_kind, next_action: next.packet.next_action || null }, claim_limit: 'No Quick workflow or model execution claim.' };
}
function brownfield(root, pack) {
  const candidate = installCandidate(root, pack); const init = invoke(candidate.entry, root, ['init', '--auto', '--tools', 'claude', '--no-update-notice'], candidate.isolated, root); assertRun(init.raw, 'brownfield init'); const base = path.join(root, '.work', 'brownfield-change'); write(path.join(base, 'CHANGE.md'), ['---', 'change: CHANGE-PHASE08', 'status: active', '---', '', '# Brownfield Change: Phase08 proof', '', '## Goal', 'Prove one bounded brownfield route.', '', '## In Scope', '- The disposable Phase08 consumer root.', '', '## Out of Scope', '- Roadmap membership and independent streams.', '', '## Done When', '- The bounded stream has passing evidence.', '', '## Current Status', '- Current posture: active', '- Current branch / integration surface: disposable proof', '- Current owner / runtime: phase08 runner', '', '## Next Action', '- Execute the bounded change.', '', '## PR Slice Ownership', '| Slice | Scope | Owned files / modules | Status |', '| --- | --- | --- | --- |', '| A | bounded proof | disposable consumer | active |', '', '## Closeout Path', '1. Record evidence in VERIFICATION.md.', '2. Set CHANGE.md to closed after passed verification.', ''].join('\n')); write(path.join(base, 'HANDOFF.md'), '# Handoff\n\n## Judgment\nBounded proof.\n'); write(path.join(base, 'VERIFICATION.md'), '---\nstatus: complete\n---\n\n# Verification\n\nComplete.\n'); write(path.join(root, '.work', '.continue-here.md'), ['---', 'workflow: brownfield', 'phase: brownfield-change', 'timestamp: 2026-08-23T00:00:00.000Z', 'runtime: codex-cli', '---', '', '<current_state>', 'Active.', '</current_state>', '', '<completed_work>', 'Seeded.', '</completed_work>', '', '<remaining_work>', 'Verify.', '</remaining_work>', '', '<decisions>', 'Bounded.', '</decisions>', '', '<blockers>', 'None.', '</blockers>', '', '<next_action>', 'Verify.', '</next_action>', ''].join('\n'));
  const progress = transition(candidate.entry, root, ['lifecycle-preflight', 'progress', '--json', '--no-update-notice'], candidate.isolated, root); const resume = transition(candidate.entry, root, ['lifecycle-preflight', 'resume', '--json', '--no-update-notice'], candidate.isolated, root); need(progress.packet.allowed === true && resume.packet.allowed === true, 'brownfield_contract_failure', 'brownfield preflight route rejected', { progress: progress.packet, resume: resume.packet }); const planRel = '.work/brownfield-change/CHANGE.md'; const planned = transition(candidate.entry, root, ['lifecycle-transition', 'plan', '--plan', planRel, '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); const approved = transition(candidate.entry, root, ['lifecycle-transition', 'approve', '--plan', planRel, '--approval-ref', 'phase08-brownfield-owner', '--authority', 'owner', '--json', '--no-update-notice'], candidate.isolated, root); const executed = transition(candidate.entry, root, ['lifecycle-transition', 'execute', '--plan', planRel, '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(planned.packet.state === 'plan' && approved.packet.state === 'plan' && executed.packet.state === 'execute', 'brownfield_contract_failure', 'brownfield plan/approve/execute state drifted', { planned: planned.packet, approved: approved.packet, executed: executed.packet }); rewrite(path.join(root, planRel), 'Current posture: active', 'Current posture: ready_for_verification'); const verify = transition(candidate.entry, root, ['next', '--json', '--no-update-notice'], candidate.isolated, root); need(verify.packet.state === 'verify' && verify.packet.route_kind === 'brownfield_change_verification', 'brownfield_contract_failure', 'brownfield verify route drifted', verify.packet); const verified = transition(candidate.entry, root, ['lifecycle-transition', 'verify', '--plan', planRel, '--artifact', '.work/brownfield-change/VERIFICATION.md', '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(verified.packet.state === 'verify', 'brownfield_contract_failure', 'brownfield verify state drifted', verified.packet); rewrite(path.join(root, '.work/brownfield-change/VERIFICATION.md'), 'status: complete', 'status: passed'); const audited = transition(candidate.entry, root, ['lifecycle-transition', 'audit', '--plan', planRel, '--artifact', '.work/brownfield-change/VERIFICATION.md', '--authority', 'workflow', '--json', '--no-update-notice'], candidate.isolated, root); need(audited.packet.state === 'audit', 'brownfield_contract_failure', 'brownfield audit state drifted', audited.packet); rewrite(path.join(root, planRel), 'Current posture: ready_for_verification', 'Current posture: closed'); const closed = transition(candidate.entry, root, ['next', '--json', '--no-update-notice'], candidate.isolated, root); need(closed.packet.state === 'complete' && closed.packet.route_kind === 'brownfield_change_closed' && closed.packet.next_command === null, 'brownfield_contract_failure', 'brownfield close route drifted', closed.packet); return { scenario_id: 'brownfield', claim: 'packed_brownfield_route_and_close_contract_only', states: [planned.packet.state, approved.packet.state, executed.packet.state, verify.packet.state, verified.packet.state, audited.packet.state, closed.packet.state], route_kinds: [verify.packet.route_kind, closed.packet.route_kind], progress: progress.packet, resume: resume.packet, artifacts: [artifact(root, planRel), artifact(root, '.work/brownfield-change/HANDOFF.md'), artifact(root, '.work/brownfield-change/VERIFICATION.md'), artifact(root, '.work/.continue-here.md')], claim_limit: 'No model-driven resume or progress claim.' };
}
function newMilestone(root, pack) { const candidate = installCandidate(root, pack); const init = invoke(candidate.entry, root, ['init', '--auto', '--tools', 'claude', '--no-update-notice'], candidate.isolated, root); assertRun(init.raw, 'new milestone init'); const milestones = path.join(root, 'MILESTONES.md'); const history = [path.join(root, '.work', 'milestone', 'AUDIT.md'), path.join(root, '.work', 'milestone', 'archive')]; const hasHistory = exists(milestones) && history.some(exists); need(!hasHistory, 'history_contract_failure', 'fixture unexpectedly manufactured milestone history', { milestones, history }); return { scenario_id: 'new-milestone-gate', status: 'not_run', reason: 'missing_history_contract', inspected: { milestones: slash(path.relative(root, milestones)), matching_audit_or_archive: history.map((file) => ({ path: slash(path.relative(root, file)), exists: exists(file) })) }, claim: 'No shipped milestone history was fabricated.' }; }
function broken(root, pack) {
  const copied = path.join(root, 'fixture'); const target = path.join(copied, 'index.js'); const before = fixtureSnapshot(copied); const original = fs.readFileSync(target, 'utf8'); fs.writeFileSync(target, original.replace('Hello, ${name}!', 'Hello, wrong!'));
  const after = fixtureSnapshot(copied); need(after.find((row) => row.path === 'index.js').sha256 !== before.find((row) => row.path === 'index.js').sha256, 'fixture_failure', 'broken fixture mutation did not change hash'); const candidate = installCandidate(root, pack); const output = run(process.execPath, ['index.js', '--name', 'Ada'], { cwd: copied, env: candidate.isolated.env }); need(output.exit_code === 0 && !output.timed_out && output.signal === null, 'fixture_runner_failure', 'broken fixture runner did not execute successfully', output); const expectedOutput = 'Hello, wrong!\n'; need(output.stdout === expectedOutput && output.stderr === '', 'fixture_named_greeting_mismatch', 'broken fixture oracle output drifted', { expected_stdout: expectedOutput, output }); const failure = { code: 'fixture_named_greeting_mismatch', message: 'named greeting oracle rejected broken fixture' }; const terminal = { record_type: 'terminal', scope: 'broken-fixture', status: 'failed', failure, success_terminal: false }; return { scenario_id: 'broken-fixture', status: 'failed', failure, nested_terminal: terminal, no_success_terminal: terminal.success_terminal === false, output: output.stdout, fixture_hash_before: before, fixture_hash_after: after };
}
function removeRoot(root) { const temp = path.resolve(os.tmpdir()); const absolute = path.resolve(root); need(inside(temp, absolute) && path.basename(absolute).startsWith('gsdd-phase08-flow-eval-'), 'cleanup_failure', 'unsafe cleanup target', { absolute, temp }); fs.rmSync(absolute, { recursive: true, force: false, maxRetries: 10, retryDelay: 100 }); need(!exists(absolute), 'cleanup_failure', 'disposable root survived cleanup'); return { target: absolute, removed: true };
}
function main() {
  const runId = `phase08-${Date.now()}-${process.pid}`; const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-phase08-flow-eval-')); let cleanup = null; const records = []; const emit = (record) => { const value = { schema_version: 1, run_id: runId, seed: SEED, ...record }; records.push(value); process.stdout.write(`${JSON.stringify(value)}\n`); };
  try {
    npmResolution = resolveNpmCli(); NPM = npmResolution.selected_path;
    const identity = sourceIdentity(); const protectedBefore = identity.protected; const gitBefore = identity.git; const roots = {};
    for (const id of ['greenfield', 'quick', 'brownfield', 'new-milestone-gate', 'repeat-greenfield', 'broken-fixture']) { roots[id] = path.join(root, id); fs.mkdirSync(roots[id], { recursive: true }); copyTree(FIXTURE, path.join(roots[id], 'fixture')); roots[id] = roots[id]; }
    const fixtureHashes = Object.fromEntries(Object.entries(roots).map(([id, value]) => [id, fixtureSnapshot(path.join(value, 'fixture'))]));
    const pack = packCandidate(root, identity); const sourceAfterPack = sourceSnapshot(process.env); need(JSON.stringify(sourceAfterPack) === JSON.stringify({ git: gitBefore, protected: protectedBefore }), 'containment_failure', 'source changed during pack', { before: { git: gitBefore, protected: protectedBefore }, after: sourceAfterPack }); installSourceFixtureReadGuard(); emit({ record_type: 'setup', scenario_id: 'setup', npm_cli: npmResolution, candidate: { package: identity.package, version: identity.version, pack_sha256: pack.pack_sha256 }, fixture: { copied_before_pack: true, hashes: fixtureHashes }, network_guard: { proxies_removed: true, registry: 'http://127.0.0.1:9/', attempted: false, blocked: true }, scriptsDisabled: true, git: { mode: 'unused', before: gitBefore, after_pack: sourceAfterPack.git }, protected: { before: protectedBefore, after_pack: sourceAfterPack.protected }, source_read_admission: { fixture: 'pre-copied-and-hashed-before-pack', post_pack_fixture_reads: 'forbidden' } });
    const green = greenfield(roots.greenfield, pack, 'green'); emit({ record_type: 'scenario', ...green });
    const quickResult = quick(roots.quick, pack); emit({ record_type: 'scenario', ...quickResult });
    const brown = brownfield(roots.brownfield, pack); emit({ record_type: 'scenario', ...brown });
    const milestone = newMilestone(roots['new-milestone-gate'], pack); emit({ record_type: 'scenario', ...milestone });
    const repeat = greenfield(roots['repeat-greenfield'], pack, 'repeat'); emit({ record_type: 'scenario', ...repeat });
    need(JSON.stringify(normalized({ ...green, scenario_id: 'greenfield' }, roots.greenfield)) === JSON.stringify(normalized({ ...repeat, scenario_id: 'greenfield' }, roots['repeat-greenfield'])), 'repeatability_failure', 'same-seed green receipts drifted'); emit({ record_type: 'scenario', scenario_id: 'repeat-greenfield', status: 'passed', normalized_equal: true });
    const brokenResult = broken(roots['broken-fixture'], pack); need(brokenResult.nested_terminal.record_type === 'terminal' && brokenResult.nested_terminal.status === 'failed' && brokenResult.nested_terminal.success_terminal === false, 'negative_contract_failure', 'broken fixture did not produce an asserted failed nested terminal', brokenResult); emit({ record_type: 'terminal', scope: 'nested', ...brokenResult.nested_terminal }); emit({ record_type: 'scenario', ...brokenResult });
    const consumerGit = assertConsumerGitAbsent(roots); need(JSON.stringify(gitBefore) === JSON.stringify(gitSnapshot(process.env)), 'containment_failure', 'host Git snapshot changed'); need(JSON.stringify(protectedBefore) === JSON.stringify(protectedSnapshot()), 'containment_failure', 'protected proof changed');
    cleanup = removeRoot(root); const sourceAfterCleanup = sourceSnapshot(process.env); need(JSON.stringify(sourceAfterCleanup) === JSON.stringify({ git: gitBefore, protected: protectedBefore }), 'containment_failure', 'source changed after cleanup', { before: { git: gitBefore, protected: protectedBefore }, after: sourceAfterCleanup }); emit({ record_type: 'scenario', scenario_id: 'cleanup', cleanup }); emit({ record_type: 'terminal', status: 'passed', candidate: { package: identity.package, version: identity.version, pack_sha256: pack.pack_sha256 }, cleanup, containment: { git_unchanged: true, protected_unchanged: true, source_snapshots: { before_pack: { git: gitBefore, protected: protectedBefore }, after_pack: sourceAfterPack, after_cleanup: sourceAfterCleanup }, source_read_admission: { fixture_pre_copied: true, post_pack_fixture_reads: 0, command_source_args_rejected: true }, consumer_git_absent: consumerGit }, failure: null });
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure('harness_failure', error.message, { stack: error.stack });
    let cleanupError = null; try { if (exists(root)) cleanup = removeRoot(root); } catch (cleanupFailure) { cleanupError = { code: cleanupFailure.code || 'cleanup_failure', message: cleanupFailure.message }; }
    emit({ record_type: 'terminal', status: 'failed', failure: { code: cleanupError ? 'cleanup_failure' : failure.code, message: cleanupError ? cleanupError.message : failure.message, cause: failure.evidence || null }, cleanup: cleanup || cleanupError }); process.exitCode = 1;
  }
}
main();
