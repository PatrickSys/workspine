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

export function detectPlatforms(adapters = {}) {
  return Object.values(adapters)
    .filter((adapter, index, arr) => arr.findIndex((other) => other.id === adapter.id) === index)
    .filter((adapter) => adapter.detect())
    .map((adapter) => adapter.name);
}

export function buildRuntimeChoices(adapters = {}) {
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
    const detected = detectPlatforms(ctx.adapters);
    return {
      selectedRuntimes: detected,
      adapterTargets: detected,
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
  if (selectedRuntimes.includes('claude')) lines.push('  Claude Code:  /gsdd-new-project  |  /gsdd-quick  |  /gsdd-map-codebase');
  if (selectedRuntimes.includes('opencode')) lines.push('  OpenCode:     /gsdd-new-project  |  /gsdd-quick  |  /gsdd-map-codebase');
  if (selectedRuntimes.includes('codex')) lines.push('  Codex CLI:    $gsdd-new-project  |  $gsdd-quick  |  $gsdd-map-codebase');
  if (selectedRuntimes.includes('cursor')) lines.push('  Cursor:       /gsdd-new-project  |  /gsdd-quick  |  /gsdd-map-codebase');
  if (selectedRuntimes.includes('copilot')) lines.push('  Copilot:      /gsdd-new-project  |  /gsdd-quick  |  /gsdd-map-codebase');
  if (selectedRuntimes.includes('gemini')) lines.push('  Gemini CLI:   /gsdd-new-project  |  /gsdd-quick  |  /gsdd-map-codebase');
  lines.push('  Any tool:     open .agents/skills/gsdd-new-project/SKILL.md, gsdd-quick/SKILL.md, or gsdd-map-codebase/SKILL.md');
  return lines;
}

export function getHelpText() {
  return `
gsdd - Workspine CLI
Repo-native delivery spine for long-horizon AI-assisted work across coding runtimes.

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
  file-op <copy|delete|regex-sub>
                              Run deterministic workspace-confined file copy/delete/text mutation
  phase-status <N> <status>   Update ROADMAP.md phase status ([ ] / [-] / [x])
  lifecycle-preflight <surface> [phase]
                              Inspect deterministic lifecycle gate results for a workflow surface
  session-fingerprint write [--allow-changed <ROADMAP.md,SPEC.md,config.json>]
                              Rebaseline planning-state drift after reviewing changed planning files
  ui-proof validate <path> [--claim <public|publication|tracked|delivery|release>]
                              Validate UI proof metadata; use --claim for stronger proof uses
  ui-proof compare <planned-slots-json> [observed-bundle-json ...]
                              Compare planned UI proof slots against observed bundles
  help                        Show this summary

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
  - init always generates open-standard skills at .agents/skills/gsdd-*; this is the shared workflow entry surface
  - init also generates a local .planning/bin/gsdd* helper surface for workflow-embedded lifecycle helpers; it is internal/advanced, not the normal first-run user entrypoint
  - Workspine is the public product name; the retained package, command, workflow, and workspace contracts stay gsdd-cli, gsdd, gsdd-*, and .planning/
  - running \`npx -y gsdd-cli init\` in a terminal opens the guided runtime-selection wizard; bare \`gsdd init\` is equivalent only when globally installed
  - the wizard lets you pick runtimes first, then separately decide whether repo-wide AGENTS.md governance is worth installing
  - \`npx -y gsdd-cli health\` compares any installed generated runtime surfaces against current render output and points back to \`npx -y gsdd-cli update\` when they drift
  - directly validated launch surfaces in this repo are Claude Code, OpenCode, and Codex CLI
  - Cursor, Copilot, and Gemini are qualified support through the shared .agents/skills/ surface plus optional governance
  - --tools remains the advanced/manual path and preserves legacy runtime aliases for backward compatibility
  - --tools codex generates .codex/agents/gsdd-plan-checker.toml (portable skill is the entry surface; $gsdd-plan is plan-only until explicit $gsdd-execute)
  - root AGENTS.md is only written on init when explicitly requested via --tools agents, --tools all, or the wizard governance opt-in
  - normal user path: npx -y gsdd-cli init -> run /gsdd-* or $gsdd-* -> npx -y gsdd-cli health -> npx -y gsdd-cli update when repair or refresh is needed
  - post-init, choose your starting lane honestly: new-project for greenfield or fuzzy/milestone work, quick for a concrete bounded change, map-codebase first when the repo needs deeper orientation

Examples:
  npx -y gsdd-cli init
  npx -y gsdd-cli init --tools claude
  npx -y gsdd-cli init --tools cursor
  npx -y gsdd-cli init --auto --tools claude --brief project-idea.md
  npx -y gsdd-cli init --auto --tools all
  npx -y gsdd-cli models show
  npx -y gsdd-cli models profile quality
  npx -y gsdd-cli models agent-profile --agent plan-checker --profile quality
  npx -y gsdd-cli models set --runtime opencode --agent plan-checker --model anthropic/claude-opus-4-6
  npx -y gsdd-cli models clear --runtime opencode --agent plan-checker
  npx -y gsdd-cli init --tools agents
  npx -y gsdd-cli init --tools all
  npx -y gsdd-cli update
  npx -y gsdd-cli find-phase
  npx -y gsdd-cli verify 1
  npx -y gsdd-cli scaffold phase 4 Payments

Workflows (run via skills/adapters generated by init, not direct CLI):
  gsdd-new-project          Full initializer: questioning, brownfield audit, research, spec, roadmap
  gsdd-map-codebase         Map or refresh brownfield codebase context before choosing or refreshing a work lane
  gsdd-plan                 Research, plan, and fresh-context plan check for a phase
  gsdd-execute              Execute a phase plan and write phase summaries
  gsdd-verify               Verify a completed phase with 3-level checks
  gsdd-verify-work          Conversational UAT validation for user-facing behavior
  gsdd-audit-milestone      Cross-phase integration, requirements coverage, and E2E audit
  gsdd-complete-milestone   Archive a shipped milestone and collapse roadmap state
  gsdd-new-milestone        Start the next milestone with goals, requirements, and phases
  gsdd-plan-milestone-gaps  Turn milestone-audit gaps into closure phases
  gsdd-quick                Bounded brownfield lane for sub-hour work
  gsdd-pause                Save session context to checkpoint
  gsdd-resume               Restore context and route to the next action
  gsdd-progress             Read-only status and routing surface

Starting lanes after init:
  gsdd-new-project          Greenfield, fuzzy brownfield scope, or milestone-shaped work
  gsdd-quick                Concrete bounded brownfield change
  gsdd-map-codebase         Deeper brownfield orientation before choosing the lane above

Advanced/internal helpers (kept available, but not the primary first-run user story):
  lifecycle-preflight       Inspect deterministic lifecycle gate results for a workflow surface
  session-fingerprint       Rebaseline the local planning-state fingerprint after review
  phase-status              Update ROADMAP.md phase status through the local helper surface
  ui-proof                  Validate UI proof metadata and compare planned slots to observed bundles
  file-op                   Deterministic workspace-confined file copy/delete/text mutation
`;
}
