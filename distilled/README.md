# Workspine

Workspine is a harness for AI coding agents. It runs a spec-driven loop around your agent (plan, execute, verify) and every step lands as a file in the repo, so the next session or a different tool can pick the work back up.

Plans, execution records, verification, handoff notes, and progress state all live in the repo. For a session boundary, explicitly write a checkpoint with `gsdd-pause`, then read it back with `gsdd next --json`; no background compaction or automatic context transfer is implied.

## Why It Matters

AI coding agents make code cheaper to produce. They do not make architecture, scope control, review, security, or release confidence disappear. In practice, they move more of the work into deciding what should happen, checking whether it happened, and preserving enough context for the next session or runtime to continue safely.

Workspine is built for that pressure. There are two ways in, and both land in the same loop:

```
quick        -> plan -> execute -> verify
new-project  -> plan -> execute -> verify
```

`gsdd-quick` takes a bounded change with no spec or roadmap. `gsdd-new-project` writes a spec and phases when the work is fuzzy or milestone-shaped. Either way, the plan is a reviewed contract before implementation starts. Execution is a separate step. Verification records what passed, what failed, and what still needs human judgment.

## When To Use It

Use Workspine when a change spans multiple files, sessions, agents, or runtimes; when architecture, data, security, or release confidence matter; or when proof needs to live in the repo instead of only in a chat transcript.

Skip the full lifecycle for tiny, obvious edits. Direct prompting in your usual coding agent is cheaper for low-risk work. Workspine is for the work where guessing gets expensive.

## What This Is

Workspine is a small set of workflow sources plus a CLI (`gsdd`) that:
- scaffolds a project planning workspace (`.work/`)
- generates compact open-standard workflow entrypoints as skills (`.agents/skills/gsdd-*/SKILL.md`)
- generates an internal repo-local helper runtime at `.work/bin/gsdd.mjs` for deterministic workflow commands run from the repo root
- optionally generates tool-specific adapters for runtimes that need extra native surfaces (root `AGENTS.md`, Claude skills + plan-command alias + native agents, OpenCode commands + native agents, Codex CLI checker agent)

It gives serious AI-assisted work one durable, repo-native workflow for planning, checking, execution, verification, and handoff — plain files, no hosted service.

The command is `gsdd`, the npm package is `gsdd-cli`, the workflows are `gsdd-*`, and the workspace is `.work/`. Workspine kept those names so existing installs keep working; legacy `.planning/` workspaces are still read.

Workspine began as a fork of Get Shit Done, whose long-horizon workflow proved the problem was real. Since the fork, upstream GSD has continued evolving into a broad multi-runtime framework. Workspine took a different path: a smaller repo-native tool with fewer public workflows, generated runtime surfaces from a portable core, proof required before closing work, and decisions that keep their why.

Proof:
- One recorded end-to-end run backs the Codex CLI path
- Claude Code and OpenCode get native surfaces generated from the same portable core and freshness-checked locally, with no end-to-end run of theirs recorded here
- Cursor, Copilot or Gemini CLI can read the same `.agents/skills/` surface plus optional governance when their skill or slash discovery sees it, but no run of theirs is recorded here; proof and ergonomics differ from the recorded path above
- Codex CLI validation does not automatically cover Codex VS Code or the Codex app; use native discovery there when available, otherwise open or paste `.agents/skills/gsdd-*/SKILL.md`
- Repo-local generated runtime surfaces are renderer-checked through `npx -y gsdd-cli health`, with deterministic repair through `npx -y gsdd-cli update` (bare `gsdd ...` is equivalent only when globally installed)
- Public proof entrypoints: `docs/BROWNFIELD-PROOF.md`, `docs/proof/consumer-node-cli/README.md`, `docs/RUNTIME-SUPPORT.md`, `docs/VERIFICATION-DISCIPLINE.md`

## Quick Start

Run in your project root:
```bash
npx -y gsdd-cli init
```

In a TTY, `npx -y gsdd-cli init` opens a guided install wizard: choose runtimes first, then decide separately whether repo-wide `AGENTS.md` governance is worth installing. If `gsdd-cli` is globally installed, `gsdd init` is the equivalent shorthand.

For personal cross-repo availability, run:

```bash
npx -y gsdd-cli install --global
npx -y gsdd-cli install --global --tools claude,opencode,codex,copilot
```

Global install writes selected Workspine skills and native agent surfaces into user-level agent homes. It does not create `.work/` in the current repo.

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
- `npx -y gsdd-cli init` always generates open-standard skills at `.agents/skills/gsdd-*` plus the repo-local helper runtime at `.work/bin/gsdd.mjs`. Workflow helper commands assume the repo root as the current working directory.
- `--tools ...` remains the manual/headless path; legacy runtime aliases such as `cursor`, `copilot`, and `gemini` are still supported for backward compatibility.
- `--tools claude` also generates native agents at `.claude/agents/gsdd-*.md` and a compatibility plan command alias at `.claude/commands/gsdd-plan.md`.
- `--tools opencode` also generates native agents at `.opencode/agents/gsdd-*.md`.
- `--tools codex` generates `.codex/agents/gsdd-plan-checker.toml`; the portable `.agents/skills/gsdd-plan/` surface remains the Codex entry path and internal helper commands route through `.work/bin/gsdd.mjs`.
- Root `AGENTS.md` is only written when explicitly requested (`--tools agents`, `--tools all`, legacy runtime aliases, or the wizard governance opt-in). Governance and native adapter surfaces are optional ergonomics; the compact `.agents/skills/` files remain the baseline agent entrypoints.

## The Workflow

```
npx -y gsdd-cli init       -> bootstrap (create .work/, copy templates, generate skills/adapters)
/gsdd-new-project          -> .work/SPEC.md + .work/ROADMAP.md  (questioning + codebase audit + research)
/gsdd-plan N               -> phases/N/PLAN.md      (task breakdown + research)
/gsdd-execute N            -> code changes           (plan execution with quality gates)
/gsdd-verify N             -> VERIFICATION.md        (goal-backward validation)
  ... repeat plan/execute/verify per phase ...
/gsdd-audit-milestone      -> MILESTONE-AUDIT.md     (cross-phase integration + requirements coverage)
/gsdd-complete-milestone   -> milestones/vX.Y-*      (archive, evolve spec, collapse roadmap)
/gsdd-new-milestone        -> updated SPEC.md + ROADMAP.md  (next milestone goals + phases)
/gsdd-plan                 -> amend/extend gap closure phases in ROADMAP.md  (from audit results)
/gsdd-quick                -> .work/quick/NNN/   (sub-hour task outside phases)
/gsdd-pause                -> .work/.continue-here.md  (session checkpoint)
/gsdd-resume               -> restore context, route to next action
/gsdd-progress             -> show status, route to next action
```

The main operator spine is four workflow moves after bootstrap: `new-project -> plan -> execute -> verify`. The other public workflow surfaces are support lanes for milestone closeout, quick work, progress, pause/resume, and brownfield orientation.

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
| `plan.md` amend/extend mode | Gap-closure phases from `MILESTONE-AUDIT.md`, verification gaps, tech debt, brownfield amendments, or incident docs |
| `quick.md` | Quick-work lane for sub-hour tasks outside the phase cycle |
| `pause.md` | Session checkpoint writer with conversational handoff |
| `resume.md` | Session context restorer with priority-ordered routing |
| `progress.md` | Read-only status reporter with recent work, archived-milestone detection, and non-phase brownfield routing |
| `map-codebase.md` | Standalone codebase mapping/refresh and deeper brownfield orientation |
| `verify-work.md` | Conversational UAT validation with structured gap tracking |

Architecture notes:
- `bin/gsdd.mjs` remains the thin generator entrypoint, while vendor-specific rendering lives in adapter modules.
- Codex CLI uses the always-generated `.agents/skills/gsdd-*` surface as its entry path, relies on `.work/bin/gsdd.mjs` for deterministic helper calls, and can add a native `.codex/agents/gsdd-plan-checker.toml` checker agent.
- Repo/worktree status helpers compute from git and local workflow state first; local annotations are intent hints only and cannot create ownership, cleanup, or lifecycle authority.
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
.work/
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
.work/
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
    progress.md
    quick.md
    resume.md
    verify-work.md
    verify.md
  templates/
    spec.md
    roadmap.md
    agents.md              # full AGENTS.md template (for tool adapters)
    agents.block.md        # managed payload for root AGENTS.md insertion
    delegates/             # delegate instruction files (copied to .work/templates/delegates/)
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
    codebase/
      stack.md
      architecture.md
      conventions.md
      concerns.md
```
