# GSD Distilled — Lightweight Spec-Driven Development

A lightweight SDD (Spec-Driven Development) framework for AI-assisted development. Think before you code, verify after you code.

> Distilled from [GSD (Get Shit Done)](https://github.com/glittercowboy/get-shit-done) — same discipline, less ceremony.

## What This Is

GSD Distilled takes the best ideas from the GSD framework (spec-driven development, atomic commits, multi-agent orchestration, research-before-building) and strips away everything that doesn't carry its weight.

| | Original GSD | GSD Distilled |
|--|--|--|
| **Commands** | 31 slash commands | 4 workflow files |
| **Documents** | 4+ files (PROJECT, REQUIREMENTS, STATE, ROADMAP) | 2 files (SPEC, ROADMAP) |
| **Instructions** | 800KB+ across 90+ files | <800 lines across 10 files |
| **Runtime** | Node.js CLI tools | None — just markdown |
| **Installation** | `npx` + file copy | `npx gsdd init` or copy `AGENTS.md` |
| **Workflow** | discuss → plan → execute → verify → complete | plan → execute → verify |

## The Workflow

```
init → [plan → execute → verify] × N → done
```

1. **Init** — Audit existing code, define what we're building, research the domain, create a roadmap
2. **Plan** — Clarify approach and create an implementation plan for one phase
3. **Execute** — Implement tasks with atomic commits
4. **Verify** — Check success criteria, report pass/fail

## Quick Start

### For AI Agents

**Recommended:** Use the CLI to auto-generate adapters for your platform:
```bash
npx gsdd init              # Auto-detect platform
npx gsdd init --tools claude  # Generate Claude Code skills
npx gsdd init --tools all  # Generate all adapters
```

**Claude Code**: Generates dedicated skills at `.claude/skills/gsdd-*/`.

**Codex / Cursor / Copilot / Gemini**: Generates `AGENTS.md` at project root (read natively by 20+ tools).

**Any other agent**: The workflow files are plain markdown — any AI agent that can read files can follow them.

### For Developers

1. Run `npx gsdd init` in your project root
2. Start with: "Init a new project using the SDD workflow"
3. Your agent reads the generated adapter files and follows GSDD governance

## Core Principles

1. **Spec first** — Never write code without defining "done"
2. **Atomic commits** — Each task = one commit
3. **Verify everything** — Check success criteria, don't just "ship it"
4. **Research when unsure** — Prevents using stale patterns or wrong libraries
5. **Branch per feature** — Work safely, merge when verified

## Project Structure (what gets created)

```
.planning/
├── SPEC.md              # Single source of truth
├── ROADMAP.md           # Phases with success criteria
├── research/            # Optional domain research
│   ├── STACK.md
│   ├── ARCHITECTURE.md
│   └── PITFALLS.md
└── phases/
    └── {N}-PLAN.md      # Implementation plan per phase
```

## Files in This Framework

```
distilled/
├── SKILL.md                     # Main entry point for AI agents
├── README.md                    # This file
├── workflows/
│   ├── init.md                  # Start a project/milestone
│   ├── plan.md                  # Plan a phase
│   ├── execute.md               # Execute a plan
│   └── verify.md                # Verify completed work
└── templates/
    ├── spec.md                  # SPEC.md template
    ├── roadmap.md               # ROADMAP.md template
    ├── agents.md                # AGENTS.md template (for generated adapters)
    └── research/
        ├── stack.md             # Tech stack research
        ├── features.md          # Feature landscape (table stakes / differentiators)
        ├── architecture.md      # Architecture research
        └── pitfalls.md          # Pitfalls research
```

## Credits

Distilled from the [GSD framework](https://github.com/glittercowboy/get-shit-done) by TÂCHES. The original GSD framework is a powerful, full-featured meta-prompting system — check it out if you need the full experience.

## License

MIT — see [LICENSE](../LICENSE).
