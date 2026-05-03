# Workspine

A repo-native delivery spine for planning, checking, execution, verification, and handoff of long-horizon AI-assisted work.

Workspine keeps planning, execution, verification, handoff, and progress state in the repo so work survives cold starts, runtime switches, and session loss. The retained package and CLI contracts remain `gsdd-cli` / `gsdd`.

## What This Is

Workspine is a small set of workflow sources plus a CLI (`gsdd`) that:
- scaffolds a project planning workspace (`.planning/`)
- generates compact open-standard workflow entrypoints as skills (`.agents/skills/gsdd-*/SKILL.md`)
- generates an internal repo-local helper runtime at `.planning/bin/gsdd.mjs` for deterministic workflow commands run from the repo root
- optionally generates tool-specific adapters for runtimes that need extra native surfaces (root `AGENTS.md`, Claude skills + plan-command alias + native agents, OpenCode commands + native agents, Codex CLI checker agent)

It gives serious AI-assisted work one durable repo workflow spine for planning, checking, execution, verification, and handoff without pretending to be a hosted orchestration layer.

Workspine is the product name. The package, CLI commands, workflow prefixes, and workspace directory remain `gsdd-cli`, `gsdd`, `gsdd-*`, and `.planning/` — these are retained technical contracts, not rename residue.

Workspine began as a fork of Get Shit Done, whose long-horizon delivery spine proved the problem was real. Since the fork, upstream GSD has continued evolving into a broad multi-runtime framework. Workspine took a different path: a smaller repo-native delivery spine with fewer public workflow surfaces, generated runtime surfaces from a portable core, evidence-gated closure, and provenance-aware continuity.

Launch proof posture:
- Directly validated in repo truth: Claude Code, Codex CLI, OpenCode
- Qualified support only: Cursor, Copilot, Gemini CLI can use the shared `.agents/skills/` surface plus optional governance when their skill or slash discovery sees it; proof and ergonomics differ from the directly validated runtimes
- Codex CLI validation does not automatically cover Codex VS Code or the Codex app; use native discovery there when available, otherwise open or paste `.agents/skills/gsdd-*/SKILL.md`
- Installed generated runtime surfaces are renderer-checked locally through `npx -y gsdd-cli health`, with deterministic repair through `npx -y gsdd-cli update` (bare `gsdd ...` is equivalent only when globally installed)
- Public proof entrypoints: `docs/BROWNFIELD-PROOF.md`, `docs/proof/consumer-node-cli/README.md`, `docs/RUNTIME-SUPPORT.md`, `docs/VERIFICATION-DISCIPLINE.md`

## Quick Start

Run in your project root:
```bash
npx -y gsdd-cli init
```

In a TTY, `npx -y gsdd-cli init` opens a guided install wizard: choose runtimes first, then decide separately whether repo-wide `AGENTS.md` governance is worth installing. If `gsdd-cli` is globally installed, `gsdd init` is the equivalent shorthand.

Optional adapters:
```bash
npx -y gsdd-cli init --tools claude
npx -y gsdd-cli init --tools opencode
npx -y gsdd-cli init --tools codex
npx -y gsdd-cli init --tools agents
npx -y gsdd-cli init --tools cursor
npx -y gsdd-cli init --tools all
```

Notes:
- `npx -y gsdd-cli init` always generates open-standard skills at `.agents/skills/gsdd-*` plus the repo-local helper runtime at `.planning/bin/gsdd.mjs`. Workflow helper commands assume the repo root as the current working directory.
- `--tools ...` remains the manual/headless path; legacy runtime aliases such as `cursor`, `copilot`, and `gemini` are still supported for backward compatibility.
- `--tools claude` also generates native agents at `.claude/agents/gsdd-*.md` and a compatibility plan command alias at `.claude/commands/gsdd-plan.md`.
- `--tools opencode` also generates native agents at `.opencode/agents/gsdd-*.md`.
- `--tools codex` generates `.codex/agents/gsdd-plan-checker.toml`; the portable `.agents/skills/gsdd-plan/` surface remains the Codex entry path and internal helper commands route through `.planning/bin/gsdd.mjs`.
- Root `AGENTS.md` is only written when explicitly requested (`--tools agents`, `--tools all`, legacy runtime aliases, or the wizard governance opt-in). Governance and native adapter surfaces are optional ergonomics; the compact `.agents/skills/` files remain the baseline agent entrypoints.

## The Workflow

```
npx -y gsdd-cli init       -> bootstrap (create .planning/, copy templates, generate skills/adapters)
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

## Workflow Surface

| Workflow | What ships |
|----------|------------|
| `new-project.md` | Greenfield + brownfield + milestone initialization |
| `plan.md` | Portable planner contract with independent plan checking through generated native adapters |
| `execute.md` | Mandatory reads, auth-gate routing, deviation rules, and substantive summary quality gate |
| `verify.md` | Phase verification with orphan detection, frontmatter enforcement, and requirements coverage chain |
| `audit-milestone.md` | Cross-phase integration audit, auth protection checks, requirement reconciliation, and orphan detection into `MILESTONE-AUDIT.md` |
| `complete-milestone.md` | Milestone archive, spec evolution, and roadmap collapse |
| `new-milestone.md` | Brownfield milestone continuation: goals, requirements, and roadmap phases |
| `plan-milestone-gaps.md` | Gap-closure phases from `MILESTONE-AUDIT.md` results |
| `quick.md` | Quick-work lane for sub-hour tasks outside the phase cycle |
| `pause.md` | Session checkpoint writer with conversational handoff |
| `resume.md` | Session context restorer with priority-ordered routing |
| `progress.md` | Read-only status reporter with recent work, archived-milestone detection, and non-phase brownfield routing |
| `map-codebase.md` | Standalone codebase mapping/refresh and deeper brownfield orientation |
| `verify-work.md` | Conversational UAT validation with structured gap tracking |

Architecture notes:
- `bin/gsdd.mjs` remains the thin generator entrypoint, while vendor-specific rendering lives in adapter modules.
- Codex CLI uses the always-generated `.agents/skills/gsdd-*` surface as its entry path, relies on `.planning/bin/gsdd.mjs` for deterministic helper calls, and can add a native `.codex/agents/gsdd-plan-checker.toml` checker agent.
- Codex VS Code/app are separate surfaces from Codex CLI; do not claim the CLI proof for them unless they expose compatible skill discovery. Fallback is opening or pasting the generated `SKILL.md`.
- `npx -y gsdd-cli health` now compares any installed generated runtime surfaces against current render output and routes repairs back through `npx -y gsdd-cli update`.
- Portable lifecycle contracts now align to the roadmap template status grammar: `[ ]`, `[-]`, `[x]`.
- Phase verification and milestone integration audit are treated as separate concerns.
- Canonical role contracts use bounded sections, typed output examples, and checklist-driven completion where those structures materially improve downstream reliability.
- Public launch wording is conservative by design: direct proof is claimed only for runtimes with recorded lifecycle evidence in the repo.

## Init Workflow Agent Use (by config)

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
  DESIGN.md                # design decisions and rationale
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
    delegates/             # delegate instruction files (copied to .planning/templates/delegates/)
      mapper-tech.md
      mapper-arch.md
      mapper-quality.md
      mapper-concerns.md
      plan-checker.md
      approach-explorer.md
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
    research-agentic/
      prompt-decomposition.json
      scratchpad.md
    codebase/
      stack.md
      architecture.md
      conventions.md
      concerns.md
```
