# Canonical Role Library

Vendor-agnostic role contracts for GSDD's agent architecture.

## Two-Layer Architecture

| Layer | Location | Purpose |
|-------|----------|---------|
| **Roles** (this directory) | `agents/*.md` | Durable contracts: identity, inputs, outputs, algorithm, guarantees |
| **Delegates** | `distilled/templates/delegates/*.md` | Task-specific wrappers: scoped instructions that reference a role |

Roles define what an agent is. Delegates define what an agent does in a specific workflow context.

## Lifecycle Roles

| Role | File | Absorbs From (GSD) |
|------|------|---------------------|
| Mapper | `mapper.md` | `gsd-codebase-mapper.md` |
| Researcher | `researcher.md` | `gsd-project-researcher.md` + `gsd-phase-researcher.md` |
| Synthesizer | `synthesizer.md` | `gsd-research-synthesizer.md` |
| Planner | `planner.md` | `gsd-planner.md` + `gsd-plan-checker.md` |
| Executor | `executor.md` | `gsd-executor.md` |
| Verifier | `verifier.md` | `gsd-verifier.md` |
| Roadmapper | `roadmapper.md` | `gsd-roadmapper.md` |

## Utility Roles

| Role | File | Note |
|------|------|------|
| Debugger | `debugger.md` | Not part of core lifecycle. Standalone diagnostic utility. |

## Runtime Distribution

`gsdd init` copies all role contracts (excluding this README) from `agents/` into `.planning/templates/roles/` in the consumer project. This gives consumer projects a portable, self-contained copy of the role library with no hard dependency on the GSDD framework repo at runtime.

- **Single source of truth:** `agents/*.md` in this repo. Consumer copies are generated, not edited.
- **Delegates reference the local copy:** `distilled/templates/delegates/*.md` point to `.planning/templates/roles/<role>.md`, not back to this repo.
- **Idempotent:** `gsdd init` skips the copy if `.planning/templates/roles/` already exists.
- **Future updates:** `gsdd update --templates` (planned) will re-copy from latest framework sources.

Verifier note:
- `verifier.md` is phase-scoped.
- A separate milestone integration-audit surface is still deferred; it is not absorbed into the verifier contract.

## Archive

`_archive/` contains the original 11 GSD agent files (preserved via `git mv` for history). These are the verbose, GSD-specific sources from which canonical roles were distilled. Do not reference them in workflows; use the canonical roles above.
