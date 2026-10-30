import {
  cmdCodebaseContextSubcommand,
  createCodebaseContextRunner,
  showIntegrationStatus,
} from './integrations/codebase-context.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import { validateCommandShape } from './init-runtime.mjs';
import { execFileSync } from 'child_process';
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

export function createCmdIntegrations({ cwd = process.cwd(), runner = null } = {}) {
  const defaultRunner = runner ?? createCodebaseContextRunner({ execFile: execFileSync });

  return function cmdIntegrations(...integrationArgs) {
    const grammarError = validateCommandShape('integrations', integrationArgs);
    if (grammarError) {
      console.error(grammarError);
      process.exitCode = 1;
      return;
    }

    const json = integrationArgs.includes('--json');
    const workspaceRoot = resolveIntegrationsRoot(integrationArgs, cwd);
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
      }
      return;
    }

    if (first === 'codebase-context') {
      return cmdCodebaseContextSubcommand(second, [...rest, ...(json ? ['--json'] : [])], {
        cwd: workspaceRoot.workspaceRoot,
        json,
        runner: defaultRunner,
      });
    }

    console.error('Usage: workspine integrations [show] | codebase-context <plan-context|edit-preflight|enable|disable|show> [flags]');
    process.exitCode = 1;
  };
}
