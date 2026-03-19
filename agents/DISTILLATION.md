# GSDD Role Distillation Ledger

Evidence map from each of the 9 canonical GSDD roles to their GSD sources, with keep/strip/why rationale. This ledger documents why each role exists in its current form and what GSD content was distilled or merged.

---

## 1. Mapper

**Canonical role:** `agents/mapper.md`

**GSD source:** `agents/_archive/gsd-codebase-mapper.md`

**Merger type:** Kept-as-is (function scope preserved, output contract simplified)

**Kept from GSD:**
- Mandatory initial-read discipline for context files
- 4 focus areas (tech, arch, quality, concerns)
- Output contract with artifact names and downstream consumers
- Core algorithm: parse → explore → fill template → write → confirm

**Stripped from GSD:**
- Multi-file codebase output reduced to 4-file standard (see D1)
- Validator-pass patterns (GSDD trusts agent reads, not file validation)

**Gained in GSDD:**
- Explicit "Downstream Consumers" section (shows who uses mapper output)
- Clear guidance on prescriptive vs. descriptive output (helps agents write better code)

**Rationale:** Mapper is the lowest-level, most stable role. Its core job (explore + document) hasn't changed, but the output set shrank from 7 files to 4 files per D1 (lean context decision). The agent role contract itself needed no substantive changes.

---

## 2. Researcher

**Canonical role:** `agents/researcher.md`

**GSD sources:** `agents/_archive/gsd-project-researcher.md` + `agents/_archive/gsd-phase-researcher.md` (merged)

**Merger type:** Merged (same algorithm, different scope parameter)

**Kept from GSD:**
- Mandatory initial-read discipline
- Research scope (project vs. phase)
- Research mode (ecosystem, feasibility, comparison)
- Core algorithm: receive scope → identify domains → execute tool hierarchy → verify → write → return structured result
- Quality guarantees (training data = hypothesis, honest reporting, investigation not confirmation, confidence levels on every finding)
- Research pitfalls and prevention strategies

**Stripped from GSD:**
- Separate role contracts for project-researcher and phase-researcher (merged into one with scope parameter)
- Tool-specific shell commands (kept portable tool contracts instead)

**Gained in GSDD:**
- Explicit "Scope" table showing scope × trigger × focus × output location
- Clear statement: "Same algorithm, different scope. The scope is a context input, not a different role."

**Rationale:** The GSD original had two roles (project and phase researcher) that followed the identical algorithm but with a scope parameter. GSDD merged them into one canonical role taking scope as input, reducing the role count from 11 to 9 while preserving all leverage. This is the clean merger mentioned in D2.

---

## 3. Synthesizer

**Canonical role:** `agents/synthesizer.md`

**GSD source:** `agents/_archive/gsd-research-synthesizer.md` (with recovery hardening from PR #15)

**Merger type:** Kept-as-is (hardened in 2026-03-13)

**Kept from GSD:**
- Mandatory initial-read discipline
- Input contract: all 4 research files (STACK, FEATURES, ARCHITECTURE, PITFALLS)
- Output contract: SUMMARY.md with executive summary, key findings, roadmap implications, confidence/gaps
- Downstream consumer (roadmapper) and what it needs
- 6-step execution flow: read → synthesize → extract → derive → assess → write

**Stripped from GSD:**
- Conditional skip logic (kept mandatory synthesizer per D5 original decision)
- Vendor-specific output formatting

**Gained in GSDD (PR #15 hardening):**
- Explicit required files list with blocked-return pattern (do not guess from partial context, return blocked status naming missing file)
- "Be opinionated" guidance to roadmapper
- Stronger structured-return contract

**Rationale:** Synthesizer is a thin single-step role with no merge or extraction needed. It was hardened in PR #15 to restore explicit structure and completion discipline, but the core function and leverage remained unchanged from GSD.

---

## 4. Planner

**Canonical role:** `agents/planner.md`

**GSD sources:** `agents/_archive/gsd-planner.md` + `agents/_archive/gsd-plan-checker.md` (merged)

**Merger type:** Merged (orchestration ownership transferred to native adapters)

**Kept from GSD:**
- Mandatory initial-read discipline
- Phase goal decomposition and dependency graphs
- Goal-backward verification (must-haves, artifacts, key links)
- Planner responsibility and scope
- Input contract (SPEC, ROADMAP, codebase context, prior phase artifacts)
- Output contract (PLAN.md with frontmatter, objective, context references, typed tasks)

**Stripped from GSD:**
- Separate plan-checker role (now a delegate at `distilled/templates/delegates/plan-checker.md`)
- GSD's native 3-cycle verification loop (embedded in planner) → moved to native adapter surfaces (Claude skill, OpenCode command, Codex agent)
- Vendor-specific fresh-context orchestration logic

**Gained in GSDD:**
- Explicit scope boundary: "plan-scoped, does not own verification or milestone audit"
- Goal-backward section with 4 clear questions
- Planning process section with concrete steps
- Reference to plan-checker delegate for fresh-context review
- Reduced-assurance fallback mode description (when no independent checker runs)

**Rationale:** GSD's plan-checker was a separate role running a 3-cycle revision loop. GSDD merged planner and plan-checker into a single portable contract, but preserved the adversarial review concept through native adapter surfaces. The portable workflow describes the reduced-assurance fallback. This is the high-impact merger from D2 with full tradeoff documentation.

---

## 5. Roadmapper

**Canonical role:** `agents/roadmapper.md`

**GSD source:** `agents/_archive/gsd-roadmapper.md` (with recovery hardening from PR #15)

**Merger type:** Kept-as-is (hardened in 2026-03-13)

**Kept from GSD:**
- Mandatory initial-read discipline
- Bounded section structure (phases, requirements, success criteria, coverage validation)
- Explicit coverage validation
- Parse-critical artifact contract
- Structured return modes
- Checklist-driven completion

**Stripped from GSD:**
- Template-path references (output lives in `.planning/ROADMAP.md`)
- Commit steps (GSDD handles git separately)
- Vendor-specific file conventions

**Gained in GSDD (PR #15 hardening):**
- Explicit `.planning/ROADMAP.md` ownership contract
- Explicit `[ ]` / `[-]` / `[x]` status grammar
- Concrete `ROADMAP CREATED` artifact example
- Hard boundary: "this role does not settle the separate ROADMAP/STATE lifecycle seam"

**Rationale:** Roadmapper was over-distilled in the initial extraction; PR #15 recovered visible structure and completion discipline. The core role and leverage were intact; hardening just restored the guardrails that improve compliance.

---

## 6. Executor

**Canonical role:** `agents/executor.md`

**GSD source:** `agents/_archive/gsd-executor.md` (with substantial hardening from PR #16)

**Merger type:** Kept-as-is (hardened significantly in 2026-03-13)

**Kept from GSD:**
- Plan-scoped execution discipline
- Task implementation and deviation handling
- Git action recording without repo-specific naming assumptions
- Checkpoint protocol
- Completion summary
- State update responsibility

**Stripped from GSD:**
- Bash recipe patterns and shell-specific guidance
- Tool-specific directory naming conventions

**Gained in GSDD (PR #16 hardening):**
- Explicit scope boundary with 6 things executor does NOT own
- Clearer deviation rules with priority order (auto-fix bugs first)
- Success criteria confirmation requirement
- Verify quality checks now live inside task_completeness (runnable, fast, ordered)
- Stronger commitment to documented deviations

**Rationale:** Executor is the most complex role, with the broadest deviation surface. PR #16 audit recovered substantive guardrails: explicit scope boundaries, rule priority, and verification discipline. The ~150-line executor contract expanded to ~400 lines because the detail prevents misalignment, not because the job changed.

---

## 7. Verifier

**Canonical role:** `agents/verifier.md`

**GSD source:** `agents/_archive/gsd-verifier.md` (with selective hardening from D2)

**Merger type:** Kept-as-is (scope preserved; cross-phase audit extracted separately)

**Kept from GSD:**
- Phase-level goal-backward verification
- Exists/Substantive/Wired gate
- Anti-pattern scan
- Output contract with compact base fields (phase, verified, status, score)
- Verification-report structure

**Stripped from GSD:**
- Cross-phase integration audit scope (extracted as separate role + workflow)
- GSD's narrative all-encompassing verification

**Gained in GSDD:**
- Richer structured verifier findings (re_verification, gaps, human_verification) when material
- Explicit boundaries: "phase-scoped only, cross-phase integration is a separate concern"
- D2 cross-reference: why integration-checker exists as a separate role

**Rationale:** Verifier's phase-level job is unchanged. The extraction of integration-checker as a separate milestone surface (D2, PR #12) made verifier smaller and clearer. Phase verification and milestone integration audit are now distinct concerns with explicit handoff points.

---

## 8. Integration-Checker

**Canonical role:** `agents/integration-checker.md`

**GSD source:** `agents/_archive/gsd-integration-checker.md` (with structural recovery in PR #12 and systemic hardening in PR #15)

**Merger type:** Extracted as standalone role (cross-phase scope differs structurally from phase verification)

**Kept from GSD:**
- Mandatory initial-read discipline
- Cross-phase wiring verification (exports → imports, APIs → consumers, forms → handlers, data → display)
- E2E flow tracing
- Typed structured return
- Checklist-driven completion

**Stripped from GSD (intentional):**
- Framework-specific Bash recipes
- Hardcoded path assumptions
- File-extension-specific grep flags
- Tool-specific details that don't survive vendor-agnostic distillation

**Gained in GSDD:**
- PR #12: explicit section boundaries, stronger structured output, cleaner split between role contract and milestone workflow
- PR #15: recovered compliance guardrails, restored mandatory read enforcement, explicit auth-protection verification
- D2 reference: structural difference from phase verifier
- New in D21 (PR #35): Step 4a matrix-driven auth verification (if AUTH_MATRIX.md exists)

**Rationale:** GSD's integration-checker was a separate surface but lived in the shadows of the main role contracts. PR #12 extracted it fully; PR #15 recovered its substantive guardrails. The role is different from verifier because it owns milestone scope (all-phase wiring) vs. phase scope (phase goal). This is the cleanest separation in D2.

---

## 9. Debugger

**Canonical role:** `agents/debugger.md`

**GSD source:** `agents/_archive/gsd-debugger.md` (no changes)

**Merger type:** Kept-as-is (unchanged)

**Kept from GSD:**
- Systematic debugging methodology
- Hypothesis formulation and testing
- State persistence across context resets
- Structured checkpoint protocol
- Deviation handling

**Stripped from GSD:** (nothing significant)
- Minor tool path references

**Gained in GSDD:** (nothing)
- The role is kept as-is for compatibility

**Rationale:** Debugger is a standalone utility role with no dependencies on other roles. It was preserved exactly as-is from GSD because it works and has no vendor lock-in. It's used ad-hoc when agents encounter failures, not as part of the main workflow pipeline.

---

## Summary: Merger Table (from D2)

| Canonical role | Absorbs from GSD | Merger criteria |
|---|---|---|
| `mapper.md` | `gsd-codebase-mapper.md` | Kept-as-is; output set changed per D1 (7 → 4 files) |
| `researcher.md` | `gsd-project-researcher.md` + `gsd-phase-researcher.md` | Scope parameter instead of separate role |
| `synthesizer.md` | `gsd-research-synthesizer.md` | Kept-as-is; hardened in PR #15 |
| `planner.md` | `gsd-planner.md` + `gsd-plan-checker.md` | Orchestration ownership moved to native adapters; portable checker-delegate created |
| `roadmapper.md` | `gsd-roadmapper.md` | Kept-as-is; hardened in PR #15 |
| `executor.md` | `gsd-executor.md` | Kept-as-is; heavily hardened in PR #16 |
| `verifier.md` | `gsd-verifier.md` | Kept-as-is; cross-phase audit extracted to integration-checker |
| `integration-checker.md` | `gsd-integration-checker.md` | Extracted as standalone; recovered in PR #12, hardened in PR #15 |
| `debugger.md` | `gsd-debugger.md` | Kept-as-is; no changes |

**Result:** 11 GSD roles → 9 GSDD canonical roles (2 mergers: researcher, planner). 1 extraction: integration-checker moved from embedded to standalone. Total leverage preserved, role count reduced.

---

## Evidence and Context

- GSD sources: `agents/_archive/gsd-*.md`
- GSDD canonical roles: `agents/*.md` (all except `_archive/`)
- Design decisions: `distilled/DESIGN.md` (D1, D2)
- PR history:
  - PR #9: Delegate extraction
  - PR #12: Integration-checker extraction and lifecycle contract seam
  - PR #14-17: Systemic role-contract hardening and leverage recovery
  - PR #35: OWASP authorization matrix integration into integration-checker

---

## Maintenance

This ledger is updated when:

1. A canonical role contract changes significantly (update the "Kept"/"Stripped"/"Gained" sections)
2. A GSD role is merged into or extracted from a canonical role (update the merger table)
3. New evidence surfaces that changes the distillation rationale (update with citation)

Do not add speculative content. Every entry must reference actual source files and PRs that contain evidence.
