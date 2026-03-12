#!/usr/bin/env node

// gsdd - GSD Distilled CLI

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, realpathSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import { createAdapterRegistry } from './adapters/index.mjs';
import {
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
  upsertBoundedBlock,
  getDelegateContent,
} from './lib/rendering.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', 'distilled');
const CWD = process.cwd();
const PLANNING_DIR = join(CWD, '.planning');
const IS_MAIN = process.argv[1]
  ? realpathSync(process.argv[1]) === realpathSync(__filename)
  : false;

const [,, command, ...args] = process.argv;

const WORKFLOWS = [
  { name: 'gsdd-new-project', workflow: 'new-project.md', description: 'New project - questioning, codebase audit, research, spec, roadmap', agent: 'Plan', opencodeType: 'plan' },
  { name: 'gsdd-map-codebase', workflow: 'map-codebase.md', description: 'Map or refresh codebase - 4 parallel mappers, staleness check, secrets scan', agent: 'Plan', opencodeType: 'plan' },
  { name: 'gsdd-plan', workflow: 'plan.md', description: 'Plan a phase - research check, backward planning, task creation', agent: 'Plan', opencodeType: 'plan' },
  { name: 'gsdd-execute', workflow: 'execute.md', description: 'Execute a phase plan - implement tasks, verify changes, follow repo git conventions', agent: 'Code', opencodeType: 'edit' },
  { name: 'gsdd-verify', workflow: 'verify.md', description: 'Verify a completed phase - 3-level checks, anti-pattern scan', agent: 'Plan', opencodeType: 'plan' },
  { name: 'gsdd-audit-milestone', workflow: 'audit-milestone.md', description: 'Audit a completed milestone - cross-phase integration, requirements coverage, E2E flows', agent: 'Plan', opencodeType: 'plan' },
];

const COMMANDS = {
  init: cmdInit,
  update: cmdUpdate,
  'find-phase': cmdFindPhase,
  verify: cmdVerify,
  scaffold: cmdScaffold,
  help: cmdHelp,
};

const DEFAULT_GIT_PROTOCOL = {
  branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
  commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
  pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
};

const ADAPTERS = createAdapterRegistry({
  cwd: CWD,
  workflows: WORKFLOWS,
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderSkillContent,
  upsertBoundedBlock,
  getDelegateContent,
});

async function runCli(cliCommand = command, cliArgs = args) {
  if (!cliCommand || !COMMANDS[cliCommand]) {
    cmdHelp();
    if (cliCommand) process.exitCode = 1;
    return;
  }

  await COMMANDS[cliCommand](...cliArgs);
}

if (IS_MAIN) {
  await runCli();
}

async function cmdInit(...initArgs) {
  console.log('gsdd init - setting up SDD workflow\n');

  // 1) Create .planning/ structure
  if (existsSync(PLANNING_DIR)) {
    console.log('  - .planning/ already exists (skipping folder creation)');
  } else {
    mkdirSync(join(PLANNING_DIR, 'phases'), { recursive: true });
    mkdirSync(join(PLANNING_DIR, 'research'), { recursive: true });
    console.log('  - created .planning/ directory structure');
  }

  // 2) Copy templates into .planning/templates/
  const localTemplatesDir = join(PLANNING_DIR, 'templates');
  const globalTemplatesDir = join(DISTILLED_DIR, 'templates');
  if (!existsSync(localTemplatesDir)) {
    if (existsSync(globalTemplatesDir)) {
      cpSync(globalTemplatesDir, localTemplatesDir, { recursive: true });
      console.log('  - copied templates to .planning/templates/');
    } else {
      console.log('  - WARN: missing distilled/templates/; cannot copy templates');
    }
  } else {
    console.log('  - .planning/templates/ already exists');
  }

  // 2b) Copy canonical role contracts into .planning/templates/roles/
  const localRolesDir = join(PLANNING_DIR, 'templates', 'roles');
  const agentsDir = join(__dirname, '..', 'agents');
  if (!existsSync(localRolesDir)) {
    if (existsSync(agentsDir)) {
      mkdirSync(localRolesDir, { recursive: true });
      const roleFiles = readdirSync(agentsDir).filter(
        f => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_')
      );
      for (const f of roleFiles) {
        cpSync(join(agentsDir, f), join(localRolesDir, f));
      }
      console.log('  - copied role contracts to .planning/templates/roles/');
    } else {
      console.log('  - WARN: missing agents/; cannot copy role contracts');
    }
  } else {
    console.log('  - .planning/templates/roles/ already exists');
  }

  // 3) Create config.json via interactive CLI (only if missing)
  const configFile = join(PLANNING_DIR, 'config.json');
  if (!existsSync(configFile)) {
    if (!process.stdin.isTTY) {
      console.log('  - non-interactive mode detected: writing config.json with defaults');
      const config = {
        researchDepth: 'balanced',
        parallelization: true,
        commitDocs: true,
        modelProfile: 'balanced',
        workflow: { research: true, planCheck: true, verifier: true },
        gitProtocol: { ...DEFAULT_GIT_PROTOCOL },
        initVersion: 'v1.1',
      };
      writeFileSync(configFile, JSON.stringify(config, null, 2));
      console.log('  - saved .planning/config.json (defaults — re-run gsdd init in a terminal to customize)\n');
    } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

    console.log("  Let's configure the planning strategy for this project:\n");

    // --- Research depth ---
    console.log('  Research depth:');
    console.log('   - balanced: SOTA research per phase (recommended)');
    console.log('   - fast: skip deep domain research, plan from existing knowledge');
    console.log('   - deep: exhaustive web sweeps + parallel researchers for every feature');
    let researchDepth = await askQuestion('  Depth [balanced/fast/deep] (default: balanced): ');
    researchDepth = researchDepth.trim().toLowerCase();
    if (!['balanced', 'fast', 'deep'].includes(researchDepth)) researchDepth = 'balanced';

    // --- Parallelization ---
    console.log('\n  Parallelization (run independent agents simultaneously):');
    console.log('   - yes: faster, uses more tokens (recommended for non-trivial projects)');
    console.log('   - no: sequential, lower token usage');
    let parallelInput = await askQuestion('  Parallelize agents? [yes/no] (default: yes): ');
    const parallelization = parallelInput.trim().toLowerCase() !== 'no';

    // --- Commit planning docs ---
    console.log('\n  Version control for planning docs:');
    console.log('   - yes: .planning/ tracked in git (recommended — enables history + recovery)');
    console.log('   - no: .planning/ added to .gitignore (local only)');
    let commitInput = await askQuestion('  Commit planning docs to git? [yes/no] (default: yes): ');
    const commitDocs = commitInput.trim().toLowerCase() !== 'no';

    // --- Model profile ---
    console.log('\n  AI model profile for planning agents:');
    console.log('   - balanced: capable model for most agents (recommended)');
    console.log('   - quality: most capable model for research/roadmap (higher cost)');
    console.log('   - budget: fastest/cheapest model (lower quality for complex tasks)');
    let modelProfile = await askQuestion('  Model profile [balanced/quality/budget] (default: balanced): ');
    modelProfile = modelProfile.trim().toLowerCase();
    if (!['balanced', 'quality', 'budget'].includes(modelProfile)) modelProfile = 'balanced';

    // --- Workflow toggles ---
    console.log('\n  Workflow agents (each adds quality but costs tokens/time):');

    let researchInput = await askQuestion('  Research before planning each phase? [yes/no] (default: yes): ');
    const workflowResearch = researchInput.trim().toLowerCase() !== 'no';

    let planCheckInput = await askQuestion('  Verify plans achieve their goals before executing? [yes/no] (default: yes): ');
    const workflowPlanCheck = planCheckInput.trim().toLowerCase() !== 'no';

    let verifierInput = await askQuestion('  Verify phase deliverables after execution? [yes/no] (default: yes): ');
    const workflowVerifier = verifierInput.trim().toLowerCase() !== 'no';

    // --- Git protocol ---
    console.log('\n  Version Control Protocol (Advisory)');
    console.log('   This captures preferred guidance. Repo/user conventions still win over framework defaults.');

    let branchStrategy = await askQuestion('   Branching guidance (default: follow existing repo conventions; use feature branches for significant changes): ');
    branchStrategy = branchStrategy.trim() || DEFAULT_GIT_PROTOCOL.branch;

    let commitStrategy = await askQuestion('   Commit guidance (default: logical grouping, no phase/plan/task IDs unless requested): ');
    commitStrategy = commitStrategy.trim() || DEFAULT_GIT_PROTOCOL.commit;

    let prStrategy = await askQuestion('   PR guidance (default: follow existing repo review workflow): ');
    prStrategy = prStrategy.trim() || DEFAULT_GIT_PROTOCOL.pr;

    if (!commitDocs) {
      const gitignorePath = join(CWD, '.gitignore');
      const ignoreEntry = '\n# GSDD planning docs (local only)\n.planning/\n';
      if (existsSync(gitignorePath)) {
        const existing = readFileSync(gitignorePath, 'utf-8');
        if (!existing.includes('.planning/')) {
          writeFileSync(gitignorePath, existing + ignoreEntry);
          console.log('  - added .planning/ to .gitignore');
        }
      } else {
        writeFileSync(gitignorePath, ignoreEntry.trimStart());
        console.log('  - created .gitignore with .planning/ entry');
      }
    }

    const config = {
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
    writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log('\n  - saved .planning/config.json\n');
    rl.close();
    } // end isTTY else
  } else {
    console.log('  - .planning/config.json already exists');
  }

  // 4) Always generate open-standard skills into .agents/skills/gsdd-*
  // This is project-local and does not require touching root AGENTS.md.
  generateOpenStandardSkills();
  console.log('  - generated open-standard skills (.agents/skills/gsdd-*)');
  console.log('  - Codex CLI uses these skills directly; no Codex-specific adapter file is generated');

  // 5) Generate requested/detected adapters
  const parsedTools = parseToolsFlag(initArgs);
  const requestedTools = normalizeRequestedTools(parsedTools);
  const platforms = parsedTools.length > 0 ? requestedTools : detectPlatforms();

  for (const adapter of resolveAdapters(platforms)) {
    adapter.generate();
    console.log(`  - ${adapter.summary('generated')}`);
  }

  console.log('\nSDD initialized.');
  console.log('Next: run the new-project workflow using your tool:');
  console.log('  - open `.agents/skills/gsdd-new-project/SKILL.md` (or run the equivalent slash command if your tool supports skills)');
  console.log('  - then follow the new-project workflow to produce `.planning/SPEC.md` and `.planning/ROADMAP.md`\n');
}

function cmdUpdate(...updateArgs) {
  console.log('gsdd update - regenerating adapter files\n');

  const parsedTools = parseToolsFlag(updateArgs);
  const requestedTools = normalizeRequestedTools(parsedTools);
  const platforms = parsedTools.length > 0 ? requestedTools : detectPlatforms();

  let updated = false;

  // Open-standard skills (if present or requested)
  if (platforms.length > 0 || existsSync(join(CWD, '.agents', 'skills'))) {
    generateOpenStandardSkills();
    console.log('  - updated open-standard skills (.agents/skills/gsdd-*)');
    updated = true;
  }

  for (const adapter of getAdaptersToUpdate(platforms)) {
    adapter.generate();
    console.log(`  - ${adapter.summary('updated')}`);
    updated = true;
  }

  if (!updated) {
    console.log('  - no adapters found to update (run `gsdd init` first)');
  } else {
    console.log('\nAdapters updated.\n');
  }
}

function cmdFindPhase(...args) {
  const phaseNum = args[0];

  if (!existsSync(PLANNING_DIR)) {
    output({ error: 'No .planning/ directory found. Run `gsdd init` then the new-project workflow first.' });
    return;
  }

  const roadmapPath = join(PLANNING_DIR, 'ROADMAP.md');
  if (!existsSync(roadmapPath)) {
    output({ error: 'No ROADMAP.md found. Run the new-project workflow first.' });
    return;
  }

  const phasesDir = join(PLANNING_DIR, 'phases');
  const researchDir = join(PLANNING_DIR, 'research');

  if (phaseNum) {
    const plans = findFiles(phasesDir, `${padPhase(phaseNum)}-PLAN`);
    const summaries = findFiles(phasesDir, `${padPhase(phaseNum)}-SUMMARY`);

    output({
      phase: parseInt(phaseNum, 10),
      directory: phasesDir,
      plans,
      summaries,
      hasResearch: existsSync(researchDir) && readdirSync(researchDir).length > 0,
      incomplete: plans.filter((p) => !summaries.some((s) => s.replace('SUMMARY', '') === p.replace('PLAN', ''))),
    });
    return;
  }

  const allFiles = existsSync(phasesDir) ? readdirSync(phasesDir) : [];
  const plans = allFiles.filter((f) => f.includes('PLAN'));
  const summaries = allFiles.filter((f) => f.includes('SUMMARY'));

  const roadmap = readFileSync(roadmapPath, 'utf-8');
  const phases = parsePhaseStatuses(roadmap);

  output({
    phases,
    planCount: plans.length,
    summaryCount: summaries.length,
    currentPhase: phases.find((p) => p.status === 'in_progress') || phases.find((p) => p.status === 'not_started') || null,
    hasResearch: existsSync(researchDir) && readdirSync(researchDir).length > 0,
  });
}

function cmdVerify(...args) {
  const phaseNum = args[0];
  if (!phaseNum) {
    console.error('Usage: gsdd verify <phase-number>');
    process.exit(1);
  }

  if (!existsSync(PLANNING_DIR)) {
    console.error('No .planning/ directory found.');
    process.exit(1);
  }

  const planFile = findFiles(join(PLANNING_DIR, 'phases'), `${padPhase(phaseNum)}-PLAN`)[0];
  if (!planFile) {
    console.error(`No plan found for phase ${phaseNum}`);
    process.exit(1);
  }

  const planPath = join(PLANNING_DIR, 'phases', planFile);
  const plan = readFileSync(planPath, 'utf-8');

  const fileMatches = plan.matchAll(/<files>([\s\S]*?)<\/files>/g);
  const expectedFiles = [];
  for (const match of fileMatches) {
    const lines = match[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'));
    for (const line of lines) {
      const fileMatch = line.match(/(?:CREATE|MODIFY):\s*(.+)/);
      if (fileMatch) expectedFiles.push(fileMatch[1].trim());
    }
  }

  const results = expectedFiles.map((f) => {
    const fullPath = join(CWD, f);
    const exists = existsSync(fullPath);
    let substantive = false;
    if (exists) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const meaningfulLines = content.split('\n').filter(
          (l) => l.trim() && !/^\s*(\/\/|\/\*|\*|#)/.test(l)
        );
        substantive = meaningfulLines.length >= 3 && !content.includes('// TODO: implement');
      } catch {
        substantive = false;
      }
    }
    return { file: f, exists, substantive };
  });

  const antiPatterns = [];
  for (const r of results) {
    if (!r.exists) continue;
    try {
      const content = readFileSync(join(CWD, r.file), 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (/TODO|FIXME|HACK|XXX/.test(line)) {
          antiPatterns.push({ file: r.file, line: i + 1, pattern: 'TODO/FIXME', content: line.trim() });
        }
        if (/catch\s*\([^)]*\)\s*\{[\s]*\}/.test(line) || /catch\s*\([^)]*\)\s*\{\s*$/.test(line)) {
          antiPatterns.push({ file: r.file, line: i + 1, pattern: 'Empty catch', content: line.trim() });
        }
      });
    } catch {
      // skip unreadable files
    }
  }

  output({
    phase: parseInt(phaseNum, 10),
    artifacts: results,
    allExist: results.every((r) => r.exists),
    allSubstantive: results.filter((r) => r.exists).every((r) => r.substantive),
    antiPatterns,
    antiPatternCount: antiPatterns.length,
  });
}

function cmdScaffold(...args) {
  const [type, ...rest] = args;

  if (type !== 'phase') {
    console.error('Usage: gsdd scaffold phase <number> [name]');
    process.exit(1);
  }

  const phaseNum = rest[0];
  const phaseName = rest.slice(1).join(' ');
  if (!phaseNum) {
    console.error('Usage: gsdd scaffold phase <number> [name]');
    process.exit(1);
  }

  const phasesDir = join(PLANNING_DIR, 'phases');
  mkdirSync(phasesDir, { recursive: true });

  const planFile = join(phasesDir, `${padPhase(phaseNum)}-PLAN.md`);
  if (existsSync(planFile)) {
    console.log(`  - ${basename(planFile)} already exists`);
    return;
  }

  const content = `# Phase ${phaseNum}: ${phaseName || '[Name]'} - Plan

## Phase Goal
[From ROADMAP.md]

## Requirements Covered
[REQ-IDs from SPEC.md]

## Approach
[2-3 sentences]

## Must-Haves (from success criteria)
1. [Success criterion]

## Tasks

<!-- Add tasks using XML format:
<task id="${phaseNum}-01">
  <files>
    - CREATE: path/to/file
  </files>
  <action>Description of what to implement</action>
  <verify>How to verify it works</verify>
  <done>When is this task done</done>
</task>
-->

## Notes
`;

  writeFileSync(planFile, content);
  console.log(`  - created ${basename(planFile)}`);
}

function cmdHelp() {
  console.log(`
gsdd - GSD Distilled CLI
Spec-Driven Development for AI coding agents.

Usage: gsdd <command> [args]

Commands:
  init [--tools <platform>]   Set up SDD + generate adapters
  update [--tools <platform>] Regenerate adapters from latest framework sources
  find-phase [N]              Show phase info as JSON (for agent consumption)
  verify <N>                  Run artifact checks for phase N
  scaffold phase <N> [name]   Create a new phase plan file

Platforms (for --tools):
  claude    Generate Claude Code skills (.claude/skills/gsdd-*), commands (.claude/commands/gsdd-*.md), and native agents (.claude/agents/gsdd-*.md)
  opencode  Generate OpenCode local slash commands (.opencode/commands/gsdd-*.md) + native agents (.opencode/agents/gsdd-*.md)
  codex     Deprecated compatibility alias. Codex CLI uses the default .agents/skills/gsdd-* skills and generates no extra files
  agents    Generate/Update root AGENTS.md (bounded GSDD block)
  cursor    Same as 'agents'
  copilot   Same as 'agents'
  gemini    Same as 'agents'
  all       Generate all extra adapters (Claude, OpenCode, AGENTS-based surfaces)

Notes:
  - init always generates open-standard skills at .agents/skills/gsdd-* (portable workflow entrypoints and the primary Codex CLI surface)
  - --tools claude also generates native commands at .claude/commands/gsdd-*.md and native agents at .claude/agents/gsdd-*.md
  - --tools opencode also generates native agents at .opencode/agents/gsdd-*.md
  - --tools codex is deprecated and does not generate .codex/AGENTS.md
  - root AGENTS.md is only written on init when explicitly requested via --tools agents (or all)

Examples:
  npx gsdd init
  npx gsdd init --tools claude
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

function detectPlatforms() {
  return Object.values(ADAPTERS)
    .filter((adapter, idx, arr) => arr.findIndex((other) => other.id === adapter.id) === idx)
    .filter((adapter) => adapter.detect())
    .map((adapter) => adapter.name);
}

function parseToolsFlag(flagArgs) {
  const idx = flagArgs.indexOf('--tools');
  if (idx === -1) return [];
  const value = flagArgs[idx + 1];
  if (!value) return [];
  if (value === 'all') return ['claude', 'opencode', 'agents'];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function normalizeRequestedTools(requestedTools) {
  if (!requestedTools.includes('codex')) return requestedTools;

  console.log('  - NOTE: `--tools codex` is deprecated. Codex CLI uses the default `.agents/skills/gsdd-*` skills and no longer generates `.codex/AGENTS.md`.');
  return requestedTools.filter((tool) => tool !== 'codex');
}

function generateOpenStandardSkills() {
  for (const w of WORKFLOWS) {
    const dir = join(CWD, '.agents', 'skills', w.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), renderSkillContent(w));
  }
}

function resolveAdapters(platformNames) {
  const seen = new Set();
  const resolved = [];

  for (const platformName of platformNames) {
    const adapter = ADAPTERS[platformName];
    if (!adapter || seen.has(adapter.id)) continue;
    seen.add(adapter.id);
    resolved.push(adapter);
  }

  return resolved;
}

function getAdaptersToUpdate(platformNames) {
  const requested = new Set(platformNames);
  const seen = new Set();
  const adapters = [];

  for (const [platformName, adapter] of Object.entries(ADAPTERS)) {
    if (seen.has(adapter.id)) continue;
    if (!requested.has(platformName) && !adapter.isInstalled()) continue;
    seen.add(adapter.id);
    adapters.push(adapter);
  }

  return adapters;
}

function findFiles(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(prefix) || f.startsWith(prefix.replace(/^0+/, '')));
}

function padPhase(n) {
  return String(n).padStart(2, '0');
}

function parsePhaseStatuses(roadmap) {
  const phases = [];
  const lines = roadmap.split('\n');
  for (const line of lines) {
    // Supports:
    // - checkbox statuses: [ ] / [x]
    // - legacy emoji markers in ROADMAP templates: not started / in progress / done
    // - mojibake-encoded variants that exist in some files
    const match = line.match(
      /^[-*]\s*(\[[ x]\]|\[-\]|â¬œ|ðŸ”„|âœ…|⬜|🔄|✅)\s*\*\*Phase\s+(\d+):\s*(.+?)\*\*/i
    );
    if (match) {
      const rawStatus = match[1].toLowerCase();
      let status = 'not_started';
      if (rawStatus === '[x]' || rawStatus === 'âœ…' || rawStatus === '✅') status = 'done';
      else if (rawStatus === '[-]') status = 'in_progress';
      else if (rawStatus === 'ðÿ”„' || rawStatus === '🔄') status = 'in_progress';
      phases.push({
        number: parseInt(match[2], 10),
        name: match[3].replace(/\*\*/g, '').split('-')[0].trim(),
        status,
      });
    }
  }
  return phases;
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

export { cmdHelp, cmdInit, cmdUpdate, cmdFindPhase, cmdVerify, cmdScaffold, runCli };
