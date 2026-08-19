import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  buildPlanningCliHelperEntries,
  buildPortableSkillEntries,
  getDelegateContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
} from './rendering.mjs';
import {
  CLAUDE_MODEL_PROFILES,
  renderClaudeApproachExplorer,
  renderClaudePlanChecker,
  renderClaudePlanCommand,
  renderClaudePlanSkill,
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
import { SUBAGENT_IDS } from './workflows.mjs';
import {
  getRuntimeModelOverride,
  loadProjectModelConfig,
  resolveRuntimeAgentModel,
} from './config.mjs';
import { resolveStateDir } from './state-dir.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_JSON = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

function normalizeContent(content) {
  return String(content).replace(/\r\n/g, '\n');
}

function compareGeneratedFile({ cwd, runtime, relativePath, expectedContent, repairCommand }) {
  const absolutePath = join(cwd, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      runtime,
      relativePath,
      status: 'missing',
      repairCommand,
    };
  }

  const actualContent = normalizeContent(readFileSync(absolutePath, 'utf-8'));
  const expected = normalizeContent(expectedContent);
  if (actualContent === expected) {
    return {
      runtime,
      relativePath,
      status: 'clean',
      repairCommand,
    };
  }

  return {
    runtime,
    relativePath,
    status: 'stale',
    repairCommand,
  };
}

function buildClaudeEntries({ cwd, workflows, stateDirName = '.work' }) {
  const checkerModelAlias = resolveRuntimeAgentModel({
    cwd,
    runtime: 'claude',
    agentId: 'plan-checker',
    profileMap: CLAUDE_MODEL_PROFILES,
  });
  const explorerModelAlias = resolveRuntimeAgentModel({
    cwd,
    runtime: 'claude',
    agentId: 'approach-explorer',
    profileMap: CLAUDE_MODEL_PROFILES,
  });

  const entries = workflows.map((workflow) => ({
    relativePath: `.claude/skills/${workflow.name}/SKILL.md`,
    expectedContent: workflow.name === 'gsdd-plan'
      ? renderClaudePlanSkill({ stateDirName })
      : renderSkillContent(workflow, { stateDirName }),
  }));

  entries.push(
    {
      relativePath: '.claude/commands/gsdd-plan.md',
      expectedContent: renderClaudePlanCommand(),
    },
    {
      relativePath: `.claude/agents/${SUBAGENT_IDS.planChecker}.md`,
      expectedContent: renderClaudePlanChecker(getDelegateContent('plan-checker.md'), checkerModelAlias),
    },
    {
      relativePath: `.claude/agents/${SUBAGENT_IDS.approachExplorer}.md`,
      expectedContent: renderClaudeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelAlias),
    }
  );

  return entries;
}

function buildOpenCodeEntries({ cwd, workflows, stateDirName = '.work' }) {
  const config = loadProjectModelConfig(cwd);
  const checkerModelId = getRuntimeModelOverride(config, 'opencode', 'plan-checker');
  const explorerModelId = getRuntimeModelOverride(config, 'opencode', 'approach-explorer');

  const entries = workflows.map((workflow) => ({
    relativePath: `.opencode/commands/${workflow.name}.md`,
    expectedContent: workflow.name === 'gsdd-plan'
      ? renderOpenCodePlanCommand({ stateDirName })
      : renderOpenCodeCommandContent(workflow, { stateDirName }),
  }));

  entries.push(
    {
      relativePath: `.opencode/agents/${SUBAGENT_IDS.planChecker}.md`,
      expectedContent: renderOpenCodePlanChecker(getDelegateContent('plan-checker.md'), checkerModelId),
    },
    {
      relativePath: `.opencode/agents/${SUBAGENT_IDS.approachExplorer}.md`,
      expectedContent: renderOpenCodeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelId),
    }
  );

  return entries;
}

function buildCodexEntries({ cwd }) {
  const config = loadProjectModelConfig(cwd);
  const checkerModelId = getRuntimeModelOverride(config, 'codex', 'plan-checker');
  const explorerModelId = getRuntimeModelOverride(config, 'codex', 'approach-explorer');

  return [
    {
      relativePath: `.codex/agents/${SUBAGENT_IDS.planChecker}.toml`,
      expectedContent: renderCodexPlanChecker(getDelegateContent('plan-checker.md'), checkerModelId),
    },
    {
      relativePath: `.codex/agents/${SUBAGENT_IDS.approachExplorer}.toml`,
      expectedContent: renderCodexApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelId),
    },
  ];
}

function buildWorkspaceHelperEntries(stateDirName) {
  return buildPlanningCliHelperEntries({
    packageName: PACKAGE_JSON.name,
    packageVersion: PACKAGE_JSON.version,
    stateDirName,
  }).map((entry) => ({
    relativePath: `${stateDirName}/${entry.relativePath}`,
    expectedContent: entry.content,
  }));
}

export function collectExpectedRuntimeSurfaceGroups({ cwd = process.cwd(), workflows }) {
  const stateDirName = resolveStateDir(cwd).name;
  return [
    {
      runtime: 'workspace-helper',
      label: 'workspace workflow helper',
      root: `${stateDirName}/bin`,
      repairCommand: 'npx -y workspine update',
      entries: buildWorkspaceHelperEntries(stateDirName),
    },
    {
      runtime: 'portable',
      label: 'portable skills',
      root: '.agents/skills',
      repairCommand: 'npx -y workspine update',
      entries: buildPortableSkillEntries(workflows, { stateDirName }).map((entry) => ({
        relativePath: entry.relativePath,
        expectedContent: entry.content,
      })),
    },
    {
      runtime: 'claude',
      label: 'Claude Code native surfaces',
      root: '.claude',
      repairCommand: 'npx -y workspine update --tools claude',
      entries: buildClaudeEntries({ cwd, workflows, stateDirName }),
    },
    {
      runtime: 'opencode',
      label: 'OpenCode native surfaces',
      root: '.opencode',
      repairCommand: 'npx -y workspine update --tools opencode',
      entries: buildOpenCodeEntries({ cwd, workflows, stateDirName }),
    },
    {
      runtime: 'codex',
      label: 'Codex CLI native agents',
      root: '.codex',
      repairCommand: 'npx -y workspine update --tools codex',
      entries: buildCodexEntries({ cwd }),
    },
  ];
}

export function evaluateRuntimeFreshness({ cwd = process.cwd(), workflows = [] }) {
  const groups = collectExpectedRuntimeSurfaceGroups({ cwd, workflows }).map((group) => {
    const installed = group.runtime === 'workspace-helper'
      ? existsSync(resolveStateDir(cwd).dir)
      : existsSync(join(cwd, group.root));
    const comparisons = installed
      ? group.entries.map((entry) => compareGeneratedFile({
        cwd,
        runtime: group.runtime,
        relativePath: entry.relativePath,
        expectedContent: entry.expectedContent,
        repairCommand: group.repairCommand,
      }))
      : [];

    const stale = comparisons.filter((entry) => entry.status === 'stale');
    const missing = comparisons.filter((entry) => entry.status === 'missing');

    return {
      ...group,
      installed,
      comparisons,
      stale,
      missing,
      issueCount: stale.length + missing.length,
    };
  });

  const checkedGroups = groups.filter((group) => group.installed);
  const issues = checkedGroups.flatMap((group) => group.comparisons.filter((entry) => entry.status !== 'clean'));

  return {
    groups,
    checkedGroups: checkedGroups.map((group) => group.runtime),
    hasInstalledRuntimeSurfaces: checkedGroups.length > 0,
    issueCount: issues.length,
    staleCount: issues.filter((entry) => entry.status === 'stale').length,
    missingCount: issues.filter((entry) => entry.status === 'missing').length,
    issues,
  };
}

export function summarizeRuntimeFreshnessIssues(report, limit = 4) {
  if (!report || report.issueCount === 0) return '';
  const listed = report.issues
    .slice(0, limit)
    .map((entry) => `${entry.relativePath} [${entry.status}]`);
  const remainder = report.issueCount - listed.length;
  return remainder > 0 ? `${listed.join(', ')} (+${remainder} more)` : listed.join(', ');
}

export function getRuntimeFreshnessRepairGuidance(report) {
  if (!report || report.issueCount === 0) return 'Run `npx -y workspine update` to regenerate installed runtime surfaces.';
  const commands = [...new Set(report.issues.map((entry) => entry.repairCommand))];
  if (commands.length === 1) {
    return `Run \`${commands[0]}\` to regenerate the installed runtime surfaces.`;
  }
  return `Run \`npx -y workspine update\` to regenerate all installed runtime surfaces, or target the affected adapters individually: ${commands.map((command) => `\`${command}\``).join(', ')}.`;
}
