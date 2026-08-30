import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { command, EvalError, fileSha256, mkdirp, sha256, treeManifest } from './util.mjs';
const CANDIDATE_FIELDS = ['head', 'tree', 'package_name', 'package_version', 'tarball_sha256'];
export function assertCandidateBinding(actual, expected) {
  for (const field of CANDIDATE_FIELDS)
    if (!actual?.[field] || actual[field] !== expected?.[field]) throw new EvalError('evaluator_invalid', `candidate ${field} mismatch`);
  return { ok: true };
}
export function assertSyntheticBaseline(repoRoot) {
  const root = path.resolve(repoRoot);
  const count = command('git', ['rev-list', '--count', 'HEAD'], { cwd: root }).stdout.trim();
  if (count !== '1') throw new EvalError('environment_invalid', 'synthetic baseline must contain exactly one commit');
  const parent = command('git', ['rev-parse', '--verify', 'HEAD^'], { cwd: root, allowFailure: true });
  if (parent.status === 0) throw new EvalError('environment_invalid', 'synthetic baseline exposes parent history');
  if (command('git', ['remote'], { cwd: root }).stdout.trim()) throw new EvalError('environment_invalid', 'synthetic baseline must not contain a remote');
  if (command('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).stdout.trim()) throw new EvalError('environment_invalid', 'synthetic baseline must start clean');
  return { ok: true, head: command('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim() };
}
export function materializeSyntheticBaseline({ sourceRoot, destination, mutationPatch }) {
  const source = path.resolve(sourceRoot), target = path.resolve(destination);
  if (fs.existsSync(target)) throw new EvalError('environment_invalid', 'synthetic baseline destination already exists');
  fs.cpSync(source, target, { recursive: true, filter: file => path.basename(file) !== '.git' });
  if (mutationPatch) command('git', ['apply', '--whitespace=nowarn', path.resolve(mutationPatch)], { cwd: target });
  command('git', ['init'], { cwd: target });
  command('git', ['config', 'user.name', 'Workspine evaluation'], { cwd: target });
  command('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: target });
  command('git', ['add', '--all'], { cwd: target });
  command('git', ['commit', '-m', 'synthetic broken baseline'], { cwd: target });
  return assertSyntheticBaseline(target);
}
function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function createIsolatedCodexHome({ sourceHome, parent, runId, allowTempForTest = false }) {
  const base = path.resolve(parent);
  if (!allowTempForTest && isInside(base, os.tmpdir())) throw new EvalError('environment_invalid', 'isolated CODEX_HOME must be outside Temp');
  const auth = path.join(path.resolve(sourceHome), 'auth.json');
  if (!fs.statSync(auth, { throwIfNoEntry: false })?.isFile()) throw new EvalError('environment_invalid', 'Codex auth.json is unavailable');
  mkdirp(base);
  const home = path.join(base, `workspine-codex-${runId}`);
  fs.mkdirSync(home, { recursive: false, mode: 0o700 });
  fs.copyFileSync(auth, path.join(home, 'auth.json'), fs.constants.COPYFILE_EXCL);
  return { home, posture: {
    auth_present: true, config_present: false, global_instructions_present: false, plugins_present: false,
    scope: allowTempForTest ? 'isolated_test' : 'isolated_outside_temp',
  } };
}
export function cleanupIsolatedCodexHome(home, parent) {
  const resolved = path.resolve(home);
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith('workspine-codex-'))
    throw new EvalError('environment_invalid', 'refusing unsafe CODEX_HOME cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
}
export function packageCandidate({ repoRoot, outputDir }) {
  const root = path.resolve(repoRoot);
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']])
    if (command('git', args, { cwd: root, allowFailure: true }).status !== 0) throw new EvalError('evaluator_invalid', 'tracked candidate source is dirty');
  mkdirp(outputDir);
  const packed = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', path.resolve(outputDir)], { cwd: root });
  const rows = JSON.parse(packed.stdout);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].filename) throw new EvalError('evaluator_invalid', 'npm pack output is invalid');
  const tarball = path.join(path.resolve(outputDir), rows[0].filename);
  const extracted = fs.mkdtempSync(path.join(path.resolve(outputDir), '.members-'));
  command('tar', ['-xf', tarball, '-C', extracted]);
  const member_hashes = treeManifest(extracted).files.map(row => ({ name: row.path, sha256: row.sha256 || sha256(`link:${row.link}`) }));
  if (path.dirname(path.resolve(extracted)) !== path.resolve(outputDir)) throw new EvalError('evaluator_invalid', 'unsafe member extraction path');
  fs.rmSync(extracted, { recursive: true, force: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    head: command('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
    tree: command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }).stdout.trim(),
    package_name: pkg.name, package_version: pkg.version, tarball,
    tarball_sha256: fileSha256(tarball), member_hashes,
  };
}
export function verifyFrozenCandidate({ repoRoot, tarball, expected }) {
  const root = path.resolve(repoRoot);
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']])
    if (command('git', args, { cwd: root, allowFailure: true }).status !== 0) throw new EvalError('evaluator_invalid', 'tracked candidate source is dirty');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return assertCandidateBinding({
    head: command('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
    tree: command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }).stdout.trim(),
    package_name: pkg.name, package_version: pkg.version, tarball_sha256: fileSha256(path.resolve(tarball)),
  }, expected);
}
