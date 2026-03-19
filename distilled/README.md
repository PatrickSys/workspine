# GSDD (Get Shit Done Distilled)

Lightweight Spec-Driven Development (SDD) for AI-assisted engineering.

Distilled from GSD (Get Shit Done): keep rigor and leverage, drop ceremony.

## What This Is

GSDD is a small set of workflow sources plus a CLI (`gsdd`) that:
- scaffolds a project planning workspace (`.planning/`)
- generates portable workflow entrypoints as skills (`.agents/skills/gsdd-*/SKILL.md`)
- optionally generates tool-specific adapters for runtimes that need extra native surfaces (root `AGENTS.md`, Claude skills + plan-command alias + native agents, OpenCode commands + native agents)

## Quick Start

Run in your project root:
```bash
npx gsdd init
```

Optional adapters:
```bash
npx gsdd init --tools claude
npx gsdd init --tools opencode
npx gsdd init --tools codex
npx gsdd init --tools agents
npx gsdd init --tools all
```

Notes:
- `gsdd init` always generates open-standard skills at `.agents/skills/gsdd-*`. This is also the primary Codex CLI surface.
- `--tools claude` also generates native agents at `.claude/agents/gsdd-*.md` and a compatibility plan command alias at `.claude/commands/gsdd-plan.md`.
- `--tools opencode` also generates native agents at `.opencode/agents/gsdd-*.md`.
- `--tools codex` generates `.codex/agents/gsdd-plan-checker.toml`; the portable `.agents/skills/gsdd-plan/` surface remains the Codex entry path.
- Root `AGENTS.md` is only written when explicitly requested (`--tools agents` or `--tools all`).

## The Workflow

```
gsdd init           -> bootstrap (create .planning/, copy templates, generate skills/adapters)
/gsdd:new-project   -> .planning/SPEC.md + .planning/ROADMAP.md  (questioning + codebase audit + research)
/gsdd:plan N        -> phases/N/PLAN.md      (task breakdown + research)
/gsdd:execute N     -> code changes          (plan execution with quality gates)
/gsdd:verify N      -> VERIFICATION.md       (goal-backward validation)
  ... repeat plan/execute/verify per phase ...
/gsdd:quick         -> .planning/quick/NNN/  (sub-hour task outside phases)
/gsdd:pause         -> .planning/.continue-here.md  (session checkpoint)
/gsdd:resume        -> restore context, route to next action
/gsdd:progress      -> show status, route to next action
```

## Current Status (updated 2026-03-18)

| Workflow | Status | Notes |
|----------|--------|-------|
| `new-project.md` | [OK] Defined, source-audited | Covers greenfield + brownfield + milestone context |
| `plan.md` | [OK] Defined, source-audited | Portable workflow defines the planner contract and supports independent plan checking through generated native adapters |
| `execute.md` | [OK] Source-audited | Mandatory read enforcement, auth-gate routing, deviation-rule examples, and substantive summary quality gate |
| `verify.md` | [OK] Source-audited | 5 gap closures against hardened verifier role contract: grouped-gap guidance, orphan detection, frontmatter enforcement, verification basis emphasis, requirements coverage chain |
| `audit-milestone.md` | [OK] Defined, source-audited | Aggregates phase verification, cross-phase integration audit, auth protection checks, requirement reconciliation, and orphan detection into `MILESTONE-AUDIT.md` |
| `quick.md` | [OK] | Quick-work lane for sub-hour tasks outside the phase cycle (D11) |
| `pause.md` | [OK] Source-audited | Session checkpoint writer with conversational handoff (D12) |
| `resume.md` | [OK] Source-audited | Session context restorer with priority-ordered routing (D12) |
| `progress.md` | [OK] Source-audited | Read-only status reporter with 6 named route branches, recent work, between-milestones detection (D12) |
| `map-codebase.md` | [OK] Defined, source-audited | Standalone codebase mapping/refresh |

Architecture notes:
- `bin/gsdd.mjs` remains the thin generator entrypoint, while vendor-specific rendering lives in adapter modules.
- Codex CLI uses the always-generated `.agents/skills/gsdd-*` surface as its entry path and can add a native `.codex/agents/gsdd-plan-checker.toml` checker agent.
- Portable lifecycle contracts now align to the roadmap template status grammar: `[ ]`, `[-]`, `[x]`.
- Phase verification and milestone integration audit are treated as separate concerns.
- Canonical role contracts use bounded sections, typed output examples, and checklist-driven completion where those structures materially improve downstream reliability.

## Init Workflow Agent Count (by config)

| Mode | Mappers | Researchers | Synthesizer | Total |
|------|---------|-------------|-------------|-------|
| Brownfield, first run, research balanced/deep | 4 | 4 | 1 | 9 |
| Brownfield, first run, research fast | 4 | 4 | 0 (inline) | 8 |
| Brownfield, subsequent run, research balanced/deep | 0 (maps exist) | 4 | 1 | 5 |
| Greenfield, research balanced/deep | 0 | 4 | 1 | 5 |
| Greenfield, research fast | 0 | 4 | 0 (inline) | 4 |
| Any, no research | 0-4 | 0 | 0 | 0-4 |

Note: `parallelization: false` keeps the same mapper/researcher set but runs them sequentially.

## What Gets Created (Project Output)

```
.planning/
  SPEC.md
  ROADMAP.md
  config.json
  templates/           # copied from distilled/templates/
  phases/              # phase plans and summaries
  research/            # optional research outputs
.agents/skills/
  gsdd-new-project/SKILL.md
  gsdd-plan/SKILL.md
  gsdd-execute/SKILL.md
  gsdd-verify/SKILL.md
  gsdd-audit-milestone/SKILL.md
  gsdd-quick/SKILL.md
  gsdd-pause/SKILL.md
  gsdd-resume/SKILL.md
  gsdd-progress/SKILL.md
  gsdd-map-codebase/SKILL.md
.claude/agents/
  gsdd-plan-checker.md      # native-capable checker agent generated from the active plan-checker contract
.claude/commands/
  gsdd-plan.md              # compatibility alias to the Claude skill-primary plan entry
.claude/skills/
  gsdd-plan/SKILL.md        # Claude-native skill-primary planner -> checker surface
.opencode/agents/
  gsdd-plan-checker.md      # native-capable checker agent generated from the active plan-checker contract
.opencode/commands/
  gsdd-plan.md              # OpenCode-native specialized planner -> checker command surface
.codex/agents/
  gsdd-plan-checker.toml    # Codex-native checker agent (read-only, high reasoning effort)
.planning/
  quick/              # quick task directories and LOG.md
  .continue-here.md   # session checkpoint (created by pause)
```

## Files In This Framework

```
distilled/
  DESIGN.md                # design decisions and rationale (20 decisions, evidence-backed)
  SKILL.md                 # primary entry point (plain markdown)
  workflows/
    new-project.md
    map-codebase.md
    plan.md
    progress.md
    execute.md
    verify.md
    audit-milestone.md
    quick.md
    pause.md
    resume.md
  templates/
    spec.md
    roadmap.md
    agents.md              # full AGENTS.md template (for tool adapters)
    agents.block.md        # bounded block payload for root AGENTS.md insertion
    delegates/               # delegate instruction files (copied to .planning/templates/delegates/)
      mapper-tech.md
      mapper-arch.md
      mapper-quality.md
      mapper-concerns.md
      plan-checker.md
      researcher-stack.md
      researcher-features.md
      researcher-architecture.md
      researcher-pitfalls.md
      researcher-synthesizer.md
    research/
      stack.md
      features.md
      architecture.md
      pitfalls.md
      summary.md
    codebase/
      stack.md
      architecture.md
      conventions.md
      concerns.md
```
