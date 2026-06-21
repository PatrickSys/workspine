# Phase 6 Plan: Harness Evals and Trust Boundaries

## Goal

Add the minimum eval and trust-boundary coverage needed for long-term consistency.

## Requirements

- TRUST-01
- EVAL-01
- TRACE-01

## Tasks

1. Cover all route states with durable tests.
2. Ensure trust gates beat optimistic state routing.
3. Surface skipped inputs and trace refs in human output.
4. Run full package tests and packaging checks.

## Evidence

- `tests/gsdd.next.test.cjs`
- `rtk npm test`
- `rtk npm pack --dry-run --json`

## Boundaries

- No live vendor probes or browser attachment.
- No publication of local-only runtime state.
