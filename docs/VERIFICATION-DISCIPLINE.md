# Verification Discipline

Workspine is not just a set of prompts. Its core delivery claim depends on explicit checking and verification loops that survive across runtimes.

AI output is cheap enough that the scarce part is often proof: whether the change fits the codebase, whether the right behavior is wired in, and whether the remaining risk is visible to a human reviewer. Workspine treats that proof as part of the workflow, not as an optional cleanup note.

## The delivery contract

The durable loop is:

`init -> plan -> execute -> verify`

Within that loop, the framework preserves two important review seams.

### 1. Plan checking

`work-plan` does not stop at "write a plan."

It includes a review loop where the plan is checked against concrete dimensions such as:

- requirement coverage
- task completeness
- dependency correctness
- scope sanity
- context compliance

On runtimes with stronger native support, that can be a fresh-context checker path. On weaker surfaces, the framework stays honest about reduced assurance instead of pretending the same check happened.

### 2. Verification after execution

`work-verify` uses a three-level gate:

- Exists: the expected artifacts are present
- Substantive: the output is real, not empty or stubbed
- Wired: the behavior is connected and actually works

This is paired with anti-pattern checks so "files exist" does not get mistaken for "the work is done."

## Anti-false-closure in practice

The exported brownfield proof pack demonstrates the intended behavior:

- the first implementation missed a real requirement
- verification caught it
- the repo then recorded the fix and the successful re-verification

See `docs/BROWNFIELD-PROOF.md` for the reader-facing narrative and `docs/proof/consumer-node-cli/README.md` for the tracked artifact chain.

## What this note does and does not claim

This note explains the release-floor discipline that Workspine can prove publicly in this release.

It does **not** claim:

- perfect parity of checker mechanics on every runtime
- autonomous orchestration platform behavior
- proof of every possible brownfield workflow shape

It claims something narrower and more defensible:

Workspine keeps a repo-native delivery contract with explicit review and verification seams, and that contract is already strong enough to catch and recover from real misses.
