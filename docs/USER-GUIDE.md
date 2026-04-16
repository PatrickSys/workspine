# Workspine User Guide

A detailed reference for Workspine workflows, troubleshooting, and configuration. Workspine is the public product name; the package, CLI, workflow names, and workspace remain `gsdd-cli`, `gsdd`, `gsdd-*`, and `.planning/` as retained technical contracts. For quick-start setup and the public proof pack, start with the [README](../README.md).

---

## Table of Contents

- [Workflow Diagrams](#workflow-diagrams)
- [Command Reference](#command-reference)
- [Configuration Reference](#configuration-reference)
- [Usage Examples](#usage-examples)
- [Troubleshooting](#troubleshooting)
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

### Planning Agent Coordination

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

The plan checker runs in a **separate context window** from the planner. This prevents the checker from inheriting the planner's blind spots — the same reasoning error that produced the plan cannot suppress the review of that plan. This is the [ICLR-validated](https://arxiv.org/abs/2310.12397) pattern for LLM self-refinement.

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
  gsdd-map-codebase
         │
         ├── Stack Mapper     -> codebase/STACK.md
         ├── Arch Mapper      -> codebase/ARCHITECTURE.md
         ├── Convention Mapper -> codebase/CONVENTIONS.md
         └── Concern Mapper   -> codebase/CONCERNS.md
                │
        ┌───────┴───────────────┐
        │                       │
 if bounded change        otherwise
 is already concrete      use the canonical initializer
        │                       │
        ▼                       ▼
  gsdd-quick              gsdd-new-project
  bounded feature work    full lifecycle setup
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

### Workflows (run via generated skills or adapters)

| Workflow | Purpose | When to Use |
|----------|---------|-------------|
| `gsdd-new-project` | Full project init: questioning, codebase audit, research, spec, roadmap | Start of a new project |
| `gsdd-map-codebase` | Map existing codebase for reusable brownfield context | Before `gsdd-new-project`, or before `gsdd-quick` only when you already know the bounded change you want |
| `gsdd-plan` | Research + plan + adversarial check for current phase; writes planning artifacts only | Before executing a phase |
| `gsdd-execute` | Execute phase plans in parallel waves | After planning is complete |
| `gsdd-verify` | 3-level verification gate + anti-pattern scan | After execution completes |
| `gsdd-audit-milestone` | Cross-phase integration, requirements coverage, E2E flows | When all phases are done |
| `gsdd-quick` | Plan and execute sub-hour work outside the phase cycle | Bug fixes, small features, config changes when the bounded change is already concrete |
| `gsdd-pause` | Save session context to checkpoint | Stopping mid-phase |
| `gsdd-resume` | Restore context from checkpoint and route to next action | Starting a new session |
| `gsdd-progress` | Show project status and route to next action | "Where am I?" |

### CLI Commands

| Command | Purpose |
|---------|---------|
| `gsdd init [--tools <platform>]` | Set up `.planning/`, generate adapters |
| `gsdd update [--tools <platform>]` | Regenerate adapters from latest sources |
| `gsdd update --templates` | Refresh role contracts and delegates (warns about user modifications) |
| `gsdd find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `gsdd verify <N>` | Run artifact checks for phase N |
| `gsdd scaffold phase <N> [name]` | Create a new phase plan file |
| `gsdd models show` | Display effective model state across all runtimes |
| `gsdd models profile <tier>` | Set global model profile (`quality`/`balanced`/`budget`) |
| `gsdd models agent-profile --agent <id> --profile <tier>` | Per-agent semantic override |
| `gsdd models set --runtime <rt> --agent <id> --model <id>` | Exact runtime model override |
| `gsdd models clear --runtime <rt> --agent <id>` | Remove runtime override |
| `gsdd help` | Show all commands |

### Platform flags for `--tools`

| Flag | What's generated |
|------|-----------------|
| `claude` | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` |
| `opencode` | `.opencode/commands/`, `.opencode/agents/` |
| `codex` | `.codex/agents/gsdd-plan-checker.toml` (portable skill is always generated; `$gsdd-plan` stays plan-only until explicit `$gsdd-execute`) |
| `agents` | Bounded fallback block in root `AGENTS.md` |
| `all` | All of the above |
| *(none)* | Auto-detect installed tools |

---

## Configuration Reference

`gsdd init` creates `.planning/config.json` interactively (or with defaults via `--auto`).

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
| `commitDocs` | `true`, `false` | `true` | Track `.planning/` in git |
| `modelProfile` | `balanced`, `quality`, `budget` | `balanced` | Portable semantic model tier |

### Workflow Toggles

Each adds quality but costs tokens and time:

| Setting | Default | What it Controls |
|---------|---------|------------------|
| `workflow.research` | `true` | Research domain before planning each phase |
| `workflow.planCheck` | `true` | Fresh-context adversarial plan checking (max-3 cycle loop) |
| `workflow.verifier` | `true` | 3-level verification gate after execution |

Disable these to speed up phases in familiar domains or when conserving tokens. Disabling `planCheck` engages reduced-assurance mode — the planner self-checks but without the independent reviewer.

### Model Control

Optional keys for fine-grained model selection:

| Setting | What it Controls |
|---------|------------------|
| `agentModelProfiles.<agent>` | Per-agent semantic override (currently: `plan-checker`) |
| `runtimeModelOverrides.<runtime>.<agent>` | Exact runtime-native model override |

Supported runtimes: `claude`, `opencode`, `codex`.

Runtime behavior:
- **Claude** translates semantic tiers to native aliases (`opus`/`sonnet`/`haiku`) for the checker agent
- **OpenCode** inherits its runtime model by default; Workspine only injects a model when you set an explicit runtime override
- **Codex** inherits its session model by default; Workspine only injects a model in the TOML when you set an explicit runtime override

### Git Protocol

Advisory defaults — repository and team conventions take precedence:

| Setting | Default |
|---------|---------|
| `gitProtocol.branch` | Follow existing repo conventions |
| `gitProtocol.commit` | Logical grouping, no framework-imposed format |
| `gitProtocol.pr` | Follow existing review workflow |

Workspine does not impose commit formats, branch naming, or one-commit-per-task rules.

---

## Usage Examples

### New Project (Full Cycle)

`npx gsdd-cli init`

- `Claude/OpenCode`: `/gsdd-new-project -> /gsdd-plan -> /gsdd-execute -> /gsdd-verify -> /gsdd-audit-milestone`
- `Codex`: `$gsdd-new-project -> $gsdd-plan -> $gsdd-execute -> $gsdd-verify -> $gsdd-audit-milestone` (`$gsdd-plan` ends at plan creation; `$gsdd-execute` is a separate explicit unlock)
- `Cursor / Copilot / Gemini`: `/gsdd-new-project -> /gsdd-plan -> /gsdd-execute -> /gsdd-verify -> /gsdd-audit-milestone` from the slash command menu once the skill is installed

### Existing Codebase

`npx gsdd-cli init`

- `Claude/OpenCode`: `/gsdd-map-codebase -> /gsdd-quick` for bounded brownfield work you can already name, or `/gsdd-map-codebase -> /gsdd-new-project` for full lifecycle setup
- `Codex`: `$gsdd-map-codebase -> $gsdd-quick` for bounded brownfield work you can already name, or `$gsdd-map-codebase -> $gsdd-new-project`
- `Cursor / Copilot / Gemini`: `/gsdd-map-codebase -> /gsdd-quick` or `/gsdd-map-codebase -> /gsdd-new-project` from the slash command menu once the skills are installed

### Quick Bug Fix

- `Claude/OpenCode`: `/gsdd-quick`
- `Codex`: `$gsdd-quick`
- `Cursor / Copilot / Gemini`: `/gsdd-quick` from the slash command menu once the skill is installed

### Resuming After a Break

- `Claude/OpenCode`: `/gsdd-progress` or `/gsdd-resume`
- `Codex`: `$gsdd-progress` or `$gsdd-resume`
- `Cursor / Copilot / Gemini`: use the matching skill from the slash command menu once installed

### Pausing Mid-Work

- `Claude/OpenCode`: `/gsdd-pause`
- `Codex`: `$gsdd-pause`
- `Cursor / Copilot / Gemini`: `/gsdd-pause` from the slash command menu once the skill is installed

### Speed vs Quality Presets

| Scenario | Research Depth | Model Profile | Research | Plan Check | Verifier |
|----------|---------------|---------------|----------|------------|----------|
| Prototyping | `fast` | `budget` | off | off | off |
| Normal dev | `balanced` | `balanced` | on | on | on |
| Production | `deep` | `quality` | on | on | on |

### Headless Init (CI / Automation)

```bash
npx gsdd-cli init --auto --tools claude           # Non-interactive, default config
npx gsdd-cli init --auto --tools claude --brief path/to/PRD.md  # Seed from existing document
```

---

## Troubleshooting

### Context Degradation During Long Sessions

Clear your context window between major workflows. Workspine is designed around fresh contexts — every delegate gets a clean context window. If quality drops in the main session, clear and use `gsdd-resume` or `gsdd-progress` to restore state.

### Plans Seem Wrong or Misaligned

Check that research ran before planning (`workflow.research: true`). Most plan quality issues come from the planner making assumptions that domain research would have prevented. If plan-checking is enabled, the checker should catch alignment issues — but it cannot fix missing domain context.

### Execution Produces Stubs

Plans should have 2-5 tasks maximum. If tasks are too large, they exceed what a single context window can produce reliably. Re-plan with smaller scope.

### Lost Track of Where You Are

Run `gsdd-progress`. It reads all artifacts and tells you where you are and what to do next.

### Need to Change Something After Execution

Do not re-run `gsdd-execute`. Use `gsdd-quick` for targeted fixes, or `gsdd-verify` to systematically identify issues.

### Template Refresh After Update

```bash
npx gsdd-cli update --templates       # Refreshes role contracts and delegates
```

If you've modified any templates, the generation manifest detects this and warns you before overwriting. The SHA-256 hash of each generated file is tracked in `.planning/generation-manifest.json`.

### Model Costs Too High

Switch to budget profile: `gsdd models profile budget`. Disable research and plan-check via config if the domain is familiar.

---

## Recovery Quick Reference

| Problem | Solution |
|---------|----------|
| Lost context / new session | `gsdd-resume` or `gsdd-progress` |
| Phase went wrong | `git revert` the phase commits, then re-plan |
| Quick targeted fix | `gsdd-quick` |
| Something broke | Use the debugger role for systematic debugging |
| Costs running high | `gsdd models profile budget`, disable workflow toggles |
| Templates out of date | `npx gsdd-cli update --templates` |
| Adapters out of date | `npx gsdd-cli update` |

---

## Project File Structure

```
.planning/
  SPEC.md                   # Living specification (goals, constraints, decisions)
  ROADMAP.md                # Phased delivery plan with inline status
  config.json               # Project configuration
  generation-manifest.json  # SHA-256 hashes for template versioning
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
```

Platform-specific adapters (generated by `gsdd init`):

```
.claude/skills/             # Claude Code skill files
.claude/commands/           # Claude Code command aliases
.claude/agents/             # Claude Code native agents

.opencode/commands/         # OpenCode command files
.opencode/agents/           # OpenCode native agents

.codex/agents/              # Codex CLI agent TOML files

AGENTS.md                   # Governance fallback block (useful for agents that consume AGENTS.md)
```
