import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';

const RUNTIMES = Object.freeze(['claude', 'opencode', 'codex']);

// The public models CLI and the generated, read-only workflow helper must
// resolve the same executor override without importing an entire native
// adapter runtime into .work/bin/lib/.
export function getRuntimeExecutorModelState(config, runtime) {
  const value = config?.runtimeModelOverrides?.[runtime]?.executor;
  const model = typeof value === 'string' && value.trim() ? value.trim() : null;
  return { mode: model ? 'override' : 'inherit', model };
}

export function executorModelSnapshot(config) {
  return Object.fromEntries(RUNTIMES.map((runtime) => [
    runtime, { executor: getRuntimeExecutorModelState(config, runtime) },
  ]));
}

// This reader is deliberately scoped to the generated helper's sole new
// command: models show. Refuse an absent/malformed/linked config rather than
// claiming inheritance when the user's persisted selection is unreadable.
export function readExecutorModelsForHelper(workspaceRoot) {
  const configPath = join(workspaceRoot, '.work', 'config.json');
  let config;
  try {
    const stat = lstatSync(configPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular configuration file');
    config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('not a JSON object');
  } catch {
    const error = new Error('Unable to read a valid .work/config.json; executor model selection is unknown. Repair the config before delegating execution.');
    error.code = 'executor_model_config_unreadable';
    throw error;
  }

  return {
    schema_version: 1,
    operation: 'models show',
    scope: 'executor',
    effective: executorModelSnapshot(config),
  };
}
