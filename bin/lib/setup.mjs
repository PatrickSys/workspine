import { existsSync, lstatSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { createCmdInit } from './init-flow.mjs';
import { createCmdInstall, resolveGlobalInstallRoots } from './global-install.mjs';
import { promptConfirm, promptMultiSelect } from './init-prompts.mjs';
import { parseFlagValue } from './cli-utils.mjs';
import { GLOBAL_AGENT_OPTIONS, validateCommandShape } from './init-runtime.mjs';
import { resolveStateDir, stateAuthorityGate } from './state-dir.mjs';
import { migrateLegacyState } from './state-migration.mjs';
import { buildDefaultConfig } from './config.mjs';

const PROJECT_AGENTS = new Set(['claude', 'opencode', 'codex', 'generic']);
const GLOBAL_AGENTS = new Set(['claude', 'opencode', 'codex', 'copilot']);
const PROJECT_ALL = ['claude', 'opencode', 'codex', 'agents'];
const GLOBAL_ALL = ['claude', 'opencode', 'codex', 'copilot'];

function setupUsage() {
  return 'Usage: workspine setup [-g|--global] [--agent <claude|opencode|codex|generic|copilot>] [--all] [-y|--yes] [--dry-run] [--workspace-root <path>] [--migrate]';
}

function gitTopLevel(cwd) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  const candidate = resolve(result.stdout.trim());
  try {
    const stat = statSync(candidate);
    return stat.isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function setupRoot(rawArgs, cwd) {
  const explicit = parseFlagValue(rawArgs, '--workspace-root');
  if (explicit.present && explicit.invalid) return { invalid: true, error: 'Flag --workspace-root requires a value' };
  if (explicit.value) {
    const root = resolve(cwd, explicit.value);
    try {
      const stat = lstatSync(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { invalid: true, error: `Workspace root is not a real directory: ${explicit.value}` };
    } catch {
      return { invalid: true, error: `Workspace root is not a real directory: ${explicit.value}` };
    }
    return { root };
  }
  return { root: gitTopLevel(cwd) ?? resolve(cwd) };
}

function selectedProjectTools(agent, all) {
  if (all) return [...PROJECT_ALL];
  if (agent === 'generic') return ['agents'];
  // `portable` is an intentionally internal init-flow selector: it satisfies the retained
  // init --auto grammar while leaving optional root AGENTS.md governance opt-in.
  return agent ? [agent] : ['portable'];
}

function detectGlobalTargets(roots) {
  return GLOBAL_ALL.filter((target) => existsSync(roots[target]));
}

async function chooseGlobalTargets({ detected, input = process.stdin, output = process.stdout }) {
  return promptMultiSelect({
    input,
    output,
    title: 'Select agent homes',
    hint: 'Space toggles, Enter confirms. Existing detected homes are recommended.',
    choices: GLOBAL_AGENT_OPTIONS.map((option) => ({
      ...option,
      selected: detected.includes(option.id),
      detected: detected.includes(option.id),
    })),
  });
}

async function confirmSetup({ promptApi, details, input = process.stdin, output = process.stdout }) {
  if (promptApi?.confirmSetup) return promptApi.confirmSetup({ details });
  return promptConfirm({
    input,
    output,
    title: 'Ready to set up Workspine',
    prompt: 'Create the bounded setup files now?',
    defaultValue: true,
    details,
  });
}

function printProjectDryRun(root, tools) {
  console.log('Workspine setup (dry run)');
  console.log(`  scope: project (${root})`);
  console.log('  - would create .work/ and portable .agents/skills/work-*');
  for (const tool of tools.filter((entry) => !['agents', 'portable'].includes(entry))) console.log(`  - would create ${tool} native surfaces`);
  if (tools.includes('agents')) console.log('  - would update root AGENTS.md governance');
  console.log('  No files were written.');
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function setupMigrationMessage(state) {
  const message = stateAuthorityGate(state).message;
  return message.replace(/npx -y workspine init --migrate/g, 'npx -y workspine setup --migrate');
}

export function createCmdSetup(ctx) {
  return async function cmdSetup(...setupArgs) {
    const shapeError = validateCommandShape('setup', setupArgs);
    if (shapeError) return fail(`${shapeError}\n${setupUsage()}`);

    const globalScope = setupArgs.includes('-g') || setupArgs.includes('--global');
    const all = setupArgs.includes('--all');
    const yes = setupArgs.includes('-y') || setupArgs.includes('--yes');
    const dryRun = setupArgs.includes('--dry-run') || setupArgs.includes('--dry');
    let migrate = setupArgs.includes('--migrate');
    const agentValue = parseFlagValue(setupArgs, '--agent');
    const agent = agentValue.value;

    if (agent && !(globalScope ? GLOBAL_AGENTS : PROJECT_AGENTS).has(agent)) {
      const allowed = globalScope ? [...GLOBAL_AGENTS] : [...PROJECT_AGENTS];
      return fail(`unsupported ${globalScope ? 'global' : 'project'} setup agent '${agent}'. Choose ${allowed.join(', ')}.`);
    }
    if (all && agent) return fail('--all and --agent cannot be combined. Choose one target selection.');
    if (migrate && globalScope) return fail('--migrate applies only to project setup.');

    const scope = globalScope ? 'global' : 'project';
    const interactive = Boolean(process.stdin.isTTY && !yes && !dryRun);
    if (!yes && !dryRun && !process.stdin.isTTY) {
      return fail(`Non-interactive setup requires -y/--yes so setup can obtain consent.\n${setupUsage()}`);
    }

    if (scope === 'global') {
      const roots = resolveGlobalInstallRoots(ctx.globalInstallRootOptions);
      let targets = all ? [...GLOBAL_ALL] : (agent ? [agent] : detectGlobalTargets(roots));
      if (targets.length !== 1 && !agent && !all && interactive) {
        targets = await (ctx.setupPromptApi?.selectGlobalTargets
          ? ctx.setupPromptApi.selectGlobalTargets(targets)
          : chooseGlobalTargets({ detected: targets, input: process.stdin, output: process.stdout }));
      }
      if (targets.length === 0) return fail('No agent home detected. Re-run with --agent <claude|opencode|codex|copilot> or --all.');
      if (!agent && !all && targets.length > 1 && yes) return fail('Multiple agent homes detected; choose --agent or --all explicitly.');
      const installArgs = ['--global', '--tools', targets.join(',')];
      if (dryRun) installArgs.push('--dry-run');
      if (dryRun) {
        console.log(`Workspine setup (dry run)\n  scope: global\n  targets: ${targets.join(', ')}`);
        return createCmdInstall(ctx)(...installArgs);
      }
      console.log(`Workspine setup\n  scope: My agent (for future repos)\n  targets: ${targets.join(', ')}`);
      if (!yes && !(await confirmSetup({ promptApi: ctx.setupPromptApi, details: [`Bounded write set: ${targets.join(', ')} agent-home surfaces.`] }))) return fail('Setup cancelled; no files were written.');
      return createCmdInstall(ctx)(...installArgs);
    }

    const rootInfo = setupRoot(setupArgs, ctx.cwd);
    if (rootInfo.invalid) return fail(rootInfo.error);
    const root = rootInfo.root;
    const state = resolveStateDir(root);
    if (state.status === 'current') {
      console.log(`Workspine state already exists at ${root}. No files were written. Run \`npx -y workspine update\` to refresh generated surfaces or \`npx -y workspine health\` to inspect it.`);
      return;
    }
    if (state.status !== 'fresh' && state.status !== 'current' && !migrate) {
      if (state.status === 'legacy_migratable' && interactive) {
        const accepted = await (ctx.setupPromptApi?.confirmLegacyMigration
          ? ctx.setupPromptApi.confirmLegacyMigration({ benefit: 'This keeps one supported Workspine state root.' })
          : promptConfirm({
            input: process.stdin,
            output: process.stdout,
            title: 'Legacy Workspine state detected',
            prompt: 'Migrate it before setup?',
            defaultValue: false,
            details: ['This keeps one supported Workspine state root.'],
          }));
        if (!accepted) return fail('Setup cancelled; legacy state was not changed. Run `npx -y workspine setup --migrate` when ready.');
        migrate = true;
      } else {
        return fail(setupMigrationMessage(state));
      }
    }

    const tools = selectedProjectTools(agent, all);
    if (dryRun) return printProjectDryRun(root, tools);
    if (!yes && !(await confirmSetup({ promptApi: ctx.setupPromptApi, details: [`Bounded write set: .work/, .agents/skills/work-*, and ${tools.join(', ')} selected project surfaces.`] }))) {
      return fail('Setup cancelled; no files were written.');
    }

    const initPromptApi = ctx.initPromptApi || {
      promptForConfig: () => buildDefaultConfig({ autoAdvance: false }),
    };
    const initCtx = { ...ctx, cwd: root, initPromptApi };
    if (migrate) {
      try {
        migrateLegacyState(root);
      } catch (error) {
        return fail(`Legacy state migration failed: ${error.message}`);
      }
    }
    // Setup owns consent and explicit scope/target flags; init-flow owns the established filesystem
    // preflight and generation transaction. Supplying targets avoids reopening its runtime wizard.
    return createCmdInit(initCtx)('--tools', tools.join(','), '--workspace-root', root);
  };
}

export { detectGlobalTargets, setupUsage };
