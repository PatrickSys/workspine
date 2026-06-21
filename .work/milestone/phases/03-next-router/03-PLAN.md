# Phase 3 Plan: `gsdd next` Router

## Goal

Implement `gsdd next` as a read-only state router that emits concise human output and structured JSON.

## Requirements

- NEXT-01
- FLOW-01
- EVAL-01

## Tasks

1. Define the packet contract and allowed states.
2. Inspect `.work`, evidence, graph, questions, handoff, dogfood, and legacy `.planning`.
3. Route all allowed states deterministically where possible.
4. Add fixture tests for state routing and JSON shape.

## Evidence

- `gsdd next --json`
- `gsdd next`
- Route fixture tests

## Boundaries

- v1 recommends; it does not execute workflow commands.
- Do not silently cross human gates.
