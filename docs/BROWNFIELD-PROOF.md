# Brownfield Proof

This is the strongest tracked public proof for Workspine's release-floor claim: a real brownfield-style consumer repo that ran the shipped workflow contract under Codex CLI, hit a real failure, and recovered through the same `plan -> execute -> verify` loop.

## What the proof pack produced

In a fresh consumer repo, Workspine produced:

- durable planning artifacts
- runnable workflow entry surfaces
- a concrete phase plan
- a real execution summary
- a failed verification
- a real fix
- a successful re-verification

That proves the repo-native delivery contract is not just conceptual.

## Public proof pack

Open the tracked proof pack:

- [Consumer proof pack index](proof/consumer-node-cli/README.md)

Key exported artifacts:

- [brief.md](proof/consumer-node-cli/brief.md)
- [SPEC.md](proof/consumer-node-cli/SPEC.md)
- [ROADMAP.md](proof/consumer-node-cli/ROADMAP.md)
- [01-01-PLAN.md](proof/consumer-node-cli/phases/01-foundation/01-01-PLAN.md)
- [01-01-SUMMARY.md](proof/consumer-node-cli/phases/01-foundation/01-01-SUMMARY.md)
- [01-VERIFICATION.md](proof/consumer-node-cli/phases/01-foundation/01-VERIFICATION.md)

## The worked flow

### 1. Initialize a fresh consumer repo

The exported proof pack comes from a new non-framework project that used the shipped `gsdd init` flow.

The generated surface included:

- portable `.agents/skills/work-*`
- consumer `.work/` state
- a Codex-native checker adapter
- a compact consumer `AGENTS.md`

### 2. Plan real work

The consumer brief required a named greeting:

- `node index.js --name Ada` should print `Hello, Ada!`

That requirement is preserved in the exported [brief](proof/consumer-node-cli/brief.md), [spec](proof/consumer-node-cli/SPEC.md), and [phase plan](proof/consumer-node-cli/phases/01-foundation/01-01-PLAN.md).

### 3. Execute and hit a real miss

The first implementation missed the named-greeting requirement:

- `node index.js --name Ada` returned `Hello, world!`

That miss is preserved in the exported [verification report](proof/consumer-node-cli/phases/01-foundation/01-VERIFICATION.md).

### 4. Verify, fix, and re-verify

The consumer repo then followed the same framework contract to:

- identify the failed requirement
- update the implementation and test path
- re-run verification
- close with a passing result

The final passing behavior is:

- `node index.js --name Ada` returns `Hello, Ada!`

## Why this matters

This proof is stronger than a polished README claim because it shows the exact behavior Workspine is trying to preserve:

- plan from durable artifacts
- execute against real repo state
- let verification catch a real miss
- recover without losing the thread

That is the release-floor claim in practice.

## What this does not prove

This proof does not claim:

- an end-to-end run on any runtime other than Codex CLI
- equal runtime ergonomics across every supported runtime
- parity validation on Cursor, Copilot, or Gemini CLI
- enterprise-hardening or orchestration-platform behavior

Those are outside the current proof floor.
