# Workspine User Guide

A detailed reference for Workspine workflows, troubleshooting, and configuration. Start with the [README](../README.md) for the shortest first-use path. The npm package and CLI are `workspine`; `gsdd` is retained as a compatibility alias. Workflows are named `work-*`, and their records live in `.work/`. Runtime floor: Node >=22. Human install/update commands use `npx -y workspine ...`; bare `gsdd ...` is shorthand only when the package is globally installed.

The tracked consumer evidence is indexed at [`docs/proof/consumer-node-cli/README.md`](proof/consumer-node-cli/README.md).

---

## Fast Path

Use a terminal for setup, then your coding agent's chat for the workflows.

1. **Set up the repo.** From its root, run `npx -y workspine setup` with Node `>=22`.
2. **Describe one change in chat.** Ask the agent to use `work-plan` and give it the outcome and constraints. For example: "Use work-plan to add a --json option to the existing report command. Preserve its current text output."
3. **Review and decide.** The agent should show or link the plan under `.work/`, with a short reference so approval identifies that plan. Check the intended behavior, scope, checks, and unresolved choices. Give explicit owner approval in chat: "I approve this plan", or request a revision. The agent records your approval and confirms it succeeded; you do not need to invent an identifier, inspect metadata, or edit records. A changed plan needs approval again.
4. **Implement.** Run `work-execute` in chat after the agent confirms approval was recorded. If recording fails, the agent must explain and resolve the blocker before execution. It follows the approved scope and records what changed and which checks ran. A material unresolved owner choice returns to you.
5. **Inspect the result.** Run `work-verify`, then review the code diff, actual check output, and the summary/verification report. Try the changed behavior yourself when relevant. A blocked or failed check is unfinished work: use `work-plan` to revise the plan or `work-quick` for a bounded correction, then verify again.
6. **Stop and resume.** Before ending a session mid-work, run `work-pause` and check that it saved the current decisions, unfinished work, and next action. In a fresh session in the same repo, run `work-resume`. Use `work-progress` when you only need status and the next action.

`work-*` names are agent workflows, not terminal binaries. Claude/OpenCode use `/work-plan`;
Codex uses `$work-plan`. Use the matching prefix for execute, verify, pause, and resume.
If your runtime does not discover the skills, ask the agent to read and follow
`.agents/skills/work-plan/SKILL.md` (and the matching file for the next workflow).
See [Runtime Support](RUNTIME-SUPPORT.md) for the tested surfaces and limitations.

`work-quick` combines planning and execution for an already-understood change, with its own
confirmation before execution. Use the separate plan/approve/execute loop above when you need
to review the full checked plan first. Use `work-new-project`
when the project or milestone itself needs shaping, and `work-new-milestone` after a milestone
is shipped. Use `work-map-codebase` only when the repo is unfamiliar, risky, or its map is stale.

Your native agent workflow may be enough for a self-contained task with clear decisions and checks.
Workspine adds a repo-owned plan, approval, verification, and continuation record when those need
to persist across sessions. It does not copy context automatically. A checkpoint helps the next
agent recover, but current code, plans, and Git state still need to be checked.

For installation trouble, start with `npx -y workspine health` and follow its diagnosis.
See [Common Problems](#common-problems) for repair and [Install Modes](#install-modes) for global
installation, runtime targets, headless flags, and legacy migration.

---

## Table of Contents

- [Fast Path](#fast-path)
- [Command Reference](#command-reference)
- [Configuration Reference](#configuration-reference)
- [Usage Examples](#usage-examples)
- [Common Problems](#common-problems)
- [Recovery Quick Reference](#recovery-quick-reference)
- [Project File Structure](#project-file-structure)
- [Workflow Diagrams](#workflow-diagrams) (agent coordination reference)

---

## Command Reference

This reference covers all 13 workflows.

### Install Modes

Compatibility: `npx -y workspine init` remains available for repo-local setup. For reusable global surfaces, run `npx -y workspine install --global` to choose targets interactively or pass `--tools <targets>` in a fresh/headless home. `--auto` selects detected existing homes for install/setup; for repair, run `npx -y workspine health --global` first and follow its safe update or manual-resolution guidance. Global install never creates `.work/` in the current repo.

Setup defaults to recommended portable files in the current repo. Use `setup --global` for personal agent homes, `--agent <target>` for one native target, `--all` for every detected target, or `--migrate` to approve a detected legacy-state move explicitly. `-y`/`--yes` accepts the bounded write without prompts; `--dry-run` previews it.

If setup detects a supported legacy `.planning/` state, it offers an optional move into `.work/` because that leaves one current authority and a receipt. The move preserves bytes; declining leaves the legacy state unchanged. Fresh workspaces never show this offer, and migration is never silent.

Use local repo install when the project should own `.work/`, `.agents/skills`, and optional repo-local runtime adapters:

```bash
npx -y workspine init
npx -y workspine init --auto --tools all
```

Use global agent install when you want Workspine workflows available across repos from your personal agent home:

```bash
npx -y workspine install --global
npx -y workspine install --global --auto
npx -y workspine install --global --tools claude,opencode,codex,copilot
```

For a fresh install, choose targets interactively or pass `--tools <targets>`. `--auto` selects detected existing agent homes for non-interactive install/setup; it is not the repair path. If none are detected, it writes nothing and prints one exact command per supported target. For an existing Workspine-owned home, inspect `npx -y workspine health --global` before attempting repair.

Global install writes Workspine-managed files under selected agent homes and records per-runtime manifests. It does not bootstrap project planning state. Each target writes to these directories:

| Target | Global surfaces |
|--------|-----------------|
| Claude Code | `~/.claude/skills`, `~/.claude/commands`, `~/.claude/agents` |
| OpenCode | `~/.agents/skills`, `~/.config/opencode/commands`, `~/.config/opencode/agents` |
| Codex CLI | `~/.agents/skills`, `~/.codex/agents` |
| GitHub Copilot CLI | `~/.agents/skills`, `~/.copilot/agents` |

Details worth knowing before you script it:

- Bare `npx -y workspine install --global` with no flags selects no targets in a non-interactive shell and exits with an error. Pass `--tools <targets>` or `--auto` in CI.
- Pruning runs per install root against that root's own manifest. Dropping a target from `--tools` therefore prunes nothing for it, and every target that shares `~/.agents` shares one manifest.
- OpenCode honors `OPENCODE_CONFIG_DIR` for its commands and agents. Portable skills are installed once in the shared agent-compatible global root.

### Workflows (run via generated skills or adapters)

| Workflow | Purpose | When to Use |
|----------|---------|-------------|
| `work-new-project` | Full project init: questioning, brownfield audit when needed, research, spec, roadmap | Greenfield, fuzzy brownfield scope, or full lifecycle setup |
| `work-map-codebase` | Map existing codebase for reusable brownfield context | When the repo is unfamiliar, risky, or you want a deeper baseline before choosing `quick` vs `new-project` |
| `work-plan` | Research + plan + adversarial check for a standalone change or current phase | When a concrete change needs durable plan -> execute -> verify, with or without a roadmap phase |
| `work-execute` | Execute phase plans in parallel waves | After planning is complete |
| `work-verify` | 3-level verification gate + anti-pattern scan | After execution completes |
| `work-verify-work` | Conversational UAT validation with structured gap tracking | When user-facing behavior needs explicit validation beyond repo artifacts |
| `work-audit-milestone` | Cross-phase integration, requirements coverage, E2E flows | When all phases are done |
| `work-complete-milestone` | Archive a shipped milestone, evolve `SPEC.md`, collapse `ROADMAP.md` | When the audited milestone is ready to ship |
| `work-new-milestone` | Start the next milestone with goals, requirements, and roadmap phases | After closing a milestone and starting the next one |
| `work-quick` | Plan and execute sub-hour work outside the phase cycle | Bug fixes, small features, config changes when the bounded change is already concrete |
| `work-pause` | Save session context to checkpoint | Stopping mid-phase |
| `work-resume` | Restore context from checkpoint and route to next action | Starting a new session |
| `work-progress` | Show project status and route to next action | "Where am I?" |

### CLI Commands

| Command | Purpose |
|---------|---------|
| `npx -y workspine init [--tools <platform>]` | Set up `.work/`, generate skills/adapters |
| `npx -y workspine update [--dry-run]` | Reconcile all manifest-owned repo-local templates, helpers, skills, and adapters from latest sources |
| `npx -y workspine find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `npx -y workspine verify <N>` | Run artifact checks for phase N |
| `npx -y workspine scaffold phase <N> [name]` | Create a new phase plan file |
| `npx -y workspine models show` | Display effective model state across all runtimes |
| `npx -y workspine models profile <tier>` | Set global model profile (`quality`/`balanced`/`budget`) |
| `npx -y workspine models agent-profile --agent <id> --profile <tier>` | Per-agent semantic override |
| `npx -y workspine models set --runtime <rt> --agent <id> --model <id>` | Exact runtime model override |
| `npx -y workspine models clear --runtime <rt> --agent <id>` | Remove runtime override |
| `npx -y workspine setup` | Run the first-use setup facade |
| `npx -y workspine rigor` | Inspect or update rigor configuration |
| `npx -y workspine next` | Read the next file-backed action |
| `npx -y workspine file-op` | Apply an approved file operation |
| `npx -y workspine lifecycle-transition` | Advance a recorded lifecycle state |
| `npx -y workspine remember` | Record a durable project memory |
| `npx -y workspine decisions` | Inspect or promote decisions |
| `npx -y workspine journey` | Inspect journey receipts |
| `npx -y workspine git-identity` | Inspect Git identity and root |
| `npx -y workspine phase-status` | Inspect phase status |
| `npx -y workspine help` | Show the concise first-use and core-command summary; this guide owns the detailed command reference |

If `workspine` is globally installed, you can use the shorter `gsdd ...` form for the same commands. Generated workflow helper calls do not use the global binary; they run through `node .work/bin/gsdd.mjs ...` from the repo root. The `gsdd` binary alias is removed at the next minor release, so new scripts and CI should call `workspine ...` directly.

Global repair checks remain available as `workspine health --global` and `workspine update --global` (or `-g`).

The supported public CLI/generated helper has default-on update awareness on commands that already write to `.work/`; read-only commands such as `next` and `verify` never check or cache. Eligible commands make sequential/best-effort anonymous npm metadata checks when the contained `.work/.local` cache is writable, with no lock or cross-process concurrency guarantee. It uses a two-second timeout and 64 KiB/normalized-version limits, sends no credentials or repository data, and cache/check failures are nonblocking. Use `--no-update-notice` or `WORKSPINE_UPDATE_AWARENESS=0` (legacy `GSDD_UPDATE_AWARENESS=0`) to opt out. The `health` and `update` operations remain network-free, though `npx` may download the package first; run `npx -y workspine update` for explicit repair. No native/TUI startup hook, automatic context transfer, runtime parity, or protection against adversarial concurrent cache-path swaps is implied.

Browser-proof contract migration: `update` refreshes templates, skills,
adapters, and helper code, but it does not rewrite historical phase artifacts.
Old no-UI plans that use `ui_proof_slots: []` with a meaningful
`no_ui_proof_rationale` continue to verify with a compatibility warning. Old
plans with non-empty `ui_proof_slots` must be migrated to
`browser_proof_required: true` plus a `## Browser Proof Plan` before they can
close through direct verification.

Normal user flow:

1. Run `npx -y workspine setup`.
2. Enter workflows through your runtime surface: `/work-*` or `$work-*`.
3. Use `npx -y workspine health` to check repo-local generated surfaces.
4. Use `npx -y workspine update` when repo-local generated surfaces drift or you want the latest shipped output.
5. For personal global installs, run `npx -y workspine health --global`. It recommends `npx -y workspine update --global` only when every discovered issue is safe to reconcile; otherwise resolve the named ownership/filesystem blocker manually. Use `npx -y workspine install --global --tools <targets>` for a fresh or explicitly scoped install.

Surface split:

- `.agents/skills/work-*` is the workflow entry surface.
- `.work/bin/gsdd*` is an internal local helper surface used by workflow-embedded lifecycle mechanics. It is kept available, but it is not the normal first-run user entrypoint.

Advanced/internal helper commands remain available:

| Command | Purpose |
|---------|---------|
| `gsdd file-op <copy\|delete\|regex-sub>` | Deterministic workspace-confined file copy, delete, and text mutation |
| `gsdd phase-status <N> <status>` | Update a single ROADMAP phase status through the local helper surface |
| `gsdd lifecycle-preflight <surface> [phase]` | Inspect deterministic lifecycle gate results for a workflow surface |

Other CLI commands that remain available outside the first-run path:

| Command | Purpose |
|---------|---------|
| `gsdd find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `gsdd verify <N>` | Run phase artifact and browser-proof closure checks for phase N; exits nonzero when verification is blocked |
| `gsdd scaffold phase <N> [name]` | Create a new phase plan file |

### Continuity Commands

`work-pause` writes a checkpoint to `.work/.continue-here.md`. `gsdd next` reads that checkpoint together with `.work/` and repo truth, and returns a structured read-only packet. The checkpoint is context beneath PLAN/SPEC/lifecycle/Git truth, so artifact state wins when the two disagree.

```bash
gsdd next --json           # structured packet (the default captured output)
gsdd next --format human   # compact supervisor card
npx -y workspine init      # bootstrap the complete Workspine workspace
```

JSON packets carry typed `next_action` values for CLI commands, workflow skills, manual review, and user-question gates. Blocking questions, decisions, graph rebuilds, and dogfood findings use explicit subcommands. A duplicate question, decision, or dogfood ID replays as unchanged when the content matches, and fails unless `--replace` is passed when the content differs. The continuity graph records answer and supersession edges, so a later agent can reconstruct decision history without rereading raw transcripts.

### Decision Promotion

Promotion is a cooperative, auditable owner assertion rather than human authentication:

```bash
gsdd decisions promote <id> --authority owner --approval-ref <non-sensitive-ref>
```

The assertion is stored on the same decision record and binds the exact decision id, body hash, authority label, non-sensitive reference, and timestamp. Candidate provenance remains `agent-proposed`. Older active records without a complete assertion stay readable but require review until they are explicitly re-attested. The generated `.work/bin/gsdd.mjs` helper is candidate/query-only.

### Platform flags for `--tools`

| Flag | What's generated |
|------|-----------------|
| `claude` | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` |
| `opencode` | `.opencode/commands/`, `.opencode/agents/` |
| `codex` | `.codex/agents/work-plan-checker.toml` and `.codex/agents/work-approach-explorer.toml` (`.agents/skills/work-*` and `.work/bin/gsdd.mjs` are always generated; `$work-plan` stays plan-only until explicit `$work-execute`) |
| `agents` | Bounded fallback block in root `AGENTS.md` |
| `all` | All of the above |
| *(none)* | Auto-detect installed tools |

---

## Configuration Reference

`npx -y workspine init` creates `.work/config.json` interactively (or with defaults via repo-local `init --auto --tools <targets>`).

### Full config.json Schema

```json
{
  "researchDepth": "balanced",
  "parallelization": true,
  "commitDocs": true,
  "modelProfile": "balanced",
  "workflow": {
    "research": true,
    "planCheck": true,
    "verifier": true
  },
  "gitProtocol": {
    "branch": "Follow existing repo conventions",
    "commit": "Logical grouping, no phase/task IDs",
    "pr": "Follow existing review workflow"
  }
}
```

### Core Settings

| Setting | Options | Default | What it Controls |
|---------|---------|---------|------------------|
| `researchDepth` | `fast`, `balanced`, `deep` | `balanced` | Research thoroughness per phase |
| `parallelization` | `true`, `false` | `true` | Run independent agents simultaneously |
| `commitDocs` | `true`, `false` | `true` | Track `.work/` in git |
| `modelProfile` | `balanced`, `quality`, `budget` | `balanced` | Portable semantic model tier |

### Workflow Toggles

Each adds quality but costs tokens and time:

| Setting | Default | What it Controls |
|---------|---------|------------------|
| `workflow.research` | `true` | Research domain before planning each phase |
| `workflow.planCheck` | `true` | Fresh-context adversarial plan checking (max-3 cycle loop) |
| `workflow.verifier` | `true` | 3-level verification gate after execution |

Disable these to speed up phases in familiar domains or when conserving tokens. Disabling `planCheck` engages reduced-assurance mode: the planner self-checks without the independent reviewer.

### Model Control

Optional keys for fine-grained model selection:

Model profiles control cost and model quality: `quality` maximizes correctness, `balanced` fits ordinary work, and `budget` minimizes cost. Rigor controls alignment and quality gates. Use `npx -y workspine rigor` to inspect or update configuration without conflating those choices.

| Setting | What it Controls |
|---------|------------------|
| `agentModelProfiles.<agent>` | Per-agent semantic override (currently: `plan-checker`) |
| `runtimeModelOverrides.<runtime>.<agent>` | Exact runtime-native model override |

Supported runtimes: `claude`, `opencode`, `codex`.

Runtime behavior:
- `Claude` translates semantic tiers to native aliases (`opus`/`sonnet`/`haiku`) for the checker agent
- `OpenCode` inherits its runtime model by default; Workspine only injects a model when you set an explicit runtime override
- `Codex` inherits its session model by default; Workspine only injects a model in the TOML when you set an explicit runtime override

### Git Protocol

Advisory defaults. Repository and team conventions take precedence:

| Setting | Default |
|---------|---------|
| `gitProtocol.branch` | Follow existing repo conventions |
| `gitProtocol.commit` | Logical grouping, no framework-imposed format |
| `gitProtocol.pr` | Follow existing review workflow |

Workspine does not impose commit formats, branch naming, or one-commit-per-task rules.

---

## Usage Examples

### New Project (Full Cycle)

`npx -y workspine init`

Cursor, Copilot, and Gemini can use the installed `.agents/skills/` surfaces when their slash/skill discovery sees that directory. The difference is runtime proof and ergonomics, not workflow shape. If discovery is unavailable, open or paste the relevant `.agents/skills/work-*/SKILL.md` file.

- `Claude/OpenCode`: `/work-new-project -> /work-plan -> /work-execute -> /work-verify -> /work-audit-milestone`
- `Codex`: `$work-new-project -> $work-plan -> $work-execute -> $work-verify -> $work-audit-milestone` (`$work-plan` ends at plan creation; `$work-execute` is a separate explicit step)
- `Codex VS Code / app`: use built-in discovery if available; otherwise open or paste `.agents/skills/work-new-project/SKILL.md` and continue with the matching skill files
- `Cursor / Copilot / Gemini`: use the same sequence from the slash command menu when skill discovery is available; otherwise open or paste the matching `.agents/skills/work-*/SKILL.md` files

### Milestone Continuation

- `Claude/OpenCode`: `/work-plan` amend/extend mode when audit findings need closure work, or `/work-complete-milestone -> /work-new-milestone` when the milestone is ready to ship
- `Codex`: `$work-plan` amend/extend mode when audit findings need closure work, or `$work-complete-milestone -> $work-new-milestone` when the milestone is ready to ship
- `Cursor / Copilot / Gemini`: use the matching slash commands when skill discovery is available, with the same routing as above

### Repos That Already Have Code

`npx -y workspine init`

- Choose one starting goal after init:
- `Claude/OpenCode`: `/work-quick` for a concrete bounded change, `/work-plan` for a planned standalone change, or `/work-new-project` to start/extend a broader project
- `Codex`: `$work-quick`, `$work-plan`, or `$work-new-project` for those same goals (`$work-plan` remains plan-only until `$work-execute`)
- `Cursor / Copilot / Gemini`: use the matching slash command when skill discovery is available, using the same three-goal routing
- Add `/work-map-codebase` first only when the repo is unfamiliar, risky, or its map is stale. Use `/work-new-milestone` only after shipped milestone history is present.

### Quick Bug Fix

- `Claude/OpenCode`: `/work-quick`
- `Codex`: `$work-quick`
- `Cursor / Copilot / Gemini`: `/work-quick` from the slash command menu when skill discovery is available

### Resume After a Break

- `Claude/OpenCode`: `/work-progress` or `/work-resume`
- `Codex`: `$work-progress` or `$work-resume`
- `Cursor / Copilot / Gemini`: use the matching skill from the slash command menu when discovery is available

### Pause Mid-Work

- `Claude/OpenCode`: `/work-pause`
- `Codex`: `$work-pause`
- `Cursor / Copilot / Gemini`: `/work-pause` from the slash command menu when skill discovery is available

### Speed vs Quality Presets

| Scenario | Research Depth | Model Profile | Research | Plan Check | Verifier |
|----------|---------------|---------------|----------|------------|----------|
| Prototyping | `fast` | `budget` | off | off | off |
| Normal dev | `balanced` | `balanced` | on | on | on |
| Production | `deep` | `quality` | on | on | on |

### Headless Init (CI / Automation)

```bash
npx -y workspine init --auto --tools claude           # Non-interactive, default config
npx -y workspine init --auto --tools claude --brief path/to/PRD.md  # Seed from existing document
```

---

## Common Problems

### Context Degradation During Long Sessions

Clear your context window between major workflows. Workspine is designed around fresh contexts, and every delegate gets a clean context window. If quality drops in the main session, clear and use `work-resume` or `work-progress` to restore state.

### Plans Seem Wrong or Misaligned

Check that research ran before planning (`workflow.research: true`). Most plan quality issues come from the planner making assumptions that domain research would have prevented. If plan-checking is enabled, the checker should catch alignment issues, though it cannot fix missing domain context.

### Execution Produces Stubs

Plans should have 2-5 tasks maximum. If tasks are too large, they exceed what a single context window can produce reliably. Re-plan with smaller scope.

### Lost Track of Where You Are

Run `work-progress`. It reads all artifacts and tells you where you are and what to do next.

### Need to Change Something After Execution

Do not re-run `work-execute`. Use `work-quick` for targeted fixes, or `work-verify` to systematically identify issues.

### Template Refresh After Update

```bash
npx -y workspine update       # Reconciles role contracts, delegates, helpers, skills, and adapters
```

If you've modified any templates, the generation manifest detects this and warns you before overwriting. The SHA-256 hash of each generated file is tracked in `.work/generation-manifest.json`.

### Generated Surfaces Drift Or A Runtime Command Goes Missing

In a repo-local `.work/` workspace, start with `npx -y workspine health`. Stale manifest-owned repo-local surfaces are repaired with plain `npx -y workspine update`. If health reports a missing manifest-owned Claude, OpenCode, or Codex native target, follow its emitted `npx -y workspine init --tools <runtime>` repair first, then rerun health and plain update if further stale surfaces remain. Generated-looking files without matching manifest ownership require manual preservation/ownership repair rather than automatic adoption. For global personal installs, use `npx -y workspine health --global`: safe missing/package-stale ownership can route to `update --global`, while any unowned, user-modified, linked, colliding, unreadable, corrupt, foreign, or ownership-missing state blocks automatic reconciliation until resolved manually. Fresh installs still use `npx -y workspine install --global --tools <targets>`.

That repair path is deterministic for generated files. It does not imply that every runtime has equal native ergonomics or equal validation depth.

For an existing global install, start with `npx -y workspine health --global`. Manifest-owned missing files and package-stale bytes can be reconciled with `npx -y workspine update --global` only when the whole discovered target set is auto-safe. If health reports a user-modified, untracked, ownership-missing, linked, colliding, unreadable, corrupt, or foreign state, preserve the existing bytes and resolve that blocker manually before rerunning global health; do not use global install as an in-place repair shortcut.

### Model Costs Too High

Switch to budget profile: `npx -y workspine models profile budget` (or `gsdd models profile budget` when globally installed). Disable research and plan-check via config if the domain is familiar.

---

## Recovery Quick Reference

| Problem | Solution |
|---------|----------|
| Lost context / new session | `work-resume` or `work-progress` |
| Phase went wrong | `git revert` the phase commits, then re-plan |
| Quick targeted fix | `work-quick` |
| Something broke | Use the debugger role for systematic debugging |
| Costs running high | `npx -y workspine models profile budget`, disable workflow toggles |
| Templates out of date | `npx -y workspine update` or `gsdd update` if globally installed |
| Adapters out of date | `npx -y workspine update` or `gsdd update` if globally installed |

---

## Project File Structure

```
.work/
  SPEC.md                   # Living specification (goals, constraints, decisions)
  ROADMAP.md                # Phased delivery plan with inline status
  config.json               # Project configuration
  bin/
    gsdd                    # POSIX shim for the local helper surface
    gsdd.cmd                # Windows shim for the local helper surface
    gsdd.mjs                # Canonical self-contained local helper runtime
    gsdd.ps1                # PowerShell shim for the local helper surface
    lib/                    # Copied helper-runtime support modules
  generation-manifest.json  # SHA-256 hashes for template versioning
  .local/                   # Local-only operational annotations; not product truth
  .continue-here.md         # Session checkpoint (created by pause, consumed by resume)
  research/                 # Domain research outputs
  codebase/                 # Codebase maps (4 files: STACK, ARCHITECTURE, CONVENTIONS, CONCERNS)
  phases/
    XX-phase-name/
      PLAN.md               # Atomic execution plans with XML task structure
      SUMMARY.md            # Execution outcomes
      VERIFICATION.md       # Post-execution verification results
  quick/
    NNN-slug/
      PLAN.md               # Quick task plan
      SUMMARY.md            # Quick task outcome
  templates/
    delegates/              # 11 delegate instruction files
  LOG.md                    # Quick task log

agents/                     # 10 canonical role contracts
.agents/skills/work-*/      # Portable workflow entrypoints (open standard)
.work/bin/gsdd.mjs          # Internal repo-local helper runtime for deterministic workflow commands (run from repo root)
```

Platform-specific adapters (generated by `npx -y workspine init`, or `gsdd init` when globally installed):

```
.claude/skills/             # Claude Code skill files
.claude/commands/           # Claude Code command aliases
.claude/agents/             # Claude Code native agents

.opencode/commands/         # OpenCode command files
.opencode/agents/           # OpenCode native agents

.codex/agents/              # Codex CLI agent TOML files

AGENTS.md                   # Optional governance block (useful for agents that consume AGENTS.md)
```

`.agents/skills/` is the workflow entry surface. `.work/bin/` is the internal helper runtime used by those workflows. Native adapters and governance files are optional ergonomics, not required prompt bulk.

---

## Workflow Diagrams

### Full Project Lifecycle

```
  ┌──────────────────────────────────────────────────┐
  │                   NEW PROJECT                    │
  │  work-new-project                                │
  │  Questions -> Research -> Spec -> Roadmap        │
  └─────────────────────────┬────────────────────────┘
                            │
             ┌──────────────▼─────────────┐
             │      FOR EACH PHASE:       │
             │                            │
             │  ┌────────────────────┐    │
             │  │ work-plan          │    │  <- Research + Plan + Check
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ work-execute       │    │  <- Wave-based execution
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ work-verify        │    │  <- 3-level gate
             │  └──────────┬─────────┘    │
             │             │              │
             │     Next Phase?────────────┘
             │             │ No
             └─────────────┼──────────────┘
                           │
             ┌──────────────▼──────────────┐
             │  work-audit-milestone       │
             └─────────────────────────────┘
```

Optional closure and milestone-continuation workflows in the shipped surface:

- `work-verify-work` adds conversational UAT when user-facing behavior needs explicit validation.
- `work-plan` also handles amend/extend planning when audit findings need gap-closure phases before a milestone is ready to ship.
- `work-complete-milestone` archives a shipped milestone, evolves `SPEC.md`, and collapses `ROADMAP.md`.
- `work-new-milestone` starts the next milestone after closure.

### How Plan Agents Coordinate

```
  work-plan (phase N)
         │
         ├── Phase Researcher (x4 parallel)
         │     ├── Stack researcher
         │     ├── Features researcher
         │     ├── Architecture researcher
         │     └── Pitfalls researcher
         │           │
         │     ┌─────▼───────┐
         │     │ RESEARCH.md │
         │     └─────┬───────┘
         │           │
         │     ┌─────▼──────┐
         │     │  Planner   │  <- Reads SPEC.md, ROADMAP.md, RESEARCH.md
         │     └─────┬──────┘
         │           │
         │     ┌─────▼──────────────┐     ┌────────┐
         │     │  Plan Checker      │────>│ PASS?  │
         │     │  (fresh context,   │     └───┬────┘
         │     │   10 dimensions,    │         │
         │     │   typed JSON)      │    Yes  │  No
         │     └────────────────────┘     │   │   │
         │                                │   └───┘  (max 3 cycles)
         │                                │
         │                          ┌─────▼──────┐
         │                          │ PLAN files │
         │                          └────────────┘
         └── Done
```

Where supported, the plan checker runs in a **separate context window** from the planner. This separates the review from the planning conversation, but does not guarantee independent reasoning or eliminate shared blind spots. When a separate checker is unavailable, record the reduced assurance. Verification still needs evidence from the actual code and behavior.

The 10 check dimensions: requirement coverage, task completeness, dependency correctness, key-link completeness, scope sanity, must-have quality, context compliance, goal achievement, approach alignment, and decision compliance. See the shipped planning workflow for applicability and skipped checks.

### Execution Wave Coordination

```
  work-execute (phase N)
         │
         ├── Analyze plan dependencies
         │
         ├── Wave 1 (independent plans):
         │     ├── Executor A (fresh context     ) -> commit
         │     └── Executor B (fresh context     ) -> commit
         │
         ├── Wave 2 (depends on Wave 1):
         │     └── Executor C (fresh context     ) -> commit
         │
         └── Phase summary written to disk
```

### Brownfield Workflow (Existing Codebase)

```
  Brownfield repo
        │
        ├── bounded change already concrete
        │        │
        │        ▼
        │   work-quick
        │   bounded feature work
        │   with inline baseline
        │
        ├── repo unfamiliar / risky / deeper orientation needed
        │        │
        │        ▼
        │   work-map-codebase
        │        │
        │        └── continue with work-quick or work-new-project
        │
        └── fuzzy scope / full lifecycle setup
                 │
                 ▼
           work-new-project
           canonical initializer
```

### Verification Gate

```
  work-verify (phase N)
         │
         ├── Level 1: EXISTS
         │     └── Do the expected files exist?
         │
         ├── Level 2: SUBSTANTIVE
         │     └── Is the code real, not stubs?
         │
         ├── Level 3: WIRED
         │     └── Is it connected and functional?
         │
         └── Anti-pattern scan
               └── TODO/FIXME/HACK markers, empty catches
```

---
