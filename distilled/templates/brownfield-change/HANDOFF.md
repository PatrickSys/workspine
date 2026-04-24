---
change: CHANGE-001
updated: 2026-04-21
---

# Brownfield Change Handoff

Use this file for rolling judgment and cross-session continuity on the active change.
Do not duplicate milestone roadmap state here.
Operational state still lives in `CHANGE.md`.
This file explains constraints, uncertainty, posture, and anti-regression context; it must not become a second status or routing authority.
If this change widens into milestone planning, this file remains the preserved judgment input to `/gsdd-new-project` or `/gsdd-new-milestone`; do not copy it into a second promotion artifact.

## Active Constraints

- Boundaries that the next session must keep.
- Explicit no-touch surfaces or approval gates.

## Unresolved Uncertainty

- Open questions that still affect execution or verification.
- Unknowns that are safe to keep open for now.

## Decision Posture

- What approach was chosen and why.
- What was intentionally deferred.

## Anti-Regression

- Invariants future work must not break.
- Contract rules that keep this lane bounded.

## Next Action

- Record only the decision context behind the `CHANGE.md` next action.
- If the work is blocked, name the unblock path exactly, but keep the authoritative operational next step in `CHANGE.md`.
- If the work widens into milestone planning, keep the why/why-not context here so the milestone workflow can reuse it without rediscovery.
