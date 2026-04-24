---
change: CHANGE-001
status: active
type: medium_scope_brownfield
---

# Brownfield Change: [Short Title]

> This folder is the bounded medium-scope lane.
> It represents one active medium-scope change only.
> Do not add phase numbering, roadmap checkboxes, or milestone state here.
> Instantiate the live operational artifact at `.planning/brownfield-change/CHANGE.md`.
> `progress` and `resume` read this file first for status, scope, integration surface, and the authoritative next action.
> If this lane no longer fits one active stream, widen explicitly through `/gsdd-new-project` (first milestone) or `/gsdd-new-milestone` (subsequent milestone) using this folder as the preserved input surface. Do not invent a separate promotion artifact.

## Goal

State the single cohesive outcome this change is meant to achieve.

## Why This Exists

- Why this work matters now.
- What user, operator, or repo problem it solves.

## In Scope

- What this change includes.
- Which surfaces are allowed to move.

## Out of Scope

- What this change explicitly does not include.
- Work that should promote into milestone planning instead of widening this folder.

## Structural Promotion Triggers

Widen into milestone planning only when one or more of these become true:

- The work no longer fits one active stream with one shared goal and closeout path.
- The change needs roadmap-owned lifecycle state, multiple planned phases, or milestone-level requirement tracking.
- Independent slices can no longer keep disjoint write ownership under one bounded change.
- The proof or review burden has grown beyond what one `CHANGE.md` / `HANDOFF.md` / `VERIFICATION.md` chain can carry honestly.

Choose the widening surface case-by-case:

- Use `/gsdd-new-project` when the repo has no shipped milestone history yet.
- Use `/gsdd-new-milestone` when the repo already has shipped milestone history and this change now needs the next milestone cycle.

## Done When

- Observable outcomes that prove the change is complete.
- Conditions that must be true before closeout.

## Current Status

- Current posture: `active | blocked | ready_for_verification | closed`
- Current branch / integration surface:
- Current owner / runtime:

Keep these labels concrete and current. This section is the canonical operational continuity surface for the active change.

## Next Action

- The single best next move from repo truth.
- If blocked, name the blocker and the exact unblock step.

Keep the first bullet as the authoritative next action. `HANDOFF.md` may explain why, but it must not become a competing operational source.

## PR Slice Ownership

Use this only when the change spans multiple PRs or working slices.
Every slice must have disjoint write ownership and still roll up to the same goal and closeout path.
When possible, list repo-relative paths or module roots in `Owned files / modules` so continuity checks can compare the declared write scope to the live worktree.

| Slice | Scope | Owned files / modules | Status |
| --- | --- | --- | --- |
| A | [What this slice does] | [Disjoint write set] | planned |

## Dependencies And Risks

- External dependencies or repo assumptions.
- Cross-cut risks that would force promotion into milestone planning.

## Widening Handoff

If this bounded change needs milestone planning, reuse this folder directly instead of rediscovering the work:

- `CHANGE.md` carries the active goal, scope, done-when, next action, and declared write scope.
- `HANDOFF.md` carries the active constraints, unresolved uncertainty, decision posture, and anti-regression rules.
- `VERIFICATION.md` carries the proof and gap state gathered so far, even when that proof is only partial.

Promotion should preserve this context. Do not create a second durable handoff file before milestone setup begins.

## Closeout Path

1. Update `HANDOFF.md` so the latest decision context is recoverable from disk.
2. Record closeout evidence in `VERIFICATION.md`.
3. Close this folder only after the verification surface says the goal is satisfied.
4. If the work widens instead of closing, keep this folder as the promotion input and move into `/gsdd-new-project` or `/gsdd-new-milestone` explicitly.
