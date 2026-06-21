# Goal: `gsdd next` Continuity Milestone

Date: 2026-06-20
Status: planning
Canonical runtime directory: `.work/`
Legacy planning directory: `.planning/`

## Objective

Implement a new Workspine milestone that makes `gsdd next` the agent-facing continuity primitive.

`gsdd next` answers one question:

> Given the current goal, repo truth, milestone state, memory graph, open questions, evidence, and prior decisions, what is the next coherent action for the agent?

The milestone must let the user frontload product decisions, leave the agent to work through the planning -> execution -> verification -> audit -> gap-fix loop, and return later to answer only the remaining questions that were genuinely blocked.

## Product Thesis

Workspine should become the control layer for serious agentic product work.

Agents should be able to continue without rereading a month of raw transcripts, but they must not run as an unbounded autonomous loop. The product should preserve coherence by converting goals, decisions, questions, evidence, dogfood findings, and session learnings into a small local continuity graph.

The user remains the product owner. `gsdd next` keeps asking for decisions only at meaningful gates.

## Core User Story

As a user, I can write or approve a milestone goal once, leave, and later let an agent run:

```text
gsdd next
```

The agent receives a structured packet that says whether to ask the user, research, plan, execute, verify, audit, fix gaps, dogfood, pause, or complete.

## Why Now

Recent Workspine dogfooding exposed the same failure class repeatedly:

- agents lose continuity after compaction or session boundaries
- high-value session lessons stay trapped in transcripts
- `.planning` carries too many meanings and is hard to evolve
- milestone truth can be absent while local plans still look authoritative
- verification can pass locally while milestone-level integration still has gaps
- browser/UI proof, global install proof, and runtime discovery need evidence-gated claims
- research/deepening work needs model/tool routing constraints recorded up front

The next milestone should fix the operating system before adding more feature-specific proof machinery.

## Current Repo Reality

This checkout does not currently have canonical `.planning/SPEC.md`, `.planning/ROADMAP.md`, or `.planning/MILESTONES.md`.

That matters. Existing `gsdd-new-milestone` requires those files and must fail closed when they are missing. Prior lessons already record this as a false-closure risk.

Therefore this milestone must include a bootstrap path instead of pretending the old lifecycle truth exists.

## Design Direction

Use `.work/` as the new runtime state root.

`.work` is not only context. It contains active work state: goals, graph events, decisions, questions, evidence manifests, focus packets, dogfood findings, and handoff material.

Reserve `.context` for exported semantic context bundles, likely produced by `codebase-context` or another context provider. Workspine may consume `.context`, but `.work` owns continuity.

## Non-Goals

- Do not build an unbounded autonomous loop.
- Do not ingest raw Codex, Claude, Cursor, or other vendor transcripts by default.
- Do not commit private session memory, screenshots, traces, DOM dumps, or secrets.
- Do not turn Workspine into `codebase-context`.
- Do not replace existing `gsdd-plan`, `gsdd-execute`, `gsdd-verify`, or milestone audit workflows.
- Do not make Playwright MCP, Chrome DevTools MCP, or any single browser provider the default architecture.
- Do not require hosted memory infrastructure.
- Do not introduce SQLite, graph databases, vector databases, or MCP memory servers before the file-based graph shape is proven.
- Do not auto-spawn implementation or research subagents unless the runtime can enforce the required model/tool profile.

## Architecture Boundaries

Workspine owns:

- active goal and milestone continuity
- decisions and open questions
- workflow routing
- evidence contracts
- verification/audit/gap-fix state
- dogfood capture
- privacy and publication posture for work artifacts

`codebase-context` owns:

- codebase semantic graph
- symbols, files, dependencies, and architecture facts
- repo-specific context retrieval
- codebase memory with freshness/provenance

`ideaspine` owns:

- raw idea staging
- cross-project incubation
- challenge-coin/research notes before they become Workspine product commitments

## Proposed `.work/` Shape

```text
.work/
  goal.md
  state.json
  graph/
    events.jsonl
    index.json
  decisions/
    *.md
  questions/
    open.json
    answered.jsonl
  evidence/
    manifest.json
  focus/
    current.md
  dogfood/
    *.md
  handoff/
    current.md
```

The graph starts as append-only JSONL plus a derived index. The append-only log is source of truth; the index is rebuildable.

## Graph Model

Minimum node types:

- `goal`
- `milestone`
- `phase`
- `task`
- `decision`
- `question`
- `assumption`
- `evidence`
- `artifact`
- `dogfood_finding`
- `session_summary`
- `repo`
- `external_context`

Minimum edge types:

- `belongs_to`
- `blocks`
- `answers`
- `supports`
- `contradicts`
- `supersedes`
- `derived_from`
- `requires_decision`
- `verified_by`
- `deferred_to`
- `references`

Every event must include:

```json
{
  "id": "evt_...",
  "created_at": "ISO-8601",
  "actor": "user|agent|tool",
  "type": "node_created|node_updated|edge_created|question_answered|decision_recorded|evidence_recorded",
  "privacy": "public|repo|local_only|secret_risk",
  "source": "chat|file|command|web|ideaspine|codebase-context|manual",
  "payload": {}
}
```

## `gsdd next` Contract

`gsdd next` is read-first and deterministic where possible.

Inputs:

- `.work/goal.md`
- `.work/state.json`
- `.work/graph/events.jsonl`
- `.work/graph/index.json` if present
- `.work/questions/open.json`
- `.work/evidence/manifest.json`
- `.work/handoff/current.md`
- legacy `.planning/` artifacts when present
- repo truth from `control-map`
- optional ideaspine pointers
- optional codebase-context provider output

Outputs:

```json
{
  "state": "ask_user|research|plan|execute|verify|audit|fix_gaps|dogfood|pause|blocked|complete",
  "reason": "short explanation",
  "confidence": "high|medium|low",
  "next_command": "command or workflow name",
  "requires_user": true,
  "questions": [],
  "constraints": [],
  "evidence_required": [],
  "artifacts_to_read": [],
  "artifacts_to_write": [],
  "privacy_notes": []
}
```

Human-readable output should be concise and action-oriented. JSON output should be available through `--json`.

## State Machine

Allowed states:

- `ask_user`: unresolved product/architecture question blocks coherent work
- `research`: current facts are stale, external, vendor-specific, or high risk
- `plan`: enough is known to create or revise a plan
- `execute`: a reviewed plan exists and has executable tasks
- `verify`: execution artifacts exist and need phase verification
- `audit`: all phases for a milestone are verified and milestone-level integration needs checking
- `fix_gaps`: audit or verification found unsatisfied requirements
- `dogfood`: work passed and should generate a short Workspine improvement finding
- `pause`: save handoff because work cannot safely continue in this run
- `blocked`: repeated blocker needs external input or state change
- `complete`: milestone closure criteria are satisfied

`gsdd next` must not silently jump across human gates.

## Human Decision Gates

The user must explicitly approve:

- milestone objective changes
- architecture boundary changes
- graph storage migration beyond JSONL/index files
- adding hosted services, vector databases, SQLite, or MCP memory servers
- committing local-only memory or session-derived artifacts
- running live vendor probes that require auth/quota
- launching or attaching to browser sessions that may expose private UI state
- widening a phase beyond its success criteria
- accepting audit gaps as deferred work
- declaring milestone complete

The agent may proceed without asking for:

- reading repo files
- producing focus packets
- drafting research summaries
- creating local `.work` state files
- adding tests for already-approved behavior
- fixing straightforward implementation bugs inside an approved plan
- rerunning verification commands
- appending dogfood findings after a pass

## Upfront Product Questions

These are the questions the user should answer before implementation if possible. Defaults are included so the agent can proceed if the user explicitly approves the defaults.

1. Should `gsdd next` be read-only in v1?
   - Default: yes. It routes and emits packets; it does not mutate except for optional local state refresh.

2. Should `.work/` become canonical immediately?
   - Default: yes for new continuity artifacts; `.planning/` remains legacy-compatible and readable.

3. Should the first graph store be JSONL plus rebuildable index?
   - Default: yes.

4. Should `gsdd next` call existing workflows or only recommend them?
   - Default: recommend only in v1; later `--run` may execute bounded workflows.

5. Should session transcript extraction exist in this milestone?
   - Default: no raw transcript extraction in phase 1; only manually supplied or summarized session notes.

6. Should ideaspine integration be path-based first?
   - Default: yes. Read selected files/pointers; do not ingest all of ideaspine.

7. Should codebase-context integration be built now?
   - Default: adapter interface only; live provider integration after `gsdd next` core is stable.

8. Should browser proof be included in this milestone?
   - Default: only as an evidence category and future provider constraint, not live browser implementation.

9. Should this milestone bootstrap missing lifecycle truth?
   - Default: yes. The milestone must either create the minimal Workspine-native lifecycle state or explicitly bridge old `.planning` workflows to `.work`.

10. Should the agent be allowed to run plan -> execute -> verify -> audit -> fix-gaps repeatedly?
    - Default: yes after the milestone goal and first plan are approved, but it must stop at the human gates listed above.

## Research Requirements

Research must be current as of the day the milestone is planned or implemented.

Primary grounding:

- `.work/research/2026-06-20-long-term-agent-harness-consistency.md`

Research areas:

- current Codex non-interactive execution, JSONL event streams, hooks, subagents, and memory support
- current Claude Code hooks, subagents, memory, and lifecycle events
- current MCP trust/security boundaries for tool and resource outputs
- current local-first graph/event-log patterns appropriate for CLI tools
- current privacy guidance for local agent memory and transcript-derived artifacts
- current Workspine codebase conventions and existing lifecycle/helper patterns
- current harness-engineering patterns for durable execution, human interrupts, trace/eval loops, structured repair loops, and agent-computer interfaces
- current agent benchmark failure modes for long-horizon reasoning, planning, instruction following, tool use, and environment interaction
- current agent runtime safety research for tool-call interception, lifecycle security, trust boundaries, memory poisoning, retrieval poisoning, and authorization confusion

Model routing constraint:

- Research/deepening subagents must use `gpt-5.4-high` where model selection is available.
- Do not use `gpt-5.5` for those research/deepening roles.
- If the runtime cannot enforce model selection, do not spawn those subagents. Emit research briefs instead and mark reduced assurance.

## Milestone Requirements

Draft requirement IDs for the future milestone setup:

- [ ] **[NEXT-01]**: User can run `gsdd next` and receive a structured next-action packet derived from `.work`, repo truth, and legacy `.planning` when present. [Done-When: `gsdd next --json` returns one valid state, reason, confidence, next command, constraints, and evidence requirements against fixture repos.]

- [ ] **[WORK-01]**: User can initialize or refresh `.work/` without destroying or rewriting `.planning/`. [Done-When: `.work/goal.md`, `state.json`, graph files, questions, evidence manifest, and handoff paths are created or validated idempotently.]

- [ ] **[GRAPH-01]**: User has a local append-only continuity graph for goals, decisions, questions, evidence, dogfood findings, and external context pointers. [Done-When: graph events validate against schema, index rebuild is deterministic, and local-only/privacy fields are enforced.]

- [ ] **[QUESTION-01]**: User can frontload decisions and return later to answer only unresolved questions. [Done-When: open questions are stored, answered questions append to history, and `gsdd next` routes to `ask_user` only for unresolved blocking questions.]

- [ ] **[DECISION-01]**: User can record architecture/product decisions that later runs must honor. [Done-When: decisions are persisted, linked into the graph, surfaced in `gsdd next`, and supersession is explicit.]

- [ ] **[FLOW-01]**: Agent can follow the plan -> execute -> verify -> audit -> fix-gaps loop using `gsdd next` as the routing layer. [Done-When: fixture states route correctly between plan, execute, verify, audit, fix_gaps, dogfood, pause, blocked, and complete.]

- [ ] **[DOGFOOD-01]**: User can capture a short Workspine dogfood finding after a verified pass. [Done-When: `gsdd next` routes to `dogfood` after pass conditions and generated findings are bounded, local-first, and backlog-linkable.]

- [ ] **[PRIVACY-01]**: User is protected from accidental publication of private memory or raw session evidence. [Done-When: local-only artifacts are marked, raw transcript ingestion is disabled by default, and publication checks fail closed.]

- [ ] **[COMPAT-01]**: Existing `.planning` workflows continue to work while `.work` becomes the new continuity surface. [Done-When: tests prove `.planning` artifacts are read as legacy inputs and new continuity artifacts write under `.work`.]

- [ ] **[EVAL-01]**: User can evaluate `gsdd next` routing against durable fixture states instead of trusting a single manual run. [Done-When: fixture evals cover every allowed state, record expected packet fields, and fail on unsupported state transitions.]

- [ ] **[TRACE-01]**: User can reconstruct why `gsdd next` chose a state from durable trace-like events. [Done-When: every next-action packet records inputs considered, skipped inputs, decision reason, confidence, and graph/evidence event references.]

- [ ] **[INTERRUPT-01]**: User decision gates behave like durable interrupts. [Done-When: blocking questions persist with IDs, payloads, default recommendations, and resume semantics; answered questions update the graph and route forward.]

- [ ] **[TRUST-01]**: User is protected from unsafe tool/action escalation during long-running agent work. [Done-When: `gsdd next` identifies privileged boundary crossings and routes to `ask_user` or `blocked` before destructive, privacy-sensitive, live-vendor, browser, or publication actions.]

## Candidate Phase Sequence

### Phase 1: `.work` Bootstrap and Goal Contract

Goal: Establish `.work` as the canonical continuity root without breaking `.planning`.

Success criteria:

1. `.work` structure can be initialized and validated idempotently.
2. Root `goal.md` points to `.work/goal.md`.
3. Legacy `.planning` absence is handled honestly.
4. Tests cover bootstrap, validation, and privacy defaults.

### Phase 2: Continuity Graph Core

Goal: Add append-only graph events, deterministic index rebuild, and schema validation.

Success criteria:

1. Graph event schema supports required node and edge types.
2. Index rebuild is deterministic and ignores invalid local-only publication.
3. Decisions, questions, evidence, and dogfood nodes can be represented.
4. Tests cover malformed events, supersession, blockers, and privacy fields.

### Phase 3: `gsdd next` Read-Only Router

Goal: Implement `gsdd next` as a read-only state router.

Success criteria:

1. `gsdd next --json` emits the structured packet contract.
2. Router reads `.work`, `control-map`, and legacy `.planning` when available.
3. Fixture states route to all allowed states.
4. Human gates prevent silent execution across approval boundaries.

### Phase 4: Questions, Decisions, and Handoff

Goal: Make user decision frontloading and return-later continuity work in practice.

Success criteria:

1. Open questions are persisted and routed.
2. Answered questions append to history and update graph links.
3. Decisions are persisted with supersession support.
4. Handoff material is generated from graph state, not chat memory.

### Phase 5: Dogfood and Gap-Fix Loop

Goal: Close the milestone loop with verification/audit/gap-fix/dogfood routing.

Success criteria:

1. Passed verification routes to dogfood or audit as appropriate.
2. Audit gaps route to fix_gaps.
3. Dogfood finding is bounded and links to backlog or ideaspine pointer.
4. Milestone complete is blocked until audit and human gate conditions are satisfied.

### Phase 6: Harness Evals and Trust Boundaries

Goal: Add the minimum evaluation and trust-boundary coverage needed for long-term consistency.

Success criteria:

1. Fixture evals cover all `gsdd next` states and important failure modes.
2. Structured review/audit findings are consumable by `fix_gaps`.
3. Next-action packets include trace references and skipped-input notes.
4. Human gates cover action risk, reversibility, privacy, and authority boundaries.

## Verification Strategy

Required test categories:

- CLI contract tests for `gsdd next --json`
- fixture repo tests for every state transition
- `.work` bootstrap/idempotency tests
- graph schema and index rebuild tests
- privacy/local-only publication guard tests
- legacy `.planning` compatibility tests
- question/decision supersession tests
- dogfood routing tests
- no-raw-transcript default tests
- fixture evals for all `gsdd next` states
- structured review-to-repair handoff tests
- durable interrupt/resume tests
- trust-boundary routing tests for destructive, live-vendor, browser, MCP, and publication actions

Manual verification:

- Run `gsdd next` in this Workspine repo with missing `.planning/SPEC.md` and confirm it does not falsely claim a normal milestone lifecycle.
- Run `gsdd next` in a fixture with valid `.planning` and confirm legacy compatibility.
- Run a dogfood pass after verification and confirm the output is useful but bounded.

## Audit Strategy

Milestone audit must verify:

- every requirement maps to at least one phase and one verification artifact
- `gsdd next` does not overclaim autonomy
- `.work` and `.planning` boundaries are coherent
- privacy gates fail closed
- graph state can reconstruct the current decision posture
- gap-fix routing is tested with failing fixtures
- dogfood output produces actionable Workspine improvement without bloating state

If audit finds gaps, the agent should plan gap-closure phases and repeat execute -> verify -> audit.

## Implementation Loop Contract

After the user approves this goal and the first detailed plan, the agent should work autonomously through:

```text
plan -> execute -> verify -> audit -> fix gaps -> verify -> audit -> dogfood
```

The agent must stop and ask only when:

- a listed human decision gate is reached
- a blocker repeats and cannot be resolved from repo truth
- implementation would widen architecture beyond this goal
- privacy or publication status is ambiguous
- current research contradicts the plan

The agent should not stop merely because the work is multi-step.

## Immediate Next Step

Convert this goal into proper milestone lifecycle truth.

Because canonical `.planning/SPEC.md`, `.planning/ROADMAP.md`, and `.planning/MILESTONES.md` are currently missing, the next planning action must choose one of:

1. Bootstrap a new Workspine-native lifecycle using `.work` as canonical state and `.planning` as legacy input.
2. Recreate the existing `.planning` lifecycle prerequisites first, then add `.work`.

Default recommendation: choose option 1. This milestone is explicitly about moving beyond `.planning`, so `.work` should become canonical now while legacy workflows remain readable.

## Open Issues

- Exact CLI spelling for initialization: `gsdd work init`, `gsdd next --init`, or implicit bootstrap.
- Whether root `goal.md` remains a pointer forever or is removed after `.work` is standard.
- Whether `.work` should be committed by default or split into committed templates plus gitignored local state.
- Whether dogfood findings export to `../ideaspine` automatically or only by explicit command.
- Whether a minimal `.context` export should be generated from `.work` for external agents later.
