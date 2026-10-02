# Evaluation lanes

`native-brownfield/` is the only Phase 16 claim-producing evaluator. It runs one content-bound,
native Codex brownfield journey and grades final state with a provider-independent oracle.

The older top-level `phase16-*` files and `cases/itsdangerous-*` are preserved historical regression
and forensic evidence. They must not be extended or used for a new relaunch claim.

The evaluator is maintainer tooling under `tests/`; it is not included in the npm package and is not
a Workspine consumer command.

The native journey adds a plain-request case (default `buildPrompts()`; `plainRequest: false` retains the named-lane case): its first prompt names neither a lane nor a skill.
The harness sends owner approval in chat; the agent chooses and records the plan path. The read-only
lane grader snapshots the recorded identity after planning; the approval grader checks state path, identity, owner reference, and approved byte hash before a fresh
session continues. Wrong or missing selections and preapproval stop as task-red with a qualified early receipt prefix; malformed or unreadable state remains protocol-invalid. Approval is state-only for brownfield, and the observer checks the presented CHANGE.md hash as well as the approved hash. An approval-turn identity or plan edit stops as task-red before execution with its actual owner-turn receipt. The complete successful receipt chain remains required for passing product claims. Freeze new prompts
for each candidate; old frozen prompts do not measure lane discovery. Run provider-free checks with
`node --test tests/evals/native-brownfield/native-brownfield.test.mjs`. No provider run is implied.
