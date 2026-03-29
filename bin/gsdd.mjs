#!/usr/bin/env node

// gsdd - GSD Distilled CLI

import { realpathSync } from 'fs';
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
import { loadProjectModelConfig, getRuntimeModelOverride, resolveRuntimeAgentModel, cmdModels } from './lib/models.mjs';
import { createCmdInit, createCmdUpdate, cmdHelp } from './lib/init.mjs';
import { cmdFindPhase, cmdVerify, cmdScaffold } from './lib/phase.mjs';
import { createCmdHealth } from './lib/health.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', 'distilled');
const AGENTS_DIR = join(__dirname, '..', 'agents');
const CWD = process.cwd();
const IS_MAIN = process.argv[1]
  ? realpathSync(process.argv[1]) === realpathSync(__filename)
  : false;

const [,, command, ...args] = process.argv;

function defineWorkflow({ mutatesArtifacts = true, ...workflow }) {
  return {
    ...workflow,
    mutatesArtifacts,
    agent: mutatesArtifacts ? 'Code' : 'Plan',
    opencodeType: mutatesArtifacts ? 'edit' : 'plan',
  };
}

const WORKFLOWS = [
  defineWorkflow({ name: 'gsdd-new-project', workflow: 'new-project.md', description: 'New project - questioning, codebase audit, research, spec, roadmap' }),
  defineWorkflow({ name: 'gsdd-map-codebase', workflow: 'map-codebase.md', description: 'Map or refresh codebase - 4 parallel mappers, staleness check, secrets scan' }),
  defineWorkflow({ name: 'gsdd-plan', workflow: 'plan.md', description: 'Plan a phase - research check, backward planning, task creation' }),
  defineWorkflow({ name: 'gsdd-execute', workflow: 'execute.md', description: 'Execute a phase plan - implement tasks, verify changes, follow repo git conventions' }),
  defineWorkflow({ name: 'gsdd-verify', workflow: 'verify.md', description: 'Verify a completed phase - 3-level checks, anti-pattern scan' }),
  defineWorkflow({ name: 'gsdd-verify-work', workflow: 'verify-work.md', description: 'Conversational UAT testing - validate user-facing behavior with structured gap tracking' }),
  defineWorkflow({ name: 'gsdd-audit-milestone', workflow: 'audit-milestone.md', description: 'Audit a completed milestone - cross-phase integration, requirements coverage, E2E flows' }),
  defineWorkflow({ name: 'gsdd-complete-milestone', workflow: 'complete-milestone.md', description: 'Complete milestone - archive, evolve spec, collapse roadmap' }),
  defineWorkflow({ name: 'gsdd-new-milestone', workflow: 'new-milestone.md', description: 'New milestone - gather goals, define requirements, create roadmap phases' }),
  defineWorkflow({ name: 'gsdd-plan-milestone-gaps', workflow: 'plan-milestone-gaps.md', description: 'Plan gap closure phases from audit results' }),
  defineWorkflow({ name: 'gsdd-quick', workflow: 'quick.md', description: 'Quick task - plan and execute a sub-hour task outside the phase cycle' }),
  defineWorkflow({ name: 'gsdd-pause', workflow: 'pause.md', description: 'Pause work - save session context for seamless resumption' }),
  defineWorkflow({ name: 'gsdd-resume', workflow: 'resume.md', description: 'Resume work - restore context and route to next action' }),
  defineWorkflow({ name: 'gsdd-progress', workflow: 'progress.md', description: 'Check progress - show project status and route to next action', mutatesArtifacts: false }),
];

const FRAMEWORK_VERSION = 'v1.3';

function createCliContext(cwd = process.cwd()) {
  return {
    cwd,
    planningDir: join(cwd, '.planning'),
    distilledDir: DISTILLED_DIR,
    agentsDir: AGENTS_DIR,
    workflows: WORKFLOWS,
    frameworkVersion: FRAMEWORK_VERSION,
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

const INIT_CONTEXT = createCliContext(CWD);

const cmdInit = createCmdInit(INIT_CONTEXT);
const cmdUpdate = createCmdUpdate(INIT_CONTEXT);
const cmdHealth = createCmdHealth({ frameworkVersion: FRAMEWORK_VERSION });

const COMMANDS = {
  init: cmdInit,
  update: cmdUpdate,
  models: cmdModels,
  health: cmdHealth,
  'find-phase': cmdFindPhase,
  verify: cmdVerify,
  scaffold: cmdScaffold,
  help: cmdHelp,
};

async function runCli(cliCommand = command, cliArgs = args) {
  if (!cliCommand || !COMMANDS[cliCommand]) {
    cmdHelp();
    if (cliCommand) process.exitCode = 1;
    return;
  }

  await COMMANDS[cliCommand](...cliArgs);
}

if (IS_MAIN) {
  await runCli();
}

export { cmdHelp, cmdInit, cmdUpdate, cmdModels, cmdHealth, cmdFindPhase, cmdVerify, cmdScaffold, runCli, FRAMEWORK_VERSION, createCliContext };
