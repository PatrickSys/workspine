# Changelog

All notable changes to GSDD will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

For the upstream GSD changelog, see [get-shit-done/CHANGELOG.md](https://github.com/gsd-build/get-shit-done/blob/main/CHANGELOG.md).

## [0.1.0] - 2026-03-19

Initial public release. 35 merged PRs, 862 structural assertions, 28 design decisions.

### Added

**Core Framework**
- 9 canonical role contracts distilled from GSD's 11 (mapper, researcher, synthesizer, planner, executor, verifier, roadmapper, integration-checker, debugger)
- 10 delegate instructions (4 mapper, 4 researcher, 1 synthesizer, 1 plan-checker) with two-layer architecture separating durable role contracts from thin task-specific wrappers
- 10 workflows: new-project, map-codebase, plan, execute, verify, audit-milestone, quick, pause, resume, progress
- Living specification model (SPEC.md replaces GSD's separate PROJECT.md + REQUIREMENTS.md)
- Phased delivery plan with inline status (ROADMAP.md replaces STATE.md)
- 4-file codebase standard (STACK, ARCHITECTURE, CONVENTIONS, CONCERNS) — drops state that rots
- Advisory git protocol — repo conventions take precedence over framework defaults
- Context isolation — delegates write documents to disk and return summaries, orchestrators never accumulate full content

**Plan Checking**
- Fresh-context adversarial plan checking — checker runs in separate context from planner to avoid inherited blind spots (validated by Huang et al. ICLR 2024)
- 7-dimension evaluation schema: requirement coverage, task completeness, dependency correctness, key-link completeness, scope sanity, must-have quality, context compliance
- Max-3 cycle loop — plan → check → revise, escalates to human after cycle 3 (matches SELF-REFINE NeurIPS 2023 sweet spot)
- Typed JSON checker output for machine-parseable orchestration
- Reduced-assurance fallback when platform cannot spawn independent checker

**Adapter System**
- Adapter generation architecture — vendor-specific files generated from vendor-agnostic markdown, no lossy conversion between formats
- Claude Code native adapter: skill-primary plan surface (works around subagent nesting constraint), thin command alias, native plan-checker agent
- OpenCode native adapter: specialized command (`subtask: false`), hidden subagent (`mode: subagent`)
- Codex CLI native adapter: portable skill as entry surface, `.codex/agents/gsdd-plan-checker.toml` (read-only sandbox, high reasoning effort)
- Governance adapters: bounded block in root AGENTS.md for Cursor, Copilot, and Gemini CLI without overwriting existing AGENTS.md content
- Single-source plan-checker rendering — all three native adapters render from `distilled/templates/delegates/plan-checker.md`

**Model Control**
- Semantic model profiles (`quality`/`balanced`/`budget`) with per-runtime translation
- Per-agent profile overrides (`agentModelProfiles.<agent>`)
- Per-runtime model overrides (`runtimeModelOverrides.<runtime>.<agent>`) for Claude, OpenCode, and Codex
- Two-layer model ID injection prevention: regex whitelist at CLI boundary + format-specific escaping at adapter layer
- CLI: `gsdd models show|profile|agent-profile|set|clear|clear-agent-profile`

**CLI**
- `gsdd init` with auto-detection, `--tools` platform selection, `--auto`/`--brief` headless mode
- `gsdd update` with `--templates` flag for role contract and delegate refresh
- Template versioning via SHA-256 generation manifest — detects user modifications before overwriting
- `gsdd find-phase`, `gsdd verify`, `gsdd scaffold phase`
- Composition root boundary — `bin/gsdd.mjs` is a 100-line facade delegating to extracted modules

**Testing**
- 862 structural assertions across 9 test files, 0 failures
- 13 invariant suites (I-series): delegate-role integrity, role structure, delegate thinness, workflow references, session management, artifact schemas, plan-checker dimensions, vendor API cleanliness, deprecation guards, initial-read enforcement
- 20 guard suites (G-series): cross-document schema consistency, file size bounds, XML well-formedness, artifact lifecycle chain, DESIGN.md registry, auto-mode contract, generation manifest, CLI module boundary, Codex doc contract, documentation accuracy, models pre-init safety, health module contract, OWASP authorization matrix, distillation ledger, mapper output quantification, consumer governance completeness, consumer first-run accuracy, session continuity contracts, consumer surface completeness
- 5 scenario suites (S-series): greenfield golden path, brownfield path, quick-task path, native runtime chain, config-to-content propagation
- Functional test suites: init/update, model propagation, generation manifest, plan adapter surfaces, audit-milestone, health diagnostics

**Documentation**
- 27 evidence-backed design decisions in `distilled/DESIGN.md` (D1-D27), each citing GSD source files and external research
- Role contract README with canonical role inventory
- Distillation ledger (`agents/DISTILLATION.md`) documenting GSD-to-GSDD role distillation rationale
