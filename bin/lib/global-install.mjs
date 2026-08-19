import os from 'os';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
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
  pruneStaleManifestTrackedFiles,
  readGlobalManifest,
  writeGlobalManifest,
  writeManifestTrackedFile,
} from './global-manifest.mjs';
import { parseFlagValue } from './cli-utils.mjs';
import { GLOBAL_AGENT_OPTIONS } from './init-runtime.mjs';

export { GLOBAL_AGENT_OPTIONS } from './init-runtime.mjs';

const GLOBAL_AGENT_IDS = GLOBAL_AGENT_OPTIONS.map((option) => option.id);

function supportedGlobalTargets() {
  return GLOBAL_AGENT_IDS.join(',');
}

function explicitGlobalInstallCommands() {
  return GLOBAL_AGENT_IDS.map((target) => `npx -y workspine install --global --tools ${target}`);
}

function getHomeDir() {
  return process.env.GSDD_TEST_HOME || os.homedir();
}

function getConfigHome(homeDir, env = process.env) {
  return env.XDG_CONFIG_HOME || join(homeDir, '.config');
}

export function resolveGlobalInstallRoots({ homeDir = getHomeDir(), env = process.env } = {}) {
  const isolatedHome = env.GSDD_TEST_HOME || null;
  const effectiveHome = isolatedHome || homeDir;
  const configHome = isolatedHome ? join(effectiveHome, '.config') : getConfigHome(effectiveHome, env);
  const agentSkills = join(effectiveHome, '.agents');
  return {
    home: effectiveHome,
    configHome,
    claude: isolatedHome ? join(effectiveHome, '.claude') : (env.CLAUDE_CONFIG_DIR || join(effectiveHome, '.claude')),
    opencode: isolatedHome ? join(configHome, 'opencode') : (env.OPENCODE_CONFIG_DIR || join(configHome, 'opencode')),
    agentSkills,
    opencodeSkills: agentSkills,
    codex: isolatedHome ? join(effectiveHome, '.codex') : (env.CODEX_HOME || join(effectiveHome, '.codex')),
    codexSkills: agentSkills,
    copilot: isolatedHome
      ? join(effectiveHome, '.copilot')
      : (env.COPILOT_HOME || env.COPILOT_CONFIG_DIR || join(effectiveHome, '.copilot')),
    copilotSkills: agentSkills,
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
  return `ERROR: unsupported global install target(s): ${invalid.join(', ')}. Use --tools ${supportedGlobalTargets()} or --tools all.`;
}

function detectGlobalInstallTargets(roots) {
  return GLOBAL_AGENT_IDS.filter((target) => existsSync(roots[target]));
}

function displayPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

async function resolveGlobalInstallTargets({ args, promptApi, output, roots }) {
  const parsedTools = normalizeGlobalTools(parseGlobalToolsFlag(args));
  if (parsedTools.length > 0) return parsedTools;

  if (args.includes('--auto')) {
    return detectGlobalInstallTargets(roots);
  }

  if (!process.stdin.isTTY) {
    return [];
  }

  if (promptApi?.selectGlobalInstallTargets) {
    return promptApi.selectGlobalInstallTargets(GLOBAL_AGENT_OPTIONS.map((option) => ({ ...option, selected: false, detected: false })));
  }

  return promptMultiSelect({
    input: process.stdin,
    output,
    title: 'Select global agent installs',
    hint: 'Space toggles, Enter confirms.',
    choices: GLOBAL_AGENT_OPTIONS.map((option) => ({ ...option, selected: false, detected: false })),
  });
}

function buildClaudeGlobalEntries(ctx, rootDir) {
  const checkerModelAlias = CLAUDE_MODEL_PROFILES.balanced;
  const explorerModelAlias = CLAUDE_MODEL_PROFILES.quality;

  const entries = ctx.workflows.map((workflow) => ({
    relativePath: `skills/${workflow.name}/SKILL.md`,
    content: workflow.name === 'gsdd-plan' ? renderClaudePlanSkill({ portableContractPath: null }) : renderSkillContent(workflow),
  }));

  entries.push(
    { relativePath: 'commands/gsdd-plan.md', content: renderClaudePlanCommand({ skillPath: displayPath(join(rootDir, 'skills', 'gsdd-plan', 'SKILL.md')) }) },
    { relativePath: 'agents/gsdd-plan-checker.md', content: renderClaudePlanChecker(getDelegateContent('plan-checker.md'), checkerModelAlias) },
    { relativePath: 'agents/gsdd-approach-explorer.md', content: renderClaudeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelAlias) }
  );

  return entries;
}

function buildOpenCodeGlobalCommandEntries(ctx, rootDir) {
  return ctx.workflows.map((workflow) => ({
    relativePath: `commands/${workflow.name}.md`,
    content: workflow.name === 'gsdd-plan'
      ? renderOpenCodePlanCommand({ skillPath: displayPath(join(rootDir, 'skills', 'gsdd-plan', 'SKILL.md')) })
      : renderOpenCodeCommandContent(workflow),
  }));
}

function buildOpenCodeGlobalAgentEntries() {
  return [
    { relativePath: 'agents/gsdd-plan-checker.md', content: renderOpenCodePlanChecker(getDelegateContent('plan-checker.md')) },
    { relativePath: 'agents/gsdd-approach-explorer.md', content: renderOpenCodeApproachExplorer(getDelegateContent('approach-explorer.md')) },
  ];
}

function buildOpenCodeGlobalEntries(ctx, rootDir) {
  return [
    ...buildOpenCodeGlobalCommandEntries(ctx, rootDir),
    ...buildOpenCodeGlobalAgentEntries(ctx),
  ];
}

function buildAgentCompatibleGlobalSkillEntries(ctx) {
  return buildPortableSkillEntries(ctx.workflows).map((entry) => ({
    relativePath: entry.relativePath.replace(/^\.agents\/skills\//, 'skills/'),
    content: entry.content,
  }));
}

function buildCodexGlobalAgentEntries() {
  return [
    { relativePath: 'agents/gsdd-plan-checker.toml', content: renderCodexPlanChecker(getDelegateContent('plan-checker.md')) },
    { relativePath: 'agents/gsdd-approach-explorer.toml', content: renderCodexApproachExplorer(getDelegateContent('approach-explorer.md')) },
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

function buildCopilotGlobalAgentEntries() {
  return [
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
  if (target === 'copilot') return buildCopilotGlobalAgentEntries();
  return [];
}

function buildGlobalInstallSpecs(target, roots, ctx) {
  if (target === 'codex') {
    return [
      {
        runtime: 'agent-skills',
        rootDir: roots.codexSkills,
        entries: buildAgentCompatibleGlobalSkillEntries(ctx),
      },
      {
        runtime: 'codex',
        rootDir: roots.codex,
        entries: buildCodexGlobalAgentEntries(),
      },
    ];
  }

  if (target === 'opencode' && roots.opencode !== roots.opencodeSkills) {
    return [
      {
        runtime: 'agent-skills',
        rootDir: roots.opencodeSkills,
        entries: buildAgentCompatibleGlobalSkillEntries(ctx),
      },
      {
        runtime: 'opencode',
        rootDir: roots.opencode,
        entries: [
          ...buildOpenCodeGlobalCommandEntries(ctx, roots.opencodeSkills),
          ...buildOpenCodeGlobalAgentEntries(ctx),
        ],
      },
    ];
  }

  if (target === 'copilot' && roots.copilot !== roots.copilotSkills) {
    return [
      {
        runtime: 'agent-skills',
        rootDir: roots.copilotSkills,
        entries: buildAgentCompatibleGlobalSkillEntries(ctx),
      },
      {
        runtime: 'copilot',
        rootDir: roots.copilot,
        entries: buildCopilotGlobalAgentEntries(),
      },
    ];
  }

  return [
    {
      runtime: target,
      rootDir: roots[target],
      entries: buildGlobalEntries(target, ctx, roots[target]),
    },
  ];
}

function preflightInstallSpec(spec) {
  const previousManifest = readGlobalManifest(spec.rootDir);
  const nextFiles = {};
  const fileResults = spec.entries.map((entry) => writeManifestTrackedFile({
    rootDir: spec.rootDir,
    relativePath: entry.relativePath,
    content: entry.content,
    previousManifest,
    nextFiles,
    dryRun: true,
  }));
  const pruneResults = pruneStaleManifestTrackedFiles({
    rootDir: spec.rootDir,
    previousManifest,
    nextFiles,
    dryRun: true,
  });
  const results = [...fileResults, ...pruneResults];

  return {
    ...spec,
    previousManifest,
    nextFiles,
    results,
    blocked: results.filter((result) => result.status.startsWith('skipped_')),
  };
}

function writeInstallSpec(plan, ctx) {
  const nextFiles = {};
  const results = plan.entries.map((entry) => writeManifestTrackedFile({
    rootDir: plan.rootDir,
    relativePath: entry.relativePath,
    content: entry.content,
    previousManifest: plan.previousManifest,
    nextFiles,
    dryRun: false,
  }));
  results.push(...pruneStaleManifestTrackedFiles({
    rootDir: plan.rootDir,
    previousManifest: plan.previousManifest,
    nextFiles,
    dryRun: false,
  }));

  writeGlobalManifest(plan.rootDir, {
    product: 'Workspine',
    packageName: ctx.packageName,
    packageVersion: ctx.packageVersion,
    frameworkVersion: ctx.frameworkVersion,
    runtime: plan.runtime,
    generatedAt: new Date().toISOString(),
    files: nextFiles,
  });

  return results;
}

function planInstallTarget({ target, roots, ctx }) {
  const plans = buildGlobalInstallSpecs(target, roots, ctx).map(preflightInstallSpec);
  const blocked = plans.flatMap((plan) => plan.blocked);
  const rootDir = plans.map((plan) => plan.rootDir).join(', ');

  return {
    target,
    plans,
    rootDir,
    manifest: plans.map((plan) => `${plan.rootDir}/${GLOBAL_MANIFEST_FILENAME}`).join(', '),
    blocked,
  };
}

function completeInstallTarget(installPlan, { ctx, dryRun, selectedSetBlocked }) {
  const { plans, ...report } = installPlan;
  const results = dryRun || selectedSetBlocked
    ? plans.flatMap((entry) => entry.results)
    : plans.flatMap((entry) => writeInstallSpec(entry, ctx));

  return {
    ...report,
    results,
    selectedSetBlocked,
    writtenCount: results.filter((result) => result.status === 'written').length,
    unchangedCount: results.filter((result) => result.status === 'unchanged').length,
    wouldWriteCount: results.filter((result) => result.status === 'would_write').length,
    removedCount: results.filter((result) => result.status === 'removed_stale' || result.status === 'removed_missing').length,
    wouldRemoveCount: results.filter((result) => result.status === 'would_remove').length,
  };
}

function makeEnv(overrides = {}) {
  return Object.fromEntries(Object.entries({
    ...process.env,
    ...overrides,
  }).filter(([, value]) => value !== undefined && value !== null));
}

function quoteShellPart(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function runProbe(command, args, { cwd, env, timeoutMs = 30000, probeRunner } = {}) {
  if (probeRunner) return probeRunner(command, args, { cwd, env, timeoutMs });
  const commandLine = [command, ...args].map(quoteShellPart).join(' ');
  const result = process.platform === 'win32'
    ? spawnSync(commandLine, { cwd, env, encoding: 'utf-8', shell: true, timeout: timeoutMs })
    : spawnSync(command, args, { cwd, env, encoding: 'utf-8', shell: false, timeout: timeoutMs });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function checkLayout({ target, roots, ctx }) {
  const issues = [];
  const specs = buildGlobalInstallSpecs(target, roots, ctx);

  for (const spec of specs) {
    const manifest = readGlobalManifest(spec.rootDir);
    if (!manifest) {
      issues.push(`${spec.runtime}: missing ${GLOBAL_MANIFEST_FILENAME} under ${spec.rootDir}`);
      continue;
    }
    if (manifest.runtime !== spec.runtime) {
      issues.push(`${spec.runtime}: manifest runtime is ${manifest.runtime}`);
    }
    for (const entry of spec.entries) {
      const absolutePath = join(spec.rootDir, entry.relativePath);
      if (!existsSync(absolutePath)) {
        issues.push(`${spec.runtime}: missing ${entry.relativePath}`);
      }
      if (!manifest.files?.[entry.relativePath]) {
        issues.push(`${spec.runtime}: manifest does not track ${entry.relativePath}`);
      }
    }
  }

  return issues.length === 0
    ? { target, check: 'layout', status: 'passed', message: 'documented files and manifests exist' }
    : { target, check: 'layout', status: 'failed', message: issues.join('; ') };
}

function checkOpenCodeRuntime({ roots, cwd, probeRunner }) {
  const result = runProbe('opencode', ['debug', 'skill'], {
    cwd,
    env: makeEnv({
      HOME: roots.home,
      USERPROFILE: roots.home,
      XDG_CONFIG_HOME: roots.configHome,
      OPENCODE_CONFIG_DIR: roots.opencode,
    }),
    probeRunner,
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.error) {
    return { target: 'opencode', check: 'runtime_discovery', status: 'skipped', message: `opencode probe could not start: ${result.error}` };
  }
  if (result.status !== 0) {
    return { target: 'opencode', check: 'runtime_discovery', status: 'failed', message: `opencode debug skill exited ${result.status}: ${output.trim()}` };
  }
  if (!/\bgsdd-plan\b/.test(output)) {
    return { target: 'opencode', check: 'runtime_discovery', status: 'failed', message: 'opencode debug skill did not list gsdd-plan' };
  }
  return { target: 'opencode', check: 'runtime_discovery', status: 'passed', message: 'opencode debug skill listed gsdd-plan' };
}

function liveProbeCommand(target, roots) {
  const prompt = 'Do not edit files or run tools. If a Workspine skill named gsdd-plan is available in this session, answer exactly GSDD_SKILL_OK. Otherwise answer GSDD_SKILL_MISSING.';
  if (target === 'claude') {
    const claudePrompt = '/gsdd-plan Verification mode only. Do not edit files, do not invoke subagents, and do not run shell commands. If this Workspine gsdd-plan command resolved successfully, answer exactly GSDD_SKILL_OK. Otherwise answer exactly GSDD_SKILL_MISSING.';
    return {
      command: 'claude',
      args: ['-p', claudePrompt, '--no-session-persistence', '--max-budget-usd', '0.25', '--output-format', 'text', '--tools', 'Read'],
      env: makeEnv({ CLAUDE_CONFIG_DIR: roots.claude }),
    };
  }
  if (target === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '-c', 'model_reasoning_effort="high"', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', prompt],
      env: makeEnv({ HOME: roots.home, USERPROFILE: roots.home, CODEX_HOME: roots.codex }),
    };
  }
  if (target === 'copilot') {
    return {
      command: 'copilot',
      args: ['-p', prompt, '--effort', 'high', '--config-dir', roots.copilot, '--silent', '--no-custom-instructions'],
      env: makeEnv({ HOME: roots.home, USERPROFILE: roots.home, COPILOT_HOME: roots.copilot }),
    };
  }
  return null;
}

function checkLiveRuntime({ target, roots, cwd, probeRunner }) {
  const probe = liveProbeCommand(target, roots);
  if (!probe) {
    return { target, check: 'runtime_discovery', status: 'unproven', message: 'no live probe is defined for this target' };
  }
  const result = runProbe(probe.command, probe.args, {
    cwd,
    env: probe.env,
    timeoutMs: 120000,
    probeRunner,
  });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.error) {
    return { target, check: 'runtime_discovery', status: 'failed', message: `${target} live probe could not start: ${result.error}` };
  }
  if (result.status !== 0) {
    return { target, check: 'runtime_discovery', status: 'failed', message: `${target} live probe exited ${result.status}: ${output.trim()}` };
  }
  if (!/GSDD_SKILL_OK/.test(output)) {
    return { target, check: 'runtime_discovery', status: 'failed', message: `${target} live probe did not confirm gsdd-plan: ${output.trim()}` };
  }
  return { target, check: 'runtime_discovery', status: 'passed', message: `${target} live probe confirmed gsdd-plan` };
}

export function verifyGlobalRuntimeInstall({ targets, roots, ctx, liveRuntime = false, probeRunner } = {}) {
  const checks = [];

  for (const target of targets) {
    checks.push(checkLayout({ target, roots, ctx }));
    if (target === 'opencode') {
      checks.push(checkOpenCodeRuntime({ roots, cwd: ctx.cwd, probeRunner }));
      continue;
    }
    checks.push(liveRuntime
      ? checkLiveRuntime({ target, roots, cwd: ctx.cwd, probeRunner })
      : {
        target,
        check: 'runtime_discovery',
        status: 'unproven',
        message: 'no model-free runtime discovery probe is available; use the internal liveRuntime pressure harness for authenticated CLI sessions',
      });
  }

  return {
    checks,
    failed: checks.filter((check) => check.status === 'failed'),
    unproven: checks.filter((check) => check.status === 'unproven'),
    skipped: checks.filter((check) => check.status === 'skipped'),
  };
}

export function createCmdInstall(ctx) {
  return async function cmdInstall(...installArgs) {
    const globalFlag = installArgs.includes('--global') || installArgs.includes('-g');
    const localFlag = installArgs.includes('--local');
    const autoFlag = installArgs.includes('--auto');
    const dryRun = installArgs.includes('--dry');
    const verifyRuntime = installArgs.includes('--verify-runtime');
    const liveRuntime = installArgs.includes('--live-runtime');
    const toolsFlag = parseFlagValue(installArgs, '--tools');

    if (toolsFlag.invalid) {
      console.error('ERROR: --tools requires a value. Example: npx -y workspine install --global --tools claude,opencode');
      process.exitCode = 1;
      return;
    }

    if (localFlag) {
      console.error('ERROR: local project installation is `npx -y workspine init`. Global installation is `npx -y workspine install --global`.');
      process.exitCode = 1;
      return;
    }

    if (!globalFlag) {
      console.error('ERROR: install currently requires --global. For repo-local setup, run `npx -y workspine init`.');
      process.exitCode = 1;
      return;
    }

    if (verifyRuntime || liveRuntime) {
      console.error('ERROR: runtime probing is not part of the public install command. Use `npx -y workspine health` for repo-local setup checks; runtime pressure probes live in tests.');
      process.exitCode = 1;
      return;
    }

    const roots = resolveGlobalInstallRoots(ctx.globalInstallRootOptions);
    const targets = await resolveGlobalInstallTargets({
      args: installArgs,
      promptApi: ctx.globalInstallPromptApi,
      output: process.stdout,
      roots,
    });

    if (targets.length === 0) {
      const autoHint = autoFlag
        ? `No supported agent homes were detected for --auto. Choose one explicitly:\n  ${explicitGlobalInstallCommands().join('\n  ')}`
        : `Use --tools ${supportedGlobalTargets()} or run interactively.`;
      console.error(`ERROR: no global install targets selected. ${autoHint}`);
      process.exitCode = 1;
      return;
    }

    const invalidMessage = validateGlobalTools(targets);
    if (invalidMessage) {
      console.error(invalidMessage);
      process.exitCode = 1;
      return;
    }

    console.log(`Workspine global install - installing runtime surfaces${dryRun ? ' (dry run)' : ''}\n`);

    const installPlans = targets.map((target) => planInstallTarget({
      target,
      roots,
      ctx,
    }));
    const selectedSetBlocked = installPlans.some((plan) => plan.blocked.length > 0);
    const reports = installPlans.map((plan) => completeInstallTarget(plan, {
      ctx,
      dryRun,
      selectedSetBlocked,
    }));

    let hasBlocked = false;
    for (const report of reports) {
      const actionSummary = dryRun
        ? `${report.wouldWriteCount} file(s) would be written, ${report.wouldRemoveCount} stale file(s) would be removed`
        : selectedSetBlocked
          ? `${report.wouldWriteCount} file(s) not written; selected set blocked during preflight`
        : `${report.writtenCount} written, ${report.unchangedCount} unchanged, ${report.removedCount} stale removed`;
      console.log(`  - ${report.target}: ${actionSummary} (${report.rootDir})`);
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
