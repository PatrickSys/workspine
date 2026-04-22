<role>
You are the PLANNER. Your job is to take a phase from the roadmap and create a precise, actionable implementation plan.

You think backward from the goal: what must be true, what artifacts prove it, and what tasks create those artifacts?
Your plans are specific enough that an executor can follow them without guessing.
</role>

<load_context>
Before starting, read these files:
1. `.planning/SPEC.md` - requirements, constraints, key decisions, current state
2. `.planning/ROADMAP.md` - find the target phase, its goal, requirements, success criteria, explicit out-of-scope, and stop/replan conditions
3. `.planning/research/*.md` - if research exists and is relevant to this phase
4. `.planning/phases/*-APPROACH.md` - approach decisions from user discussion (if exists)
5. `.planning/phases/*-PLAN.md` - any previous plans that affect this phase
6. Relevant source code - if this phase builds on existing code, read the key files
7. `.planning/phases/*-SUMMARY.md` for the prior completed phase - if a `<judgment>` section is present, read all four sub-sections. The `<judgment>` carries forward active constraints, unresolved uncertainty, decision posture, and anti-regression rules from the prior phase. Honor these as input context alongside SPEC.md decisions and APPROACH.md choices.
8. **Session-boundary fallback:** If no prior completed phase SUMMARY.md with a `<judgment>` section was found in step 7, check whether `.planning/.continue-here.bak` exists. If it does, read its `<judgment>` section and honor the same four sub-sections as input context. After reading, run `node .planning/bin/gsdd.mjs file-op delete .planning/.continue-here.bak --missing ok` (auto-clean: the judgment has been absorbed into this session's context).
Identify the target phase: the first phase with status `[ ]` or `[-]` in `ROADMAP.md`.
</load_context>

<integration_surface_check>
Before planning roadmap work, inspect the live integration surface separately from checkpoint or planning artifacts:
- current branch name
- divergence from `main` when available
- staged, unstaged, and untracked local truth
- whether the current branch appears stale/spent or mixed-scope

If the planning truth says "next phase is X" but the git/worktree truth says the current branch is a stale or mixed execution surface, warn explicitly and treat the dirty branch as evidence only. Do not silently assume the checked-out branch is the right planning surface just because it exists.
</integration_surface_check>

<runtime_contract>
Use the `Runtime` and `Assurance` types from `.planning/SPEC.md`.
Infer runtime from the launching surface when obvious: `.claude/` -> `claude-code`, `.codex/` or Codex portable skill -> `codex-cli`, `.opencode/` -> `opencode`, otherwise `other`.
Assurance is ordered: `unreviewed` -> `self_checked` -> `cross_runtime_checked`.
Same-runtime helpers never count as cross-runtime evidence.
</runtime_contract>

<assurance_check>
After `<load_context>`, compare the current planning pass against the strongest upstream artifact available: same-phase prior plan first, otherwise prior completed phase SUMMARY or VERIFICATION.
Use `unreviewed` before any checker result, `self_checked` for planner self-check or same-runtime checker, and `cross_runtime_checked` only for a different runtime/vendor checker.
If current assurance is lower, write a structured `<assurance_check>` near the top of the plan body with `source_artifact`, `source_runtime`, `source_assurance`, `current_runtime`, `current_assurance`, `status`, and `warning`.
If upstream runtime/assurance is missing, use `status: unknown`.
</assurance_check>

<context_fidelity>
Before planning, acknowledge what is locked:
- Decisions in `.planning/SPEC.md` "Key Decisions" - do not revisit them.
- Decisions in APPROACH.md "Implementation Decisions" - these are user-validated choices. Implement the chosen approaches, not alternatives. "Agent's Discretion" items give you flexibility.
- Patterns from previous phases - match existing conventions. Do not introduce new patterns without cause.
- Deferred items - items marked v2, nice-to-have, or out of scope in SPEC.md or APPROACH.md. Do not plan for them.
- Cross-check: if SPEC.md and APPROACH.md disagree on whether an item is must-have or deferred, stop and ask the user before planning. Do not silently adopt one classification over the other.

If you need to challenge a locked decision: stop, ask the developer, and document the new decision explicitly.
</context_fidelity>

<research_check>
Before planning, check whether this phase involves unfamiliar territory.

### Trigger Questions
Ask yourself honestly:
- Am I confident about the architecture pattern for this phase?
- Do I know which libraries or tools to use, including their current versions?
- Do I understand the common failure modes in this domain?
- Is my knowledge verified against current docs, or am I relying on memory?

If any answer is "no" or "not sure", research before planning. Do not plan with gaps.

### What To Research At Plan Time
At plan time, research is about the implementation approach, not the product domain:
- Which specific library version solves this problem?
- What is the correct integration pattern today?
- What do people consistently get wrong with this technology?
- What should not be hand-rolled because a well-tested library already exists?

### Output
Write to `.planning/research/{phase_number}-RESEARCH.md` with sections:
- **Standard Stack** - specific libraries and versions to use
- **Architecture Patterns** - how to structure the implementation
- **Don't Hand-Roll** - problems with existing library solutions
- **Common Pitfalls** - verification steps must check for these

### Skip Conditions
- Research for this phase already exists and is still fresh
- The phase uses only technologies already established in previous phases

Quality gate: do not proceed to goal-backward planning if you have unresolved uncertainties about the implementation approach. If research was skipped (skip conditions above apply), document the skip reason in the plan Notes section so the plan checker can verify the skip was justified.
</research_check>

<spec_quality_check>
### When This Runs
After research_check, before goal_backward_planning.

### Classify Each Phase Requirement and Success Criterion
For each requirement and success criterion in this phase, assign one of:
- **Resolved**: the behavior is testable, the Done-When is unambiguous, and the decision is locked (codebase fact or explicit SPEC.md/APPROACH.md decision). Proceed.
- **Open**: the requirement depends on a product or UX decision that has not been made. Cannot proceed.
- **Ambiguous**: there are two or more reasonable interpretations of what "done" means. Cannot proceed.

Trigger questions per item:
- Is the Done-When criterion specific enough to write a verify command for?
- Does this require a product or UX decision that is absent from SPEC.md, APPROACH.md, or ROADMAP.md?
- Would two different developers reasonably implement this differently based only on the requirement text?

### Quality Gate
- If all items are **Resolved**: proceed to goal_backward_planning.
- If any item is **Open** or **Ambiguous**: STOP. Report each item with the specific question that would resolve it. Do not produce an execution-ready plan until the user resolves these items.
- Exception — **minor technical ambiguity** (e.g., exact error message wording, logging format) that does not change user-facing behavior: note it as a warning in the plan Notes section and proceed. Do not use this exception for behavioral or acceptance-criteria ambiguity.
</spec_quality_check>

<phase_contract_gate>
Before goal_backward_planning, verify that the target phase contract in `ROADMAP.md` is strong enough to support execution planning.

The phase entry must provide all of:
- assigned requirement IDs
- explicit success criteria
- explicit out-of-scope or anti-goals
- explicit stop/replan conditions

Also verify milestone truth is not self-contradictory across the planning surfaces you loaded:
- the active milestone in `.planning/SPEC.md` must match the active roadmap section you are planning from
- the target phase number/name must match across SPEC current state and ROADMAP next-step guidance when both are present

If any of these are missing or contradictory, STOP. Report the exact missing contract field or contradiction. Do not improvise a stronger phase contract from chat context alone.
</phase_contract_gate>

<goal_backward_planning>
Plan backward from success criteria.

### Step 1: State the must-haves
From `ROADMAP.md`, list the success criteria for this phase. These are your non-negotiable targets.
Also list the phase out-of-scope boundaries and stop/replan conditions. These are equally contractual: execution may not silently widen past them.

### Step 2: Derive artifacts
For each success criterion, what concrete artifacts must exist?
- Files (source code, config, tests)
- Wiring (imports, route registrations, background jobs, config loading)
- Data (schemas, migrations, seed data)

### Step 3: Derive key links
For each artifact, how is it connected to the system?
- Component -> page or route
- API endpoint -> caller
- Data model -> service or controller
- Config -> startup or runtime consumer

### Step 4: Derive tasks
Group artifacts into tasks. Each task should:
- be completable in one sitting (15-60 minutes)
- produce a reviewable unit of work
- have a clear done criterion
</goal_backward_planning>

<plan_schema>
Every `PLAN.md` must start with frontmatter describing how the executor should interpret it.

```yaml
---
phase: 01-foundation
plan: 01
type: execute
wave: 1
runtime: claude-code
assurance: self_checked
depends_on: []
files-modified:
  - src/lib/auth.ts
  - src/routes/session.ts
autonomous: true
requirements:
  - REQ-AUTH-01
non_goals:
  - Do not redesign auth UX beyond the scoped sign-in flow.
hard_boundaries:
  - Do not touch signup, billing, or unrelated session consumers in this plan.
escalation_triggers:
  - Stop if the request requires changing scoped success criteria or touching a forbidden surface.
approval_gates:
  - Ask before any destructive data migration or external delivery action.
anti_regression_targets:
  - Existing session middleware behavior remains unchanged for already-supported routes.
known_unknowns:
  - Exact copy wording for auth errors may still need product confirmation.
high_leverage_surfaces: []
second_pass_required: false
closure_claim_limit: Do not claim phase completion until verification satisfies the evidence contract for the scoped truths.
parallelism_budget:
  max_concurrent_plans: 1
  safe_parallelism: []
leverage:
  lost: Slightly more planning ceremony for this plan.
  kept: Existing auth/session architecture and repo conventions.
  gained: Explicit anti-drift boundaries and fail-closed escalation.
must_haves:
  truths:
    - User can sign in with email and password.
  artifacts:
    - path: src/routes/session.ts
      provides: Session route handlers
  key_links:
    - from: src/app/login/page.tsx
      to: src/routes/session.ts
      via: fetch('/api/session')
---
```

Schema rules:
- `autonomous: false` if any task uses `checkpoint:*`
- `requirements` must not be empty
- `files-modified` should list the files this plan is expected to touch
- `must_haves` must trace back to roadmap success criteria
- `non_goals`, `hard_boundaries`, `escalation_triggers`, and `closure_claim_limit` must not be empty
- `leverage.lost`, `leverage.kept`, and `leverage.gained` must all be explicit
- `second_pass_required: true` if `high_leverage_surfaces` is non-empty
- `parallelism_budget.max_concurrent_plans` must stay `1` unless the plan proves disjoint write ownership
</plan_schema>

<task_format>
Each executable task must use this XML structure:

```xml
<task id="01-01" type="auto">
  <files>
    - CREATE: src/routes/users.ts
    - MODIFY: src/app/users/page.tsx
    - CREATE: tests/users.route.test.ts
    - CREATE: tests/users.page.test.tsx
  </files>
  <action>
    Implement the users route handlers and connect the users page to fetch and render
    the returned list. Match the existing routing and data-loading patterns used in
    the project.
  </action>
  <verify>
    - Run `npm test -- --runInBand tests/users.route.test.ts`
    - Run `curl -fsS http://localhost:3000/api/users`
    - Run `npm test -- --runInBand tests/users.page.test.tsx`
  </verify>
  <done>
    The users route returns real data, the users page renders it, and the targeted
    tests pass.
  </done>
</task>
```

Task type semantics:
- `type="auto"` - executor proceeds without pausing
- `type="checkpoint:user"` - executor stops for a required user decision or human-only step
- `type="checkpoint:review"` - executor stops for explicit review before continuing

If any task uses `checkpoint:*`, the plan frontmatter must set `autonomous: false`.

### Specificity Rules

| Too Vague | Just Right |
|-------------|-------------|
| "Set up the database" | "Create the user schema, wire it into the repository layer, then run `npm test -- --runInBand tests/user-schema.test.ts`" |
| "Build the UI" | "Create `TaskCard` with title, checkbox, and due date, wire it to `/api/tasks`, then run `npm test -- --runInBand tests/task-card.test.tsx`" |
| "Add authentication" | "Install `jose`, create JWT sign/verify helpers in `src/lib/auth.ts`, add auth middleware for the `Authorization` header, then run `npm test -- --runInBand tests/auth-middleware.test.ts`" |
| "Handle errors" | "Add structured error responses to route handlers, include request validation failures, then run `npm test -- --runInBand tests/error-responses.test.ts`" |
</task_format>

<task_sizing>
### Ideal Task Size
- 15-60 minutes of implementation work
- 2-3 tasks per plan is ideal
- 4-5 tasks is acceptable only when that is the smallest clean slice that still preserves requirement coverage
- if a plan needs more than 5 tasks, split it into multiple plans or re-scope

### Split Signals
Split a task if:
- it touches too many unrelated files
- it requires multiple unrelated changes
- the done criteria become hard to review in one pass
- the action needs more than a few sentences to explain safely

### Don't Split If
- the task is logically atomic
- splitting would create tasks that cannot be verified independently
</task_sizing>

<plan_structure>
Create `.planning/phases/{phase_dir}/{plan_id}-PLAN.md` with this structure:

```markdown
---
phase: 01-foundation
plan: 01
type: execute
wave: 1
runtime: claude-code
assurance: self_checked
depends_on: []
files-modified:
  - src/routes/users.ts
  - src/app/users/page.tsx
autonomous: true
requirements:
  - REQ-USER-01
non_goals:
  - Do not redesign adjacent user-management surfaces outside the scoped list page.
hard_boundaries:
  - Do not touch billing, permissions, or unrelated dashboard routes in this plan.
escalation_triggers:
  - Stop if the requested work expands beyond the phase success criteria or crosses a forbidden surface.
approval_gates:
  - Ask before destructive migrations, external release actions, or rewriting approved product decisions.
anti_regression_targets:
  - Existing user route behavior outside the new list view remains unchanged.
known_unknowns:
  - Final empty-state copy may still need product confirmation.
high_leverage_surfaces: []
second_pass_required: false
closure_claim_limit: Do not claim phase completion until verification confirms the scoped truths with the required evidence.
parallelism_budget:
  max_concurrent_plans: 1
  safe_parallelism: []
leverage:
  lost: Slightly more planning ceremony for stronger execution boundaries.
  kept: Existing route/component conventions and repo-native workflow.
  gained: Better anti-drift enforcement and more honest closure limits.
must_haves:
  truths:
    - Users can view the list page.
  artifacts:
    - path: src/routes/users.ts
      provides: Users route handlers
  key_links:
    - from: src/app/users/page.tsx
      to: src/routes/users.ts
      via: fetch('/api/users')
---

# Phase 01: Foundation - Plan 01

## Objective
[What this plan accomplishes and why it matters]

## Context
- [Relevant context file or source path]
- [Relevant prior summary only if genuinely needed]

## Requirements Covered
- [REQ-ID]

## Must-Haves
1. [Observable truth from ROADMAP.md]
2. [Observable truth from ROADMAP.md]

## Anti-Goals
- [What this plan must not expand into]

## Hard Boundaries
- [Files, modules, workflows, or delivery surfaces that stay out of scope]

## Evidence Contract
- [Which tests, runtime checks, docs, or artifacts must exist before this plan can be claimed complete]

## Common Pitfalls
- [Typical ways this work drifts, overclaims, or breaks neighboring behavior]

## Stop-And-Challenge
- [Trigger condition that must pause execution and force clarification]

## Approval Gates
- [Decision or side-effect boundaries that require explicit user approval]

<checks>
<plan_check>
checker: self | cross_runtime
checker_runtime: claude-code
status: passed | issues_found | skipped
blocking: false
notes: [What the checker actually validated or why it was skipped]
</plan_check>
</checks>

## Tasks

<task id="01-01" type="auto">
  ...
</task>

<task id="01-02" type="auto">
  ...
</task>

## Verification
- [Overall plan-level verification or smoke checks]

## Success Criteria
- [What must be true when this plan is complete]

## High-Leverage Review
- [Which high-leverage surfaces are touched and whether a second pass is required]

## Leverage Review
- Lost: [What leverage this plan sacrifices]
- Kept: [What existing leverage or conventions it preserves]
- Gained: [What leverage this plan creates]

## Notes
[Gotchas, implementation notes, or explicit assumptions]
```

**MANDATORY: You MUST write PLAN.md to disk at `.planning/phases/{phase_dir}/{plan_id}-PLAN.md`. Output to conversation alone is NOT sufficient. If this file is not written to disk, planning is NOT complete.**
</plan_structure>

<approach_exploration>
### When This Runs

Check `.planning/config.json` for `workflow.discuss`:
- If `workflow.discuss: false` (or key missing): skip this section, go to `<goal_backward_planning>`. Note `reduced_alignment` in the orchestration summary.
- If `workflow.discuss: true`: mandatory before planning.

### Check for Existing APPROACH.md

Check if `{phase_dir}/{padded_phase}-APPROACH.md` exists.

**If exists:**
Offer the user a choice:
- "Use existing" — load decisions from APPROACH.md, skip to `<goal_backward_planning>`
- "Update it" — run the approach explorer to revise decisions
- "View it" — display APPROACH.md contents, then offer "Use existing" / "Update"

**If does not exist (or user chose "Update"):**
Run the approach explorer.

### Running the Approach Explorer

**Primary path — inline conversation with research subagents:**

The conversation with the user runs inline in the main context. For each technical gray area, a read-only research subagent is spawned to isolate heavy codebase and documentation reads, returning only compressed summaries.

1. Load context: read ONLY locked decisions from `.planning/SPEC.md` and the target phase goal/requirements from `.planning/ROADMAP.md`.

2. Identify 3-4 domain-specific gray areas. Classify each as **taste** (preference, no research needed), **technical** (trade-offs, research first), or **hybrid** (both).

3. For each **technical or hybrid** gray area, spawn a read-only research subagent.
   Use the prompt template from `.planning/templates/roles/approach-explorer.md` (`<research_subagent_prompt>` section), substituting the gray area name, classification, phase context, and relevant codebase files. Each subagent returns a structured summary under 1000 tokens.

4. Present each gray area to the user individually:
   - For taste areas: ask directly
   - For technical/hybrid: present the research summary, lead with recommendation
   - Ask: "Discuss this, or should I use my judgment?"

5. For each area the user chose to discuss, ask adaptive questions until the decision converges. Persist each confirmed decision to disk incrementally.

6. Surface assumptions across 5 dimensions with confidence levels. Wait for corrections.

7. Self-check: verify every decision is concrete enough for the planner before writing.

8. Write `{padded_phase}-APPROACH.md` to the phase directory.

**Native agent optimization:**

If your runtime provides an interactive `gsdd-approach-explorer` agent:
- Invoke it with: target phase goal, requirement IDs, locked decisions, phase research (if exists), relevant codebase files
- The native agent runs the full exploration in its own context window
- This is an optimization — the output (APPROACH.md) is identical to the primary path

**Inline fallback (reduced alignment):**

If neither the primary path nor native agent is available (e.g., the runtime cannot spawn research subagents):
- Read the phase goal and identify 2-3 obvious gray areas
- Present them to the user with your best assessment
- Capture any decisions the user provides
- Explicitly report `reduced_alignment` — the user did not get full research-backed exploration

### Using APPROACH.md Decisions

After approach exploration completes (or existing APPROACH.md is loaded):
- Treat decisions from APPROACH.md as locked constraints, same priority as `.planning/SPEC.md` decisions
- "Agent's Discretion" items from APPROACH.md give the planner flexibility — do not treat them as locked
- Thread the APPROACH.md file path to both the planner prompt and the plan-checker prompt
- Deferred ideas from APPROACH.md must not appear in the plan

### Role Contract

The approach explorer's full role contract is at `.planning/templates/roles/approach-explorer.md`. The portable workflow describes the orchestration; the role contract describes the agent's behavior.
</approach_exploration>

<plan_check_orchestration>
### How Plan Checking Works

After the planner produces a draft plan, an independent checker reviews it in fresh context. The checker does not inherit the planner's hidden reasoning; it treats the plan as an untrusted draft.

### What The Checker Verifies

1. `requirement_coverage` - every phase requirement is covered by at least one concrete task
2. `task_completeness` - every task has files, action, verify, and done fields; verify quality sub-checks ensure at least one runnable command per task, flag slow or watch-mode verification, and check test file ordering
3. `dependency_correctness` - ordering, dependencies, and plan structure are coherent
4. `key_link_completeness` - important wiring links are planned, not just isolated artifacts
5. `scope_sanity` - plans are sized so an executor can complete them without context collapse
6. `must_have_quality` - success criteria are specific, observable, and reflected in tasks
7. `context_compliance` - locked decisions are honored and deferred ideas stay out of scope
8. `goal_achievement` - the plan, if executed perfectly, actually achieves the stated phase goal: goal addressed (tasks deliver the goal), success criteria reachable (each criterion traceable to a task verify output), and outcome observable (a human or automated check can confirm the goal was met)
9. `scope_boundaries` - anti-goals and hard boundaries are explicit, enforceable, and reflected in the task set
10. `anti_regression_capture` - anti-regression targets are named and mapped to verification
11. `escalation_integrity` - stop-and-challenge triggers and approval gates are present where side effects or ambiguity warrant them
12. `closure_honesty` - closure claim limit prevents the plan from overclaiming what verification can prove
13. `high_leverage_review` - high-leverage surfaces and second-pass obligations are recorded honestly
14. `approach_alignment` - when APPROACH.md exists, plans implement the chosen approaches, not alternatives. Blocker if plan contradicts an explicit user choice. Warning if plan drifts from recommendation without justification. Skipped when no APPROACH.md is provided.
### Invoking the Checker
1. If `.planning/config.json` has `workflow.planCheck: false`, skip the independent checker. Perform the planner self-check below and report `reduced_assurance`.
2. If plan checking is enabled, check if your runtime provides a `gsdd-plan-checker` agent.
3. If a native checker agent is available, invoke it in a fresh context with only these explicit inputs:
   - target phase goal and requirement IDs
   - relevant locked decisions / deferred items from `.planning/SPEC.md`
   - approach decisions from `.planning/phases/*-APPROACH.md` (if exists)
   - relevant phase research file(s)
   - produced `.planning/phases/*-PLAN.md` file(s)
4. Require the checker to return a single JSON object:
   ```json
   {
     "status": "passed",
     "summary": "One sentence overall assessment",
     "issues": [
       {
         "dimension": "requirement_coverage | task_completeness | dependency_correctness | key_link_completeness | scope_sanity | must_have_quality | context_compliance | goal_achievement | scope_boundaries | anti_regression_capture | escalation_integrity | closure_honesty | high_leverage_review | approach_alignment",
         "severity": "blocker | warning",
         "description": "What is wrong",
         "plan": "01-PLAN",
         "task": "1-02",
         "fix_hint": "Specific revision instruction"
       }
     ]
   }
   ```
   Status must be either "passed" or "issues_found".
5. If the checker returns `passed`, finish and summarize.
6. If the checker returns `issues_found`, revise the existing plan files only where needed, then invoke the checker again.
7. Maximum 3 checker cycles total. If blockers remain after cycle 3, stop and escalate to the user instead of pretending the plan is ready.
8. If no native checker agent is available in your runtime, perform the planner self-check below and explicitly report `reduced_assurance` rather than claiming an independent checker ran.
When the checker outcome is finalized, write the result into the plan artifact:
- checker ran in same runtime or planner self-check only -> set frontmatter `assurance: self_checked`
- checker ran in a different runtime/vendor and passed -> set frontmatter `assurance: cross_runtime_checked`
- draft exists before any checker result is recorded -> keep `assurance: unreviewed`
- record the structured outcome in the plan's `<checks>` block; do not leave the checker result only in chat context
### Orchestration Summary
After plan checking completes, report:
- target phase
- whether independent plan checking ran
- checker cycle count (if applicable)
- final result: passed | reduced_assurance | escalated

### How Revision Works

The checker returns structured JSON feedback with specific issues, severities, and fix hints. The planner patches the existing plan where possible instead of replanning from scratch.

### When To Escalate

If blockers remain after 3 checker cycles, the orchestrator stops and escalates to the user. It does not pretend the plan is ready.
</plan_check_orchestration>

<plan_self_check>
Before presenting the plan, verify it yourself.

### Check Each Success Criterion
For every success criterion from `ROADMAP.md`:
- [ ] At least one task produces an artifact that satisfies it
- [ ] The task's `<verify>` section checks it specifically
- [ ] The criterion is covered explicitly, not only implied
### Check Task Completeness
For each task:
- [ ] The `<files>` section lists every file to create or modify
- [ ] The `<action>` is specific enough that an executor will not need to guess
- [ ] The `<verify>` steps include at least one runnable command
- [ ] If a `<verify>` step references a test file, an earlier task creates that file
- [ ] The `<done>` description matches the must-have or success criterion it covers
- [ ] `checkpoint:*` usage is consistent with `autonomous`

### Check The Anti-Drift Contract
- [ ] `non_goals` are explicit and would stop adjacent cleanup or feature widening
- [ ] `hard_boundaries` identify the main no-touch surfaces
- [ ] `escalation_triggers` force stop-and-challenge instead of silent interpretation
- [ ] `approval_gates` appear anywhere side effects or irreversible choices could happen
- [ ] `anti_regression_targets` are concrete enough for verification to check later
- [ ] `closure_claim_limit` prevents the executor from claiming more than the evidence can support
- [ ] `leverage.lost`, `leverage.kept`, and `leverage.gained` are explicit and defensible
- [ ] If `high_leverage_surfaces` is non-empty, `second_pass_required` is true and named in the plan body

### Red Flags
- A success criterion has no task covering it
- A task has no corresponding success criterion
- Two tasks modify the same file in contradictory ways
- A task depends on output from a later task
- All verify steps are observational text with no runnable commands
- The plan can drift into adjacent cleanup because the anti-goals or hard boundaries are vague
- The executor could cross a risky boundary without tripping a stop-and-challenge condition
- The plan claims phase completion more broadly than its own evidence contract can prove
</plan_self_check>

<success_criteria>
Planning is done when all of these are true:

- [ ] Target phase identified from `ROADMAP.md`
- [ ] Approach exploration completed or explicitly skipped with `reduced_alignment` reported
- [ ] When `workflow.discuss: true`: user alignment confirmed via APPROACH.md before planning
- [ ] Research check completed where needed
- [ ] Roadmap phase contract includes requirements, success criteria, explicit out-of-scope, and explicit stop/replan conditions
- [ ] Plan self-check passed
- [ ] Success criteria from `ROADMAP.md` are represented as must-haves
- [ ] Goal-backward derivation from criteria to artifacts to key links to tasks is explicit
- [ ] Every plan has frontmatter with `phase`, `plan`, `type`, `wave`, `depends_on`, `files-modified`, `autonomous`, `requirements`, `non_goals`, `hard_boundaries`, `escalation_triggers`, `approval_gates`, `anti_regression_targets`, `closure_claim_limit`, `parallelism_budget`, `leverage`, and `must_haves`
- [ ] Every plan frontmatter records `runtime` and `assurance`
- [ ] Every plan records checker outcome in a structured `<checks>` block
- [ ] Every task has XML structure with `id`, `type`, `files`, `action`, `verify`, and `done`
- [ ] Every task has at least one runnable verify command
- [ ] Plan sizing stays within 2-5 tasks, preferring 2-3
- [ ] Locked decisions from `.planning/SPEC.md` and APPROACH.md are honored
- [ ] Plan body includes explicit `## Anti-Goals`, `## Hard Boundaries`, `## Evidence Contract`, `## Common Pitfalls`, `## Stop-And-Challenge`, `## Approval Gates`, and `## Leverage Review` sections
- [ ] Any git guidance stays repo-native and follows `.planning/config.json`
</success_criteria>

<completion>
Report to the user what was accomplished, then present the next step:

---
**Completed:** Phase planning — created `.planning/phases/{phase_dir}/{plan_id}-PLAN.md`.
**Planning stops here:** `gsdd-plan` ends after the plan artifact is written. Do not start implementation in this same run, and do not treat imperative handoff text as execution authorization.
Installed generated runtime surfaces are trusted through rendering, not reviewer memory: `gsdd health` compares any local generated skill/adapter surfaces against current render output, and `gsdd update` regenerates them when they drift.

**Next workflow:** `/gsdd-execute` — start execution in a separate run when the user explicitly wants implementation to begin

Also available:
- `/gsdd-plan` — create additional plans for the same phase (if multi-wave)
- `/gsdd-progress` — check overall project status

Consider clearing context before starting the next workflow for best results.
---
</completion>
