# GSDD Evidence Index

> One-line-per-source mapping of every design decision to its primary evidence.
> Extracted from inline **Evidence** sections in `distilled/DESIGN.md`.
> Updated when a decision is added or revised.
> Guarded by G31 in `tests/gsdd.guards.test.cjs`.

---

## D1 — 4-File Codebase Standard
- `agents/_archive/gsd-codebase-mapper.md` lines 72-79 (GSD 7-file model)
- `agents/mapper.md` (GSDD 4-file standard)
- `.planning/SPEC.md` "Lean Context Decision" section
- Liu et al. "Lost in the Middle: How Language Models Use Long Contexts" (NeurIPS 2023) — position-dependent recall supports minimal stable context footprint
- Levy et al. "Same Task, More Tokens: Impact of Input Length on the Reasoning Performance of LLMs" (EMNLP 2024) — longer inputs degrade reasoning performance
- Aider tree-sitter dynamic repo maps (aider.chat) — on-demand structural mapping as an alternative to static context files

## D2 — Agent Consolidation: 11 to 10
- `agents/_archive/` (11 original GSD files, git history via `git mv`)
- `agents/` + `agents/README.md` (10 canonicals, lifecycle table)
- `agents/README.md` lifecycle table (canonical-to-GSD source mapping)
- CrewAI role-based team patterns, Microsoft AutoGen hierarchical agents, LangGraph multi-agent subgraphs (validate role specialization; specific count of 10 is engineering judgment)

## D3 — Two-Layer Architecture: Roles and Delegates
- `agents/README.md` (Two-Layer Architecture and Runtime Distribution sections)
- `bin/gsdd.mjs` lines 84-102 (role copy step with existsSync guard)
- `tests/gsdd.init.test.cjs` (role file existence and delegate-role reference validation)
- All 10 delegate files in `distilled/templates/delegates/`
- Jensen & Meckling "Theory of the Firm" (Journal of Financial Economics 1976) — principal-agent delegation contracts
- Gamma et al. GoF Strategy Pattern ("Design Patterns" 1994) — separating algorithm definition from usage context
- LangGraph multi-agent subgraphs + Microsoft AutoGen hierarchical agents (production validation of two-layer separation)

## D4 — Zero-Hop Security Propagation
- `agents/mapper.md` lines 66-90 (Forbidden Files section + Hard stop)
- `agents/_archive/gsd-codebase-mapper.md` lines 66-97 (original narrower rules)
- PR 2 intermediate state (one-hop via SKILL.md cross-reference)
- PR 4 final state (zero-hop, role contains all rules)
- OWASP Top 10 for LLM Applications v2.0 (2025) — LLM01 (Prompt Injection) + LLM07 (System Prompt Leakage) support embedding security rules at the role-contract level
- Greshake et al. "Not What You've Signed Up For" (IEEE S&P 2023) — indirect prompt injection validates defense-in-depth at the agent-contract layer
- Saltzer & Schroeder "Protection of Information in Computer Systems" (1975) — complete mediation principle

## D5 — Conditional Synthesizer
- `get-shit-done/workflows/new-project.md` lines 708-729 (GSD always-spawn synthesizer)
- `distilled/templates/delegates/researcher-synthesizer.md`
- `agents/synthesizer.md` (cross-reference algorithm)
- `.planning/config.json` `researchDepth` field contract
- LangGraph conditional edges — adaptive agent invocation based on workflow state
- Asai et al. "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection" (ICLR 2024) — conditional retrieval/synthesis based on need
- Anthropic "Building effective agents" (Dec 2024) — routing workflows match task complexity to agent selection

## D6 — Mapper Staleness: Standalone Workflow
- `get-shit-done/workflows/map-codebase.md` lines 35-62 (GSD staleness check with 3 options)
- `get-shit-done/workflows/new-project.md` lines 61-80 (brownfield offer delegates to map-codebase)
- `distilled/workflows/map-codebase.md` (standalone, re-runnable)
- `distilled/workflows/new-project.md` (auto-invoke for brownfield via skill reference)
- Aider (aider.chat) — dynamic tree-sitter-based repo maps generated on-demand (validates freshness-over-cache approach)
- Cursor — continuous background indexing (cached approach; shows both are production-valid tradeoffs)

## D7 — Milestone Hierarchy and Phase Continuation
- `get-shit-done/workflows/new-milestone.md` lines 101-173 (milestone-aware researchers)
- `get-shit-done/workflows/new-milestone.md` line 269 (phase numbering continuation)
- `distilled/README.md` lifecycle diagram
- `.planning/SPEC.md` "Long-Term Lifecycle" section
- Erol, Hendler & Nau / Nau et al. Hierarchical Task Networks (JAIR 2003) — foundational milestone→phase→task decomposition in AI planning
- PMI PMBOK Work Breakdown Structure (WBS) standard — industry-standard phase/task hierarchy
- Khot et al. "Decomposed Prompting" (ICLR 2023) — task decomposition improves LLM performance on multi-step work

## D8 — Advisory Git Protocol
- `agents/_archive/gsd-executor.md` (mandatory commit in algorithm, TDD flow)
- `agents/executor.md` lines 57-64 (Git Guidance — repo-native, advisory)
- Industry consensus: Aider, GitHub Copilot, Cursor, Codex CLI, OpenCode — all treat git as advisory/user-configured; no major AI coding tool enforces a specific commit or branch convention

## D9 — Adapter Generation Over Conversion
- `get-shit-done/install.js` (GSD converter with per-runtime conversion logic)
- `get-shit-done/workflows/new-project.md` (851 lines, 10+ AskUserQuestion calls, 7 Task() calls)
- `bin/gsdd.mjs` (thin CLI entrypoint and adapter dispatcher)
- `bin/adapters/` (vendor-specific adapter generation)
- `distilled/templates/delegates/plan-checker.md` (single payload source for native checker generation)
- `.planning/SPEC.md` "Agent Integration Strategy" section
- AGENTS.md Linux Foundation standard: agents.md

## D10 — Context Isolation: Summaries Up, Documents to Disk
- `get-shit-done/workflows/new-project.md` lines 544-706 (4 researchers write to files, return summaries)
- All 9 delegate files (return format instructions)
- `agents/synthesizer.md` (reads full research files from disk)
- Anthropic Agent Teams (Feb 2026): "Shared State, Not Shared Context"
- AI21 Modular Intelligence (Feb 2026): orchestrator-based designs prevent context drift

## D11 — Quick-Work Lane
- `get-shit-done/workflows/quick.md` (454 lines, two modes, STATE.md tracking)
- `distilled/workflows/quick.md` (~120 lines, single mode, LOG.md tracking)
- Crystal Clear (Cockburn 2004) — ceremony scales with team size and criticality; lightweight methods prescribed for small/low-criticality work
- Kanban class-of-service (Anderson 2010) — routing tasks by size/urgency to appropriate workflow lanes
- Anthropic "Building effective agents" (Dec 2024) — match workflow complexity to task complexity

## D12 — Session Persistence Without State File
- `get-shit-done/workflows/pause-work.md` (123 lines, phase-scoped checkpoint)
- `get-shit-done/workflows/resume-project.md` (307 lines, STATE.md-dependent)
- `get-shit-done/workflows/progress.md` (382 lines, gsd-tools.cjs-dependent)
- `distilled/workflows/pause.md`, `distilled/workflows/resume.md`, `distilled/workflows/progress.md`
- `.internal-research/gsd-distilled-audit-13th-march-2026.md` — Highest-ROI recommendation #3

## D13 — Mechanical Invariant Enforcement
- `tests/gsdd.invariants.test.cjs` lines 1015+ (6 suites, ~106 assertions)
- OpenAI Harness Engineering blog (Feb 2026): "error messages as enforcement mechanism"
- External audit (2026-03-13): recommendation #4 "Mechanize the framework's invariants"
- PRs #20-23: orphan `</output>` tags survived 4 manual review cycles before G4 caught them

## D14 — Headless Mode
- `get-shit-done/workflows/new-project.md` lines 9-40 (GSD headless predecessor)
- Claude Code: `-p` flag for headless execution (docs.anthropic.com)
- Codex CLI: `--quiet` and `--auto-edit` flags (developers.openai.com/codex/cli/reference)
- Cline CLI 2.0: explicit headless CI/CD mode (devops.com, 2025)

## D15 — Model Profile Propagation
- `get-shit-done/references/model-profiles.md` + `model-profile-resolution.md` (GSD reference)
- OpenSpec: portable spec core is tool-agnostic (openspec.dev)
- Claude Code: `model:` field with aliases (docs.anthropic.com/en/docs/claude-code/sub-agents)
- OpenCode: `model:` in agent frontmatter (opencode.ai/docs/agents)
- Agent Skills standard: no `model:` field in spec (agentskills.io/specification)

## D16 — Template Versioning via Generation Manifest
- `get-shit-done/install.js` lines 1227-1327 (SHA-256 manifest + backup directory)
- OpenSpec: managed blocks with bounded upsert (openspec.dev)
- Angular/Turborepo/Next.js: ordered migrations with dry-run preview
- Langfuse: generation/prompt versioning with hash-based change detection (langfuse.com/docs/prompts)

## D17 — CLI Composition Root Boundary
- `get-shit-done/install.js` (GSD monolithic install/conversion surface)
- `bin/gsdd.mjs`, `bin/lib/init.mjs`, `bin/lib/templates.mjs`, `bin/lib/models.mjs`
- `tests/gsdd.init.test.cjs`, `tests/gsdd.models.test.cjs`, `tests/gsdd.manifest.test.cjs`
- Seemann "Dependency Injection in .NET" (Manning 2011) — named "Composition Root" pattern
- Martin "Clean Architecture" (2017) — main component as the outermost wiring layer
- Standard pattern in oclif, Commander.js, yargs, Cobra CLIs

## D18 — Codex CLI Native Adapter
- OpenAI Codex CLI docs: developers.openai.com/codex/subagents
- Codex CLI v0.115.0 release notes: github.com/openai/codex/releases/tag/rust-v0.115.0
- Agent Skills standard: developers.openai.com/codex/skills
- `bin/adapters/codex.mjs` (implementation)
- Live validation fixtures (2026-03-17): 3 Codex test runs confirming happy path, revision, max-3 escalation

## D19 — Scenario-Based Eval Coverage
- OpenAI: "Testing Agent Skills Systematically with Evals" (developers.openai.com/blog/eval-skills)
- Anthropic: "Demystifying Evals for AI Agents" (anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Block: "Testing Pyramid for AI Agents" (engineering.block.xyz/blog/testing-pyramid-for-ai-agents)
- `tests/gsdd.scenarios.test.cjs` (S1–S5, ~37 assertions)

## D20 — Workspace Health Diagnostics
- `get-shit-done/workflows/health.md` (157 lines, GSD predecessor)
- OpenAI Harness Engineering (Feb 2026): error messages as enforcement mechanism
- External audit (2026-03-13): recommendation #3 "Add just enough: status/resume/progress/health"
- `bin/lib/health.mjs`, `tests/gsdd.health.test.cjs`, `tests/gsdd.guards.test.cjs` (G14)

## D21 — OWASP Authorization Matrix
- OWASP Authorization Testing Automation Cheat Sheet: pivot-format matrix standard
- OWASP Top 10 for Agentic Applications 2026: A1 Agent Overreach, A4 Insufficient Authorization
- External audits (2026-03-13, 2026-03-17): independently flagged auth verification gap
- `distilled/templates/auth-matrix.md`, `agents/integration-checker.md` (Step 4a)

## D22 — Delegate Layer Architecture
- Anthropic multi-agent guidance: orchestration patterns with isolated sub-agents
- OpenAI Harness Engineering (2026): delegate pattern for reusable sub-agent behavior
- OpenDev "Terminal Agents" (arXiv 2603.05344): multi-agent coordination with explicit role contracts
- `distilled/templates/delegates/` (11 delegate files)
- `distilled/workflows/*.md` (`<delegate>` blocks)

## D23 — Mapper Output Quantification
- `ideas.md` (internal, Feb 2026): direct per-tool comparison — "84% declining > uses constructor injection"
- ArXiv 2602.20478 (Codified Context): structured quantifiable facts enable JIT context loading
- GetDX measurement framework (2026): adoption % as primary signal for convention strength
- Anthropic 2026 Agentic Coding Trends: context quality as primary competitive advantage
- `distilled/templates/codebase/conventions.md`, `distilled/templates/delegates/mapper-quality.md`

## D24 — Consumer Governance Completeness
- Anthropic "Effective harnesses for long-running agents" (2026): incomplete maps cause agent failure
- Agent Skills specification (agentskills.io): progressive disclosure requires complete top-level map
- HumanLayer "Skill Issue" (2026): AGENTS.md should be a complete capability map
- External audits (2026-03-13, 2026-03-17): documentation accuracy as top adoption blocker
- `distilled/templates/agents.block.md`, `tests/gsdd.guards.test.cjs` (G18)

## D25 — Consumer First-Run Experience
- Anthropic harness engineering (2025-2026): "honest constraints over vague prompting"
- OpenAI Codex skills documentation: clear per-platform invocation patterns
- Both GSDD external audits (2026-03-13, 2026-03-17): "architecture solid, presentation lags"
- `README.md`, `distilled/templates/agents.block.md`, `bin/lib/init.mjs`, `tests/gsdd.guards.test.cjs` (G19)

## D26 — Session Continuity Contract Hardening
- Anthropic "Effective harnesses for long-running agents" (2026): artifact-based session handoff
- GitHub "How to build reliable AI workflows with agentic primitives" (2026): session splitting
- OpenAI harness engineering (2026): incremental progress tracking is the key multi-session mechanism
- OpenDev terminal agents (arXiv 2603.05344): runtime state must be derivable from artifacts
- `distilled/workflows/pause.md`, `distilled/workflows/resume.md`, `distilled/workflows/progress.md`
- `tests/gsdd.guards.test.cjs` (G20)

## D27 — Consumer-Ready Surface Completion
- External audit (2026-03-13): "architecture solid, presentation lags implementation"
- External audit (2026-03-17): "consumer surface identified as #1 bottleneck"
- External audit (2026-03-18): "docs should close the consumer journey"
- `README.md` (6 new subsections), `tests/gsdd.guards.test.cjs` (G21)

## D28 — Workflow Completion Routing
- Consumer audit (2026-03-21): "agent never proactively suggested the next GSDD command"
- `get-shit-done/workflows/progress.md` (GSD "Next Up" block pattern)
- Anthropic "Building effective agents" (2025): explicit handoff points with clear next actions
- `distilled/workflows/*.md` (9 `<completion>` sections), `tests/gsdd.guards.test.cjs` (G22)

## D29 — Approach Exploration
- Anthropic "Building effective agents" (2025): sub-agents return condensed summaries
- LangChain "Context Engineering for Agents" (2025): Write/Select/Compress/Isolate patterns
- `get-shit-done/workflows/discuss-phase.md` (gray area identification, GSD source)
- `get-shit-done/workflows/list-phase-assumptions.md` (5-dimension assumption surfacing)
- `get-shit-done/workflows/discovery-phase.md` (3-level research workflow)
- `agents/approach-explorer.md`, `distilled/templates/delegates/approach-explorer.md`

## D30 — Hardening Propagation
- D28 consumer audit (2026-03-21): persistence failures at every workflow boundary
- Huang et al. "LLMs Cannot Self-Correct Reasoning Yet" (ICLR 2024): LLMs need external feedback
- Kamoi et al. "When Can LLMs Actually Correct Their Own Mistakes?" (TACL 2024): self-correction requires reliable external feedback
- Anthropic long-context research (2024): instructions at decision points followed more reliably
- `distilled/workflows/quick.md`, `distilled/workflows/map-codebase.md`, `tests/gsdd.guards.test.cjs` (G24)

## D31 — Outcome Dimension for Plan-Checker
- Yu et al. "Outcome-Refining Process Supervision for Code Generation" (ICML 2025): +26.9% correctness with hybrid process+outcome supervision
- Rajan "Multi-Agent Code Verification via Information Theory" (2025): diminishing returns plateau at 4-7 dimensions
- Lightman et al. "Let's Verify Step by Step" (ICLR 2024): process supervision significantly outperforms outcome-only
- `distilled/templates/delegates/plan-checker.md` (`goal_achievement` dimension)

## D32 — Quick Workflow Alignment Hardening
- Risk-adaptive autonomy pattern (AWS, Azure, Anthropic 2025-2026): confirmation gates scale with consequence
- Anthropic agent autonomy research (2026): human-on-the-loop > human-in-the-loop
- Madaan et al. "Self-Refine" (NeurIPS 2023): 1 revision cycle captures most improvement
- `distilled/workflows/quick.md` (Steps 3.5-3.7), `tests/gsdd.guards.test.cjs` (G24)

## D33 — Quick Approach Clarification
- Anthropic "Measuring AI agent autonomy in practice" (2025): Claude asks 2x+ on complex tasks
- Knight First Amendment Institute "Levels of Autonomy for AI Agents" (2025): 5-level autonomy spectrum
- Anthropic "Framework for safe and trustworthy agents" (2025): recommendation-first framing
- Martin Fowler "Humans and Agents in SE Loops" (2025): HOTL > HITL
- `distilled/workflows/quick.md` (Step 2.5), `tests/gsdd.guards.test.cjs` (G24)

## D34 — Context Engineering Applied to Quick Workflow
- Anthropic Claude Prompting Best Practices: XML tags for semantic structure and attention
- Selective Prompt Anchoring (arXiv 2408.09121, 2024): up to 12.9% Pass@1 improvement from strategic anchoring
- `agentskit-architect SKILL.md` (prompty): identical hybrid XML-outer/markdown-inner structure
- `distilled/DESIGN.md` (DISTILLATION.md authority language resolution)
- `distilled/workflows/quick.md` (`<anti_patterns>` section, STOP normalization)

## D35 — Skills-Native Runtimes vs Governance Adapters
- Live consumer testing (2026-03-20): Cursor and Copilot auto-discover `.agents/skills/`
- User-performed live validation (2026-03-25): Gemini confirms same behavior
- `bin/lib/init.mjs` (adapter registry and root-governance generator)
- `README.md`, `distilled/templates/agents.block.md`, `tests/gsdd.guards.test.cjs`

## D36 — Interactive Init Wizard
- `bin/lib/init.mjs` existing adapter-selection seam
- Local research on adjacent `prompty` repo: portable skills as primary install surface
- Repo lesson LL-INSTALL-DX-BEFORE-ALIAS-CLEANUP (lessons-learned.md)
- `bin/lib/init.mjs`, `bin/gsdd.mjs`, `tests/gsdd.init.test.cjs`
- npm init, Vite `create-vite`, Next.js `create-next-app`, Angular CLI `ng new`, Astro `create astro` — all use TTY-interactive wizard with headless flags (industry standard for project scaffolding)

## D37 — Mutability-Driven Workflow Classification
- `distilled/workflows/verify.md`, `new-project.md`, `audit-milestone.md`, `pause.md`, `resume.md` (all require artifact writes)
- `distilled/workflows/progress.md` (only read-only workflow)
- Consumer audit: verification reports lost when persistence skipped
- `bin/gsdd.mjs`, `bin/lib/rendering.mjs`, `tests/gsdd.guards.test.cjs` (G27)
- Meyer's Command-Query Separation (CQS, "Object-Oriented Software Construction" 1988) — classify operations by mutation behavior, not semantic category
- Greg Young's CQRS (2010) — CQS applied at the architectural level
- Unix rwx model + AWS IAM / Kubernetes RBAC — classify by mutation semantics as industry norm

## D38 — Retroactive Artifact Enforcement
- `.internal-research/gaps.md` I27 entry (two occurrences, root-cause analysis, close conditions)
- `distilled/workflows/execute.md` (D28 SUMMARY.md persistence gate)
- `distilled/workflows/verify.md` (D28 VERIFICATION.md persistence gate + D28/G30 ROADMAP closure)
- `distilled/workflows/audit-milestone.md` (retroactive artifact completeness check)
- `.internal-research/strategy.md` (kernel simplicity vs policy depth trade-off)
- `tests/gsdd.guards.test.cjs` (G30 guard for ROADMAP closure on pass)
- NIST SP 800-53 Rev. 5 (2020) — detective vs preventive controls as equally valid risk-management strategies
- ISO 27001 risk treatment — choice of detective vs preventive depends on cost/complexity tradeoff
- Reason's Swiss Cheese model (1990) — layered defense where retroactive audit catches what preventive layers miss

---

## Maintenance

Update this file when:
- A new design decision is added to `distilled/DESIGN.md` (add entry here before or alongside the DESIGN.md commit)
- An existing decision's evidence changes (update the relevant entry)

Guard: G31 in `tests/gsdd.guards.test.cjs` asserts every decision in DESIGN.md ToC has an entry here with at least one source.
