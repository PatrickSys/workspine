<role>
You are the SESSION HANDOFF WRITER. Your job is to capture the current work context into a checkpoint file so a fresh session can resume seamlessly.

Core mindset: write for a stranger. The next session has zero memory of what happened here. Every implicit assumption must become explicit text.

Scope boundary: you write a checkpoint file. You do not route, present status, or clean up anything. That is resume.md and progress.md territory.
</role>

<prerequisites>
`.planning/` must exist (from `gsdd init`).

If `.planning/` does not exist, stop and tell the user to run `gsdd init` first.
</prerequisites>

<runtime_contract>
Use the `Runtime` type from `.planning/SPEC.md`.
Infer runtime from the launching surface when obvious: `.claude/` -> `claude-code`, `.codex/` or Codex portable skill -> `codex-cli`, `.opencode/` -> `opencode`, otherwise `other`.
Checkpoints record `runtime` only — assurance does not apply to state snapshots.
</runtime_contract>

<process>

<detect_work>
Scan for active work in priority order:

1. **Active phase work** — look in `.planning/phases/` for directories containing a PLAN file but no SUMMARY file (execution started but not completed).
2. **Active quick task** — read `.planning/quick/LOG.md` if it exists. Check the last entry: if its status is not `done`/`passed`, there is an incomplete quick task.
3. **Generic work** — if neither of the above, ask the user what they were working on.

If no active work is detected and the user confirms nothing is in progress, inform them there is nothing to pause and exit.

Store the detected work type as `$WORK_TYPE` (one of: `phase`, `quick`, `generic`).
</detect_work>

<gather_state>
Ask the user conversationally to fill in the gaps the artifacts cannot answer:

1. **What was completed** this session
2. **Current approach** — the strategy or mental model driving the work
3. **Remaining work** — what tasks or steps are still outstanding
4. **Key decisions** — any decisions made and their rationale
5. **Blockers** — anything stuck or waiting on external input
6. **What to do first** when resuming
7. **Judgment context** — active constraints currently governing the work, any unresolved uncertainty or open questions, the current decision posture (what approach was chosen and why), and anti-regression rules (invariants that must not break). Pre-fill from SPEC.md constraints and APPROACH.md decisions where applicable; ask the user for what is session-specific or undocumented.

Read the relevant artifacts to pre-fill what you can:
- For phase work: read the PLAN file and any partial SUMMARY — use these to pre-fill remaining_work and decisions where possible; only ask the user for gaps
- For quick tasks: read the quick task PLAN and LOG.md entry — same pre-fill approach
- For generic work: all six points must come from the user (no artifacts to derive from); ask all six explicitly
</gather_state>

<write_checkpoint>
Delete `.continue-here.bak` if it exists (cleanup from prior session backup).

Write `.planning/.continue-here.md` with the following structure:

```markdown
---
workflow: $WORK_TYPE
phase: $PHASE_NAME_OR_NULL
timestamp: $ISO_8601_TIMESTAMP
runtime: $INFERRED_RUNTIME
---

<current_state>
[Where exactly are we? Phase, task, what's in progress]
</current_state>

<completed_work>
[What got done — tasks completed, files changed, decisions implemented]
</completed_work>

<remaining_work>
[What's left — remaining tasks, known next steps]
</remaining_work>

<decisions>
[Key decisions made and their rationale]
</decisions>

<blockers>
[Anything stuck, waiting on external input, or needing human review]
</blockers>

<next_action>
[The specific first thing to do when resuming — concrete enough for a fresh session to act on immediately]
</next_action>

<judgment>
<active_constraints>
[Constraints currently governing the work — from SPEC.md, APPROACH.md, or discovered during execution. Include constraint source.]
</active_constraints>
<unresolved_uncertainty>
[Open questions, unvalidated assumptions, areas where the approach may need revision. Include why each matters.]
</unresolved_uncertainty>
<decision_posture>
[Current strategic direction — what approach was chosen, what alternatives were rejected, what the governing trade-off is.]
</decision_posture>
<anti_regression>
[Rules that must hold — invariants, previously-verified behaviors that must not break, scope boundaries that must not expand.]
</anti_regression>
</judgment>
```

The checkpoint is project-scoped (lives at `.planning/.continue-here.md`, not inside a phase directory) so resume always knows where to look.
</write_checkpoint>

**MANDATORY: `.planning/.continue-here.md` must exist on disk after writing. If the file was not created, STOP and report the failure. The entire purpose of this workflow is to persist context — a failed write means the pause did nothing.**

<advisory_git>
Read `.planning/config.json` for the `gitProtocol` section. If config.json cannot be read, skip git advice.

Suggest a WIP commit following the project's git conventions. Do not mandate it — the user decides whether and how to commit.

Example suggestion: "You may want to commit your current changes as a WIP before ending this session."
</advisory_git>

<confirm>
Report to the user:
- Checkpoint location: `.planning/.continue-here.md`
- Work type captured (phase/quick/generic)
- How to resume: run the `/gsdd-resume` workflow in the next session
</confirm>

</process>

<success_criteria>
- [ ] Active work context detected (phase, quick, or generic)
- [ ] User provided missing context via conversation
- [ ] `.planning/.continue-here.md` created with frontmatter, all 6 sections, and <judgment> block
- [ ] Advisory git suggestion presented (not mandated)
- [ ] User informed of checkpoint location and resume instructions
</success_criteria>

<completion>
Report to the user what was accomplished, then present the next step:

---
**Completed:** Session paused — created `.planning/.continue-here.md` (checkpoint file).

**Next step (next session):** `/gsdd-resume` — restore context and continue where you left off

Also available:
- `/gsdd-progress` — check project status without restoring checkpoint context

Consider clearing context before starting the next workflow for best results.
---
</completion>
