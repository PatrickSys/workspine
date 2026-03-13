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

---

## 1. 4-File Codebase Standard

**GSD:** 7 static files during codebase mapping -- STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md, STRUCTURE.md, INTEGRATIONS.md, TESTING.md.

**GSDD:** 4 files -- STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md.

**What was dropped and where the rules went:**

| Dropped file | Absorbed into | Rationale |
|-------------|---------------|-----------|
| STRUCTURE.md | CONVENTIONS.md ("Where to put new code") | Physical directory maps break the moment a folder is added. Stale structure causes agent hallucination. Modern agents use dynamic tools (tree-sitter, codebase indexing) to view current structure. |
| INTEGRATIONS.md | STACK.md + CONVENTIONS.md | Database schemas and endpoint maps change daily. Agents should read definitive `schema.prisma` or `init.sql` dynamically, not trust a stale markdown summary. |
| TESTING.md | CONVENTIONS.md ("How to mock the database", testing patterns) | Testing conventions are stable rules; test inventories are not. Rules belong in CONVENTIONS.md. |

**Core principle:** Drop the *state* (which rots), keep the *rules* (which don't). Maximum architectural discipline without feeding stale topologies into limited context windows.

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

| Canonical role | Absorbs from GSD | Merger criteria |
|---------------|-------------------|-----------------|
| `integration-checker.md` | `gsd-integration-checker.md` | Cross-phase integration checking is structurally different from single-phase verification: different inputs (all phase SUMMARYs/VERIFICATIONs vs single phase), different scope (milestone-wide wiring vs phase goal), different algorithm (connectivity checks vs goal-backward). Extracted as standalone role rather than absorbed into verifier. |
| `researcher.md` | `gsd-project-researcher.md` + `gsd-phase-researcher.md` | Same algorithm, different scope. Scope is an input parameter, not a role distinction. Clean merger. |
| `planner.md` | `gsd-planner.md` + `gsd-plan-checker.md` | Reduces coordination overhead. **Tradeoff:** GSD's plan-checker was a fresh-context adversarial pass with a 3-cycle revision loop (planner -> checker -> revise x 3 max). GSDD keeps an explicit `plan-checker` contract, generates native planner/checker entry surfaces where runtimes can support the loop directly, and describes reduced-assurance fallback in the portable workflow when no independent checker runs. |
| `verifier.md` | `gsd-verifier.md` | Phase-level goal-backward verification remains the verifier's scope. Cross-phase integration audit remains a separate milestone surface rather than being silently absorbed. GSDD keeps the compact verification-report base fields and also preserves richer structured verifier findings where they materially improve re-verification and gap closure. |

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

| Canonical role | GSD source | Audit status |
|---------------|------------|-------------|
| `mapper.md` | `gsd-codebase-mapper.md` | source-audited |
| `synthesizer.md` | `gsd-research-synthesizer.md` | source-audited (S12) |
| `executor.md` | `gsd-executor.md` | source-audited (executor audit) |
| `roadmapper.md` | `gsd-roadmapper.md` | source-audited (S12) |
| `debugger.md` | `gsd-debugger.md` (standalone utility, not part of core lifecycle) | — |

**Evidence:**
- GSD originals preserved in `agents/_archive/` (11 files, git history intact via `git mv`)
- GSDD canonicals in `agents/` (9 files + README.md)
- `agents/README.md` lifecycle table maps each canonical role to its GSD sources

---

## 3. Two-Layer Architecture: Roles and Delegates

**GSD:** Workflows embed role instructions inline. No separation between what an agent *is* and what it *does* in a given workflow. A single GSD workflow file (e.g., `new-project.md` at 851 lines) contains both orchestration logic and agent behavioral contracts.

**GSDD:** Two explicit layers.

| Layer | Location | Purpose | Example |
|-------|----------|---------|---------|
| Roles | `agents/*.md` | Durable contracts: identity, algorithm, quality guarantees, anti-patterns | `agents/mapper.md` -- defines the mapper's forbidden-files rule, output format, verification protocol |
| Delegates | `distilled/templates/delegates/*.md` | Thin task-specific wrappers: scoped instructions referencing a role | `mapper-tech.md` -- tells the mapper to focus on tech stack, write to STACK.md |

**Why two layers:**
- Roles can be audited and improved independently of workflow wiring.
- Delegates can be rewired (point to different output paths, change scope) without touching role semantics.
- New workflows compose existing roles via new delegates without duplicating behavioral definitions.
- Security rules, quality gates, and algorithms are defined once in the role -- not scattered across delegates.

**Delegate thinness principle:** Delegates carry ONLY task-specific content (output path, focus area, return format, quality checklist). They do NOT contain algorithms, verification protocols, security rules, or anti-patterns -- those live in the role contract.

**Current delegates (10):**

| Delegate | Role | Output | Workflow |
|----------|------|--------|----------|
| `mapper-tech.md` | mapper | `.planning/codebase/STACK.md` | map-codebase |
| `mapper-arch.md` | mapper | `.planning/codebase/ARCHITECTURE.md` | map-codebase |
| `mapper-quality.md` | mapper | `.planning/codebase/CONVENTIONS.md` | map-codebase |
| `mapper-concerns.md` | mapper | `.planning/codebase/CONCERNS.md` | map-codebase |
| `researcher-stack.md` | researcher | `.planning/research/STACK.md` | new-project |
| `researcher-features.md` | researcher | `.planning/research/FEATURES.md` | new-project |
| `researcher-architecture.md` | researcher | `.planning/research/ARCHITECTURE.md` | new-project |
| `researcher-pitfalls.md` | researcher | `.planning/research/PITFALLS.md` | new-project |
| `researcher-synthesizer.md` | synthesizer | `.planning/research/SUMMARY.md` | new-project |
| `plan-checker.md` | planner | JSON checker report | plan (native adapters) |

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

| Phase | PR | What changed |
|-------|-----|-------------|
| A (one-hop) | PR 2 | Mapper delegates cross-referenced `<forbidden_files>` from the map-codebase skill. Security rules reachable but required reading a second file. |
| B (zero-hop) | PR 4 | Full 12-category forbidden-files list absorbed into `agents/mapper.md`. Delegates reference the role contract directly. No second file needed. |

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

| researchDepth | Synthesizer behavior |
|--------------|---------------------|
| `fast` | Orchestrator writes SUMMARY.md inline from the 4 x 3-5 sentence summaries it holds in context. No delegate spawned. |
| `balanced` | ResearchSynthesizer delegate spawned. Reads 4 full research files. Cross-references build order constraints, pitfall-to-phase mappings, feature-architecture conflicts that short summaries omit. |
| `deep` | Same as balanced but researchers produce longer output (more material for synthesizer to cross-reference). |

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

| Scenario | Mappers spawned |
|----------|----------------|
| Brownfield, first run | 4 (one per focus area) |
| Brownfield, maps exist | 0 (skipped, user directed to standalone workflow) |
| Greenfield | 0 (no codebase to map) |

**Evidence:**
- GSD source: `get-shit-done/workflows/map-codebase.md` lines 35-62 (staleness check with 3 options)
- GSD source: `get-shit-done/workflows/new-project.md` lines 61-80 (brownfield offer delegates to map-codebase)
- GSDD: `distilled/workflows/map-codebase.md` (standalone, re-runnable)
- GSDD: `distilled/workflows/new-project.md` (auto-invoke for brownfield via skill reference)

---

## 7. Milestone Hierarchy and Phase Continuation

**GSD:** Three project-state files -- PROJECT.md (project definition), REQUIREMENTS.md (scoped features), STATE.md (current phase/status). Milestones archived in MILESTONES.md. Phase numbering continues across milestones (v1.0 phases 1-5, v1.1 starts at phase 6).

**GSDD:** Merged to two files -- `.planning/SPEC.md` (combines PROJECT.md + REQUIREMENTS.md), `.planning/ROADMAP.md` (combines roadmap + inline status, replacing STATE.md). Same milestone semantics.

| GSD file | GSDD equivalent | What changed |
|----------|----------------|-------------|
| PROJECT.md | `.planning/SPEC.md` (project definition section) | Merged -- no separate project definition file |
| REQUIREMENTS.md | `.planning/SPEC.md` (requirements section) | Merged -- requirements live alongside project context |
| STATE.md | `.planning/ROADMAP.md` (inline status per phase) | Dropped as separate file -- checkbox status in `.planning/ROADMAP.md` is sufficient |
| ROADMAP.md | `.planning/ROADMAP.md` | Simplified format -- checkboxes, no REQ-ID traceability tables |
| MILESTONES.md | `.planning/milestones/` directory | Archive of completed milestone roadmaps |

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

| API | Call sites in GSD | GSDD replacement |
|-----|------------------|------------------|
| `AskUserQuestion` | 38+ (15 workflows + 14 commands) | Plain text: "Ask the user: ..." |
| `Task()` subagent | 35+ across 15 workflows | `<delegate>` blocks with markdown instructions |
| `SlashCommand()` | 4 call sites | Skill references or inline workflow steps |
| `~/.claude/` paths | 39+ files | Install-time paths via CLI |
| `gsd-tools.cjs` CLI | 28 workflow files | `bin/gsdd.mjs` (simplified) |

**Adapter output per tool:**

| Tool | Generated surface | Trigger |
|------|------------------|---------|
| Any (portable) | `.agents/skills/gsdd-*/SKILL.md` | Always generated on `gsdd init` |
| Claude Code | `.claude/skills/gsdd-*/SKILL.md` + `.claude/commands/gsdd-plan.md` (compatibility alias for `plan`) + `.claude/agents/gsdd-plan-checker.md` | `--tools claude` |
| Codex CLI | `.agents/skills/gsdd-*/SKILL.md` | Always generated on `gsdd init`; no Codex-specific adapter file required |
| OpenCode | `.opencode/commands/gsdd-*.md` + `.opencode/agents/gsdd-plan-checker.md` | `--tools opencode` |
| Cursor/Copilot/Gemini | Root `AGENTS.md` (bounded block) | `--tools agents` |

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

## Maintenance

This document is updated when:
- A design decision is revised or reversed (update the relevant section, note the change)
- A new structural decision lands that affects how GSDD diverges from GSD (add a new section)
- Evidence is found that contradicts a stated rationale (update or remove the claim)

Do not add speculative decisions. Every section must cite implementation artifacts (files, PRs, tests) and at least one GSD source file for comparison.

