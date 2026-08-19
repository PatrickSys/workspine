# Workspine User Guide

A detailed reference for Workspine workflows, troubleshooting, and configuration. Workspine is the public product name; the npm package is `workspine`, and the CLI, workflow names, and workspace remain `gsdd`, `gsdd-*`, and `.work/` as retained technical contracts. Runtime floor: Node >=22. For quick-start setup and the public proof pack, start with the [README](../README.md). Human install/update commands use `npx -y workspine ...`; bare `gsdd ...` is shorthand only when the package is globally installed.

The supported public CLI/generated helper has default-on update awareness on commands that already write to `.work/`; read-only commands such as `next` and `verify` never check or cache. Eligible commands make sequential/best-effort anonymous npm metadata checks when the contained `.work/.local` cache is writable, with no lock or cross-process concurrency guarantee. It uses a two-second timeout and 64 KiB/normalized-version limits, sends no credentials or repository data, and cache/check failures are nonblocking. Use `--no-update-notice` or `GSDD_UPDATE_AWARENESS=0` to opt out. `health` and `update` remain network-free; run `npx -y workspine update` for explicit repair. No native/TUI startup hook, automatic context transfer, runtime parity, or protection against adversarial concurrent cache-path swaps is implied.

---

## Fast Path

For a new project or a broad brownfield effort:

1. Run `npx -y workspine init` from the repo root.
2. Start with `gsdd-new-project` unless the change is already small and concrete.
3. Review the plan from `gsdd-plan` before starting `gsdd-execute`.
4. Run `gsdd-verify` before calling the phase done.

Use `npx -y workspine init` for repo-local setup. For reusable global surfaces, run `npx -y workspine install --global` to choose targets interactively or pass `--tools <targets>` in a fresh/headless home. Use `--auto` to refresh detected existing homes; global install never creates `.work/` in the current repo.

For a bounded existing-code change, use `gsdd-quick`. For an unfamiliar or risky repo, use `gsdd-map-codebase` before choosing between `gsdd-quick` and `gsdd-new-project`.

---

## Table of Contents

- [Fast Path](#fast-path)
- [Workflow Diagrams](#workflow-diagrams)
- [Command Reference](#command-reference)
- [Configuration Reference](#configuration-reference)
- [Usage Examples](#usage-examples)
- [Common Problems](#common-problems)
- [Recovery Quick Reference](#recovery-quick-reference)

---

## Workflow Diagrams

### Full Project Lifecycle

```
  ┌──────────────────────────────────────────────────┐
  │                   NEW PROJECT                    │
  │  gsdd-new-project                                │
  │  Questions -> Research -> Spec -> Roadmap        │
  └─────────────────────────┬────────────────────────┘
                            │
             ┌──────────────▼─────────────┐
             │      FOR EACH PHASE:       │
             │                            │
             │  ┌────────────────────┐    │
             │  │ gsdd-plan          │    │  <- Research + Plan + Check
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ gsdd-execute       │    │  <- Wave-based execution
             │  └──────────┬─────────┘    │
             │             │              │
             │  ┌──────────▼─────────┐    │
             │  │ gsdd-verify        │    │  <- 3-level gate
             │  └──────────┬─────────┘    │
             │             │              │
             │     Next Phase?────────────┘
             │             │ No
             └─────────────┼──────────────┘
                           │
             ┌──────────────▼──────────────┐
             │  gsdd-audit-milestone       │
             └─────────────────────────────┘
```

Optional closure and milestone-continuation workflows in the shipped surface:

- `gsdd-verify-work` adds conversational UAT when user-facing behavior needs explicit validation.
- `gsdd-plan` also handles amend/extend planning when audit findings need gap-closure phases before a milestone is ready to ship.
- `gsdd-complete-milestone` archives a shipped milestone, evolves `SPEC.md`, and collapses `ROADMAP.md`.
- `gsdd-new-milestone` starts the next milestone after closure.

### How Plan Agents Coordinate

```
  gsdd-plan (phase N)
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
         │     │   7 dimensions,    │         │
         │     │   typed JSON)      │    Yes  │  No
         │     └────────────────────┘     │   │   │
         │                                │   └───┘  (max 3 cycles)
         │                                │
         │                          ┌─────▼──────┐
         │                          │ PLAN files │
         │                          └────────────┘
         └── Done
```

The plan checker runs in a **separate context window** from the planner. This prevents the checker from inheriting the planner's blind spots. The same reasoning error that produced the plan cannot suppress the review of that plan. This is the [ICLR-validated](https://arxiv.org/abs/2310.01798) pattern for LLM self-refinement.

The 7 check dimensions: requirement coverage, task completeness, dependency correctness, key-link completeness, scope sanity, must-have quality, context compliance.

### Execution Wave Coordination

```
  gsdd-execute (phase N)
         │
         ├── Analyze plan dependencies
         │
         ├── Wave 1 (independent plans):
         │     ├── Executor A (fresh 200K context) -> commit
         │     └── Executor B (fresh 200K context) -> commit
         │
         ├── Wave 2 (depends on Wave 1):
         │     └── Executor C (fresh 200K context) -> commit
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
        │   gsdd-quick
        │   bounded feature work
        │   with inline baseline
        │
        ├── repo unfamiliar / risky / deeper orientation needed
        │        │
        │        ▼
        │   gsdd-map-codebase
        │        │
        │        └── continue with gsdd-quick or gsdd-new-project
        │
        └── fuzzy scope / full lifecycle setup
                 │
                 ▼
           gsdd-new-project
           canonical initializer
```

### Verification Gate

```
  gsdd-verify (phase N)
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

## Command Reference

### Install Modes

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

For a fresh install, choose targets interactively or pass `--tools <targets>`. Use `--auto` for a non-interactive refresh of detected existing agent homes. If none are detected, it writes nothing and prints one exact command per supported target.

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
| `gsdd-new-project` | Full project init: questioning, brownfield audit when needed, research, spec, roadmap | Greenfield, fuzzy brownfield scope, or full lifecycle setup |
| `gsdd-map-codebase` | Map existing codebase for reusable brownfield context | When the repo is unfamiliar, risky, or you want a deeper baseline before choosing `quick` vs `new-project` |
| `gsdd-plan` | Research + plan + adversarial check for current phase; writes planning artifacts only | Before executing a phase |
| `gsdd-execute` | Execute phase plans in parallel waves | After planning is complete |
| `gsdd-verify` | 3-level verification gate + anti-pattern scan | After execution completes |
| `gsdd-verify-work` | Conversational UAT validation with structured gap tracking | When user-facing behavior needs explicit validation beyond repo artifacts |
| `gsdd-audit-milestone` | Cross-phase integration, requirements coverage, E2E flows | When all phases are done |
| `gsdd-complete-milestone` | Archive a shipped milestone, evolve `SPEC.md`, collapse `ROADMAP.md` | When the audited milestone is ready to ship |
| `gsdd-new-milestone` | Start the next milestone with goals, requirements, and roadmap phases | After closing a milestone and starting the next one |
| `gsdd-quick` | Plan and execute sub-hour work outside the phase cycle | Bug fixes, small features, config changes when the bounded change is already concrete |
| `gsdd-pause` | Save session context to checkpoint | Stopping mid-phase |
| `gsdd-resume` | Restore context from checkpoint and route to next action | Starting a new session |
| `gsdd-progress` | Show project status and route to next action | "Where am I?" |

### CLI Commands

| Command | Purpose |
|---------|---------|
| `npx -y workspine init [--tools <platform>]` | Set up `.work/`, generate skills/adapters |
| `npx -y workspine update [--tools <platform>]` | Regenerate skills/adapters from latest sources |
| `npx -y workspine update --templates` | Refresh role contracts and delegates (warns about user modifications) |
| `npx -y workspine find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `npx -y workspine verify <N>` | Run artifact checks for phase N |
| `npx -y workspine scaffold phase <N> [name]` | Create a new phase plan file |
| `npx -y workspine models show` | Display effective model state across all runtimes |
| `npx -y workspine models profile <tier>` | Set global model profile (`quality`/`balanced`/`budget`) |
| `npx -y workspine models agent-profile --agent <id> --profile <tier>` | Per-agent semantic override |
| `npx -y workspine models set --runtime <rt> --agent <id> --model <id>` | Exact runtime model override |
| `npx -y workspine models clear --runtime <rt> --agent <id>` | Remove runtime override |
| `npx -y workspine help` | Show all commands |

If `workspine` is globally installed, you can use the shorter `gsdd ...` form for the same commands. Generated workflow helper calls do not use the global binary; they run through `node .work/bin/gsdd.mjs ...` from the repo root. The `gsdd` binary alias is removed at the next minor release, so new scripts and CI should call `workspine ...` directly.

Browser-proof contract migration: `update` refreshes templates, skills,
adapters, and helper code, but it does not rewrite historical phase artifacts.
Old no-UI plans that use `ui_proof_slots: []` with a meaningful
`no_ui_proof_rationale` continue to verify with a compatibility warning. Old
plans with non-empty `ui_proof_slots` must be migrated to
`browser_proof_required: true` plus a `## Browser Proof Plan` before they can
close through direct verification.

Normal user flow:

1. Run `npx -y workspine init`.
2. Enter workflows through your runtime surface: `/gsdd-*` or `$gsdd-*`.
3. Use `npx -y workspine health` to check repo-local generated surfaces.
4. Use `npx -y workspine update` when repo-local generated surfaces drift or you want the latest shipped output.
5. For personal global installs, rerun `npx -y workspine install --global --auto` to repair or refresh detected existing agent homes, or use `npx -y workspine install --global --tools <targets>` for a fresh or explicitly scoped target set.

Surface split:

- `.agents/skills/gsdd-*` is the workflow entry surface.
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

`gsdd-pause` writes a checkpoint to `.work/.continue-here.md`. `gsdd next` reads that checkpoint together with `.work/` and repo truth, and returns a structured read-only packet. The checkpoint is context beneath PLAN/SPEC/lifecycle/Git truth, so artifact state wins when the two disagree.

```bash
gsdd next --json           # structured packet (the default captured output)
gsdd next --format human   # compact supervisor card
gsdd next --init           # bootstrap .work continuity state explicitly
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
| `codex` | `.codex/agents/gsdd-plan-checker.toml` (`.agents/skills/gsdd-*` and `.work/bin/gsdd.mjs` are always generated; `$gsdd-plan` stays plan-only until explicit `$gsdd-execute`) |
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

Cursor, Copilot, and Gemini can use the installed `.agents/skills/` surfaces when their slash/skill discovery sees that directory. The difference is runtime proof and ergonomics, not workflow shape. If discovery is unavailable, open or paste the relevant `.agents/skills/gsdd-*/SKILL.md` file.

- `Claude/OpenCode`: `/gsdd-new-project -> /gsdd-plan -> /gsdd-execute -> /gsdd-verify -> /gsdd-audit-milestone`
- `Codex`: `$gsdd-new-project -> $gsdd-plan -> $gsdd-execute -> $gsdd-verify -> $gsdd-audit-milestone` (`$gsdd-plan` ends at plan creation; `$gsdd-execute` is a separate explicit step)
- `Codex VS Code / app`: use built-in discovery if available; otherwise open or paste `.agents/skills/gsdd-new-project/SKILL.md` and continue with the matching skill files
- `Cursor / Copilot / Gemini`: use the same sequence from the slash command menu when skill discovery is available; otherwise open or paste the matching `.agents/skills/gsdd-*/SKILL.md` files

### Milestone Continuation

- `Claude/OpenCode`: `/gsdd-plan` amend/extend mode when audit findings need closure work, or `/gsdd-complete-milestone -> /gsdd-new-milestone` when the milestone is ready to ship
- `Codex`: `$gsdd-plan` amend/extend mode when audit findings need closure work, or `$gsdd-complete-milestone -> $gsdd-new-milestone` when the milestone is ready to ship
- `Cursor / Copilot / Gemini`: use the matching slash commands when skill discovery is available, with the same routing as above

### Repos That Already Have Code

`npx -y workspine init`

- Choose one starting lane after init:
- `Claude/OpenCode`: `/gsdd-quick` for a concrete bounded change, `/gsdd-new-project` for fuzzy or milestone-shaped work, or `/gsdd-map-codebase` first when the repo needs a deeper brownfield baseline
- `Codex`: `$gsdd-quick` for a concrete bounded change, `$gsdd-new-project` for fuzzy or milestone-shaped work, or `$gsdd-map-codebase` first when the repo needs a deeper brownfield baseline
- `Cursor / Copilot / Gemini`: `/gsdd-quick`, `/gsdd-new-project`, or `/gsdd-map-codebase` from the slash command menu when skill discovery is available, using the same routing rules above

### Quick Bug Fix

- `Claude/OpenCode`: `/gsdd-quick`
- `Codex`: `$gsdd-quick`
- `Cursor / Copilot / Gemini`: `/gsdd-quick` from the slash command menu when skill discovery is available

### Resume After a Break

- `Claude/OpenCode`: `/gsdd-progress` or `/gsdd-resume`
- `Codex`: `$gsdd-progress` or `$gsdd-resume`
- `Cursor / Copilot / Gemini`: use the matching skill from the slash command menu when discovery is available

### Pause Mid-Work

- `Claude/OpenCode`: `/gsdd-pause`
- `Codex`: `$gsdd-pause`
- `Cursor / Copilot / Gemini`: `/gsdd-pause` from the slash command menu when skill discovery is available

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

Clear your context window between major workflows. Workspine is designed around fresh contexts, and every delegate gets a clean context window. If quality drops in the main session, clear and use `gsdd-resume` or `gsdd-progress` to restore state.

### Plans Seem Wrong or Misaligned

Check that research ran before planning (`workflow.research: true`). Most plan quality issues come from the planner making assumptions that domain research would have prevented. If plan-checking is enabled, the checker should catch alignment issues, though it cannot fix missing domain context.

### Execution Produces Stubs

Plans should have 2-5 tasks maximum. If tasks are too large, they exceed what a single context window can produce reliably. Re-plan with smaller scope.

### Lost Track of Where You Are

Run `gsdd-progress`. It reads all artifacts and tells you where you are and what to do next.

### Need to Change Something After Execution

Do not re-run `gsdd-execute`. Use `gsdd-quick` for targeted fixes, or `gsdd-verify` to systematically identify issues.

### Template Refresh After Update

```bash
npx -y workspine update --templates       # Refreshes role contracts and delegates
```

If you've modified any templates, the generation manifest detects this and warns you before overwriting. The SHA-256 hash of each generated file is tracked in `.work/generation-manifest.json`.

### Generated Surfaces Drift Or A Runtime Command Goes Missing

In a repo-local `.work/` workspace, start with `npx -y workspine health`. If it reports drift or missing installed generated surfaces, run `npx -y workspine update` for the whole workspace or `npx -y workspine update --tools <runtime>` for a specific runtime. For global personal installs, rerun `npx -y workspine install --global --auto` or scope it explicitly with `npx -y workspine install --global --tools <targets>`.

That repair path is deterministic for generated files. It does not imply that every runtime has equal native ergonomics or equal validation depth.

A global install repair restores managed files you deleted and rewrites stale ones you have not touched, and it never overwrites your edits. If a managed file was hand-edited, or an untracked file sits where a managed one belongs, preflight stops and names that file, and nothing is written for any selected target until you resolve it. Restore the file from the manifest hash or delete it, then rerun the install.

### Model Costs Too High

Switch to budget profile: `npx -y workspine models profile budget` (or `gsdd models profile budget` when globally installed). Disable research and plan-check via config if the domain is familiar.

---

## Recovery Quick Reference

| Problem | Solution |
|---------|----------|
| Lost context / new session | `gsdd-resume` or `gsdd-progress` |
| Phase went wrong | `git revert` the phase commits, then re-plan |
| Quick targeted fix | `gsdd-quick` |
| Something broke | Use the debugger role for systematic debugging |
| Costs running high | `npx -y workspine models profile budget`, disable workflow toggles |
| Templates out of date | `npx -y workspine update --templates` or `gsdd update --templates` if globally installed |
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
.agents/skills/gsdd-*/      # Portable workflow entrypoints (open standard)
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
