import {
  cmdCodebaseContextSubcommand,
  createCodebaseContextRunner,
  showIntegrationStatus,
} from './integrations/codebase-context.mjs';
import { loadProjectModelConfig } from './integrations-config.mjs';
import { output } from './cli-utils.mjs';
import { assertStateAuthority } from './state-dir.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import { execFileSync } from 'child_process';

const CC_SUBCOMMANDS = new Set(['plan-context', 'edit-preflight', 'enable', 'disable', 'show']);

function resolveIntegrationsRoot(flagArgs, cwd) {
  const workspace = resolveWorkspaceContext(flagArgs, { cwd });
  if (workspace.invalid) {
    console.error(`ERROR: ${workspace.error}`);
    process.exitCode = 1;
    return null;
  }
  try {
    assertStateAuthority(workspace.state);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
  return { workspaceRoot: workspace.workspaceRoot, flagArgs: workspace.args ?? flagArgs };
}

function positionalArgs(flagArgs) {
  const skip = new Set(['--json', '--workspace-root']);
  const out = [];
  for (let i = 0; i < flagArgs.length; i += 1) {
    const token = flagArgs[i];
    if (skip.has(token)) {
      if (token === '--workspace-root') i += 1;
      continue;
    }
    if (token.startsWith('--')) {
      if (['--files', '--plan', '--query', '--task'].includes(token)) i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

function subcommandFlagArgs(integrationArgs) {
  const positionals = positionalArgs(integrationArgs);
  const [first, second] = positionals;
  const drop = new Set(['integrations', first, second].filter(Boolean));
  const out = [];
  for (let i = 0; i < integrationArgs.length; i += 1) {
    const token = integrationArgs[i];
    if (drop.has(token)) continue;
    if (token === '--workspace-root') {
      i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

function validateIntegrationsShape(integrationArgs) {
  const positionals = positionalArgs(integrationArgs);
  const [first, second] = positionals;
  if (positionals.length === 0 || first === 'show') return null;
  if (first === 'codebase-context' && CC_SUBCOMMANDS.has(second)) return null;
  return 'Usage: workspine integrations [show] | codebase-context <plan-context|edit-preflight|enable|disable|show> [flags]';
}

export function createCmdIntegrations({ cwd = process.cwd(), getCwd = null, runner = null } = {}) {
  const defaultRunner = runner ?? createCodebaseContextRunner({ execFile: execFileSync });
  const resolveCwd = () => (typeof getCwd === 'function' ? getCwd() : cwd);

  return function cmdIntegrations(...integrationArgs) {
    const grammarError = validateIntegrationsShape(integrationArgs);
    if (grammarError) {
      console.error(grammarError);
      process.exitCode = 1;
      return;
    }

    const json = integrationArgs.includes('--json');
    const workspaceRoot = resolveIntegrationsRoot(integrationArgs, resolveCwd());
    if (!workspaceRoot) return;

    const positionals = positionalArgs(workspaceRoot.flagArgs);
    const [first, second, ...rest] = positionals;

    if (!first || first === 'show') {
      const config = loadProjectModelConfig(workspaceRoot.workspaceRoot);
      const status = showIntegrationStatus({ config, workspaceRoot: workspaceRoot.workspaceRoot, runner: defaultRunner });
      if (json) output(status);
      else {
        const cc = status.integrations.codebaseContext;
        console.log(`codebase-context: ${cc.enabled ? 'enabled' : 'disabled'} (cli: ${cc.cli_available ? 'available' : 'missing'})`);
        console.log(`  command: ${cc.command}`);
        console.log(`  artifacts: ${cc.artifact_dir}`);
        console.log('  bridge: Workspine plan-context → CC `patterns` + `search --intent explore`; edit-preflight → `search --intent edit`');
      }
      return;
    }

    if (first === 'codebase-context') {
      const flagArgs = subcommandFlagArgs(workspaceRoot.flagArgs);
      if (json && !flagArgs.includes('--json')) flagArgs.push('--json');
      return cmdCodebaseContextSubcommand(second, flagArgs, {
        cwd: workspaceRoot.workspaceRoot,
        json,
        runner: defaultRunner,
      });
    }

    console.error('Usage: workspine integrations [show] | codebase-context <plan-context|edit-preflight|enable|disable|show> [flags]');
    process.exitCode = 1;
  };
}
