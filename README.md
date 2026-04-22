<div align="center">

# Workspine

**AI development that stays consistent across agents and sessions.** Plans are checked, work is verified, and progress is tracked in the repo.

[![npm version](https://img.shields.io/npm/v/gsdd-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd-cli)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

```bash
npx gsdd-cli init
```

**Directly validated today:** Claude Code, Codex CLI, and OpenCode.
**Qualified support:** Cursor, Copilot, and Gemini CLI support the same core workflow through the shared `.agents/skills/` surface; this release does not claim the same runtime proof or ergonomics.

</div>

One repo-native spine for planning, checking, execution, verification, and handoff — so AI-assisted work survives cold starts, runtime switches, and session loss.

---

## What This Is

Workspine is a repo-native delivery spine for long-horizon AI-assisted software work. It keeps planning, execution, verification, handoff, and progress state in the repo so work survives cold starts, runtime switches, and session loss.

Workspine is the product name. The package, CLI commands, workflow prefixes, and workspace directory remain `gsdd-cli`, `gsdd`, `gsdd-*`, and `.planning/` — these are retained technical contracts, not rename residue.

### Lineage

Workspine began as a fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done), whose long-horizon delivery spine proved the problem was real. Since the fork, upstream GSD has continued evolving into a broad multi-runtime framework — as of April 2026, GSD v1 documents 81 commands and 78 workflows across 33 agents. Workspine took a different path: 14 public workflow surfaces, generated runtime adapters from a portable core, evidence-gated closure, and provenance-aware continuity. The trade-off is deliberate: a narrower surface with stricter closure and fewer moving parts for the human operator.

---

## What's Different

### Context survives cold starts, tool switches, and session loss

Planning, phase artifacts, verification reports, and handoff checkpoints live in `.planning/`. When you switch runtimes or come back after a week, the repo still knows what was planned, what was executed, what was verified, and where you stopped.

<details>
<summary>How it works</summary>

Three-layer continuity model: durable project truth (SPEC, ROADMAP, design decisions), live workflow state (phase plans, summaries, checkpoints), and compressed judgment (active constraints, anti-regression rules). Pause/resume workflows write and read these layers explicitly. No session memory required.

</details>

### Done means verified, not merely generated

Verification is a separate workflow with a separate context window, not a checkbox at the end of execution. It checks three levels — do the files exist, is the code substantive (not stubs), and is it actually wired into the system — plus an anti-pattern scan.

<details>
<summary>How it works</summary>

`gsdd-verify` runs after execution and produces a typed verification report. `gsdd-audit-milestone` checks cross-phase integration, requirement coverage, and end-to-end flows. Evidence-gated closure prevents marking work done without the right evidence kinds (code, test, runtime, delivery, human).

</details>

### Rules that must be consistent are enforced by code, not by memory

1,381 tests across 13 test files guard properties that PRs repeatedly broke: delegate-role reference integrity, workflow vendor-API cleanliness, artifact schema consistency, plan-checker dimension coverage, and cross-document drift.

<details>
<summary>How it works</summary>

Invariant suites (I-series), guard suites (G-series), and scenario suites (S-series) run on every change. Each assertion includes a `FIX:` instruction so failures are actionable. 52 documented design decisions in `distilled/DESIGN.md` record the rationale with evidence trails.

</details>

### Smaller surface, stricter closure

14 workflows. 10 roles. One CLI. Lifecycle progression goes through deterministic preflight gates — not conversational inference. Plans are checked by a separate agent in a separate context before execution begins. Closure requires evidence, not just file existence.

<details>
<summary>How it works</summary>

`gsdd-plan` is terminal: it writes planning artifacts and stops. Execution requires an explicit `gsdd-execute` transition. `lifecycle-preflight` evaluates eligibility from repo artifacts before allowing state changes. `phase-status` is the only explicit ROADMAP mutator. `progress` is read-only.

</details>

**Target user:** Developer or small team that wants one durable delivery spine across coding runtimes, with explicit checks and repo-native proof instead of a dashboard or orchestration control plane.

---

## Getting Started

```bash
npx gsdd-cli init
```

This creates:

1. `.planning/` — durable workspace with templates, role contracts, and config
2. `.agents/skills/gsdd-*` — portable workflow entrypoints
3. `.agents/bin/gsdd.mjs` — repo-local helper launcher for deterministic workflow commands inside generated skills (run helper commands from the repo root)
4. Tool-specific adapters you choose in the install wizard (Claude skills/commands/agents, OpenCode commands/agents, Codex agents, optional governance)

Then run the new-project workflow to produce `.planning/SPEC.md` and `.planning/ROADMAP.md`.

In a terminal, `gsdd init` now opens a guided install wizard:

- Step 1: select the runtimes/vendors you want to support
- Step 2: decide separately whether repo-wide `AGENTS.md` governance is worth installing
- Step 3: configure planning defaults in the same guided flow

Portable `.agents/skills/gsdd-*` skills and the repo-local `.agents/bin/gsdd.mjs` helper launcher are always generated. The wizard controls extra native adapters and optional governance, not the portable baseline. Workflow helper commands that call the launcher assume the repo root as the current working directory.
When those generated surfaces exist locally, `gsdd health` checks them against current render output instead of asking you to trust manual review.

### Launch Proof Status

- **Directly validated:** Claude Code, Codex CLI, and OpenCode have recorded `plan -> execute -> verify` evidence for the core lifecycle.
- **Qualified support:** Cursor, Copilot, and Gemini CLI support the same core workflow through the shared `.agents/skills/` surface; this release does not claim the same runtime proof or ergonomics.
- **Runtime-surface freshness:** Installed generated skills and native adapters are renderer-checked locally; repair stays deterministic through `npx gsdd-cli update`.

Start with the public proof pack:

- [Brownfield proof](docs/BROWNFIELD-PROOF.md)
- [Exported consumer proof pack](docs/proof/consumer-node-cli/README.md)
- [Runtime support matrix](docs/RUNTIME-SUPPORT.md)
- [Verification discipline](docs/VERIFICATION-DISCIPLINE.md)

### Quickstart (after init)

Runtime floor: Node 20+.

Your tool determines how you invoke workflows:

- **Claude Code / OpenCode / Cursor / Copilot / Gemini:** Use slash commands directly — `/gsdd-new-project`, `/gsdd-plan`, etc.
- **Codex CLI:** Use skill references — `$gsdd-new-project`, `$gsdd-plan`, etc. `$gsdd-plan` writes the plan and stops; start a separate `$gsdd-execute` run when you want implementation to begin.
- **Other AI tools:** Open `.agents/skills/gsdd-<workflow>/SKILL.md` and follow the instructions.

If you generate the root `AGENTS.md` block, it adds the framework's behavioral governance. For Cursor, Copilot, and Gemini, that governance is optional discipline on top of native skill discovery — not the mechanism that makes workflows discoverable.

### Choose Your Starting Workflow

| Situation | Start here | Why |
|----------|------------|-----|
| Greenfield project, or brownfield work that is fuzzy / broad / milestone-shaped | `gsdd-new-project` | This is the full initializer. On brownfield repos it will run codebase mapping internally when it needs it. |
| Brownfield repo and the bounded change is already concrete | `gsdd-quick` | This is the bounded-change lane. It can use existing codebase maps when present and otherwise builds a just-enough inline brownfield baseline. |
| Brownfield repo is unfamiliar, risky, or you want a deeper baseline before choosing the lane | `gsdd-map-codebase` | This is the deeper orientation pass. Use it when the inline quick baseline would be too weak, then continue with `gsdd-quick` or `gsdd-new-project`. |

### Platform Adapters

Workspine generates adapters for whichever tools you use:

```bash
npx gsdd-cli init                    # Guided install wizard (detected runtimes preselected)
npx gsdd-cli init --tools claude     # Claude Code: .claude/skills + commands + agents
npx gsdd-cli init --tools opencode   # OpenCode: .opencode/commands + agents
npx gsdd-cli init --tools codex      # Codex CLI: portable gsdd-plan skill + .codex/agents checker
npx gsdd-cli init --tools agents     # Root AGENTS.md fallback
npx gsdd-cli init --tools cursor     # Backward-compatible AGENTS.md governance alias
npx gsdd-cli init --tools all        # All of the above
```

| Platform | Public claim | What's generated |
|----------|--------------|-----------------|
| **All** (default) | Shared portable surface | `.agents/skills/gsdd-*/SKILL.md` plus `.agents/bin/gsdd.mjs` — portable workflow entrypoints and repo-local helper launcher (always generated) |
| **Claude Code** | Directly validated | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` — native workflow surfaces, freshness-checked when generated locally |
| **OpenCode** | Directly validated | `.opencode/commands/`, `.opencode/agents/` — native workflow surfaces, freshness-checked when generated locally |
| **Codex CLI** | Directly validated | Portable skill entry plus `.agents/bin/gsdd.mjs` and `.codex/agents/gsdd-plan-checker.toml`; planning stays locked until explicit `$gsdd-execute`, and installed surfaces are freshness-checked locally |
| **Cursor / Copilot / Gemini** | Same core workflow | Skills-native discovery from `.agents/skills/`; optional root `AGENTS.md` block adds behavioral governance, and the generated skill surface is freshness-checked locally |
| **Other AI tools** | Fallback only | Open `.agents/skills/gsdd-*/SKILL.md` directly |

### Updating

```bash
npx gsdd-cli update                    # Regenerate adapters from latest sources
npx gsdd-cli update --tools claude     # Update specific platform only
npx gsdd-cli update --templates        # Refresh .planning/templates/ and role contracts from framework source
```

### Non-Interactive Mode (CI / Automation)

For non-interactive environments:

```bash
npx gsdd-cli init --auto --tools claude
npx gsdd-cli init --auto --tools claude --brief path/to/PRD.md
```

`--auto` skips the interactive install wizard and uses default configuration. It does **not** run downstream workflows (`new-project`, `plan`, `execute`, `verify`) — those are always explicit. `--brief` copies a project document to `.planning/PROJECT_BRIEF.md` for `new-project` to consume.

If you already know exactly what to generate, `--tools ...` remains the manual path. The wizard is the primary onboarding UX; flags remain the advanced/headless contract.

### Team Use

- **Shared state:** Set `commitDocs: true` (default) — `.planning/` is tracked in git. Everyone sees the same spec, roadmap, and phase plans.
- **Onboarding:** After cloning, run `npx gsdd-cli init` to generate tool-specific adapters. `.planning/` is already tracked — no re-initialization needed.
- **Governance is explicit:** The wizard asks separately whether to install repo-wide `AGENTS.md` rules, and explains why you may care before writing to the repo root.
- **Session handoff:** Use `gsdd-pause` / `gsdd-resume` to hand off work. The checkpoint (`.planning/.continue-here.md`) captures context for the next person.
- **Adapter isolation:** Each developer runs `gsdd init --tools <their-tool>`. Adapter files don't conflict across tools.

For detailed workflow diagrams, recovery procedures, and extended examples, see the [User Guide](docs/USER-GUIDE.md).

---

## How It Works

### The Core Loop

```
init → [plan → execute → verify] × N phases → audit-milestone → done
                    ↕ pause/resume (any point)
```

### 1. Initialize Project

Run the `gsdd-new-project` workflow. The system:

1. **Questions** — asks until it understands your idea (goals, constraints, tech, edge cases)
2. **Codebase map** — if brownfield and a deeper baseline is needed, maps the codebase across stack, architecture, conventions, and concerns; users do not need to pre-run `map-codebase` before `new-project`
3. **Research** — spawns parallel researchers to investigate the domain (configurable depth: fast/balanced/deep)
4. **Spec + Roadmap** — produces `SPEC.md` (living specification) and `ROADMAP.md` (phased delivery plan)

**Creates:** `.planning/SPEC.md`, `.planning/ROADMAP.md`

---

### 2. Plan Phase

Run `gsdd-plan` for the current phase. The system:

1. **Researches** — investigates how to implement this phase (if `workflow.research` is enabled)
2. **Plans** — creates atomic task plans with XML structure
3. **Checks** — a separate agent in a fresh context window reviews the plan against 7 dimensions (requirement coverage, task completeness, dependency correctness, key-link completeness, scope sanity, must-have quality, context compliance). If the plan fails, it revises and re-checks — up to 3 cycles before escalating to the human. Output is typed JSON so orchestration is machine-parseable, not prompt-dependent.

Each plan is small enough to execute in a fresh context window. The checker runs in a separate context from the planner — this is the [ICLR-validated](https://arxiv.org/abs/2310.01798) pattern for catching blind spots the planner inherits from its own reasoning.

`gsdd-plan` is terminal for the current run: it writes planning artifacts only. Execution begins only after an explicit `gsdd-execute` / `/gsdd-execute` / `$gsdd-execute` transition, depending on the runtime.

**Creates:** Phase plans in `.planning/phases/`

---

### 3. Execute Phase

Run `gsdd-execute`. The system:

1. **Runs plans in waves** — parallel where possible, sequential when dependent
2. **Fresh context per plan** — 200k tokens purely for implementation
3. **Clean commits** — follows repo conventions, no framework-imposed commit format
4. **Creates summaries** — records what happened for verification

**Creates:** Phase summaries in `.planning/phases/`

---

### 4. Verify Phase

Run `gsdd-verify`. The system checks three levels:

1. **Exists** — do the expected files exist?
2. **Substantive** — is the code real, not stubs?
3. **Wired** — is it connected and functional?

Plus anti-pattern scan (TODO/FIXME/HACK markers, empty catches).

**Creates:** Phase verification report in `.planning/phases/`

---

### 5. Repeat and Audit

Loop **plan → execute → verify** for each phase in the roadmap.

When all phases are done, run `gsdd-audit-milestone` to verify:

- Cross-phase integration (do the pieces connect?)
- Requirements coverage (did we deliver what SPEC.md promised?)
- E2E flows (do user workflows complete end-to-end?)

---

### Quick Mode

- `Claude Code / OpenCode`: `/gsdd-quick`
- `Codex CLI`: `$gsdd-quick`
- `Cursor / Copilot / Gemini`: `/gsdd-quick`
- `Other AI tools`: open `.agents/skills/gsdd-quick/SKILL.md`

For sub-hour tasks that don't need the full phase cycle:

- Same roles: planner + executor, conditional verifier
- Skips research: no researcher, no synthesizer
- Separate tracking: lives in `.planning/quick/`, logged in `LOG.md`
- Advisory git: follows repo conventions, no framework-imposed commit format

Use for: bug fixes, small features, config changes, one-off tasks.

**Creates:** `.planning/quick/NNN-slug/PLAN.md`, `SUMMARY.md`, updates `LOG.md`

---

## Workflows

Workspine has 14 workflows, run via generated skills or adapters:

| Workflow | What it does |
|----------|--------------|
| `gsdd-new-project` | Full initialization: questioning, brownfield audit when needed, research, spec, roadmap |
| `gsdd-map-codebase` | Deeper brownfield orientation and refresh before `quick` or `new-project` |
| `gsdd-plan` | Research + plan + check for a phase |
| `gsdd-execute` | Execute phase plan: implement tasks, verify changes |
| `gsdd-verify` | Verify completed phase: 3-level checks, anti-pattern scan |
| `gsdd-verify-work` | Conversational UAT testing: validate user-facing behavior with structured gap tracking |
| `gsdd-audit-milestone` | Audit milestone: cross-phase integration, requirements coverage, E2E flows |
| `gsdd-complete-milestone` | Archive shipped milestone, evolve spec, collapse roadmap |
| `gsdd-new-milestone` | Start next milestone: gather goals, define requirements, create roadmap phases |
| `gsdd-plan-milestone-gaps` | Create gap-closure phases from audit results |
| `gsdd-quick` | Quick task: bounded brownfield change lane with inline baseline when full mapping is unnecessary |
| `gsdd-pause` | Pause work: save session context to checkpoint for seamless resumption |
| `gsdd-resume` | Resume work: restore context from artifacts and route to next action |
| `gsdd-progress` | Show project status and route to next action |

Workflows are agent skills or commands, not plain shell utilities. How you invoke them depends on your platform:

| Platform | How to invoke workflows |
|----------|------------------------|
| Claude Code | `/gsdd-plan` (slash command, works immediately after init) |
| OpenCode | `/gsdd-plan` (slash command, works immediately after init) |
| Codex CLI | `$gsdd-plan` (skill reference, works immediately after init) |
| Cursor / Copilot / Gemini | `/gsdd-plan` (skills-native slash command). If the root `AGENTS.md` block is present, it adds governance, not workflow discovery. |
| Other AI tools | Open `.agents/skills/gsdd-plan/SKILL.md` and paste or reference its content. |

## CLI Commands

| Command | What it does |
|---------|--------------|
| `gsdd init [--tools <platform>]` | Set up `.planning/`, generate adapters |
| `gsdd update [--tools <platform>] [--templates]` | Regenerate adapters; `--templates` refreshes `.planning/templates/` and role contracts |
| `gsdd health [--json]` | Check workspace integrity (healthy/degraded/broken) |
| `gsdd file-op <copy\|delete\|regex-sub>` | Run deterministic workspace-confined file copy, delete, and regex substitution |
| `gsdd find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `gsdd phase-status <N> <status>` | Update a single ROADMAP phase status through the status-aware helper |
| `gsdd verify <N>` | Run artifact checks for phase N |
| `gsdd scaffold phase <N> [name]` | Create a new phase plan file |
| `gsdd models [show\|profile\|set\|...]` | Inspect and manage model profile propagation |
| `gsdd help` | Show all commands |

---

## Architecture

### Roles (10 canonical)

Workspine consolidates GSD's agent surface into 10 roles with durable contracts:

| Role | Responsibility |
|------|---------------|
| **Mapper** | Codebase analysis — produces STACK, ARCHITECTURE, CONVENTIONS, CONCERNS |
| **Researcher** | Domain investigation — merges GSD's project + phase researcher |
| **Synthesizer** | Research consolidation (conditional — skipped in fast mode) |
| **Planner** | Phase planning — absorbs plan-checking responsibility |
| **Executor** | Task implementation |
| **Verifier** | Phase verification — Exists/Substantive/Wired gate |
| **Roadmapper** | Roadmap generation from spec |
| **Integration Checker** | Cross-phase wiring, API coverage, auth protection, E2E flows |
| **Approach Explorer** | Implementation approach alignment before planning begins |
| **Debugger** | Utility role for systematic debugging |

### Two-Layer Architecture

- **Role contracts** (`agents/*.md`) — durable, contain the full behavioral specification
- **Delegates** (`distilled/templates/delegates/*.md`) — thin wrappers that reference roles and provide task-specific context

11 delegates: 4 mapper, 4 researcher, 1 synthesizer, 1 plan-checker, 1 approach-explorer. Workflows use `<delegate>` blocks to dispatch work. For detailed GSD-to-GSDD role distillation rationale, see [`agents/DISTILLATION.md`](agents/DISTILLATION.md).

### Adapter Architecture

Workspine generates vendor-specific files from vendor-agnostic markdown — it does not convert from one vendor format to another. This means every adapter gets first-class output shaped to its platform's native capabilities.

| Adapter | Evidence posture | Strategy |
|---------|------------------|----------|
| **Claude Code** | Directly validated | Skill-primary plan surface, thin command alias, native `gsdd-plan-checker` agent |
| **OpenCode** | Directly validated | Specialized `/gsdd-plan` command (`subtask: false`), hidden `gsdd-plan-checker` subagent (`mode: subagent`) |
| **Codex CLI** | Directly validated | Portable skill as entry surface, `.codex/agents/gsdd-plan-checker.toml` (read-only, high reasoning effort), explicit `$gsdd-execute` unlock |
| **Cursor / Copilot / Gemini** | Same core workflow | Runtime discovers `.agents/skills/` natively; optional root `AGENTS.md` block adds behavioral governance only |
| **agents** (`--tools agents`) | Governance-only helper | Root `AGENTS.md` block for tools that benefit from governance or need open-standard fallback guidance |

All adapters render the plan-checker from a single source (`distilled/templates/delegates/plan-checker.md`). Each adapter shapes the output to its platform's native mechanics, and the portable skill remains the shared workflow source.

Cursor, Copilot, and Gemini CLI generate the same root `AGENTS.md` governance block as `--tools agents`, but that file is governance only. Those runtimes already discover `.agents/skills/` natively and surface the workflows as slash commands.

Model IDs pass through a two-layer injection guard: a regex whitelist (`/^[a-zA-Z0-9._\/:@-]+$/`) at the CLI boundary, plus format-specific escaping (TOML string escaping, triple-quote break prevention) at the adapter layer.

### Artifacts

| File | Purpose |
|------|---------|
| `.planning/SPEC.md` | Living specification — replaces GSD's separate PROJECT.md + REQUIREMENTS.md |
| `.planning/ROADMAP.md` | Phased delivery plan with inline status — replaces STATE.md |
| `.planning/config.json` | Project configuration (research depth, workflow toggles, git protocol) |
| `.planning/phases/` | Plans, summaries, and verification reports per phase |
| `.planning/research/` | Research outputs |
| `.planning/codebase/` | Codebase maps (4 files) |
| `.planning/quick/` | Quick task tracking |
| `.planning/.continue-here.md` | Session checkpoint (created by pause, consumed by resume) |

### Advisory Git Protocol

Workspine does not impose commit formats, branch naming, or one-commit-per-task rules. Git guidance is advisory — repository and team conventions take precedence:

- **Branching** — follow existing repo conventions
- **Commits** — group changes logically, no framework-imposed format
- **PRs** — follow existing repo review workflow

Defaults configurable in `.planning/config.json` under `gitProtocol`.

### What to Track in Git

| Path | Track? | Why |
|------|--------|-----|
| `.planning/` | Yes (default) | Shared project state — spec, roadmap, phase plans. Controlled by `commitDocs` in config. |
| `.agents/skills/` | Yes | Portable workflow entrypoints. Generated, safe to track. |
| `.claude/`, `.opencode/`, `.codex/` | Yes | Tool-specific adapters. Don't conflict across tools. |
| `AGENTS.md` (root) | Yes (if generated) | Governance block. Uses bounded upsert — won't overwrite existing content. |

No secrets or credentials are generated. Set `commitDocs: false` for local-only planning state.

### Context Isolation

Orchestrators stay thin. Delegates write documents to disk and return summaries — the orchestrator never accumulates full research or plan content in its context window. This keeps the main session fast and responsive even during deep phases.

---

## Configuration

`gsdd init` creates `.planning/config.json` interactively (or with defaults in non-interactive mode).

| Setting | Options | Default | What it controls |
|---------|---------|---------|------------------|
| `researchDepth` | `fast`, `balanced`, `deep` | `balanced` | Research thoroughness per phase |
| `parallelization` | `true`, `false` | `true` | Run independent agents simultaneously |
| `commitDocs` | `true`, `false` | `true` | Track `.planning/` in git |
| `modelProfile` | `balanced`, `quality`, `budget` | `balanced` | Portable semantic model tier |

**When to use each profile:**
- **`quality`** — maximize plan-checking rigor. Use for production milestones or security-sensitive work.
- **`balanced`** (default) — good checking at reasonable cost. Suitable for most development.
- **`budget`** — minimize cost. Use for prototyping or familiar domains where you'll review plans manually.

The profile only affects the plan-checker agent. Disable `workflow.planCheck` entirely to skip checking.

Optional model-control keys:

| Setting | What it controls |
|---------|------------------|
| `agentModelProfiles.<agent>` | Per-agent semantic override. Current supported agent id: `plan-checker`. |
| `runtimeModelOverrides.<runtime>.<agent>` | Exact runtime-native model override. Supported targets: `claude.plan-checker`, `opencode.plan-checker`, `codex.plan-checker`. |

Runtime behavior:
- Claude translates semantic tiers to native aliases for the checker agent.
- OpenCode inherits its runtime model by default; Workspine only injects an exact OpenCode `model:` when you set an explicit runtime override.
- Codex inherits its session model by default; Workspine only injects an explicit `model` in the TOML when you set an explicit runtime override.

CLI:
- `gsdd models show`
- `gsdd models profile <quality|balanced|budget>`
- `gsdd models agent-profile --agent plan-checker --profile <quality|balanced|budget>`
- `gsdd models clear-agent-profile --agent plan-checker`
- `gsdd models set --runtime <claude|opencode|codex> --agent plan-checker --model <id>`
- `gsdd models clear --runtime <claude|opencode|codex> --agent plan-checker`

### Workflow Toggles

Each adds quality but costs tokens and time:

| Setting | Default | What it does |
|---------|---------|--------------|
| `workflow.research` | `true` | Research domain before planning each phase |
| `workflow.planCheck` | `true` | Verify plans achieve goals before execution |
| `workflow.verifier` | `true` | Verify phase deliverables after execution |

### Git Protocol

Advisory defaults, overridden by repo conventions:

| Setting | Default |
|---------|---------|
| `gitProtocol.branch` | Follow existing repo conventions |
| `gitProtocol.commit` | Logical grouping, no phase/task IDs |
| `gitProtocol.pr` | Follow existing review workflow |

---

## Troubleshooting

**First step:** Run `gsdd health` — it checks workspace integrity and prints actionable fix instructions.

| Problem | What to do |
|---------|------------|
| Workspace feels broken | `gsdd health` — checks errors, warnings, info |
| `gsdd health` reports generated runtime-surface drift | `npx gsdd-cli update` (or `npx gsdd-cli update --tools <runtime>`) — regenerates installed skills/adapters from current render output |
| Lost track of progress | Run `gsdd-progress` — reads artifacts, shows status |
| Need context from last session | Run `gsdd-resume` — restores state, routes to next action |
| Plans seem wrong | Check `workflow.research: true` in config |
| Execution produces stubs | Re-plan with smaller scope (2-5 tasks per plan) |
| Templates out of date | `npx gsdd-cli update --templates` — warns before overwriting |
| Model costs too high | `gsdd models profile budget` + disable `workflow.planCheck` |

For detailed troubleshooting and recovery procedures, see the [User Guide](docs/USER-GUIDE.md#troubleshooting).

---

## Design Decisions

This repo records 52 documented design decisions relative to GSD, each with evidence from source files and external research. See [`distilled/DESIGN.md`](distilled/DESIGN.md) for the full rationale.

Key choices:
- **4-file codebase standard** — drop state that rots (STRUCTURE, INTEGRATIONS, TESTING), keep rules that don't
- **Agent consolidation** — 10 roles from GSD's 11, with explicit reduced-assurance mode when independent checking isn't available
- **Adapter generation over conversion** — generate vendor-specific files from vendor-agnostic markdown instead of converting from Claude-first
- **Advisory git** — repo conventions over framework defaults
- **Context isolation** — summaries up, documents to disk
- **Mechanical invariant enforcement** — structural properties guarded by assertions, not code review
- **Model profile propagation** — semantic tiers (`quality`/`balanced`/`budget`) translated to native model IDs per runtime
- **Template versioning** — SHA-256 generation manifest detects user modifications before overwriting
- **CLI composition root boundary** — 100-line facade delegates to extracted modules
- **Codex CLI native adapter** — portable skill entry + TOML checker agent, documented platform gaps tracked against upstream issues

---

## Testing

The framework has 1,381 tests across 13 test files — named suites that guard properties PRs repeatedly fixed manually. These are not unit tests for application code; they are invariant checks on the specification itself.

### Invariant Suites (I-series)

Structural contracts that prevent drift between roles, delegates, workflows, and artifacts:

| Suite | What it guards |
|-------|---------------|
| **I1** | Delegate-role reference integrity — 11 delegates resolve to existing role contracts |
| **I2** | Role section structure — 10 roles have role def, scope, output format, success criteria |
| **I3** | Delegate thinness — no leaked role-contract sections in delegates |
| **I3-gate** | New-project approval gates — required human checkpoints present |
| **I4** | Workflow references — 14 workflows, all delegate/role refs resolve |
| **I5** | Session management — no vendor APIs, no STATE.md, checkpoint contract |
| **I5b** | Session workflow scope boundaries |
| **I6** | Artifact schema definitions |
| **I7** | Plan-checker dimension integrity — 7 dimensions present and correctly structured |
| **I8** | Workflow vendor API cleanliness — no platform-specific calls in portable workflows |
| **I9** | No deprecated content — no vendor paths, dropped files, legacy tooling |
| **I10** | Mandatory initial-read enforcement on hardened lifecycle roles |
| **S13** | STATE.md elimination — D7 compliance verified across all artifacts |

### Guard Suites (G-series)

Mechanical enforcement that catches cross-document inconsistencies:

| Suite | What it guards |
|-------|---------------|
| **G1** | Cross-document schema consistency |
| **G3** | File size guards — role contracts and delegates within bounds |
| **G4** | XML section well-formedness across all workflows |
| **G5** | Artifact lifecycle chain — plan → execute → verify → audit linkage |
| **G6** | DESIGN.md decision registry — ToC matches actual decisions |
| **G7** | Delegate thinness (mechanical) |
| **G8** | Auto-mode contract |
| **G9** | Generation manifest contract |
| **G10** | CLI module boundary — composition root stays thin |
| **G11** | Codex doc contract — no deprecated references |
| **G12** | Documentation accuracy — decision counts, workflow counts, CLI commands, ghost commands |
| **G13** | Models pre-init safety — mutation commands guard uninitialized workspaces |
| **G14** | Health module contract — export, command wiring, help text, fix instructions |
| **G15** | OWASP authorization matrix — template format, integration-checker Step 4a, backwards compat |
| **G16** | Distillation ledger — DISTILLATION.md role coverage, merger table, D22 registration |
| **G17** | Mapper output quantification — template sections, delegate instructions, D23 registration |
| **G18** | Consumer governance completeness — agents.block.md workflow coverage, CHANGELOG accuracy |
| **G19** | Consumer first-run accuracy — honest platform tiers, per-platform invocation guidance, Quickstart section |
| **G20** | Session continuity contract — pause checkpoint format, resume routing, progress detection, cross-workflow paths |

### Scenario Suites (S-series)

Golden-path eval tests that verify artifact-chain contracts across end-to-end workflows:

| Suite | What it covers |
|-------|---------------|
| **S1** | Greenfield golden path — init → new-project → plan → execute → verify → audit-milestone |
| **S2** | Brownfield path — map-codebase delegates, codebase map references, mapper role |
| **S3** | Quick-task path — isolation from ROADMAP/research, role references |
| **S4** | Native runtime chain — Claude + Codex checker completeness, 7 dimensions |
| **S5** | Config-to-content propagation — default config values reflected in generated artifacts |

### Functional Test Suites

| Suite | What it covers |
|-------|---------------|
| Init & update | Planning structure, config, templates, adapters, idempotency, auto mode |
| Models | Profile propagation, runtime overrides, CLI commands, injection prevention |
| Generation manifest | SHA-256 hashing, modification detection, dry-run mode |
| Plan adapters | Portable skill neutrality, TOML format, triple-quote escaping |
| Audit milestone | Integration checking contract |
| Health | Pre-init guard, all check categories, verdict logic, JSON/human output |

```bash
npm test
```

---

## Credits

Workspine is a fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), licensed under MIT. Original git history is retained for attribution.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
