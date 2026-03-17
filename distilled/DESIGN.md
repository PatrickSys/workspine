# GSDD Design Decisions

> Rationale for every structural choice GSDD makes relative to GSD.
> Each decision cites GSD source files, GSDD implementation, and external research.
> Updated as decisions are revised or new ones land.

---

## Table of Contents

1. [4-File Codebase Standard](#1-4-file-codebase-standard)
2. [Agent Consolidation: 11 to 9](#2-agent-consolidation-11-to-9)
3. [Two-Layer Architecture: Roles and Delegates](#3-two-layer-architecture-roles-and-delegates)
4. [Zero-Hop Security Propagation](#4-zero-hop-security-propagation)
5. [Conditional Synthesizer](#5-conditional-synthesizer)
6. [Mapper Staleness: Standalone Workflow](#6-mapper-staleness-standalone-workflow)
7. [Milestone Hierarchy and Phase Continuation](#7-milestone-hierarchy-and-phase-continuation)
8. [Advisory Git Protocol](#8-advisory-git-protocol)
9. [Adapter Generation Over Conversion](#9-adapter-generation-over-conversion)
10. [Context Isolation: Summaries Up, Documents to Disk](#10-context-isolation-summaries-up-documents-to-disk)
11. [Quick-Work Lane](#11-quick-work-lane)
12. [Session Persistence Without State File](#12-session-persistence-without-state-file)
13. [Mechanical Invariant Enforcement](#13-mechanical-invariant-enforcement)
14. [Headless Mode](#14-headless-mode)
15. [Model Profile Propagation](#15-model-profile-propagation)
16. [Template Versioning via Generation Manifest](#16-template-versioning-via-generation-manifest)
17. [CLI Composition Root Boundary](#17-cli-composition-root-boundary)
18. [Codex CLI Native Adapter](#18-codex-cli-native-adapter)

---

## 1. 4-File Codebase Standard

**GSD:** 7 static files during codebase mapping -- STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md, STRUCTURE.md, INTEGRATIONS.md, TESTING.md.

**GSDD:** 4 files -- STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md.

**What was dropped and where the rules went:**

| Dropped file    | Absorbed into                                                 | Rationale                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STRUCTURE.md    | CONVENTIONS.md ("Where to put new code")                      | Physical directory maps break the moment a folder is added. Stale structure causes agent hallucination. Modern agents use dynamic tools (tree-sitter, codebase indexing) to view current structure. |
| INTEGRATIONS.md | STACK.md + CONVENTIONS.md                                     | Database schemas and endpoint maps change daily. Agents should read definitive `schema.prisma` or `init.sql` dynamically, not trust a stale markdown summary.                                       |
| TESTING.md      | CONVENTIONS.md ("How to mock the database", testing patterns) | Testing conventions are stable rules; test inventories are not. Rules belong in CONVENTIONS.md.                                                                                                     |

**Core principle:** Drop the _state_ (which rots), keep the _rules_ (which don't). Maximum architectural discipline without feeding stale topologies into limited context windows.

**Evidence:**

- GSD source: `agents/_archive/gsd-codebase-mapper.md` lines 72-79 (original 7-file model)
- GSDD implementation: `agents/mapper.md` input/output contracts (4 files only)
- External: LeanSpec "Context Economy" principle; Aider tree-sitter dynamic repomaps (2026 SOTA)
- `.planning/SPEC.md` "Lean Context Decision" section

---

## 2. Agent Consolidation: 11 to 9

**GSD:** 11 specialized agent files, each scoped to a single concern.

**GSDD:** 9 canonical roles. 3 mergers and 1 extraction.

**Merger table:**

| Canonical role           | Absorbs from GSD                                        | Merger criteria                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration-checker.md` | `gsd-integration-checker.md`                            | Cross-phase integration checking is structurally different from single-phase verification: different inputs (all phase SUMMARYs/VERIFICATIONs vs single phase), different scope (milestone-wide wiring vs phase goal), different algorithm (connectivity checks vs goal-backward). Extracted as standalone role rather than absorbed into verifier.                                                                         |
| `researcher.md`          | `gsd-project-researcher.md` + `gsd-phase-researcher.md` | Same algorithm, different scope. Scope is an input parameter, not a role distinction. Clean merger.                                                                                                                                                                                                                                                                                                                         |
| `planner.md`             | `gsd-planner.md` + `gsd-plan-checker.md`                | Reduces coordination overhead. **Tradeoff:** GSD's plan-checker was a fresh-context adversarial pass with a 3-cycle revision loop (planner -> checker -> revise x 3 max). GSDD keeps an explicit `plan-checker` contract, generates native planner/checker entry surfaces where runtimes can support the loop directly, and describes reduced-assurance fallback in the portable workflow when no independent checker runs. |
| `verifier.md`            | `gsd-verifier.md`                                       | Phase-level goal-backward verification remains the verifier's scope. Cross-phase integration audit remains a separate milestone surface rather than being silently absorbed. GSDD keeps the compact verification-report base fields and also preserves richer structured verifier findings where they materially improve re-verification and gap closure.                                                                   |

**Known tradeoffs in mergers:**

The researcher merger is clean - scope is genuinely a parameter. The planner and verifier mergers each carry a real cost:

- **Planner:** External verification by a fresh-context agent catches blind spots the author cannot catch in self-review. GSDD restores that concept with a canonical `plan-checker` delegate, native planner/checker entry surfaces for Claude/OpenCode, and a portable workflow that describes reduced-assurance fallback when no independent checker runs. Verify quality checks now live inside `task_completeness`, so the planner/checker contract enforces runnable, fast, and ordered verification.
- **Adapter boundary:** `bin/gsdd.mjs` now stays the thin generator entrypoint and adapter dispatcher, while vendor-specific rendering lives under `bin/adapters/`. This is an architecture cleanup, not proof of runtime parity by itself.
- **Verifier:** The integration-checker's cross-phase wiring scope (orphaned exports, unconsumed API routes, broken E2E flows) is structurally different from single-phase goal-backward verification. GSDD keeps `verifier.md` phase-scoped and implements milestone integration audit as a separate surface: `distilled/workflows/audit-milestone.md` with `integration-checker.md`.
- **Verifier output contract:** Upstream GSD exposes two relevant shapes: the slim `verification-report.md` template with base fields (`phase`, `verified`, `status`, `score`) and the richer `gsd-verifier.md` output example with structured `re_verification`, `gaps`, and `human_verification`. GSDD keeps the richer phase-verifier structure intentionally, but labels it as normalized verifier behavior rather than pretending every field came from the slimmer template alone.

**Integration-checker second-pass recovery (2026-03-12):**

The first extraction of `integration-checker.md` preserved the milestone scope and core algorithm, but over-stripped execution leverage. The recovery pass keeps the portable role framework-neutral while restoring the upstream scaffolding that materially improves compliance:

- **Kept from GSD:** mandatory initial-read discipline, explicit section boundaries, auth-protection verification, end-to-end flow tracing, typed structured return, and checklist-driven completion.
- **Intentionally stripped:** framework-specific Bash recipes, hardcoded path assumptions, file-extension-specific grep flags, and other tool/runtime details that do not survive vendor-agnostic distillation well.
- **Gained in GSDD:** a cleaner split between role contract and milestone workflow, a stronger explicit phase-vs-milestone boundary, and a portable typed report shape aligned to the milestone auditor's current schema.

**Systemic role-contract hardening follow-up (2026-03-12):**

The same over-distillation pattern had also flattened `roadmapper.md`, `synthesizer.md`, `verifier.md`, and `planner.md`. The first recovery pass restored visible structure, but the follow-up audit found that structure alone was not enough. The current hardening pass restores the stricter mechanics that materially improve compliance while continuing to strip vendor/tool specifics.

- **Roadmapper kept from GSD:** mandatory initial-read discipline, bounded section structure, explicit coverage validation, parse-critical artifact contract, structured return modes, and checklist-driven completion.
- **Roadmapper intentionally stripped:** template-path references, commit steps, and vendor-specific file conventions.
- **Roadmapper gained in GSDD:** an explicit `.planning/ROADMAP.md` ownership contract, explicit `[ ]` / `[-]` / `[x]` status grammar, a concrete `ROADMAP CREATED` artifact example, and a hard boundary that this role does not settle the separate ROADMAP/STATE lifecycle seam.

- **Synthesizer kept from GSD:** mandatory initial-read discipline, deterministic research-input contract, execution-flow structure, output-format block, structured returns, blocked return shape, provenance via `Sources`, and completion checklist.
- **Synthesizer intentionally stripped:** commit behavior, template paths, and literal shell snippets.
- **Synthesizer gained in GSDD:** cleaner alignment with conditional invocation by `researchDepth` rather than implying it always runs, plus an explicit scope boundary that keeps research, roadmap authoring, and git ownership separate.

- **Verifier kept from GSD:** mandatory initial-read discipline, explicit must-have derivation steps, named L1/L2/L3 checks, truth-level status taxonomy, explicit key-link categories, typed report example, machine-usable structured gaps, structured return, and completion checklist.
- **Verifier intentionally stripped:** GSD tool invocations, literal grep/bash procedures, and commit steps.
- **Verifier gained in GSDD:** a portable verification-basis discovery protocol, grouped-gap guidance, a dedicated `<structured_returns>` contract for orchestrator handoff, and a stricter frontmatter-only machine-readable findings contract that now lines up directly with the current normalized `VERIFICATION.md` schema and the separate milestone-audit boundary.

- **Planner kept from GSD:** mandatory initial-read discipline, bounded section structure, context-fidelity rules, TDD detection heuristic, automated-verify discipline, test-scaffold-first rule when verification is missing, explicit output block, structured planning return, and completion checklist.
- **Planner intentionally stripped:** `user_setup`, vendor runtime/tool instructions, commit steps, and GSD-specific validation commands.
- **Planner gained in GSDD:** recovered strictness without regressing the current GSDD schema (`files-modified`, `checkpoint:user`, `checkpoint:review`, `2-5` tasks max, reduced-assurance checker fallback), plus portable gap-closure semantics and a concrete dependency-graph / wave example. Full `type: tdd` lifecycle support remains later research, not part of this recovery.

**Executor leverage audit (2026-03-13):**

The executor was the last un-audited core lifecycle role. At 89 lines it was the most under-structured role contract in the system — no XML section boundaries, no mandatory initial read, no scope boundary, no typed output example, no auth-gate protocol, no completion checklist. The audit applied the same S12 hardening pattern.

- **Executor kept from GSD:** mandatory initial-read discipline, explicit deviation-rule examples (null pointers, missing auth, missing dependency, new DB tables), auth-gate protocol (401/403 recognition, checkpoint return with exact auth steps), substantive summary quality gate, TDD RED/GREEN/REFACTOR steps with infrastructure detection, self-check discipline, and completion checklist.
- **Executor intentionally stripped:** wave-based parallelization, agent tracking journal, segment execution patterns A/B/C, auto-mode checkpoint routing (`auto_advance` config), per-task commit format `{type}({phase}-{plan}):`, `gsd-tools.cjs` CLI commands, template path references (`~/.claude/`), `user_setup` generation, `executor_model` selection, and codebase-map sync with dropped files (`STRUCTURE.md`, `INTEGRATIONS.md`).
- **Executor gained in GSDD:** XML-bounded section structure, explicit scope boundary (plan-scoped, does not own planning/verification/milestone audit), typed SUMMARY.md output example with YAML frontmatter, portable auth-gate protocol (checkpoint:user with exact steps, not vendor-specific checkpoint return format), and execution-loop alignment with the current GSDD plan schema (`checkpoint:user`, `checkpoint:review`, change-impact discipline).

The accompanying workflow alignment pass on `distilled/workflows/execute.md` added four targeted changes: mandatory read enforcement upgrade, auth-gate routing in the checkpoint protocol, concrete deviation-rule examples matching the role contract, and a substantive summary quality gate.

This hardening pass also clarified a reusable architectural rule: strict portable workflows are not enough if the canonical role contracts underneath them are flattened into prose. Role strictness and workflow strictness both matter.

**Research-claim narrowing from `agentic-prd-sota.md`:**

- **Keep:** density over brevity, no arbitrary line caps, bounded role contracts, deterministic inputs, and typed/machine-usable handoffs when another agent consumes the result.
- **Narrow:** the nested-data benchmark is relevant to output schema choices, not to whether XML-style prompt sections should exist. Prompt delimiters and machine-readable output formats are different problems.
- **Reject as universal claim:** "YAML is better than markdown" is too broad. The defensible rule is narrower: use constrained machine-readable structure when downstream agents must parse and aggregate findings.
- **Keep scoped:** OWASP auth guidance remains decisive for the milestone integration/audit surface, not for these four role contracts.

**Direct distillations (1:1 source lineage):**

| Canonical role   | GSD source                                                         | Audit status                    |
| ---------------- | ------------------------------------------------------------------ | ------------------------------- |
| `mapper.md`      | `gsd-codebase-mapper.md`                                           | source-audited                  |
| `synthesizer.md` | `gsd-research-synthesizer.md`                                      | source-audited (S12)            |
| `executor.md`    | `gsd-executor.md`                                                  | source-audited (executor audit) |
| `roadmapper.md`  | `gsd-roadmapper.md`                                                | source-audited (S12)            |
| `debugger.md`    | `gsd-debugger.md` (standalone utility, not part of core lifecycle) | —                               |

**Evidence:**

- GSD originals preserved in `agents/_archive/` (11 files, git history intact via `git mv`)
- GSDD canonicals in `agents/` (9 files + README.md)
- `agents/README.md` lifecycle table maps each canonical role to its GSD sources

---

## 3. Two-Layer Architecture: Roles and Delegates

**GSD:** Workflows embed role instructions inline. No separation between what an agent _is_ and what it _does_ in a given workflow. A single GSD workflow file (e.g., `new-project.md` at 851 lines) contains both orchestration logic and agent behavioral contracts.

**GSDD:** Two explicit layers.

| Layer     | Location                             | Purpose                                                                   | Example                                                                                               |
| --------- | ------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Roles     | `agents/*.md`                        | Durable contracts: identity, algorithm, quality guarantees, anti-patterns | `agents/mapper.md` -- defines the mapper's forbidden-files rule, output format, verification protocol |
| Delegates | `distilled/templates/delegates/*.md` | Thin task-specific wrappers: scoped instructions referencing a role       | `mapper-tech.md` -- tells the mapper to focus on tech stack, write to STACK.md                        |

**Why two layers:**

- Roles can be audited and improved independently of workflow wiring.
- Delegates can be rewired (point to different output paths, change scope) without touching role semantics.
- New workflows compose existing roles via new delegates without duplicating behavioral definitions.
- Security rules, quality gates, and algorithms are defined once in the role -- not scattered across delegates.

**Delegate thinness principle:** Delegates carry ONLY task-specific content (output path, focus area, return format, quality checklist). They do NOT contain algorithms, verification protocols, security rules, or anti-patterns -- those live in the role contract.

**Current delegates (10):**

| Delegate                     | Role        | Output                               | Workflow               |
| ---------------------------- | ----------- | ------------------------------------ | ---------------------- |
| `mapper-tech.md`             | mapper      | `.planning/codebase/STACK.md`        | map-codebase           |
| `mapper-arch.md`             | mapper      | `.planning/codebase/ARCHITECTURE.md` | map-codebase           |
| `mapper-quality.md`          | mapper      | `.planning/codebase/CONVENTIONS.md`  | map-codebase           |
| `mapper-concerns.md`         | mapper      | `.planning/codebase/CONCERNS.md`     | map-codebase           |
| `researcher-stack.md`        | researcher  | `.planning/research/STACK.md`        | new-project            |
| `researcher-features.md`     | researcher  | `.planning/research/FEATURES.md`     | new-project            |
| `researcher-architecture.md` | researcher  | `.planning/research/ARCHITECTURE.md` | new-project            |
| `researcher-pitfalls.md`     | researcher  | `.planning/research/PITFALLS.md`     | new-project            |
| `researcher-synthesizer.md`  | synthesizer | `.planning/research/SUMMARY.md`      | new-project            |
| `plan-checker.md`            | planner     | JSON checker report                  | plan (native adapters) |

**Distribution model:** `gsdd init` copies role contracts from `agents/` to `.planning/templates/roles/` in consumer projects. Delegates in `.planning/templates/delegates/` reference the local role copy (`Read .planning/templates/roles/<role>.md`). Consumer projects are self-contained at runtime -- no dependency on the framework repo.

**Evidence:**

- `agents/README.md` (Two-Layer Architecture and Runtime Distribution sections)
- `bin/gsdd.mjs` lines 84-102 (role copy step with existsSync guard)
- `tests/gsdd.init.test.cjs` (validates role file existence and delegate-role references)
- All 10 delegate files (each starts with a role contract reference on line 1)

---

## 4. Zero-Hop Security Propagation

**GSD:** Security rules for mapper agents lived in `gsd-codebase-mapper.md` (the agent file). Workflows like `map-codebase.md` contained a `<forbidden_files>` block. Agents needed to read both the workflow and their own role definition to get the full security picture -- a one-hop dependency.

**GSDD evolution (two phases):**

| Phase        | PR   | What changed                                                                                                                                    |
| ------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A (one-hop)  | PR 2 | Mapper delegates cross-referenced `<forbidden_files>` from the map-codebase skill. Security rules reachable but required reading a second file. |
| B (zero-hop) | PR 4 | Full 12-category forbidden-files list absorbed into `agents/mapper.md`. Delegates reference the role contract directly. No second file needed.  |

**The zero-hop rule:** Any rule that a delegate MUST follow belongs in the role contract it references, not in a cross-referenced workflow file that consumer projects may or may not have. When a delegate reads its role contract, it gets the complete behavioral and security contract in one read.

**Forbidden-files categories in `agents/mapper.md`:**

1. `.env`, `.env.*`, `*.env`
2. `credentials.*`, `secrets.*`, `*secret*`, `*credential*`
3. `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`
4. `id_rsa*`, `id_ed25519*`, `id_dsa*`
5. `.npmrc`, `.pypirc`, `.netrc`
6. `config/secrets/*`, `.secrets/*`, `secrets/`
7. `*.keystore`, `*.truststore`
8. `serviceAccountKey.json`, `*-credentials.json`
9. `docker-compose*.yml` -- read for architecture; flag inline secrets under Hard stop
10. Gitignored files that appear to contain secrets
11. `node_modules/`, `vendor/`, `.git/`
12. Binary files, database files, media files

**Hard stop:** Before writing CONCERNS.md, grep for `API_KEY`, `SECRET`, `PASSWORD`, `PRIVATE_KEY`, `-----BEGIN`, `Authorization:`. If hardcoded secrets found: STOP immediately, report to orchestrator. Mapper output gets committed to git -- leaked secrets are a security incident.

**Evidence:**

- `agents/mapper.md` lines 66-90 (Forbidden Files section + Hard stop)
- `agents/_archive/gsd-codebase-mapper.md` lines 66-97 (original narrower rules)
- PR 2 intermediate state (one-hop via SKILL.md cross-reference)
- PR 4 final state (zero-hop, role contains all rules)
- `package.json` `files` array includes `agents/` (npm distribution fix)

---

## 5. Conditional Synthesizer

**GSD:** Always spawns `gsd-research-synthesizer` after 4 researchers complete. Synthesizer reads all 4 research files, writes SUMMARY.md. No option to skip.

**GSDD:** Conditional on `researchDepth` config:

| researchDepth | Synthesizer behavior                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`        | Orchestrator writes SUMMARY.md inline from the 4 x 3-5 sentence summaries it holds in context. No delegate spawned.                                                                               |
| `balanced`    | ResearchSynthesizer delegate spawned. Reads 4 full research files. Cross-references build order constraints, pitfall-to-phase mappings, feature-architecture conflicts that short summaries omit. |
| `deep`        | Same as balanced but researchers produce longer output (more material for synthesizer to cross-reference).                                                                                        |

**Why conditional:** The synthesizer's value is in cross-referencing specific data across research dimensions. When `researchDepth=fast`, researchers produce 3-5 sentence summaries only -- there's nothing substantive to cross-reference. Spawning a synthesizer to reformat 4 short paragraphs wastes a context window and an agent hop.

**Evidence:**

- GSD source: `get-shit-done/workflows/new-project.md` lines 708-729 (always-spawn synthesizer)
- GSDD: `distilled/templates/delegates/researcher-synthesizer.md` (active delegate, references `synthesizer.md`)
- `agents/synthesizer.md` canonical contract (cross-reference algorithm)
- Config contract: `.planning/config.json` `researchDepth` field

---

## 6. Mapper Staleness: Standalone Workflow

**GSD:** `map-codebase.md` was ALWAYS a standalone workflow, separate from `new-project.md`. It had built-in staleness detection with three user options: Refresh (delete + remap), Update (selective document refresh), Skip (use existing maps).

**GSDD:** Preserved exactly. Two integration points:

1. **On first brownfield init:** `new-project.md` detects source files, offers codebase mapping. If accepted, invokes `map-codebase` via the portable skill surface (`.agents/skills/gsdd-map-codebase/SKILL.md`).

2. **On subsequent runs:** If `.planning/codebase/` already exists, mappers are skipped during init. User runs `/gsdd:map-codebase` directly to trigger the Refresh/Update/Skip flow.

**Why standalone:** Codebase maps become stale after major refactors. Users need to refresh maps independently of project initialization. Embedding mapping inside init would force a full re-init to refresh maps.

**Agent count implications:**

| Scenario               | Mappers spawned                                   |
| ---------------------- | ------------------------------------------------- |
| Brownfield, first run  | 4 (one per focus area)                            |
| Brownfield, maps exist | 0 (skipped, user directed to standalone workflow) |
| Greenfield             | 0 (no codebase to map)                            |

**Evidence:**

- GSD source: `get-shit-done/workflows/map-codebase.md` lines 35-62 (staleness check with 3 options)
- GSD source: `get-shit-done/workflows/new-project.md` lines 61-80 (brownfield offer delegates to map-codebase)
- GSDD: `distilled/workflows/map-codebase.md` (standalone, re-runnable)
- GSDD: `distilled/workflows/new-project.md` (auto-invoke for brownfield via skill reference)

---

## 7. Milestone Hierarchy and Phase Continuation

**GSD:** Three project-state files -- PROJECT.md (project definition), REQUIREMENTS.md (scoped features), STATE.md (current phase/status). Milestones archived in MILESTONES.md. Phase numbering continues across milestones (v1.0 phases 1-5, v1.1 starts at phase 6).

**GSDD:** Merged to two files -- `.planning/SPEC.md` (combines PROJECT.md + REQUIREMENTS.md), `.planning/ROADMAP.md` (combines roadmap + inline status, replacing STATE.md). Same milestone semantics.

| GSD file        | GSDD equivalent                                  | What changed                                                                        |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| PROJECT.md      | `.planning/SPEC.md` (project definition section) | Merged -- no separate project definition file                                       |
| REQUIREMENTS.md | `.planning/SPEC.md` (requirements section)       | Merged -- requirements live alongside project context                               |
| STATE.md        | `.planning/ROADMAP.md` (inline status per phase) | Dropped as separate file -- checkbox status in `.planning/ROADMAP.md` is sufficient |
| ROADMAP.md      | `.planning/ROADMAP.md`                           | Simplified format -- checkboxes, no REQ-ID traceability tables                      |
| MILESTONES.md   | `.planning/milestones/` directory                | Archive of completed milestone roadmaps                                             |

**Preserved semantics:**

- `.planning/SPEC.md` = project lifetime (grows with validated requirements)
- `.planning/ROADMAP.md` = current milestone only (archived when milestone completes)
- Phase numbering continues across milestones
- Researchers receive `milestone_context: [subsequent]` on new milestones -- they focus on new features, not existing system

**Evidence:**

- GSD source: `get-shit-done/workflows/new-milestone.md` lines 101-173 (milestone-aware researchers), line 269 (phase numbering continuation)
- GSDD: `distilled/README.md` lifecycle diagram
- `.planning/SPEC.md` "Long-Term Lifecycle" section

---

## 8. Advisory Git Protocol

**GSD:** Embedded git naming conventions in workflows and executor agents. Phase/plan/task IDs appeared in commit messages. Executor's core algorithm ended each task with a commit step. TDD flow required commits at RED/GREEN steps.

**GSDD:** Git guidance is advisory. Repository and team conventions take precedence over framework defaults.

**What was removed:**

- Phase/plan/task ID formatting in commit messages
- Mandatory one-commit-per-task rule in executor algorithm
- Mandatory commits at TDD RED/GREEN steps in executor contract
- Phase-scoped branch naming in generated governance

**What was kept:**

- `gitProtocol` config key in `.planning/config.json` (stable, not renamed)
- Advisory guidance fields: `branch`, `commit`, `pr` (user fills in or accepts defaults)
- Defaults state: "Follow the existing repo or team convention"

**Why advisory:** GSDD targets diverse teams and repos. Imposing one-commit-per-task or phase-scoped branch names on a repo that uses squash-and-merge or trunk-based development creates friction without value. The framework provides structure for planning -- it should not dictate git workflow.

**Evidence:**

- GSD source: `agents/_archive/gsd-executor.md` (mandatory commit in algorithm, TDD flow)
- GSDD: `agents/executor.md` lines 57-64 (Git Guidance -- repo-native, advisory)
- PR 5 (merged as PR #7): removed rigid git naming from workflows, adapters, generated governance

---

## 9. Adapter Generation Over Conversion

**GSD:** Writes workflows for Claude Code first. `install.js` converts Claude-specific frontmatter (AskUserQuestion, Task(), SlashCommand(), `~/.claude/` paths) to OpenCode and Gemini formats. Conversion is lossy -- some Claude features have no equivalent.

**GSDD:** Core workflows are plain markdown. No vendor-specific APIs. Adapter files are generated from agent-agnostic source, not converted from a Claude-first original.

**GSD's vendor lock-in surface:**

| API                 | Call sites in GSD                | GSDD replacement                               |
| ------------------- | -------------------------------- | ---------------------------------------------- |
| `AskUserQuestion`   | 38+ (15 workflows + 14 commands) | Plain text: "Ask the user: ..."                |
| `Task()` subagent   | 35+ across 15 workflows          | `<delegate>` blocks with markdown instructions |
| `SlashCommand()`    | 4 call sites                     | Skill references or inline workflow steps      |
| `~/.claude/` paths  | 39+ files                        | Install-time paths via CLI                     |
| `gsd-tools.cjs` CLI | 28 workflow files                | `bin/gsdd.mjs` (simplified)                    |

**Adapter output per tool:**

| Tool                  | Generated surface                                                                                                                           | Trigger                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Any (portable)        | `.agents/skills/gsdd-*/SKILL.md`                                                                                                            | Always generated on `gsdd init`                                          |
| Claude Code           | `.claude/skills/gsdd-*/SKILL.md` + `.claude/commands/gsdd-plan.md` (compatibility alias for `plan`) + `.claude/agents/gsdd-plan-checker.md` | `--tools claude`                                                         |
| Codex CLI             | `.agents/skills/gsdd-*/SKILL.md`                                                                                                            | Always generated on `gsdd init`; no Codex-specific adapter file required |
| OpenCode              | `.opencode/commands/gsdd-*.md` + `.opencode/agents/gsdd-plan-checker.md`                                                                    | `--tools opencode`                                                       |
| Cursor/Copilot/Gemini | Root `AGENTS.md` (bounded block)                                                                                                            | `--tools agents`                                                         |

Codex is skills-first because the Codex CLI already supports repository skills directly. GSDD should not generate a `.codex/AGENTS.md` file just to simulate a native path that the runtime does not need. Runtime validation status belongs in the internal status docs, not in this design record.

**Why generation over conversion:** Converting from a vendor-specific source is lossy and brittle -- every new agent needs a new converter. Generating tool-specific files from vendor-agnostic markdown is lossless and scales linearly. Pattern validated by OpenSpec (24 AI tools, 48 contributors).

**Evidence:**

- GSD source: `bin/install.js` (converter with per-runtime conversion logic)
- GSD source: `get-shit-done/workflows/new-project.md` (851 lines, 10+ AskUserQuestion calls, 7 Task() calls)
- GSDD: `bin/gsdd.mjs` (thin CLI entrypoint and adapter dispatcher after the boundary cleanup)
- GSDD: `bin/adapters/*` (vendor-specific adapter generation and native prompt rendering after the boundary cleanup)
- GSDD: `distilled/templates/delegates/plan-checker.md` as the single payload source for native-capable checker-agent generation
- `.planning/SPEC.md` "Agent Integration Strategy" section
- AGENTS.md Linux Foundation standard: [agents.md](https://agents.md)
- OpenAI Codex CLI: natively reads repository Agent Skills from `.agents/skills/` (open `agents.md` standard); no `.codex/AGENTS.md` required

---

## 10. Context Isolation: Summaries Up, Documents to Disk

**GSD:** Subagents (researchers, mappers) write documents to `.planning/` directories. Orchestrator spawns agents via `Task()`, receives their return value. The pattern implicitly keeps large documents out of the orchestrator's context.

**GSDD:** Makes this explicit as a design rule.

**The rule:** Delegates write full documents to disk. They return 3-5 sentence summaries to the orchestrator. The orchestrator never receives document contents in its conversation context.

**Why this matters:**

- LLM context windows are finite. An orchestrator that receives 4 full research files (each 200+ lines) before writing `.planning/SPEC.md` will be context-starved for the spec-writing step.
- Disk is unlimited. Downstream agents (synthesizer, planner) read files directly when they need the full content.
- Summaries give the orchestrator enough signal to make routing decisions (skip synthesis? flag a blocker?) without consuming the context budget.

**Implementation:**

- Each delegate's instructions end with: "Return a 3-5 sentence summary of key findings. Do NOT return the full document contents."
- Output templates in `.planning/templates/research/` and `.planning/templates/codebase/` define the on-disk format.
- The synthesizer reads all 4 research files from disk -- it is the only agent that sees full research content.

**Evidence:**

- GSD source: `get-shit-done/workflows/new-project.md` lines 544-706 (4 researchers write to files, return summaries)
- GSDD: all 9 delegate files (return format instructions)
- GSDD: `agents/synthesizer.md` (reads full research files from disk)
- External: Anthropic Agent Teams (Feb 2026) -- "Shared State, Not Shared Context" using filesystem over context window
- External: AI21 Modular Intelligence (Feb 2026) -- orchestrator-based designs prevent context drift

---

## 11. Quick-Work Lane

**GSD:** `get-shit-done/workflows/quick.md` (454 lines). Two modes: default (plan + execute) and `--full` (adds plan-checking and verification). Tracks tasks in STATE.md. Uses `gsd-tools.cjs` CLI, `Task()` subagent API, `AskUserQuestion` API, and mandatory atomic commits per task.

**GSDD:** Single mode, ~120 lines. Conditional verifier via `config.json`, LOG.md tracking, advisory git, direct role references.

**What was kept:**

- `.planning/quick/NNN-slug/` directory structure with sequential numbering
- 1-3 task maximum for quick plans
- Separate tracking from phase work (quick tasks don't touch ROADMAP.md)
- Reuse of planner, executor, and verifier roles (no new roles or delegates)

**What was stripped:**

- `--full` flag duality (use the full phase cycle when you need plan-checking depth)
- `STATE.md` tracking (eliminated in D7; replaced with append-only LOG.md)
- `gsd-tools.cjs` CLI calls for init, commit, and slug generation
- `Task()` vendor API and `AskUserQuestion` API (replaced with portable `<delegate>` blocks)
- Mandatory atomic commits (replaced with advisory git per D8)
- Plan-checker loop for quick tasks (the full phase workflow handles this when needed)

**What was added:**

- Advisory git protocol (D8) — follows repo conventions, no framework-imposed commit format
- Context isolation (D10) — delegates write to disk, return summaries
- Conditional verifier toggle via `config.json` `workflow.verifier` setting
- `.planning/quick/LOG.md` — append-only table tracking all quick tasks with status

**No new delegates.** Quick workflow uses `<delegate>` blocks referencing existing role contracts directly (same pattern as `audit-milestone.md`). Delegate count stays at 10.

**Evidence:**

- GSD source: `get-shit-done/workflows/quick.md` (454 lines, two modes, STATE.md tracking)
- GSDD: `distilled/workflows/quick.md` (~120 lines, single mode, LOG.md tracking)
- D7 (milestone hierarchy): STATE.md replaced by ROADMAP.md inline status
- D8 (advisory git): repo conventions over framework defaults
- D10 (context isolation): summaries up, documents to disk

---

## 12. Session Persistence Without State File

**GSD:** 4 control-plane workflows — `pause-work.md` (123L), `resume-project.md` (307L), `progress.md` (382L), `health.md` (157L) = 969 lines. All depend on `STATE.md` for current position, `gsd-tools.cjs` for timestamps and init, and Claude-specific APIs (`Task()`, `AskUserQuestion`). Resume includes ASCII box UI, progress bars, interrupted-agent detection, and STATE.md reconstruction.

**GSDD:** 3 workflows — `pause.md` (~107L) + `resume.md` (~139L) + `progress.md` (~200L) = ~446 lines. All three now use named XML sections inside `<process>` (aligned with core workflow conventions) and explicit scope boundaries in `<role>`.

**What was kept from GSD:**

- Disk-based state detection (phase directories, checkpoint files, plan/summary presence)
- Conversational pause gathering (ask the user to fill gaps artifacts can't answer)
- `.continue-here.md` checkpoint file with structured sections
- Contextual resume routing (5 priority-ordered branches)
- Quick-resume shortcut ("continue"/"go" = skip options, execute primary action)

**What was stripped at D12 design time:**

- `progress.md` (382L) — initially assessed as subsumed by resume; re-added as separate workflow after audit (see amendment below)
- `health.md` (157L) — GSDD's simpler `.planning/` structure does not warrant a dedicated error taxonomy and repair workflow
- `STATE.md` loading and reconstruction — GSDD has no STATE.md (D7)
- `gsd-tools.cjs` CLI calls for timestamps, init resume, and commit
- Interrupted-agent detection (vendor-specific `Task()` API, `agent-history.json`)
- ASCII box UI and progress bars
- `CONTEXT.md` awareness (no discuss-phase workflow in GSDD)
- Todo tracking integration
- Session continuity STATE.md updates
- Mandatory WIP commit format

**What was added:**

- Project-scoped checkpoint (single known location `.planning/.continue-here.md` vs GSD's phase-scoped glob)
- Quick-task awareness (LOG.md incomplete entries detected by both pause and resume)
- Workflow-type frontmatter in checkpoint (`workflow`, `phase`, `timestamp`) for resume routing
- Checkpoint cleanup after successful resume routing
- Explicit routing to GSDD workflow names (`gsdd-execute`, `gsdd-plan`, etc.)

**Design principle:** Derive state from primary artifacts (ROADMAP.md checkboxes, phase directories, checkpoint file), not from secondary summary files that can drift. This extends D7's elimination of STATE.md.

**No new roles or delegates.** Pause, resume, and progress are orchestrator-level workflows (read files, present status, route). Same pattern as `audit-milestone.md`. Delegate count stays at 10.

**Progress amendment (2026-03-14):**

The initial D12 assessment — that resume subsumes progress — turned out to be incomplete. An external audit (2026-03-13) explicitly listed `progress` as a required control-plane element in its top-3 highest-ROI recommendations. After delivering pause+resume, the gap became clear: the two workflows serve different contracts.

| Workflow      | Contract                                                                  | Side effects                                                 |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `resume.md`   | Restore session context, load checkpoint, execute the primary next action | Checkpoint cleanup, state restoration, conversational resume |
| `progress.md` | Read-only status query: where am I, what's next?                          | None — no files written, no state changed                    |

A user who wants a quick status snapshot before deciding what to do next should not have to trigger a full session restore. Progress answers "where am I?" without side effects. Resume answers "restore me and get me moving."

GSDD's `progress.md` (~200 lines) is a deep distillation of GSD's 382-line version:

- **Kept from GSD:** project-existence check, ROADMAP.md phase-status parsing (`[ ]`/`[-]`/`[x]`), phase completion count, checkpoint-file detection, incomplete-work scanning (PLAN without SUMMARY, SUMMARY without VERIFICATION), quick-task log check, priority-ordered routing with 6 named branches (A-F) and output blocks, recent work from 2-3 most recent SUMMARY.md files, between-milestones detection (SPEC exists, ROADMAP absent), edge case handling for compound states, typed filled-in example
- **Stripped:** `gsd-tools.cjs` CLI calls, `STATE.md` loading, progress-bar rendering, Key Decisions section, Blockers section, Pending Todos, Active Debug Sessions, Profile display, UAT gap routing

Design principle unchanged: derive state from primary artifacts (ROADMAP.md, SPEC.md, phase directories, checkpoint file). No new roles, no new delegates.

**Evidence:**

- GSD source: `get-shit-done/workflows/pause-work.md` (123 lines, phase-scoped checkpoint)
- GSD source: `get-shit-done/workflows/resume-project.md` (307 lines, STATE.md-dependent)
- GSD source: `get-shit-done/workflows/progress.md` (382 lines, gsd-tools.cjs-dependent, STATE.md-dependent, progress bars, rich session dashboard)
- GSDD: `distilled/workflows/pause.md` (project-scoped checkpoint, advisory git)
- GSDD: `distilled/workflows/resume.md` (artifact-derived state, priority-ordered routing)
- GSDD: `distilled/workflows/progress.md` (~200 lines, read-only, no side effects, artifact-derived state)
- External audit: `.internal-research/gsd-distilled-audit-13th-march-2026.md` — Highest-ROI recommendation #3: "Add just enough: status/resume/progress/health"
- D7 (milestone hierarchy): STATE.md replaced by ROADMAP.md inline status
- D8 (advisory git): WIP commit is suggested, not mandated

---

## 13. Mechanical Invariant Enforcement

**GSD:** No structural invariant tests. Framework correctness relies on manual review and ad-hoc checking.

**GSDD:** 6 invariant suites (G1-G7, G2 reserved) with ~106 assertions enforce structural properties across all 29 framework markdown files. Every assertion message includes a `FIX:` instruction so CI agents can self-remediate.

**Suite inventory:**

| Suite | Name | Assertions | What it guards |
|-------|------|------------|----------------|
| G1 | Cross-Document Schema Consistency | ~20 | Same field documented in all surfaces that reference it |
| G3 | File Size Guards | ~29 | Prevent bloat regression (roles ≤500L, workflows ≤400L, delegates ≤100L) |
| G4 | XML Section Well-Formedness | ~29 | Every `<tag>` has matching `</tag>` across all framework files |
| G5 | Artifact Lifecycle Chain | ~11 | Each role references its input and output artifacts |
| G6 | DESIGN.md Decision Registry | ~5 | ≥13 numbered decisions, each with Evidence subsection |
| G7 | Delegate Thinness | ~9 | Non-empty lines ≤50 (plan-checker exempt) |

**Why remediation messages matter:** OpenAI's Harness Engineering (Feb 2026) confirmed what GSDD's audit surfaced independently: for agent-driven development, **error messages ARE the enforcement mechanism**. When an agent reads `"pause.md: <tag> opened 2x but closed 1x. FIX: Add missing </tag>."`, it can act on the fix instruction directly. Test failures without actionable messages require the agent to reason about intent from stack traces — slower and less reliable.

**The G4 suite caught 3 real bugs on first run:** 3 session workflows (pause.md, progress.md, resume.md) had orphan `</output>` closing tags with no corresponding opener. These were invisible to manual review across PRs #20-23 but immediately flagged by the well-formedness check.

**Evidence:**

- `tests/gsdd.invariants.test.cjs` lines 1015+ (6 suites, ~106 assertions)
- OpenAI Harness Engineering blog (Feb 2026): "error messages as enforcement mechanism"
- External audit (2026-03-13): recommendation #4 "Mechanize the framework's invariants"
- GSD source: no equivalent test infrastructure
- PRs #20-23: orphan `</output>` tags survived 4 manual review cycles before G4 caught them

---

## 14. Headless Mode

**GSD:** `--auto` flag in `new-project.md` — skips interactive questioning, requires idea document,
auto-approves requirements and roadmap, auto-advances to plan phase. Implemented across 5 workflow files
with `AskUserQuestion` API gates.

**GSDD:** `gsdd init --auto --tools <platform>` — non-interactive CLI bootstrap. Workflow-level auto mode
via `autoAdvance: true` in `.planning/config.json` + `<auto_mode>` section in `new-project.md`.

**Key design choices:**

1. **Brief-file over argument-passing.** GSD passes the idea document as a workflow argument or pasted text.
   GSDD uses a well-known file path (`.planning/PROJECT_BRIEF.md`) because:
   - File reads work on every agent platform (portable)
   - Brief can be inspected and edited before the workflow runs
   - Matches GSDD's "documents to disk" principle (D10)
   - CI pipelines can prepare the brief as a build artifact

2. **Config-driven, not flag-driven at the workflow level.** The CLI sets `autoAdvance: true` in config.
   The workflow reads config, not CLI arguments. This means any agent on any platform can detect
   auto mode by reading config.json — no vendor-specific argument parsing required.

3. **No auto-advance to plan phase.** GSD auto-chains: new-project → discuss → plan → execute.
   GSDD stops after SPEC.md + ROADMAP.md are created. Reason: GSDD doesn't have a discuss-phase
   workflow, and chaining the full lifecycle requires auto-mode support in plan.md/execute.md/verify.md
   (future work). Stopping after init gives CI systems a review checkpoint.

4. **Unified with existing non-TTY fallback.** `bin/gsdd.mjs` already had a non-interactive path
   for piped stdin. `--auto` and the TTY fallback now share `buildDefaultConfig()`, reducing
   code duplication and ensuring identical default config shape.

**Evidence:**

- GSD source: `get-shit-done/workflows/new-project.md` lines 9-40 — direct predecessor and
  only comparable headless workflow found in reviewed spec-framework sources
- OpenFang comparison: capability-gate emphasis supports keeping security review explicit even in
  automated flows, which is why auto mode inserts a deferred gate-review placeholder instead of
  silently omitting the section
- Claude Code: `-p` flag for headless execution with `--allowedTools` for access control
  (docs.anthropic.com)
- Codex CLI: `--quiet` and `--auto-edit` flags for non-interactive modes
  (developers.openai.com/codex/cli/reference)
- Cline CLI 2.0: explicit headless CI/CD mode (devops.com, 2025)

---

## 15. Model Profile Propagation

**GSD:** `modelProfile` stored in `.planning/config.json` with profile-to-model mapping. GSD generates
`opencode.json` with agent-to-model mappings for the OpenCode runtime; does not inject `model:` into
individual sub-agent frontmatter files.

**GSDD:** Static injection at generation time, with explicit runtime ownership. `modelProfile`
remains the portable semantic default. `agentModelProfiles` adds per-agent semantic overrides.
Claude generation translates those semantic tiers into stable aliases for the native checker agent.
OpenCode generation no longer infers exact `provider/model-id` strings from detected runtime config;
it only injects an OpenCode `model:` when the user explicitly sets
`runtimeModelOverrides.opencode.<agent>`.

**Decision: static injection at generation time, not dynamic runtime config reading.**

Dynamic reading (having agent files instruct the LLM to read config.json and select a model)
is incompatible with how Claude Code and OpenCode frontmatter works: it is parsed at agent
spawn time, not by the agent itself. Static injection remains the right mechanic, but the old
OpenCode approach overreached by guessing runtime-specific ids from detected provider config.
Current GSDD keeps the portable semantic layer and makes exact runtime ids explicit user-owned
configuration instead of framework inference.

**Scope: agent files only.** The current supported agent id is `plan-checker`. The `model:` field is injected into:
- `.claude/agents/gsdd-plan-checker.md` using Claude Code aliases (`opus`, `sonnet`, `haiku`)
- `.opencode/agents/gsdd-plan-checker.md` using an exact runtime-native string only when the user
  explicitly configured `runtimeModelOverrides.opencode.plan-checker`

Current repo truth:
- portable semantic settings:
  - `modelProfile`
  - optional `agentModelProfiles.<agent>` (currently consumed by `plan-checker`)
- exact runtime-native settings:
  - optional `runtimeModelOverrides.<runtime>.<agent>` (currently consumed by checker agents)
- Claude checker generation uses the resolved semantic tier unless an exact Claude runtime override exists
- OpenCode checker generation omits `model:` by default and inherits the active OpenCode runtime model
- OpenCode checker generation injects `model:` only when `runtimeModelOverrides.opencode.plan-checker`
  is explicitly set
- `gsdd models show` returns typed effective-state data and keeps human guidance in `hints` rather than
  mixing prose into machine-readable model fields

NOT injected into:
- `.claude/commands/*.md` / `.opencode/commands/*.md` run in main orchestrator context; model is
  orchestrator-determined
- `.agents/skills/*/SKILL.md` because the Agent Skills open standard has no `model:` field

**Resolution order:**

1. `runtimeModelOverrides.<runtime>.<agent>`
2. `agentModelProfiles.<agent>`
3. global `modelProfile`
4. runtime default / omitted `model:`

**CLI surface:**
- `gsdd models show`
- `gsdd models profile <quality|balanced|budget>`
- `gsdd models agent-profile --agent plan-checker --profile <quality|balanced|budget>`
- `gsdd models clear-agent-profile --agent plan-checker`
- `gsdd models set --runtime <claude|opencode> --agent plan-checker --model <id>`
- `gsdd models clear --runtime <claude|opencode> --agent plan-checker`

**Trade-off: static files become stale after a profile change.** If the user changes `modelProfile`
or runtime override config directly, generated checker files are not updated until `gsdd update`
is run. This is consistent with D9 (adapter generation over conversion): adapter files are generated
on demand.

**Boundary:** This is a narrow native-adapter decision, not closure of Gap I4. It makes the current
native checker surfaces honest and explicit. Broader delegate/runtime propagation remains follow-up work.

**Evidence:**
- GSD reference: `modelProfile` in `.planning/config.json` plus per-agent model resolution, including
  per-agent overrides, in `get-shit-done/references/model-profiles.md` and
  `get-shit-done/references/model-profile-resolution.md`
- OpenSpec: portable spec/workflow core is tool-agnostic and leaves runtime-specific execution concerns
  to integrations rather than encoding them into the portable spec surface (openspec.dev)
- MetaGPT: role-specialized orchestration is a legitimate place to express role-level model intent, but
  that does not imply exact vendor model ids belong in a portable workflow contract
  (github.com/FoundationAgents/MetaGPT)
- Claude Code: `model:` field with aliases `sonnet`, `opus`, `haiku` documented for sub-agents
  (docs.anthropic.com/en/docs/claude-code/sub-agents)
- OpenCode: `model:` in agent frontmatter uses `provider/model-id`, and when omitted the agent
  inherits the current model (opencode.ai/docs/agents)
- OpenCode config docs: OpenCode already owns project/global model configuration through runtime-native
  config, including `model` and `small_model`, so GSDD does not need to guess exact ids to regain DX
  (opencode.ai/docs/config)
- OpenCode troubleshooting: `ProviderModelNotFoundError` usually means a bad `provider/model-id`
  reference, which argues for explicit user-owned runtime ids instead of inferred framework guesses
  (opencode.ai/docs/troubleshooting)
- OpenAI API models: `gpt-5.4` exists and is positioned as a top-tier model for coding and agentic
  work, but vendor API availability alone does not prove an OpenCode-safe `provider/model-id`, which
  is why GSDD no longer infers OpenCode ids from vendor releases
  (developers.openai.com/api/docs/models/gpt-5.4)
- Agent Skills open standard: no `model:` field in spec (agentskills.io/specification) - no change

---

## 16. Template Versioning via Generation Manifest

**GSD:** `install.js` uses SHA-256 manifest (`installedFileHashes`) plus `gsd-local-patches/` backup directory
(lines 1227-1327). On update, GSD backs up user-modified files before overwriting, enabling rollback.

**GSDD:** Generation manifest in `.planning/generation-manifest.json`, opt-in `--templates` flag on
`gsdd update`, warn-but-overwrite semantics (no backup directory), `--dry` preview mode.

**Key differences from GSD:**
- **No backup directory.** Git handles recovery — users can `git checkout` to restore any overwritten
  template. Adding a `gsd-local-patches/` equivalent would introduce stale-state complexity that Git
  already solves.
- **Opt-in flag.** `gsdd update` without `--templates` preserves current behavior (adapter/skill refresh
  only). Template refresh is explicitly requested, so users are not surprised by file overwrites.
- **Project-scoped manifest.** `generation-manifest.json` lives in `.planning/` alongside other project
  artifacts, making it portable and inspectable. The manifest records SHA-256 hashes of all installed
  templates and role contracts at init/update time.
- **Modification detection.** When `--templates` runs, GSDD compares installed file hashes against the
  manifest to detect user modifications. Modified files trigger a `WARN` before overwrite. Files matching
  the manifest (unchanged) are silently refreshed. Files matching source (already current) are skipped.

**Manifest shape:**
```json
{
  "frameworkVersion": "v1.2",
  "generatedAt": "ISO-8601",
  "templates": {
    "delegates": { "file.md": "sha256..." },
    "research": { ... },
    "codebase": { ... },
    "root": { "agents.block.md": "sha256..." }
  },
  "roles": { "mapper.md": "sha256..." }
}
```

**`FRAMEWORK_VERSION` vs `initVersion`:** `initVersion` (currently `v1.1`) tracks config schema version.
`FRAMEWORK_VERSION` (currently `v1.2`) tracks template/generation versions in the manifest. They are
independent concerns — config shape can change without template changes and vice versa.

**Evidence:**
- GSD `install.js`: SHA-256 manifest + backup directory pattern
  (`get-shit-done/install.js` lines 1227-1327)
- OpenSpec: managed blocks with bounded upsert for vendor-specific surfaces
  (openspec.dev)
- Angular/Turborepo/Next.js: ordered migrations with dry-run preview
  (angular.dev/cli/update, turbo.build/repo/docs/guides/migrate)
- Langfuse: generation/prompt versioning with hash-based change detection
  (langfuse.com/docs/prompts/get-started)

---

## 17. CLI Composition Root Boundary

**GSD:** `install.js` and adjacent install/generation logic mix orchestration, runtime-specific conversion,
template syncing, prompts, and filesystem writes in one large entry surface.

**GSDD before D17 Session 2:** `bin/gsdd.mjs` had already pushed vendor rendering into `bin/adapters/`, but it
still mixed CLI composition with bootstrap command bodies, template refresh logic, prompt flows, and update
dispatch in a single file.

**GSDD after D17 Session 2:** `bin/gsdd.mjs` is a thin composition root. It owns:
- top-level constants (`WORKFLOWS`, `FRAMEWORK_VERSION`, path roots)
- adapter registry construction
- command registry wiring
- `runCli`
- stable exported command handles for tests

Implementation lives under `bin/lib/`:
- `cli-utils.mjs` owns flag parsing and JSON output helpers
- `models.mjs` owns config/model schema and `cmdModels`
- `phase.mjs` owns phase discovery, verify, and scaffold commands
- `templates.mjs` owns template/role install and refresh flows
- `init.mjs` owns `createCmdInit(ctx)`, `createCmdUpdate(ctx)`, help text, and bootstrap/update helper logic

**Boundary rules:**
- keep `bin/gsdd.mjs` as composition root, not a second implementation module
- keep config-schema ownership in `models.mjs`; do not duplicate or relocate `buildDefaultConfig` into `init.mjs`
  just to satisfy an old task list
- let `init` use the same template-sync module that `update --templates` uses, instead of maintaining separate
  copy logic
- enforce the boundary with code-structure guard tests, not by re-auditing the file manually each session

**Why this split:**
- it reduces the regression surface when bootstrap or template-refresh logic changes
- it keeps command logic close to the helpers it depends on
- it preserves a stable import surface for tests while making the main CLI file small enough to inspect quickly
- it aligns with the existing D9/D15/D16 direction: adapters own runtime-specific behavior; `bin/lib/` owns
  framework logic; `bin/gsdd.mjs` wires them together

**Evidence:**
- GSD source: `get-shit-done/install.js` (monolithic install/conversion surface)
- GSDD implementation: `bin/gsdd.mjs`, `bin/lib/init.mjs`, `bin/lib/templates.mjs`, `bin/lib/models.mjs`
- GSDD tests: `tests/gsdd.init.test.cjs`, `tests/gsdd.models.test.cjs`, `tests/gsdd.manifest.test.cjs`,
  `tests/gsdd.guards.test.cjs`

---

## 18. Codex CLI Native Adapter

**GSD:** No dedicated Codex CLI adapter. GSD was Claude-first.

**GSDD (before this decision):** Codex CLI was a skills-first runtime at ~40% parity. It consumed the portable `.agents/skills/gsdd-*/SKILL.md` surface but had no native plan-checker, no orchestration loop, no model control, and no dedicated adapter module. `--tools codex` was deprecated and silently stripped. Every Codex plan ran in silent `reduced_assurance` mode.

**GSDD (after this decision):** Codex CLI is promoted to `native_capable` — same tier as Claude Code and OpenCode. A dedicated `bin/adapters/codex.mjs` generates `.codex/agents/gsdd-plan-checker.toml` (read-only TOML agent with the plan-checker delegate). Codex's entry surface is the portable skill at `.agents/skills/gsdd-plan/SKILL.md` — Codex auto-discovers it via its `.agents/skills/` skill scanning ([developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)). The portable skill now contains vendor-neutral checker invocation instructions (JSON schema, max-3 cycle loop, escalation), so when Codex follows it, it spawns the native `gsdd-plan-checker` agent for fresh-context review. `--tools codex` is reinstated as an active adapter flag.

**Why:** Codex CLI v0.115.0 (2026-03-16) stabilized its multi-agent system with `.codex/agents/*.toml` definitions, `spawn_agent` fresh-context invocation, per-agent `model` and `model_reasoning_effort` fields, and `sandbox_mode` access control. This provides structural parity with Claude's `.claude/agents/` and OpenCode's `.opencode/agents/`.

**Why now:** Phase A research confirmed all three prerequisites for native-capable promotion:
1. A native agent surface exists (`.codex/agents/*.toml` with TOML format)
2. Fresh-context subagent invocation is confirmed (`spawn_agent` tool, new `ThreadId` per subagent)
3. Per-agent model control exists (`model` field in agent TOML)

**Key design choices:**

1. **TOML agent format** — Codex uses `.codex/agents/<name>.toml` (not markdown). The plan-checker delegate content goes inside `developer_instructions = """..."""`. A TOML escape guard replaces `"""` with `"" "` in delegate content to prevent string termination. Model IDs are validated at the CLI setter (`MODEL_ID_PATTERN`) and escaped in the TOML renderer as defense-in-depth.
2. **Portable skill as entry surface** — Unlike Claude (which has a vendor-specific `.claude/skills/gsdd-plan/SKILL.md`) and OpenCode (which has `.opencode/commands/gsdd-plan.md`), Codex reads skills from `.agents/skills/` — the shared portable path. The portable skill is enhanced with vendor-neutral checker invocation instructions (JSON schema, max-3 cycle loop, escalation, orchestration summary), making it self-sufficient as the Codex entry surface. When Codex auto-selects the `gsdd-plan` skill, the instructions tell it to invoke the `gsdd-plan-checker` agent if available. No separate planner TOML is needed — the portable skill handles orchestration directly.
3. **Inherit-by-default model** — Following OpenCode's pattern, no `model` field is set by default (inherits from parent session). An explicit `model = "<id>"` is only written when the user sets `runtimeModelOverrides.codex.plan-checker`.
4. **Always-high reasoning effort** — `model_reasoning_effort = "high"` is always set for the plan-checker (analysis agent should think carefully).
5. **Read-only sandbox** — `sandbox_mode = "read-only"` prevents the checker from editing plans, functionally equivalent to OpenCode's `write: false, edit: false, bash: false`.

**Known gaps:**
- No `hidden: true` equivalent — unlike OpenCode, the checker agent is visible to users (ergonomic gap, not functional; no Codex equivalent exists)
- No deterministic spawn API — spawning is model-interpreted via natural language, not a programmatic `Task()` call
- GitHub issues #14719 (re-spawn failure) and #14841 (spawn loops with weaker models) are documented risks; GSDD's simple spawn-wait-pattern minimizes exposure, and the max-3 loop has escalation
- JSON schema duplication — the checker JSON schema is embedded in Claude, OpenCode orchestration prompts and the portable skill; tests guard drift across all surfaces
- No Codex CLI in CI — future regressions still require disposable-fixture validation even though local live validation now exists
- Entry surface is shared — Codex uses the portable `.agents/skills/gsdd-plan/SKILL.md` as its entry surface (no vendor-specific skill path exists in Codex). The portable skill's checker invocation is vendor-neutral, but routing depends on Codex's implicit skill selection matching the task description

**Live validation (2026-03-17):**
- Local runtime: `codex-cli 0.113.0` with `features.multi_agent = true`
- Happy path fixture: `%TEMP%\\gsdd-codex-pr29-happy-20260317-214241` wrote `.planning/phases/01-foundation/01-PLAN.md` through the portable `gsdd-plan` entry surface while the native checker double returned `CHECKER_HAPPY`
- Forced revision fixture: `%TEMP%\\gsdd-codex-pr29-revision-20260317-214942` required the checker-driven sentinel `SENTINEL-REVISION-OK` in the plan `Notes` section; the plan was revised and the second checker pass passed
- Max-3 escalation fixture: `%TEMP%\\gsdd-codex-pr29-max3-noresearch-20260317-220608` set `workflow.research = false` to isolate the checker seam; Codex spawned 3 fresh-context checker agents, each returned `CHECKER_STILL_BLOCKED`, and the final result was `escalated`

**Evidence:**
- OpenAI Codex CLI docs: [developers.openai.com/codex/subagents](https://developers.openai.com/codex/subagents)
- Codex CLI config reference: [developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference)
- Codex CLI v0.115.0 release notes: [github.com/openai/codex/releases/tag/rust-v0.115.0](https://github.com/openai/codex/releases/tag/rust-v0.115.0)
- Agent Skills standard: [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)
- GitHub issues: [#14719](https://github.com/openai/codex/issues/14719), [#14841](https://github.com/openai/codex/issues/14841)
- GSDD adapter patterns: `bin/adapters/claude.mjs`, `bin/adapters/opencode.mjs`
- GSDD implementation: `bin/adapters/codex.mjs`, `bin/adapters/index.mjs`, `bin/lib/init.mjs`, `bin/lib/models.mjs`
- GSDD tests: `tests/gsdd.init.test.cjs`, `tests/gsdd.models.test.cjs`, `tests/gsdd.plan.adapters.test.cjs`

---

## Maintenance

This document is updated when:

- A design decision is revised or reversed (update the relevant section, note the change)
- A new structural decision lands that affects how GSDD diverges from GSD (add a new section)
- Evidence is found that contradicts a stated rationale (update or remove the claim)

Do not add speculative decisions. Every section must cite implementation artifacts (files, PRs, tests) and at least one GSD source file for comparison.
