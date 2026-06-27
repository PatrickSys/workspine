---
phase: 07-easy-global-install-auto-mode
plan: 07
type: execute
wave: 1
runtime: codex-cli
assurance: self_checked
depends_on: []
files-modified:
  - bin/lib/global-install.mjs
  - bin/lib/init-runtime.mjs
  - bin/lib/lifecycle-preflight.mjs
  - tests/gsdd.global-install-pressure.test.cjs
  - tests/gsdd.init.test.cjs
  - tests/phase.test.cjs
  - tests/gsdd.guards.test.cjs
  - README.md
  - docs/USER-GUIDE.md
  - docs/RUNTIME-SUPPORT.md
autonomous: true
requirements:
  - INSTALL-AUTO-01
  - INSTALL-SAFETY-01
  - WORK-LIFECYCLE-01
non_goals:
  - Do not add a second top-level installer when `install --global` can own the path.
  - Do not make repo-local `init --auto` semantics mutate global agent homes.
  - Do not fetch remote install specs, execute scripts, or infer install targets from arbitrary prose.
  - Do not add `--from`, install-handoff files, stdin parsing, or markdown/JSON manifest input in this phase.
hard_boundaries:
  - Global writes must continue through the existing manifest-tracked global install writer.
  - `install --global --auto` may be one-command easy, but it must still protect unmanaged and user-modified files.
  - Auto mode installs only detected local agent targets unless `--tools` explicitly scopes the target set.
  - Branch-local `.work/milestone` phase packets must not be forced through unrelated `.planning` phase ownership.
escalation_triggers:
  - Stop if implementation needs `--force`, unmanaged overwrite behavior, remote URLs, or shell execution.
  - Stop if adding `--auto` to global install would contradict the existing repo-local `init --auto` contract.
approval_gates:
  - Ask before changing `init --auto` behavior or the meaning of `autoAdvance`.
  - Ask before adding an `autoinstall` alias, `--from`, remote manifests, or arbitrary install instruction parsing.
anti_regression_targets:
  - `npx -y gsdd-cli init --auto --tools <target>` still writes repo-local `.planning` state and `autoAdvance: true`.
  - `install --global` without `--auto`, `--tools`, or TTY selection still fails in non-interactive shells.
  - Global install still never creates repo-local `.planning/` or `.agents/`.
ui_proof_slots: []
no_ui_proof_rationale: CLI/docs/test-only work; no rendered UI outcome is claimed.
high_leverage_surfaces:
  - bin/lib/global-install.mjs
  - bin/lib/init-runtime.mjs
  - bin/lib/lifecycle-preflight.mjs
  - README.md
second_pass_required: true
closure_claim_limit: Claim only easier detected global installation, not handoff-file installation, autonomous remote installation, or live runtime parity.
parallelism_budget:
  max_concurrent_plans: 1
  safe_parallelism: []
leverage:
  lost: Adds one more meaning for `--auto` that must be documented carefully across init and install.
  kept: Existing manifest-safe global installer, repo-local `init --auto`, shared skill-root architecture, and global/local install separation.
  gained: One-command detected global install without creating a competing installer or manifest parser.
must_haves:
  truths:
    - A user can run `npx -y gsdd-cli install --global --auto` and install detected global agent targets without prompts.
    - A user can still pass `--tools <targets>` to explicitly scope the global install target set.
    - Existing `init --auto` and non-interactive global install safety behavior remain intact.
    - Matching `.work/milestone` phases use work-native lifecycle authority instead of unrelated `.planning` phase numbers.
  artifacts:
    - path: bin/lib/global-install.mjs
      provides: detected `install --global --auto` handling
    - path: bin/lib/init-runtime.mjs
      provides: help text that distinguishes repo-local auto init from global auto install
    - path: tests/gsdd.global-install-pressure.test.cjs
      provides: auto global install and detection/scoping regression coverage
    - path: tests/phase.test.cjs
      provides: work-native lifecycle preflight regression coverage for branch-local phase packets
  key_links:
    - from: bin/lib/global-install.mjs
      to: bin/lib/global-manifest.mjs
      via: existing manifest-tracked write path
    - from: README.md
      to: bin/lib/init-runtime.mjs
      via: matching public command examples
---

# Phase 7 Plan: Easy Global Install Auto Mode

## Objective

Make global install genuinely easy by extending the existing install command instead of inventing a separate installer. The primary user-facing path becomes:

```text
npx -y gsdd-cli install --global --auto
```

This should perform the safe default global install through the current manifest-tracked writer. In this phase, "safe default" means detected local agent targets only. A future handoff-file design can be considered separately after the basic install path is proven.

## Context

- `init --auto --tools <target>` already exists and is repo-local; it writes `.planning/config.json` with `autoAdvance: true`.
- `install --global` already installs global agent-home surfaces, but non-interactive use currently requires `--tools <targets>`.
- Existing tests explicitly protect both sides: repo-local `init --auto` and global install no-repo-bootstrap behavior.
- The previous Phase 7 draft proposed `gsdd autoinstall`; this revision keeps CLI gravity on the existing `install --global` command because that better matches the current architecture and the user's `--auto` point.

## Requirements Covered

- `INSTALL-AUTO-01`: User can run one command, `install --global --auto`, and install detected global Workspine surfaces without choosing targets interactively.
- `INSTALL-SAFETY-01`: Auto global install preserves manifest ownership checks, refuses unsafe target selections, and never bootstraps repo-local state.
- `WORK-LIFECYCLE-01`: Branch-local `.work/milestone` phase packets can execute and verify without being blocked by unrelated `.planning` phase numbers or planning drift.

## Must-Haves

1. `npx -y gsdd-cli install --global --auto` installs detected local agent targets without prompting.
2. `npx -y gsdd-cli install --global --auto --tools codex` still scopes installation to Codex only.
3. If no supported agent target is detected, the command exits clearly without writing global files and tells the user how to use `--tools`.
4. Invalid targets fail with exit code 1 before writes.
5. `init --auto` remains repo-local and unchanged except for docs clarifying the difference.
6. Matching `.work/milestone` phases return `authority: "work_milestone"` from lifecycle preflight; repeat execute still fails closed after the execute packet exists.

## Anti-Goals

- No `autoinstall` top-level command in this phase.
- No `--from` handoff file, stdin input, markdown instruction parser, or JSON manifest parser in this phase.
- No write-by-default behavior from arbitrary LLM prose.
- No URL installer, curl pipe, package-manager script runner, or remote manifest fetch.
- No `--force` escape hatch for unmanaged global files.
- No repo-local `.planning` bootstrap from global install.

## Hard Boundaries

- Use the existing `install --global` implementation and manifest writer.
- Treat `--auto` on global install as non-interactive default selection, not lifecycle `autoAdvance`.
- Keep interactive `install --global` behavior available for users who want to choose targets.
- Detection is advisory target selection only; manifest ownership remains the authority for whether a write is allowed.

## Evidence Contract

- Tests prove `install --global --auto` succeeds in a non-interactive fixture and writes the expected global surfaces.
- Tests prove `install --global --auto --tools codex` remains scoped.
- Tests prove no-detection behavior fails closed with a useful message and no global writes.
- Existing `init --auto` tests still pass, including `autoAdvance` config assertions.
- Docs and help show the one-command path and distinguish it from repo-local init.
- Phase preflight tests prove `.work/milestone` execute/verify semantics and generated-helper propagation.

## Common Pitfalls

- Conflating `autoAdvance` with global installer auto mode.
- Installing every global surface when only a subset of tools is detected.
- Treating lack of detection as permission to install everything.
- Weakening the non-interactive safety test for plain `install --global`.
- Creating a parallel `autoinstall` implementation that drifts from manifest safety.
- Smuggling the deferred handoff-file idea back into this phase.
- Letting `.work` dogfood packets collide with stale or unrelated `.planning` lifecycle state.

## Stop-And-Challenge

- Stop if the implementation would require changing `init --auto` behavior.
- Stop if detection is unreliable enough that `--auto` cannot safely choose targets without user input.
- Stop if implementation starts adding `--from`, remote fetch, script execution, or freeform prose interpretation.
- Stop if tests show any repo-local `.planning/` or `.agents/` state created by global install.
- Stop if `.work/milestone` authority masks ordinary `.planning` phase gates when no matching `.work` phase exists.

## Approval Gates

- Human approval is required before adding `--from`, URL support, remote manifests, script execution, or force overwrite.
- Human approval is required before renaming or repurposing `autoAdvance`.

<checks>
<plan_check>
checker: self
checker_runtime: codex-cli
status: passed
blocking: false
notes: Strict legacy `.planning` plan preflight remains blocked by stale planning-state drift and missing active roadmap parsing; this plan is intentionally written to the branch-local `.work` milestone surface. The revision explicitly answers the user's `--auto` concern by preferring detected `install --global --auto` over a new `autoinstall` command or `--from` handoff-file parser.
</plan_check>
</checks>

## Tasks

<task id="07-01" type="auto">
  <files>
    - MODIFY: bin/lib/global-install.mjs
    - MODIFY: bin/lib/init-runtime.mjs
  </files>
  <action>
    Extend global install argument parsing to support `--auto`.
    In auto mode, detect locally available supported agent targets when no
    `--tools` target is supplied; when `--tools` supplies targets, honor that
    explicit narrower set. If no supported target is detected, exit clearly with
    no writes and show the explicit `--tools` fallback. Update help text to show the
    simple one-command path and clarify that this is distinct from repo-local
    `init --auto`.
  </action>
  <verify>
    - Run `node tests/gsdd.global-install-pressure.test.cjs`
    - Run `node tests/gsdd.init.test.cjs`
    - Run `node bin/gsdd.mjs help`
  </verify>
  <done>
    `install --global --auto` works non-interactively through the existing global
    install writer, detected targets are scoped safely, and help text is clear.
  </done>
</task>

<task id="07-02" type="auto">
  <files>
    - MODIFY: tests/gsdd.global-install-pressure.test.cjs
    - MODIFY: tests/gsdd.init.test.cjs
    - MODIFY: tests/gsdd.guards.test.cjs
  </files>
  <action>
    Add tests for the one-command auto global install, scoped `--auto --tools`,
    no-detection behavior, invalid targets, and no repo bootstrap. Keep existing
    `init --auto` tests intact and add a regression asserting global `--auto`
    does not write `autoAdvance` or `.planning` state.
  </action>
  <verify>
    - Run `node tests/gsdd.global-install-pressure.test.cjs`
    - Run `node tests/gsdd.init.test.cjs`
    - Run `node tests/gsdd.guards.test.cjs`
  </verify>
  <done>
    The test suite locks the separation between repo-local auto init and global
    auto install while proving the easy path works.
  </done>
</task>

<task id="07-03" type="auto">
  <files>
    - MODIFY: README.md
    - MODIFY: docs/USER-GUIDE.md
    - MODIFY: docs/RUNTIME-SUPPORT.md
  </files>
  <action>
    Document the easy global install path as `npx -y gsdd-cli install --global
    --auto`. Show scoped variants with `--tools` and explain that auto mode uses
    detected local agent targets. Keep `init --auto` documented as repo-local setup
    with `.planning`/`autoAdvance`, and keep `install --global` documented as the
    user-home surface installer.
  </action>
  <verify>
    - Run `node tests/gsdd.guards.test.cjs`
    - Run `npm pack --dry-run --json`
  </verify>
  <done>
    Public docs make the easiest install path obvious without blurring local and
    global install responsibilities.
  </done>
</task>

<task id="07-04" type="auto">
  <files>
    - MODIFY: bin/lib/lifecycle-preflight.mjs
    - MODIFY: tests/phase.test.cjs
  </files>
  <action>
    Harden lifecycle preflight after dogfood exposed a downstream clash: when the
    requested phase exists in `.work/milestone/ROADMAP.md`, evaluate execute and
    verify against `.work/milestone/phases/*/{NN}-PLAN.md` and `{NN}-EXECUTE.md`
    rather than unrelated `.planning` phase artifacts. Keep `.planning` drift as
    a warning for work-native phases and preserve existing `.planning` behavior
    when no matching `.work` phase exists.
  </action>
  <verify>
    - Run `node tests/phase.test.cjs`
    - Run `node .planning/bin/gsdd.mjs lifecycle-preflight verify 7 --expects-mutation phase-status`
    - Run `node .planning/bin/gsdd.mjs lifecycle-preflight execute 7 --expects-mutation phase-status`
  </verify>
  <done>
    Source and generated helpers return `authority: "work_milestone"` for matching
    work phases, allow verify after execute, and fail repeat execute as
    `no_pending_plan`.
  </done>
</task>

## Verification

- Run `node tests/gsdd.global-install-pressure.test.cjs`
- Run `node tests/gsdd.init.test.cjs`
- Run `node tests/phase.test.cjs`
- Run `node tests/gsdd.guards.test.cjs`
- Run `npm pack --dry-run --json`

## Success Criteria

- `install --global --auto` is the shortest global install path and works in non-interactive shells.
- Detected agent targets define the default install set; `--tools` lets users explicitly narrow or override it.
- Invalid targets and no-detection cases fail closed before global writes.
- `init --auto` remains repo-local and unchanged.
- Branch-local `.work/milestone` lifecycle packets do not collide with unrelated `.planning` phase state.

## High-Leverage Review

High-leverage surfaces touched by the future implementation: global installer argument parsing, lifecycle preflight, CLI help, public README, and tests that protect install boundaries. A second pass is required before execution is considered complete, specifically checking that `--auto` does not conflate global install with repo-local `autoAdvance` and that `.work/milestone` authority does not weaken ordinary `.planning` gates.

## Leverage Review

- Lost: `--auto` now has two contexts that must be explained precisely.
- Kept: one installer implementation, manifest-tracked global writes, repo-local init semantics, and existing install pressure coverage.
- Gained: a one-command detected global install path without adding a second CLI noun or premature handoff-file parser, plus a deterministic work-native lifecycle seam for branch-local dogfood packets.

## Research Notes

- Existing repo facts resolve the core architecture: `init --auto` is repo-local and `install --global` is the user-home installer.
- No new library is required. Use Node built-ins and existing CLI helpers.
- Current agent-skill research remains relevant: global install should write reusable skill/native surfaces into user-home agent roots rather than requiring prompt paste.

## Notes

- Reduced assurance: `.planning` lifecycle preflight is blocked in this checkout; this branch uses `.work` for continuity.
- User direction for this revision: preserve and reuse the existing `--auto` vocabulary to make install easy.
- User direction for this revision: remove `--from`; handoff-file installation should be a future separate design, not Phase 7.
