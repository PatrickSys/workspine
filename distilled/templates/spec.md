# SPEC.md Template

Use this template when creating `.planning/SPEC.md` — the project's single source of truth.

> **Keep SPEC.md under 100 lines.** It is loaded at the start of every agent session. Shorter spec = fewer wasted tokens = better agent performance. If your spec exceeds 100 lines, you're writing a requirements document, not a spec.

---

```markdown
# [Project Name]

## What We're Building

[2-3 sentences. What does this product/feature do and who is it for? Use the developer's own language.]

## Core Value

[The ONE thing that matters most. If everything else fails, this must work.]

## Requirements

### Must Have (v1)

- [ ] **[CAT-01]**: [User-centric, testable requirement]
- [ ] **[CAT-02]**: [User-centric, testable requirement]
- [ ] **[CAT-03]**: [User-centric, testable requirement]

### Nice to Have (v2)

- **[CAT-04]**: [Deferred requirement]
- **[CAT-05]**: [Deferred requirement]

### Out of Scope

- [Feature] — [why excluded]
- [Feature] — [why excluded]

## Constraints

- **[Type]**: [What] — [Why]
- **[Type]**: [What] — [Why]

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| [Choice] | [Why] | [When] |

## Current State

- **Active Phase:** Phase [X] — [Name] ([⬜/🔄/✅])
- **Last Completed:** [What was last done]
- **In Progress:** [What is currently being worked on]
- **Decisions:** [Any recent decisions]
- **Blockers:** [None / description]

---
*Last updated: [date] after [trigger]*
```

---

## Guidelines

- **Requirements** must be specific, testable, and user-centric ("User can X", not "System does Y")
- **Requirement IDs** use `[CATEGORY]-[NUMBER]` format (AUTH-01, DATA-02, UI-03)
- **v1 requirements** have checkboxes — check them off when verified as complete
- **Out of Scope** always includes reasoning (prevents scope creep discussions later)
- **Key Decisions** are appended throughout the project as they're made
- **Current State** is updated after each significant milestone — this is how agents resume work across sessions
- **Keep this file under 100 lines** — it's a spec, not a novel. Details live in plans and research docs.

## When Codebase Already Exists (Brownfield)

If auditing an existing codebase during `init`:
- Add a **Validated** section under Requirements:
  ```markdown
  ### Validated (existing capabilities)
  - ✓ **[CAT-01]**: User can log in — existing auth system
  - ✓ **[CAT-02]**: Data persists across sessions — PostgreSQL database
  ```
- New requirements go under "Must Have (v1)"
- Document existing tech stack and patterns in Constraints
- Document any tech debt discovered in a separate concern note (not in SPEC.md)

## Archive Guidance

When a major milestone completes:
1. The SPEC.md "Current State" section reflects the new state
2. Completed phases have summaries in `.planning/phases/{N}-SUMMARY.md`
3. SPEC.md itself stays lean — don't accumulate history here
