import { WORKFLOWS, workflowId } from './workflows.mjs';

const RUNTIME_OPTIONS = [
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Generated native skills, commands, and agents with local freshness checks',
    kind: 'native',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'Generated native slash commands and agents with local freshness checks',
    kind: 'native',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    description: 'Recorded proof for portable skills plus native checker agents with local freshness checks',
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

export const GLOBAL_AGENT_OPTIONS = [
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Install global skills, slash-command alias, and native Workspine agents under ~/.claude.',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'Install shared global skills under ~/.agents plus slash commands and native Workspine agents under ~/.config/opencode.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    description: 'Install shared global skills under ~/.agents and native Workspine agents under ~/.codex.',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    description: 'Install shared global skills under ~/.agents and Copilot agent profiles under ~/.copilot.',
  },
];

function renderGlobalInstallTargetHelp() {
  const width = Math.max(...GLOBAL_AGENT_OPTIONS.map(({ id }) => id.length));
  return [
    ...GLOBAL_AGENT_OPTIONS.map(({ id, description }) => `  ${id.padEnd(width)}  ${description}`),
    `  ${'all'.padEnd(width)}  Install all global targets above`,
  ].join('\n');
}

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

// The help screen and the post-init routing lines both restate shipped workflow
// ids. They read them out of the manifest in bin/lib/workflows.mjs so a workflow
// added, removed or renamed there cannot leave a stale hand-written copy behind.
// Keep the first decision small: a bounded change, a planned standalone change,
// or a project to start/extend. Mapping is recommended only by the contextual
// brownfield guidance, and milestone creation is history-gated in its workflow.
const STARTING_LANE_SLUGS = Object.freeze(['quick', 'plan', 'new-project']);

const HELP_WORKFLOW_SUMMARIES = Object.freeze({
  'new-project': 'Full initializer: questioning, brownfield audit, research, spec, roadmap',
  'map-codebase': 'Map or refresh brownfield codebase context before choosing or refreshing a work lane',
  plan: 'Research, plan, and fresh-context plan check for a phase',
  execute: 'Execute a phase plan and write phase summaries',
  verify: 'Verify a completed phase with 3-level checks',
  'verify-work': 'Conversational UAT validation for user-facing behavior',
  'audit-milestone': 'Cross-phase integration, requirements coverage, and E2E audit',
  'complete-milestone': 'Archive a shipped milestone and collapse roadmap state',
  'new-milestone': 'Start the next milestone with goals, requirements, and phases',
  quick: 'Bounded brownfield lane for sub-hour work',
  pause: 'Save session context to checkpoint',
  resume: 'Restore context and route to the next action',
  progress: 'Read-only status and routing surface',
});

const STARTING_LANE_SUMMARIES = Object.freeze({
  quick: 'Concrete bounded brownfield change',
  plan: 'Standalone change that needs a plan, execution, and verification',
  'new-project': 'Start or extend a broader project or milestone',
});

const WORKFLOW_HELP_WIDTH = Math.max(...WORKFLOWS.map(({ name }) => name.length));

function workflowSlug({ workflow }) {
  return workflow.replace(/\.md$/, '');
}

function renderWorkflowHelpRow(id, summary) {
  return `  ${id.padEnd(WORKFLOW_HELP_WIDTH)}   ${summary}`;
}

function renderWorkflowHelp() {
  return WORKFLOWS.map((workflow) => {
    const summary = HELP_WORKFLOW_SUMMARIES[workflowSlug(workflow)];
    if (!summary) {
      throw new Error(`init help text is missing a summary for workflow '${workflow.name}'`);
    }
    return renderWorkflowHelpRow(workflow.name, summary);
  }).join('\n');
}

function renderStartingLaneHelp() {
  return STARTING_LANE_SLUGS
    .map((slug) => renderWorkflowHelpRow(workflowId(slug), STARTING_LANE_SUMMARIES[slug]))
    .join('\n');
}

function renderStartingLaneCommands(prefix) {
  return STARTING_LANE_SLUGS.map((slug) => `${prefix}${workflowId(slug)}`).join('  |  ');
}

export function getPostInitRoutingLines(selectedRuntimes) {
  const lines = [];
  const slashLanes = renderStartingLaneCommands('/');
  if (selectedRuntimes.includes('claude')) lines.push(`  Claude Code:  ${slashLanes}`);
  if (selectedRuntimes.includes('opencode')) lines.push(`  OpenCode:     ${slashLanes}`);
  if (selectedRuntimes.includes('codex')) lines.push(`  Codex CLI:    ${renderStartingLaneCommands('$')}`);
  if (selectedRuntimes.includes('cursor')) lines.push(`  Cursor:       ${slashLanes}`);
  if (selectedRuntimes.includes('copilot')) lines.push(`  Copilot:      ${slashLanes}`);
  if (selectedRuntimes.includes('gemini')) lines.push(`  Gemini CLI:   ${slashLanes}`);
  const lanePaths = STARTING_LANE_SLUGS.map((slug) => `.agents/skills/${workflowId(slug)}/SKILL.md`);
  lines.push(`  Any tool:     open ${lanePaths.slice(0, -1).join(', ')}, or ${lanePaths[lanePaths.length - 1]}`);
  return lines;
}

// A15-44: accepted flags per mutating command, so an unknown, duplicated, or value-less flag is
// rejected before any handler can write. `true` means the flag consumes the next token.
// Commands absent here already validate their own arguments and are deliberately untouched.
// `install` lists --local/--verify-runtime/--live-runtime because it recognises them only to
// reject them with a specific message; that message must still be the one a user sees.
export const COMMAND_FLAGS = {
  init: { '--tools': true, '--brief': true, '--auto': false, '--migrate': false, '--workspace-root': true },
  update: { '--tools': true, '--templates': false, '--dry': false, '--workspace-root': true },
  install: { '--global': false, '-g': false, '--auto': false, '--dry': false, '--tools': true, '--local': false, '--verify-runtime': false, '--live-runtime': false },
  scaffold: { '--workspace-root': true },
  'file-op': { '--missing': true, '--flags': true, '--workspace-root': true },
  'lifecycle-transition': { '--plan': true, '--artifact': true, '--authority': true, '--approval-ref': true, '--reason': true, '--question': true, '--approved': true, '--json': false, '--workspace-root': true },
};

// Bare words count only in the command position, so a positional argument that happens to read
// `help` or `version` is never mistaken for a request for information.
const HELP_TOKENS = new Set(['--help', '-h', 'help']);
const VERSION_TOKENS = new Set(['--version', '-v', '-V', 'version']);
const HELP_FLAGS = new Set(['--help', '-h']);
const VERSION_FLAGS = new Set(['--version', '-v', '-V']);

// These render their own richer usage for --help, so the root help must not override them.
const COMMANDS_WITH_OWN_HELP = new Set(['next', 'lifecycle-transition']);

// Classifies a dispatch as a zero-write information request so the entrypoint can answer it before
// any handler writes or the update-awareness check runs. Returns 'help', 'version', or null.
// Arguments are inspected only for a known command, so an unknown command still fails as one.
export function classifyInformationRequest(command, commandArgs = [], knownCommands = {}) {
  if (command && VERSION_TOKENS.has(command)) return 'version';
  if (command && HELP_TOKENS.has(command)) return 'help';
  if (!command || !Object.hasOwn(knownCommands, command)) return null;
  if (commandArgs.some((arg) => VERSION_FLAGS.has(arg))) return 'version';
  if (!COMMANDS_WITH_OWN_HELP.has(command) && commandArgs.some((arg) => HELP_FLAGS.has(arg))) return 'help';
  return null;
}

// Flags every command accepts because something other than the command's own parser consumes them:
// the dispatcher answers --help/--version before any handler runs, or renders the command's own
// usage, and the update-awareness layer strips --no-update-notice. Gating any of these would make
// `--help` unreachable and would break the documented opt-out on every mutating command.
const UNIVERSAL_FLAGS = new Set(['--help', '-h', '--version', '-v', '-V', '--no-update-notice']);

// Returns an error string for the first unknown or duplicated flag, or null when the flags are
// acceptable. Positional arguments are ignored: only tokens that look like flags are inspected.
//
// A flag present but missing its value is deliberately NOT reported here. `--tools`, `--brief` and
// `--workspace-root` already answer that case with a specific, more useful message, and duplicating
// the check would replace those messages with a generic one. Value presence stays each command's
// own responsibility; this function only answers "is this flag mine, and did I already see it".
export function findInvalidFlag(command, commandArgs = []) {
  const accepted = COMMAND_FLAGS[command];
  if (!accepted) return null;
  const seen = new Set();
  for (let index = 0; index < commandArgs.length; index += 1) {
    const token = commandArgs[index];
    if (typeof token !== 'string' || !token.startsWith('-') || token === '-') continue;
    if (UNIVERSAL_FLAGS.has(token)) continue;
    if (!Object.hasOwn(accepted, token)) return `Unknown flag for \`${command}\`: ${token}`;
    if (seen.has(token)) return `Duplicate flag for \`${command}\`: ${token}`;
    seen.add(token);
    if (!accepted[token]) continue;
    const value = commandArgs[index + 1];
    // A value-taking flag whose value is absent or is itself a flag makes everything after it
    // ambiguous: the next token could be a duplicate flag, or the value the user meant to pass.
    // Stop rather than guess, and let the command's own specific message answer it.
    if (value === undefined || value.startsWith('-')) return null;
    index += 1;
  }
  return null;
}

export function getHelpText() {
  return `
workspine - Workspine CLI
Plan, execute, and verify AI-assisted work from files in your repo — with proof before "done".

Usage: workspine <command> [args]
Compatibility: gsdd <command> [args] remains a supported alias for existing installs.

  --help, -h                  Show this help and exit without writing anything
  --version, -v               Print the installed package version and exit without writing anything

Commands:
  init [--tools <platform>] [--auto] [--brief <file>] [--migrate]
                              Launch guided install wizard in TTYs, or use --tools for manual/headless setup
                               --auto: non-interactive new-project bootstrap config (requires --tools)
                              --brief <file>: copy project brief to .work/PROJECT_BRIEF.md
                              --migrate: explicitly move a supported legacy state tree to .work/ before setup
  install --global [--auto] [--tools <platform>] [--dry]
                              Install reusable Workspine skills and native runtime surfaces into agent home directories
                              --auto: refresh detected existing agent homes; if none exist, print exact target commands without writing
                              In TTYs, omitting --tools opens an agent picker
  update [--tools <platform>] [--templates] [--dry]
                              Regenerate adapters from latest framework sources
                              --templates: also refresh .work/templates/ and roles
                              --dry: preview changes without writing files
  health [--json]             Check workspace integrity (healthy/degraded/broken)
                              health and update remain network-free; update is explicit repair only
  next [--json] [--format auto|json|human] [--init]
                              Read explicit file-backed \`.work\` continuity and emit the next coherent agent action
Advanced/internal commands (available when you need them):
  journey [--json]            Show the milestone and phase delivery journey # (experimental)
  remember "<text>" --type <t> --scope <s> [--for <ref>]
                              Capture a candidate decision, rule, or lesson for later verification
  decisions query "<terms>" [--path <path>]
                              Recall matching decision records as a compact digest
  decisions promote <id> --authority owner --approval-ref <non-sensitive-ref>
                              Promote or re-attest one decision through the auditable cooperative owner protocol
  decisions reject <id> [--reason <text>]
                              Reject a candidate decision without deleting its record
  decisions invalidate <id> --reason <text>
                              Invalidate an active decision without deleting its record
  models [subcommand]         Inspect or update model profile / runtime overrides
  rigor [show|low|medium|high|max|<plan|execute|verify> <level>]
                              Inspect or update rigor alignment and quality gates; max uses high gates
  find-phase [N]              Show phase info as JSON (for agent consumption)
  verify <N>                  Run artifact checks for phase N
  scaffold phase <N> [name]   Create a new phase plan file
  file-op <copy|delete|regex-sub>
                              Run deterministic workspace-confined file copy/delete/text mutation
  phase-status <N> <status>   Update ROADMAP.md phase status ([ ] / [-] / [x])
  lifecycle-preflight <surface> [phase]
                              Inspect deterministic lifecycle gate results for a workflow surface
  git-identity check [--expect <fingerprint>] [--confirm <fingerprint>]
                              Inspect the current worktree Git identity read-only before an owned commit
  help                        Show this summary

Platforms (for --tools):
  claude    Generate Claude Code skills (.claude/skills/work-*), the plan command (.claude/commands/work-plan.md), and native agents (.claude/agents/work-*.md)
  opencode  Generate OpenCode local slash commands (.opencode/commands/work-*.md) + native agents (.opencode/agents/work-*.md)
  codex     Generate Codex CLI native agents (.codex/agents/work-plan-checker.toml and .codex/agents/work-approach-explorer.toml)
  agents    Generate/Update root AGENTS.md (bounded GSDD block)
  cursor    Generate root AGENTS.md governance block; workflows are already discovered natively from .agents/skills/ (legacy alias kept for backward compatibility)
  copilot   Generate root AGENTS.md governance block; workflows are already discovered natively from .agents/skills/ (legacy alias kept for backward compatibility)
  gemini    Generate root AGENTS.md governance block; workflows are already discovered natively from .agents/skills/ (legacy alias kept for backward compatibility)
  all       Generate all adapters (Claude, OpenCode, Codex, AGENTS.md, Cursor, Copilot, Gemini)

Global install targets:
${renderGlobalInstallTargetHelp()}

Notes:
  - use \`npx -y workspine init\` for repo-local setup; for a fresh global install choose targets interactively or pass \`--tools <targets>\`
  - init always generates open-standard skills at .agents/skills/work-*; this is the shared workflow entry surface
  - init also generates a local .work/bin/gsdd* helper surface for workflow-embedded lifecycle helpers; it is internal/advanced, not the normal first-run user entrypoint
  - install --global never creates .work/ in the current repo; it writes only selected agent-home surfaces and per-runtime Workspine manifests
  - use \`npx -y workspine install --global --auto\` to refresh detected existing agent homes; in a fresh/headless home use \`--tools <targets>\`
  - repair or refresh a global install by rerunning \`npx -y workspine install --global --auto\` or \`npx -y workspine install --global --tools <targets>\`; runtime probes stay in test harnesses
  - Workspine is the public product name and the npm package; the retained command and workspace contracts stay gsdd and .work/, and the workflows are work-*; legacy planning workspaces are still read only for explicit migration
  - running \`npx -y workspine init\` in a terminal opens the guided runtime-selection wizard; bare \`gsdd init\` is equivalent only when globally installed
  - repo-local \`init --auto\` sets the legacy-named \`autoAdvance\` key only for brief-driven \`${workflowId('new-project')}\` SPEC/ROADMAP bootstrap; it never chains plan, execute, verify, release, or delivery
  - the wizard lets you pick runtimes first, then separately decide whether repo-wide AGENTS.md governance is worth installing
  - \`npx -y workspine health\` is for repo-local .work/ workspaces; it compares local generated surfaces and points back to \`npx -y workspine update\` when they drift
  - supported package runtime floor: Node >=22
  - update awareness is on by default for supported CLI/helper commands: a sequential/best-effort anonymous npm metadata check with a two-second timeout and a 64 KiB/normalized-version limit; there is no lock or cross-process concurrency guarantee
  - the notice uses only a contained .work/.local cache, sends no credentials or repository data, and cache/check failures never block commands
  - use \`--no-update-notice\`, \`WORKSPINE_UPDATE_AWARENESS=0\`, or the legacy \`GSDD_UPDATE_AWARENESS=0\` to opt out; only the supported public CLI/generated helper can show it
  - \`health\` and \`update\` remain network-free; run \`npx -y workspine update\` for explicit repair
  - \`npx -y workspine next --init\` bootstraps the local .work continuity surface; plain \`next\` is read-only and emits a typed packet, including any explicit pause checkpoint; it never runs a background compaction or context-transfer hook
  - \`gsdd next\` defaults to JSON when stdout is captured; use \`--format human\` for the compact supervisor card
  - recorded launch proof in this repo currently covers the Codex CLI path; Claude Code and OpenCode get generated native surfaces with local freshness checks and no recorded run
  - Cursor, Copilot, and Gemini are qualified support through the shared .agents/skills/ surface plus optional governance
  - --tools remains the advanced/manual path and preserves legacy runtime aliases for backward compatibility
  - --tools codex generates .codex/agents/work-plan-checker.toml and .codex/agents/work-approach-explorer.toml (portable skill is the entry surface; $work-plan is plan-only until explicit $work-execute)
  - root AGENTS.md is only written on init when explicitly requested via --tools agents, --tools all, or the wizard governance opt-in
  - normal repo path: npx -y workspine init -> run /work-* or $work-* -> npx -y workspine health -> npx -y workspine update when local repair or refresh is needed
  - post-init, choose one goal: quick for a bounded change, plan for a standalone change that needs plan -> execute -> verify, or new-project to start/extend a project; use map-codebase first only when a risky or unfamiliar brownfield repo needs deeper orientation

Examples:
  npx -y workspine init
  npx -y workspine init --tools claude
  npx -y workspine init --tools cursor
  npx -y workspine init --auto --tools claude --brief project-idea.md
  npx -y workspine init --auto --tools all
  npx -y workspine models show
  npx -y workspine models profile quality
  npx -y workspine models agent-profile --agent plan-checker --profile quality
  npx -y workspine models set --runtime opencode --agent plan-checker --model anthropic/claude-opus-4-6
  npx -y workspine models clear --runtime opencode --agent plan-checker
  npx -y workspine init --tools agents
  npx -y workspine init --tools all
  npx -y workspine install --global
  npx -y workspine install --global --auto
  npx -y workspine install --global --tools ${GLOBAL_AGENT_OPTIONS.map(({ id }) => id).join(',')}
  npx -y workspine update
  npx -y workspine next --json
  npx -y workspine next --format human
  npx -y workspine next --init
  npx -y workspine find-phase
  npx -y workspine verify 1
  npx -y workspine scaffold phase 4 Payments

Workflows (run via skills/adapters generated by init, not direct CLI):
${renderWorkflowHelp()}

Starting lanes after init:
${renderStartingLaneHelp()}

Contextual routing:
  map-codebase       Use first only for an unfamiliar, risky, or stale brownfield baseline
  new-milestone      Appears after a shipped milestone is recorded; use new-project for the first one

Advanced/internal helpers (kept available, but not the primary first-run user story):
  lifecycle-preflight       Inspect deterministic lifecycle gate results for a workflow surface
  phase-status              Update ROADMAP.md phase status through the local helper surface
  next                      Read-only \`.work\` continuity router for the next coherent agent action
  file-op                   Deterministic workspace-confined file copy/delete/text mutation
`;
}
