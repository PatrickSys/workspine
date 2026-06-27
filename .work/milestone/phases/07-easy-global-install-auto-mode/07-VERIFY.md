---
phase: 07-easy-global-install-auto-mode
runtime: codex-cli
assurance: self_checked
verified: 2026-06-26T09:26:24+02:00
status: passed
score: 4/4 must-haves verified
delivery_posture: delivery_sensitive
evidence_contract:
  required_kinds: [code, runtime, delivery]
  recommended_kinds: [test]
  observed_kinds: [code, test, runtime, delivery]
  missing_kinds: []
gaps: []
git_delivery_check:
  branch: feat/dogfood-installability-spine
  commits_ahead_of_main: 14
  pr_state: merged
---

# Phase 7 Verify Packet

Status: passed

## Verification Basis

- Plan: `.work/milestone/phases/07-easy-global-install-auto-mode/07-PLAN.md`
- Execute packet: `.work/milestone/phases/07-easy-global-install-auto-mode/07-EXECUTE.md`
- Code artifacts: `bin/lib/global-install.mjs`, `bin/lib/init-runtime.mjs`, `bin/lib/lifecycle-preflight.mjs`
- Tests/docs artifacts: `tests/gsdd.init.test.cjs`, `tests/gsdd.global-install-pressure.test.cjs`, `tests/phase.test.cjs`, `tests/gsdd.guards.test.cjs`, `README.md`, `docs/USER-GUIDE.md`, `docs/RUNTIME-SUPPORT.md`

Initial legacy `.planning` verify preflight blocked for this branch-local follow-up because Phase 7 is represented in `.work/milestone`, not `.planning/ROADMAP.md`. That downstream clash is now hardened: source and generated lifecycle helpers return `authority: "work_milestone"` for matching `.work/milestone` phases, keep `.planning` drift as a warning, and still fail repeat execute as `no_pending_plan`.

Resume preflight had the same authority-selection issue in a different shape: generic checkpoints do not carry a phase argument, so they could still block on unrelated `.planning` drift before the checkpoint could be loaded. Source and generated lifecycle helpers now detect checkpoints that explicitly point at `.work/milestone` continuity and allow resume with `authority: "work_milestone"` while preserving drift blocking for ordinary checkpoints.

## Must-Haves

- `install --global --auto` installs detected local agent targets without prompting: verified by init and pressure-loop tests.
- `install --global --auto --tools codex` remains scoped: verified by init tests.
- No supported target detected fails closed before writes and points to `--tools`: verified by init tests.
- Invalid targets fail before writes: verified by init tests.
- `init --auto` remains repo-local and unchanged: verified by existing init auto-mode tests plus the global-auto no-bootstrap regressions.
- Branch-local `.work/milestone` phases and checkpoints do not collide with unrelated `.planning` lifecycle state: verified by phase preflight tests and local generated-helper execution.

## Artifact Verification

| Artifact | Exists | Substantive | Wired | Notes |
| --- | --- | --- | --- | --- |
| `bin/lib/global-install.mjs` | yes | yes | yes | Adds detected auto target selection before interactive fallback, keeps manifest writer unchanged. |
| `bin/lib/init-runtime.mjs` | yes | yes | yes | Help text distinguishes repo-local `init --auto` from global install `--auto`. |
| `bin/lib/lifecycle-preflight.mjs` | yes | yes | yes | Adds scoped `.work/milestone` authority for matching work phases and `.work` resume checkpoints while preserving `.planning` behavior by default. |
| `tests/gsdd.init.test.cjs` | yes | yes | yes | Covers detection, explicit scope, no detection, invalid targets, and no repo bootstrap. |
| `tests/gsdd.global-install-pressure.test.cjs` | yes | yes | yes | Covers cross-repo global auto install behavior. |
| `tests/phase.test.cjs` | yes | yes | yes | Covers `.work/milestone` execute/verify/resume preflight, drift handling, ordinary checkpoint drift blocking, repeat execute block, and generated helper behavior. |
| Public docs | yes | yes | yes | README, User Guide, and Runtime Support show `install --global --auto` and `--tools` override. |

## Evidence

- `rtk node tests/gsdd.global-install-pressure.test.cjs`: passed, 12 tests.
- `rtk node tests/gsdd.init.test.cjs`: passed, 44 tests.
- `rtk node tests/phase.test.cjs`: passed, 163 tests.
- `rtk node .planning/bin/gsdd.mjs lifecycle-preflight verify 7 --expects-mutation phase-status`: passed with `authority: "work_milestone"` and planning drift as warning.
- `rtk node .planning/bin/gsdd.mjs lifecycle-preflight execute 7 --expects-mutation phase-status`: blocked as expected with `reason: "no_pending_plan"` because `07-EXECUTE.md` exists.
- `rtk node .planning/bin/gsdd.mjs lifecycle-preflight resume`: passed with `authority: "work_milestone"` and planning drift as warning because the checkpoint points at `.work/milestone`.
- `rtk node tests/gsdd.guards.test.cjs`: passed, 387 tests.
- `rtk node bin/gsdd.mjs help`: passed and showed `install --global [--auto] [--tools <platform>] [--dry]`.
- `rtk npm pack --dry-run --json`: passed and included changed runtime/doc files in the package listing.
- `rtk npm test`: passed.
- `rtk git diff --check`: passed.

## Anti-Patterns

- No `--from` implementation, stdin parser, markdown/JSON manifest parser, URL fetch, script execution, or `autoinstall` command was introduced.
- Existing `console.log` hits are intentional CLI/test output surfaces.
- The only TODO/FIXME/HACK marker hit in scoped scan is documentation describing the health check output categories, not implementation debt.

## Remaining Risk

- Detection is intentionally conservative: it depends on existing target home directories. If a user has an installed agent that has not created its config home yet, `--auto` fails closed and tells them to use `--tools`.
- Git delivery metadata points at an already merged PR for the branch head; current Phase 7 changes are local uncommitted work and would need a new commit/PR if shipping.
