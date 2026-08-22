#!/usr/bin/env node
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { createCliContext } from './lib/cli-context.mjs';
import { cmdModels, cmdRigor } from './lib/config.mjs';
import { createCmdInit, createCmdUpdate, cmdHelp } from './lib/init.mjs';
import { createCmdInstall } from './lib/global-install.mjs';
import { cmdFindPhase, cmdVerify, cmdScaffold, cmdPhaseStatus } from './lib/phase.mjs';
import { cmdFileOp } from './lib/file-ops.mjs';
import { createCmdHealth } from './lib/health.mjs';
import { cmdLifecyclePreflight, cmdLifecycleTransition } from './lib/lifecycle-preflight.mjs';
import { cmdDecisions, cmdRemember } from './lib/decision-cli.mjs';
import { createCmdJourney } from './lib/journey.mjs';
import { createCmdNext } from './lib/next.mjs';
import { resolveWorkspaceContext } from './lib/workspace-root.mjs';
import { createCmdGitIdentity } from './lib/git-identity.mjs';
import { maybeShowUpdateNotice } from './lib/update-awareness.mjs';
import { FRAMEWORK_VERSION } from './lib/workflows.mjs';
const __filename = fileURLToPath(import.meta.url);
const IS_MAIN = process.argv[1] ? realpathSync(process.argv[1]) === realpathSync(__filename) : false;

const [,, command, ...args] = process.argv;

const INIT_CONTEXT = createCliContext(process.cwd());
const cmdInit = createCmdInit(INIT_CONTEXT);
const cmdInstall = createCmdInstall(INIT_CONTEXT);
const cmdHealth = createCmdHealth(INIT_CONTEXT);
const cmdNext = createCmdNext(INIT_CONTEXT);
const cmdJourney = createCmdJourney(INIT_CONTEXT);
const cmdGitIdentity = createCmdGitIdentity(INIT_CONTEXT);

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
  'lifecycle-transition': cmdLifecycleTransition,
  remember: cmdRemember,
  decisions: cmdDecisions,
  journey: cmdJourney,
  'git-identity': cmdGitIdentity,
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

  const update = await maybeShowUpdateNotice({
    cwd: INIT_CONTEXT.cwd,
    command: cliCommand,
    args: normalizedArgs,
    packageName: INIT_CONTEXT.packageName,
    packageVersion: INIT_CONTEXT.packageVersion,
    source: 'public-cli',
    output: (line) => console.error(line),
  });
  await COMMANDS[cliCommand](...update.args);
}

if (IS_MAIN) {
  await runCli();
  // D-47: interactive prompts (raw-mode keypress pickers) can leave stdin
  // referenced; release it so the process exits when work is done.
  if (process.stdin.isTTY) {
    process.stdin.pause();
    if (typeof process.stdin.unref === 'function') process.stdin.unref();
  }
}
export { cmdHelp, cmdInit, cmdInstall, cmdUpdate, cmdModels, cmdRigor, cmdHealth, cmdNext, cmdJourney, cmdGitIdentity, cmdFileOp, cmdLifecyclePreflight, cmdLifecycleTransition, cmdRemember, cmdDecisions, cmdFindPhase, cmdPhaseStatus, cmdVerify, cmdScaffold, runCli, FRAMEWORK_VERSION, createCliContext };
