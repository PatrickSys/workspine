# GSDD Design Decisions

> Rationale for every structural choice GSDD makes relative to GSD.
> Each decision cites GSD source files, GSDD implementation, and external research.
> Updated as decisions are revised or new ones land.
>
> **Evidence index:** `distilled/EVIDENCE-INDEX.md` — one-line-per-source mapping for all decisions.
> **Open gaps:** `.internal-research/gaps.md` — live blockers, contradictions, and deferred decisions.

---

## Table of Contents

1. [4-File Codebase Standard](#1-4-file-codebase-standard)
2. [Agent Consolidation: 11 to 10](#2-agent-consolidation-11-to-10)
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
19. [Scenario-Based Eval Coverage](#19-scenario-based-eval-coverage)
20. [Workspace Health Diagnostics](#20-workspace-health-diagnostics)
21. [OWASP Authorization Matrix](#21-owasp-authorization-matrix)
22. [Delegate Layer Architecture](#22-delegate-layer-architecture)
23. [Mapper Output Quantification](#23-mapper-output-quantification)
24. [Consumer Governance Completeness](#24-consumer-governance-completeness)
25. [Consumer First-Run Experience](#25-consumer-first-run-experience)
26. [Session Continuity Contract Hardening](#26-session-continuity-contract-hardening)
27. [Consumer-Ready Surface Completion](#27-consumer-ready-surface-completion)
28. [Workflow Completion Routing](#28-workflow-completion-routing)
29. [Approach Exploration](#29-approach-exploration)
30. [Hardening Propagation](#30-hardening-propagation)
31. [Outcome Dimension for Plan-Checker](#31-outcome-dimension-for-plan-checker)
32. [Quick Workflow Alignment Hardening](#32-quick-workflow-alignment-hardening)
33. [Quick Approach Clarification](#33-quick-approach-clarification)
34. [Context Engineering Applied to Quick Workflow](#34-context-engineering-applied-to-quick-workflow)
35. [Skills-Native Runtimes vs Governance Adapters](#35-skills-native-runtimes-vs-governance-adapters)
36. [Interactive Init Wizard](#36-interactive-init-wizard)
37. [Mutability-Driven Workflow Classification](#37-mutability-driven-workflow-classification)
38. [Retroactive Artifact Enforcement](#38-retroactive-artifact-enforcement)
39. [Brownfield Entry Wiring](#39-brownfield-entry-wiring)

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
- `.planning/SPEC.md` "Lean Context Decision" section
- External: Liu et al. "Lost in the Middle: How Language Models Use Long Contexts" (NeurIPS 2023) — position in context significantly affects recall; middle content is underweighted, supporting minimal stable file sets; Levy et al. "Same Task, More Tokens: Impact of Input Length on the Reasoning Performance of LLMs" (EMNLP 2024) — longer inputs degrade reasoning performance; Aider tree-sitter dynamic repo maps (aider.chat) — on-demand structural mapping as an alternative to static context files

---

## 2. Agent Consolidation: 11 to 10

**GSD:** 11 specialized agent files, each scoped to a single concern.

**GSDD:** 10 canonical roles. 2 mergers, 1 extraction, 1 addition (approach-explorer, D29).

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
- External: CrewAI role-based team patterns, Microsoft AutoGen hierarchical agents, LangGraph multi-agent subgraphs — all validate role specialization over monolithic agents; specific count of 10 is engineering judgment shaped by GSD source lineage, not an externally prescribed number

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
- External: Principal-agent theory (Jensen & Meckling, Journal of Financial Economics 1976) — the foundational model of delegation contracts where principals define behavioral constraints and agents execute within them; GoF Strategy Pattern (Gamma et al. "Design Patterns" 1994) — separating algorithm definition (role) from its usage context (delegate); LangGraph multi-agent subgraphs and Microsoft AutoGen hierarchical agent patterns validate role/orchestration separation in production AI systems

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
- External: OWASP Top 10 for LLM Applications v2.0 (2025) — LLM01 (Prompt Injection) and LLM07 (System Prompt Leakage) directly support embedding security rules at the role contract level; Greshake et al. "Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection" (IEEE S&P 2023) — validates defense-in-depth at the agent-contract layer; Saltzer & Schroeder "The Protection of Information in Computer Systems" (1975) — complete mediation principle: every access must be checked against the access control policy

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
- External: LangGraph conditional edges — adaptive agent invocation based on workflow state is a core LangGraph pattern; Asai et al. "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection" (ICLR 2024) — validates conditional retrieval/synthesis based on whether additional context is needed; Anthropic "Building effective agents" (Dec 2024) — routing workflows match task complexity to agent selection

---

## 6. Mapper Staleness: Standalone Workflow

**GSD:** `map-codebase.md` was ALWAYS a standalone workflow, separate from `new-project.md`. It had built-in staleness detection with three user options: Refresh (delete + remap), Update (selective document refresh), Skip (use existing maps).

**GSDD:** Preserved exactly. Two integration points:

1. **On first brownfield init:** `new-project.md` detects source files, offers codebase mapping. If accepted, invokes `map-codebase` via the portable skill surface (`.agents/skills/gsdd-map-codebase/SKILL.md`).

2. **On subsequent runs:** If `.planning/codebase/` already exists, mappers are skipped during init. User runs `/gsdd-map-codebase` directly to trigger the Refresh/Update/Skip flow.

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
- External: Aider (aider.chat) uses dynamic tree-sitter-based repo maps generated on-demand rather than persistent cached indices — validates the freshness-over-cache approach; Cursor uses continuous background indexing (cached approach) showing both on-demand and cached are production-valid; on-demand is one defensible point on the freshness-vs-staleness-cost spectrum

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
- External: Hierarchical Task Network (HTN) planning (Erol, Hendler & Nau 1994; Nau et al. JAIR 2003) — foundational AI planning literature establishing milestone→phase→task decomposition as the standard approach for complex goal hierarchies; PMI PMBOK Work Breakdown Structure (WBS) standard — industry-standard phase/task hierarchy for project planning; Khot et al. "Decomposed Prompting: A Modular Approach for Solving Complex Tasks" (ICLR 2023) — task decomposition improves LLM performance on multi-step work by reducing scope per subproblem

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
- External: Industry consensus — Aider, GitHub Copilot, Cursor, Codex CLI, and OpenCode all treat git operations as user-controlled or advisory, not as enforced framework requirements; no major AI coding tool mandates a specific commit-per-task or branch-naming convention

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
| Cursor/Copilot        | `.agents/skills/gsdd-*/SKILL.md`                                                                                                            | Slash-invoked skills once the runtime is configured with that skills location |
| Gemini CLI            | `.gemini/commands/*.toml` or root `AGENTS.md` fallback                                                                                     | Custom commands if mirrored; `--tools agents` remains the fallback path       |

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
- External: Crystal Clear (Cockburn 2004) — ceremony scales with team size and criticality; lightweight methods are prescribed for small, co-located, low-criticality work; Kanban class-of-service (Anderson 2010) — routing tasks by size/urgency to appropriate workflow lanes; Anthropic "Building effective agents" (Dec 2024) — match workflow complexity to actual task complexity rather than applying uniform ceremony

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
- `gsdd models set --runtime <claude|opencode|codex> --agent plan-checker --model <id>`
- `gsdd models clear --runtime <claude|opencode|codex> --agent plan-checker`

**Trade-off: static files become stale after a profile change.** If the user changes `modelProfile`
or runtime override config directly, generated checker files are not updated until `gsdd update`
is run. This is consistent with D9 (adapter generation over conversion): adapter files are generated
on demand.

**Scope: checker-only is the final design boundary.** GSDD delegates are inline orchestrator
instructions (`<delegate>` blocks), not standalone agent files. Only the plan-checker produces
standalone agent files (`.claude/agents/`, `.opencode/agents/`, `.codex/agents/`) where static `model:`
injection is both possible and meaningful. GSD's per-agent model profiles relied on `Task(model=...)`;
GSDD replaced `Task()` with agent-agnostic delegate blocks, making per-delegate model injection
architecturally not viable without reverting to vendor-specific APIs. This closes Gap I4 by design.

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
- External: Seemann "Dependency Injection in .NET" (Manning 2011) — coined "Composition Root" as the named pattern for the single location where the entire application is assembled; Martin "Clean Architecture" (2017) — the main component as the outermost, dirtiest layer that owns all wiring; standard practice in oclif, Commander.js, yargs, and Cobra CLI frameworks

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

## 19. Scenario-Based Eval Coverage

**GSD:** No structural eval tests. Correctness relied on manual review and live agent runs.

**GSDD:** Deterministic scenario tests (`tests/gsdd.scenarios.test.cjs`) verify artifact-chain contracts across 3 golden paths and 2 native-capable runtime chains. No LLM calls required.

**What scenarios test (S1–S5):**

| Suite | Coverage |
|-------|----------|
| S1 — Greenfield Golden Path | init → new-project → plan → execute → verify → audit-milestone artifact chain |
| S2 — Brownfield Path | map-codebase delegates, codebase map references, mapper role installation |
| S3 — Quick-Task Path | Isolation from ROADMAP/research, role references, researcher exclusion |
| S4 — Native Runtime Chain | Claude skill/command/checker + Codex TOML checker completeness, 7 dimensions |
| S5 — Config-to-Content Propagation | Default config values reflected in generated artifacts |

**What scenarios do NOT test:** Runtime LLM behavior, aggregate success rates, LLM-judge quality. Those belong in a future eval layer above this one.

**Design rationale:** The testing pyramid for AI agents (Block, Jan 2026) puts deterministic no-LLM tests at the base. OpenAI's eval guidance recommends skill-level testing with deterministic graders. Anthropic's guidance says "grade outcomes, not paths" — these tests verify what was produced, not how. This layer complements the G1–G13 invariant suites (D13) which test structural properties of source files; scenario tests verify that the *generated* artifact chain between workflows is complete.

**Evidence:**

- OpenAI: "Testing Agent Skills Systematically with Evals" (developers.openai.com/blog/eval-skills)
- Anthropic: "Demystifying Evals for AI Agents" (anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Block: "Testing Pyramid for AI Agents" (engineering.block.xyz/blog/testing-pyramid-for-ai-agents)
- GSDD implementation: `tests/gsdd.scenarios.test.cjs` (S1–S5, ~37 assertions)
- Invariant complement: D13, `tests/gsdd.invariants.test.cjs`, `tests/gsdd.guards.test.cjs`

---

## 20. Workspace Health Diagnostics

**GSD:** `health.md` (157 lines) — calls `gsd-tools.cjs validate health [--repair]`, parses JSON with error codes E001-E005/W001-W007, supports `--repair` flag for createConfig/resetConfig/regenerateState repair actions.

**GSDD:** `gsdd health` CLI command (`bin/lib/health.mjs` + `bin/lib/health-truth.mjs`). Factory function `createCmdHealth(ctx)` returning an async command. No `--repair` flag — fixes are documented as actionable instructions, not automated mutations. GSDD already has `gsdd init` and `gsdd update --templates` as the repair paths; a separate repair mode would duplicate those commands.

**Check categories:**

| ID | Severity | What it checks |
|----|----------|----------------|
| E1 | ERROR | `.planning/config.json` missing or unparseable |
| E2 | ERROR | config.json missing required fields (`researchDepth`, `modelProfile`, `initVersion`) |
| E3 | ERROR | `.planning/templates/` missing |
| E4 | ERROR | `.planning/templates/roles/` missing or empty |
| E5 | ERROR | `.planning/templates/delegates/` missing or empty |
| E6 | ERROR | `.planning/templates/research/` missing or empty |
| E7 | ERROR | `.planning/templates/codebase/` missing or empty |
| E8 | ERROR | `.planning/templates/` missing critical root files (`spec.md`, `roadmap.md`, `auth-matrix.md`) |
| W1 | WARN | `generation-manifest.json` missing |
| W2 | WARN | Template files modified locally (hash mismatch vs manifest) |
| W3 | WARN | Template/role files missing from disk but listed in manifest |
| W4 | WARN | Active non-archived phases marked in progress/done are missing from `.planning/phases/` |
| W5 | WARN | Phase artifact set has PLAN but no matching SUMMARY (stale in-progress) |
| W6 | WARN | No adapter surfaces detected |
| W7 | WARN | `distilled/DESIGN.md` health check table differs from implemented check IDs |
| W8 | WARN | `distilled/README.md` workflow inventory differs from `distilled/workflows/` |
| W9 | WARN | `.internal-research/gaps.md` references missing repo-local paths |
| W10 | WARN | `.planning/ROADMAP.md` phase status differs from `.planning/SPEC.md` requirement checkboxes |
| I1 | INFO | Generation manifest `frameworkVersion` differs from current `FRAMEWORK_VERSION` |
| I2 | INFO | Phase completion count from ROADMAP |
| I3 | INFO | Which adapters are installed |

**Verdict logic:**
- Any ERROR → `broken` (exit code 1)
- Any WARN, no ERROR → `degraded` (exit code 0)
- No ERROR, no WARN → `healthy` (exit code 0)

**Output modes:**
- Default: human-readable with severity markers and verdict line
- `--json`: machine-readable `{ status, errors[], warnings[], info[] }`

**Key design choices:**

1. **No `--repair` flag.** GSD's health workflow supported `--repair` with three actions (createConfig, resetConfig, regenerateState). GSDD does not need this because `gsdd init` and `gsdd update --templates` already serve as repair paths. Documenting the fix command in each diagnostic is sufficient — agents can read and execute the instruction directly.

2. **`brew doctor` pattern.** Diagnose, report, suggest — never auto-fix. This matches the D13 principle: error messages ARE the enforcement mechanism. When an agent reads `"E3: .planning/templates/ missing. Fix: Run gsdd update --templates"`, it can act on the instruction.

3. **Pre-init guard.** If `.planning/config.json` doesn't exist, output a one-line message and exit 1. No partial checks — the workspace is simply not initialized.

4. **Split structural vs truth checks.** `bin/lib/health.mjs` keeps the structural workspace checks. `bin/lib/health-truth.mjs` holds the always-on cross-file truth checks (W7-W10) so the health surface can grow without turning the main command into one monolith.

5. **Reuses existing modules.** `readManifest()` and `detectModifications()` from `manifest.mjs` handle W1-W3. `isProjectInitialized()` pattern from `models.mjs` handles the pre-init guard. Truth checks stay read-only and operate on repo-local artifacts only when those framework files exist.

6. **Framework-source mode skips installed-project template checks.** Inside the GSDD framework repo itself, `distilled/templates/` is the source of truth and `.planning/templates/` is intentionally absent. `gsdd health` therefore skips the installed-project template/manifest checks (E3-E8, W1-W3) in framework-source mode instead of producing false positives during self-health runs.

**What was removed vs GSD:**
- `--repair` flag and associated repair actions
- Error codes E001-E005/W001-W007 (replaced with simpler E1-E8/W1-W10/I1-I3)
- STATE.md checks (GSDD has no STATE.md per D7)
- PROJECT.md checks (GSDD uses SPEC.md, not checked by health — it's workflow-authored)
- Phase directory naming format checks (GSDD uses flat numbered files, not NN-name directories)

**Evidence:**

- GSD source: `get-shit-done/workflows/health.md` (157 lines, predecessor)
- `brew doctor` pattern: diagnose, report, suggest — never auto-fix
- OpenAI Harness Engineering (Feb 2026): error messages as enforcement mechanism (same principle as D13)
- External audit (2026-03-13): recommendation #3 "Add just enough: status/resume/progress/health"
- External audit (2026-03-17): "You probably do need a minimal health surface, but not GSD's full style"
- PR #32: pre-init guard bug proved workspace integrity issues are real, not theoretical
- GSDD implementation: `bin/lib/health.mjs`, `bin/lib/health-truth.mjs`, `bin/gsdd.mjs`, `tests/gsdd.health.test.cjs`, `tests/gsdd.guards.test.cjs` (G14)

---

## 21. OWASP Authorization Matrix

**GSD:** No formal authorization matrix. Auth verification during milestone audits relies on the integration checker's narrative inference — it identifies sensitive surfaces and checks for auth protection, but has no systematic cell-by-cell verification against declared permissions.

**GSDD:** Adds an optional OWASP-style authorization matrix as a project artifact (`.planning/AUTH_MATRIX.md`). When present, the integration checker performs cell-by-cell verification in addition to its existing narrative auth check.

**The matrix uses the OWASP pivot format:**

| Resource | Action | Role A | Role B | Role C |
|----------|--------|--------|--------|--------|
| /resource| verb   | ALLOW  | DENY   | OWN    |

Permission values: ALLOW (role can access), DENY (explicit rejection required), OWN (ownership-scoped access), N/A (not applicable).

**Design choices:**

1. **Project artifact, not framework source.** The matrix lives in `.planning/AUTH_MATRIX.md` — a project-specific file created during `new-project` when the project has multiple roles. The template at `distilled/templates/auth-matrix.md` teaches the format but is not consumed at runtime. This follows the same pattern as `SPEC.md` and `ROADMAP.md`: the template instructs, the project artifact governs.

2. **Backwards compatible.** The integration checker's new Step 4a is fully gated by an existence check: `If .planning/AUTH_MATRIX.md does not exist, skip this sub-step.` The narrative auth check (Step 4) always runs regardless. Projects without a matrix see zero behavioral change.

3. **OWASP pivot format.** The resource x role x permission table is the standard format from the OWASP Authorization Testing Automation Cheat Sheet. Using a recognized standard means the matrix is portable — it can be consumed by other tools, reviewed by security auditors, or extended with automated test generation outside GSDD.

4. **No automated test generation.** The matrix is consumed for verification, not for generating test code. Test generation would require framework-specific knowledge (HTTP client, test runner, auth setup) that varies per project. The integration checker reports VERIFIED / MISMATCH / UNTESTED per cell — turning mismatches into tests is the developer's job.

5. **No auto-creation.** The `new-project` workflow mentions the matrix as optional item 8 in `<spec_creation>`. It is not automatically generated because auth requirements vary widely and a wrong matrix is worse than no matrix.

6. **Template portability.** The template is auto-distributed by `installProjectTemplates()` (same `cpSync` path as all templates) and auto-tracked by `buildManifest()`. No code changes to `templates.mjs` or `manifest.mjs` were needed.

**What GSDD does NOT do:**

- Does not generate test code from the matrix
- Does not auto-create the matrix during project init
- Does not require the matrix for milestone audits to pass
- Does not replace the narrative auth check (Step 4 always runs)

**Evidence:**

- OWASP Authorization Testing Automation Cheat Sheet: pivot-format matrix standard
- OWASP Top 10 for Agentic Applications 2026: A1 Agent Overreach, A4 Insufficient Authorization
- External audit (2026-03-13): "Upgrade milestone auth from intent to matrix"
- External audit (2026-03-17): confirmed auth verification gap independently
- GSD source: `agents/integration-checker.md` (narrative auth check, no matrix support)
- GSDD implementation: `distilled/templates/auth-matrix.md`, `agents/integration-checker.md` (Step 4a), `distilled/workflows/audit-milestone.md`, `distilled/workflows/new-project.md`, `tests/gsdd.guards.test.cjs` (G15)

---

## 22. Delegate Layer Architecture

**GSD:** Orchestrator subagent prompts were embedded inline in workflow files or referenced indirectly through agent role contracts. No explicit thin-wrapper layer. Scope and context were implicit in the orchestrator's prompt shaping.

**GSDD:** Extracted 11 delegates as explicit thin-wrapper files in `distilled/templates/delegates/`. A delegate is a sub-agent instruction wrapper scoped to a specific orchestrator task, carrying a bounded input/output contract. Eleven delegates cover 4 canonical roles: mapper × 4 focus-scoped variants, researcher × 4 dimension-scoped variants, synthesizer × 1 (via `researcher-synthesizer.md`), one fresh-context adversarial reviewer (`plan-checker.md`, new in D9, no GSD equivalent), and one interactive approach explorer (`approach-explorer.md`, recovers GSD discuss-phase leverage with research enhancement). Executor, verifier, integration-checker, planner, and roadmapper are invoked directly from orchestrator workflows without thin-wrapper delegates.

**Why "delegates":** In multi-agent orchestration literature (Anthropic multi-agent guidance, OpenAI harness engineering, OpenDev terminal-agents paper arXiv 2603.05344), a delegate is a sub-agent invoked by an orchestrator with:
1. A single, bounded responsibility (not a general-purpose role)
2. A typed input/output contract
3. Explicit scope boundaries (what the sub-agent owns vs. doesn't own)
4. A specific invocation pattern (fresh context, checkpoint, isolation)

GSDD's delegates are exactly this: thin instruction wrappers that route to a canonical role contract, carry a specific scope parameter, enforce context isolation, and return typed structured output. The name is intentional and accurate to multi-agent literature.

**Why extract delegates:**

Orchestrator workflows need to invoke sub-agents with consistent, predictable behavior. The orchestrator's prompt is large and carries session context; the sub-agent should be small, focused, and isolated. GSD embedded sub-agent instructions inline, making workflows hard to read and sub-agent contracts hard to reuse. GSDD extracts delegates into portable files at `distilled/templates/delegates/`, installed to `.planning/templates/delegates/` per project, and referenced by `<delegate>` blocks in orchestrator workflows:

```
<delegate>
Instruction: Read .planning/templates/delegates/researcher-stack.md
Scope: domain tech stack research
Input: Project domain, tech constraints, research mode
Output: STACK.md with structured findings and confidence levels
</delegate>
```

Benefits:
1. **Reusable:** The same delegate can be invoked from multiple orchestrator workflows (new-project, plan, milestone audit)
2. **Testable:** Delegate contracts are explicit and can be verified independently
3. **Portable:** Delegates are plain markdown; any agent can read them
4. **Versioned:** The generation manifest tracks delegate content; `gsdd update --templates` refreshes them

**Tradeoffs and close condition:**

The delegate layer is a semantic extraction, not a functional one. It does not change what happens at runtime; it only changes how we describe what happens. The tradeoff is:
- **Benefit:** Orchestrators are smaller, clearer, and sub-agent contracts are reusable
- **Cost:** One more layer of indirection; agents must read both the workflow and the delegate to understand the full contract

This is acceptable because:
1. Agents are fast at reading multiple files
2. The clarity gain outweighs the reading cost
3. Delegate independence enables better testing and quality gates

**11 delegates:**

| Delegate | Purpose | Wrapped Role |
|----------|---------|--------------|
| `mapper-tech.md` | Map codebase tech stack | mapper (focus: tech) |
| `mapper-arch.md` | Map codebase architecture | mapper (focus: arch) |
| `mapper-quality.md` | Map code quality conventions | mapper (focus: quality) |
| `mapper-concerns.md` | Identify code concerns and debt | mapper (focus: concerns) |
| `researcher-stack.md` | Research domain tech stack | researcher (dimension: stack) |
| `researcher-features.md` | Research domain feature landscape | researcher (dimension: features) |
| `researcher-architecture.md` | Research domain architecture patterns | researcher (dimension: architecture) |
| `researcher-pitfalls.md` | Research domain pitfalls and risks | researcher (dimension: pitfalls) |
| `researcher-synthesizer.md` | Synthesize research into roadmap implications | synthesizer |
| `plan-checker.md` | Fresh-context adversarial plan review | planner (adversarial, new in D9) |
| `approach-explorer.md` | Interactive approach exploration and user alignment | approach-explorer (interactive, recovers GSD discuss-phase) |

**Evidence:**

- Anthropic multi-agent guidance: orchestration patterns with isolated sub-agents
- OpenAI Harness Engineering (2026): delegate pattern for consistent, reusable sub-agent behavior
- OpenDev "Terminal Agents" (arXiv 2603.05344): multi-agent coordination with explicit role contracts
- GSDD implementation: `distilled/templates/delegates/`, `distilled/workflows/*.md` (with `<delegate>` blocks), `bin/lib/rendering.mjs` (delegate text injection)
- Tests: `tests/gsdd.scenarios.test.cjs` (S1–S5 verify delegate invocation chains)

---

## 23. Mapper Output Quantification

**GSD baseline:** Mapper agents produce qualitative descriptions ("uses constructor injection") without adoption rates, trend signals, or exemplar file identification. No systematic mechanism for ranking concerns by downstream impact.

**GSDD decision:** Five quantification primitives added across codebase map templates and delegates:

| Primitive | Where | Format |
|-----------|-------|--------|
| Convention adoption rates | CONVENTIONS.md + mapper-quality delegate | `~N% (stable\|rising\|declining)` via grep-counting |
| Golden files (conventions) | CONVENTIONS.md + mapper-quality delegate | 2–3 files with highest convention density in production code |
| Golden files per layer (arch) | ARCHITECTURE.md + mapper-arch delegate | Most-imported file per layer (inbound import frequency) |
| Must-know packages | STACK.md + mapper-tech delegate | 3–5 packages with risk index low/medium/high + common mistake |
| Downstream impact ranking | CONCERNS.md + mapper-concerns delegate | Top 3 concerns ranked by ARCHITECTURE.md change-routing rows blocked |

**Why algorithmic, not subjective:** Each primitive has a deterministic algorithm so different agents produce comparable output:
- Adoption rate: grep-count ÷ total instances, expressed as ~N%
- Golden file (conventions): highest density of documented conventions per production file
- Golden file (arch): highest inbound import count per layer
- Must-know packages: misuse causes hardest-to-debug problems (data corruption or silent failure = risk: high)
- Impact ranking: number of ARCHITECTURE.md change-routing rows blocked per concern

**Why `~N%` format:** The tilde prefix signals estimation, not measurement. This prevents false precision while still providing a useful signal. "~84% (declining)" conveys the same planning information as an exact count while being honest about the estimation method.

**Why separate sections, not inline annotations:** Inline annotations ("constructor injection — 84%") would require reformatting existing rules. Dedicated sections (Convention Adoption Rates, Golden Files) keep quantification additive — the existing prescriptive rules remain unchanged and the new sections are skippable by agents that don't need them.

**Problem this solves:** Internal research (ideas.md, Feb 2026) directly compared GSDD's mapper against codebase-context MCP on the same codebase and found: GSDD returned "uses constructor injection" while CC returned "84% (declining)". The qualitative output gives downstream planners and executors weaker signal for prioritization decisions on brownfield projects.

**Evidence:**

1. `ideas.md` (internal, Feb 2026): direct per-tool comparison — "Quantification matters — '84% declining' > 'uses constructor injection'"
2. ArXiv 2602.20478 (Codified Context): structured quantifiable facts enable agents to load context JIT without reading full files
3. GetDX measurement framework (2026): adoption % is the primary signal for convention strength in engineering teams
4. Anthropic 2026 Agentic Coding Trends: context quality is the primary competitive advantage; bottleneck is "does agent have context it needs?"
5. Codebase-Context MCP (PatrickSys): already returns quantified patterns — GSDD without this produces weaker artifacts on the same codebase

**Trade-offs:**

- Benefit: downstream planners and executors get quantified signals for prioritization; "~84% declining" tells the planner to budget for migration, "~100% stable" tells it not to
- Cost: mapper must grep-count each major convention, adding analysis time; the tilde prefix is honest about estimation but agents may treat it as less authoritative than exact counts
- Scope: quantification is additive — existing qualitative rules remain; agents can skip the new sections if not needed

**GSDD implementation:** `distilled/templates/codebase/conventions.md`, `distilled/templates/codebase/architecture.md`, `distilled/templates/codebase/stack.md`, `distilled/templates/codebase/concerns.md`, `distilled/templates/delegates/mapper-quality.md`, `distilled/templates/delegates/mapper-arch.md`, `distilled/templates/delegates/mapper-tech.md`, `distilled/templates/delegates/mapper-concerns.md`, `agents/mapper.md`

---

## 24. Consumer Governance Completeness

**Problem:** Consumer governance surfaces were oscillating between two failure modes. The earlier block was too thin and hid core lifecycle entry points. The later block over-corrected into a long wall that tried to enumerate every delivered workflow, which made first-run `AGENTS.md` too heavy for a stranger to scan quickly.

**GSDD decision:** Consumer-generated `AGENTS.md` must be complete for the primary lifecycle, not exhaustive for the whole framework. The generated governance surface is a routing map for the core path (`new-project -> plan -> execute -> verify -> progress`) plus the durable location of the portable skills. Secondary workflows remain discoverable through `.agents/skills/gsdd-*/SKILL.md`, but they do not all need to be listed inline in the short generated file.

**What changed:**

- `agents.block.md` now names the five core lifecycle skills explicitly instead of trying to inline all workflow inventory
- The lifecycle line still anchors the full flow through `audit-milestone`, but the generated block stays routing-first and compact
- The block tells agents where the full portable workflow set lives: `.agents/skills/gsdd-*/SKILL.md`
- Guard coverage now enforces the compact contract instead of exhaustive inventory in the generated file

**Why this is high-leverage:** Consumer `AGENTS.md` is read at the exact moment a stranger is deciding whether the framework is legible. The file has to preserve load-bearing routing while staying short enough to scan. Exhaustive workflow inventory belongs in the durable skills directory and public docs, not in the first-run governance block.

**Evidence:**

- HumanLayer, "Skill Issue" (2026): AGENTS.md works best as a short routing map, not a full product manual
- OpenAI, "Harness Engineering" (2026): the harness should surface the critical path clearly at the moment of action
- Phase 17 repo proof: `tests/gsdd.consumer-ceremony.test.cjs` now asserts the generated consumer file stays within 15-25 lines while preserving core routing hints and portable-skill discovery
- GSDD implementation: `distilled/templates/agents.block.md`, `distilled/templates/agents.md`, `tests/gsdd.consumer-ceremony.test.cjs`, `tests/gsdd.guards.test.cjs`

---

## 25. Consumer First-Run Experience

**Problem:** GSDD's internal architecture was stronger than its first-run UX. The framework had the right runtime surfaces and workflow depth, but consumer onboarding still felt like an internal tool: too many init questions, too much generated governance text, and not enough immediate clarity about the next step.

**Decision:** Keep launch-proof posture in public docs and install/help surfaces, while making the actual first-run experience intentionally lightweight: a guided init wizard with only load-bearing choices, explicit post-init summary output, and a compact generated governance block focused on the core path.

**Key changes:**
- Interactive init now asks only five visible questions: runtimes, AGENTS governance, rigor, cost, and whether to track `.planning/` in git
- Init prints a short summary showing the selected rigor/cost defaults and the core workflow route
- AGENTS.md governance stays focused on invocation guidance, the governance-vs-discovery boundary, and the core lifecycle rather than launch-proof copy or exhaustive inventory
- Quickstart and public docs still carry the broader platform and proof story

**Evidence:**
1. **Anthropic harness engineering** (2025-2026): "honest constraints over vague prompting" — harnesses should clearly communicate what they can and cannot enforce
2. **OpenAI Codex skills documentation**: Shows clear per-platform invocation patterns with explicit examples, not generic "use the skill" instructions
3. **GitHub spec-driven development toolkit**: Provides explicit getting-started flows that match the user's specific tool, not one-size-fits-all docs
4. **Martin Fowler on context engineering**: Emphasizes that "the right information at the right time" applies to human consumers as much as to AI agents
5. **Both GSDD external audits** (March 13 + 17, 2026): Independently concluded the same gap — "architecture is solid, presentation lags implementation"

**GSDD implementation:** `README.md` (quickstart, honest platform tiers), `distilled/templates/agents.block.md` (compact governance plus governance/discovery boundary), `bin/lib/init-flow.mjs` (post-init summary), `bin/lib/init-prompts.mjs` (5-prompt guided flow), `tests/gsdd.consumer-ceremony.test.cjs`, `tests/gsdd.guards.test.cjs`

---

## 26. Session Continuity Contract Hardening

**GSD:** No explicit session management contract. State lived in a separate STATE.md file. No pause/resume/progress workflows. Session continuity depended on the user remembering where they left off.

**GSDD:** Three specialized session workflows with artifact-based state derivation:
- **pause.md:** Writes `.continue-here.md` checkpoint with frontmatter (`workflow`, `phase`, `timestamp`) and 6 XML sections (`current_state`, `completed_work`, `remaining_work`, `decisions`, `blockers`, `next_action`). Detects 3 work types (phase/quick/generic), gathers missing context conversationally, and advises on git commit.
- **resume.md:** Reads artifacts (ROADMAP.md, SPEC.md, .continue-here.md, phase directories, quick LOG.md), routes to the correct next action with 5-branch priority logic (checkpoint-based routing, incomplete execution, needs planning, needs verification, all phases complete), and cleans up the checkpoint before dispatching.
- **progress.md:** Read-only reporter with 4-way existence detection, 6 named routing branches (A through F), edge case handling for compound states, and recent-work scanning from SUMMARY.md files. Creates, modifies, or deletes no files.

D12 established the session persistence design. D26 mechanically enforces the routing contracts that D12 introduced with a G20 guard suite.

**Evidence:**

1. Anthropic "Effective harnesses for long-running agents" (2026): artifact-based session handoff (`claude-progress.txt`) is the winning pattern; context compaction alone is "not sufficient" -- explicit progress files bridge sessions
2. GitHub "How to build reliable AI workflows with agentic primitives" (2026): session splitting as a first-class agentic primitive; distinct sessions for different phases improve accuracy
3. OpenAI harness engineering (2026): incremental progress tracking (JSON feature lists, progress files) is the key mechanism for multi-session work; "finding a way for agents to quickly understand the state of work when starting with a fresh context window"
4. OpenDev terminal agents (arXiv 2603.05344): scaffolding-harness separation; runtime state must be derivable from artifacts, not from context window memory
5. GSDD internal: I5 invariant suite covers basic structure (16 assertions) but not routing completeness; S1-S5 scenarios don't exercise session workflows in isolation; 18+ routing branches untested before D26

**Tradeoff:** More assertions to maintain (~35 new), but prevents routing drift that would break the consumer's primary multi-session interaction pattern. GSDD's 3-workflow session design already aligns with Anthropic's recommendation -- D26 mechanically locks it down.

**GSDD implementation:** `distilled/workflows/pause.md`, `distilled/workflows/resume.md`, `distilled/workflows/progress.md`, `tests/gsdd.guards.test.cjs` (G20)

---

## 27. Consumer-Ready Surface Completion

**Problem:** Three independent external audits (March 13, 17, 18 2026) converged: GSDD's architecture is complete but consumer-facing documentation has gaps blocking self-service adoption. Specifically: auto-mode not in README, no troubleshooting section, no git tracking guidance, model strategy unexplained, health not positioned as diagnostic entry point, team onboarding absent, and docs/USER-GUIDE.md not linked from README.

**Decision:** Close consumer journey gaps with compact README sections cross-referencing the existing User Guide. Do not bloat the README.

**Changes:** 6 new README subsections (Headless Mode, Team Use, User Guide link, Model Strategy, What to Track, Troubleshooting). G21 guard suite enforces section presence.

**Evidence:**
1. External audit (2026-03-13): "architecture is solid, presentation lags implementation"
2. External audit (2026-03-17): "close scope around the kernel" — consumer surface identified as #1 bottleneck
3. External audit (2026-03-18): "docs should close the consumer journey"
4. OpenAI harness engineering (2026): documentation is part of the harness environment
5. Anthropic context engineering (2026): progressive disclosure for onboarding
6. Agent Skills standard (agentskills.io, 30+ tools): skills need clear discovery documentation

**GSDD implementation:** `README.md`, `docs/USER-GUIDE.md` (already exists, now cross-referenced), `tests/gsdd.guards.test.cjs` (G21)

---

## 28. Workflow Completion Routing

**Problem:** Consumer testing (2026-03-21) revealed that AI agents completing a GSDD workflow go silent — the user must manually figure out which `/gsdd-*` command to run next. The lifecycle contract (`new-project → plan → execute → verify → [next phase]`) was correct in design but invisible in practice at each step boundary. GSD original solved this with explicit "Next Up" sections at the end of every workflow; GSDD lost this pattern during distillation.

**Decision:** Add `<completion>` sections after `<success_criteria>` in all 9 terminal workflows. Add positional discipline gates (STOP instructions at exact deviation points) and mandatory persistence enforcement for critical artifacts.

**Changes:**

| Fix | Scope | Files |
|-----|-------|-------|
| `<completion>` sections | 9 workflows (all except `progress.md` which already has routing) | `new-project.md`, `plan.md`, `execute.md`, `verify.md`, `audit-milestone.md`, `quick.md`, `pause.md`, `resume.md`, `map-codebase.md` |
| Positional STOP gates | 2 transition points in `new-project.md` (questioning→research, research→spec) | `new-project.md` |
| SUMMARY.md persistence gate | MANDATORY write enforcement in `<state_updates>` | `execute.md` |
| VERIFICATION.md persistence | Dedicated `<persistence>` section with STOP-on-failure | `verify.md` |
| G22 guard suite | ~30 assertions preventing regression | `tests/gsdd.guards.test.cjs` |

**Completion section pattern (consistent across all 9 workflows):**
```markdown
<completion>
Report to the user what was accomplished, then present the next step:

---
**Completed:** [what finished]

**Next step:** `/gsdd-[command]` — [description]

Also available:
- `/gsdd-[alt]` — [description]

Consider clearing context before starting the next workflow for best results.
---
</completion>
```

**Routing map (acyclic, complete):**
- `new-project` → `/gsdd-plan`
- `plan` → `/gsdd-execute`
- `execute` → `/gsdd-verify` (if verifier enabled) or `/gsdd-progress`
- `verify` → `/gsdd-progress` (passed), `/gsdd-plan` (gaps), `/gsdd-verify` (human_needed)
- `audit-milestone` → `/gsdd-complete-milestone` (passed), `/gsdd-plan` (gaps/debt)
- `quick` → `/gsdd-progress`
- `pause` → `/gsdd-resume` (next session)
- `resume` → dispatches to selected workflow
- `map-codebase` → `/gsdd-new-project`

**GSD comparison:**

| Aspect | GSD | GSDD |
|--------|-----|------|
| End-of-workflow routing | `## ▶ Next Up` with emoji, separators, backticked commands | `<completion>` section with bold routing, consistent format |
| Context clearing | Explicit: `<sub>/clear first → fresh context window</sub>` | Vendor-agnostic: "Consider clearing context before starting the next workflow" |
| Persistence enforcement | No explicit gates | MANDATORY gates on SUMMARY.md and VERIFICATION.md |
| Positional discipline | Rules at top of file only | STOP gates at exact deviation transition points |

GSDD's `<completion>` pattern is vendor-agnostic (GSD's `/clear` is Claude-specific) and adds persistence enforcement that GSD lacked.

**Evidence:**

1. Consumer audit (2026-03-21): "Agent never proactively suggested the next GSDD command... the user becomes the workflow engine"
2. GSD source: `get-shit-done/workflows/progress.md` — every routing branch ends with formatted "Next Up" block showing exact command and alternatives
3. Anthropic "Building effective agents" (2025): workflows should make handoff points explicit with clear next actions
4. Consumer audit issue #6: "verification not persisted to disk" — VERIFICATION.md existed only in chat context, lost on context compression
5. Positional discipline research (Anthropic long-context, 2024): instructions at decision points are followed more reliably than instructions at document start

**Tradeoff:** ~30 new guard assertions to maintain, but prevents the highest-impact consumer UX failure (routing dead ends at every workflow boundary). Persistence gates add 2-3 lines per workflow but prevent artifact loss that breaks downstream audit.

**GSDD implementation:** `distilled/workflows/*.md` (9 files), `tests/gsdd.guards.test.cjs` (G22)

---

## 29. Approach Exploration

**GSD baseline:** Three separate workflows handle pre-planning user alignment:

| GSD workflow | Purpose | Output |
|---|---|---|
| `discuss-phase.md` (541 lines) | Gray area identification, 4-question batched loops per area, deferred ideas capture | `CONTEXT.md` |
| `list-phase-assumptions.md` (179 lines) | 5-dimension assumption surfacing (technical approach, implementation order, scope boundaries, risks, dependencies) | Conversational only (no file output) |
| `discovery-phase.md` | 3-level research (Quick/Standard/Deep) with domain exploration | `DISCOVERY.md` |

Combined, these three workflows provided genuine leverage: the planner could not silently converge on a single approach without user input. GSD's initial GSDD distillation dropped all three, removing this alignment step entirely. The planner was left to infer approaches without user validation.

**Problem:** Without approach exploration, the planner explores no alternatives, surfaces no assumptions, and captures no user decisions. The user's first chance to disagree with approach choices is after implementation — too late for efficient correction.

**GSDD decision:** Recover the discuss-phase leverage as a single role (`agents/approach-explorer.md`) embedded in the plan workflow, with a hybrid interaction architecture:

1. **Primary path (inline + research subagents):** Conversation runs in the plan workflow's main context (required for user interactivity). For each technical gray area, a read-only research subagent spawns, reads codebase/docs, and returns a compressed ~1000-token structured summary. Only summaries enter the conversation context, not raw file reads.

2. **Native agent optimization:** Runtimes with interactive subagent support (Claude Code with `AskUserQuestion`, Codex interactive agents, OpenCode `mode: agent`) can run the full exploration as a native agent. Falls back to the inline primary path if unavailable.

Both paths produce identical output: `{padded_phase}-APPROACH.md` in the phase directory.

**Key enhancements over GSD:**

| Enhancement | GSD pattern | GSDD pattern | Why |
|---|---|---|---|
| Gray area classification | All areas treated identically | Taste / technical / hybrid classification | Taste decisions need no research; technical ones do. Asking "what color?" the same way as "JWT vs sessions?" wastes context and user time |
| Questioning style | Rigid 4-question batched loop | Adaptive convergence (2-6 questions depending on complexity) | Fixed batch sizes don't match decision complexity. Some areas resolve in 2 questions, others need 6 |
| Pre-question research | No research before asking | Research subagent per technical area returns structured summary before asking | Users make better decisions when presented with researched options and trade-offs |
| Quality gate | None | Self-check before writing APPROACH.md (concrete decisions, no vague language, source backing, scope compliance) | Prevents weak outputs that force re-asking during planning |
| Intermediate persistence | No persistence until final output | Confirmed decisions written to disk incrementally | Protects against context limits in long conversations |
| Context loading | "Read everything" | JIT extraction guidance (e.g., "From SPEC.md read ONLY locked decisions") | Prevents context pollution with irrelevant content |
| Plan-checker integration | None | New `approach_alignment` dimension in plan-checker | Verifies plans honor approach decisions, not just requirements |
| Delegation option | Not available | "Agent's Discretion" — user can explicitly delegate choices to the agent | Reduces user fatigue on areas where they have no strong preference |

**Role contract design:** Ground-up rewrite applying prompt engineering best practices:

- XML semantic structure (`<role>`, `<algorithm>`, `<examples>`, `<anti_patterns>`, `<quality_guarantees>`) matching the planner role pattern
- 3 few-shot conversation examples (taste decision, technical decision with research, hybrid with delegation)
- Vendor-neutral throughout — no tool-specific references in the role contract
- Anti-patterns placed early for high attention weight

**Architecture rationale — why hybrid:**

The approach explorer needs two capabilities with opposite context requirements:
- **Conversation** needs the main context (for user interaction)
- **Research** generates thousands of tokens of raw content the conversation doesn't need

Isolating research in subagents and returning compressed summaries follows the Compress and Isolate patterns from context engineering literature. The research subagent prompt template lives in the role contract (`<research_subagent_prompt>` section of `agents/approach-explorer.md`) — co-located with the algorithm it serves, and referenced by the portable workflow rather than inlined. The main context budget stays manageable: ~1000 tokens orchestration + ~4000 tokens research summaries (4 areas × ~1000) + ~4000 tokens conversation + ~500 tokens APPROACH.md = ~9500 tokens. The 1000-token budget (matching Anthropic CE's recommended floor) gives research subagents room for the structured format (Name/Pro/Con/Source) plus recommendation reasoning, source verification, and enough project-specific context that the main agent can handle follow-up questions without re-querying the subagent.

**Evidence:**

1. Anthropic "Building effective agents" (2025): sub-agents perform deep technical work, returning condensed summaries to the orchestrator — "find the smallest set of high-signal tokens"
2. Anthropic prompting best practices (2025): XML tags for semantic structure, role preamble, few-shot examples, adaptive thinking
3. LangChain "Context Engineering for Agents" (2025): Write/Select/Compress/Isolate patterns — "isolate: split context across separate processes", "compress: summarize at agent-agent boundaries"
4. Agent Skills specification (agentskills.io): progressive disclosure, SKILL.md format with metadata-first structure
5. OpenAI meta-prompting (2025): LLM-as-judge evaluation, specification-based output quality verification
6. GSD source: `get-shit-done/workflows/discuss-phase.md` (gray area identification, AskUserQuestion interaction, deferred ideas)
7. GSD source: `get-shit-done/workflows/list-phase-assumptions.md` (5-dimension assumption surfacing with confidence levels)
8. GSD source: `get-shit-done/workflows/discovery-phase.md` (3-level research workflow)

**Trade-offs:**

- Benefit: planner receives locked user decisions instead of guessing approaches; plan-checker can verify approach alignment; context stays lean via research isolation
- Cost: adds one interactive step before planning (~5-15 minutes of user time per phase); hybrid architecture is more complex than a single monolithic workflow
- Mitigation: `workflow.discuss: true|false` toggle in `.planning/config.json` allows skipping with explicit `reduced_alignment` reporting; taste areas skip research entirely. Default is `false` (opt-in) to stay consistent with GSDD's stripped-down identity; users enable it explicitly

**GSDD implementation:** `agents/approach-explorer.md` (role contract), `distilled/templates/delegates/approach-explorer.md` (thin delegate), `distilled/templates/approach.md` (output template), `distilled/workflows/plan.md` (`<approach_exploration>` section), `agents/planner.md` (`<approach_decisions>` section), `distilled/templates/delegates/plan-checker.md` (`approach_alignment` dimension), `bin/adapters/claude.mjs` + `bin/adapters/opencode.mjs` + `bin/adapters/codex.mjs` (native agent rendering)

---

## 30. Hardening Propagation

**Problem:** D28 introduced three hardening patterns (positional STOP gates, mandatory persistence with STOP-on-failure, guard-backed regression prevention) but applied them selectively: STOP gates only in `new-project.md`, persistence gates only in `execute.md` and `verify.md`. Three medium-tier workflows (`quick.md`, `map-codebase.md`, `new-project.md`) and two consistency targets (`audit-milestone.md`, `pause.md`) produce equally critical artifacts but lacked these protections.

**Decision:** Propagate D28 patterns to all workflows that produce durable artifacts, organized into three tiers. Intentionally exclude read-only workflows (`progress.md`) and workflows with adequate existing coverage (`resume.md`).

| Tier | ID | Workflow | Hardening | Pattern Source |
|------|-----|----------|-----------|----------------|
| 1 | H1 | `quick.md` | MANDATORY persistence gates for SUMMARY.md and VERIFICATION.md | `execute.md` SUMMARY gate |
| 1 | H2 | `quick.md` | Positional STOP gate between plan and execute | `new-project.md` STOP gates |
| 1 | H3 | `map-codebase.md` | Semantic quality check on mapper outputs (L2 substantiveness) | `verify.md` L1/L2/L3 checking |
| 1 | H4 | `map-codebase.md` | MANDATORY persistence gate for 4 codebase documents | `execute.md` SUMMARY gate |
| 1 | H5 | `new-project.md` | `<persistence>` section for SPEC.md and ROADMAP.md | `verify.md` `<persistence>` |
| 1 | H6 | `quick.md` | Reduced-assurance plan self-check with `reduced_assurance` label | `plan.md` self-check fallback |
| 2 | H7 | `audit-milestone.md` | MANDATORY persistence gate for MILESTONE-AUDIT.md | `execute.md` SUMMARY gate |
| 2 | H8 | `pause.md` | MANDATORY persistence gate for `.continue-here.md` | `execute.md` SUMMARY gate |
| 2 | H9 | `new-project.md` | Positional STOP gate between spec approval and roadmap creation | `new-project.md` STOP gates |

**Intentional non-propagation:**
- `progress.md`: read-only by contract — writes zero files, modifies zero state. Nothing to gate.
- `resume.md`: state detection already validates artifact existence before routing. No gap.

**Evidence:**

1. D28 consumer audit (2026-03-21): persistence failures and routing dead ends at every workflow boundary — patterns proven effective, scope was incomplete
2. Huang et al. "Large Language Models Cannot Self-Correct Reasoning Yet" (ICLR 2024): LLMs cannot reliably self-correct without external feedback — validates fresh-context checking and explicit STOP gates over implicit behavioral expectations
3. Kamoi et al. "When Can LLMs Actually Correct Their Own Mistakes?" (TACL 2024): self-correction works ONLY with reliable external feedback — validates MANDATORY gates as the external enforcement mechanism
4. Anthropic long-context research (2024): instructions at decision points are followed more reliably than instructions at document start — validates positional STOP placement at exact deviation points
5. D13 consistency argument: mechanical invariant enforcement prevents regression. The same structural pattern should be enforced everywhere it applies, not selectively.

**Tradeoff:** 18 new guard assertions (G24) to maintain, but prevents artifact loss across 5 additional workflows. Each persistence gate adds 1-2 lines to its workflow. Positional STOP gates add 1 line each. The cost is minimal relative to the failure modes prevented (lost SPEC.md, lost checkpoint, empty codebase maps poisoning downstream planning).

**GSDD implementation:** `distilled/workflows/quick.md`, `distilled/workflows/map-codebase.md`, `distilled/workflows/new-project.md`, `distilled/workflows/audit-milestone.md`, `distilled/workflows/pause.md`, `tests/gsdd.guards.test.cjs` (G24)

---

## 31. Outcome Dimension for Plan-Checker

**Problem:** GSDD's plan-checker verifies 7 structural dimensions (requirement coverage, task completeness, dependency correctness, key link completeness, scope sanity, must-have quality, context compliance). All 7 are process supervision — they check whether the plan is well-formed, not whether it achieves the phase goal. A plan can pass all 7 dimensions while producing only scaffolding artifacts that don't deliver the stated outcome.

**Decision:** Add an 8th dimension `goal_achievement` that performs outcome-level verification:

- **Goal addressed?** Do the plan's collective task outputs deliver the phase goal? Tasks that only set up infrastructure without delivering the stated user-facing outcome → `blocker`.
- **Success criteria reachable?** Are ROADMAP.md success criteria traceable to task verify outputs? Each criterion should map to at least one task → `blocker` if unreachable.
- **Outcome observable?** Could a human or automated check confirm the goal was met after execution? Plans producing only internal artifacts with no testable outcome → `warning`.

This creates a hybrid process+outcome verification architecture: 7 structural dimensions (process) + 1 outcome dimension.

**Evidence:**

1. Yu et al. "Outcome-Refining Process Supervision for Code Generation" (ICML 2025): hybrid process+outcome supervision achieves +26.9% correctness over either alone — the strongest evidence for adding outcome-level checks alongside process checks
2. Rajan "Multi-Agent Code Verification via Information Theory" (2025): diminishing returns plateau around 4-7 specialized dimensions. 8 dimensions is within the efficient range; each additional dimension beyond 4 adds +11-15pp detection improvement
3. Lightman et al. "Let's Verify Step by Step" (ICLR 2024): process supervision (per-step feedback) significantly outperforms outcome-only supervision — validates keeping the existing 7 process dimensions while adding outcome as complement, not replacement

**Tradeoff:** One additional dimension for the checker to evaluate per plan. Minimal cost: the goal and success criteria are already available as checker inputs (phase goal from ROADMAP.md, success criteria from ROADMAP.md phase section). No new inputs required.

**GSDD implementation:** `distilled/templates/delegates/plan-checker.md` (`goal_achievement` dimension), `tests/gsdd.guards.test.cjs` (G24 assertions)

---

## 32. Quick Workflow Alignment Hardening

**Problem:** GSDD's quick workflow has exactly one user alignment touchpoint — the task description at Step 1. After "what do you want to do?", the agent has unchecked autonomy over approach selection, scope interpretation, and execution. The full ceremony (`plan.md`) has 3-4 alignment touchpoints (approach exploration, plan review, checker escalation, mandatory verification). This gap is too large: quick mode trades ALL alignment for speed, creating a cliff between "zero agent oversight" and "full multi-round ceremony."

GSD's approach was a `--full` flag that added plan-checking + verification to quick tasks. But a flag you must remember to use doesn't solve alignment — the default mode still had zero user visibility into the plan before execution.

**Decision:** Three targeted interventions that close the alignment gap from 1 to 2-3 touchpoints without killing quick mode's speed advantage:

1. **Plan Preview Gate (mandatory, default-yes):** After the planner returns and the STOP gate verifies the plan exists, present a structured summary (task count, files to touch, 1-sentence approach) and wait for the user. Default-yes: pressing Enter proceeds. Options include edit, abort, and (when scope signal fires) switch to full ceremony. This is the core fix — the user sees agent intent before code changes happen.

2. **Scope Signal with Escalation (advisory, always-on):** Inline orchestrator evaluation checks the plan against quick-scope boundaries: >8 files modified, architecture keywords in description (`refactor`, `migration`, `security`, `auth`, `API design`, `schema`, `database`), new public APIs. If any signal fires, the advisory appears in the plan preview with a recommendation to use `/gsdd-plan` for approach exploration. Advisory only — the user decides. Keyword heuristics have false positives; blocking would train users to ignore the signal.

3. **Config-Gated Independent Plan Check (optional):** When `workflow.planCheck: true` in config.json, the existing plan-checker delegate runs against the quick task plan with 5 of 9 dimensions: `requirement_coverage`, `task_completeness`, `dependency_correctness`, `scope_sanity`, `must_have_quality`. Maximum 1 revision cycle (not 3 — diminishing returns for 1-3 task plans). If blockers remain, they surface in the plan preview for user decision. No new delegate or config key — reuses existing infrastructure.

**GSD comparison:**

| Aspect | GSD `--full` | GSDD D32 |
|--------|-------------|----------|
| Plan visibility | None in default, plan-checker in --full | Always-on preview (default-yes) |
| Activation | Flag per invocation (easy to forget) | Config-driven (project-wide, consistent) |
| Scope awareness | None | Advisory scope signal with escalation |
| Checker scope | Full 5-dimension check (--full only) | 5-dimension quick-scoped check (config-gated) |
| Revision cycles | Max 2 (--full only) | Max 1 (quick tasks don't warrant extended loops) |
| User decision | Force proceed or abort after checker | Preview + scope signal + checker issues → informed decision |

**Evidence:**

1. Risk-adaptive autonomy pattern (AWS, Azure, Anthropic 2025-2026): confirmation gates should scale with consequence level — routine auto-proceeds, uncertain pauses, high-impact requires sign-off. The plan preview is the "pause for uncertain" gate.
2. Human-on-the-loop > human-in-the-loop (Anthropic agent autonomy research 2026): HOTL gives visibility without requiring active management of each step. Default-yes implements HOTL — the user monitors, intervenes only when needed.
3. Osmani / Fowler on spec-driven development (2025): "iterate in small loops, course-correct quickly." The plan preview IS the small-loop checkpoint for quick tasks.
4. Madaan et al. "Self-Refine" (NeurIPS 2023): 1 revision cycle captures most improvement; diminishing returns argue against 3 cycles for 1-3 task plans. Validates max-1 checker cycle for quick scope.
5. Huang et al. "LLMs Cannot Self-Correct Reasoning Yet" (ICLR 2024): self-check without external feedback is unreliable. The plan preview provides external feedback (user eyes on the plan) even when the independent checker is disabled.
6. SkillsBench (Feb 2026): focused skills outperform comprehensive docs. Quick mode should stay focused and escalate to full ceremony when scope exceeds boundaries, not expand to absorb more ceremony.

**Tradeoff:** ~5 seconds overhead for plan preview (default-yes), ~60-90 seconds if independent checker runs. Sub-hour work stays sub-hour. Adds ~60 lines to quick.md (198→~260). No new files, no new delegates, no new config keys.

**GSDD implementation:** `distilled/workflows/quick.md` (Steps 3.5-3.7), `distilled/DESIGN.md` (this section), `tests/gsdd.guards.test.cjs` (G24 assertions for plan preview, scope signal, conditional plan-checker)

---

## 33. Quick Approach Clarification

**Problem:** D32 added post-plan alignment to quick tasks (plan preview, scope signal, optional plan check), but all three interventions are **reactive** — the agent selects the approach unilaterally, writes the plan, then shows it to the user. The user can abort or edit the description, but cannot shape the approach before the planner commits. The full ceremony's `<approach_exploration>` (plan.md) solves this at scale with 3-4 grey areas, research subagents, and persisted APPROACH.md — but that's wrong for sub-hour work.

**Decision:** Add Step 2.5 (Approach Clarification) between Initialize and Plan. Config-gated via the existing `workflow.discuss` toggle — same toggle that gates full ceremony's approach exploration, same intent ("align on approach before planning"), lighter mechanism for quick scope.

The step has a **dual gate** — even with `workflow.discuss: true`, it evaluates the task description for ambiguity signals before asking anything:

| Signal | Detection | Example |
|--------|-----------|---------|
| Multiple valid approaches | Description solvable via distinct patterns | "add caching" (Redis? in-memory? HTTP headers?) |
| Destructive operations | Contains: `delete`, `remove`, `migrate`, `rename`, `replace`, `rewrite`, `drop` | "remove the old auth middleware" |
| Vague scope | Contains: `improve`, `fix`, `update`, `refactor`, `clean up`, `optimize` without specifying target | "improve error handling" |
| Trade-off present | Implies competing goals | "make it faster" (algorithmic? caching? denormalization?) |

If no signals fire, the step skips silently — no questions asked, even with toggle on. When signals fire, the orchestrator identifies 1-2 grey areas and asks targeted questions in **recommendation-first format**: "I'd approach this with X because Y. Want me to proceed, or do you prefer Z?" Maximum 2 questions — if a task has 3+ grey areas, the scope signal (D32) should already be recommending `/gsdd-plan`.

Output is inline `$APPROACH_CONTEXT` (e.g., "User confirmed: use in-memory LRU cache, not Redis") passed to the planner as locked constraints. No APPROACH.md file — file artifacts add overhead with no return for sub-hour work.

**GSD comparison:** GSD has no pre-plan questioning in quick mode. The `--full` flag adds plan-checking and verification but not approach alignment — the agent still decides the approach unilaterally in all modes.

| Aspect | GSD Quick | GSDD Quick (D32) | GSDD Quick (D32+D33) | GSDD Full Ceremony |
|--------|----------|------------------|---------------------|-------------------|
| Pre-plan alignment | None | None | 1-2 questions (conditional) | 3-4 grey areas + research subagents |
| Post-plan alignment | None (--full adds checker) | Preview + scope signal | Preview + scope signal | Checker blocks (max-3 cycles) |
| Approach persistence | None | None | Inline context only | APPROACH.md file |
| User alignment rounds | 1 | 2-3 | 2-4 | 3-4 |

**Evidence:**

1. Anthropic "Measuring AI agent autonomy in practice" (2025): Claude asks 2x+ more on complex tasks; uncertainty awareness is treated as a safety property. D33's ambiguity detection formalizes what Claude naturally does — ask when uncertain, proceed when confident.
2. Knight First Amendment Institute "Levels of Autonomy for AI Agents" (2025): 5-level autonomy spectrum. Quick tasks map to Level 3 ("Consultant"): agent decides, asks when uncertain. D33 implements this — agent leads with recommendation, asks only on ambiguity.
3. Anthropic "Framework for safe and trustworthy agents" (2025): recommendation-first framing validated. "I'd do X because Y. Approve?" outperforms open-ended "What should I do?" — preserves agent leadership while giving user override.
4. Martin Fowler "Humans and Agents in SE Loops" (2025): HOTL > HITL — agents handle 95% autonomously, pause for 5% edge cases. D33 asks only when ambiguity detected, not on every task.
5. Huang et al. "LLMs Cannot Self-Correct Reasoning Yet" (ICLR 2024): LLMs cannot reliably self-correct without external feedback. Pre-plan user input catches approach errors that self-check cannot detect.
6. Anthropic trust calibration data (2025): users auto-approve 20% initially → 40% by session 750+. Config-gated design respects this — experienced users who trust the agent disable `workflow.discuss`.

**Counter-evidence addressed:** Asking too much creates HITL bottleneck (iMerit 2025, McKinsey 2025) → mitigated by dual gate (config + ambiguity detection). Open-ended questions reduce user confidence (Anthropic best practices) → mitigated by recommendation-first format. Routine tasks shouldn't be interrupted (SkillsBench Feb 2026) → mitigated by silent skip when no ambiguity detected.

**Competitor landscape:** Cursor uses explicit mode selection (Ask vs Agent) without automatic ambiguity detection. GitHub Copilot uses post-hoc PR review only. GSD uses per-invocation `--full` flag. None do automatic ambiguity-sensitive pre-plan questioning.

**Tradeoff:** ~15-30 seconds overhead when triggered (1-2 questions). Skipped entirely when no ambiguity detected, even with toggle on. Adds ~40 lines to quick.md. No new files, no new delegates, no new config keys — reuses existing `workflow.discuss` toggle.

**GSDD implementation:** `distilled/workflows/quick.md` (Step 2.5), `distilled/DESIGN.md` (this section), `tests/gsdd.guards.test.cjs` (G24 assertions for approach clarification, ambiguity signals, recommendation-first format)

---

## 34. Context Engineering Applied to Quick Workflow

**GSD:** GSD quick.md has `<purpose>`, `<required_reading>`, `<process>` (XML outer sections) with `**Step N:**` bold markdown inside `<process>`. No `<anti_patterns>` section. No authority language conventions for process gates.

**GSDD (before D34):** Same XML outer sections with markdown step headers inside `<process>`. All 9 role contracts have `<anti_patterns>` after `<role>` (documented in DISTILLATION.md as mandatory placement), but quick.md — an orchestrator consumed by AI agents — had none. Authority language mixed between `**STOP.**` and `**MANDATORY:**` across 3 file-verification gates.

**GSDD (D34):** Two targeted changes applying context engineering principles from the prompty/agentskit reference implementation (28 primary sources) and Anthropic prompting guidance:

**Change 1: `<anti_patterns>` section.** Added 7 anti-patterns after `<role>`, matching the 5-8 item range used by role contracts. Each maps to a real workflow gate (plan preview, file verification, max 2 questions, no APPROACH.md, no ROADMAP/SPEC updates, config.json reads, no scope expansion). This is the single highest-value context engineering improvement — it gives agents explicit "don't do this" guardrails for the workflow's most critical gates.

**Change 2: Authority language normalization.** `**MANDATORY:**` → `**STOP.**` on 2 of 3 file-verification gates. DISTILLATION.md resolves authority language vocabulary: CRITICAL for initial-read gates, normal imperative language for process gates. STOP is the correct word for "halt and check" gates; MANDATORY is not in the resolved vocabulary.

**What was investigated but NOT changed:**

| Finding | Decision | Why |
|---------|----------|-----|
| Steps use markdown headers, not XML `<step>` tags | Keep markdown headers | All 10 GSDD workflows use the same pattern. prompty's agentskit-architect SKILL.md uses the identical pattern (single `<algorithm>` container with text step labels). Changing quick.md alone creates cross-workflow inconsistency. Candidate for a future cross-workflow PR. |
| No `<output_contract>` section | Not needed | `<completion>` section already specifies what the workflow produces — paths, status, next steps |
| No `<input_contract>` section | Not needed | `<prerequisites>` section already covers required preconditions |
| No progressive disclosure restructuring | Not needed | ~350 lines is within the agentskills.io 500-line recommended limit |
| Caching-friendly ordering | Already correct | Static content (role, anti_patterns, prerequisites) at top, variable content (process steps) below |

**Evidence:**

| Source | Contribution |
|--------|-------------|
| Anthropic Claude Prompting Best Practices [S1] | "Claude has been specifically tuned to pay special attention to your structure when using XML tags." Validates XML for section boundaries. Anti-patterns placed early for attention weight. |
| DISTILLATION.md (GSDD internal) | "Anti-patterns early — Place 'don't do this' instructions near the top, after role definition." Cross-source validated pattern across all 9 role contracts. Authority language resolution: CRITICAL for initial-read, normal language elsewhere. |
| Selective Prompt Anchoring, arxiv 2408.09121 (2024) | Up to 12.9% Pass@1 improvement from strategic attention anchoring. XML tags create hard attention boundaries; markdown headers may be treated as content formatting. |
| agentskit-architect SKILL.md (prompty) | Uses single `<algorithm>` container with text step labels inside — same structural pattern as GSDD's `<process>` with markdown headers. Validates the hybrid XML-outer/markdown-inner approach. |
| Manus AI Context Engineering [S5] | "Filesystem as extended context" — structural quality of prompt files directly impacts agent behavior. Validates treating workflow files as engineered artifacts, not documentation. |
| agentskit-evaluator SKILL.md (prompty) | Authority language audit: "CRITICAL only for gates?" is a scored compliance check. Validates normalizing gate vocabulary. |

**Scope:** quick.md only. If `<anti_patterns>` proves valuable for orchestrators, extend to plan.md and other workflows in a follow-up PR.

**GSDD implementation:** `distilled/workflows/quick.md` (`<anti_patterns>` section, STOP normalization), `distilled/DESIGN.md` (this section), `tests/gsdd.guards.test.cjs` (G26 assertions for anti_patterns placement, content, gate language consistency, XML structural sections)

---

## 35. Skills-Native Runtimes vs Governance Adapters

**Problem:** Repo surfaces had started conflating two different questions:
1. Does the runtime discover `.agents/skills/` natively?
2. What extra generated adapter artifact does `gsdd init --tools <runtime>` add?

That conflation was survivable while Cursor and Copilot were incorrectly treated as governance-first tools, but it became actively misleading once live testing proved they were skills-native. Gemini then moved into the same bucket via user-performed live validation on 2026-03-25. The old grouped README / AGENTS wording wrongly implied the root `AGENTS.md` block was required for workflow discovery on those runtimes.

**Decision:** Separate runtime capability from generated adapter artifact kind.

- Cursor, Copilot, and Gemini are documented as **skills-native runtimes**: they discover `.agents/skills/gsdd-*` and surface the workflows directly as slash commands.
- `--tools cursor`, `--tools copilot`, `--tools gemini`, and `--tools agents` still generate the same root `AGENTS.md` bounded block, but that artifact is **governance only**.
- The root `AGENTS.md` block remains valuable behavioral discipline, but it must not be described as the workflow-discovery mechanism for a skills-native runtime.
- No new runtime-specific adapter files are introduced just to make the docs read cleaner. The generated artifact model stays simple unless a stronger runtime-specific UX is actually needed.

**Why this fits the architecture:** The adapter code already had the right implementation shape: one shared root-governance generator (`createRootAgentsAdapter`) with different runtime labels. The bug was the capability story wrapped around it. Fixing the narrative without inventing redundant adapter files preserves leverage and keeps the portable `.agents/skills/` surface as the canonical entry layer.

**Evidence:**

1. Live consumer testing (2026-03-20) proved Cursor and Copilot auto-discover `.agents/skills/` and expose slash commands without AGENTS.md.
2. User-performed live validation (2026-03-25) confirmed the same behavior for Gemini.
3. GSDD implementation already always generates `.agents/skills/` and uses the root `AGENTS.md` block as a bounded governance upsert, not as a workflow source.
4. This resolution matches the repo rule that skills, adapters, and governance surfaces must not be conflated.

**GSDD implementation:** `README.md`, `distilled/templates/agents.block.md`, `bin/lib/init.mjs`, `SPEC.md`, `.internal-research/TODO.md`, `.internal-research/gaps.md`, `.internal-research/lessons-learned.md`, `tests/gsdd.guards.test.cjs`

---

## 36. Interactive Init Wizard

**Problem:** `gsdd init` had two mismatched onboarding models at once. The public story was moving toward skills-native runtimes and optional governance, but the actual CLI still made users memorize `--tools ...` values as the primary install experience. The only interactive part was the config questionnaire, which started after filesystem writes and did not help the user decide which runtime surfaces or governance overlays to install.

**Decision:** Make `gsdd init` a guided install wizard in TTY environments, while preserving `--tools` and `--auto` as the manual/headless contract. The guided path must stay intentionally compact: runtime choice, governance opt-in, and a small set of bundled planning defaults rather than a long per-setting questionnaire.

- Step 1: choose runtimes/vendors with a simple checkbox-style selector (space toggles, enter confirms).
- Step 2: ask separately whether to install repo-wide `AGENTS.md` governance, with explicit explanation of why it helps and why it may feel invasive.
- Step 3: collect the planning defaults through two orthogonal bundled choices (`Rigor` and `Cost`) plus the separate `.planning` tracking choice, instead of a long per-setting questionnaire.
- Portable `.agents/skills/gsdd-*` skills remain the always-generated baseline.
- Legacy values such as `--tools cursor`, `--tools copilot`, and `--tools gemini` remain valid for backward compatibility.

**Key architectural rule:** runtime selection and adapter generation are separate concerns.

- In the wizard, choosing Cursor/Copilot/Gemini affects post-init routing and user-facing install intent, but does **not** silently write root `AGENTS.md`.
- Root `AGENTS.md` is generated only when the user explicitly opts into governance (wizard) or explicitly requests a governance-writing flag path (`--tools agents`, `--tools all`, or legacy runtime aliases).
- This keeps D35's capability split honest instead of re-conflating skills-native runtime choice with governance-file generation.

**Phase 17 refinement:**

- The guided config path was reduced from 13 visible prompts to 5.
- `Rigor` controls `researchDepth` and workflow strictness (`research`, `discuss`, `planCheck`) while keeping `workflow.verifier` always on.
- `Cost` controls `modelProfile` and `parallelization` independently, so combinations such as `thorough + budget` remain reachable.
- `gitProtocol` remains in `config.json` with defaults but is intentionally out of the wizard until a dedicated UX pass decides the right shape.

**Why this fits the codebase:** The adapter registry and `init.mjs` already own the right boundary. The high-leverage change was to add a decision layer in front of writes, not to invent a new adapter model or a new config schema. This keeps the CLI lightweight, preserves backward compatibility, and makes the default install path match the product story.

**Evidence:**

1. Existing repo truth: `gsdd init` always generates `.agents/skills/` and already has a central adapter-selection seam in `bin/lib/init.mjs`.
2. Local research on the adjacent `prompty` repo: portable skills are the primary install surface, while native command surfaces are optional additions.
3. External: npm init (Node.js), Vite `create-vite`, Next.js `create-next-app`, Angular CLI `ng new`, and Astro `create astro` all implement the same pattern — TTY-interactive wizard by default, `--yes`/`--defaults` for headless; this is the de facto standard for modern project scaffolding tools.
4. Repo lesson LL-INSTALL-DX-BEFORE-ALIAS-CLEANUP already recorded that install ergonomics should be fixed before alias-policy cleanup.

**GSD comparison:** GSD's install surface is more operator-heavy and framework-specific. GSDD keeps the deterministic bootstrap principle but shifts the user-facing choice surface into a lightweight guided CLI instead of requiring users to know adapter values in advance.

**GSDD implementation:** `bin/lib/init.mjs`, `bin/lib/init-flow.mjs`, `bin/lib/init-prompts.mjs`, `bin/lib/models.mjs`, `bin/gsdd.mjs`, `README.md`, `distilled/README.md`, `SPEC.md`, `.internal-research/TODO.md`, `.internal-research/gaps.md`, `.internal-research/lessons-learned.md`, `tests/gsdd.init.test.cjs`, `tests/gsdd.consumer-ceremony.test.cjs`, `tests/gsdd.guards.test.cjs`

---

## 37. Mutability-Driven Workflow Classification

**Problem:** GSDD had started treating several artifact-writing workflows as planning-class surfaces in the workflow registry. That looked semantically neat (`new-project`, `plan`, `verify`, `audit-milestone`, `pause`, `resume` all sound like "thinking" work), but it created a runtime contradiction: the workflow contract required disk persistence while the generated surface could be interpreted as a read-only planning lane.

**Decision:** Classify workflow surfaces by mutability, not by whether the workflow feels like planning.

- Any workflow that writes or deletes durable artifacts emits `agent: Code` and `opencodeType: edit`.
- Only truly read-only workflows emit `agent: Plan` and `opencodeType: plan`.
- `progress` remains the only read-only workflow in the current lifecycle.
- The registry now records this explicitly via `mutatesArtifacts` so future changes have an inspectable invariant instead of relying on naming intuition.

**Why this fits the codebase:** GSDD's real leverage depends on docs-to-disk persistence. `new-project`, `plan`, `verify`, `audit-milestone`, `pause`, and `resume` are orchestration-heavy, but they are still state-changing workflows. Treating them as read-only breaks the artifact chain that downstream workflows consume.

**Kept / stripped / gained relative to the previous state:**

- **Kept:** the existing portable workflow content, native plan-checker surfaces, and the distinction between read-only reporting (`progress`) and artifact-producing lifecycle work.
- **Stripped:** the informal assumption that "planning-like" workflows should all share the `Plan` lane.
- **Gained:** an explicit mutability invariant, generated-surface tests, and safer behavior in runtimes that enforce planning/read-only execution semantics.

**Evidence:**

1. `distilled/workflows/verify.md`, `new-project.md`, `audit-milestone.md`, `pause.md`, and `resume.md` all require artifact writes or deletions as part of completion.
2. `distilled/workflows/progress.md` is the only workflow that explicitly declares itself read-only.
3. Consumer audit evidence already showed verification reports being lost when persistence was skipped; this decision closes the registry seam that could recreate the same class of failure.
4. External: Meyer's Command-Query Separation (CQS, "Object-Oriented Software Construction" 1988) — the foundational principle that operations should be classified by whether they modify state, not by what they conceptually represent; Greg Young's CQRS (2010) — CQS applied at the architectural level; Unix rwx permission model and AWS IAM/Kubernetes RBAC all classify operations by mutation semantics rather than by semantic category name

**GSD comparison:** GSD's leverage also depends on persisted workflow artifacts. GSDD's portable/runtime split adds a new failure mode GSD did not have in the same form: a generated adapter can misclassify a mutating workflow even when the markdown contract is correct. This decision makes the adapter/runtime layer honor the artifact contract instead of undermining it.

**GSDD implementation:** `bin/gsdd.mjs`, `bin/lib/rendering.mjs`, `tests/gsdd.init.test.cjs`, `tests/gsdd.plan.adapters.test.cjs`, `tests/gsdd.guards.test.cjs`, `SPEC.md`, `.internal-research/TODO.md`, `.internal-research/gaps.md`, `.internal-research/lessons-learned.md`

---

## 38. Retroactive Artifact Enforcement

**Problem:** ROADMAP.md phase `[x]` can be marked complete without the required artifacts (PLAN.md, SUMMARY.md, VERIFICATION.md) existing on disk. No mechanical gate prevents phase advancement without artifacts. This gap (I27) recurred twice in the v1 milestone:

- Sub-gap (a): early session termination drops final bookkeeping — ROADMAP marked `[x]` with no VERIFICATION.md.
- Sub-gap (b): `verify.md` structural omission — even on full lifecycle success, ROADMAP stayed stale because only `execute.md` updated it.

Sub-gap (b) was closed by D28's `<persistence>` mandate and guarded by G30. Sub-gap (a) requires either a preventive CLI gate or an explicit accept-by-design decision.

**Decision:** Accept milestone-audit as the retroactive enforcement layer for sub-gap (a). Do not add a preventive CLI gate.

**Rationale:**

1. **Artifact mandates already exist.** D28 added `<persistence>` sections with MANDATORY language to `execute.md` and `verify.md`. D30 propagated them to `quick.md`, `map-codebase.md`, `audit-milestone.md`, and `pause.md`. The specification-level enforcement is in place across all artifact-producing workflows.

2. **Kernel simplicity.** Adding a preventive gate (e.g., `gsdd verify` checking artifact existence before allowing ROADMAP updates) would require every workflow to call a CLI guard before its state update. This creates a new coupling between the CLI layer and the workflow layer — complexity the kernel explicitly avoids. See `.internal-research/strategy.md` section on policy depth vs kernel purity.

3. **Retroactive audit is sufficient.** The milestone audit (`audit-milestone.md`, `agents/integration-checker.md`) checks artifact completeness across all phases as its first step. Violations surface as structured gaps, not silent passes. The audit cost is bounded and predictable.

4. **Gap already has guard coverage.** G30 mechanically enforces that `verify.md` closes ROADMAP on passed status. The sub-gap (b) failure mode is now guarded. Sub-gap (a) (session interruption) is a behavioral failure by the agent, not a structural gap in the spec — no guard can prevent a session from crashing mid-workflow.

5. **GSD comparison.** GSD has no preventive artifact gate either. GSD's enforcement relies on its mandatory commit steps and `gsd-tools.cjs` CLI calls. GSDD's design choice strips mandatory commits (D8) and CLI-gated workflow steps (D9), trading off some enforcement depth for portability. Milestone audit is the equivalent retroactive layer.

**What this decision closes:** I27 sub-gap (a) is accepted by design. The full I27 gap is now CLOSED: sub-gap (b) by D28/G30, sub-gap (a) by this decision.

**Evidence:**

- `.internal-research/gaps.md` I27 entry (two occurrences, root-cause analysis, close conditions)
- D28 mandate language in `distilled/workflows/execute.md` and `distilled/workflows/verify.md`
- D30 propagation to all artifact-producing workflows
- G30 guard in `tests/gsdd.guards.test.cjs` (verify.md ROADMAP closure)
- `.internal-research/strategy.md` (kernel simplicity vs policy depth trade-off)
- `distilled/workflows/audit-milestone.md` (retroactive artifact completeness check)
- External: NIST SP 800-53 Rev. 5 (2020) — distinguishes detective controls (post-event detection) from preventive controls (pre-event blocking) as equally valid risk-management strategies; ISO 27001 risk treatment options — the choice of detective vs preventive control depends on cost/complexity tradeoff, not on which is inherently superior; Reason's Swiss Cheese model (1990) — layered defense-in-depth where retroactive audit layers catch what preventive layers miss; session interruption is a distributed systems failure mode (analogous to the Two Generals problem) that cannot be fully eliminated by local gates

**GSD comparison:** GSD's `gsd-tools.cjs` CLI enforces workflow progression gates directly. GSDD replaces those with specification-level MANDATORY language (D9). This is a deliberate portability trade-off, not an oversight.

**GSDD implementation:** `distilled/workflows/execute.md` (SUMMARY.md persistence gate), `distilled/workflows/verify.md` (VERIFICATION.md persistence gate + ROADMAP closure), `distilled/workflows/audit-milestone.md` (retroactive artifact check), `tests/gsdd.guards.test.cjs` (G30), `distilled/EVIDENCE-INDEX.md` (D38 entry)

---

## 39. Brownfield Entry Wiring

**Problem:** The brownfield path was structurally incomplete. `map-codebase` generated useful orientation artifacts, but it routed users only toward full project initialization. `quick` remained blind to those same codebase maps, so brownfield users who wanted disciplined feature work without full roadmap ceremony had no first-class lane.

**Decision:** Wire the existing brownfield lane instead of adding a new workflow.

- `map-codebase` completion now offers two explicit next steps: `/gsdd-new-project` for full lifecycle setup and `/gsdd-quick` for brownfield feature work.
- `quick` now reads `.planning/codebase/ARCHITECTURE.md` and `.planning/codebase/STACK.md` when they exist and passes a summarized `$CODEBASE_CONTEXT` into the planner delegate.

**Why this shape:** The missing leverage was routing and context reuse, not another onboarding surface. Reusing the existing codebase map artifacts preserves the current workflow set, keeps quick mode lightweight, and gives brownfield users immediate architecture awareness without forcing full milestone ceremony.

**Tradeoff:** This gives `quick` orientation, not full brownfield inference. It deliberately avoids turning quick mode into a lite `new-project`; the planner receives only a bounded summary from the codebase maps, not a new research phase.

**GSD comparison:** GSD's brownfield posture is centered on the full project-initialization flow after mapping. GSDD keeps the full path available, but adds an explicit lighter-weight branch for feature-by-feature brownfield work.

**GSDD implementation:** `distilled/workflows/quick.md` (Step 2 codebase context, planner context), `distilled/workflows/map-codebase.md` (completion routing), `tests/gsdd.guards.test.cjs`, `tests/gsdd.scenarios.test.cjs`

**Evidence:**

- User brownfield audit finding (2026-03-20): mapping was useful, but the lighter-weight feature-work lane was not explicit
- D32-D34 quick-workflow hardening: alignment and scope controls already existed, so the remaining gap was routing plus codebase-context reuse
- `distilled/workflows/quick.md` (Step 2 codebase-context read, planner delegate context)
- `distilled/workflows/map-codebase.md` (completion offers `/gsdd-quick` as the brownfield lane)
- `tests/gsdd.guards.test.cjs`, `tests/gsdd.scenarios.test.cjs`

---

## D40 - Three-Layer Continuity Boundary

**Decision (2026-03-30):** GSDD adopts an explicit three-layer continuity boundary so cold-start recovery, resume behavior, and future continuity work do not blur durable truth, live workflow state, and the still-missing compressed judgment layer.

**Context:**
- Gap S6 showed that cold-start continuity was stronger on artifact and state recovery than on decision-quality recovery. The repo could reconstruct what was built, but not always the smallest why/why-not layer needed for equally strong planning after a restart.
- Phase 7 requirement JUDGE-01 required the continuity model to be named and adopted explicitly instead of being inferred from scattered docs.
- Lesson `LL-ARTIFACT-PERSISTENCE-IS-NOT-ENOUGH` already established the core failure mode: artifacts preserve what was built, but not the minimum judgment layer needed to continue with the same decision posture.

**Decision text:**
- **Durable Truth**: files that survive across milestones and cold starts and define product or framework truth. This layer includes `SPEC.md`, `distilled/DESIGN.md`, `MILESTONES.md`, milestone archives, `config.json`, codebase maps, research artifacts, role contracts, and workflow definitions.
- **Live Workflow State**: files that describe current progress, active execution position, or resumable session state. This layer includes `ROADMAP.md`, phase `PLAN`/`APPROACH`/`SUMMARY`/`VERIFICATION` artifacts, `.continue-here.md`, quick task logs, and `generation-manifest.json`.
- **Compressed Judgment**: the smallest persistence surface for active constraints, unresolved uncertainty, decision posture, and anti-regression rules. This layer is recognized as necessary but not yet fully designed; its persistence surface is deferred to Phase 8.
- Workflow changes must classify artifacts against this boundary. Readers must not infer durable truth from live-state artifacts alone, and writers must not collapse multiple layers into a new catch-all state file.

**Evidence:**
- Phase 7 exploration reviewed all 14 current workflow files and mapped which artifacts they read, write, or treat as primary truth. The review found durable artifacts and live-state artifacts in use, but no explicit three-layer model naming compressed judgment as its own continuity concern.
- D12 established the "artifact-derived state, no `STATE.md`" direction, which kept GSDD repo-native and file-backed, but did not define a distinct compressed judgment layer.
- D26 hardened routing and session continuity contracts, but likewise operated on artifacts and checkpoints without naming the broader continuity boundary.
- The three-layer boundary therefore emerged from Phase 7 as a missing architectural definition rather than a reversal of prior decisions.

**Consequences:**
- Phase 8 must define the compressed-judgment persistence surface and workflow-consumption rules needed to satisfy JUDGE-02 and JUDGE-03.
- Future workflow and artifact changes should explicitly classify any touched file as durable truth, live workflow state, or compressed judgment before changing its contract.
- `distilled/workflows/resume.md` is the first workflow to adopt this boundary directly by validating live checkpoint state against durable roadmap truth without inventing a new project-scoped state file.

**GSDD implementation:** `.planning/SPEC.md` (Continuity Layers constraint, Key Decisions row), `distilled/DESIGN.md` (this decision), `distilled/workflows/resume.md` (first workflow adoption)

---

## D41 - Compressed Judgment Persistence Surface

**Decision (2026-03-30):** GSDD persists compressed judgment as a bounded `<judgment>` XML block with four sections in two existing surfaces: the checkpoint for mid-phase cold restarts and the phase SUMMARY for phase-to-phase handoffs.

**Context:**
- Phase 7 defined the three-layer continuity boundary in D40, but explicitly left the compressed judgment persistence surface undefined as a Phase 8 target.
- JUDGE-02 requires the judgment layer to use existing primary or checkpoint artifacts rather than inventing a new project-scoped state file.
- JUDGE-03 requires planning, execution, verification, and resume to recover judgment at entry without relying on chat memory.
- Gap S6 showed that artifact persistence alone preserves what was built, not the smallest why/why-not layer needed to continue with the same decision posture.
- Lesson `LL-ARTIFACT-PERSISTENCE-IS-NOT-ENOUGH` established that the continuity problem is not solved by durable artifacts alone.

**Decision text:**
- Persist compressed judgment as a bounded `<judgment>` XML block with four sections: `<active_constraints>`, `<unresolved_uncertainty>`, `<decision_posture>`, and `<anti_regression>`.
- Embed the exact same shape in two existing surfaces:
  - the checkpoint (`.continue-here.md`), written by `pause.md` at session pause and read by `resume.md` for mid-phase cold restarts
  - the phase `SUMMARY.md`, written by `execute.md` at phase completion and read by `plan.md`, `execute.md`, and `verify.md` for phase-to-phase handoffs
- The shape must remain identical in both locations so the judgment layer is consistent across lifecycle entry points.
- No new project-scoped state file is introduced.

**Evidence:**
- Phase 8 reviewed the four workflow entry points that need judgment recovery: `plan.md`, `execute.md`, `verify.md`, and `resume.md`.
- The review mapped each workflow's current `<load_context>` or artifact read path and confirmed that checkpoint and SUMMARY are already in the natural read/write flow of these workflows.
- `SUMMARY.md` already carries "Notes for Next Work", but that section is unstructured prose and is not consumed by any workflow's `<load_context>`.
- The checkpoint already stores session-local state and decisions, but it does not capture a cumulative, bounded judgment layer with the four facets needed for continuity.
- The dual-surface approach covers both required handoff scenarios without inventing a new persistence path: checkpoint for mid-phase restart, SUMMARY for phase-to-phase continuation.

**Consequences:**
- Future workflow changes must maintain judgment read/write integration at these designated points rather than creating ad hoc persistence surfaces.
- The judgment shape is intentionally bounded to four sections and must not expand into an unbounded session log.
- Phase 9 remains responsible for runtime metadata and portability concerns (ADAPT-02); judgment portability across runtimes is not broadened here.

**GSDD implementation:** `.planning/SPEC.md` (Key Decisions row), `distilled/workflows/pause.md` (checkpoint write), `distilled/workflows/execute.md` (SUMMARY write and prior-summary read), `distilled/workflows/plan.md` (prior-summary read), `distilled/workflows/verify.md` (summary judgment verification input), `distilled/workflows/resume.md` (checkpoint read and surfacing)

---

## D42 - Session-Boundary Safety

**Decision (2026-04-04):** `.continue-here.bak` survives `resume.md` dispatch so downstream workflows can read it as a fallback judgment source when no prior SUMMARY.md `<judgment>` section is available. The downstream workflow auto-cleans `.bak` after absorbing the judgment.

**Context:**
- D41 established two judgment persistence surfaces: checkpoint (`.continue-here.md`) and phase SUMMARY.md.
- `resume.md` copies `.continue-here.md` to `.continue-here.bak` during `<cleanup_checkpoint>` (crash safety), then previously deleted `.bak` in `<completion>` before dispatching.
- When a user clears context between resume and the dispatched workflow, session-specific judgment is permanently lost: `.continue-here.md` already deleted, `.bak` already deleted, and the prior SUMMARY.md only carries the *prior completed phase's* judgment — not the interrupted session's `<active_constraints>`, `<decision_posture>`, or `<anti_regression>` rules.
- `pause.md` line 53 already deletes stale `.bak` files from prior crashed resumes — this crash-cleanup path remains unchanged.

**Decision:**
- `resume.md` `<completion>` no longer deletes `.planning/.continue-here.bak`.
- `plan.md`, `execute.md`, `verify.md`, and `quick.md` read `.planning/.continue-here.bak` as a fallback judgment source if no prior SUMMARY.md `<judgment>` section is available, then auto-clean it.
- `pause.md` `.bak` cleanup (crash-recovery path, line 53) remains unchanged.

**Transition safety table:**

| Transition | Judgment source | `.bak` state after | Risk |
|---|---|---|---|
| pause → resume (same session) | `.continue-here.md` live in context | `.bak` created by `<cleanup_checkpoint>` | None: judgment in context |
| resume → workflow (same session, no context clear) | Judgment in context from resume | `.bak` on disk, ignored | None: judgment in context |
| resume → [context clear] → workflow | `.bak` fallback read | Deleted by workflow after read (auto-clean) | **Solved by this change** |
| resume → [context clear] → workflow (SUMMARY.md judgment exists) | Prior SUMMARY.md `<judgment>` | `.bak` on disk, not read | `.bak` orphaned; cleaned by next `pause.md` run (line 53) |
| Crash during resume (before dispatch) | `.continue-here.md` still exists | `.bak` may exist | Next resume reads `.md`; stale `.bak` cleaned by next `pause.md` |

**Evidence:**
- Gap identified by tracing judgment lifecycle through pause → resume → [context clear] → downstream workflow.
- `pause.md` line 53 already handles crash-orphaned `.bak` files — no new general cleanup path needed.
- The conditional read (only when no SUMMARY.md judgment exists) prevents double-sourcing judgment from both `.bak` and SUMMARY.md.

**Consequences:**
- `.bak` now has a defined lifecycle: created by `resume.md` `<cleanup_checkpoint>`, consumed-and-deleted by the next downstream workflow, or cleaned by the next `pause.md` run.
- Future workflows added as resume dispatch targets must include the `.bak` fallback read pattern if they consume judgment.
- The judgment shape remains bounded to four sections (D41 constraint). `.bak` is a fallback read path, not a new persistence surface.
- `quick.md` reads `.bak` unconditionally (no SUMMARY.md check) because quick tasks have no phase lifecycle and no prior SUMMARY.md to consult. The other three workflows (`plan.md`, `execute.md`, `verify.md`) read `.bak` conditionally — only when no prior SUMMARY.md `<judgment>` section exists.

**GSDD implementation:** `distilled/workflows/resume.md` (`.bak` deletion removed from `<completion>`), `distilled/workflows/plan.md` (fallback read item 8), `distilled/workflows/execute.md` (fallback read item 7), `distilled/workflows/verify.md` (fallback read item 7), `distilled/workflows/quick.md` (fallback read in Step 2), `distilled/DESIGN.md` (this decision), `tests/gsdd.guards.test.cjs` (negative and positive invariant tests)

---

## Maintenance

This document is updated when:

- A design decision is revised or reversed (update the relevant section, note the change)
- A new structural decision lands that affects how GSDD diverges from GSD (add a new section)
- Evidence is found that contradicts a stated rationale (update or remove the claim)

Do not add speculative decisions. Every section must cite implementation artifacts (files, PRs, tests) and at least one GSD source file for comparison.
