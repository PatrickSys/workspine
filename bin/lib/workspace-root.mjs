import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

function normalizePath(value, cwd) {
  return resolve(cwd, String(value));
}

function hasPlanningMarker(root) {
  return existsSync(join(root, '.planning', 'config.json')) || existsSync(join(root, '.planning'));
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
      planningDir: join(resolve(cwd), '.planning'),
    };
  }

  if (workspaceRootArg) {
    const explicitRoot = normalizePath(workspaceRootArg, cwd);
    if (!hasPlanningMarker(explicitRoot)) {
      return {
        args,
        invalid: true,
        error: `Workspace root does not contain .planning/: ${workspaceRootArg}`,
        workspaceRoot: explicitRoot,
        planningDir: join(explicitRoot, '.planning'),
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
        planningDir: join(candidate, '.planning'),
      };
    }
  }

  const fallbackRoot = candidates[0] ?? resolve(cwd);
  return {
    args,
    invalid: false,
    workspaceRoot: fallbackRoot,
    planningDir: join(fallbackRoot, '.planning'),
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
