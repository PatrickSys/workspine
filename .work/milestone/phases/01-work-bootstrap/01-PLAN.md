# Phase 1 Plan: `.work` Bootstrap and Goal Contract

## Goal

Establish `.work` as the canonical continuity root without breaking legacy `.planning` reads.

## Requirements

- WORK-01
- COMPAT-01
- PRIVACY-01

## Tasks

1. Add path helpers and idempotent bootstrap for `.work`.
2. Create durable goal/research tracking while keeping mutable runtime files local-only.
3. Route missing `.planning` files honestly instead of inferring old lifecycle state.
4. Add tests for bootstrap, idempotency, privacy defaults, and missing legacy lifecycle truth.

## Evidence

- `gsdd next --init --json`
- `.work/.gitignore`
- `tests/gsdd.next.test.cjs`

## Boundaries

- Do not recreate `.planning` as the canonical surface.
- Do not ingest raw transcripts.
