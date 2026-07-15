# Agentic Research MVP for Workspine

This MVP distills HyperResearch-style decomposition + multi-pass research into a Workspine-native, repo-first flow usable by any developer when web research is enabled.

## Goals

- Add a deterministic, artifact-first **agentic web research harness** to Workspine.
- Preserve Workspine's existing evidence/verification philosophy.
- Keep the first version lightweight enough to run today from existing skills.

## Architecture (MVP)

```text
query intake
  -> decomposition contract
  -> width sweep (parallel source collection)
  -> depth passes (focused sub-questions)
  -> synthesis
  -> adversarial critique
  -> patch + finalize
  -> verification pack
```

### Core artifacts

All artifacts live under `.planning/research/agentic/`:

- `scaffold.md` — run config, model/tooling assumptions, citation style.
- `prompt-decomposition.json` — atomic asks, entities, section contract, tier/format.
- `coverage-matrix.md` — phrase-to-atomic coverage audit, zero known gaps requirement.
- `width-sweep.md` — broad source harvest and clustering.
- `depth-notes/*.md` — deep dives by sub-question.
- `synthesis.md` — thesis, claims, confidence, tensions.
- `critique.md` — adversarial reviewer findings.
- `patches.md` — revision deltas applied after critique.
- `final-report.md` — publishable output.
- `verification.md` — evidence gates: source quality, instruction coverage, unresolved risks.
- `scratchpad.md` — append-only operator log for long-running jobs.

## Workflow mapping into Workspine

This MVP maps to existing workflow primitives instead of introducing a new binary command:

1. Use `gsdd-plan` to define research objective/scope in phase plan.
2. Execute using the new harness instructions in `.planning/templates/research/agentic-harness.md`.
3. Verify with `gsdd-verify` plus research-specific checklist from template.

## Tradeoffs considered

### 1) Full orchestration engine vs template-first harness

- **Chosen:** template-first harness.
- **Why:** lowest integration risk; no new runtime dependency or scheduler needed.
- **Tradeoff:** less automation than a bespoke orchestrator; more manual operator discipline.

### 2) Single-pass writeup vs decomposition-driven pipeline

- **Chosen:** decomposition-driven pipeline.
- **Why:** better instruction-following and coverage control.
- **Tradeoff:** more artifacts and overhead for simple queries.

### 3) Maximal source count vs quality-gated source sets

- **Chosen:** quality-gated source sets.
- **Why:** avoids noisy synthesis and citation bloat.
- **Tradeoff:** may miss fringe signals unless explicitly widened.

### 4) Purely neutral summary vs adversarial critique pass

- **Chosen:** adversarial critique required before finalization.
- **Why:** catches unsupported claims and overconfident framing.
- **Tradeoff:** extra latency per report.

## Operating rules for web-enabled research

- Prefer primary sources (official docs, papers, filings) where possible.
- Record retrieval date in artifact headers.
- Every major claim in `final-report.md` must trace to at least one source in synthesis notes.
- No unresolved `Gap? = YES` rows in coverage matrix before synthesis.

## Definition of done (MVP)

A research run is done when:

1. Required artifacts exist and are non-empty.
2. Coverage matrix has zero known gaps.
3. Critique findings are either fixed or explicitly accepted with rationale.
4. Final report includes clear assumptions, confidence notes, and source list.
5. Verification file passes all checklist items.

## Integration note: "latest agentic harness"

For this MVP, "latest harness" is represented as a **pipeline contract** and artifact schema, not a hard-coded external dependency. This keeps Workspine stable while allowing future upgrades to deeper automation in a backward-compatible way.
