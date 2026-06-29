# Milestone Audit: `gsdd next` Continuity

Date: 2026-06-20
Status: passed after PR hardening and installability dogfood loops

## Audit Basis

- `.work/goal.md`
- `.work/research/2026-06-20-long-term-agent-harness-consistency.md`
- `bin/lib/work-context.mjs`
- `bin/lib/next.mjs`
- `tests/gsdd.next.test.cjs`
- Real repo `gsdd next` packets
- Full `rtk npm test`

## Installability Follow-Up

Phase 7 added `install --global --auto` as a detected-target global install path through the existing manifest-safe writer. It is covered by execute and verify packets plus init, install pressure, guard, full-suite, help, and package dry-run evidence.

The Phase 7 hardening also fixed the downstream lifecycle authority clash found during dogfood: matching `.work/milestone` phases and checkpoints now pass through `work_milestone` preflight authority instead of being blocked by unrelated `.planning` phase numbers or planning drift.

## Findings

Passed:

- `.work` is created idempotently and keeps mutable runtime state local by default.
- `gsdd next` fails honestly when legacy `.planning` milestone files are absent.
- Malformed graph and malformed questions block routing instead of being silently ignored.
- Trust gates are checked before state-derived execution routing.
- Human output now exposes evidence requirements, skipped inputs, and trace refs.
- Tests cover all allowed routing states and core persistence commands.

Fixed during second harness pass:

- Missing `open.json` is now surfaced as skipped input rather than silently considered.
- Malformed `open.json` blocks routing.
- Invalid decision privacy no longer writes a partial decision artifact.
- Human packet output is less opaque for agents.

Fixed during third challenge loop:

- `gsdd next` now treats `.work/milestone` as Workspine-native lifecycle truth.
- Source bootstrap `.work/.gitignore` now whitelists future `.work/milestone/**` files, not just the hand-edited local file.
- Real repo `gsdd next --json` no longer routes backward to "draft .work milestone plan" after the milestone roadmap, audit, and phase packets exist.
- Completion approval packets now tell the agent to review `.work/milestone/AUDIT.md`, `.work/milestone/ROADMAP.md`, and `.work/evidence/manifest.json`.
- Added a regression test proving a passed `.work/milestone` audit prevents backward routing to planning.

Fixed during PR hardening loops:

- `gsdd next` packets now include typed `next_action` values instead of relying only on overloaded `next_command` strings.
- Captured stdout defaults to JSON through `--format auto`; `--format human` gives the compact supervisor card.
- Dirty worktree risk is reported as `repo_warnings`, not privacy notes.
- Question, decision, and dogfood mutation replays are retry-safe when content matches and fail closed when content differs unless `--replace` is explicit.
- Question answers and decision supersession are represented as explicit graph edges.
- `.work` projection writes use atomic replacement and graph/audit JSONL appends are fsynced before returning.
- Added durable PR scratchpad at `.work/milestone/scratchpad/2026-06-21-pr-ship-loop.md`.

Residual hardening candidates:

- Add full WAL-style operation commits with `op_id`, `prev_event_id`, `content_sha256`, and `op_committed`.
- Add deterministic golden packet fixtures with normalized volatile fields.
- Add consistency checks for orphaned side artifacts lacking committed graph events.
- Add package dry-run after every future durable file addition before release.

## Closure

The implemented local v1 is now more coherent with the current milestone because the router consumes the `.work/milestone` lifecycle surface it asked the agent to create, emits a typed agent action contract, and keeps the human supervisor surface compact. The remaining items are deeper durability/eval hardening follow-ups, not blockers for the scoped v1.

The expanded milestone scope is closed for the local `.work` surface. `.planning` lifecycle drift is still reported, but matching `.work/milestone` packets are no longer governed by `.planning` phase ownership.
