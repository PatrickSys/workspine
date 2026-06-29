# Phase 7 Execute Packet

## Implemented

- Added `install --global --auto` to the existing global install command.
- Auto mode detects existing supported agent homes and installs only those targets.
- Explicit `--tools <targets>` continues to override detection and preserve scoped installs.
- No-detection auto mode fails closed with a clear `--tools` fallback and writes no global files.
- Invalid explicit targets still fail before any manifest writes.
- Help, README, user guide, and runtime support docs now present `install --global --auto` as the easy non-interactive global install path.
- Hardened lifecycle preflight so branch-local `.work/milestone` phases are governed by `.work` plan/execute packets instead of unrelated `.planning` phase numbers or drift.
- Hardened resume preflight so a generic checkpoint that explicitly points at `.work/milestone` continuity is allowed through `work_milestone` authority while unrelated `.planning` drift remains warning-level.

## Files

- `bin/lib/global-install.mjs`
- `bin/lib/init-runtime.mjs`
- `bin/lib/lifecycle-preflight.mjs`
- `tests/gsdd.global-install-pressure.test.cjs`
- `tests/gsdd.init.test.cjs`
- `tests/phase.test.cjs`
- `tests/gsdd.guards.test.cjs`
- `README.md`
- `docs/USER-GUIDE.md`
- `docs/RUNTIME-SUPPORT.md`

## Deviations

- Initial legacy `.planning` execute/verify preflight blocked because Phase 7 is not in `.planning/ROADMAP.md` and `.planning/SPEC.md` has pre-existing drift. The deterministic preflight helper now recognizes matching `.work/milestone` phases as `work_milestone` authority, so downstream generated helpers no longer force branch-local packets through unrelated `.planning` phase numbers.
- Initial resume preflight still blocked because `resume` has no phase argument, so it could not reach the phase-based `.work/milestone` authority path. The deterministic preflight helper now classifies `.work/milestone` resume checkpoints before applying `.planning` drift as a blocker.
- `tests/gsdd.guards.test.cjs` did not need code changes; the existing guard suite covers the public docs/help contracts after the docs update.

## Verify

- `rtk node tests/gsdd.global-install-pressure.test.cjs`
- `rtk node tests/gsdd.init.test.cjs`
- `rtk node tests/phase.test.cjs`
- `rtk node tests/gsdd.guards.test.cjs`
- `rtk node .planning/bin/gsdd.mjs lifecycle-preflight verify 7 --expects-mutation phase-status`
- `rtk node .planning/bin/gsdd.mjs lifecycle-preflight execute 7 --expects-mutation phase-status`
- `rtk node .planning/bin/gsdd.mjs lifecycle-preflight resume`
- `rtk node bin/gsdd.mjs help`
- `rtk npm pack --dry-run --json`
- `rtk npm test`
- `rtk git diff --check`

## Second Pass

- Checked that no `--from`, handoff-file parser, stdin parser, URL installer, script execution, or `autoinstall` command was added.
- Checked that `init --auto` still requires `--tools` and writes repo-local `autoAdvance`.
- Checked that `install --global` without `--auto`, `--tools`, or TTY selection still fails in non-interactive shells.
- Checked that global install still never bootstraps repo-local `.planning/` or `.agents/`.
- Checked that `.work/milestone` authority activates only when the requested phase exists in `.work/milestone/ROADMAP.md`; ordinary `.planning` lifecycle gates retain their existing behavior.
- Checked that resume only downgrades `.planning` drift when the checkpoint itself points at `.work/milestone`; ordinary checkpoints still block on planning drift.
