# Phase 2 Plan: Continuity Graph Core

## Goal

Add an append-only local graph event log and rebuildable index for continuity facts.

## Requirements

- GRAPH-01
- TRACE-01
- DECISION-01

## Tasks

1. Define allowed event, node, edge, privacy, and source types.
2. Implement event append validation and deterministic index rebuild.
3. Connect decisions, questions, and dogfood findings to graph events.
4. Add tests for malformed events and rebuild behavior.

## Evidence

- `gsdd next graph rebuild --json`
- Graph-related tests in `tests/gsdd.next.test.cjs`

## Boundaries

- No SQLite, graph DB, vector DB, or hosted memory.
- Graph events are local-first and privacy-tagged.
