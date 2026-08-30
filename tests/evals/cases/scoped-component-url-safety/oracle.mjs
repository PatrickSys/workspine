#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPINE_ROOT = path.resolve(CASE_DIR, '../../../..');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeout || 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} failed: ${result.error?.code || result.status}; ${String(result.stderr || '').slice(0, 500)}`);
  }
  return result;
}

function readCase(file) {
  const caseFile = path.resolve(file);
  if (path.dirname(caseFile) !== CASE_DIR) throw new Error('case path must resolve to the frozen case directory');
  const value = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
  if (value.schema_version !== 1 || value.id !== 'scoped-component-url-safety') throw new Error('case identity mismatch');
  return value;
}

function boundPath(relative) {
  const file = path.resolve(CASE_DIR, relative);
  if (path.dirname(file) !== CASE_DIR && !path.dirname(file).startsWith(`${CASE_DIR}${path.sep}`)) throw new Error('unsafe case binding');
  return file;
}

function verifyBindings(value) {
  const archive = path.resolve(WORKSPINE_ROOT, value.source.archive_cache);
  if (!archive.startsWith(`${path.join(WORKSPINE_ROOT, '.work', 'evals')}${path.sep}`)
    || fileSha256(archive) !== value.source.archive_sha256) throw new Error('source archive binding mismatch');
  for (const [relative, expected] of Object.entries(value.bindings)) {
    const file = boundPath(relative);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink() || fileSha256(file) !== expected) throw new Error(`case binding mismatch: ${relative}`);
  }
  if (value.mutation.sha256 !== value.bindings[value.mutation.patch]) throw new Error('mutation binding mismatch');
  return archive;
}

function sanitizeSource(root) {
  const packageFile = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  delete pkg.repository;
  delete pkg.bugs;
  delete pkg.homepage;
  fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
}

function extract(value, target) {
  const archive = verifyBindings(value);
  fs.mkdirSync(target, { recursive: true });
  command('tar', ['-xf', archive, '-C', target]);
  const entries = fs.readdirSync(target, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (entries.length !== 1) throw new Error('source archive root is ambiguous');
  const root = path.join(target, entries[0].name);
  if (fs.existsSync(path.join(root, '.git'))) throw new Error('source archive unexpectedly contains git history');
  sanitizeSource(root);
  return root;
}

function applyPatch(root, relative) {
  command('git', ['apply', '--whitespace=nowarn', boundPath(relative)], { cwd: root });
}

function expected(valid, warnings, errors) {
  const result = { validForNewPackages: valid && !warnings?.length, validForOldPackages: valid };
  if (warnings?.length) result.warnings = warnings;
  if (errors?.length) result.errors = errors;
  return result;
}

function behavior(root) {
  const require = createRequire(import.meta.url);
  let validate;
  try { validate = require(path.join(root, 'lib')); } catch (error) {
    return { passed: false, checks: 0, failures: [{ id: 'module-load', detail: String(error.message || error).slice(0, 300) }] };
  }
  const urlError = ['name can only contain URL-friendly characters'];
  const rows = [
    ['valid-basic', '@scope/package', expected(true)],
    ['valid-punctuation', '@scope-name/pkg_name.js', expected(true)],
    ['invalid-scope-space', '@bad scope/package', expected(false, null, urlError)],
    ['invalid-package-space', '@scope/bad package', expected(false, null, urlError)],
    ['invalid-scope-percent', '@bad%scope/package', expected(false, null, urlError)],
    ['invalid-package-percent', '@scope/bad%package', expected(false, null, urlError)],
    ['invalid-both', '@bad scope/bad package', expected(false, null, urlError)],
    ['invalid-multi-slash', '@scope/with/slash', expected(false, null, urlError)],
    ['unscoped-valid', 'ordinary-package', expected(true)],
    ['unscoped-invalid', 'bad package', expected(false, null, urlError)],
  ];
  const failures = [];
  for (const [id, input, wanted] of rows) {
    let actual;
    try { actual = validate(input); } catch (error) { failures.push({ id, detail: `threw: ${String(error.message || error).slice(0, 200)}` }); continue; }
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) failures.push({ id, expected: wanted, actual });
  }
  return { passed: failures.length === 0, checks: rows.length, failures };
}

function withVariant(value, patches, callback) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-holdout-control-'));
  try {
    const root = extract(value, temporary);
    for (const patch of patches) applyPatch(root, patch);
    return callback(root);
  } finally {
    if (!temporary.startsWith(`${path.resolve(os.tmpdir())}${path.sep}workspine-holdout-control-`)) throw new Error('unsafe control cleanup');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function calibrate(value) {
  const baseline = withVariant(value, [value.mutation.patch], behavior);
  const witness = withVariant(value, [value.mutation.patch, value.controls.witness], behavior);
  const witnessReplay = withVariant(value, [value.mutation.patch, value.controls.witness], behavior);
  const mutants = value.controls.mutants.map(id => ({ id, result: withVariant(value, [value.mutation.patch, id], behavior).passed ? 'green' : 'red' }));
  return {
    schema_version: 1,
    case_id: value.id,
    network_accessed: false,
    oracle_kind: 'black_box_behavior',
    baseline: baseline.passed ? 'green' : 'red',
    witness: witness.passed ? 'green' : 'red',
    witness_replay_matches: JSON.stringify(witnessReplay) === JSON.stringify(witness),
    mutants,
    checks_per_variant: witness.checks,
    source_archive_sha256: value.source.archive_sha256,
  };
}

function materialize(value, destination) {
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error('consumer destination already exists');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-holdout-source-'));
  try {
    const source = extract(value, temporary);
    applyPatch(source, value.mutation.patch);
    fs.cpSync(source, target, { recursive: true });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  command('git', ['init'], { cwd: target });
  command('git', ['config', 'user.name', 'Workspine evaluation'], { cwd: target });
  command('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: target });
  command('git', ['add', '--all'], { cwd: target });
  command('git', ['commit', '-m', 'synthetic broken baseline'], { cwd: target });
  const count = command('git', ['rev-list', '--count', 'HEAD'], { cwd: target }).stdout.trim();
  const remotes = command('git', ['remote'], { cwd: target }).stdout.trim();
  if (count !== '1' || remotes) throw new Error('synthetic baseline isolation failed');
  return { schema_version: 1, case_id: value.id, baseline_commits: 1, remotes: 0,
    head: command('git', ['rev-parse', 'HEAD'], { cwd: target }).stdout.trim() };
}

const [mode, caseFile, extra] = process.argv.slice(2);
try {
  const value = readCase(caseFile);
  let result;
  if (mode === 'calibrate') result = calibrate(value);
  else if (mode === 'grade') result = behavior(path.resolve(extra));
  else if (mode === 'materialize') result = materialize(value, extra);
  else throw new Error(`unsupported oracle mode: ${mode || '<missing>'}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (mode === 'grade' && !result.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: String(error.message || error).slice(0, 1000) })}\n`);
  process.exitCode = 2;
}
