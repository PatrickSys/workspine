import { existsSync, lstatSync, readFileSync } from 'fs';
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
import { fileHash, inspectGlobalManifest } from './global-manifest.mjs';

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

function compareGlobalGeneratedFile({ rootDir, runtime, relativePath, expectedContent, manifest }) {
  const absolutePath = join(rootDir, relativePath);
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    return {
      runtime,
      relativePath,
      status: error?.code === 'ENOENT' ? 'missing' : 'unreadable',
      repairCommand: 'npx -y workspine update --global',
    };
  }
  if (stat.isSymbolicLink()) {
    return { runtime, relativePath, status: 'linked', repairCommand: 'npx -y workspine update --global' };
  }
  if (!stat.isFile()) {
    return { runtime, relativePath, status: 'collision', repairCommand: 'npx -y workspine update --global' };
  }

  const manifestHash = manifest?.files?.[relativePath];
  if (!manifestHash) {
    return { runtime, relativePath, status: 'untracked', repairCommand: 'npx -y workspine update --global' };
  }
  const actualHash = fileHash(absolutePath);
  if (actualHash !== manifestHash || normalizeContent(readFileSync(absolutePath, 'utf-8')) !== normalizeContent(expectedContent)) {
    return { runtime, relativePath, status: 'modified', repairCommand: 'npx -y workspine update --global' };
  }
  return { runtime, relativePath, status: 'clean', repairCommand: 'npx -y workspine update --global' };
}

/**
 * Read-only freshness evaluation for global manifest specs.  The global
 * installer owns spec construction; this seam only compares bytes and never
 * repairs or rewrites a personal-agent home.
 */
export function evaluateGlobalRuntimeFreshness({ specs = [] } = {}) {
  const groups = specs.map((spec) => {
    const manifestState = inspectGlobalManifest(spec.rootDir);
    const manifestOwned = manifestState.status === 'valid'
      && manifestState.manifest.product === 'Workspine'
      && manifestState.manifest.runtime === spec.runtime
      && manifestState.manifest.files
      && typeof manifestState.manifest.files === 'object'
      && !Array.isArray(manifestState.manifest.files);
    const comparisons = manifestOwned
      ? spec.entries.map((entry) => compareGlobalGeneratedFile({
        rootDir: spec.rootDir,
        runtime: spec.runtime,
        relativePath: entry.relativePath,
        expectedContent: entry.content,
        manifest: manifestState.manifest,
      }))
      : [{
        runtime: spec.runtime,
        relativePath: 'workspine-file-manifest.json',
        status: manifestState.status === 'valid' ? 'collision' : manifestState.status,
        repairCommand: 'npx -y workspine update --global',
      }];
    return {
      runtime: spec.runtime,
      rootDir: spec.rootDir,
      manifestStatus: manifestState.status,
      comparisons,
      issueCount: comparisons.filter((entry) => entry.status !== 'clean').length,
    };
  });
  const issues = groups.flatMap((group) => group.comparisons.filter((entry) => entry.status !== 'clean'));
  return {
    groups,
    issues,
    issueCount: issues.length,
    staleCount: issues.filter((entry) => entry.status === 'modified').length,
    missingCount: issues.filter((entry) => entry.status === 'missing').length,
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
    expectedContent: workflow.name === 'work-plan'
      ? renderClaudePlanSkill({ stateDirName })
      : renderSkillContent(workflow, { stateDirName }),
  }));

  entries.push(
    {
      relativePath: '.claude/commands/work-plan.md',
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
    expectedContent: workflow.name === 'work-plan'
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
