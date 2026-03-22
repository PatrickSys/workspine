# GSDD Role Distillation Ledger

Evidence map from each of the 10 canonical GSDD roles to their GSD sources, with keep/strip/why rationale. This ledger documents why each role exists in its current form and what GSD content was distilled or merged.

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

**Rationale:** The GSD original had two roles (project and phase researcher) that followed the identical algorithm but with a scope parameter. GSDD merged them into one canonical role taking scope as input, reducing the role count from 11 to 9 (later 10 with approach-explorer in D29) while preserving all leverage. This is the clean merger mentioned in D2.

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

## 10. Approach-Explorer

**Canonical role:** `agents/approach-explorer.md`

**GSD sources:** `workflows/discuss-phase.md` + `workflows/list-phase-assumptions.md` + `workflows/discovery-phase.md` (merged into new role)

**Merger type:** New role from 2 GSD sources (discuss-phase + list-phase-assumptions) with thematic input from discovery-phase

**Kept from GSD:**
- Gray area identification with 5 domain types (SEE/CALL/RUN/READ/ORGANIZED) from discuss-phase
- Scope guardrail: phase boundary is fixed, deferred ideas captured not acted on
- 5-dimension assumption surfacing (technical approach, implementation order, scope boundaries, risks, dependencies) with confidence levels from list-phase-assumptions
- Deferred ideas capture from discuss-phase
- Adaptive area-by-area deep questioning from discuss-phase (GSD used 4-question batches; GSDD uses adaptive convergence)

Note: `discovery-phase.md` contributed the concept of pre-planning research but the mechanism is entirely different — GSD used 3-level depth workflows (Quick/Standard/Deep) as a separate invocation; GSDD uses per-gray-area research subagents embedded in the plan workflow. This is thematic inspiration, not a structural merger.

**Stripped from GSD:**
- `gsd-tools.cjs` dependencies and STATE.md updates
- Vendor-specific commit steps, path conventions, and "Claude" references
- CONTEXT.md output format (replaced with structured APPROACH.md)
- Separate workflow invocation (absorbed into plan workflow as inline + research subagent hybrid)
- Rigid 4-question batched loop (replaced with adaptive questioning until decision converges)

**Gained in GSDD:**
- XML semantic structure matching planner pattern (`<role>`, `<algorithm>`, `<examples>`, etc.)
- 3 few-shot conversation examples (taste decision, technical decision, hybrid + delegation)
- Gray area classification: taste (ask directly), technical (research first), hybrid (both)
- Pre-question research per gray area via isolated research subagents returning compressed summaries
- Self-check quality gate before writing APPROACH.md
- Intermediate decision persistence (protect against context limits)
- JIT context loading with extraction guidance (read ONLY locked decisions from SPEC, ONLY phase goal from ROADMAP)
- Structured approach comparison with trade-offs
- File persistence to `{padded_phase}-APPROACH.md` using dedicated template
- Plan-checker integration via new `approach_alignment` verification dimension
- Config toggle (`workflow.discuss: true|false`) for optional skip
- Downstream consumer contract: planner reads locked decisions, plan-checker verifies alignment
- "Agent's Discretion" explicit marking for areas where user delegates choice (vendor-neutral)
- Hybrid architecture: conversation inline (main context) + research in subagents. Native agent kept as optimization.

**Rationale:** GSDD's initial distillation dropped GSD's discuss-phase and list-phase-assumptions entirely, removing genuine leverage: the planner converges on a single approach without user input, explores no alternatives, and surfaces no assumptions. The approach explorer recovers this phase-level user alignment by combining GSD's discuss-phase interaction pattern with comparative research. Ground-up rewrite (D29) applied 5 external resources on context engineering, meta-prompting, and agent skill design to produce a prompt-engineered role contract with proper XML structure, examples, adaptive conversation, and hybrid research isolation.

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
| `approach-explorer.md` | `discuss-phase.md` + `list-phase-assumptions.md` + `discovery-phase.md` | New role from 3 GSD workflow sources |

**Result:** 11 GSD roles → 10 GSDD canonical roles (2 mergers: researcher, planner). 1 extraction: integration-checker moved from embedded to standalone. 1 addition: approach-explorer recovers discuss-phase leverage with research enhancement. Total leverage preserved and extended.

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

---

## Role Contract Design Principles

Cross-source best practices applied to GSDD role contracts, audited against 6 external resources. These principles govern how role contracts should be written and revised. Ranked by impact.

### Architecture-Level (highest leverage)

| Principle | What It Means | Source | GSDD Implementation |
|-----------|--------------|--------|---------------------|
| **Context isolation** | Research and heavy reads go in subagents; only compressed summaries enter the main context | Anthropic CE: "sub-agents perform deep technical work, returning condensed summaries" | Approach explorer research subagents return ~1000-token summaries; plan-checker runs in fresh context |
| **JIT context loading** | Never say "read everything." Specify what to extract from each file | Anthropic CE: "maintain lightweight identifiers and use these references to dynamically load data into context at runtime" | `<input_contract>` with extraction guidance: "From SPEC.md read ONLY locked decisions" |
| **Intermediate persistence** | For long interactions, write confirmed state to disk incrementally | Anthropic CE: "Agent regularly writes notes persisted to memory outside of the context window" | Approach explorer writes decisions to disk as they're confirmed during conversation |
| **Progressive disclosure** | Don't front-load all context; let agents discover incrementally | Anthropic CE: "agents can assemble understanding layer by layer" | Gray areas presented individually; research loaded per area on demand |

### Prompt Structure (medium leverage)

| Principle | What It Means | Source | GSDD Implementation |
|-----------|--------------|--------|---------------------|
| **XML semantic structure** | Use XML tags to separate role, instructions, examples, inputs, outputs, anti-patterns | Anthropic Claude: "XML tags help Claude parse complex prompts unambiguously" | All roles use `<role>`, most use `<quality_guarantees>`, `<anti_patterns>`. Approach-explorer adds `<algorithm>`, `<examples>`, `<scope_guardrail>` |
| **Anti-patterns early** | Place "don't do this" instructions near the top, after role definition | Anthropic CE: critical information at the beginning gets more attention. NeoLab: early placement for high attention weight | `<anti_patterns>` placed immediately after `<role>` in all roles that have them |
| **Few-shot examples** | Show the pattern of interaction, not just output format | Anthropic Claude: "3-5 examples for best results." Examples in `<example>` tags | Approach-explorer: 3 examples. Other roles use inline format examples within algorithm sections |
| **Self-check before output** | Run an explicit checklist before producing the final artifact | OpenAI: "verification loops." Anthropic Claude: "Ask Claude to self-check" | Approach-explorer step 7; planner `<plan_self_check>`; executor completion verification |
| **Scope boundaries with heuristics** | Don't just list in/out of scope — give the agent a judgment rule | Novel, validated in approach-explorer | "Does this clarify implementation within the phase, or does it add a capability that could be its own phase?" |

### Language & Tone (lower leverage, still matters)

| Principle | What It Means | Source | GSDD Implementation |
|-----------|--------------|--------|---------------------|
| **Authority language: intentional leverage** | Anthropic Claude 4.6 warns "CRITICAL:" can overtrigger on newer models. NeoLab persuasion research found imperative language doubled compliance (33%→72%). GSDD decision: **keep CRITICAL: for mandatory initial-read** — this is a genuine compliance-critical instruction where skipping it causes cascading failures. Use normal language for non-critical instructions. | Anthropic Claude 4.6 vs. NeoLab persuasion research (direct conflict). GSDD sides with NeoLab for this specific use case | `CRITICAL: Mandatory initial read` kept in all 7 roles. `NEVER` kept for security (mapper secret protection). Normal language used for algorithm steps, scope guidance, and quality rules |
| **Tell what to do, not just what not to do** | Anti-patterns alone are insufficient; pair with positive instructions | Anthropic Claude: "Tell Claude what to do instead of what not to do" | Every role has both `<anti_patterns>` AND positive algorithm/process sections |
| **Context for instructions** | Explain WHY a rule exists so the agent can generalize | Anthropic Claude: "Providing context or motivation behind your instructions helps Claude better understand your goals" | Research quality rules explain WHY: "Training data is a hypothesis. Verify before asserting." |

### Novel Patterns (not from any source)

These patterns emerged from GSDD's specific needs and were validated through implementation:

| Pattern | What It Does | Where Used |
|---------|-------------|------------|
| **Taste/Technical/Hybrid classification** | Adapts research depth to decision type; taste needs no research, technical does | Approach-explorer step 2 |
| **Research quality rules** | "One viable option is valid" / "Don't manufacture trade-offs" | Approach-explorer step 3 |
| **5-dimension assumption surfacing** | Forces transparency about inferences vs. confirmed facts, with confidence levels | Approach-explorer step 6 |
| **Agent's Discretion delegation** | User can explicitly say "you decide" — reduces fatigue on low-stakes choices | Approach-explorer step 4, planner `<approach_decisions>` |
| **Domain classification table** | SEE/CALL/RUN/READ/ORGANIZED determines gray area focus per phase type | Approach-explorer step 2 |
| **Degrees of freedom mapping** | Taste=high freedom, technical=low freedom (research-constrained). Maps to NeoLab's concept | Approach-explorer classification system |

### Source Ranking

Sources are ranked by soundness for agent prompt design. Higher-ranked sources take precedence when sources disagree.

1. **Anthropic — Effective Context Engineering for AI Agents** — Architecture-level patterns with real production evidence (Claude Code, Pokémon). Most authoritative for context window management, sub-agent design, and information flow.
2. **Anthropic — Claude Prompting Best Practices (Claude 4.6)** — Model-specific, up-to-date. Critical for behavioral warnings (overtriggering, subagent overuse). Supersedes general guidance for Claude-targeted agents.
3. **OpenAI — Prompt Guidance (GPT-5.4)** — Deepest general-purpose reference. Novel concepts: completeness contracts, verification loops, tool persistence rules, empty result recovery. Model-specific but patterns transfer.
4. **NeoLab Context Engineering Kit** — Good synthesis. "Degrees of Freedom" concept is useful. Persuasion research contradicts Anthropic on authority language (trust Anthropic for Claude).
5. **OpenAI Cookbook — Meta-Prompting** — Narrow scope: LLM-as-judge evaluation, iterative prompt refinement. Useful technique, not a framework.
6. **JBurlison/MetaPrompts** — Structural skeleton (agent/skill/prompt/instruction hierarchy). Minimal actual guidance on prompt quality.

### Key Discrepancy Resolution

When sources conflict, these resolutions apply:

| Conflict | Resolution | Why |
|----------|------------|-----|
| Authority language ("YOU MUST" vs. normal) | Keep CRITICAL: for mandatory initial-read (compliance-critical). Use normal language elsewhere | NeoLab's doubled-compliance research applies to instructions where skipping causes cascading failures. Anthropic's overtriggering concern applies to general guidance, not load-bearing context gates |
| Example count (2 vs. 3-5) | Target 3+ for conversational agents; inline format examples are sufficient for structured output agents | Anthropic's 3-5 recommendation is general; interactive roles benefit more than output-only roles |
| Subagent return size (200 vs. 1000-2000 tokens) | Use 300-500 tokens | Anthropic's 1000-2000 is upper bound; 200 was too tight for structured approach summaries with trade-offs |
| "Don't invent alternatives" vs. "try fallback strategies" | Keep "don't invent" for approach research; use fallbacks for information retrieval | These solve different problems: manufacturing fake options is worse than acknowledging one viable path |
