# ROADMAP.md Template

Use this template when creating `.planning/ROADMAP.md` (phase breakdown + progress tracker).

```markdown
# Roadmap: [Project Name]

## Overview

[One paragraph: what v1 delivers and why.]

## Phases (Status Legend: [ ] not started, [-] in progress, [x] complete)

- [ ] **Phase 1: [Name]** - [One-line goal]
- [ ] **Phase 2: [Name]** - [One-line goal]
- [ ] **Phase 3: [Name]** - [One-line goal]

## Phase Details

### Phase 1: [Name]

**Goal**: [What this phase delivers]
**Status**: [ ]
**Requirements**: [REQ-IDs from `.planning/SPEC.md`]
**Success Criteria** (must be TRUE when done):
1. [Observable behavior]
2. [Observable behavior]

### Phase 2: [Name]

**Goal**: [What this phase delivers]
**Status**: [ ]
**Depends on**: Phase 1
**Requirements**: [REQ-IDs]
**Success Criteria**:
1. [Observable behavior]
2. [Observable behavior]

### Phase 3: [Name]

**Goal**: [What this phase delivers]
**Status**: [ ]
**Depends on**: Phase 2
**Requirements**: [REQ-IDs]
**Success Criteria**:
1. [Observable behavior]
2. [Observable behavior]

---
*Created: [YYYY-MM-DD]*
```

## Guidelines

- Prefer 3-8 phases for most projects.
- Every v1 requirement in `.planning/SPEC.md` must map to exactly one phase (no orphans).
- Success criteria are 2-5 observable behaviors per phase.
- No time estimates: focus on verifiable outcomes.
- These status markers are the portable source of truth. Workflow files and summaries should use `[ ]`, `[-]`, and `[x]` consistently.
- Keep each overview phase marker and its matching Phase Details `**Status**` marker identical. Use `gsdd phase-status <phase> <status>` instead of hand-editing either location.
- Treat `<details>...</details>` sections as archived roadmap history only; lifecycle helpers ignore phases inside those blocks.

## Coverage Verification

After creating the roadmap, verify:
```
For each v1 requirement in .planning/SPEC.md:
  [ ] Requirement appears in exactly one phase's "Requirements" list
  [ ] The phase's success criteria would prove the requirement is met
```

If a requirement doesn't map to any phase: add a phase or expand an existing one.
If a requirement maps to multiple phases: clarify which phase owns it.

