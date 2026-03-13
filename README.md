<div align="center">

# GSD Distilled

**A portable, spec-driven development kernel for AI coding agents.**

Extracted from [Get Shit Done](https://github.com/gsd-build/get-shit-done). Same long-horizon delivery spine — fewer moving parts.

[![npm version](https://img.shields.io/npm/v/gsdd?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

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
- **Scoped planning** — research, backward planning, plan-checking with XML task schemas
- **Execution** — wave-based parallel execution with fresh context per plan
- **Verification** — Exists/Substantive/Wired gate, anti-pattern scan
- **Milestone audit** — cross-phase integration, requirements coverage, E2E flows

What it strips: GSD's broader operator surface (35 workflows, 12 agents, discovery modes, sprint ceremony, resume/progress/settings flows). GSDD has 7 workflows and 9 roles.

**Target user:** Developer or small team that wants a spec-driven long-horizon kernel, not full operator comfort.

---

## Getting Started

```bash
npx gsdd init
```

This creates:

1. `.planning/` — durable workspace with templates, role contracts, and config
2. `.agents/skills/gsdd-*` — portable workflow entrypoints (primary Codex CLI surface)
3. Tool-specific adapters if detected (Claude skills/commands/agents, OpenCode commands/agents)

Then run the new-project workflow via your tool's skill/command surface to produce `.planning/SPEC.md` and `.planning/ROADMAP.md`.

### Platform Adapters

GSDD generates adapters for whichever tools you use:

```bash
npx gsdd init                    # Auto-detect installed tools
npx gsdd init --tools claude     # Claude Code: .claude/skills + commands + agents
npx gsdd init --tools opencode   # OpenCode: .opencode/commands + agents
npx gsdd init --tools agents     # Root AGENTS.md (Cursor, Copilot, Gemini)
npx gsdd init --tools all        # All of the above
```

| Platform | Kind | What's generated |
|----------|------|-----------------|
| **All** (default) | Open standard | `.agents/skills/gsdd-*/SKILL.md` — portable workflow entrypoints |
| **Claude Code** | Native | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` |
| **OpenCode** | Native | `.opencode/commands/`, `.opencode/agents/` |
| **Codex CLI** | Skills-first | Uses `.agents/skills/` directly, no extra files |
| **Cursor / Copilot / Gemini** | Governance | Bounded block in root `AGENTS.md` |

### Updating

```bash
npx gsdd update                  # Regenerate adapters from latest sources
npx gsdd update --tools claude   # Update specific platform only
```

---

## How It Works

### The Core Loop

```
init → [plan → execute → verify] × N phases → audit-milestone → done
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
3. **Checks** — verifies plans against requirements (if `workflow.planCheck` is enabled)

Each plan is small enough to execute in a fresh context window.

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

```
gsdd-quick
```

For sub-hour tasks that don't need the full phase cycle:

- **Same roles** — planner + executor, conditional verifier
- **Skips research** — no researcher, no synthesizer
- **Separate tracking** — lives in `.planning/quick/`, logged in `LOG.md`
- **Advisory git** — follows repo conventions, no framework-imposed commit format

Use for: bug fixes, small features, config changes, one-off tasks.

**Creates:** `.planning/quick/NNN-slug/PLAN.md`, `SUMMARY.md`, updates `LOG.md`

---

## Workflows

GSDD has 7 workflows, run via generated skills or adapters:

| Workflow | What it does |
|----------|--------------|
| `gsdd-new-project` | Full initialization: questioning, codebase audit, research, spec, roadmap |
| `gsdd-map-codebase` | Map existing codebase with 4 parallel mappers |
| `gsdd-plan` | Research + plan + check for a phase |
| `gsdd-execute` | Execute phase plan: implement tasks, verify changes |
| `gsdd-verify` | Verify completed phase: 3-level checks, anti-pattern scan |
| `gsdd-audit-milestone` | Audit milestone: cross-phase integration, requirements coverage, E2E flows |
| `gsdd-quick` | Quick task: plan and execute sub-hour work outside the phase cycle |

## CLI Commands

| Command | What it does |
|---------|--------------|
| `gsdd init [--tools <platform>]` | Set up `.planning/`, generate adapters |
| `gsdd update [--tools <platform>]` | Regenerate adapters from latest sources |
| `gsdd find-phase [N]` | Show phase info as JSON (for agent consumption) |
| `gsdd verify <N>` | Run artifact checks for phase N |
| `gsdd scaffold phase <N> [name]` | Create a new phase plan file |
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

10 delegates: 4 mapper, 4 researcher, 1 synthesizer, 1 plan-checker. Workflows use `<delegate>` blocks to dispatch work.

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

### Advisory Git Protocol

GSDD does not impose commit formats, branch naming, or one-commit-per-task rules. Git guidance is advisory — repository and team conventions take precedence:

- **Branching** — follow existing repo conventions
- **Commits** — group changes logically, no framework-imposed format
- **PRs** — follow existing repo review workflow

Defaults configurable in `.planning/config.json` under `gitProtocol`.

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
| `modelProfile` | `balanced`, `quality`, `budget` | `balanced` | AI model tier for agents |

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

## Design Decisions

GSDD makes 11 documented design decisions relative to GSD, each with evidence from source files and external research. See [`distilled/DESIGN.md`](distilled/DESIGN.md) for the full rationale.

Key choices:
- **4-file codebase standard** — drop state that rots (STRUCTURE, INTEGRATIONS, TESTING), keep rules that don't
- **Agent consolidation** — 9 roles from GSD's 12, with explicit reduced-assurance mode when independent checking isn't available
- **Adapter generation over conversion** — generate vendor-specific files from vendor-agnostic markdown instead of converting from Claude-first
- **Advisory git** — repo conventions over framework defaults
- **Context isolation** — summaries up, documents to disk

---

## Invariant Tests

GSDD includes 202 structural assertions that guard properties PRs repeatedly fixed manually:

- **I1:** Delegate-role reference integrity (10 delegates resolve to existing roles)
- **I2:** Role section structure (9 roles have role def, scope, output format, success criteria)
- **I3:** Delegate thinness (no leaked role-contract sections in delegates)
- **I4:** Workflow references (7 workflows, all delegate/role refs resolve)
- **I9:** No deprecated content (no vendor paths, dropped files, legacy tooling)
- **I10:** Mandatory initial-read enforcement on hardened lifecycle roles

```bash
npm run test:gsdd
```

---

## Relationship to GSD

GSDD is a distilled fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done). It is **not** a full replacement for current upstream GSD.

**What GSDD preserves** (~76% of core method): the long-horizon delivery spine — persistent artifacts, codebase mapping, scoped planning, execution, verification, and milestone auditing.

**What GSDD does not cover** (~46% of full upstream surface): GSD currently exposes 35 workflow files and 12 agent files including discovery modes, progress/resume/settings flows, operator ergonomics, and session management. GSDD intentionally does not recreate this surface.

**The trade-off:** Fewer moving parts for the human operator. Cleaner role contracts and a simpler artifact model. But reduced operator comfort and no control-plane features (telemetry, artifact linting, session continuity).

---

## Credits

GSDD is a distilled fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), licensed under MIT.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
