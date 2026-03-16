// init.mjs - CLI bootstrap, update, and help command implementations

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { join, isAbsolute } from 'path';
import * as readline from 'readline';
import { renderSkillContent } from './rendering.mjs';
import { buildManifest, writeManifest } from './manifest.mjs';
import { parseFlagValue, parseToolsFlag, parseAutoFlag } from './cli-utils.mjs';
import { DEFAULT_GIT_PROTOCOL, buildDefaultConfig, normalizeModelProfile } from './models.mjs';
import { installProjectTemplates, refreshTemplates } from './templates.mjs';

export function createCmdInit(ctx) {
  return async function cmdInit(...initArgs) {
    console.log('gsdd init - setting up SDD workflow\n');

    const isAuto = parseAutoFlag(initArgs);
    const toolsFlag = parseFlagValue(initArgs, '--tools');
    const briefFlag = parseFlagValue(initArgs, '--brief');
    let briefSource = null;

    if (toolsFlag.invalid) {
      console.error('ERROR: --tools requires a value. Example: gsdd init --tools claude');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.invalid) {
      console.error('ERROR: --brief requires a file path. Example: gsdd init --brief project-idea.md');
      process.exitCode = 1;
      return;
    }

    if (briefFlag.value) {
      briefSource = isAbsolute(briefFlag.value) ? briefFlag.value : join(ctx.cwd, briefFlag.value);
      if (!existsSync(briefSource)) {
        console.error(`ERROR: Brief file not found: ${briefFlag.value}`);
        process.exitCode = 1;
        return;
      }
    }

    const parsedTools = parseToolsFlag(initArgs);
    if (isAuto && parsedTools.length === 0) {
      console.error('ERROR: --auto requires --tools <platform>. Example: gsdd init --auto --tools claude');
      process.exitCode = 1;
      return;
    }

    if (existsSync(ctx.planningDir)) {
      console.log('  - .planning/ already exists (skipping folder creation)');
    } else {
      mkdirSync(join(ctx.planningDir, 'phases'), { recursive: true });
      mkdirSync(join(ctx.planningDir, 'research'), { recursive: true });
      console.log('  - created .planning/ directory structure');
    }

    installProjectTemplates(ctx);
    await ensureConfig(ctx.cwd, ctx.planningDir, isAuto);

    if (briefSource) {
      cpSync(briefSource, join(ctx.planningDir, 'PROJECT_BRIEF.md'));
      console.log('  - copied project brief to .planning/PROJECT_BRIEF.md');
    }

    generateOpenStandardSkills(ctx.cwd, ctx.workflows);
    console.log('  - generated open-standard skills (.agents/skills/gsdd-*)');

    const requestedTools = normalizeRequestedTools(parsedTools);
    const platforms = parsedTools.length > 0 ? requestedTools : detectPlatforms(ctx.adapters);
    for (const adapter of resolveAdapters(ctx.adapters, platforms)) {
      adapter.generate();
      console.log(`  - ${adapter.summary('generated')}`);
    }

    const manifest = buildManifest({ planningDir: ctx.planningDir, frameworkVersion: ctx.frameworkVersion });
    writeManifest(ctx.planningDir, manifest);
    console.log('  - wrote generation manifest');

    console.log('\nSDD initialized.');
    console.log('Next: run the new-project workflow using your tool:');
    console.log('  - open `.agents/skills/gsdd-new-project/SKILL.md` (or run the equivalent slash command if your tool supports skills)');
    console.log('  - then follow the new-project workflow to produce `.planning/SPEC.md` and `.planning/ROADMAP.md`\n');
  };
}

export function createCmdUpdate(ctx) {
  return function cmdUpdate(...updateArgs) {
    const isDry = updateArgs.includes('--dry');
    const doTemplates = updateArgs.includes('--templates');

    console.log(`gsdd update - regenerating adapter files${isDry ? ' (dry run)' : ''}\n`);

    const parsedTools = parseToolsFlag(updateArgs);
    const requestedTools = normalizeRequestedTools(parsedTools);
    const platforms = parsedTools.length > 0 ? requestedTools : detectPlatforms(ctx.adapters);

    let updated = false;

    if (doTemplates) {
      refreshTemplates({ ...ctx, isDry });
      updated = true;
    }

    if (platforms.length > 0 || existsSync(join(ctx.cwd, '.agents', 'skills'))) {
      if (isDry) {
        console.log('  - would update open-standard skills (.agents/skills/gsdd-*)');
      } else {
        generateOpenStandardSkills(ctx.cwd, ctx.workflows);
        console.log('  - updated open-standard skills (.agents/skills/gsdd-*)');
      }
      updated = true;
    }

    for (const adapter of getAdaptersToUpdate(ctx.adapters, platforms)) {
      if (isDry) {
        console.log(`  - would update ${adapter.name} adapter`);
      } else {
        adapter.generate();
        console.log(`  - ${adapter.summary('updated')}`);
      }
      updated = true;
    }

    if (!updated) {
      console.log('  - no adapters found to update (run `gsdd init` first)');
    } else if (isDry) {
      console.log('\nDry run complete. No files were written.\n');
    } else {
      if (doTemplates && existsSync(ctx.planningDir)) {
        const manifest = buildManifest({ planningDir: ctx.planningDir, frameworkVersion: ctx.frameworkVersion });
        writeManifest(ctx.planningDir, manifest);
        console.log('  - updated generation manifest');
      }
      console.log('\nAdapters updated.\n');
    }
  };
}

export function cmdHelp() {
  console.log(`
gsdd - GSD Distilled CLI
Spec-Driven Development for AI coding agents.

Usage: gsdd <command> [args]

Commands:
  init [--tools <platform>] [--auto] [--brief <file>]
                              Set up SDD + generate adapters
                              --auto: non-interactive mode with smart defaults (requires --tools)
                              --brief <file>: copy project brief to .planning/PROJECT_BRIEF.md
  update [--tools <platform>] [--templates] [--dry]
                              Regenerate adapters from latest framework sources
                              --templates: also refresh .planning/templates/ and roles
                              --dry: preview changes without writing files
  models [subcommand]         Inspect or update model profile / runtime overrides
  find-phase [N]              Show phase info as JSON (for agent consumption)
  verify <N>                  Run artifact checks for phase N
  scaffold phase <N> [name]   Create a new phase plan file

Platforms (for --tools):
  claude    Generate Claude Code skills (.claude/skills/gsdd-*), commands (.claude/commands/gsdd-*.md), and native agents (.claude/agents/gsdd-*.md)
  opencode  Generate OpenCode local slash commands (.opencode/commands/gsdd-*.md) + native agents (.opencode/agents/gsdd-*.md)
  codex     Generate Codex CLI native agents (.codex/agents/gsdd-*.toml) for planning and plan checking
  agents    Generate/Update root AGENTS.md (bounded GSDD block)
  cursor    Same as 'agents'
  copilot   Same as 'agents'
  gemini    Same as 'agents'
  all       Generate all adapters (Claude, OpenCode, Codex, AGENTS-based surfaces)

Notes:
  - init always generates open-standard skills at .agents/skills/gsdd-* (portable workflow entrypoints)
  - --tools claude also generates native commands at .claude/commands/gsdd-*.md and native agents at .claude/agents/gsdd-*.md
  - --tools opencode also generates native agents at .opencode/agents/gsdd-*.md
  - --tools codex generates native agents at .codex/agents/gsdd-*.toml for planning and plan checking
  - root AGENTS.md is only written on init when explicitly requested via --tools agents (or all)

Examples:
  npx gsdd init
  npx gsdd init --tools claude
  npx gsdd init --auto --tools claude --brief project-idea.md
  npx gsdd init --auto --tools all
  npx gsdd models show
  npx gsdd models profile quality
  npx gsdd models agent-profile --agent plan-checker --profile quality
  npx gsdd models set --runtime opencode --agent plan-checker --model anthropic/claude-opus-4-6
  npx gsdd models clear --runtime opencode --agent plan-checker
  npx gsdd init --tools agents
  npx gsdd init --tools all
  npx gsdd update
  npx gsdd find-phase
  npx gsdd verify 1
  npx gsdd scaffold phase 4 Payments

Workflows (run via skills/adapters generated by init, not direct CLI):
  map-codebase      Map or refresh codebase (.agents/skills/gsdd-map-codebase/)
  audit-milestone   Audit a completed milestone (.agents/skills/gsdd-audit-milestone/)
`);
}

function detectPlatforms(adapters) {
  return Object.values(adapters)
    .filter((adapter, index, arr) => arr.findIndex((other) => other.id === adapter.id) === index)
    .filter((adapter) => adapter.detect())
    .map((adapter) => adapter.name);
}

function normalizeRequestedTools(requestedTools) {
  return requestedTools;
}

function generateOpenStandardSkills(cwd, workflows) {
  for (const workflow of workflows) {
    const dir = join(cwd, '.agents', 'skills', workflow.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), renderSkillContent(workflow));
  }
}

function resolveAdapters(adapters, platformNames) {
  const seen = new Set();
  const resolved = [];

  for (const platformName of platformNames) {
    const adapter = adapters[platformName];
    if (!adapter || seen.has(adapter.id)) continue;
    seen.add(adapter.id);
    resolved.push(adapter);
  }

  return resolved;
}

function getAdaptersToUpdate(adapters, platformNames) {
  const requested = new Set(platformNames);
  const seen = new Set();
  const installed = [];

  for (const [platformName, adapter] of Object.entries(adapters)) {
    if (seen.has(adapter.id)) continue;
    if (!requested.has(platformName) && !adapter.isInstalled()) continue;
    seen.add(adapter.id);
    installed.push(adapter);
  }

  return installed;
}

async function ensureConfig(cwd, planningDir, isAuto) {
  const configFile = join(planningDir, 'config.json');
  if (existsSync(configFile)) {
    console.log('  - .planning/config.json already exists');
    return;
  }

  if (isAuto) {
    console.log('  - auto mode: writing config.json with defaults');
    writeFileSync(configFile, JSON.stringify(buildDefaultConfig({ autoAdvance: true }), null, 2));
    console.log('  - saved .planning/config.json (auto mode - autoAdvance enabled)\n');
    return;
  }

  if (!process.stdin.isTTY) {
    console.log('  - non-interactive mode detected: writing config.json with defaults');
    writeFileSync(configFile, JSON.stringify(buildDefaultConfig(), null, 2));
    console.log('  - saved .planning/config.json (defaults - re-run gsdd init in a terminal to customize)\n');
    return;
  }

  const config = await promptForConfig(cwd);
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log('\n  - saved .planning/config.json\n');
}

async function promptForConfig(cwd) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    console.log("  Let's configure the planning strategy for this project:\n");

    console.log('  Research depth:');
    console.log('   - balanced: SOTA research per phase (recommended)');
    console.log('   - fast: skip deep domain research, plan from existing knowledge');
    console.log('   - deep: exhaustive web sweeps + parallel researchers for every feature');
    let researchDepth = await askQuestion('  Depth [balanced/fast/deep] (default: balanced): ');
    researchDepth = researchDepth.trim().toLowerCase();
    if (!['balanced', 'fast', 'deep'].includes(researchDepth)) researchDepth = 'balanced';

    console.log('\n  Parallelization (run independent agents simultaneously):');
    console.log('   - yes: faster, uses more tokens (recommended for non-trivial projects)');
    console.log('   - no: sequential, lower token usage');
    let parallelInput = await askQuestion('  Parallelize agents? [yes/no] (default: yes): ');
    const parallelization = parallelInput.trim().toLowerCase() !== 'no';

    console.log('\n  Version control for planning docs:');
    console.log('   - yes: .planning/ tracked in git (recommended - enables history + recovery)');
    console.log('   - no: .planning/ added to .gitignore (local only)');
    let commitInput = await askQuestion('  Commit planning docs to git? [yes/no] (default: yes): ');
    const commitDocs = commitInput.trim().toLowerCase() !== 'no';

    console.log('\n  AI model profile for planning agents:');
    console.log('   - balanced: capable model for most agents (recommended)');
    console.log('   - quality: most capable model for research/roadmap (higher cost)');
    console.log('   - budget: fastest/cheapest model (lower quality for complex tasks)');
    let modelProfile = await askQuestion('  Model profile [balanced/quality/budget] (default: balanced): ');
    modelProfile = normalizeModelProfile(modelProfile.trim().toLowerCase());

    console.log('\n  Workflow agents (each adds quality but costs tokens/time):');
    let researchInput = await askQuestion('  Research before planning each phase? [yes/no] (default: yes): ');
    const workflowResearch = researchInput.trim().toLowerCase() !== 'no';

    let planCheckInput = await askQuestion('  Verify plans achieve their goals before executing? [yes/no] (default: yes): ');
    const workflowPlanCheck = planCheckInput.trim().toLowerCase() !== 'no';

    let verifierInput = await askQuestion('  Verify phase deliverables after execution? [yes/no] (default: yes): ');
    const workflowVerifier = verifierInput.trim().toLowerCase() !== 'no';

    console.log('\n  Version Control Protocol (Advisory)');
    console.log('   This captures preferred guidance. Repo/user conventions still win over framework defaults.');

    let branchStrategy = await askQuestion('   Branching guidance (default: follow existing repo conventions; use feature branches for significant changes): ');
    branchStrategy = branchStrategy.trim() || DEFAULT_GIT_PROTOCOL.branch;

    let commitStrategy = await askQuestion('   Commit guidance (default: logical grouping, no phase/plan/task IDs unless requested): ');
    commitStrategy = commitStrategy.trim() || DEFAULT_GIT_PROTOCOL.commit;

    let prStrategy = await askQuestion('   PR guidance (default: follow existing repo review workflow): ');
    prStrategy = prStrategy.trim() || DEFAULT_GIT_PROTOCOL.pr;

    if (!commitDocs) {
      ensureGitignoreEntry(cwd);
    }

    return {
      researchDepth,
      parallelization,
      commitDocs,
      modelProfile,
      workflow: {
        research: workflowResearch,
        planCheck: workflowPlanCheck,
        verifier: workflowVerifier,
      },
      gitProtocol: {
        branch: branchStrategy,
        commit: commitStrategy,
        pr: prStrategy,
      },
      initVersion: 'v1.1',
    };
  } finally {
    rl.close();
  }
}

function ensureGitignoreEntry(cwd) {
  const gitignorePath = join(cwd, '.gitignore');
  const ignoreEntry = '\n# GSDD planning docs (local only)\n.planning/\n';

  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('.planning/')) {
      writeFileSync(gitignorePath, existing + ignoreEntry);
      console.log('  - added .planning/ to .gitignore');
    }
    return;
  }

  writeFileSync(gitignorePath, ignoreEntry.trimStart());
  console.log('  - created .gitignore with .planning/ entry');
}
