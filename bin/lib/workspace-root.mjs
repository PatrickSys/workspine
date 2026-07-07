import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hasStateMarker, resolveStateDir } from './state-dir.mjs';

function normalizePath(value, cwd) {
  return resolve(cwd, String(value));
}

function hasPlanningMarker(root) {
  return hasStateMarker(root);
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

export function findWorkspaceRoot(startDir = process.cwd()) {
  let current = resolve(startDir);

  while (true) {
    if (hasPlanningMarker(current)) return current;
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

export function resolveWorkspaceContext(rawArgs = [], { cwd = process.cwd(), env = process.env } = {}) {
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
    if (!hasPlanningMarker(explicitRoot)) {
      return {
        args,
        invalid: true,
        error: `Workspace root does not contain .work/ or .planning/: ${workspaceRootArg}`,
        workspaceRoot: explicitRoot,
        planningDir: resolveStateDir(explicitRoot).dir,
      };
    }
  }

  const candidates = [];

  if (workspaceRootArg) candidates.push(normalizePath(workspaceRootArg, cwd));

  const discovered = findWorkspaceRoot(cwd);
  if (discovered) candidates.push(discovered);

  if (env.GSDD_WORKSPACE_ROOT) candidates.push(normalizePath(env.GSDD_WORKSPACE_ROOT, cwd));

  candidates.push(resolve(cwd));

  for (const candidate of candidates) {
    if (hasPlanningMarker(candidate)) {
      return {
        args,
        invalid: false,
        workspaceRoot: candidate,
        planningDir: resolveStateDir(candidate).dir,
        stateDirName: resolveStateDir(candidate).name,
        migrationNotice: resolveStateDir(candidate).migrationNotice,
      };
    }
  }

  const fallbackRoot = candidates[0] ?? resolve(cwd);
  return {
    args,
    invalid: false,
    workspaceRoot: fallbackRoot,
    planningDir: resolveStateDir(fallbackRoot).dir,
    stateDirName: resolveStateDir(fallbackRoot).name,
    migrationNotice: resolveStateDir(fallbackRoot).migrationNotice,
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
