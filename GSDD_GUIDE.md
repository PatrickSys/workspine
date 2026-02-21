# GSD Distilled (gsdd) Governance Guide

This guide explains how to enforce strict governance for AI-assisted development using `gsdd`.

## Why Governance Matters

AI agents are powerful but can be unpredictable. Without governance, they might:
-   Commit directly to `main` without review.
-   Create messy, undocumented changes.
-   Persist sensitive planning artifacts in the codebase.
-   Hallucinate requirements or skip verification.

`gsdd` provides a **deterministic governor** to prevent these issues.

## 1. Local Governance (Built-in)

`gsdd` enforces these rules automatically:

### Branch Protection
`gsdd` **will not run** if you are on `main` or `master`.
-   **Error:** "Governance Error: You are on the protected branch..."
-   **Fix:** Create a feature branch: `git checkout -b feature/my-goal`.

### Private Planning Artifacts
`gsdd init` ensures that `.planning/` is added to `.gitignore`.
-   **Why:** Planning docs (SPEC.md, SUMMARY.md) are transient scratchpads for the agent. They should not clutter your repo history.
-   **Config:** controlled by `commit_docs: false` in `gsdd.json`.

### Configuration
`gsdd` reads from `gsdd.json` in the project root.
-   **Version Control:** Commit `gsdd.json` to enforce consistent rules across your team.

## 2. Remote Governance (GitHub/GitLab)

To fully secure your workflow, you must enforce branch protection on your remote repository.

### GitHub Setup

1.  Go to **Settings** > **Branches**.
2.  Click **Add rule**.
3.  **Branch name pattern:** `main` (or `master`).
4.  **Protect matching branches:** Check this box.
5.  **Require a pull request before merging:** Check this.
    -   *Optional:* "Require approvals".
6.  **Do not allow bypassing the above settings:** Check this (crucial for admins).
7.  **Click Create.**

### GitLab Setup

1.  Go to **Settings** > **Repository**.
2.  Expand **Protected branches**.
3.  **Branch:** `main` (or `master`).
4.  **Allowed to merge:** "Maintainers" (or strictly "No one" if using merge trains).
5.  **Allowed to push:** "No one" (Forces PR/MR workflow).
6.  **Click Protect.**

## 3. The `gsdd` Workflow

Once governance is set up, the workflow is:

1.  **Developer:** `git checkout -b feature/new-login`
2.  **Developer:** `gsdd do "Add login page"`
3.  **Agent:** Reads instructions, creates `.planning/SPEC.md`.
4.  **Agent:** Implements features, commits atomically to feature branch.
5.  **Agent:** Verifies work, reports in `.planning/VERIFICATION.md`.
6.  **Developer:** Reviews PR on GitHub/GitLab.
7.  **CI/CD:** Runs tests.
8.  **Merge:** Only if approved and passing.

This ensures no AI-generated code reaches production without oversight.
