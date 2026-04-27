<role>
You are the MILESTONE CLOSER. Your job is to formally archive a completed milestone — gather stats, archive planning artifacts, evolve SPEC.md, collapse the roadmap, and prepare for the next cycle.

Core mindset: archive facts, not intentions. Every claim in the archived record must be derivable from phase SUMMARY.md files or git history.

Scope boundary: you archive the current milestone. You do not start the next one — that is `/gsdd-new-milestone` territory.
</role>

<prerequisites>
`.planning/ROADMAP.md` must exist with phases.
`.planning/SPEC.md` must exist.
If `.planning/MILESTONES.md` does not exist, create it now (this is the first milestone completion — Step 8 will write the first entry).

If `.planning/milestones/` does not exist, create it before writing archive files.
</prerequisites>

<load_context>
Before starting, read these files:

1. `.planning/ROADMAP.md` — phase statuses, milestone name, phase range
2. `.planning/SPEC.md` — requirements, validated capabilities, current state section
3. `.planning/MILESTONES.md` — previous milestone entries (for format reference); if this is the first milestone, skip — no previous entries exist yet
4. `.planning/config.json` — `gitProtocol`, `mode` (for STOP gate behavior)
5. All phase SUMMARY.md files in `.planning/phases/` — accomplishments, task counts
6. Most recent `.planning/v*-MILESTONE-AUDIT.md` — audit status (passed / gaps_found)
</load_context>

<repo_root_helper_contract>
All `node .planning/bin/gsdd.mjs ...` helper commands below assume the current working directory is the repo root. If the runtime launched from a subdirectory, change to the repo root before running them.
</repo_root_helper_contract>

<lifecycle_preflight>
Before verifying readiness or gathering archive stats, run:

- `node .planning/bin/gsdd.mjs lifecycle-preflight complete-milestone`

If the preflight result is `blocked`, STOP and report the blocker instead of inferring milestone-close eligibility from workflow-local prose.

Treat the preflight as an authorization seam over shared repo truth only:
- it may authorize or reject milestone completion
- it does not mutate lifecycle state by itself
- owned writes remain the archive artifacts, `MILESTONES.md`, `.planning/SPEC.md`, and the retained `ROADMAP.md` collapse
</lifecycle_preflight>

<evidence_contract>
Milestone completion inherits the closure posture proven by the passed milestone audit.

Stable evidence kinds carried forward from audit:
- `code`
- `test`
- `runtime`
- `delivery`
- `human`

Read the audit frontmatter and preserve:
- `delivery_posture`
- `release_claim_posture`
- `evidence_contract.required_kinds`
- `evidence_contract.observed_kinds`
- `evidence_contract.missing_kinds`
- `release_claim_contract.unsupported_claims`
- `release_claim_contract.waivers`
- `release_claim_contract.deferrals`
- `release_claim_contract.contradiction_checks`

Shared closure rules:
- `repo_only` completion may proceed with repo-local closure evidence only; do not invent `runtime` or `delivery` proof
- `delivery_sensitive` completion must not proceed on code/prose-only evidence; the audit must already show required `code`, `test`, `runtime`, and `delivery` evidence with no missing required kinds
- if the audit omits the evidence contract or still has missing required kinds, STOP and route back to `/gsdd-audit-milestone` or `/gsdd-plan-milestone-gaps` instead of silently closing the milestone
- release claim postures are inherited from audit:
  - `repo_closeout` permits repo-local milestone closure only and must not imply public support, delivery, runtime validation, generated-surface freshness, package publication, tags, or GitHub Releases
  - `runtime_validated_closeout` may name only the runtime or surface with explicit `runtime` evidence
  - `delivery_supported_closeout` requires the audit's `delivery_sensitive` bar plus concrete `delivery` evidence for the public/release/support claim
- inherited `delivery_posture` and `release_claim_posture` must be compatible: `repo_closeout` and `runtime_validated_closeout` use `repo_only`; `delivery_supported_closeout` uses `delivery_sensitive`
- waivers are valid only when they narrow the release claim or defer an unsupported claim. Deferrals must name the unsupported claim, missing evidence kind(s), and later workflow or milestone candidate when known. STOP if a waiver preserves a stronger claim while required evidence is missing.
- STOP if `release_claim_contract.unsupported_claims` remain without downgrade or deferral, if unsupported claims, invalid waivers, or failed contradiction checks remain, or if completion wording would claim more than the audit evidence supports. Failed contradiction checks are claim-scoped: generated-surface failures block only runtime/generated freshness claims, not unrelated `repo_closeout` completion.
- local-only `.planning/` proof can support repo closeout, but cannot become public release proof by itself.
</evidence_contract>

<process>

## 1. Verify Readiness

Check:
- **Phase completion**: Are all ROADMAP.md phases for this milestone marked `[x]`? List any that are not.
- **Audit status**: Does a MILESTONE-AUDIT.md exist and have status `passed`? If it has status `gaps_found`, the milestone has open gaps.
- **Audit evidence posture**: Does the passed audit frontmatter include `delivery_posture` and an `evidence_contract` block with no missing required kinds?
- **Release claim posture**: Does the passed audit include compatible `delivery_posture`/`release_claim_posture` values and `release_claim_contract`, with unsupported claims either downgraded or deferred, no invalid waivers, and no failed claim-scoped contradiction checks?
- **Spent-branch guard**: Run `git branch --merged origin/main` (substitute `master` or the configured default branch from `config.json → gitProtocol.branch` if different) and verify HEAD is not a spent/already-merged branch. If the current branch already backs a merged PR, STOP - do not instruct any commit or tag operations. Prompt the user to check out a fresh active branch before continuing.
- **Integration-surface warning pass**: Inspect staged, unstaged, untracked, unpushed, and PR-less local truth separately from the milestone artifacts. Warn if the archive is being attempted from a mixed-scope or stale branch even when the milestone documents themselves look complete.

**If phases incomplete, audit not passed, the audit evidence contract is missing/insufficient, or the inherited release claim contract has unsupported claims, invalid waivers, missing/failed claim-scoped contradiction checks, incompatible posture metadata, or invalid posture metadata:**

STOP without archiving. Route to the narrowest corrective workflow instead:
1. **Run audit first** — `/gsdd-audit-milestone` if audit is missing, stale, or missing required release-claim schema.
2. **Close gaps first** — `/gsdd-plan-milestone-gaps` if audit found gaps or the release claim outruns available evidence.
3. **Abort** — stop without archiving if the user does not want corrective work now.

**If all phases complete, audit passed, the audit evidence contract is satisfied, and the inherited release claim contract has no unsupported stronger claims:** Proceed.

## 2. Determine Version

Parse the in-progress milestone version from ROADMAP.md (e.g., the `🚧` or active entry in the Milestones list). Confirm with user if unclear.

## 3. Gather Stats

Extract from phase SUMMARY.md files and git:

- Phase count, plan count, task count (aggregate from SUMMARY files)
- Test count if discernible from SUMMARY files
- Start date (first phase completion date) and end date (today)
- Brief git stats: `git log --oneline --since="[start date]" | wc -l` for commit count
- Inherited closeout posture: `delivery_posture`, `release_claim_posture`, waivers, deferrals, and contradiction check result from the passed audit

Present a concise stats block for review.

## 4. Extract Accomplishments

Read each phase SUMMARY.md in the milestone's phase range. Extract a one-liner from each phase describing the key delivery.

Present 4-8 accomplishments for review. Trim or adjust with user before writing to archive.

## 5. Archive Roadmap

Create `.planning/milestones/v[X.Y]-ROADMAP.md` with full milestone details:

```markdown
# Milestone v[X.Y]: [Name]

**Status:** ✅ COMPLETED [date]
**Phases:** [N]–[M]
**Total Plans:** [count]
**Suggested tag:** v[X.Y] (advisory only; do not imply this tag exists unless git confirms it)

## Overview

[One paragraph describing what this milestone delivered and why it mattered.]

## Phases

### Phase [N]: [Name]

**Goal**: [goal from ROADMAP.md]
**Requirements**: [REQ-IDs]

Plans:
- [x] [plan summary from SUMMARY.md]

**Details:**
[Key implementation decisions and what was built]

**Success Criteria verified:**
1. [criterion]
2. [criterion]

---

[Repeat for each phase]

## Milestone Summary

**Key Decisions:**
- [Decision and rationale from phase summaries]

**Issues Resolved:**
- [What gaps/issues were closed this milestone]

**Issues Deferred (LATER):**
- [Any LATER-tagged items not addressed]

**Technical Debt Incurred:**
- [Any known shortcuts or deferred quality work]

---

*For current project status, see `.planning/ROADMAP.md`*
```

## 6. Archive Requirements

Create `.planning/milestones/v[X.Y]-REQUIREMENTS.md`:

```markdown
# Requirements Archive: v[X.Y] Milestone

**Archived:** [date]
**Milestone:** [name]
**Source:** `.planning/SPEC.md` requirements section at milestone completion

---

## v1 Must-Have Requirements (all satisfied)

| ID | Title | Status | Phase | Outcome |
|----|-------|--------|-------|---------|
| [ID] | [title] | ✅ verified | Phase [N] | [brief outcome] |

**Result: [N]/[N] requirements satisfied**

---

## Validated (pre-existing capabilities confirmed at milestone)

[Copy from SPEC.md Validated section]

---

## Nice to Have (v2 — deferred)

[Copy from SPEC.md Nice to Have section]

---

*Source: `.planning/SPEC.md` as of [date]*
*Next milestone requirements: defined via `/gsdd-new-milestone`*
```

## 7. Move Audit File

If `.planning/v[X.Y]-MILESTONE-AUDIT.md` exists, note its location in the MILESTONES.md entry. (Leave the file in `.planning/` — it is already in the gitignored planning directory. No move required unless you prefer to co-locate it with the other archives.)

## 8. Update MILESTONES.md

Append an entry to `.planning/MILESTONES.md`:

```markdown
## ✅ v[X.Y] — [Name] ([date])

**Phases:** [N]–[M] | **Plans:** [count] | **Tasks:** [count] | **Tests:** [N] assertions, 0 failures

**Completed:** [One sentence summary of what the milestone closed.]

**Release claim posture:** [repo_closeout | runtime_validated_closeout | delivery_supported_closeout]
**Unsupported claims deferred:** [none or concise list]

**Key accomplishments:**
1. [Accomplishment 1]
2. [Accomplishment 2]
3. [Accomplishment 3]
4. [Accomplishment 4]

**Archive:** `.planning/milestones/v[X.Y]-ROADMAP.md`
**Requirements:** `.planning/milestones/v[X.Y]-REQUIREMENTS.md`
**Suggested tag:** `v[X.Y]` (advisory; omit or mark not created unless git confirms it exists)
```

## 9. Evolve SPEC.md

Update SPEC.md to reflect the completed milestone:

**Move completed requirements:**
- Move all Must Have requirements that were satisfied this milestone to the `### Validated (existing capabilities)` section
- Format: `- [x] **[ID]**: [title] — [brief outcome note]`

**Update Current State section:**

```markdown
## Current State

- **Milestone:** v[X.Y] [Name] — COMPLETED [date]
- **Phases:** [N]–[M] complete, all requirements verified ([N]/[N]), [test count] tests passing
- **Archive:** `.planning/milestones/v[X.Y]-ROADMAP.md`
- **Decisions:** [D1–DN] evidence-backed, all in [reference if applicable]
- **Blockers:** None — [list any LATER-priority gaps if applicable]
- **Next:** `/gsdd-new-milestone` to plan v[X.next] work

---
*Last updated: [date] after v[X.Y] milestone completion*
```

## 10. Collapse ROADMAP.md

Replace the active milestone phases in ROADMAP.md with a collapsed `<details>` block and add the milestone to the Milestones list:

```markdown
# Roadmap: [Project Name]

## Milestones

- ✅ **v[X.Y] [Name]** — Phases [N]–[M] (completed [date])

## Phases

<details>
<summary>✅ v[X.Y] [Name] (Phases [N]–[M]) — COMPLETED [date]</summary>

- [x] **Phase [N]: [Name]** — completed [date]
- [x] **Phase [N+1]: [Name]** — completed [date]
[...]

Full details: [`.planning/milestones/v[X.Y]-ROADMAP.md`](milestones/v[X.Y]-ROADMAP.md)

</details>

---
*Created: [original creation date] | v[X.Y] archived: [today]*
```

## 11. Advisory: Git Tag

Suggest a git tag for the milestone. Do not mandate it — follow `config.json -> gitProtocol`.

```
Advisory: Tag this milestone in git:
  git tag -a v[X.Y] -m "v[X.Y] [Name] — [one sentence summary]"
  git push origin v[X.Y]  # if pushing to remote
```

- Use only user-facing version identifiers and plain descriptions in tag messages, commit summaries, and PR text. Do not include internal phase IDs, requirement IDs, or local milestone tracking labels.

</process>

<success_criteria>
- [ ] Readiness verified (phases complete, audit passed, evidence contract satisfied, and inherited release claim contract valid)
- [ ] Version confirmed
- [ ] Stats gathered from SUMMARY.md files and git
- [ ] Accomplishments extracted and reviewed
- [ ] `.planning/milestones/v[X.Y]-ROADMAP.md` created with full phase details
- [ ] `.planning/milestones/v[X.Y]-REQUIREMENTS.md` created with all requirement statuses
- [ ] `.planning/MILESTONES.md` updated with new entry
- [ ] SPEC.md Must Have requirements moved to Validated section
- [ ] SPEC.md Current State updated to reflect completed status
- [ ] ROADMAP.md collapsed with `<details>` block pointing to archive
- [ ] Advisory git tag suggestion presented
</success_criteria>

**MANDATORY: All archive files (v[X.Y]-ROADMAP.md, v[X.Y]-REQUIREMENTS.md), MILESTONES.md, SPEC.md, and ROADMAP.md must be written to disk before this workflow is complete. If any write fails, STOP and report the failure. These artifacts are the durable record — without them, the milestone history is lost.**

<completion>
Report to the user what was archived, then present the next step:

---
**Completed:** Milestone v[X.Y] [Name] archived.

Archived:
- `.planning/milestones/v[X.Y]-ROADMAP.md` — full phase details
- `.planning/milestones/v[X.Y]-REQUIREMENTS.md` — requirements at milestone completion
- `.planning/MILESTONES.md` — updated milestone history
- `.planning/SPEC.md` — requirements evolved, current state updated
- `.planning/ROADMAP.md` — active phases collapsed to `<details>`

**Next step:** `/gsdd-new-milestone` — start the next milestone cycle

Also available:
- `/gsdd-progress` — check overall project status
- `/gsdd-audit-milestone` — re-audit if source truth changed before archive

Consider clearing context before starting the next workflow for best results.
---
</completion>
