<div align="center">

# GSD Distilled

**A portable, spec-driven development kernel for AI coding agents.**

Extracted from [Get Shit Done](https://github.com/gsd-build/get-shit-done). Same long-horizon delivery spine — fewer moving parts.

[![npm version](https://img.shields.io/npm/v/gsdd?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Tests](https://img.shields.io/badge/assertions-862_passing-brightgreen?style=for-the-badge)](tests/)

```bash
npx gsdd init
```

**Works with Claude Code, OpenCode, Codex CLI, Cursor, Copilot, and Gemini CLI.**

</div>

---

## What This Is

GSDD is a distilled fork of GSD. It preserves the high-leverage parts of long-horizon AI-assisted development:

- **Persistent artifacts** — SPEC.md, ROADMAP.md, and config.json as the durable workspace
- **Codebase mapping** — 4 parallel mappers produce STACK, ARCHITECTURE, CONVENTIONS, CONCERNS
- **Scoped planning** — research, backward planning, fresh-context adversarial plan checking
- **Execution** — wave-based parallel execution with fresh context per plan
- **Verification** — Exists/Substantive/Wired gate, anti-pattern scan
- **Milestone audit** — cross-phase integration, requirements coverage, E2E flows
- **Session management** — pause work with checkpoint, resume with context restoration and routing

What it strips: GSD's broader operator surface (32 workflows, 11 agents, discovery modes, sprint ceremony, a settings flow, and additional operator ergonomics). GSDD has 10 workflows and 9 roles.

**Target user:** Developer or small team that wants a spec-driven long-horizon kernel, not full operator comfort.

---

## Getting Started

```bash
npx gsdd init
```

This creates:

1. `.planning/` — durable workspace with templates, role contracts, and config
2. `.agents/skills/gsdd-*` — portable workflow entrypoints
3. Tool-specific adapters if detected (Claude skills/commands/agents, OpenCode commands/agents, Codex agents)

Then run the new-project workflow to produce `.planning/SPEC.md` and `.planning/ROADMAP.md`.

### Quickstart (after init)

Your tool determines how you invoke workflows:

- **Claude Code / OpenCode:** Use slash commands directly — `/gsdd-new-project`, `/gsdd-plan`, etc.
- **Codex CLI:** Use skill references — `$gsdd-new-project`, `$gsdd-plan`, etc.
- **Cursor / Copilot / Gemini / Others:** Open `.agents/skills/gsdd-<workflow>/SKILL.md` and follow the instructions. The root `AGENTS.md` governance block keeps the agent on track.

First workflow to run: **new-project** — it asks about your goals, audits the codebase (if brownfield), and produces `.planning/SPEC.md` + `.planning/ROADMAP.md`.

### Platform Adapters

GSDD generates adapters for whichever tools you use:

```bash
npx gsdd init                    # Auto-detect installed tools
npx gsdd init --tools claude     # Claude Code: .claude/skills + commands + agents
npx gsdd init --tools opencode   # OpenCode: .opencode/commands + agents
npx gsdd init --tools codex      # Codex CLI: portable gsdd-plan skill + .codex/agents checker
npx gsdd init --tools agents     # Root AGENTS.md fallback
npx gsdd init --tools all        # All of the above
```

| Platform | Tier | What's generated |
|----------|------|-----------------|
| **All** (default) | Open standard | `.agents/skills/gsdd-*/SKILL.md` — portable workflow entrypoints (always generated) |
| **Claude Code** | Native | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` — slash commands work immediately |
| **OpenCode** | Native | `.opencode/commands/`, `.opencode/agents/` — slash commands work immediately |
| **Codex CLI** | Native | `.codex/agents/gsdd-plan-checker.toml` — skill reference `$gsdd-plan` works immediately |
| **Cursor / Copilot / Gemini** | Governance | Root `AGENTS.md` block — governs agent behavior; invoke workflows by opening `.agents/skills/gsdd-*/SKILL.md` directly |

### Updating

```bash
npx gsdd update                    # Regenerate adapters from latest sources
npx gsdd update --tools claude     # Update specific platform only
npx gsdd update --templates        # Refresh .planning/templates/ and role contracts from framework source
```

### Headless Mode (CI / Automation)

For non-interactive environments:

```bash
npx gsdd init --auto --tools claude
npx gsdd init --auto --tools claude --brief path/to/PRD.md
```

`--auto` skips interactive prompts, uses smart defaults (`autoAdvance: true` in config). `--brief` copies a project document to `.planning/PROJECT_BRIEF.md` for `new-project` to consume.

### Team Use

- **Shared state:** Set `commitDocs: true` (default) — `.planning/` is tracked in git. Everyone sees the same spec, roadmap, and phase plans.
- **Onboarding:** After cloning, run `npx gsdd init` to generate tool-specific adapters. `.planning/` is already tracked — no re-initialization needed.
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
2. **Codebase audit** — if brownfield, runs 4 parallel mappers (or prompts for `/gsdd-map-codebase` first)
3. **Research** — spawns parallel researchers to investigate the domain (configurable depth: fast/balanced/deep)
4. **Spec + Roadmap** — produces `SPEC.md` (living specification) and `ROADMAP.md` (phased delivery plan)

**Creates:** `.planning/SPEC.md`, `.planning/ROADMAP.md`

---

### 2. Plan Phase

Run `gsdd-plan` for the current phase. The system:

1. **Researches** — investigates how to implement this phase (if `workflow.research` is enabled)
2. **Plans** — creates atomic task plans with XML structure
3. **Checks** — a separate agent in a fresh context window reviews the plan against 7 dimensions (requirement coverage, task completeness, dependency correctness, key-link completeness, scope sanity, must-have quality, context compliance). If the plan fails, it revises and re-checks — up to 3 cycles before escalating to the human. Output is typed JSON so orchestration is machine-parseable, not prompt-dependent.

Each plan is small enough to execute in a fresh context window. The checker runs in a separate context from the planner — this is the [ICLR-validated](https://arxiv.org/abs/2310.12397) pattern for catching blind spots the planner inherits from its own reasoning.

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
- `Cursor / Copilot / Gemini / Others`: open `.agents/skills/gsdd-quick/SKILL.md`

For sub-hour tasks that don't need the full phase cycle:

- Same roles: planner + executor, conditional verifier
- Skips research: no researcher, no synthesizer
- Separate tracking: lives in `.planning/quick/`, logged in `LOG.md`
- Advisory git: follows repo conventions, no framework-imposed commit format

Use for: bug fixes, small features, config changes, one-off tasks.

**Creates:** `.planning/quick/NNN-slug/PLAN.md`, `SUMMARY.md`, updates `LOG.md`

---

## Workflows

GSDD has 10 workflows, run via generated skills or adapters:

| Workflow | What it does |
|----------|--------------|
| `gsdd-new-project` | Full initialization: questioning, codebase audit, research, spec, roadmap |
| `gsdd-map-codebase` | Map existing codebase with 4 parallel mappers |
| `gsdd-plan` | Research + plan + check for a phase |
| `gsdd-execute` | Execute phase plan: implement tasks, verify changes |
| `gsdd-verify` | Verify completed phase: 3-level checks, anti-pattern scan |
| `gsdd-audit-milestone` | Audit milestone: cross-phase integration, requirements coverage, E2E flows |
| `gsdd-quick` | Quick task: plan and execute sub-hour work outside the phase cycle |
| `gsdd-pause` | Pause work: save session context to checkpoint for seamless resumption |
| `gsdd-resume` | Resume work: restore context from artifacts and route to next action |
| `gsdd-progress` | Show project status and route to next action |

Workflows are agent skills or commands, not plain shell utilities. How you invoke them depends on your platform:

| Platform | How to invoke workflows |
|----------|------------------------|
| Claude Code | `/gsdd-plan` (slash command, works immediately after init) |
| OpenCode | `/gsdd-plan` (slash command, works immediately after init) |
| Codex CLI | `$gsdd-plan` (skill reference, works immediately after init) |
| Cursor / Copilot / Gemini | Open `.agents/skills/gsdd-plan/SKILL.md` and paste or reference its content. The `AGENTS.md` governance block steers agent behavior. |

## CLI Commands

| Command | What it does |
|---------|--------------|
| `gsdd init [--tools <platform>]` | Set up `.planning/`, generate adapters |
| `gsdd update [--tools <platform>] [--templates]` | Regenerate adapters; `--templates` refreshes `.planning/templates/` and role contracts |
| `gsdd health [--json]` | Check workspace integrity (healthy/degraded/broken) |
| `gsdd find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `gsdd verify <N>` | Run artifact checks for phase N |
| `gsdd scaffold phase <N> [name]` | Create a new phase plan file |
| `gsdd models [show\|profile\|set\|...]` | Inspect and manage model profile propagation |
| `gsdd help` | Show all commands |

---

## Architecture

### Roles (9 canonical)

GSDD consolidates GSD's agent surface into 9 roles with durable contracts:

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
| **Debugger** | Utility role for systematic debugging |

### Two-Layer Architecture

- **Role contracts** (`agents/*.md`) — durable, contain the full behavioral specification
- **Delegates** (`distilled/templates/delegates/*.md`) — thin wrappers that reference roles and provide task-specific context

10 delegates: 4 mapper, 4 researcher, 1 synthesizer, 1 plan-checker. Workflows use `<delegate>` blocks to dispatch work. For detailed GSD-to-GSDD role distillation rationale, see [`agents/DISTILLATION.md`](agents/DISTILLATION.md).

### Adapter Architecture

GSDD generates vendor-specific files from vendor-agnostic markdown — it does not convert from one vendor format to another. This means every adapter gets first-class output shaped to its platform's native capabilities.

| Adapter | Kind | Strategy |
|---------|------|----------|
| **Claude Code** | `native_capable` | Skill-primary plan surface (stays in main context to spawn checker subagent), thin command alias, native `gsdd-plan-checker` agent |
| **OpenCode** | `native_capable` | Specialized `/gsdd-plan` command (`subtask: false`), hidden `gsdd-plan-checker` subagent (`mode: subagent`) |
| **Codex CLI** | `native_capable` | Portable skill as entry surface, `.codex/agents/gsdd-plan-checker.toml` (read-only, high reasoning effort) |
| **Cursor / Copilot / Gemini** | `governance_only` | Root `AGENTS.md` block governs agent behavior; invoke workflows by opening `.agents/skills/gsdd-*/SKILL.md` directly |

All adapters render the plan-checker from a single source (`distilled/templates/delegates/plan-checker.md`). Each adapter shapes the output to its platform's native mechanics, and the portable skill remains the shared workflow source.

Cursor, Copilot, and Gemini CLI generate the same root `AGENTS.md` governance block as `--tools agents`. They do not have native adapter surfaces — invoke workflows by opening `.agents/skills/gsdd-*/SKILL.md` directly.

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

GSDD does not impose commit formats, branch naming, or one-commit-per-task rules. Git guidance is advisory — repository and team conventions take precedence:

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
- OpenCode inherits its runtime model by default; GSDD only injects an exact OpenCode `model:` when you set an explicit runtime override.
- Codex inherits its session model by default; GSDD only injects an explicit `model` in the TOML when you set an explicit runtime override.

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
| Lost track of progress | Run `gsdd-progress` — reads artifacts, shows status |
| Need context from last session | Run `gsdd-resume` — restores state, routes to next action |
| Plans seem wrong | Check `workflow.research: true` in config |
| Execution produces stubs | Re-plan with smaller scope (2-5 tasks per plan) |
| Templates out of date | `npx gsdd update --templates` — warns before overwriting |
| Model costs too high | `gsdd models profile budget` + disable `workflow.planCheck` |

For detailed troubleshooting and recovery procedures, see the [User Guide](docs/USER-GUIDE.md#troubleshooting).

---

## Design Decisions

GSDD makes 27 documented design decisions relative to GSD, each with evidence from source files and external research. See [`distilled/DESIGN.md`](distilled/DESIGN.md) for the full rationale.

Key choices:
- **4-file codebase standard** — drop state that rots (STRUCTURE, INTEGRATIONS, TESTING), keep rules that don't
- **Agent consolidation** — 9 roles from GSD's 11, with explicit reduced-assurance mode when independent checking isn't available
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

GSDD has 862 structural assertions across 9 test files — 41 named suites that guard properties PRs repeatedly fixed manually. These are not unit tests for application code; they are invariant checks on the specification itself.

### Invariant Suites (I-series)

Structural contracts that prevent drift between roles, delegates, workflows, and artifacts:

| Suite | What it guards |
|-------|---------------|
| **I1** | Delegate-role reference integrity — 10 delegates resolve to existing role contracts |
| **I2** | Role section structure — 9 roles have role def, scope, output format, success criteria |
| **I3** | Delegate thinness — no leaked role-contract sections in delegates |
| **I3-gate** | New-project approval gates — required human checkpoints present |
| **I4** | Workflow references — 10 workflows, all delegate/role refs resolve |
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
npm run test:gsdd
```

---

## Relationship to GSD

GSDD is a distilled fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done). It is **not** a full replacement for current upstream GSD.

**What GSDD preserves** (~76% of core method): the long-horizon delivery spine — persistent artifacts, codebase mapping, scoped planning, execution, verification, and milestone auditing.

**What GSDD does not cover** (~44% of full upstream surface): GSD currently exposes 32 workflow files and 11 agent files including discovery modes, a settings flow, extra operator ergonomics, and broader session-management/control-plane surface area. GSDD intentionally does not recreate this full surface.

**The trade-off:** Fewer moving parts for the human operator. Cleaner role contracts and a simpler artifact model. But reduced operator comfort and limited control-plane features (no telemetry, no artifact linting). Health diagnostics are available via `gsdd health`.

---

## Credits

GSDD is a distilled fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), licensed under MIT.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
