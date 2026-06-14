import os from 'os';
import { join } from 'path';
import { promptMultiSelect } from './init-prompts.mjs';
import {
  buildPortableSkillEntries,
  getDelegateContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
} from './rendering.mjs';
import {
  renderClaudeApproachExplorer,
  renderClaudePlanChecker,
  renderClaudePlanCommand,
  renderClaudePlanSkill,
  CLAUDE_MODEL_PROFILES,
} from '../adapters/claude.mjs';
import {
  renderOpenCodeApproachExplorer,
  renderOpenCodePlanChecker,
  renderOpenCodePlanCommand,
} from '../adapters/opencode.mjs';
import {
  renderCodexApproachExplorer,
  renderCodexPlanChecker,
} from '../adapters/codex.mjs';
import {
  GLOBAL_MANIFEST_FILENAME,
  readGlobalManifest,
  writeGlobalManifest,
  writeManifestTrackedFile,
} from './global-manifest.mjs';
import { parseFlagValue } from './cli-utils.mjs';

export const GLOBAL_AGENT_OPTIONS = [
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Install global skills, slash-command alias, and native GSDD agents under ~/.claude.',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'Install global skills, slash commands, and native GSDD agents under ~/.config/opencode.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    description: 'Install global skills and native GSDD agents under ~/.codex.',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    description: 'Install global skills and Copilot agent profiles under ~/.copilot.',
  },
];

const GLOBAL_AGENT_IDS = GLOBAL_AGENT_OPTIONS.map((option) => option.id);

function getHomeDir() {
  return process.env.GSDD_TEST_HOME || os.homedir();
}

function getConfigHome(homeDir) {
  return process.env.XDG_CONFIG_HOME || join(homeDir, '.config');
}

export function resolveGlobalInstallRoots({ homeDir = getHomeDir(), env = process.env } = {}) {
  const configHome = env.XDG_CONFIG_HOME || getConfigHome(homeDir);
  return {
    claude: env.CLAUDE_CONFIG_DIR || join(homeDir, '.claude'),
    opencode: join(configHome, 'opencode'),
    codex: env.CODEX_HOME || join(homeDir, '.codex'),
    copilot: env.COPILOT_CONFIG_DIR || join(homeDir, '.copilot'),
  };
}

function parseGlobalToolsFlag(args) {
  const toolsFlag = parseFlagValue(args, '--tools');
  if (!toolsFlag.value) return [];
  return toolsFlag.value.split(',').map((tool) => tool.trim()).filter(Boolean);
}

function normalizeGlobalTools(rawTools) {
  if (rawTools.length === 0) return [];
  const expanded = rawTools.flatMap((tool) => (tool === 'all' ? GLOBAL_AGENT_IDS : [tool]));
  return [...new Set(expanded)].filter(Boolean);
}

function validateGlobalTools(tools) {
  const invalid = tools.filter((tool) => !GLOBAL_AGENT_IDS.includes(tool));
  if (invalid.length === 0) return null;
  return `ERROR: unsupported global install target(s): ${invalid.join(', ')}. Use --tools claude,opencode,codex,copilot or --tools all.`;
}

function displayPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

async function resolveGlobalInstallTargets({ args, promptApi, output }) {
  const parsedTools = normalizeGlobalTools(parseGlobalToolsFlag(args));
  if (parsedTools.length > 0) return parsedTools;

  if (!process.stdin.isTTY) {
    return [];
  }

  if (promptApi?.selectGlobalInstallTargets) {
    return promptApi.selectGlobalInstallTargets(GLOBAL_AGENT_OPTIONS);
  }

  return promptMultiSelect({
    input: process.stdin,
    output,
    title: 'Select global agent installs',
    hint: 'Space toggles, Enter confirms.',
    choices: GLOBAL_AGENT_OPTIONS.map((option) => ({ ...option, selected: true, detected: false })),
  });
}

function buildClaudeGlobalEntries(ctx, rootDir) {
  const checkerModelAlias = ctx.resolveRuntimeAgentModel({
    cwd: ctx.cwd,
    runtime: 'claude',
    agentId: 'plan-checker',
    profileMap: CLAUDE_MODEL_PROFILES,
  });
  const explorerModelAlias = ctx.resolveRuntimeAgentModel({
    cwd: ctx.cwd,
    runtime: 'claude',
    agentId: 'approach-explorer',
    profileMap: CLAUDE_MODEL_PROFILES,
  });

  const entries = ctx.workflows.map((workflow) => ({
    relativePath: `skills/${workflow.name}/SKILL.md`,
    content: workflow.name === 'gsdd-plan' ? renderClaudePlanSkill() : renderSkillContent(workflow),
  }));

  entries.push(
    { relativePath: 'commands/gsdd-plan.md', content: renderClaudePlanCommand({ skillPath: displayPath(join(rootDir, 'skills', 'gsdd-plan', 'SKILL.md')) }) },
    { relativePath: 'agents/gsdd-plan-checker.md', content: renderClaudePlanChecker(getDelegateContent('plan-checker.md'), checkerModelAlias) },
    { relativePath: 'agents/gsdd-approach-explorer.md', content: renderClaudeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelAlias) }
  );

  return entries;
}

function buildOpenCodeGlobalEntries(ctx, rootDir) {
  const config = ctx.loadProjectModelConfig(ctx.cwd);
  const checkerModelId = ctx.getRuntimeModelOverride(config, 'opencode', 'plan-checker');
  const explorerModelId = ctx.getRuntimeModelOverride(config, 'opencode', 'approach-explorer');

  const entries = ctx.workflows.flatMap((workflow) => ([
    { relativePath: `skills/${workflow.name}/SKILL.md`, content: renderSkillContent(workflow) },
    {
      relativePath: `commands/${workflow.name}.md`,
      content: workflow.name === 'gsdd-plan'
        ? renderOpenCodePlanCommand({ skillPath: displayPath(join(rootDir, 'skills', 'gsdd-plan', 'SKILL.md')) })
        : renderOpenCodeCommandContent(workflow),
    },
  ]));

  entries.push(
    { relativePath: 'agents/gsdd-plan-checker.md', content: renderOpenCodePlanChecker(getDelegateContent('plan-checker.md'), checkerModelId) },
    { relativePath: 'agents/gsdd-approach-explorer.md', content: renderOpenCodeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelId) }
  );

  return entries;
}

function buildCodexGlobalEntries(ctx) {
  const config = ctx.loadProjectModelConfig(ctx.cwd);
  const checkerModelId = ctx.getRuntimeModelOverride(config, 'codex', 'plan-checker');
  const explorerModelId = ctx.getRuntimeModelOverride(config, 'codex', 'approach-explorer');

  return [
    ...buildPortableSkillEntries(ctx.workflows).map((entry) => ({
      relativePath: entry.relativePath.replace(/^\.agents\/skills\//, 'skills/'),
      content: entry.content,
    })),
    { relativePath: 'agents/gsdd-plan-checker.toml', content: renderCodexPlanChecker(getDelegateContent('plan-checker.md'), checkerModelId) },
    { relativePath: 'agents/gsdd-approach-explorer.toml', content: renderCodexApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelId) },
  ];
}

function renderCopilotAgent({ name, description, tools, body, disableModelInvocation = true }) {
  const toolList = tools.map((tool) => `"${tool}"`).join(', ');
  return `---
name: ${name}
description: ${description}
target: github-copilot
tools: [${toolList}]
disable-model-invocation: ${disableModelInvocation ? 'true' : 'false'}
---

${body.trim()}
`;
}

function buildCopilotGlobalEntries(ctx) {
  return [
    ...buildPortableSkillEntries(ctx.workflows).map((entry) => ({
      relativePath: entry.relativePath.replace(/^\.agents\/skills\//, 'skills/'),
      content: entry.content,
    })),
    {
      relativePath: 'agents/gsdd-plan-checker.agent.md',
      content: renderCopilotAgent({
        name: 'gsdd-plan-checker',
        description: 'Fresh-context plan checker for GSDD plan drafts. Review-only; never edits plans directly.',
        tools: ['read', 'search'],
        body: getDelegateContent('plan-checker.md'),
      }),
    },
    {
      relativePath: 'agents/gsdd-approach-explorer.agent.md',
      content: renderCopilotAgent({
        name: 'gsdd-approach-explorer',
        description: 'Explores implementation approaches for a phase and aligns with the user before planning begins.',
        tools: ['read', 'search', 'edit', 'web', 'agent'],
        body: getDelegateContent('approach-explorer.md'),
      }),
    },
  ];
}

function buildGlobalEntries(target, ctx, rootDir) {
  if (target === 'claude') return buildClaudeGlobalEntries(ctx, rootDir);
  if (target === 'opencode') return buildOpenCodeGlobalEntries(ctx, rootDir);
  if (target === 'codex') return buildCodexGlobalEntries(ctx);
  if (target === 'copilot') return buildCopilotGlobalEntries(ctx);
  return [];
}

function installTarget({ target, rootDir, ctx, dryRun }) {
  const previousManifest = readGlobalManifest(rootDir);
  const entries = buildGlobalEntries(target, ctx, rootDir);
  const preflightFiles = {};
  const preflightResults = entries.map((entry) => writeManifestTrackedFile({
    rootDir,
    relativePath: entry.relativePath,
    content: entry.content,
    previousManifest,
    nextFiles: preflightFiles,
    dryRun: true,
  }));

  const blocked = preflightResults.filter((result) => result.status.startsWith('skipped_'));
  const results = dryRun || blocked.length > 0
    ? preflightResults
    : entries.map((entry) => writeManifestTrackedFile({
      rootDir,
      relativePath: entry.relativePath,
      content: entry.content,
      previousManifest,
      nextFiles: {},
      dryRun: false,
    }));

  if (!dryRun && blocked.length === 0) {
    writeGlobalManifest(rootDir, {
      product: 'Workspine',
      packageName: ctx.packageName,
      packageVersion: ctx.packageVersion,
      frameworkVersion: ctx.frameworkVersion,
      runtime: target,
      generatedAt: new Date().toISOString(),
      files: preflightFiles,
    });
  }

  return {
    target,
    rootDir,
    manifest: `${rootDir}/${GLOBAL_MANIFEST_FILENAME}`,
    results,
    blocked,
    writtenCount: results.filter((result) => result.status === 'written').length,
    unchangedCount: results.filter((result) => result.status === 'unchanged').length,
    wouldWriteCount: results.filter((result) => result.status === 'would_write').length,
  };
}

export function createCmdInstall(ctx) {
  return async function cmdInstall(...installArgs) {
    const globalFlag = installArgs.includes('--global') || installArgs.includes('-g');
    const localFlag = installArgs.includes('--local');
    const dryRun = installArgs.includes('--dry');
    const toolsFlag = parseFlagValue(installArgs, '--tools');

    if (toolsFlag.invalid) {
      console.error('ERROR: --tools requires a value. Example: gsdd install --global --tools claude,opencode');
      process.exitCode = 1;
      return;
    }

    if (localFlag) {
      console.error('ERROR: local project installation is `gsdd init`. Global installation is `gsdd install --global`.');
      process.exitCode = 1;
      return;
    }

    if (!globalFlag) {
      console.error('ERROR: install currently requires --global. For repo-local setup, run `gsdd init`.');
      process.exitCode = 1;
      return;
    }

    const targets = await resolveGlobalInstallTargets({
      args: installArgs,
      promptApi: ctx.globalInstallPromptApi,
      output: process.stdout,
    });

    if (targets.length === 0) {
      console.error('ERROR: no global install targets selected. Use --tools claude,opencode,codex,copilot or run interactively.');
      process.exitCode = 1;
      return;
    }

    const invalidMessage = validateGlobalTools(targets);
    if (invalidMessage) {
      console.error(invalidMessage);
      process.exitCode = 1;
      return;
    }

    const roots = resolveGlobalInstallRoots();
    console.log(`gsdd install --global - installing Workspine runtime surfaces${dryRun ? ' (dry run)' : ''}\n`);

    const reports = targets.map((target) => installTarget({
      target,
      rootDir: roots[target],
      ctx,
      dryRun,
    }));

    let hasBlocked = false;
    for (const report of reports) {
      console.log(`  - ${report.target}: ${dryRun ? `${report.wouldWriteCount} file(s) would be written` : `${report.writtenCount} written, ${report.unchangedCount} unchanged`} (${report.rootDir})`);
      if (report.blocked.length > 0) {
        hasBlocked = true;
        for (const blocked of report.blocked.slice(0, 5)) {
          console.log(`    WARN ${blocked.relativePath}: ${blocked.message}`);
        }
        if (report.blocked.length > 5) {
          console.log(`    WARN ${report.blocked.length - 5} more file(s) were skipped`);
        }
      }
    }

    if (hasBlocked) {
      console.error('\nGlobal install finished with skipped files. Review them before re-running or deleting local modifications.');
      process.exitCode = 1;
      return;
    }

    console.log('\nGlobal install complete.');
  };
}
