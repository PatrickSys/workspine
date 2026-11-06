import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveStateDir } from './state-dir.mjs';

export const DEFAULT_INTEGRATIONS = Object.freeze({
  codebaseContext: Object.freeze({
    enabled: false,
    command: 'codebase-context',
  }),
});

export function mergeIntegrations(existing = {}) {
  const cc = existing.codebaseContext ?? {};
  return {
    codebaseContext: {
      ...DEFAULT_INTEGRATIONS.codebaseContext,
      ...cc,
      enabled: cc.enabled === true,
    },
  };
}

export function mergeCodebaseContextIntegration(config = {}) {
  return mergeIntegrations(config.integrations).codebaseContext;
}

function readConfigObject(cwd) {
  const configPath = join(resolveStateDir(cwd).dir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Minimal config surface for the generated `.work/bin` helper (no full models/rigor stack). */
export function loadProjectModelConfig(cwd = process.cwd()) {
  const existing = readConfigObject(cwd);
  return {
    integrations: mergeIntegrations(existing?.integrations),
  };
}

export function writeProjectConfig(config, cwd = process.cwd()) {
  const configPath = join(resolveStateDir(cwd).dir, 'config.json');
  const existing = readConfigObject(cwd) ?? {};
  writeFileSync(configPath, JSON.stringify({ ...existing, ...config, integrations: config.integrations ?? mergeIntegrations(existing.integrations) }, null, 2));
}

export function patchIntegrations(cwd, patch) {
  const configPath = join(resolveStateDir(cwd).dir, 'config.json');
  const existing = readConfigObject(cwd) ?? {};
  const nextIntegrations = mergeIntegrations(existing.integrations);
  if (patch.codebaseContext) {
    nextIntegrations.codebaseContext = {
      ...nextIntegrations.codebaseContext,
      ...patch.codebaseContext,
      enabled: patch.codebaseContext.enabled === true,
    };
  }
  writeFileSync(configPath, `${JSON.stringify({ ...existing, integrations: nextIntegrations }, null, 2)}\n`);
  return nextIntegrations.codebaseContext;
}
