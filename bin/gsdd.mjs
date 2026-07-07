#!/usr/bin/env node
import { realpathSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createAdapterRegistry } from './adapters/index.mjs';
import {
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
  upsertBoundedBlock,
  getDelegateContent,
} from './lib/rendering.mjs';
import { loadProjectModelConfig, getRuntimeModelOverride, resolveRuntimeAgentModel, cmdModels, cmdRigor } from './lib/config.mjs';
import { createCmdInit, createCmdUpdate, cmdHelp } from './lib/init.mjs';
import { createCmdInstall } from './lib/global-install.mjs';
import { cmdFindPhase, cmdVerify, cmdScaffold, cmdPhaseStatus } from './lib/phase.mjs';
import { cmdFileOp } from './lib/file-ops.mjs';
import { createCmdHealth } from './lib/health.mjs';
import { cmdLifecyclePreflight } from './lib/lifecycle-preflight.mjs';
import { cmdSessionFingerprint } from './lib/session-fingerprint.mjs';
import { cmdUiProof } from './lib/ui-proof.mjs';
import { cmdControlMap } from './lib/control-map.mjs';
import { createCmdCloseoutReport } from './lib/closeout-report.mjs';
import { createCmdNext } from './lib/next.mjs';
import { resolveWorkspaceContext } from './lib/workspace-root.mjs';
import { FRAMEWORK_VERSION, WORKFLOWS } from './lib/workflows.mjs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', 'distilled');
const AGENTS_DIR = join(__dirname, '..', 'agents');
const PACKAGE_JSON = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const IS_MAIN = process.argv[1] ? realpathSync(process.argv[1]) === realpathSync(__filename) : false;

const [,, command, ...args] = process.argv;

function createCliContext(cwd = process.cwd()) {
  return {
    cwd,
    planningDir: join(cwd, '.planning'),
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

const INIT_CONTEXT = createCliContext(process.cwd());
const cmdInit = createCmdInit(INIT_CONTEXT);
const cmdInstall = createCmdInstall(INIT_CONTEXT);
const cmdHealth = createCmdHealth(INIT_CONTEXT);
const cmdCloseoutReport = createCmdCloseoutReport(INIT_CONTEXT);
const cmdNext = createCmdNext(INIT_CONTEXT);

const cmdUpdate = (...updateArgs) => {
  const { args: normalizedArgs, workspaceRoot, invalid, error } = resolveWorkspaceContext(updateArgs, { cwd: INIT_CONTEXT.cwd });
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  return createCmdUpdate(createCliContext(workspaceRoot))(...normalizedArgs);
};
const COMMANDS = {
  init: cmdInit,
  install: cmdInstall,
  update: cmdUpdate,
  models: cmdModels,
  rigor: cmdRigor,
  health: cmdHealth,
  next: cmdNext,
  'file-op': cmdFileOp,
  'lifecycle-preflight': cmdLifecyclePreflight,
  'session-fingerprint': cmdSessionFingerprint,
  'ui-proof': cmdUiProof,
  'control-map': cmdControlMap,
  'closeout-report': cmdCloseoutReport,
  'find-phase': cmdFindPhase,
  'phase-status': cmdPhaseStatus,
  verify: cmdVerify,
  scaffold: cmdScaffold,
  help: cmdHelp,
};

async function runCli(cliCommand = command, ...cliArgs) {
  const normalizedArgs = cliArgs.length === 0
    ? args
    : cliArgs.length === 1 && Array.isArray(cliArgs[0])
      ? cliArgs[0]
      : cliArgs;

  process.exitCode = 0;

  if (!cliCommand || !COMMANDS[cliCommand]) {
    cmdHelp();
    if (cliCommand) process.exitCode = 1;
    return;
  }

  await COMMANDS[cliCommand](...normalizedArgs);
}

if (IS_MAIN) await runCli();
export { cmdHelp, cmdInit, cmdInstall, cmdUpdate, cmdModels, cmdRigor, cmdHealth, cmdNext, cmdFileOp, cmdLifecyclePreflight, cmdSessionFingerprint, cmdUiProof, cmdControlMap, cmdCloseoutReport, cmdFindPhase, cmdPhaseStatus, cmdVerify, cmdScaffold, runCli, FRAMEWORK_VERSION, createCliContext };
