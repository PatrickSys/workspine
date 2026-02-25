# ROADMAP.md Template

Use this template when creating `.planning/ROADMAP.md` — the phase breakdown and progress tracker.

---

```markdown
# Roadmap: [Project Name]

## Overview

[One paragraph: the journey from start to v1, what the user will have when done.]

## Phases

- ⬜ **Phase 1: [Name]** — [One-line goal]
- ⬜ **Phase 2: [Name]** — [One-line goal]
- ⬜ **Phase 3: [Name]** — [One-line goal]

## Phase Details

### Phase 1: [Name]

**Goal**: [What this phase delivers]
**Status**: ⬜
**Requirements**: [REQ-IDs from SPEC.md]
**Success Criteria** (what must be TRUE when done):
1. [Observable behavior from user perspective]
2. [Observable behavior from user perspective]
3. [Observable behavior from user perspective]

### Phase 2: [Name]

**Goal**: [What this phase delivers]
**Status**: ⬜
**Depends on**: Phase 1
**Requirements**: [REQ-IDs]
**Success Criteria**:
1. [Observable behavior]
2. [Observable behavior]

### Phase 3: [Name]

**Goal**: [What this phase delivers]
**Status**: ⬜
**Depends on**: Phase 2
**Requirements**: [REQ-IDs]
**Success Criteria**:
1. [Observable behavior]
2. [Observable behavior]

---
*Created: [date]*
```

---

## Guidelines

- **3-8 phases** for most projects — fewer for quick projects, more only when genuinely needed
- **Every v1 requirement** from SPEC.md must map to exactly one phase. No orphans.
- **Success criteria** are 2-5 observable behaviors per phase, written from user perspective
- **Phase status** uses emoji: ⬜ not started / 🔄 in progress / ✅ complete
- **Dependencies** only listed when a phase truly can't start without another finishing
- **No time estimates** — this isn't project management theater
- **Phase names** should be descriptive enough to understand at a glance

## Phase Status Transitions

```
⬜ → 🔄 (when plan is created and execution begins)
🔄 → ✅ (when verification passes)
🔄 → ⬜ (if re-planning is needed due to fundamental issues)
```

## Coverage Verification

After creating the roadmap, verify:
```
For each v1 requirement in SPEC.md:
  [ ] Requirement appears in exactly one phase's "Requirements" list
  [ ] The phase's success criteria would prove the requirement is met
```

If a requirement doesn't map to any phase: add a phase or expand an existing one.
If a requirement maps to multiple phases: clarify which phase owns it.

## Phase Insertion

If scope changes during the project and new phases are needed:
1. Insert the new phase at the correct dependency position
2. Re-number subsequent phases
3. Update SPEC.md "Current State" to reflect the new phase count
4. Document the scope change in SPEC.md "Key Decisions"

## Archive Protocol

When a phase completes (status → ✅):
1. A `{N}-SUMMARY.md` should exist in `.planning/phases/` documenting what was done
2. The phase's success criteria were verified (verification report exists)
3. SPEC.md "Current State" reflects the completion
4. The phase directory and its files serve as the historical record
