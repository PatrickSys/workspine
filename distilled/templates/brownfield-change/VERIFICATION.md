---
change: CHANGE-001
verified: 2026-04-21
status: pending
delivery_posture: repo_only
required_evidence:
  - code
recommended_evidence:
  - test
---

# Brownfield Change Verification

Use this file as the existing proof surface even when the bounded change widens before closeout.
Milestone-init workflows should read it for preserved proof and remaining gaps instead of forcing the user to restate what is already verified.

Verification is the closeout evidence for the one active stream. It must evaluate every `CHANGE.md`
Done When item explicitly; missing, failed, or unverified items keep the change open and make `next`
route to verification or gaps. It does not replace `CHANGE.md` as operational authority.

## Goal Verification

- Restate the change goal in observable terms.
- Say whether the goal is verified, partially verified, or blocked.

## Evidence

List the evidence used to support closure. Use the shared evidence vocabulary:
- `code`
- `test`
- `runtime`
- `delivery`
- `human`

## Artifact Checks

| Artifact | Exists | Substantive | Wired | Notes |
| --- | --- | --- | --- | --- |
| [path] | yes | yes | yes | [notes] |

## Gaps

- Missing proof, missing behavior, or unresolved blockers.
- If required evidence is missing, say so explicitly.

## Widening Reuse

- Preserve already-confirmed proof when the change widens into milestone planning.
- Carry partial verification or known gaps forward so the milestone workflow can plan from current truth.
- Do not reset this evidence surface just because the work is moving into a larger lifecycle.

## Human Verification

- Manual checks still needed before closure, if any.

## Closeout Decision

- `passed` when the bounded change is proven complete.
- `gaps_found` when implementation or proof is still missing.
- `human_needed` when machine checks pass but human confirmation remains.

For a bounded close, use `status: passed` only when all required evidence and Done When items pass.
The owner then changes `CHANGE.md` posture to `closed`; no roadmap membership or second lifecycle
root is created.
