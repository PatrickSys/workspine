import { lstatSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { hasStateMarker, resolveStateDir } from './state-dir.mjs';

const GIT_FILE_MAX_BYTES = 4096;

function normalizePath(value, cwd) {
  return resolve(cwd, String(value));
}

function hasPlanningMarker(root, lstat) {
  return hasStateMarker(root, { lstat });
}

function lstatIfPresent(filePath, lstat = lstatSync) {
  try {
    return lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function invalidGitMarker(root, detail, cause = null) {
  const error = new Error(`Invalid .git marker at ${join(root, '.git')}: ${detail}. Repair or remove the invalid marker before retrying.`);
  error.code = 'invalid_git_marker';
  if (cause) error.cause = cause;
  return error;
}

function parseGitdirTarget(root, content) {
  if (content.includes('\0')) throw invalidGitMarker(root, 'gitfile contains a NUL byte');
  const withoutFinalNewline = content.endsWith('\n') ? content.slice(0, -1) : content;
  const line = withoutFinalNewline.endsWith('\r') ? withoutFinalNewline.slice(0, -1) : withoutFinalNewline;
  if (!line || line.includes('\r') || line.includes('\n')) {
    throw invalidGitMarker(root, 'gitfile must contain exactly one gitdir declaration');
  }
  const match = /^gitdir:\s+(.+)$/.exec(line.trim());
  const target = match?.[1].trim();
  if (!target) throw invalidGitMarker(root, 'gitfile must declare a nonempty gitdir target');
  return target;
}

function hasGitMarker(root, lstat, readFile) {
  const markerPath = join(root, '.git');
  const marker = lstatIfPresent(markerPath, lstat);
  if (!marker) return false;
  if (marker.isSymbolicLink()) throw invalidGitMarker(root, 'marker is a symbolic link');
  if (marker.isDirectory()) return true;
  if (!marker.isFile()) throw invalidGitMarker(root, 'marker is neither a directory nor a regular file');
  if (marker.size > GIT_FILE_MAX_BYTES) throw invalidGitMarker(root, `gitfile exceeds ${GIT_FILE_MAX_BYTES} bytes`);

  let target;
  try {
    target = parseGitdirTarget(root, String(readFile(markerPath, 'utf-8')));
  } catch (error) {
    if (error?.code === 'invalid_git_marker') throw error;
    throw invalidGitMarker(root, `could not read gitfile (${error.message})`, error);
  }

  const targetPath = resolve(root, target);
  let targetStat;
  try {
    targetStat = lstatIfPresent(targetPath, lstat);
  } catch (error) {
    throw invalidGitMarker(root, `could not inspect gitdir target (${error.message})`, error);
  }
  if (!targetStat) throw invalidGitMarker(root, 'gitdir target does not exist');
  if (targetStat.isSymbolicLink()) throw invalidGitMarker(root, 'gitdir target is a symbolic link');
  if (!targetStat.isDirectory()) throw invalidGitMarker(root, 'gitdir target is not a directory');
  return true;
}

function isWorkspaceRoot(root, lstat = lstatSync, readFile = readFileSync) {
  try {
    return hasPlanningMarker(root, lstat) || hasGitMarker(root, lstat, readFile);
  } catch (error) {
    const inspectionError = new Error(`Workspace markers could not be inspected at ${root}: ${error.message}`);
    inspectionError.code = 'workspace_inspection_failed';
    inspectionError.workspaceRoot = root;
    inspectionError.cause = error;
    throw inspectionError;
  }
}

export function consumeWorkspaceRootArg(rawArgs = []) {
  const args = [];
  let workspaceRootArg = null;
  let invalid = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg !== '--workspace-root') {
      args.push(arg);
      continue;
    }

    const value = rawArgs[index + 1] ?? null;
    if (!value || value.startsWith('--')) {
      invalid = true;
      continue;
    }

    workspaceRootArg = value;
    index += 1;
  }

  return { args, workspaceRootArg, invalid };
}

export function findWorkspaceRoot(startDir = process.cwd(), { lstat = lstatSync, readFile = readFileSync } = {}) {
  let current = resolve(startDir);
  const temporaryRoot = resolve(tmpdir());

  while (true) {
    if (isWorkspaceRoot(current, lstat, readFile)) return current;
    if (current === temporaryRoot) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function deriveWorkspaceRootFromHelperLocation(entryFileUrl) {
  if (!entryFileUrl) return null;

  const entryPath = entryFileUrl.startsWith('file:')
    ? fileURLToPath(entryFileUrl)
    : resolve(String(entryFileUrl));
  const binDir = dirname(entryPath);
  const planningDir = dirname(binDir);
  const workspaceRoot = dirname(planningDir);

  if (hasPlanningMarker(workspaceRoot) && binDir === join(planningDir, 'bin')) {
    return workspaceRoot;
  }

  return null;
}

export function resolveWorkspaceContext(rawArgs = [], { cwd = process.cwd(), env = process.env, lstat = lstatSync, readFile = readFileSync } = {}) {
  const { args, workspaceRootArg, invalid } = consumeWorkspaceRootArg(rawArgs);
  if (invalid) {
    return {
      args,
      invalid: true,
      error: 'Usage: --workspace-root <path>',
      workspaceRoot: resolve(cwd),
      planningDir: resolveStateDir(resolve(cwd)).dir,
    };
  }

  if (workspaceRootArg) {
    const explicitRoot = normalizePath(workspaceRootArg, cwd);
    let explicitStat;
    try {
      explicitStat = lstatIfPresent(explicitRoot, lstat);
    } catch (inspectionError) {
      return invalidInspectionContext(args, explicitRoot, inspectionError);
    }
    if (!explicitStat || explicitStat.isSymbolicLink() || !explicitStat.isDirectory()) {
      return {
        args,
        invalid: true,
        error: `Workspace root is not a real directory: ${workspaceRootArg}`,
        workspaceRoot: explicitRoot,
        planningDir: resolveStateDir(explicitRoot).dir,
      };
    }
  }

  const candidates = [];

  if (workspaceRootArg) candidates.push(normalizePath(workspaceRootArg, cwd));

  let discovered;
  try {
    discovered = findWorkspaceRoot(cwd, { lstat, readFile });
  } catch (inspectionError) {
    return invalidInspectionContext(args, inspectionError.workspaceRoot ?? resolve(cwd), inspectionError);
  }
  if (discovered) candidates.push(discovered);

  if (env.GSDD_WORKSPACE_ROOT) candidates.push(normalizePath(env.GSDD_WORKSPACE_ROOT, cwd));

  candidates.push(resolve(cwd));

  for (const candidate of candidates) {
    let marked;
    try {
      marked = isWorkspaceRoot(candidate, lstat, readFile);
    } catch (inspectionError) {
      return invalidInspectionContext(args, candidate, inspectionError);
    }
    if (marked || (workspaceRootArg && candidate === normalizePath(workspaceRootArg, cwd))) {
      const state = resolveStateDir(candidate);
      return {
        args,
        invalid: false,
        workspaceRoot: candidate,
        planningDir: state.dir,
        stateDirName: state.name,
        migrationNotice: state.migrationNotice,
        state,
      };
    }
  }

  const fallbackRoot = candidates[0] ?? resolve(cwd);
  const state = resolveStateDir(fallbackRoot);
  return {
    args,
    invalid: false,
    workspaceRoot: fallbackRoot,
    planningDir: state.dir,
    stateDirName: state.name,
    migrationNotice: state.migrationNotice,
    state,
  };
}

function invalidInspectionContext(args, workspaceRoot, error) {
  const root = resolve(workspaceRoot);
  const message = error?.code === 'workspace_inspection_failed'
    ? error.message
    : `Workspace markers could not be inspected at ${root}: ${error.message}`;
  return {
    args,
    invalid: true,
    error: message,
    workspaceRoot: root,
    planningDir: join(root, '.work'),
    stateDirName: '.work',
  };
}

export function bootstrapHelperWorkspace(entryFileUrl, env = process.env) {
  const helperRoot = deriveWorkspaceRootFromHelperLocation(entryFileUrl);
  if (!helperRoot) return null;
  env.GSDD_WORKSPACE_ROOT = helperRoot;
  try {
    process.chdir(helperRoot);
  } catch {
    // best-effort: commands also resolve from env/upward search
  }
  return helperRoot;
}
