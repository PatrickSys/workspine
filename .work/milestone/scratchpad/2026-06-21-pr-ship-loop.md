# Scratchpad: PR Ship Loop for `gsdd next`

Date: 2026-06-21
Status: completed locally; PR/merge pending
Purpose: lock the final PR plan, run three challenge loops, and only merge if verification and PR status are clean.

## Locked User Decisions

- Shipping scope: current `gsdd next` v1 plus hardening candidates only.
- Challenge loops may change product behavior when the change lowers cognitive load or closes coherence gaps.
- Human surface: terse next action, reason, required evidence, and blocking question.
- Agent surface: exact command or skill names where possible.
- `gsdd next` mutation: plain `gsdd next` remains read-oriented; explicit subcommands and explicit refresh/index operations may mutate.
- Deterministic computation: prefer scripts/helpers for repeatable state, graph, and eval decisions.
- Duplicate IDs: fail unless `--replace` is explicit.
- Graph semantics: implement explicit `answers` and `supersedes` edges now.
- Commit policy: track durable `.work` goal, research, milestone, phase packets, and `.work/.gitignore`.
- PR policy: create PR, inspect status, and squash merge only if clean.

Assumption: the user omitted `3.2`; I applied the recommended deterministic-helper posture because it matches the surrounding answer and Workspine philosophy.

## Research Grounding Added During This Loop

- OpenAI Codex non-interactive mode and CLI features reinforce scriptable, non-TUI automation and stable stdout contracts:
  - https://developers.openai.com/codex/noninteractive
  - https://developers.openai.com/codex/cli/features
  - https://developers.openai.com/codex/cli/reference
- Claude Code hooks document lifecycle event schemas and JSON I/O, supporting deterministic harness boundaries:
  - https://code.claude.com/docs/en/hooks
- OpenAI and Anthropic harness/eval guidance from the gpt-5.4 research agent emphasizes evidence-gated loops, context resets, structured handoffs, and trace-to-eval feedback:
  - https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop
  - https://developers.openai.com/blog/run-long-horizon-tasks-with-codex
  - https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
  - https://www.anthropic.com/engineering/harness-design-long-running-apps
  - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Durable human interrupts and task/artifact-centric orchestration are supported by current agent frameworks:
  - https://docs.langchain.com/oss/python/langgraph/interrupts
  - https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop
  - https://openai.github.io/openai-agents-python/human_in_the_loop/
  - https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
- Current MCP/security guidance reinforces fail-closed trust boundaries and skeptical treatment of tool/resource descriptions:
  - https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/
  - https://developer.microsoft.com/blog/protecting-against-indirect-injection-attacks-mcp
  - https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf
  - https://arxiv.org/html/2603.22489v1

Connector note: the Consensus connector required reauthentication, so paper search via that connector was unavailable in this run.

## Three-Loop Plan

1. Coherence and architecture loop:
   - Challenge whether changes fit Workspine's `.work`/`.planning` boundary.
   - Remove prose-ish routing where an exact command/skill token exists.
   - Ensure duplicate mutation behavior is retry-safe.
   - Verify with focused `gsdd.next` tests.

2. Deterministic harness and eval loop:
   - Challenge whether graph/index behavior lets a future agent reconstruct decisions without transcript rereads.
   - Make answer and supersession relationships explicit graph edges.
   - Add tests that rebuild/inspect the deterministic index.
   - Check human output stays terse and useful.

3. Privacy, release, and PR-readiness loop:
   - Challenge tracked vs local `.work` surfaces.
   - Run full tests and package dry-run.
   - Inspect git status so unrelated files are excluded.
   - Create PR, inspect checks, and squash merge only if clean.

## Loop 1: Coherence, Architecture, and UX

Status: completed.

Findings:

- `next_command` still included prose values such as `draft .work milestone plan`, `capture .work dogfood finding`, and `review .work/milestone/AUDIT.md with the user`.
- Mutating subcommands overwrote duplicate IDs by default, which is hostile to agent retries and long-term decision archaeology.
- Help did not advertise explicit replacement semantics.

Changes:

- Added typed `next_action` values so the agent surface is not overloaded prose:
  - `cli_command`
  - `workflow_skill`
  - `manual_review`
  - `user_question`
- Kept `next_command` as a compatibility field, but made `next_action` the stricter contract.
- Changed routable command compatibility strings to exact skill/command tokens where possible:
  - `gsdd-plan`
  - `gsdd-execute`
  - `gsdd-verify`
  - `gsdd-audit-milestone`
  - `gsdd-plan-milestone-gaps`
  - `gsdd-complete-milestone`
  - `gsdd next dogfood capture --id <id> --title <text> --body <text>`
- Added `--replace` to question, decision, and dogfood mutation surfaces.
- Changed question, decision, and dogfood duplicate IDs to replay as `unchanged` when content matches and fail unless `--replace` is explicit when content differs.
- Changed captured stdout default to JSON through `--format auto`; `--format human` gives the compact supervisor card.
- Moved dirty-worktree warnings into `repo_warnings` instead of `privacy_notes`.

Verification:

- `rtk node --test --test-reporter=spec tests\gsdd.next.test.cjs`: passed, 26 tests.

## Loop 2: Deterministic Graph and Harness Eval

Status: completed.

Challenge:

- If a future agent cannot reconstruct why a question was answered or why a decision superseded another decision from `.work/graph/index.json`, Workspine is still relying on transcript archaeology.
- The deterministic graph needs relationships, not only latest node snapshots.

Changes:

- `gsdd next question answer` now records both:
  - a `question_answered` event with the answer payload
  - an `edge_created` event of type `answers`
- `gsdd next decision record --supersedes <id>` now records both:
  - a `decision_recorded` event
  - an `edge_created` event of type `supersedes`
- JSON responses now include `graph_event_ids` when a mutation creates more than one event.
- Same-input replays for `question add`, `question answer`, `decision record`, and `dogfood capture` do not append new graph events.
- `.work` writes now use atomic file replacement for JSON/markdown projections and fsynced appends for graph/audit JSONL paths.
- README and CLI help now document `--format human`, JSON-by-default captured output, typed `next_action`, and retry-safe mutation boundaries.

Verification:

- `rtk node --test --test-reporter=spec tests\gsdd.next.test.cjs`: passed, 26 tests.
  - Includes assertions that `answers` and `supersedes` edges appear in `.work/graph/index.json`.
  - Includes assertions that same-input replays produce no new graph event lines.

## Loop 3: Privacy, Release, and PR Readiness

Status: completed locally.

Challenge:

- The PR should not ship if it mixes repo dirtiness with privacy semantics, relies on raw transcript truth, or stages local-only mutable `.work` files.
- The package should contain the new source modules, while `.work` runtime state remains local.
- External gpt-5.4 research agents identified two PR-critical gaps: overloaded `next_command` and non-idempotent mutation replay. Both were fixed before final verification.

Changes:

- Human `gsdd next --format human` now behaves like a compact supervisor card:
  - state
  - reason
  - next review/action
  - approval requirement
  - blocking question
  - evidence required
  - repo risk
- Captured `gsdd next` defaults to JSON for agent tooling.
- Completion approval now surfaces a `manual_review` action over audit, roadmap, and evidence before completion.
- `repo_warnings` separate worktree risk from privacy notes.
- Durable `.work/milestone/scratchpad/2026-06-21-pr-ship-loop.md` records the fork decisions, research grounding, and all three loops.

Verification:

- `rtk node bin\gsdd.mjs next`: passed; captured stdout emitted JSON with typed `next_action`.
- `rtk node bin\gsdd.mjs next --format human`: passed; emitted the compact supervisor card.
- `rtk node --test --test-reporter=spec tests\gsdd.next.test.cjs`: passed, 26 tests.
- `rtk npm test`: passed.
- `rtk npm pack --dry-run --json`: passed; package includes updated `bin/lib/next.mjs` and `bin/lib/work-context.mjs`.

Residual follow-up candidates not blocking this PR:

- Add a full WAL-style operation protocol with `op_id`, `prev_event_id`, `content_sha256`, and `op_committed`.
- Add deterministic golden packet fixtures with normalized volatile fields.
- Add projection consistency checks that detect orphaned side artifacts lacking committed graph events.
