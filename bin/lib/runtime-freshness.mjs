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
import { bridgeHistoricalAdapterOwnership, readManifest } from './manifest.mjs';
import {
  fileHash,
  inspectGlobalManifest,
  pruneStaleManifestTrackedFiles,
} from './global-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_JSON = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

function normalizeContent(content) {
  return String(content).replace(/\r\n/g, '\n');
}

function compareGeneratedFile({
  cwd,
  runtime,
  relativePath,
  expectedContent,
  owned,
  repairCommand,
  missingRepairCommand = repairCommand,
}) {
  const absolutePath = join(cwd, relativePath);
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        runtime,
        relativePath,
        status: owned ? 'missing' : 'unowned-missing',
        repairCommand: missingRepairCommand,
        retryCommand: missingRepairCommand,
        owned,
      };
    }
    return {
      runtime,
      relativePath,
      status: 'unreadable',
      repairCommand,
      retryCommand: repairCommand,
      owned,
    };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      runtime,
      relativePath,
      status: 'collision',
      repairCommand,
      retryCommand: repairCommand,
      owned,
    };
  }

  if (!owned) {
    return {
      runtime,
      relativePath,
      status: 'unowned',
      repairCommand: missingRepairCommand,
      retryCommand: missingRepairCommand,
      owned,
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
      owned,
    };
  }

  return {
    runtime,
    relativePath,
    status: 'stale',
    repairCommand,
    owned,
  };
}

function normalizeRelativePath(relativePath) {
  return String(relativePath).replace(/\\/g, '/');
}

function localTargetOwned(manifest, stateDirName, runtime, relativePath) {
  if (!manifest) return false;
  const normalized = normalizeRelativePath(relativePath);
  if (runtime === 'workspace-helper') {
    const prefix = `${stateDirName}/`;
    const manifestRelative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    const helpers = manifest.runtimeHelpers;
    return Boolean(helpers && typeof helpers === 'object' && !Array.isArray(helpers)
      && Object.hasOwn(helpers, manifestRelative));
  }
  const adapterFiles = manifest.adapterFiles;
  return Boolean(adapterFiles && typeof adapterFiles === 'object' && !Array.isArray(adapterFiles)
    && Object.hasOwn(adapterFiles, normalized));
}

function compareGlobalGeneratedFile({ rootDir, runtime, relativePath, expectedContent, manifest }) {
  const absolutePath = join(rootDir, relativePath);
  const manifestHash = manifest?.files?.[relativePath];
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT' && !manifestHash) {
      return {
        runtime,
        relativePath,
        status: 'ownership-missing',
        repairCommand: null,
        blocker: true,
      };
    }
    return {
      runtime,
      relativePath,
      status: error?.code === 'ENOENT' ? 'missing' : 'unreadable',
      repairCommand: error?.code === 'ENOENT' ? 'npx -y workspine update --global' : null,
      blocker: error?.code !== 'ENOENT',
    };
  }
  if (stat.isSymbolicLink()) {
    return { runtime, relativePath, status: 'linked', repairCommand: null, blocker: true };
  }
  if (!stat.isFile()) {
    return { runtime, relativePath, status: 'collision', repairCommand: null, blocker: true };
  }

  if (!manifestHash) {
    return { runtime, relativePath, status: 'untracked', repairCommand: null, blocker: true };
  }
  let actualHash;
  let actualContent;
  try {
    actualHash = fileHash(absolutePath);
    actualContent = normalizeContent(readFileSync(absolutePath, 'utf-8'));
  } catch {
    return { runtime, relativePath, status: 'unreadable', repairCommand: null, blocker: true };
  }
  if (actualHash !== manifestHash) {
    return { runtime, relativePath, status: 'modified', repairCommand: null, blocker: true };
  }
  if (actualContent !== normalizeContent(expectedContent)) {
    return {
      runtime,
      relativePath,
      status: 'package-stale',
      repairCommand: 'npx -y workspine update --global',
      blocker: false,
    };
  }
  return { runtime, relativePath, status: 'clean', repairCommand: null, blocker: false };
}

function compareObsoleteGlobalManifestEntries({ rootDir, runtime, entries, manifest }) {
  const currentFiles = Object.fromEntries(entries.map((entry) => [
    normalizeRelativePath(entry.relativePath),
    true,
  ]));
  return pruneStaleManifestTrackedFiles({
    rootDir,
    previousManifest: manifest,
    nextFiles: currentFiles,
    dryRun: true,
  }).map((result) => {
    const base = {
      runtime,
      relativePath: result.relativePath,
      obsolete: true,
    };
    if (result.status === 'would_remove') {
      return {
        ...base,
        status: 'obsolete',
        repairCommand: 'npx -y workspine update --global',
        blocker: false,
      };
    }
    if (result.status === 'removed_missing') {
      return {
        ...base,
        status: 'obsolete-missing',
        repairCommand: 'npx -y workspine update --global',
        blocker: false,
      };
    }
    const blockedStatus = {
      skipped_modified: 'modified',
      skipped_linked: 'linked',
      skipped_collision: 'collision',
      skipped_unreadable: 'unreadable',
      skipped_unsafe: 'unsafe',
    }[result.status] || 'unsafe';
    return {
      ...base,
      status: blockedStatus,
      repairCommand: null,
      blocker: true,
    };
  });
}

/**
 * Read-only freshness evaluation for global manifest specs.  The global
 * installer owns spec construction; this seam only compares bytes and never
 * repairs or rewrites a personal-agent home.
 */
export function evaluateGlobalRuntimeFreshness({ specs = [] } = {}) {
  const rawGroups = specs.map((spec) => {
    const manifestState = inspectGlobalManifest(spec.rootDir);
    const manifestOwned = manifestState.status === 'valid'
      && manifestState.manifest.product === 'Workspine'
      && manifestState.manifest.runtime === spec.runtime
      && manifestState.manifest.files
      && typeof manifestState.manifest.files === 'object'
      && !Array.isArray(manifestState.manifest.files);
    const comparisons = manifestOwned
      ? [
          ...spec.entries.map((entry) => compareGlobalGeneratedFile({
            rootDir: spec.rootDir,
            runtime: spec.runtime,
            relativePath: entry.relativePath,
            expectedContent: entry.content,
            manifest: manifestState.manifest,
          })),
          ...compareObsoleteGlobalManifestEntries({
            rootDir: spec.rootDir,
            runtime: spec.runtime,
            entries: spec.entries,
            manifest: manifestState.manifest,
          }),
        ]
      : [{
        runtime: spec.runtime,
        relativePath: 'workspine-file-manifest.json',
        status: manifestState.status === 'valid'
          ? 'foreign'
          : manifestState.status === 'missing'
            ? 'manifest-missing'
            : manifestState.status,
        repairCommand: null,
        blocker: true,
      }];
    return {
      runtime: spec.runtime,
      rootDir: spec.rootDir,
      manifestStatus: manifestState.status,
      comparisons,
      issueCount: comparisons.filter((entry) => entry.status !== 'clean').length,
    };
  });
  const rawIssues = rawGroups.flatMap((group) => group.comparisons.filter((entry) => entry.status !== 'clean'));
  const selectedSetBlocked = rawIssues.some((entry) => entry.blocker === true);
  const groups = selectedSetBlocked
    ? rawGroups.map((group) => ({
        ...group,
        comparisons: group.comparisons.map((entry) => entry.status === 'clean'
          ? entry
          : { ...entry, repairCommand: null }),
      }))
    : rawGroups;
  const issues = groups.flatMap((group) => group.comparisons.filter((entry) => entry.status !== 'clean'));
  return {
    groups,
    issues,
    issueCount: issues.length,
    staleCount: issues.filter((entry) => entry.status === 'package-stale').length,
    missingCount: issues.filter((entry) => entry.status === 'missing').length,
    blockerCount: issues.filter((entry) => entry.blocker === true).length,
    selectedSetBlocked,
  };
}

export function getGlobalRuntimeRepairGuidance(issue, report) {
  const pathLabel = `${issue.runtime}: ${issue.relativePath}`;
  if (issue.blocker === true) {
    if (issue.status === 'modified' || issue.status === 'untracked') {
      return `Manual resolution required for ${pathLabel}. Preserve the existing file; move the customization aside or restore trusted manifest-owned bytes, then rerun \`npx -y workspine health --global\`. Do not adopt or overwrite it automatically.`;
    }
    if (issue.status === 'linked' || issue.status === 'collision') {
      return `Manual resolution required for ${pathLabel}. Preserve the existing path, then move or rename the linked/colliding entry and rerun \`npx -y workspine health --global\`.`;
    }
    if (issue.status === 'unreadable') {
      return `Manual resolution required for ${pathLabel}. Fix filesystem access so Workspine can inspect it safely, then rerun \`npx -y workspine health --global\`.`;
    }
    if (['corrupt', 'foreign', 'manifest-missing', 'ownership-missing'].includes(issue.status)) {
      return `Manual ownership repair required for ${pathLabel}. Restore a trusted Workspine ownership manifest for this runtime, or preserve the existing home and do not adopt it automatically; then rerun \`npx -y workspine health --global\`.`;
    }
    return `Manual resolution required for ${pathLabel}. Preserve the existing home and rerun \`npx -y workspine health --global\` after resolving the ownership blocker.`;
  }
  if (report?.selectedSetBlocked) {
    return `Automatic global reconciliation is blocked by another unsafe global issue. Resolve the manual blocker(s), then rerun \`npx -y workspine health --global\`.`;
  }
  return issue.repairCommand
    ? `Run \`${issue.repairCommand}\` to reconcile this manifest-owned global surface.`
    : `Rerun \`npx -y workspine health --global\` after resolving this global surface.`;
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
      repairCommand: 'npx -y workspine update',
      missingRepairCommand: 'npx -y workspine init --tools claude',
      entries: buildClaudeEntries({ cwd, workflows, stateDirName }),
    },
    {
      runtime: 'opencode',
      label: 'OpenCode native surfaces',
      root: '.opencode',
      repairCommand: 'npx -y workspine update',
      missingRepairCommand: 'npx -y workspine init --tools opencode',
      entries: buildOpenCodeEntries({ cwd, workflows, stateDirName }),
    },
    {
      runtime: 'codex',
      label: 'Codex CLI native agents',
      root: '.codex',
      repairCommand: 'npx -y workspine update',
      missingRepairCommand: 'npx -y workspine init --tools codex',
      entries: buildCodexEntries({ cwd }),
    },
  ];
}

export function evaluateRuntimeFreshness({ cwd = process.cwd(), workflows = [] }) {
  const state = resolveStateDir(cwd);
  const manifest = readManifest(state.dir);
  let ownershipManifest = manifest;
  try {
    ownershipManifest = bridgeHistoricalAdapterOwnership({
      cwd,
      manifest,
      stateDirName: state.name,
    })?.manifest ?? manifest;
  } catch {
    // Unsafe historical ownership must stay manual in health rather than
    // advertising an update/init path that the real preflight will refuse.
    ownershipManifest = null;
  }
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
        owned: localTargetOwned(ownershipManifest, state.name, group.runtime, entry.relativePath),
        repairCommand: group.repairCommand,
        missingRepairCommand: group.missingRepairCommand,
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
  const manualIssues = report.issues.filter((entry) =>
    entry.owned === false || ['collision', 'unreadable', 'unowned', 'unowned-missing'].includes(entry.status));
  const automaticIssues = report.issues.filter((entry) => !manualIssues.includes(entry));
  const commands = [...new Set(automaticIssues.map((entry) => entry.repairCommand).filter(Boolean))];
  const orderedCommands = [
    ...commands.filter((command) => / workspine init --tools /.test(command)),
    ...commands.filter((command) => command === 'npx -y workspine update'),
    ...commands.filter((command) => !/ workspine init --tools /.test(command) && command !== 'npx -y workspine update'),
  ];
  const commandGuidance = orderedCommands.length === 1
    ? `Run \`${orderedCommands[0]}\`.`
    : orderedCommands.length > 1
      ? `Run ${orderedCommands.map((command) => `\`${command}\``).join(', then ')}.`
      : '';

  if (manualIssues.length > 0) {
    const targets = [...new Set(manualIssues.map((entry) => entry.relativePath))];
    return `Resolve generated target ownership manually first (${targets.join(', ')}). Preserve existing bytes; move or rename consumer-owned collisions, and restore matching generation-manifest ownership from a trusted backup. If no valid ownership record exists, preserve this workspace and initialize a clean workspace.${commandGuidance ? ` Then ${commandGuidance}` : ''}`;
  }
  if (orderedCommands.length === 1) {
    return `Run \`${orderedCommands[0]}\` to regenerate the installed runtime surfaces.`;
  }
  return `${commandGuidance.slice(0, -1)} in that order so each repair can make progress.`;
}
