# `gsdd next` Continuity Roadmap

Status: implemented locally, including the installability dogfood follow-up.

## Phases

- [x] **Phase 1: `.work` Bootstrap and Goal Contract** - establish `.work` as canonical continuity state while keeping `.planning` readable.
- [x] **Phase 2: Continuity Graph Core** - add append-only JSONL graph events and deterministic index rebuild.
- [x] **Phase 3: `gsdd next` Router** - emit next-action packets across all allowed states.
- [x] **Phase 4: Questions, Decisions, and Handoff** - persist durable interrupts, decisions, and return-later context.
- [x] **Phase 5: Dogfood and Gap-Fix Loop** - route verified/audited work through dogfood and fix-gap states.
- [x] **Phase 6: Harness Evals and Trust Boundaries** - cover fixture states, traceability, skipped inputs, and trust gates.
- [x] **Phase 7: Easy Global Install Auto Mode** - make `install --global --auto` the one-command detected global install path routed through the existing manifest-safe global installer, with `--tools` as the explicit override, and harden lifecycle preflight so `.work/milestone` packets do not collide with unrelated `.planning` phases.

## Requirement Coverage

- Phase 1: WORK-01, COMPAT-01, PRIVACY-01
- Phase 2: GRAPH-01, TRACE-01, DECISION-01
- Phase 3: NEXT-01, FLOW-01, EVAL-01
- Phase 4: QUESTION-01, INTERRUPT-01, DECISION-01
- Phase 5: DOGFOOD-01, FLOW-01
- Phase 6: TRUST-01, EVAL-01, TRACE-01
- Phase 7: INSTALL-AUTO-01, INSTALL-SAFETY-01, WORK-LIFECYCLE-01

## Closure Limit

This roadmap proves the local file-backed `gsdd next` v1 plus the planned one-command global install auto mode. It does not claim transcript memory, hosted memory, provider-specific browser proof, automatic execution, URL-based installers, or unmanaged user-home writes.
