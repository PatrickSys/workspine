# Phase 5 Plan: Dogfood and Gap-Fix Loop

## Goal

Close the verify -> audit -> fix-gaps -> dogfood loop without letting agents overclaim completion.

## Requirements

- DOGFOOD-01
- FLOW-01

## Tasks

1. Route evidence gaps to `fix_gaps`.
2. Route passed verification without passed audit to `audit`.
3. Route passed audit without dogfood to `dogfood`.
4. Capture bounded local dogfood findings.

## Evidence

- `.work/evidence/manifest.json`
- `gsdd next dogfood capture`
- `gsdd next --json`

## Boundaries

- Dogfood findings stay local by default.
- Milestone completion still requires explicit human approval.
