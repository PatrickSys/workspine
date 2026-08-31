import { lstatSync, readFileSync, realpathSync, statSync } from 'fs';
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

function symlinkInPath(target, lstat = lstatSync) {
  let current = resolve(target);
  while (true) {
    const stat = lstatIfPresent(current, lstat);
    if (stat?.isSymbolicLink()) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function invalidSymlinkRoot(root, link) {
  const error = new Error(`Workspace root path contains a symlink at ${link}. Use the real directory path before retrying.`);
  error.code = 'workspace_symlink_root';
  error.workspaceRoot = root;
  error.symlinkPath = link;
  return error;
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

function canonicalPath(target) {
  try {
    return realpathSync.native ? realpathSync.native(target) : realpathSync(target);
  } catch {
    return target;
  }
}

// A plain string compare on the tmpdir sentinel is defeated by three things measured in review: NTFS
// path casing, since `TEMP` may legally name the same directory as `C:\USERS\...`, including the 8.3
// short names that are the norm on Windows CI runners; and macOS `/var` versus `/private/var`, where
// `process.cwd()` is realpath-resolved and `os.tmpdir()` is not. Compare canonicalised paths, and
// case-insensitively on Windows.
function isSamePath(left, right) {
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (normalize(left) === normalize(right)) return true;
  return normalize(canonicalPath(left)) === normalize(canonicalPath(right));
}

function statIfPresent(filePath) {
  // Deliberately follows links. Git's own `validate_headref` accepts a HEAD symlink into `refs/`,
  // and `objects` is routinely a junction or symlink to shared storage. Using `lstat` here refused
  // real repositories -- measured by review against git 2.46: an objects junction, a HEAD symlink,
  // and a pre-2006 layout were all rejected while `git rev-parse` accepted them.
  try {
    return statSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function isValidHeadContent(text) {
  const line = String(text).split(/\r?\n/)[0].trim();
  if (/^ref:\s*refs\/.+/.test(line)) return true;
  return /^[0-9a-f]{40}$/.test(line) || /^[0-9a-f]{64}$/.test(line);
}

function hasGitCoreLayout(dir) {
  const objects = statIfPresent(join(dir, 'objects'));
  const refs = statIfPresent(join(dir, 'refs'));
  return Boolean(objects?.isDirectory() && refs?.isDirectory());
}

function isPlausibleGitDir(gitDir, readFile) {
  // A `.git` directory that Git itself disowns is not a project root. Measured 2026-08-23: a hollow
  // `C:/Users/<user>/.git` holding only `info/exclude` made the home directory look like a repository,
  // so every command run from a non-Git directory beneath it initialised a workspace *there* instead
  // of locally -- silently, exit 0. `git rev-parse` refused the same directory three ways.
  //
  // This mirrors what git's `is_git_directory()` checks: a HEAD that validates, plus `objects/` and
  // `refs/`. For a linked worktree those two live in the common directory, so `commondir` is resolved
  // first. An earlier version checked only HEAD plus `objects/`-or-`commondir`, which review broke six
  // ways -- an empty HEAD beside an empty `objects/` was accepted while git refused it.
  const head = statIfPresent(join(gitDir, 'HEAD'));
  if (!head || !head.isFile()) return false;
  let headText;
  try {
    headText = readFile(join(gitDir, 'HEAD'), 'utf-8');
  } catch {
    return false;
  }
  if (!isValidHeadContent(headText)) return false;

  const commondir = statIfPresent(join(gitDir, 'commondir'));
  if (commondir?.isFile()) {
    let target;
    try {
      target = String(readFile(join(gitDir, 'commondir'), 'utf-8')).trim();
    } catch {
      return false;
    }
    if (!target) return false;
    return hasGitCoreLayout(resolve(gitDir, target));
  }

  return hasGitCoreLayout(gitDir);
}

function hasGitMarker(root, lstat, readFile) {
  const markerPath = join(root, '.git');
  const marker = lstatIfPresent(markerPath, lstat);
  if (!marker) return false;
  if (marker.isSymbolicLink()) throw invalidGitMarker(root, 'marker is a symbolic link');
  if (marker.isDirectory()) return isPlausibleGitDir(markerPath, readFile);
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
  return isPlausibleGitDir(targetPath, readFile);
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
  let depth = 0;

  // Discovery returns a path that later mutators use verbatim. If any component of the invocation
  // chain is a link, that lexical path can point outside the directory the caller believes it named;
  // reject the chain before marker discovery rather than admitting a real root through the link.
  const linkedPath = symlinkInPath(current, lstat);
  if (linkedPath) throw invalidSymlinkRoot(current, linkedPath);

  while (true) {
    const atTemporaryRoot = isSamePath(current, temporaryRoot);

    // Two sentinel checks, and BOTH are load-bearing. The pre-check refuses to let a marker sitting
    // at `os.tmpdir()` admit a descendant: it used to be checked only after the marker match, so
    // such a `.work` was captured anyway despite a guard existing for that exact path -- measured
    // 2026-08-23, a command run from a temp subdirectory rewrote a workspace at the temp root, exit
    // 0, creating nothing locally. Depth 0 is exempt from the pre-check because that is the
    // directory the user is standing in, and its own marker admits it whatever its path.
    //
    // The post-check terminates the walk. Removing it in favour of the pre-check alone was a
    // containment REGRESSION caught in review: standing in `os.tmpdir()` with no marker there, the
    // walk no longer stopped and climbed into the home directory, adopting a `.work` the baseline
    // could never reach.
    if (depth > 0 && atTemporaryRoot) return null;
    if (isWorkspaceRoot(current, lstat, readFile)) return current;
    if (atTemporaryRoot) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
    depth += 1;
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
        planningDir: join(explicitRoot, '.work'),
        stateDirName: '.work',
      };
    }
    const linkedPath = symlinkInPath(explicitRoot, lstat);
    if (linkedPath) {
      const error = invalidSymlinkRoot(explicitRoot, linkedPath);
      return invalidInspectionContext(args, explicitRoot, error);
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
    const linkedPath = symlinkInPath(candidate, lstat);
    if (linkedPath) {
      const error = invalidSymlinkRoot(candidate, linkedPath);
      return invalidInspectionContext(args, candidate, error);
    }
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
