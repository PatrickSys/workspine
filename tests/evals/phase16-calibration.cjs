// Offline calibration for the admitted Phase 16 core task cells.
//
// This command verifies a sealed input packet, then runs the packet's independent
// native oracles in fresh temporary roots. Provider, browser, network, and .work
// state are never consulted. The retained Docusaurus row remains pending until its own slice.

'use strict';

const crypto = require('node:crypto');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const DEFAULT_CASES = path.join(REPO, 'tests', 'evals', 'phase16-calibration-cases.json');
const DEFAULT_ROOT = path.join(REPO, '.work', 'phases', '16-safe-cohesive-first-run', '16-05-calibration-inputs');
const CAMPAIGN = path.join(REPO, 'tests', 'evals', 'phase16-core-flows.json');
const CONTRACT = 'phase16-calibration.v1';
const APPROVAL = '16-05 owner approval 2026-08-26';
const CORE_IDS = Object.freeze(['treesnap-greenfield', 'itsdangerous-fips-sha1', 'chi-bodyless-charset']);
const AUX_IDS = Object.freeze(['packed-readme-install', 'scripted-owner-broker', 'docusaurus-browser']);
const ADMITTED_IDS = Object.freeze([...CORE_IDS, 'packed-readme-install', 'scripted-owner-broker']);
const CASE_IDS = Object.freeze([...CORE_IDS, ...AUX_IDS]);
const HASH = /^[0-9a-f]{64}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;
const args = process.argv.slice(2);

class CalibrationFailure extends Error {
  constructor(code, message, evidence = null) { super(message); this.code = code; this.evidence = evidence; }
}
function fail(code, message, evidence = null) { throw new CalibrationFailure(code, message, evidence); }
function need(value, code, message, evidence = null) { if (!value) fail(code, message, evidence); }
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(Buffer.from(stable(value), 'utf8')).digest('hex').toUpperCase(); }
function fileDigest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function arg(name, fallback = null) { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] || fallback || '') : fallback; }
function flag(...names) { return names.some((name) => args.includes(name)); }
function slash(value) { return String(value).split(path.sep).join('/'); }
function readJson(file, label) {
  need(fs.existsSync(file), 'missing_input', label + ' is missing', { path: slash(file) });
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail('invalid_json', label + ' is not valid JSON', { path: slash(file), message: error.message }); }
}
function resolveRelative(root, value, label) {
  need(typeof value === 'string' && value.length > 0 && !path.isAbsolute(value), 'portable_path_invalid', label + ' must be relative to --calibration-root', { value });
  const base = path.resolve(root); const full = path.resolve(base, value);
  need(full === base || full.startsWith(base + path.sep), 'artifact_path_escape', label + ' escapes --calibration-root', { value });
  return full;
}
function checkHash(value, label) { need(typeof value === 'string' && HASH.test(value), 'pin_invalid', label + ' must be a SHA-256 hash', { value }); }
function checkCommit(value, label) { need(typeof value === 'string' && COMMIT.test(value) && !/^0+$/.test(value), 'pin_invalid', label + ' must be a non-zero Git commit', { value }); }
function verifyFile(file, expected, label) {
  need(fs.existsSync(file), 'missing_input', label + ' is missing', { path: slash(file) }); checkHash(expected, label + ' hash');
  const actual = fileDigest(file);
  need(actual === expected.toUpperCase(), 'artifact_hash_mismatch', label + ' bytes do not match the declared hash', { path: slash(file), expected: expected.toUpperCase(), actual });
  return actual;
}
function verifyManifest(root, descriptor, label) {
  const file = resolveRelative(root, descriptor.path, label + ' manifest'); verifyFile(file, descriptor.sha256, label + ' manifest');
  const manifest = readJson(file, label + ' manifest');
  for (const entry of manifest.files || []) {
    const item = resolveRelative(root, path.join(path.dirname(descriptor.path), entry.path), label + ' manifest entry');
    verifyFile(item, entry.sha256, label + ' ' + entry.path);
    if (entry.bytes !== undefined) need(fs.statSync(item).size === entry.bytes, 'artifact_size_mismatch', label + ' ' + entry.path + ' size drifted');
  }
  for (const entry of manifest.materialized || []) {
    const item = resolveRelative(root, path.join(path.dirname(descriptor.path), entry.path), label + ' materialized entry');
    if (!fs.existsSync(item)) {
      if (entry.target) {
        const target = path.resolve(path.dirname(item), entry.target);
        need(fs.existsSync(target), 'missing_input', label + ' materialized symlink target is missing', { path: slash(target) });
        need(crypto.createHash('sha256').update(entry.target, 'utf8').digest('hex').toUpperCase() === entry.target_sha256.toUpperCase(), 'materialized_target_mismatch', label + ' materialized target pin drifted');
      } else {
        const encoded = item + '.b64';
        need(fs.existsSync(encoded), 'missing_input', label + ' materialized entry and its encoded source are missing', { path: slash(item) });
        const bytes = Buffer.from(fs.readFileSync(encoded, 'utf8').trim(), 'base64');
        need(bytes.length === entry.bytes && crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase() === entry.sha256.toUpperCase(), 'materialized_hash_mismatch', label + ' materialized bytes drifted', { path: slash(encoded) });
      }
      continue;
    }
    if (entry.target) { const stat = fs.lstatSync(item); need(stat.isSymbolicLink(), 'materialized_type_mismatch', label + ' materialized link is not a symlink'); need(fs.readlinkSync(item).replaceAll('\\', '/') === entry.target, 'materialized_target_mismatch', label + ' symlink target drifted'); }
    else verifyFile(item, entry.sha256, label + ' ' + entry.path);
  }
  return { file, manifest };
}
function resolveManifestEntry(root, descriptor, value, label) {
  need(typeof value === 'string' && value.length > 0 && !path.isAbsolute(value), 'portable_path_invalid', label + ' must be relative');
  const full = path.resolve(root, path.dirname(descriptor.path), value);
  const boundary = path.dirname(path.resolve(root));
  need(full === boundary || full.startsWith(boundary + path.sep), 'artifact_path_escape', label + ' escapes the sealed calibration packet', { value });
  return full;
}
function tarMembers(file, label) {
  const result = run('tar', ['-tzf', file], { timeout: 120000 });
  need(result.status === 0, 'archive_invalid', label + ' member listing failed', { stderr: String(result.stderr || '').slice(-2000) });
  return String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).sort();
}
function verifyPacked(item, root) {
  const descriptor = item.manifest;
  const manifestFile = resolveRelative(root, descriptor.path, item.id + ' manifest');
  verifyFile(manifestFile, descriptor.sha256, item.id + ' manifest');
  const manifest = readJson(manifestFile, item.id + ' manifest');
  need(manifest.schema_version === 'packed-readme-calibration-manifest.v1', 'manifest_contract_invalid', item.id + ' manifest schema drifted');
  need(manifest.baseline?.commit === '4949d4ae1413d4809a08acee72760b91560d6c0a', 'source_pin_invalid', item.id + ' baseline commit drifted');
  need(manifest.reference?.commit === 'a7f9e92f555c4e5ee1334b953c4e8806f28abf11', 'source_pin_invalid', item.id + ' reference commit drifted');
  need(manifest.runtimes?.node === process.version, 'runtime_version_mismatch', item.id + ' Node version drifted', { expected: manifest.runtimes?.node, actual: process.version });
  verifyFile(process.execPath, manifest.runtimes.node_exec_sha256, item.id + ' Node runtime');
  need(typeof manifest.runtimes.npm === 'string' && manifest.runtimes.npm.length > 0, 'runtime_invalid', item.id + ' npm runtime pin is missing');
  for (const archive of manifest.tarballs || []) {
    const file = resolveRelative(root, path.join(path.dirname(descriptor.path), archive.name), item.id + ' ' + archive.name);
    verifyFile(file, archive.sha256, item.id + ' ' + archive.name);
    const members = tarMembers(file, item.id + ' ' + archive.name);
    need(stable(members) === stable(archive.members), 'archive_membership_mismatch', item.id + ' ' + archive.name + ' members drifted');
    need(crypto.createHash('sha256').update(members.join('\n') + '\n', 'utf8').digest('hex').toUpperCase() === archive.member_list_sha256.toUpperCase(), 'archive_membership_hash_mismatch', item.id + ' ' + archive.name + ' member hash drifted');
  }
  for (const oracle of manifest.oracle || []) verifyFile(resolveRelative(root, path.join(path.dirname(descriptor.path), oracle.path), item.id + ' oracle'), oracle.sha256, item.id + ' ' + oracle.path);
  for (const input of manifest.inputs || []) verifyFile(resolveManifestEntry(root, descriptor, input.path, item.id + ' input'), input.sha256, item.id + ' ' + input.path);
  for (const source of manifest.source_manifests || []) {
    need(Array.isArray(source.files) && source.files.length > 0, 'manifest_contract_invalid', item.id + ' source manifest is empty');
    for (const entry of source.files) verifyFile(resolveRelative(root, path.join(path.dirname(descriptor.path), source.label, entry.path), item.id + ' ' + source.label + '/' + entry.path), entry.sha256, item.id + ' ' + source.label + '/' + entry.path);
    need(typeof source.manifest_sha256 === 'string' && source.manifest_sha256.length === 64, 'manifest_contract_invalid', item.id + ' source manifest hash is missing');
    need(crypto.createHash('sha256').update(JSON.stringify(source.files)).digest('hex').toUpperCase() === source.manifest_sha256.toUpperCase(), 'manifest_hash_mismatch', item.id + ' source manifest hash drifted');
  }
  for (const run of manifest.runs || []) {
    need(typeof run.label === 'string' && /^[a-z0-9-]+$/.test(run.label), 'manifest_contract_invalid', item.id + ' run label invalid');
    verifyFile(resolveRelative(root, path.join(path.dirname(descriptor.path), 'runs', run.label, 'receipt.json'), item.id + ' ' + run.label + ' receipt'), run.receipt_sha256, item.id + ' ' + run.label + ' receipt');
  }
  return { manifest, oracle: resolveRelative(root, path.join(path.dirname(descriptor.path), manifest.oracle[0].path), item.id + ' oracle'), networkGuard: resolveRelative(root, path.join(path.dirname(descriptor.path), 'oracle', 'network-guard.cjs'), item.id + ' network guard') };
}
function verifyScripted(item, root) {
  const descriptor = item.manifest;
  const manifestFile = resolveRelative(root, descriptor.path, item.id + ' manifest');
  verifyFile(manifestFile, descriptor.sha256, item.id + ' manifest');
  const manifest = readJson(manifestFile, item.id + ' manifest');
  need(manifest.contract === 'phase16-scripted-owner.v1' && manifest.provider_invoked === false && manifest.browser_invoked === false && manifest.network_invoked === false, 'manifest_contract_invalid', item.id + ' manifest is not offline-only');
  const packet = path.dirname(descriptor.path);
  const packageFile = resolveRelative(root, path.join(packet, manifest.package.path), item.id + ' package'); verifyFile(packageFile, manifest.package.sha256, item.id + ' package');
  verifyFile(process.execPath, manifest.runtime.sha256, item.id + ' Node runtime');
  const oracle = resolveRelative(root, path.join(packet, manifest.oracle.path), item.id + ' oracle'); verifyFile(oracle, manifest.oracle.sha256, item.id + ' oracle');
  for (const fixture of manifest.fixtures || []) verifyFile(resolveRelative(root, path.join(packet, fixture.path), item.id + ' ' + fixture.path), fixture.sha256, item.id + ' ' + fixture.path);
  return { manifest, packageFile, oracle, networkGuard: resolveRelative(root, 'packed-readme/oracle/network-guard.cjs', item.id + ' network guard') };
}
function isolatedEnv(root, networkGuard) {
  const home = path.join(root, 'home'); const temp = path.join(root, 'temp'); const cache = path.join(root, 'npm-cache');
  for (const dir of [home, temp, cache]) fs.mkdirSync(dir, { recursive: true });
  return { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: temp, TMP: temp, npm_config_cache: cache, npm_config_userconfig: path.join(home, '.npmrc'), npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:9/', WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', NO_COLOR: '1', WORKSPINE_NETWORK_GUARD_LOG: path.join(root, 'network-attempts.log'), NODE_OPTIONS: `--require=${networkGuard}` };
}
function executePacked(item, root, prepared, repetition) {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-packed-'));
  const baseline = item.variants.find((variant) => variant.id === 'baseline');
  const reference = item.variants.find((variant) => variant.id === 'reference');
  const rows = [];
  try {
    for (const variant of [baseline, reference]) {
      const archive = prepared.manifest.tarballs.find((entry) => (variant.id === 'baseline' ? entry.name.startsWith('baseline-') : entry.name.startsWith('reference-')));
      const variantRoot = path.join(outputRoot, variant.id);
      const result = run(process.execPath, [prepared.oracle, '--artifact', resolveRelative(root, path.join(path.dirname(item.manifest.path), archive.name), item.id + ' archive'), '--output', variantRoot, '--source-checkout', REPO, '--label', `${variant.id}-${repetition}`, ...(variant.id === 'baseline' ? ['--baseline'] : [])], { cwd: root, env: isolatedEnv(variantRoot, prepared.networkGuard), timeout: 180000 });
      need(result.status === 0, 'oracle_failed', item.id + ' ' + variant.id + ' packed oracle failed', { repetition, status: result.status, stderr: String(result.stderr || '').slice(-3000) });
      const receipt = readJson(path.join(variantRoot, 'receipt.json'), item.id + ' ' + variant.id + ' receipt');
      const expected = variant.id === 'baseline' ? 'baseline_red' : 'reference_green';
      need(receipt.expected === expected && receipt.artifact_sha256 === archive.sha256, 'oracle_failed', item.id + ' ' + variant.id + ' oracle verdict drifted', { expected, observed: receipt.expected });
      need(!fs.existsSync(path.join(variantRoot, 'network-attempts.log')) || fs.statSync(path.join(variantRoot, 'network-attempts.log')).size === 0, 'network_attempt', item.id + ' ' + variant.id + ' attempted network access');
      rows.push({ variant: variant.id, expected, artifact_sha256: receipt.artifact_sha256, records: receipt.records.map((entry) => ({ label: entry.label, status: entry.status, network_attempt_detected: entry.network_attempt_detected })), mutant: receipt.mutant });
    }
  } finally { try { fs.rmSync(outputRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) {} }
  return { repetition, variants: rows };
}
function executeScripted(item, root, prepared, repetition) {
  const rows = [];
  for (const variant of ['baseline', 'reference', 'mutant-auto-approve', 'mutant-replay']) {
    const runRoot = path.join(os.tmpdir(), `workspine-phase16-owner-${repetition}-${variant}-${process.pid}`);
    const result = run(process.execPath, [prepared.oracle, variant, '2'], { cwd: root, env: isolatedEnv(runRoot, prepared.networkGuard), timeout: 240000 });
    const networkLog = path.join(runRoot, 'network-attempts.log');
    const networkAttemptDetected = fs.existsSync(networkLog) && fs.statSync(networkLog).size > 0;
    need(!networkAttemptDetected, 'network_attempt', item.id + ' ' + variant + ' scripted-owner oracle attempted network access', { repetition, variant });
    need(result.status === 0, 'oracle_failed', item.id + ' ' + variant + ' scripted-owner oracle failed', { repetition, status: result.status, stderr: String(result.stderr || '').slice(-3000) });
    const observed = parseOracle(result, item.id + ' ' + variant + ' scripted-owner oracle');
    const expected = variant === 'reference' ? 'green' : 'red';
    need(observed.expected === expected && observed.terminal?.status === (expected === 'green' ? 'passed' : 'red_control_passed') && observed.reproducible === true && observed.provider_invoked === false && observed.browser_invoked === false && observed.network_attempt_detected === false, 'oracle_failed', item.id + ' ' + variant + ' controls drifted', { repetition, expected, observed: observed.terminal });
    rows.push({ variant, expected, reproducible: observed.reproducible, network_attempt_detected: false, runs: observed.runs.map((entry) => ({ index: entry.index, observations: entry.observations })) });
    try { fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) {}
  }
  return { repetition, variants: rows };
}
function verifyRuntime(command, expected, label) { need(typeof command === 'string' && path.isAbsolute(command), 'runtime_invalid', label + ' runtime command is not an acquired executable'); verifyFile(command, expected, label + ' runtime'); return command; }
function run(command, argv, options = {}) { return cp.spawnSync(command, argv, { cwd: options.cwd, env: options.env || process.env, encoding: 'utf8', windowsHide: true, timeout: options.timeout || 120000 }); }
function parseOracle(process, label) {
  const text = String(process.stdout || '').trim();
  try { return JSON.parse(text); }
  catch (_) { try { return JSON.parse(text.split(/\r?\n/).pop() || ''); } catch (error) {
    fail('oracle_output_invalid', label + ' did not emit JSON', { exit: process.status, stderr: String(process.stderr || '').slice(-2000), message: error.message });
  } }
}
function checkVariant(item, root, variant, label) {
  const variantRoot = resolveRelative(root, variant.root, label + ' variant root');
  const source = resolveRelative(variantRoot, variant.path, label + ' source'); verifyFile(source, variant.sha256, label + ' source');
  return { root: variantRoot, source };
}
function checkCaseShape(item) {
  need(item && typeof item === 'object' && !Array.isArray(item), 'case_invalid', 'calibration case must be an object');
  need(CASE_IDS.includes(item.id), 'case_id_invalid', 'unsupported calibration case: ' + item.id);
  const expectedAdmission = CORE_IDS.includes(item.id) ? 'admitted-core' : ADMITTED_IDS.includes(item.id) ? 'admitted-auxiliary' : 'pending';
  need(item.admission === expectedAdmission, 'admission_invalid', item.id + ' has an invalid admission state');
  need(Array.isArray(item.campaign_refs) && item.campaign_refs.length > 0, 'case_binding_invalid', item.id + ' has no campaign bindings');
  if (item.admission === 'pending') return;
  need(typeof item.manifest?.path === 'string' && !path.isAbsolute(item.manifest.path), 'manifest_pin_missing', item.id + ' manifest path must be portable'); checkHash(item.manifest.sha256, item.id + ' manifest sha256');
  need(typeof item.oracle?.path === 'string' && !path.isAbsolute(item.oracle.path), 'oracle_pin_missing', item.id + ' oracle path must be portable'); checkHash(item.oracle.sha256, item.id + ' oracle sha256');
  need(Array.isArray(item.variants) && item.variants.length >= 2, 'variant_matrix_invalid', item.id + ' must declare native control variants');
  for (const variant of item.variants) { need(['baseline', 'reference', 'mutant', 'mutant-content', 'mutant-auto-approve', 'mutant-replay'].includes(variant.id), 'variant_id_invalid', item.id + ' has unsupported variant'); if (variant.sha256) checkHash(variant.sha256, item.id + ' ' + variant.id + ' sha256'); if (variant.root) need(typeof variant.root === 'string' && !path.isAbsolute(variant.root), 'portable_path_invalid', item.id + ' variant root must be portable'); }
  for (const key of ['candidate_commit', 'baseline_commit', 'reference_commit', 'fix_commit']) if (item.source?.[key]) checkCommit(item.source[key], item.id + ' source ' + key);
}
function readCases(file) {
  const data = readJson(file, 'calibration cases'); need(data.schema_version === 2 && data.contract === CONTRACT && data.approval_ref === APPROVAL, 'contract_invalid', 'calibration contract or approval drifted');
  need(data.provider_invoked === false && data.browser_invoked === false, 'unsafe_mode', 'calibration contract permits a provider or browser'); need(data.repeat_required === 2 && Array.isArray(data.cases), 'repeat_contract_invalid', 'calibration contract must require two repetitions');
  need(stable(data.cases.map((item) => item.id)) === stable(CASE_IDS), 'case_matrix_invalid', 'calibration case order or membership drifted'); for (const item of data.cases) checkCaseShape(item); return data;
}
function checkCampaign(data) {
  const campaign = readJson(CAMPAIGN, 'core-flow campaign'); need(campaign.calibration?.contract === CONTRACT, 'campaign_calibration_invalid', 'core-flow campaign does not point at offline calibration');
  const bindings = new Map((campaign.bindings || []).map((binding) => [binding.run_id, binding])); const refs = data.cases.flatMap((item) => item.campaign_refs);
  need(refs.length === 21 && new Set(refs).size === 21 && refs.every((id) => bindings.has(id)), 'case_binding_count_invalid', 'calibration does not cover exactly the 21 campaign bindings');
  for (const item of data.cases) for (const runId of item.campaign_refs) { const binding = bindings.get(runId); need(binding.calibration_case === item.id, 'case_binding_invalid', runId + ' points at the wrong calibration case'); if (item.admission === 'admitted-core') need(binding.kind === 'core' && binding.calibration_digest === digest(item), 'case_binding_digest_invalid', runId + ' does not pin its core calibration digest'); else if (item.admission === 'admitted-auxiliary') need(binding.kind !== 'core' && binding.calibration_digest === digest(item), 'case_binding_digest_invalid', runId + ' does not pin its auxiliary calibration digest'); else need(binding.kind !== 'core' && binding.calibration_digest === null, 'auxiliary_admission_invalid', runId + ' must remain explicitly pending'); }
  return campaign;
}
function verifyTreesnap(item, root) {
  const info = verifyManifest(root, item.manifest, item.id); const runtime = verifyRuntime(info.manifest.runtime.command, info.manifest.runtime.sha256, item.id + ' Python');
  const oracle = resolveRelative(root, item.oracle.path, item.id + ' oracle'); verifyFile(oracle, item.oracle.sha256, item.id + ' oracle'); for (const variant of item.variants) checkVariant(item, root, variant, item.id + ' ' + variant.id); return { runtime, oracle };
}
function executeTreesnap(item, root, prepared, repetition) {
  return item.variants.map((variant) => { const checked = checkVariant(item, root, variant, item.id + ' ' + variant.id); const result = run(prepared.runtime, [prepared.oracle, checked.source], { cwd: root, timeout: 120000 }); const observed = parseOracle(result, item.id + ' ' + variant.id); const green = variant.expected === 'green'; need(green ? result.status === 0 && observed.status === 'pass' : result.status !== 0 && observed.status === 'fail', 'oracle_failed', item.id + ' ' + variant.id + ' control drifted', { repetition, exit: result.status, observed }); return { variant: variant.id, expected: variant.expected, exit: result.status, oracle_status: observed.status }; });
}
function verifyItsdangerous(item, root) {
  const info = verifyManifest(root, item.manifest, item.id); const packet = path.dirname(item.manifest.path); const runtime = verifyRuntime(resolveRelative(root, path.join(packet, 'runtime/python.exe'), item.id + ' Python'), info.manifest.runtime.python_sha256, item.id + ' Python'); verifyFile(resolveRelative(root, path.join(packet, 'runtime/python312.dll'), item.id + ' Python DLL'), info.manifest.runtime.dll_sha256, item.id + ' Python DLL'); verifyFile(resolveRelative(root, path.join(packet, 'wheelhouse.lock'), item.id + ' wheel lock'), info.manifest.dependencies.lock_sha256, item.id + ' wheel lock');
  for (const archive of item.archives) verifyFile(resolveRelative(root, archive.path, item.id + ' archive'), archive.sha256, item.id + ' archive');
  const lock = fs.readFileSync(resolveRelative(root, path.join(packet, 'wheelhouse.lock'), item.id + ' wheel lock'), 'utf8');
  for (const line of lock.split(/\r?\n/).filter((entry) => entry && !entry.startsWith('#'))) { const match = line.match(/^([^ ]+) --hash=sha256:([0-9a-f]{64})$/i); need(match, 'wheelhouse_invalid', item.id + ' wheel lock line is invalid'); const wheelName = fs.readdirSync(resolveRelative(root, path.join(packet, 'wheelhouse'), item.id + ' wheelhouse')).find((name) => name.toLowerCase().startsWith(match[1].split('==')[0].replaceAll('-', '_').toLowerCase() + '-') && name.endsWith('.whl')); need(wheelName, 'missing_input', item.id + ' locked wheel is missing'); verifyFile(resolveRelative(root, path.join(packet, 'wheelhouse', wheelName), item.id + ' wheel'), match[2], item.id + ' wheel'); }
  const oracle = resolveRelative(root, item.oracle.path, item.id + ' oracle'); verifyFile(oracle, item.oracle.sha256, item.id + ' oracle'); for (const variant of item.variants) checkVariant(item, root, variant, item.id + ' ' + variant.id); return { runtime, oracle };
}
function executeItsdangerous(item, root, prepared, repetition) {
  const result = run(prepared.runtime, [prepared.oracle], { cwd: root, timeout: 180000 }); const observed = parseOracle(result, item.id); need(result.status === 0 && observed.status === 'pass' && Array.isArray(observed.repeats) && observed.repeats.length === 2, 'oracle_failed', item.id + ' native oracle did not pass all controls', { repetition, exit: result.status, observed }); need(observed.repeats.every((row) => row.baseline_import_red && row.reference_import_green && row.mutant_wrong_default_detected && row.reference_behavior_green && row.reference_tests_green && row.mutant_tests_red), 'oracle_failed', item.id + ' native controls were not all red/green/red', { repetition }); return { native_status: observed.status, native_repeats: observed.repeats.length };
}
function verifyChi(item, root) {
  const info = verifyManifest(root, item.manifest, item.id); const go = resolveRelative(root, item.toolchain.path, item.id + ' Go'); verifyFile(go, info.manifest.toolchain.go_executable_sha256, item.id + ' Go'); const version = run(go, ['version'], { cwd: root, timeout: 30000 }); need(version.status === 0 && String(version.stdout).includes(info.manifest.toolchain.version), 'runtime_version_mismatch', item.id + ' Go version drifted', { stdout: version.stdout });
  verifyFile(resolveRelative(root, item.oracle.path, item.id + ' oracle'), item.oracle.sha256, item.id + ' oracle');
  for (const variant of item.variants) { const checked = checkVariant(item, root, variant, item.id + ' ' + variant.id); if (variant.test_sha256) verifyFile(resolveRelative(checked.root, 'middleware/content_charset_test.go', item.id + ' upstream test'), variant.test_sha256, item.id + ' ' + variant.id + ' upstream test'); }
  verifyFile(resolveRelative(root, item.reference_patch.path, item.id + ' reference patch'), item.reference_patch.sha256, item.id + ' reference patch'); return { go, oracleHash: info.manifest.oracle.sha256, manifest: info.manifest };
}
function executeChi(item, root, prepared, repetition) {
  return item.variants.map((variant) => { const checked = checkVariant(item, root, variant, item.id + ' ' + variant.id); const runParent = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-phase16-chi-')); const runRoot = path.join(runParent, 'repo'); try { fs.cpSync(checked.root, runRoot, { recursive: true, dereference: false }); const oracle = resolveRelative(runRoot, prepared.manifest.oracle.path, item.id + ' oracle'); fs.mkdirSync(path.dirname(oracle), { recursive: true }); fs.copyFileSync(resolveRelative(root, item.oracle.path, item.id + ' oracle'), oracle); verifyFile(oracle, prepared.oracleHash, item.id + ' ' + variant.id + ' oracle'); const result = run(prepared.go, ['test', './middleware', '-run', '^TestPhase16ChiCharsetOracle$', '-count=1'], { cwd: runRoot, timeout: 120000, env: { ...process.env, GOPROXY: 'off', GOSUMDB: 'off', GONOSUMDB: '*', GONOPROXY: '*', GOPRIVATE: '*', GOWORK: 'off', GOTOOLCHAIN: 'local', GOCACHE: path.join(runRoot, 'gocache'), GOMODCACHE: path.join(runRoot, 'gomodcache') } }); const green = variant.expected === 'green'; need(green ? result.status === 0 : result.status !== 0, 'oracle_failed', item.id + ' ' + variant.id + ' control drifted', { repetition, exit: result.status, stderr: String(result.stderr).slice(-2000) }); return { variant: variant.id, expected: variant.expected, exit: result.status }; } finally { try { fs.rmSync(runParent, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (_) {} } });
}
function prepare(item, root) { if (item.id === 'treesnap-greenfield') return verifyTreesnap(item, root); if (item.id === 'itsdangerous-fips-sha1') return verifyItsdangerous(item, root); if (item.id === 'chi-bodyless-charset') return verifyChi(item, root); if (item.id === 'packed-readme-install') return verifyPacked(item, root); if (item.id === 'scripted-owner-broker') return verifyScripted(item, root); fail('calibration_pending', item.id + ' is not admitted in this calibration slice'); }
function execute(item, root, prepared, repetition) { if (item.id === 'treesnap-greenfield') return executeTreesnap(item, root, prepared, repetition); if (item.id === 'itsdangerous-fips-sha1') return executeItsdangerous(item, root, prepared, repetition); if (item.id === 'chi-bodyless-charset') return executeChi(item, root, prepared, repetition); if (item.id === 'packed-readme-install') return executePacked(item, root, prepared, repetition); if (item.id === 'scripted-owner-broker') return executeScripted(item, root, prepared, repetition); fail('calibration_pending', item.id + ' is not admitted in this calibration slice'); }
function output(result, code = 0) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exitCode = code; }
function main() {
  need(!flag('--live', '--real-agent', '--browser', '--provider'), 'unsafe_mode', 'live provider/browser options are forbidden in offline calibration'); const casesFile = path.resolve(arg('--cases', DEFAULT_CASES)); const root = path.resolve(arg('--calibration-root', DEFAULT_ROOT)); need(fs.existsSync(root), 'calibration_root_missing', 'calibration root is missing', { path: slash(root) }); const data = readCases(casesFile); const campaign = checkCampaign(data); const requested = arg('--case'); need(!requested || CASE_IDS.includes(requested), 'case_id_invalid', 'unsupported calibration case: ' + requested);
  const selected = requested ? data.cases.filter((item) => item.id === requested) : data.cases.filter((item) => ADMITTED_IDS.includes(item.id)); const mode = flag('--check') ? 'check' : flag('--all') || requested ? 'all' : null; need(mode, 'mode_required', 'use --check, --all, or --case <id>'); const repeat = Number(arg('--repeat', mode === 'all' ? data.repeat_required : 1)); need(Number.isInteger(repeat) && repeat >= 1 && repeat <= 2, 'repeat_invalid', 'repeat must be one or two deterministic repetitions');
  if (mode === 'check') {
    try { for (const item of data.cases.filter((candidate) => ADMITTED_IDS.includes(candidate.id))) prepare(item, root); }
    catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: ADMITTED_IDS.length, calibrated_cases: 0, pending_cases: 1, calibrated_bindings: 0, pending_bindings: 1, repetitions: 1, campaign_bindings: campaign.bindings.length }, cases: [], terminal: { status: 'blocked', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: input verification failed.' }, 1); }
    const rows = data.cases.map((item) => ({ id: item.id, admission: item.admission, status: item.admission === 'pending' ? 'pending' : 'ready', digest: digest(item) })); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: ADMITTED_IDS.length, calibrated_cases: ADMITTED_IDS.length, pending_cases: 1, calibrated_bindings: 20, pending_bindings: 1, repetitions: 1, campaign_bindings: campaign.bindings.length }, cases: rows, terminal: { status: 'passed', pending_cases: ['docusaurus-browser'], message: 'core and retained auxiliary calibration inputs are structurally valid and hash-verified' }, claim_limit: 'Offline input validity only; no provider, browser, product, or workflow reliability claim.' });
  }
  const pending = selected.filter((item) => item.admission === 'pending'); if (pending.length) return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: 1, repetitions: repeat, calibrated_bindings: 0, pending_bindings: 1 }, cases: pending.map((item) => ({ id: item.id, admission: item.admission, status: 'pending', repetitions: 0, digest: digest(item) })), terminal: { status: 'blocked', failure_code: 'calibration_pending', pending_cases: pending.map((item) => item.id), message: 'Docusaurus browser calibration belongs to the Phase 16-06 browser gate' }, claim_limit: 'No calibration claim for pending browser rows.' }, 1);
  const prepared = new Map(); try { for (const item of selected) prepared.set(item.id, prepare(item, root)); } catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: selected.length, repetitions: repeat }, cases: selected.map((item) => ({ id: item.id, admission: item.admission, status: 'blocked', repetitions: 0 })), terminal: { status: 'blocked', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: input verification failed before native execution.' }, 1); }
  const rows = []; try { for (const item of selected) { const observations = []; for (let repetition = 1; repetition <= repeat; repetition += 1) observations.push(execute(item, root, prepared.get(item.id), repetition)); rows.push({ id: item.id, admission: item.admission, status: 'calibrated', repetitions: repeat, digest: digest(item), observations }); } } catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: selected.length, repetitions: repeat }, cases: rows, terminal: { status: 'failed', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: a native control failed.' }, 1); }
  return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: selected.length, calibrated_cases: selected.length, pending_cases: 1, calibrated_bindings: 20, pending_bindings: 1, repetitions: repeat }, cases: rows, terminal: { status: 'passed', message: `all admitted native red/green/red controls passed ${repeat === 1 ? 'once' : 'twice'}` }, claim_limit: 'Only offline calibration input validity and native oracle controls for the three core and two retained auxiliary cases; no provider, browser, product, or workflow reliability claim.' });
}
try { main(); } catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); output({ schema_version: 2, contract: CONTRACT, provider_invoked: false, browser_invoked: false, terminal: { status: 'failed', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: offline calibration failed.' }, 1); }
