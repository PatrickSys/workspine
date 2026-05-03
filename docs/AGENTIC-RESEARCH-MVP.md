# Agentic Research MVP (Web-enabled)

This MVP distills the HyperResearch-style decomposition and long-horizon research loop into Workspine-compatible artifacts that any developer can run with web research enabled.

## Scope and outcome

- Adds a reusable workflow contract for agentic research in `.planning/research/`.
- Enforces prompt decomposition before search.
- Uses a scratchpad protocol for long jobs to prevent drift.
- Captures architecture tradeoffs and verification gates so outputs are shippable.

## Architecture (MVP)

1. **Decompose first**
   - Parse the user request into atomic asks, entities, required sections, horizons.
   - Emit `prompt-decomposition.json` and heading contract.

2. **Breadth sweep (agentic search)**
   - Run broad source discovery across primary sources first.
   - Build a source ledger with relevance and confidence notes.

3. **Depth lanes**
   - Split into 2-5 focused lanes (methods, evidence quality, counterarguments, implementation implications).
   - Keep lane notes separate, then synthesize.

4. **Synthesis and adversarial pass**
   - Produce thesis + evidence chain.
   - Run a critic pass for missing sections, unsupported claims, and citation gaps.

5. **Delivery package**
   - Final report + sources + limitations + follow-up experiments.

## Core artifacts

- `.planning/research/scaffold.md`
- `.planning/research/query.md`
- `.planning/research/prompt-decomposition.json`
- `.planning/research/scratchpad.md`
- `.planning/research/source-ledger.md`
- `.planning/research/lane-*.md`
- `.planning/research/draft.md`
- `.planning/research/final.md`

## Tradeoffs

- **Rigor vs speed:** decomposition + critics improve fidelity but increase latency.
- **Breadth vs depth:** wider search reduces blind spots but costs tokens/time.
- **Single-agent vs lane parallelism:** parallel lanes improve coverage but require stronger merge discipline.
- **Citation density vs readability:** high citation density helps auditability, hurts narrative flow.

## Verification gates

- Structural match against required section headings.
- Every major claim has at least one source.
- Explicit unresolved questions and confidence labels.
- Reproducible scratchpad timeline of major decisions.

## How this integrates with Workspine

Use the reusable templates in `distilled/templates/research-agentic/` and copy them into `.planning/research/` as the starting harness for this MVP.
