import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { output, parseFlagValue } from './cli-utils.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

class FileOpError extends Error {}

function fail(message) {
  console.error(message);
  throw new FileOpError(message);
}

function resolveWorkspacePath(cwd, target) {
  const workspaceRoot = resolve(cwd);
  const resolved = resolve(workspaceRoot, target);
  const rel = relative(workspaceRoot, resolved);

  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolved;
  }

  fail(`Path must stay inside the workspace: ${target}`);
}

function ensureRealPathInsideWorkspace(workspaceRoot, candidate, label) {
  const realWorkspaceRoot = realpathSync(workspaceRoot);
  const realCandidate = realpathSync(candidate);
  const rel = relative(realWorkspaceRoot, realCandidate);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return realCandidate;
  }
  fail(`${label} must stay inside the workspace: ${candidate}`);
}

function ensureExistingFilePathInsideWorkspace(workspaceRoot, candidate, label) {
  const stats = lstatSync(candidate);
  if (stats.isSymbolicLink()) {
    fail(`${label} cannot be a symlink: ${candidate}`);
  }
  return ensureRealPathInsideWorkspace(workspaceRoot, candidate, label);
}

function ensureParentPathInsideWorkspace(workspaceRoot, candidate, label) {
  let current = dirname(candidate);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      fail(`${label} must stay inside the workspace: ${candidate}`);
    }
    current = parent;
  }
  ensureExistingFilePathInsideWorkspace(workspaceRoot, current, label);
}

function getMissingBehavior(args) {
  const parsed = parseFlagValue(args, '--missing');
  if (!parsed.present) return 'error';
  if (parsed.invalid) fail('Usage: --missing <error|ok>');
  if (!['error', 'ok'].includes(parsed.value)) fail('Usage: --missing <error|ok>');
  return parsed.value;
}

function cmdCopy(cwd, args) {
  const [sourceArg, destinationArg, ...flags] = args;
  if (!sourceArg || !destinationArg) {
    fail('Usage: gsdd file-op copy <source> <destination> [--missing <error|ok>]');
  }

  const missingBehavior = getMissingBehavior(flags);
  const workspaceRoot = resolve(cwd);
  const source = resolveWorkspacePath(cwd, sourceArg);
  const destination = resolveWorkspacePath(cwd, destinationArg);

  if (!existsSync(source)) {
    if (missingBehavior === 'ok') {
      output({ operation: 'copy', source: sourceArg, destination: destinationArg, changed: false, reason: 'missing_source' });
      return;
    }
    fail(`Source file does not exist: ${sourceArg}`);
  }

  if (statSync(source).isDirectory()) {
    fail(`Copy only supports files in this phase: ${sourceArg}`);
  }

  ensureExistingFilePathInsideWorkspace(workspaceRoot, source, 'Source path');
  if (existsSync(destination)) {
    ensureExistingFilePathInsideWorkspace(workspaceRoot, destination, 'Destination path');
  }
  ensureParentPathInsideWorkspace(workspaceRoot, destination, 'Destination path');

  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { force: true });
  output({ operation: 'copy', source: sourceArg, destination: destinationArg, changed: true });
}

function cmdDelete(cwd, args) {
  const [targetArg, ...flags] = args;
  if (!targetArg) {
    fail('Usage: gsdd file-op delete <target> [--missing <error|ok>]');
  }

  const missingBehavior = getMissingBehavior(flags);
  const workspaceRoot = resolve(cwd);
  const target = resolveWorkspacePath(cwd, targetArg);

  if (!existsSync(target)) {
    if (missingBehavior === 'ok') {
      output({ operation: 'delete', target: targetArg, changed: false, reason: 'missing_target' });
      return;
    }
    fail(`Target file does not exist: ${targetArg}`);
  }

  if (statSync(target).isDirectory()) {
    fail(`Delete only supports files in this phase: ${targetArg}`);
  }

  ensureExistingFilePathInsideWorkspace(workspaceRoot, target, 'Target path');
  unlinkSync(target);
  output({ operation: 'delete', target: targetArg, changed: true });
}

function cmdRegexSub(cwd, args) {
  const [targetArg, pattern, replacement, ...flags] = args;
  if (!targetArg || pattern === undefined || replacement === undefined) {
    fail('Usage: gsdd file-op regex-sub <target> <pattern> <replacement> [--flags <flags>] [--missing <error|ok>]');
  }

  const regexFlags = parseFlagValue(flags, '--flags');
  if (regexFlags.present && regexFlags.invalid) {
    fail('Usage: --flags <regex-flags>');
  }

  const missingBehavior = getMissingBehavior(flags);
  const workspaceRoot = resolve(cwd);
  const target = resolveWorkspacePath(cwd, targetArg);

  if (!existsSync(target)) {
    if (missingBehavior === 'ok') {
      output({ operation: 'regex-sub', target: targetArg, changed: false, reason: 'missing_target' });
      return;
    }
    fail(`Target file does not exist: ${targetArg}`);
  }

  if (statSync(target).isDirectory()) {
    fail(`regex-sub only supports files in this phase: ${targetArg}`);
  }

  ensureExistingFilePathInsideWorkspace(workspaceRoot, target, 'Target path');

  let regex;
  try {
    regex = new RegExp(pattern, regexFlags.value || 'g');
  } catch (error) {
    fail(`Invalid regex pattern: ${error.message}`);
  }

  const source = readFileSync(target, 'utf-8');
  let replacementCount = 0;
  if (regex.global) {
    const matches = source.match(regex);
    replacementCount = matches ? matches.length : 0;
  } else {
    replacementCount = regex.test(source) ? 1 : 0;
  }

  if (replacementCount === 0) {
    fail(`Pattern did not match any text in ${targetArg}`);
  }

  const updated = source.replace(regex, replacement);
  const changed = updated !== source;
  writeFileSync(target, updated);
  output({ operation: 'regex-sub', target: targetArg, changed, replacements: replacementCount });
}

export function cmdFileOp(...args) {
  const { args: normalizedArgs, workspaceRoot, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const [operation, ...rest] = normalizedArgs;

  try {
    switch (operation) {
      case 'copy':
        cmdCopy(workspaceRoot, rest);
        return;
      case 'delete':
        cmdDelete(workspaceRoot, rest);
        return;
      case 'regex-sub':
        cmdRegexSub(workspaceRoot, rest);
        return;
      default:
        fail('Usage: gsdd file-op <copy|delete|regex-sub> ...');
    }
  } catch (error) {
    if (error instanceof FileOpError) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
