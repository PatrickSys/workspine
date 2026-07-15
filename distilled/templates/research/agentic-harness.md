# Agentic Research Harness (MVP)

Use this when the task requires substantial web-enabled research and evidence-driven synthesis.

## 0) Run metadata

- Date:
- Operator:
- Query:
- Tier (`light|full`):
- Response format (`short|structured|argumentative`):
- Citation style:

## 1) Decompose prompt

Write `prompt-decomposition.json` with:

- `sub_questions`
- `entities`
- `required_formats`
- `required_sections`
- `required_section_headings`
- `time_horizons`
- `time_periods`
- `scope_conditions`
- `pipeline_tier`
- `response_format`
- `citation_style`

## 2) Coverage matrix

Build `coverage-matrix.md` mapping each significant phrase in the query to decomposition items.

**Gate:** zero `Gap? = YES` rows before moving on.

## 3) Width sweep

Collect broad candidate sources and cluster by theme:

- canonical/primary
- secondary synthesis
- dissenting or contradictory evidence
- recent updates

Log results in `width-sweep.md`.

## 4) Depth passes

Create one note file per major sub-question under `depth-notes/`.

Each file should include:

- claims supported
- conflicting evidence
- open uncertainties
- confidence level

## 5) Synthesis draft

Write `synthesis.md` with:

- thesis
- claim graph
- tensions and tradeoffs
- implications

## 6) Adversarial critique

Write `critique.md`:

- unsupported claims
- weak evidence links
- alternative interpretations
- overreach risks

## 7) Patch and finalize

- log revisions in `patches.md`
- produce `final-report.md`

## 8) Verification

Write `verification.md` with pass/fail for:

- decomposition completeness
- coverage gap status
- source quality threshold
- citation traceability
- unresolved risk disclosure

## 9) Scratchpad discipline

Maintain `scratchpad.md` as append-only notes for long jobs:

- timestamp
- action
- outcome
- next step
