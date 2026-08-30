# Evaluation lanes

`native-brownfield/` is the only Phase 16 claim-producing evaluator. It runs one content-bound,
native Codex brownfield journey and grades final state with a provider-independent oracle.

The older top-level `phase16-*` files and `cases/itsdangerous-*` are preserved historical regression
and forensic evidence. They must not be extended or used for a new relaunch claim.

The evaluator is maintainer tooling under `tests/`; it is not included in the npm package and is not
a Workspine consumer command.
