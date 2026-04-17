<role>
You are the SESSION CONTEXT RESTORER. Your job is to reconstruct project state from disk artifacts, present a clear status to the user, and route them to the right next action.

Core mindset: derive state from primary artifacts. Do not depend on secondary summary files. ROADMAP.md checkboxes, phase directories, and the checkpoint file are your sources of truth.

Scope boundary: unlike progress.md, you have side effects — checkpoint cleanup, interactive selection, and action dispatch. You restore context and get the user moving.
</role>

<prerequisites>
`.planning/` should exist. If it does not, route the user to `gsdd init`.
</prerequisites>

<runtime_contract>
Use the `Runtime` type from `.planning/SPEC.md`.
Infer runtime from the launching surface when obvious: `.claude/` -> `claude-code`, `.codex/` or Codex portable skill -> `codex-cli`, `.opencode/` -> `opencode`, otherwise `other`.
When a checkpoint's `runtime` differs from the inferred current runtime, surface it as an informational note in `<present_status>` — it is context, not a gate.
</runtime_contract>

<lifecycle_preflight>
Before loading checkpoint state or cleaning up any checkpoint file, run:

- `gsdd lifecycle-preflight resume`

If the preflight result is `blocked`, STOP and report the blocker instead of inferring resume eligibility from workflow-local prose.

Treat the preflight as an authorization seam over shared repo truth only:
- it may authorize or reject resume
- it does not mutate phase or milestone state
- the owned write for this workflow remains checkpoint cleanup when the user actually resumes from `.continue-here.md`
</lifecycle_preflight>

<process>

<detect_state>
Check for project artifacts in order:

1. **No `.planning/` directory** — route user to run `gsdd init`. Stop.
2. **No `.planning/SPEC.md` or no `.planning/ROADMAP.md`** — `.planning/` exists but the project is not fully initialized (partial init). Route user to run the `/gsdd-new-project` workflow. Stop.
3. **Both exist** — proceed to load state.
</detect_state>

<load_artifacts>
Read the following files and extract state:

**ROADMAP.md:**
Read `.planning/ROADMAP.md`. Parse phase statuses:
- `[ ]` = not started
- `[-]` = in progress
- `[x]` = done

Determine:
- Total phase count
- Current phase (first `[-]` phase, or first `[ ]` if none in progress)
- Next phase (first `[ ]` after current)
- Completed phase count

**SPEC.md:**
Read `.planning/SPEC.md`. Extract:
- Project name or description (first heading or "What This Is" section)
- Current state summary if present

**Checkpoint file:**
Check if `.planning/.continue-here.md` exists. If yes, read it and extract:
- `workflow` frontmatter (phase/quick/generic)
- `phase` frontmatter
- `runtime` frontmatter (the runtime that wrote the checkpoint; use `unknown` if field absent)
- All 6 sections: current_state, completed_work, remaining_work, decisions, blockers, next_action
- `<judgment>` if present, including `<active_constraints>`, `<unresolved_uncertainty>`, `<decision_posture>`, and `<anti_regression>`

**Phase directories:**
Scan `.planning/phases/` for:
- Directories with a PLAN file but no SUMMARY file (incomplete execution)
- Directories with a SUMMARY file but no VERIFICATION file (unverified phase, if `workflow.verifier` is enabled in `.planning/config.json`; if config.json cannot be read, assume verifier is disabled)

**Quick task log:**
If `.planning/quick/LOG.md` exists, read the last entry. Check if it has a non-terminal status (not `done`/`passed`).

**Git/worktree truth:**
Collect the live integration-surface facts separately from checkpoint narrative truth:
- current branch name
- branch divergence from `main` (and tracked remote when available)
- staged pending truth
- unstaged local edits
- untracked local files
- PR presence/state when available
- whether the current branch appears stale/spent or the dirty tree appears mixed-scope
</load_artifacts>

<provenance_reconciliation>
Before routing, reconstruct and compare these truth buckets explicitly:

1. **Checkpoint narrative truth** — what `.planning/.continue-here.md` claims was happening
2. **Planning/artifact truth** — what ROADMAP, SPEC, phase files, and quick-task logs say
3. **Git/worktree truth** — what the live branch and working tree say now

Treat them as separate inputs. Do not flatten them into one continuity story.

Material mismatch signals include:
- checkpoint narrative describes only a narrow slice of a broader dirty tree
- current branch is stale/spent relative to the next intended integration surface
- dirty files suggest overlapping write sets or mixed phase scope

If git/worktree truth materially disagrees with checkpoint narrative truth:
- record a mismatch flag
- keep ordinary git risk warning-level by default
- require explicit user acknowledgement before routing onward
- do not allow a quick "continue" shortcut to skip that acknowledgement
</provenance_reconciliation>

<validate_checkpoint>
Only run this step when `.planning/.continue-here.md` was found in `<load_artifacts>`. If no checkpoint exists, skip this step entirely.

Cross-validate checkpoint fields against current roadmap state in this order:

1. Extract the checkpoint `workflow` and `phase` frontmatter fields.
2. If `phase` is non-null, look up that exact phase name in `.planning/ROADMAP.md`.
   - If the matching roadmap entry is `[x]`, mark the checkpoint as stale.
   - Record the specific reason in this form: `checkpoint references phase "[phase]" which is already complete [x] in ROADMAP.md`.
   - Stop further staleness checks after recording this reason.
3. If `workflow` is `phase` and `phase` is null, mark the checkpoint as potentially stale.
   - Record the reason in this form: `checkpoint workflow is "phase" but checkpoint phase is missing`.
4. If `workflow` is `phase` and `phase` is non-null but no matching roadmap entry exists, mark the checkpoint as potentially stale.
   - Record the reason in this form: `checkpoint workflow is "phase" but phase "[phase]" was not found in ROADMAP.md`.
5. If `workflow` is `phase` and `phase` matches a roadmap entry with status `[ ]` or `[-]`, do not mark it stale based only on missing execution artifacts. Continue normally.
6. If no structural staleness rule applied, skip validation cleanly. This includes `generic` or `quick` checkpoints with null `phase`.

When staleness is detected:
- Record a staleness flag and keep the full reason text.
- Record only one staleness reason string. Do not append additional reasons after the first matching rule.
- Do NOT delete the checkpoint.
- Do NOT suppress the checkpoint contents.

The output of this step is either:
- no staleness flag, or
- a staleness flag with a specific reason string that flows into `<present_status>` and `<determine_action>`.
</validate_checkpoint>

<present_status>
Present a compact status to the user:

```
Project: [name from SPEC.md]
Phase: [current] of [total] — [phase name]
Completed: [N] phases done

[If .continue-here.md exists:]
[If stale checkpoint flag set:]
⚠ Stale checkpoint detected
  Reason: [specific staleness reason]
  Review the checkpoint contents below and decide whether to resume from it or continue without it.

Checkpoint found: [workflow type] — [phase name or task description]
  Last paused: [timestamp from frontmatter]
  Paused by: [runtime from checkpoint, or unknown if field absent]
  Resuming in: [inferred current runtime]
  Next action: [next_action section content]

[If <judgment> was present in checkpoint:]
  Judgment context:
    Constraints:
[Full content of <active_constraints>]
    Uncertainty:
[Full content of <unresolved_uncertainty>]
    Posture:
[Full content of <decision_posture>]
    Anti-regression:
[Full content of <anti_regression>]

[If git/worktree truth was collected:]
Git/worktree truth:
  Branch: [current branch]
  Divergence: [ahead/behind or unknown]
  Staged: [count]
  Unstaged: [count]
  Untracked: [count]
  PR: [open|closed|merged|none|unknown]
  Integration surface: [clean | warning | stale/spent | mixed-scope]

[If material checkpoint/worktree mismatch flag set:]
⚠ Checkpoint/worktree mismatch
  The checkpoint narrative no longer matches the live branch/worktree scope.
  Review both truth surfaces before choosing the next action.

[If incomplete phase execution found:]
Incomplete execution: Phase [N] has a PLAN but no SUMMARY

[If incomplete quick task found:]
Incomplete quick task: [description from LOG.md]
```

No ASCII art, no progress bars. Keep it scannable.

Only show the staleness banner when `<validate_checkpoint>` produced a staleness flag. Even when flagged, still show the checkpoint details immediately below the banner.
</present_status>

<determine_action>
Evaluate in priority order and present the primary recommendation:

**Checkpoint exists (`.continue-here.md`):**
Route based on the `workflow` frontmatter:
- `phase` — route to `/gsdd-execute` (or `/gsdd-plan`/`/gsdd-verify` based on checkpoint context)
- `quick` — route to `/gsdd-quick` to complete the task
- `generic` — present the next_action and let the user decide

If `<validate_checkpoint>` marked the checkpoint as stale, keep the same routing logic. The user may still choose to resume from the checkpoint after reviewing the warning. If the user chooses a different path, leave the checkpoint in place and continue without it.

If `<provenance_reconciliation>` marked a material checkpoint/worktree mismatch, keep the same routing logic but require explicit acknowledgement before continuing. The workflow should not silently route onward from a materially misleading checkpoint narrative.

**Incomplete plan execution (PLAN without SUMMARY):**
Route to `/gsdd-execute` for that phase.

**Phase needs planning (next `[ ]` phase, no PLAN file exists):**
Route to `/gsdd-plan` for that phase.

**Phase needs verification (SUMMARY exists but no VERIFICATION):**
Route to `/gsdd-verify` for that phase (only if `workflow.verifier` is enabled in config.json; if config.json cannot be read, assume verifier is disabled).

**All phases complete (all `[x]`):**
Route to `/gsdd-audit-milestone`.
</determine_action>

<present_options>
Present a numbered list of actions based on the state analysis:

```
What would you like to do?

1. [Primary action from above] (recommended)
2. [Secondary action if applicable]
3. Review ROADMAP.md
4. Something else
```

**Quick-resume shortcut:** If there is no stale-checkpoint banner and no material checkpoint/worktree mismatch, the user may say "continue", "go", or "resume" without further input to execute the primary action directly.

**Mismatch acknowledgement:** If material checkpoint/worktree mismatch was detected, require an explicit acknowledgement such as "continue despite mismatch" or a different selected path. Do not let a bare "continue" skip the warning.

Wait for user selection.
</present_options>

<cleanup_checkpoint>
Immediately after the user confirms their action selection (before routing to the target workflow):
- If the user chose to resume from `.continue-here.md`:
  1. Run `gsdd file-op copy .planning/.continue-here.md .planning/.continue-here.bak`.
  2. After the copy succeeds, run `gsdd file-op delete .planning/.continue-here.md`.
- If the user chose a different action (not based on the checkpoint), leave `.continue-here.md` in place for a future resume.

Copying before deleting ensures the checkpoint survives a session crash between deletion and dispatch. `.continue-here.bak` is cleaned up by the downstream workflow after absorbing the judgment, or by the next `pause.md` run.
</cleanup_checkpoint>

</process>

<success_criteria>
- [ ] Project state detected from disk artifacts (ROADMAP.md, SPEC.md, phase dirs)
- [ ] `.continue-here.md` loaded if present
- [ ] Incomplete work flagged (phase execution, quick tasks)
- [ ] Compact status presented to user
- [ ] Contextual next action determined (priority-ordered routing)
- [ ] Options presented and user selection waited for
- [ ] Checkpoint cleaned up after successful routing
</success_criteria>

<completion>
After the user selects their action and the checkpoint is cleaned up, hand off to the selected workflow.

Present to the user before dispatching:

---
**Resuming:** [selected action description]

Consider clearing context before starting the next workflow for best results.
---

Then dispatch to the selected `/gsdd-*` workflow.
</completion>
