# GSDD (Get Shit Done Distilled)

Lightweight Spec-Driven Development (SDD) for AI-assisted engineering.

Distilled from GSD (Get Shit Done): keep rigor and leverage, drop ceremony.

## What This Is

GSDD is a small set of workflow sources plus a CLI (`gsdd`) that:
- scaffolds a project planning workspace (`.planning/`)
- generates portable workflow entrypoints as skills (`.agents/skills/gsdd-*/SKILL.md`)
- optionally generates tool-specific adapters (Codex `.codex/AGENTS.md`, root `AGENTS.md`, Claude skills + plan-command alias + native agents, OpenCode commands + native agents)

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
- `gsdd init` always generates open-standard skills at `.agents/skills/gsdd-*`.
- `--tools claude` also generates native agents at `.claude/agents/gsdd-*.md` and a compatibility plan command alias at `.claude/commands/gsdd-plan.md`.
- `--tools opencode` also generates native agents at `.opencode/agents/gsdd-*.md`.
- Root `AGENTS.md` is only written when explicitly requested (`--tools agents` or `--tools all`).

## The Workflow

```
gsdd init           -> bootstrap (create .planning/, copy templates, generate skills/adapters)
/gsdd:new-project   -> SPEC.md + ROADMAP.md  (questioning + codebase audit + research)
/gsdd:plan N        -> phases/N/PLAN.md      (task breakdown + research)
/gsdd:execute N     -> code changes          (plan execution with quality gates)
/gsdd:verify N      -> VERIFICATION.md       (goal-backward validation)
  ... repeat plan/execute/verify per phase ...
/gsdd:complete      -> archive milestone, evolve SPEC.md
/gsdd:milestone     -> new ROADMAP.md for next milestone
```

## Current Status (updated 2026-03-08)

| Workflow | Status | Notes |
|----------|--------|-------|
| `new-project.md` | [OK] Defined, source-audited | Covers greenfield + brownfield + milestone context |
| `plan.md` | [WARN] Stub - not audited | Portable workflow remains a stub; Claude now has a skill-primary native `/gsdd-plan` surface plus checker agent and OpenCode now has a specialized `/gsdd-plan` command, but I17 stays open because Claude only has partial live validation and OpenCode runtime parity is not yet proven |
| `execute.md` | [WARN] Stub - not audited | Audit against `get-shit-done/workflows/execute-phase.md` |
| `verify.md` | [WARN] Stub - not audited | Audit against `get-shit-done/workflows/verify-phase.md` |

Standalone codebase remapping is planned for a later PR. For the current init surface, refresh stale codebase maps by deleting `.planning/codebase/*.md` and rerunning `/gsdd:new-project`.

Architecture note: `bin/gsdd.mjs` remains the thin generator entrypoint, while vendor-specific rendering now lives in adapter modules. This cleanup does not change the current I17 status.

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
.claude/agents/
  gsdd-plan-checker.md      # native-capable draft checker payload source for future I17 wiring
.claude/commands/
  gsdd-plan.md              # compatibility alias to the Claude skill-primary plan entry
.claude/skills/
  gsdd-plan/SKILL.md        # Claude-native skill-primary planner -> checker surface
.opencode/agents/
  gsdd-plan-checker.md      # native-capable draft checker payload source for future I17 wiring
.opencode/commands/
  gsdd-plan.md              # OpenCode-native specialized planner -> checker command surface
```

## Files In This Framework

```
distilled/
  DESIGN.md                # design decisions and rationale (10 decisions, evidence-backed)
  SKILL.md                 # primary entry point (plain markdown)
  workflows/
    new-project.md
    plan.md
    execute.md
    verify.md
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
