const RUNTIME_OPTIONS = [
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Directly validated native skills, commands, and agents with local freshness checks',
    kind: 'native',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'Directly validated native slash commands and agents with local freshness checks',
    kind: 'native',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    description: 'Directly validated portable skills plus native checker agents with local freshness checks',
    kind: 'native',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'Qualified support via skills-native slash commands from .agents/skills/ with the same local freshness checks',
    kind: 'skills_native',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    description: 'Qualified support via skills-native slash commands from .agents/skills/ with the same local freshness checks',
    kind: 'skills_native',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    description: 'Qualified support via skills-native slash commands from .agents/skills/ with the same local freshness checks',
    kind: 'skills_native',
  },
];

export const INIT_VERSION = 'v1.1';

export function normalizeRequestedTools(requestedTools) {
  const selectedRuntimes = [];
  const adapterTargets = [];
  const addRuntime = (runtime) => {
    if (!selectedRuntimes.includes(runtime)) selectedRuntimes.push(runtime);
  };
  const addAdapter = (adapter) => {
    if (!adapterTargets.includes(adapter)) adapterTargets.push(adapter);
  };

  for (const tool of requestedTools) {
    if (tool === 'claude' || tool === 'opencode' || tool === 'codex') {
      addRuntime(tool);
      addAdapter(tool);
      continue;
    }
    if (tool === 'cursor' || tool === 'copilot' || tool === 'gemini') {
      addRuntime(tool);
      addAdapter(tool);
      continue;
    }
    if (tool === 'agents') {
      addAdapter('agents');
    }
  }

  return { selectedRuntimes, adapterTargets };
}

export function detectPlatforms(adapters) {
  return Object.values(adapters)
    .filter((adapter, index, arr) => arr.findIndex((other) => other.id === adapter.id) === index)
    .filter((adapter) => adapter.detect())
    .map((adapter) => adapter.name);
}

export function buildRuntimeChoices(adapters) {
  const detected = new Set(detectPlatforms(adapters));
  return RUNTIME_OPTIONS.map((option) => ({
    ...option,
    detected: detected.has(option.id),
    selected: detected.has(option.id),
  }));
}

export function resolveAdapters(adapters, platformNames) {
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

export function getAdaptersToUpdate(adapters, platformNames) {
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

export async function resolveInteractiveInitSession({ ctx, promptApi, parsedTools, isAuto }) {
  if (parsedTools.length > 0) {
    return {
      ...normalizeRequestedTools(parsedTools),
      config: null,
    };
  }

  if (isAuto) {
    return { selectedRuntimes: [], adapterTargets: [], config: null };
  }

  if (!process.stdin.isTTY) {
    return {
      selectedRuntimes: detectPlatforms(ctx.adapters),
      adapterTargets: detectPlatforms(ctx.adapters),
      config: null,
    };
  }

  return promptApi.runInitWizard({ cwd: ctx.cwd, adapters: ctx.adapters });
}

export function resolveWizardAdapterTargets(selectedRuntimes, installGovernance) {
  const adapterTargets = [];
  for (const runtime of selectedRuntimes) {
    if (runtime === 'claude' || runtime === 'opencode' || runtime === 'codex') {
      adapterTargets.push(runtime);
    }
  }
  if (installGovernance) adapterTargets.push('agents');
  return adapterTargets;
}

export function getPostInitRoutingLines(selectedRuntimes) {
  const lines = [];
  if (selectedRuntimes.includes('claude')) lines.push('  Claude Code:  /gsdd-new-project');
  if (selectedRuntimes.includes('opencode')) lines.push('  OpenCode:     /gsdd-new-project');
  if (selectedRuntimes.includes('codex')) lines.push('  Codex CLI:    $gsdd-new-project');
  if (selectedRuntimes.includes('cursor')) lines.push('  Cursor:       /gsdd-new-project');
  if (selectedRuntimes.includes('copilot')) lines.push('  Copilot:      /gsdd-new-project');
  if (selectedRuntimes.includes('gemini')) lines.push('  Gemini CLI:   /gsdd-new-project');
  lines.push('  Any tool:     open .agents/skills/gsdd-new-project/SKILL.md');
  return lines;
}

export function getHelpText() {
  return `
gsdd - Workspine CLI
Portable multi-runtime software delivery framework for AI coding agents.

Usage: gsdd <command> [args]

Commands:
  init [--tools <platform>] [--auto] [--brief <file>]
                              Launch guided install wizard in TTYs, or use --tools for manual/headless setup
                              --auto: non-interactive mode with smart defaults (requires --tools)
                              --brief <file>: copy project brief to .planning/PROJECT_BRIEF.md
  update [--tools <platform>] [--templates] [--dry]
                              Regenerate adapters from latest framework sources
                              --templates: also refresh .planning/templates/ and roles
                              --dry: preview changes without writing files
  health [--json]             Check workspace integrity (healthy/degraded/broken)
  models [subcommand]         Inspect or update model profile / runtime overrides
  find-phase [N]              Show phase info as JSON (for agent consumption)
  verify <N>                  Run artifact checks for phase N
  scaffold phase <N> [name]   Create a new phase plan file

Platforms (for --tools):
  claude    Generate Claude Code skills (.claude/skills/gsdd-*), commands (.claude/commands/gsdd-*.md), and native agents (.claude/agents/gsdd-*.md)
  opencode  Generate OpenCode local slash commands (.opencode/commands/gsdd-*.md) + native agents (.opencode/agents/gsdd-*.md)
  codex     Generate Codex CLI native plan-checker agent (.codex/agents/gsdd-plan-checker.toml)
  agents    Generate/Update root AGENTS.md (bounded GSDD block)
  cursor    Generate root AGENTS.md governance block; workflows are already discovered natively from .agents/skills/ (legacy alias kept for backward compatibility)
  copilot   Generate root AGENTS.md governance block; workflows are already discovered natively from .agents/skills/ (legacy alias kept for backward compatibility)
  gemini    Generate root AGENTS.md governance block; workflows are already discovered natively from .agents/skills/ (legacy alias kept for backward compatibility)
  all       Generate all adapters (Claude, OpenCode, Codex, AGENTS.md, Cursor, Copilot, Gemini)

Notes:
  - init always generates open-standard skills at .agents/skills/gsdd-* (portable workflow entrypoints)
  - Workspine is the public product name; the retained package, command, workflow, and workspace contracts stay gsdd-cli, gsdd, gsdd-*, and .planning/
  - running plain \`gsdd init\` in a terminal opens the guided runtime-selection wizard
  - the wizard lets you pick runtimes first, then separately decide whether repo-wide AGENTS.md governance is worth installing
  - \`gsdd health\` compares any installed generated runtime surfaces against current render output and points back to \`gsdd update\` when they drift
  - directly validated launch surfaces in this repo are Claude Code, OpenCode, and Codex CLI
  - Cursor, Copilot, and Gemini are qualified support through the shared .agents/skills/ surface plus optional governance
  - --tools remains the advanced/manual path and preserves legacy runtime aliases for backward compatibility
  - --tools codex generates .codex/agents/gsdd-plan-checker.toml (portable skill is the entry surface; $gsdd-plan is plan-only until explicit $gsdd-execute)
  - root AGENTS.md is only written on init when explicitly requested via --tools agents, --tools all, or the wizard governance opt-in

Examples:
  npx gsdd-cli init
  npx gsdd-cli init --tools claude
  npx gsdd-cli init --tools cursor
  npx gsdd-cli init --auto --tools claude --brief project-idea.md
  npx gsdd-cli init --auto --tools all
  npx gsdd-cli models show
  npx gsdd-cli models profile quality
  npx gsdd-cli models agent-profile --agent plan-checker --profile quality
  npx gsdd-cli models set --runtime opencode --agent plan-checker --model anthropic/claude-opus-4-6
  npx gsdd-cli models clear --runtime opencode --agent plan-checker
  npx gsdd-cli init --tools agents
  npx gsdd-cli init --tools all
  npx gsdd-cli update
  npx gsdd-cli find-phase
  npx gsdd-cli verify 1
  npx gsdd-cli scaffold phase 4 Payments

Workflows (run via skills/adapters generated by init, not direct CLI):
  map-codebase      Map or refresh codebase (.agents/skills/gsdd-map-codebase/)
  audit-milestone   Audit a completed milestone (.agents/skills/gsdd-audit-milestone/)
`;
}
