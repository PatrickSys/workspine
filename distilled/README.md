# Workspine

A portable multi-runtime software delivery framework for long-horizon AI-assisted work.

Workspine gives long-horizon AI-assisted work a durable repo-native contract for planning, checking, execution, verification, and handoff. The retained package and CLI contracts remain `gsdd-cli` / `gsdd`.

## What This Is

Workspine is a small set of workflow sources plus a CLI (`gsdd`) that:
- scaffolds a project planning workspace (`.planning/`)
- generates portable workflow entrypoints as skills (`.agents/skills/gsdd-*/SKILL.md`)
- optionally generates tool-specific adapters for runtimes that need extra native surfaces (root `AGENTS.md`, Claude skills + plan-command alias + native agents, OpenCode commands + native agents)

It gives serious AI-assisted work one durable repo workflow spine for planning, checking, execution, verification, and handoff without pretending to be a hosted orchestration layer.

Workspine is the public product name for this milestone. The package, command, workflow names, and workspace stay `gsdd-cli`, `gsdd`, `gsdd-*`, and `.planning/` as retained technical contracts.

Workspine started by distilling ideas from Get Shit Done and earlier GSDD work because the long-horizon workflow spine was genuinely strong. This repo keeps that lineage explicit while taking a different path on purpose: lower token burn, fewer public workflow surfaces, less runtime-specific coupling, and a stronger multi-runtime posture.

Launch proof posture:
- Directly validated in repo truth: Claude Code, Codex CLI, OpenCode
- Qualified support only: Cursor, Copilot, Gemini CLI via the shared `.agents/skills/` surface plus optional governance
- Installed generated runtime surfaces are renderer-checked locally through `gsdd health`, with deterministic repair through `gsdd update`
- Public proof entrypoints: `docs/BROWNFIELD-PROOF.md`, `docs/proof/consumer-node-cli/README.md`, `docs/RUNTIME-SUPPORT.md`, `docs/VERIFICATION-DISCIPLINE.md`

## Quick Start

Run in your project root:
```bash
npx gsdd-cli init
```

In a TTY, `gsdd init` now opens a guided install wizard: choose runtimes first, then decide separately whether repo-wide `AGENTS.md` governance is worth installing.

Optional adapters:
```bash
npx gsdd-cli init --tools claude
npx gsdd-cli init --tools opencode
npx gsdd-cli init --tools codex
npx gsdd-cli init --tools agents
npx gsdd-cli init --tools cursor
npx gsdd-cli init --tools all
```

Notes:
- `gsdd init` always generates open-standard skills at `.agents/skills/gsdd-*`. This is also the primary Codex CLI surface.
- `--tools ...` remains the manual/headless path; legacy runtime aliases such as `cursor`, `copilot`, and `gemini` are still supported for backward compatibility.
- `--tools claude` also generates native agents at `.claude/agents/gsdd-*.md` and a compatibility plan command alias at `.claude/commands/gsdd-plan.md`.
- `--tools opencode` also generates native agents at `.opencode/agents/gsdd-*.md`.
- `--tools codex` generates `.codex/agents/gsdd-plan-checker.toml`; the portable `.agents/skills/gsdd-plan/` surface remains the Codex entry path.
- Root `AGENTS.md` is only written when explicitly requested (`--tools agents`, `--tools all`, legacy runtime aliases, or the wizard governance opt-in).

## The Workflow

```
gsdd init                  -> bootstrap (create .planning/, copy templates, generate skills/adapters)
/gsdd-new-project          -> .planning/SPEC.md + .planning/ROADMAP.md  (questioning + codebase audit + research)
/gsdd-plan N               -> phases/N/PLAN.md      (task breakdown + research)
/gsdd-execute N            -> code changes           (plan execution with quality gates)
/gsdd-verify N             -> VERIFICATION.md        (goal-backward validation)
  ... repeat plan/execute/verify per phase ...
/gsdd-audit-milestone      -> MILESTONE-AUDIT.md     (cross-phase integration + requirements coverage)
/gsdd-complete-milestone   -> milestones/vX.Y-*      (archive, evolve spec, collapse roadmap)
/gsdd-new-milestone        -> updated SPEC.md + ROADMAP.md  (next milestone goals + phases)
/gsdd-plan-milestone-gaps  -> gap closure phases in ROADMAP.md  (from audit results)
/gsdd-quick                -> .planning/quick/NNN/   (sub-hour task outside phases)
/gsdd-pause                -> .planning/.continue-here.md  (session checkpoint)
/gsdd-resume               -> restore context, route to next action
/gsdd-progress             -> show status, route to next action
```

## Brownfield Entry Contract

Use the same three-way routing everywhere:

- `gsdd-new-project` is the full initializer for greenfield work, fuzzy brownfield scope, or milestone-shaped work. Users do not need to pre-run `map-codebase`; `new-project` does that internally when needed.
- `gsdd-quick` is the bounded brownfield lane when the change is already concrete. It uses existing codebase maps when present and otherwise builds a just-enough inline baseline.
- `gsdd-map-codebase` is the deeper orientation pass for unfamiliar or higher-risk repos before choosing between `quick` and `new-project`.

## Current Status (updated 2026-04-17)

| Workflow | Status | Notes |
|----------|--------|-------|
| `new-project.md` | [OK] Defined, source-audited | Covers greenfield + brownfield + milestone context |
| `plan.md` | [OK] Defined, source-audited | Portable workflow defines the planner contract and supports independent plan checking through generated native adapters |
| `execute.md` | [OK] Source-audited | Mandatory read enforcement, auth-gate routing, deviation-rule examples, and substantive summary quality gate |
| `verify.md` | [OK] Source-audited | 5 gap closures against hardened verifier role contract: grouped-gap guidance, orphan detection, frontmatter enforcement, verification basis emphasis, requirements coverage chain |
| `audit-milestone.md` | [OK] Defined, source-audited | Aggregates phase verification, cross-phase integration audit, auth protection checks, requirement reconciliation, and orphan detection into `MILESTONE-AUDIT.md` |
| `complete-milestone.md` | [OK] Defined | Archives milestone, evolves SPEC.md, collapses ROADMAP.md — no gsd-tools.cjs dependency |
| `new-milestone.md` | [OK] Defined | Brownfield milestone continuation: goals, SPEC.md requirements, ROADMAP.md phases |
| `plan-milestone-gaps.md` | [OK] Defined (unvalidated) | Gap closure phases from MILESTONE-AUDIT.md results |
| `quick.md` | [OK] | Quick-work lane for sub-hour tasks outside the phase cycle, including bounded brownfield inline baseline and escalation (D11, D47) |
| `pause.md` | [OK] Source-audited | Session checkpoint writer with conversational handoff (D12) |
| `resume.md` | [OK] Source-audited | Session context restorer with priority-ordered routing (D12) |
| `progress.md` | [OK] Source-audited | Read-only status reporter with 6 named route branches, recent work, archived-milestone detection, and non-phase brownfield-state routing (D12, D46, D47) |
| `map-codebase.md` | [OK] Defined, source-audited | Standalone codebase mapping/refresh and deeper brownfield orientation |
| `verify-work.md` | [OK] Defined | Conversational UAT validation with structured gap tracking |

Architecture notes:
- `bin/gsdd.mjs` remains the thin generator entrypoint, while vendor-specific rendering lives in adapter modules.
- Codex CLI uses the always-generated `.agents/skills/gsdd-*` surface as its entry path and can add a native `.codex/agents/gsdd-plan-checker.toml` checker agent.
- `gsdd health` now compares any installed generated runtime surfaces against current render output and routes repairs back through `gsdd update`.
- Portable lifecycle contracts now align to the roadmap template status grammar: `[ ]`, `[-]`, `[x]`.
- Phase verification and milestone integration audit are treated as separate concerns.
- Canonical role contracts use bounded sections, typed output examples, and checklist-driven completion where those structures materially improve downstream reliability.
- Public launch wording is conservative by design: direct proof is claimed only for runtimes with recorded lifecycle evidence in `.planning/research/09-RESEARCH.md`.

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
  gsdd-new-milestone/SKILL.md
  gsdd-plan/SKILL.md
  gsdd-plan-milestone-gaps/SKILL.md
  gsdd-execute/SKILL.md
  gsdd-verify/SKILL.md
  gsdd-verify-work/SKILL.md
  gsdd-audit-milestone/SKILL.md
  gsdd-complete-milestone/SKILL.md
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
  DESIGN.md                # design decisions and rationale (51 decisions, evidence-backed)
  EVIDENCE-INDEX.md        # source-to-decision index for durable research-backed claims
  SKILL.md                 # primary entry point (plain markdown)
  workflows/
    audit-milestone.md
    complete-milestone.md
    execute.md
    map-codebase.md
    new-project.md
    new-milestone.md
    pause.md
    plan.md
    plan-milestone-gaps.md
    progress.md
    quick.md
    resume.md
    verify-work.md
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
