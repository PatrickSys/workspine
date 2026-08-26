// Offline calibration for the admitted Phase 16 core task cells.
//
// This command verifies a sealed input packet, then runs the packet's independent
// native oracles in fresh temporary roots. Provider, browser, network, and .work
// state are never consulted. Auxiliary rows remain pending until their own slice.

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
  need(item.admission === (CORE_IDS.includes(item.id) ? 'admitted-core' : 'pending'), 'admission_invalid', item.id + ' has an invalid admission state');
  need(Array.isArray(item.campaign_refs) && item.campaign_refs.length > 0, 'case_binding_invalid', item.id + ' has no campaign bindings');
  if (item.admission === 'pending') return;
  need(typeof item.manifest?.path === 'string' && !path.isAbsolute(item.manifest.path), 'manifest_pin_missing', item.id + ' manifest path must be portable'); checkHash(item.manifest.sha256, item.id + ' manifest sha256');
  need(typeof item.oracle?.path === 'string' && !path.isAbsolute(item.oracle.path), 'oracle_pin_missing', item.id + ' oracle path must be portable'); checkHash(item.oracle.sha256, item.id + ' oracle sha256');
  need(Array.isArray(item.variants) && item.variants.length >= 3, 'variant_matrix_invalid', item.id + ' must declare baseline/reference/mutant variants');
  for (const variant of item.variants) { need(['baseline', 'reference', 'mutant', 'mutant-content'].includes(variant.id), 'variant_id_invalid', item.id + ' has unsupported variant'); checkHash(variant.sha256, item.id + ' ' + variant.id + ' sha256'); need(typeof variant.root === 'string' && !path.isAbsolute(variant.root), 'portable_path_invalid', item.id + ' variant root must be portable'); }
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
  need(refs.length === 27 && new Set(refs).size === 27 && refs.every((id) => bindings.has(id)), 'case_binding_count_invalid', 'calibration does not cover exactly the 27 campaign bindings');
  for (const item of data.cases) for (const runId of item.campaign_refs) { const binding = bindings.get(runId); need(binding.calibration_case === item.id, 'case_binding_invalid', runId + ' points at the wrong calibration case'); if (item.admission === 'admitted-core') need(binding.kind === 'core' && binding.calibration_digest === digest(item), 'case_binding_digest_invalid', runId + ' does not pin its core calibration digest'); else need(binding.kind !== 'core' && binding.calibration_digest === null, 'auxiliary_admission_invalid', runId + ' must remain explicitly pending'); }
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
function prepare(item, root) { if (item.id === 'treesnap-greenfield') return verifyTreesnap(item, root); if (item.id === 'itsdangerous-fips-sha1') return verifyItsdangerous(item, root); if (item.id === 'chi-bodyless-charset') return verifyChi(item, root); fail('calibration_pending', item.id + ' is not admitted in this calibration slice'); }
function execute(item, root, prepared, repetition) { if (item.id === 'treesnap-greenfield') return executeTreesnap(item, root, prepared, repetition); if (item.id === 'itsdangerous-fips-sha1') return executeItsdangerous(item, root, prepared, repetition); if (item.id === 'chi-bodyless-charset') return executeChi(item, root, prepared, repetition); fail('calibration_pending', item.id + ' is not admitted in this calibration slice'); }
function output(result, code = 0) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exitCode = code; }
function main() {
  need(!flag('--live', '--real-agent', '--browser', '--provider'), 'unsafe_mode', 'live provider/browser options are forbidden in offline calibration'); const casesFile = path.resolve(arg('--cases', DEFAULT_CASES)); const root = path.resolve(arg('--calibration-root', DEFAULT_ROOT)); need(fs.existsSync(root), 'calibration_root_missing', 'calibration root is missing', { path: slash(root) }); const data = readCases(casesFile); const campaign = checkCampaign(data); const requested = arg('--case'); need(!requested || CASE_IDS.includes(requested), 'case_id_invalid', 'unsupported calibration case: ' + requested);
  const selected = requested ? data.cases.filter((item) => item.id === requested) : data.cases.filter((item) => CORE_IDS.includes(item.id)); const mode = flag('--check') ? 'check' : flag('--all') || requested ? 'all' : null; need(mode, 'mode_required', 'use --check, --all, or --case <id>'); const repeat = Number(arg('--repeat', mode === 'all' ? data.repeat_required : 1)); need(Number.isInteger(repeat) && repeat >= 1 && repeat <= 2, 'repeat_invalid', 'repeat must be one or two deterministic repetitions');
  if (mode === 'check') {
    try { for (const item of data.cases.filter((candidate) => CORE_IDS.includes(candidate.id))) prepare(item, root); }
    catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: CORE_IDS.length, pending_cases: AUX_IDS.length, repetitions: 1, campaign_bindings: campaign.bindings.length }, cases: [], terminal: { status: 'blocked', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: input verification failed.' }, 1); }
    const rows = data.cases.map((item) => ({ id: item.id, admission: item.admission, status: item.admission === 'pending' ? 'pending' : 'ready', digest: digest(item) })); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: CORE_IDS.length, pending_cases: AUX_IDS.length, repetitions: 1, campaign_bindings: campaign.bindings.length }, cases: rows, terminal: { status: 'passed', pending_cases: AUX_IDS, message: 'core calibration inputs are structurally valid and hash-verified' }, claim_limit: 'Core offline calibration contract only; auxiliary and browser rows remain pending.' });
  }
  const pending = selected.filter((item) => item.admission === 'pending'); if (pending.length) return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: 1, repetitions: repeat }, cases: pending.map((item) => ({ id: item.id, admission: item.admission, status: 'pending', repetitions: 0, digest: digest(item) })), terminal: { status: 'blocked', failure_code: 'calibration_pending', pending_cases: pending.map((item) => item.id), message: 'this slice admits only the three core offline cases' }, claim_limit: 'No calibration claim for pending auxiliary or browser rows.' }, 1);
  const prepared = new Map(); try { for (const item of selected) prepared.set(item.id, prepare(item, root)); } catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: selected.length, repetitions: repeat }, cases: selected.map((item) => ({ id: item.id, admission: item.admission, status: 'blocked', repetitions: 0 })), terminal: { status: 'blocked', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: input verification failed before native execution.' }, 1); }
  const rows = []; try { for (const item of selected) { const observations = []; for (let repetition = 1; repetition <= repeat; repetition += 1) observations.push(execute(item, root, prepared.get(item.id), repetition)); rows.push({ id: item.id, admission: item.admission, status: 'calibrated', repetitions: repeat, digest: digest(item), observations }); } } catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: selected.length, repetitions: repeat }, cases: rows, terminal: { status: 'failed', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: a native control failed.' }, 1); }
  return output({ schema_version: 2, contract: CONTRACT, mode, provider_invoked: false, browser_invoked: false, calibration_root: '<CALIBRATION_ROOT>', matrix: { cases: selected.length, repetitions: repeat }, cases: rows, terminal: { status: 'passed', message: `all admitted core native red/green/red controls passed ${repeat === 1 ? 'once' : 'twice'}` }, claim_limit: 'Only the three pinned core task inputs and their native offline graders; no provider, browser, product, or workflow reliability claim.' });
}
try { main(); } catch (error) { const failure = error instanceof CalibrationFailure ? error : new CalibrationFailure('calibration_failure', error.message); output({ schema_version: 2, contract: CONTRACT, provider_invoked: false, browser_invoked: false, terminal: { status: 'failed', failure_code: failure.code, message: failure.message, evidence: failure.evidence }, claim_limit: 'No calibration claim: offline calibration failed.' }, 1); }
