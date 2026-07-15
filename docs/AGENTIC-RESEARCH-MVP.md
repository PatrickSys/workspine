# Agentic Research MVP (Hyperresearch Distillation)

**Status:** MVP-ready in Workspine  
**Date:** 2026-04-29

## Objective

Provide a practical, repo-native agentic web research harness that any developer can run end-to-end with evidence, scratchpad traceability, and handoff quality suitable for planning/execution workflows.

## Scope

This MVP adds:

1. A dedicated **agent contract** for decomposition-first web research.
2. A **scratchpad protocol** for long-running jobs.
3. A canonical **report template** that is strict about claims/evidence/confidence.
4. A suggested **execution lifecycle** that plugs into existing Workspine planning and verification workflows.

This MVP intentionally does **not** add a new CLI command yet; it is a workflow/contract integration that can be invoked via existing agent surfaces.

## Distilled Architecture

### Components

- **Orchestrator agent**: owns question framing, decomposition, synthesis, and final report quality.
- **Research workers**: parallel sub-agents that run targeted web/document research.
- **Scratchpad**: append-only task log for hypotheses, query paths, dead ends, and evidence links.
- **Evidence registry**: report-level table mapping each claim to source URLs and confidence.

### Data flow

1. Define research question and constraints.
2. Decompose into answerable sub-questions with explicit completion criteria.
3. Run workers in parallel against web-enabled tools.
4. Persist intermediate findings and uncertainty in scratchpad.
5. Merge, dedupe, contradiction-check, and confidence-score.
6. Emit final report in repository template.

## Tradeoffs (explicit)

- **Speed vs reliability:** parallel search is faster but increases duplicate/noisy evidence; mitigation is mandatory claim-level provenance.
- **Breadth vs depth:** broad decomposition catches blindspots but can dilute deep technical validation; mitigation is tiered pass (breadth first, depth second for decisive claims).
- **Autonomy vs determinism:** higher autonomy can improve discovery but harm reproducibility; mitigation is strict scratchpad + evidence contracts.
- **Token cost vs auditability:** richer traces cost more, but make handoff and review much stronger; MVP prefers auditability.

## Integration with existing Workspine lifecycle

- During **new-project** or **plan** phases, invoke the new agent contract when web research is available.
- Store outputs under `.planning/research/` (project) or phase directory (phase-specific).
- Use verification workflow discipline to check that recommendations are source-backed and actionable.

## MVP Operating Contract

1. Never publish a recommendation without at least one linked source.
2. Mark every major claim with confidence (`verified`, `likely`, `uncertain`).
3. Record unresolved questions and contradictions explicitly.
4. Keep scratchpad as durable artifact when total runtime exceeds 10 minutes or multi-agent fanout > 3 workers.
5. Include concrete next-step recommendations for planner/roadmapper consumption.

## Suggested rollout path

1. **Now (this MVP):** markdown contracts + templates + agent role.
2. **Next:** add `gsdd-research-agentic` workflow wrapper command.
3. **Later:** evidence schema linting and freshness TTL checks for cited web sources.

