#!/usr/bin/env node

// gsdd — GSD Distilled CLI
// Zero dependencies. Node.js built-ins only.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', 'distilled');
const CWD = process.cwd();
const PLANNING_DIR = join(CWD, '.planning');

// ─── CLI Entry Point ──────────────────────────────────────────────

const [,, command, ...args] = process.argv;

const COMMANDS = {
  init: cmdInit,
  update: cmdUpdate,
  'find-phase': cmdFindPhase,
  verify: cmdVerify,
  scaffold: cmdScaffold,
  help: cmdHelp,
};

if (!command || !COMMANDS[command]) {
  cmdHelp();
  process.exit(command ? 1 : 0);
}

COMMANDS[command](...args);

// ─── Commands ─────────────────────────────────────────────────────

function cmdInit(...initArgs) {
  console.log('🚀 gsdd init — Setting up SDD workflow\n');

  // 1. Create .planning/ structure
  if (existsSync(PLANNING_DIR)) {
    console.log('  ⚠️  .planning/ already exists — skipping');
  } else {
    mkdirSync(join(PLANNING_DIR, 'phases'), { recursive: true });
    mkdirSync(join(PLANNING_DIR, 'research'), { recursive: true });
    console.log('  ✅ Created .planning/ directory structure');
  }

  // 2. Determine which adapters to generate
  const requestedTools = parseToolsFlag(initArgs);
  const platforms = requestedTools.length > 0 ? requestedTools : detectPlatforms();

  // 3. Generate adapters
  if (platforms.length === 0) {
    // No platform detected — generate universal AGENTS.md as fallback
    generateAgentsMd();
    console.log('  ✅ Generated AGENTS.md (universal adapter — works with 20+ AI tools)');
    console.log('  ℹ️  No specific agent platform detected');
    console.log('     For Claude Code:  gsdd init --tools claude');
    console.log('     For Codex/other:  AGENTS.md is already set up');
  } else {
    for (const platform of platforms) {
      if (platform === 'claude') {
        generateClaudeSkills();
        console.log('  ✅ Generated Claude Code skills (.claude/skills/gsdd-*)');
      }
      if (platform === 'agents' || platform === 'codex' || platform === 'cursor' ||
          platform === 'copilot' || platform === 'gemini') {
        generateAgentsMd();
        console.log('  ✅ Generated AGENTS.md (universal adapter)');
      }
    }
    // Always generate AGENTS.md as fallback if only claude was requested
    if (platforms.length === 1 && platforms[0] === 'claude') {
      generateAgentsMd();
      console.log('  ✅ Generated AGENTS.md (universal fallback)');
    }
  }

  console.log('\n✅ SDD initialized. Your AI agent can now follow the GSDD workflow.\n');
}

function cmdUpdate(...updateArgs) {
  console.log('🔄 gsdd update — Regenerating adapter files\n');

  // Determine which adapters to regenerate
  const requestedTools = parseToolsFlag(updateArgs);
  const platforms = requestedTools.length > 0 ? requestedTools : detectPlatforms();

  let updated = false;

  // Regenerate Claude skills if present or requested
  if (platforms.includes('claude') || existsSync(join(CWD, '.claude', 'skills', 'gsdd-init'))) {
    generateClaudeSkills();
    console.log('  ✅ Regenerated Claude Code skills (.claude/skills/gsdd-*)');
    updated = true;
  }

  // Regenerate AGENTS.md if present or requested
  if (platforms.includes('agents') || platforms.includes('codex') ||
      platforms.includes('cursor') || platforms.includes('copilot') ||
      platforms.includes('gemini') || existsSync(join(CWD, 'AGENTS.md'))) {
    generateAgentsMd();
    console.log('  ✅ Regenerated AGENTS.md');
    updated = true;
  }

  if (!updated) {
    console.log('  ℹ️  No adapters found to update. Run `gsdd init` first.');
  } else {
    console.log('\n✅ Adapters updated to latest GSDD version.\n');
  }
}

function cmdFindPhase(...args) {
  const phaseNum = args[0];

  if (!existsSync(PLANNING_DIR)) {
    output({ error: 'No .planning/ directory found. Run init workflow first.' });
    return;
  }

  const roadmapPath = join(PLANNING_DIR, 'ROADMAP.md');
  if (!existsSync(roadmapPath)) {
    output({ error: 'No ROADMAP.md found. Run init workflow first.' });
    return;
  }

  const phasesDir = join(PLANNING_DIR, 'phases');
  const researchDir = join(PLANNING_DIR, 'research');

  if (phaseNum) {
    // Find specific phase
    const plans = findFiles(phasesDir, `${padPhase(phaseNum)}-PLAN`);
    const summaries = findFiles(phasesDir, `${padPhase(phaseNum)}-SUMMARY`);

    output({
      phase: parseInt(phaseNum),
      directory: phasesDir,
      plans,
      summaries,
      hasResearch: existsSync(researchDir) && readdirSync(researchDir).length > 0,
      incomplete: plans.filter(p => !summaries.some(s => s.replace('SUMMARY', '') === p.replace('PLAN', ''))),
    });
  } else {
    // List all phases
    const allFiles = existsSync(phasesDir) ? readdirSync(phasesDir) : [];
    const plans = allFiles.filter(f => f.includes('PLAN'));
    const summaries = allFiles.filter(f => f.includes('SUMMARY'));

    // Parse roadmap for phase statuses
    const roadmap = readFileSync(roadmapPath, 'utf-8');
    const phases = parsePhaseStatuses(roadmap);

    output({
      phases,
      planCount: plans.length,
      summaryCount: summaries.length,
      currentPhase: phases.find(p => p.status === '🔄') || phases.find(p => p.status === '⬜') || null,
      hasResearch: existsSync(researchDir) && readdirSync(researchDir).length > 0,
    });
  }
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

  // Extract files from <files> sections
  const fileMatches = plan.matchAll(/<files>([\s\S]*?)<\/files>/g);
  const expectedFiles = [];
  for (const match of fileMatches) {
    const lines = match[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    for (const line of lines) {
      const fileMatch = line.match(/(?:CREATE|MODIFY):\s*(.+)/);
      if (fileMatch) expectedFiles.push(fileMatch[1].trim());
    }
  }

  // Check existence
  const results = expectedFiles.map(f => {
    const fullPath = join(CWD, f);
    const exists = existsSync(fullPath);
    let substantive = false;
    if (exists) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        substantive = content.trim().length > 50 && !content.includes('// TODO: implement');
      } catch { substantive = false; }
    }
    return { file: f, exists, substantive };
  });

  // Anti-pattern scan on modified files
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
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
          antiPatterns.push({ file: r.file, line: i + 1, pattern: 'Empty catch', content: line.trim() });
        }
      });
    } catch { /* skip unreadable files */ }
  }

  output({
    phase: parseInt(phaseNum),
    artifacts: results,
    allExist: results.every(r => r.exists),
    allSubstantive: results.filter(r => r.exists).every(r => r.substantive),
    antiPatterns,
    antiPatternCount: antiPatterns.length,
  });
}

function cmdScaffold(...args) {
  const [type, ...rest] = args;

  if (type === 'phase') {
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
      console.log(`  ⚠️  ${basename(planFile)} already exists`);
      return;
    }

    const content = `# Phase ${phaseNum}: ${phaseName || '[Name]'} — Plan

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
    console.log(`  ✅ Created ${basename(planFile)}`);
  } else {
    console.error('Usage: gsdd scaffold phase <number> [name]');
    process.exit(1);
  }
}

function cmdHelp() {
  console.log(`
gsdd — GSD Distilled CLI
Spec-Driven Development for AI coding agents.

Usage: gsdd <command> [args]

Commands:
  init [--tools <platform>]   Set up SDD + generate agent adapters
  update [--tools <platform>] Regenerate adapters from latest templates
  find-phase [N]              Show phase info as JSON (for agent consumption)
  verify <N>                  Run artifact checks for phase N
  scaffold phase <N> [name]   Create a new phase plan file

Platforms (for --tools):
  claude    Generate Claude Code skills (.claude/skills/gsdd-*/)
  codex     Generate AGENTS.md (Codex CLI)
  cursor    Generate AGENTS.md (Cursor reads it natively)
  copilot   Generate AGENTS.md (GitHub Copilot reads it natively)
  gemini    Generate AGENTS.md (Gemini CLI + contextFileName setting)
  all       Generate all adapters

Examples:
  npx gsdd init              # Auto-detect platform, generate adapters
  npx gsdd init --tools claude  # Generate Claude Code skills + AGENTS.md
  npx gsdd init --tools all  # Generate ALL adapters
  npx gsdd find-phase        # Show all phases + current state
  npx gsdd find-phase 2      # Show details for phase 2
  npx gsdd verify 1          # Verify phase 1 artifacts
  npx gsdd scaffold phase 4 Payments  # Create phase 4 plan file
`);
}

// ─── Utilities ────────────────────────────────────────────────────

function detectPlatforms() {
  const platforms = [];
  if (existsSync(join(CWD, 'CLAUDE.md')) || existsSync(join(CWD, '.claude'))) {
    platforms.push('claude');
  }
  // Gemini, Cursor, Copilot, Codex all use AGENTS.md
  if (existsSync(join(CWD, 'GEMINI.md')) || existsSync(join(CWD, '.gemini'))) {
    platforms.push('agents');
  }
  if (existsSync(join(CWD, '.cursor'))) {
    platforms.push('agents');
  }
  if (existsSync(join(CWD, '.github', 'copilot'))) {
    platforms.push('agents');
  }
  if (existsSync(join(CWD, 'AGENTS.md'))) {
    platforms.push('agents');
  }
  // Deduplicate
  return [...new Set(platforms)];
}

function parseToolsFlag(flagArgs) {
  const idx = flagArgs.indexOf('--tools');
  if (idx === -1) return [];
  const value = flagArgs[idx + 1];
  if (!value) return [];
  if (value === 'all') return ['claude', 'agents'];
  return [value];
}

function generateClaudeSkills() {
  const workflows = [
    { name: 'gsdd-init', workflow: 'init.md', description: 'Initialize GSDD — research, spec creation, roadmap', agent: 'Plan' },
    { name: 'gsdd-plan', workflow: 'plan.md', description: 'Plan a phase — research check, backward planning, task creation', agent: 'Plan' },
    { name: 'gsdd-execute', workflow: 'execute.md', description: 'Execute a phase plan — implement tasks, commit atomically, verify', agent: 'Code' },
    { name: 'gsdd-verify', workflow: 'verify.md', description: 'Verify a completed phase — 3-level checks, anti-pattern scan', agent: 'Plan' },
  ];

  for (const w of workflows) {
    const skillDir = join(CWD, '.claude', 'skills', w.name);
    mkdirSync(skillDir, { recursive: true });

    const workflowContent = getWorkflowContent(w.workflow);
    const skillContent = `---
name: ${w.name}
description: ${w.description}
context: fork
agent: ${w.agent}
---

${workflowContent}`;

    writeFileSync(join(skillDir, 'SKILL.md'), skillContent);
  }
}

function generateAgentsMd() {
  const agentsPath = join(CWD, 'AGENTS.md');
  const content = getAgentsMdContent();
  writeFileSync(agentsPath, content);
}

function getWorkflowContent(workflowFile) {
  const filePath = join(DISTILLED_DIR, 'workflows', workflowFile);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  return `<!-- Workflow file not found: ${workflowFile} -->\n`;
}

function getAgentsMdContent() {
  // Read from the framework's own AGENTS.md as template
  const templatePath = join(DISTILLED_DIR, 'templates', 'agents.md');
  if (existsSync(templatePath)) {
    return readFileSync(templatePath, 'utf-8');
  }
  // Fallback: inline governance content
  return `# AGENTS.md — GSDD Governance

> This file was generated by \`gsdd init\`. It provides GSDD governance rules
> for any AI coding agent that supports the AGENTS.md standard
> (Linux Foundation — 20+ tools: Codex, Cursor, Gemini CLI, Copilot, and more).

## What This Project Uses

- **Framework:** GSDD (Spec-Driven Development)
- **Planning dir:** \`.planning/\` — all specs, roadmaps, plans, and phase work
- **Lifecycle:** \`init → [plan → execute → verify] × N\`

## Rules You MUST Follow

### 1. Never Skip the Workflow
Every change follows the lifecycle: plan → execute → verify. No exceptions.

### 2. Read Before You Write
Before making ANY change, read: SPEC.md → ROADMAP.md → current PLAN.md.

### 3. Stay In Scope — Zero Deviation
Implement ONLY what the current task specifies.

### 4. Atomic Commits
Every task gets its own commit. Never batch unrelated changes.

### 5. Verify Your Own Work
3-level check: Exists → Substantive → Wired.

### 6. Research Before Unfamiliar Domains
Stop, research, verify, then plan. Don't assume training data is current.

### 7. Context Budget
No file > 410 lines. SPEC.md < 300 lines.

### 8. Never Hallucinate File Paths or APIs
Use ONLY paths and APIs you've confirmed exist.

### 9. Verify Against Baseline Before Declaring Done
Audit section-by-section against original scope. Missing capability is a bug.

## Code Style

- Atomic, verifiable tasks (15-60 min scope each)
- Success criteria defined BEFORE work begins
`;
}

function findFiles(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.startsWith(prefix) || f.startsWith(prefix.replace(/^0+/, '')));
}

function padPhase(n) {
  return String(n).padStart(2, '0');
}

function parsePhaseStatuses(roadmap) {
  const phases = [];
  const lines = roadmap.split('\n');
  for (const line of lines) {
    const match = line.match(/^[-*]\s*(⬜|🔄|✅|\[[ x]\])\s*\*\*Phase\s+(\d+):\s*(.+?)\*\*/);
    if (match) {
      const rawStatus = match[1];
      let status;
      if (rawStatus === '⬜' || rawStatus === '[ ]') status = '⬜';
      else if (rawStatus === '🔄') status = '🔄';
      else if (rawStatus === '✅' || rawStatus === '[x]') status = '✅';
      else status = rawStatus;

      phases.push({
        number: parseInt(match[2]),
        name: match[3].replace(/\*\*/g, '').split('—')[0].trim(),
        status,
      });
    }
  }
  return phases;
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}
