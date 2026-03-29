<purpose>
Validate built features through conversational testing with persistent state.
Creates UAT.md that tracks test progress, survives context resets, and feeds gaps into `/gsdd-plan`.

User tests, Claude records. One test at a time. Plain text responses.
</purpose>

<philosophy>
**Show expected, ask if reality matches.**

Present what SHOULD happen. User confirms or describes what's different.
- "yes" / "y" / "pass" / empty → pass
- Anything else → logged as issue, severity inferred from natural language

No Pass/Fail buttons. No severity questions. Just: "Here's what should happen. Does it?"
</philosophy>

<load_context>
Read these before any other action:
1. `.planning/phases/{N}-*/` — all `*-SUMMARY.md` files for the target phase
2. `.planning/SPEC.md` — requirements and acceptance criteria
3. `.planning/ROADMAP.md` — phase goal and must-haves

**$ARGUMENTS:** optional phase number, e.g., `/gsdd-verify-work 4`
</load_context>

<session_detection>
Before starting a new session, check for existing UAT state:

```bash
# Check for existing UAT files in this phase
ls .planning/phases/{N}-*/*-UAT.md 2>/dev/null || echo "none"
```

**If a UAT.md exists** with `status: testing`, offer to resume:
```
UAT in progress: Phase {N} — {passed}/{total} tests done, {issues} issues found so far.
Reply "resume" to continue from where you left off, or "restart" to begin fresh.
```

**If no UAT.md exists** or user says "restart", proceed to `<extract_tests>`.
</session_detection>

<extract_tests>
From each `*-SUMMARY.md` in the phase directory, extract testable deliverables:

1. Read **Accomplishments** and **Notes for Verification** sections.
2. Focus on **user-observable outcomes** — UI behavior, API responses, workflow outputs. Skip refactors, type changes, internal restructures.
3. For each deliverable, define:
   - `name`: brief test name
   - `expected`: what the user should see or experience (specific and observable)

Examples:
- Accomplishment: "Added comment threading" → Test: "Reply to a comment" → Expected: "Clicking Reply opens inline composer. Reply appears nested under parent with visual indent."
- Accomplishment: "JWT auth with refresh rotation" → Test: "Token refresh on expiry" → Expected: "After token expires, next request silently refreshes and succeeds. User is not logged out."

Present the test list to the user for a quick scan:
```
Phase {N} — {count} tests extracted

1. {Test Name}
2. {Test Name}
...

Reply "start" to begin, or add/remove tests before starting.
```

Wait for confirmation.
</extract_tests>

<create_uat_file>
Create `.planning/phases/{N}-{name}/{phase_num}-UAT.md`:

```markdown
---
status: testing
phase: {N}-{name}
source: [{list of SUMMARY.md files read}]
started: {ISO timestamp}
updated: {ISO timestamp}
---

## Current Test

number: 1
name: {first test name}
expected: |
  {what user should observe}
awaiting: user response

## Tests

### 1. {Test Name}
expected: {observable behavior}
result: pending

### 2. {Test Name}
expected: {observable behavior}
result: pending

...

## Summary

total: {N}
passed: 0
issues: 0
pending: {N}
skipped: 0

## Gaps

[none yet]
```

**MANDATORY: Write UAT.md to disk before presenting the first test.** This ensures progress survives a context reset.
</create_uat_file>

<testing_loop>
**Present one test at a time:**

```
Test {N}/{total}: {Test Name}
──────────────────────────────────────────────────
Expected: {what should happen}

→ Reply "pass" (or just press Enter) — or describe what went wrong
──────────────────────────────────────────────────
```

**Process the response:**

| Response | Action |
|----------|--------|
| empty, "yes", "y", "ok", "pass", "next" | Mark `result: pass` |
| "skip", "n/a", "can't test" | Mark `result: skipped`, capture reason |
| anything else | Treat as issue description — infer severity |

**Severity inference from natural language (never ask):**

| User says | Infer |
|-----------|-------|
| "crashes", "error", "exception", "fails completely" | `blocker` |
| "doesn't work", "nothing happens", "wrong behavior" | `major` |
| "works but...", "slow", "weird", "minor" | `minor` |
| "color", "spacing", "alignment", "looks off" | `cosmetic` |
| unclear | `major` (default) |

**On issue:** Write immediately to disk (append to Gaps section):
```yaml
- truth: "{expected behavior from test}"
  status: failed
  reason: "User reported: {verbatim response}"
  severity: {inferred}
  test: {N}
  root_cause: pending
```

**After each response:** Update Summary counts and frontmatter `updated` timestamp in UAT.md.

Advance to the next pending test. Repeat until all tests have a result.
</testing_loop>

<diagnosis_protocol>
When all tests are done and **issues > 0**, run inline diagnosis before routing to planning.

For each gap in the Gaps section:

1. Read the source files most likely responsible (infer from the expected behavior and `*-SUMMARY.md` "Notes for Verification").
2. Form a root-cause hypothesis:
   - Look for missing implementation, wrong logic, stale wiring, or missing state.
3. Update the gap's `root_cause` field in UAT.md:
   ```yaml
   root_cause: "{one-sentence hypothesis: what is missing or wrong and where}"
   ```
4. Optionally add:
   ```yaml
   artifacts: ["{file path}"]
   missing: ["{what is absent}"]
   ```

Do not attempt fixes during diagnosis — only gather evidence.

After all gaps are diagnosed, write UAT.md to disk with the updated root causes.
</diagnosis_protocol>

<complete_session>
**Finalize the UAT file:**

Update frontmatter:
```yaml
status: complete
updated: {now}
```

Clear the Current Test block:
```
## Current Test

[testing complete]
```

Write final UAT.md to disk.

**If no issues found:**
```
UAT complete — all {N} tests passed.

Next step: /gsdd-progress — route to next phase or milestone audit
```

**If issues found:**

Present summary:
```
UAT complete — Phase {N}

| Result  | Count |
|---------|-------|
| Passed  | {N}   |
| Issues  | {N}   |
| Skipped | {N}   |

Diagnosed {N} root cause(s). Ready to plan fixes.
```

Then route to gap closure (see `<completion>`).
</complete_session>

<success_criteria>
- [ ] Phase SUMMARY files read before extracting tests
- [ ] UAT.md written to disk before the first test is presented
- [ ] Tests presented one at a time with specific expected behavior
- [ ] Severity inferred from description — never asked
- [ ] UAT.md updated after each issue (not batched to end)
- [ ] Inline diagnosis completed for each issue before routing to planning
- [ ] UAT.md finalized on disk with `status: complete`
</success_criteria>

<completion>
Report to the user what was tested, then present the next step:

---
**Completed:** UAT — created `.planning/phases/{phase_dir}/{phase_num}-UAT.md`.

If no issues:
**Next step:** `/gsdd-progress` — route to next phase or milestone audit

If issues found:
**Next step:** `/gsdd-plan` — plan gap closure using the diagnosed root causes in UAT.md
- Open `.planning/phases/{phase_dir}/{phase_num}-UAT.md` for the plan context
- Use `--gaps` mode if your runtime supports it

Also available:
- `/gsdd-verify` — re-run formal phase verification after fixes are implemented
- `/gsdd-pause` — save context for later if stopping work

Consider clearing context before starting the next workflow for best results.
---
</completion>
