# Canonical Role Library

Vendor-agnostic role contracts for GSDD's agent architecture.

## Two-Layer Architecture

| Layer | Location | Purpose |
|-------|----------|---------|
| **Roles** (this directory) | `agents/*.md` | Durable contracts: identity, inputs, outputs, algorithm, guarantees |
| **Delegates** | `distilled/templates/delegates/*.md` | Task-specific wrappers: scoped instructions that reference a role |

Roles define WHAT an agent IS. Delegates define WHAT an agent DOES in a specific workflow context.

## Lifecycle Roles

| Role | File | Absorbs From (GSD) |
|------|------|---------------------|
| Mapper | `mapper.md` | `gsd-codebase-mapper.md` |
| Researcher | `researcher.md` | `gsd-project-researcher.md` + `gsd-phase-researcher.md` |
| Synthesizer | `synthesizer.md` | `gsd-research-synthesizer.md` |
| Planner | `planner.md` | `gsd-planner.md` + `gsd-plan-checker.md` |
| Executor | `executor.md` | `gsd-executor.md` |
| Verifier | `verifier.md` | `gsd-verifier.md` + `gsd-integration-checker.md` |
| Roadmapper | `roadmapper.md` | `gsd-roadmapper.md` |

## Utility Roles

| Role | File | Note |
|------|------|------|
| Debugger | `debugger.md` | Not part of core lifecycle. Standalone diagnostic utility. |

## Archive

`_archive/` contains the original 11 GSD agent files (preserved via `git mv` for history). These are the verbose, GSD-specific sources from which canonical roles were distilled. Do not reference them in workflows -- use the canonical roles above.
