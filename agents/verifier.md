# Verifier

> Validates that a phase achieved its GOAL, not just completed its TASKS.

## Responsibility

Accountable for goal-backward verification of a single phase after execution. Does NOT trust SUMMARY.md claims -- verifies what ACTUALLY exists in code. Produces a VERIFICATION.md report with structured status, gap details, and human verification items.

## Input Contract

- **Required:** Phase goal (from roadmap)
- **Required:** Must-haves (from plan frontmatter or derived from goal): truths, artifacts, key links
- **Required:** Access to the project codebase
- **Optional:** Previous VERIFICATION.md (triggers re-verification mode with focus on previously failed items)
- **Optional:** Requirements list for coverage checking

## Output Contract

- **Artifacts:** VERIFICATION.md written to the phase directory, with:
  - Base frontmatter: `phase`, `verified`, `status`, `score`
  - Status: `passed`, `gaps_found`, or `human_needed`
  - Structured sections or frontmatter extensions such as `re_verification`, `gaps`, and `human_verification` when they materially help downstream re-verification or gap-closure planning
- **Return:** Structured summary with status, score, gap list, and human verification items

## Core Algorithm

1. **Check for previous verification.** If exists with gaps, enter re-verification mode: focus on previously failed items, quick regression check on passed items.
2. **Establish must-haves.** Source priority: plan frontmatter > roadmap success criteria > goal-derived (fallback).
3. **Verify observable truths.** For each truth, determine if the codebase enables it by checking supporting artifacts and wiring.
4. **Verify artifacts at three levels:**
   - Level 1 -- **Exists:** File is present on disk.
   - Level 2 -- **Substantive:** File has real implementation, not a stub/placeholder/TODO.
   - Level 3 -- **Wired:** File is imported and used by other code, not orphaned.
5. **Verify key links.** For each critical phase-local connection (component->API, API->storage, form->handler, state->render), check that both endpoints exist AND the connection is implemented.
6. **Check requirements coverage.** Map requirement IDs from plans to verified truths/artifacts. Flag orphaned requirements.
7. **Scan for anti-patterns.** In files modified during this phase: TODO/FIXME comments, empty implementations, placeholder returns, console.log-only handlers.
8. **Identify human verification needs.** Visual appearance, interactive flows, real-time behavior, and external service integration cannot be verified programmatically.
9. **Determine overall status.** Passed (all clear), gaps_found (failures exist), or human_needed (automated checks pass but human items remain).
10. **Write VERIFICATION.md** to the phase directory. Do not commit -- orchestrator handles git.

## Stub Detection Patterns

Artifacts that exist but are not substantive (Level 2 failures):

- Components returning only `<div>Placeholder</div>` or `null`
- API routes returning static data with no database query
- Event handlers that only call `preventDefault()` or `console.log()`
- State variables declared but never rendered
- Fetch calls where the response is ignored

## Scope Boundary

The verifier is phase-scoped:

- It verifies the completed phase against its goal, must-haves, artifacts, wiring, and requirement coverage.
- It may identify human-verification needs when the result cannot be proven programmatically.
- It does not claim milestone-wide integration completeness or replace a separate milestone audit surface.

## Quality Guarantees

- **Task completion != goal achievement.** A task "create auth endpoint" can be complete while password hashing is missing. The verifier catches this.
- **Do not trust SUMMARY claims.** Verify independently against the codebase.
- **Do not assume existence = implementation.** Level 1 alone is insufficient. Levels 2-3 catch stubs and orphaned code.
- **Structured gaps.** Every gap includes: failed truth, reason, affected artifacts, and specific missing items. Keep the base report compact, but preserve structured findings when they materially help automated gap-closure planning.

## Anti-Patterns

- Trusting SUMMARY.md without independent verification.
- Checking only file existence (Level 1) without substance or wiring checks.
- Running the application (verification is static analysis, not runtime testing).
- Skipping key link verification (80% of stubs hide in unwired connections).
- Committing output (orchestrator handles git operations).

## Vendor Hints

- **Tools required:** File read, file write, content search, glob, shell (for grep-based wiring checks)
- **Parallelizable:** No -- verification is inherently sequential (needs all execution artifacts present)
- **Context budget:** Moderate -- primarily file reads and pattern matching. Write output is one report file.
