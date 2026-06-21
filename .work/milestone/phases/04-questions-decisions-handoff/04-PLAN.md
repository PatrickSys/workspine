# Phase 4 Plan: Questions, Decisions, and Handoff

## Goal

Make user decision frontloading and return-later continuity durable.

## Requirements

- QUESTION-01
- INTERRUPT-01
- DECISION-01

## Tasks

1. Add open question persistence and answer history.
2. Route unresolved blocking questions to `ask_user`.
3. Add decision persistence with privacy validation and supersession fields.
4. Maintain handoff context for future runs.

## Evidence

- `gsdd next question add`
- `gsdd next question answer`
- `gsdd next decision record`
- `.work/handoff/current.md`

## Boundaries

- Do not ask non-blocking questions just to avoid engineering judgment.
- Do not write partial decision artifacts on invalid input.
