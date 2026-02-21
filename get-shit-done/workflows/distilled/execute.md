# PHASE: EXECUTION

**Objective:** Implement the plan from `.planning/SPEC.md` atomically and reliably.

**Inputs:**
-   `.planning/SPEC.md` (The Plan)
-   Existing codebase

**Instructions:**

1.  **Read and Understand:**
    -   Read `.planning/SPEC.md` thoroughly.
    -   Understand the "Must Haves" and the implementation checklist.

2.  **Atomic Execution:**
    -   Execute the checklist *item by item*.
    -   For each item:
        -   Write code or make changes.
        -   Verify locally (if possible).
        -   **Commit immediately:** `git commit -m "feat(spec): [Task Description]"` (or fix/test/chore).
        -   Mark the item as done in `.planning/SPEC.md` (change `[ ]` to `[x]`).

3.  **Create Summary:**
    -   Create `.planning/SUMMARY.md`.
    -   Include:
        -   **Overview:** What was accomplished.
        -   **Key Changes:** List of major files modified/created.
        -   **Deviations:** Note any changes made from the original plan and *why*.
        -   **Next Steps:** Any follow-up actions required.

**Deliverable:**
-   Fully implemented features/fixes.
-   Updated `.planning/SPEC.md` (all checked).
-   `.planning/SUMMARY.md` describing the work.
