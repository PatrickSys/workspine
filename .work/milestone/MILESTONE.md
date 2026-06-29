# Milestone: `gsdd next` Continuity

Date: 2026-06-20
Status: implementation and verification complete for Phases 1-7
Canonical goal: `.work/goal.md`
Research grounding: `.work/research/2026-06-20-long-term-agent-harness-consistency.md`

## Objective

Make `gsdd next` the agent-facing continuity primitive for Workspine.

It must inspect `.work`, repo truth, legacy `.planning` where present, decisions, questions, evidence, and graph state, then emit the next coherent agent action without pretending to run an unbounded autonomous loop.

## Scope

In scope:

- `.work` bootstrap and privacy defaults.
- Append-only local graph event log plus rebuildable index.
- `gsdd next` read-only routing and JSON/human packets.
- Question, decision, dogfood, and graph subcommands.
- Fixture-style routing coverage for all allowed states.
- Trust gate routing before execution-like states.
- Durable phase packets under `.work/milestone/phases`.
- Easy global install auto mode that routes through the existing `install --global` path.

Out of scope:

- Raw transcript ingestion.
- Hosted memory.
- SQLite, vector databases, graph databases, or MCP memory servers.
- Browser-provider implementation.
- Auto-running workflow commands from `gsdd next`.
- Remote installer manifests, handoff-file parsers, shell script execution, or unmanaged user-home writes.

## Done-When

- `gsdd next --init` creates `.work` idempotently.
- `gsdd next --json` returns one valid packet with traceable inputs, skipped inputs, constraints, and evidence requirements.
- Graph rebuild validates malformed events and fails closed.
- Blocking questions and decisions persist and influence routing.
- Evidence trust gates outrank optimistic state routing.
- Tests cover the route surface and representative failure modes.
- This milestone has per-phase plan, execute, and verify packets under `.work/milestone/phases`.
- `gsdd install --global --auto` lets a user install detected global agent surfaces in one command, while `--tools <targets>` remains the explicit override for scoped installs.
- Lifecycle preflight treats matching `.work/milestone` phases as work-native authority, preventing branch-local phase packets from colliding with unrelated `.planning` milestones downstream.

## Current Evidence

- `rtk node --test --test-reporter=spec tests/gsdd.next.test.cjs`: passed.
- `rtk node --test --test-reporter=spec tests/gsdd.guards.test.cjs`: passed.
- `rtk npm test`: passed.
- `rtk npm pack --dry-run --json`: passed before the final durable phase packet addition.
- Phase 7 execute and verify packets prove the detected global install auto path, scoped `--tools` override, no-detection failure, work-native lifecycle preflight, guard tests, full suite, generated-helper behavior, and package dry-run.

## Next Human Steering

Run a final package dry-run after any additional durable milestone packet changes before treating this exact tree as release-ready.
