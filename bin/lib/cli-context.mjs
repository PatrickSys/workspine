// Dependency wiring for the CLI. Held here rather than in bin/gsdd.mjs so the
// entrypoint stays a dispatch table and nothing else.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createAdapterRegistry } from '../adapters/index.mjs';
import {
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
  upsertBoundedBlock,
  getDelegateContent,
} from './rendering.mjs';
import { loadProjectModelConfig, getRuntimeModelOverride, resolveRuntimeAgentModel } from './config.mjs';
import { resolveStateDir } from './state-dir.mjs';
import { FRAMEWORK_VERSION, WORKFLOWS } from './workflows.mjs';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTILLED_DIR = join(PACKAGE_ROOT, 'distilled');
const AGENTS_DIR = join(PACKAGE_ROOT, 'agents');
const PACKAGE_JSON = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'));

export function createCliContext(cwd = process.cwd()) {
  const state = resolveStateDir(cwd);
  return {
    cwd,
    planningDir: state.dir,
    stateDirName: state.name,
    distilledDir: DISTILLED_DIR,
    agentsDir: AGENTS_DIR,
    packageName: PACKAGE_JSON.name,
    packageVersion: PACKAGE_JSON.version,
    workflows: WORKFLOWS,
    frameworkVersion: FRAMEWORK_VERSION,
    loadProjectModelConfig,
    getRuntimeModelOverride,
    resolveRuntimeAgentModel,
    adapters: createAdapterRegistry({
      cwd,
      workflows: WORKFLOWS,
      stateDirName: state.name,
      renderAgentsBoundedBlock,
      renderAgentsFileContent,
      renderOpenCodeCommandContent,
      renderSkillContent,
      upsertBoundedBlock,
      getDelegateContent,
      loadProjectModelConfig,
      getRuntimeModelOverride,
      resolveRuntimeAgentModel,
    }),
  };
}
