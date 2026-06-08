---
title: Browser Proof Benchmark Annotations
type: feat
status: active
date: 2026-06-08
origin: local goal handoff
---

# Browser Proof Benchmark Annotations

## Overview

Add benchmarkable browser-runtime capture annotations to Workspine's existing UI proof contract. The first implementation should not build a managed browser sidecar or a framework-specific Angular inspector. It should extend the provider-neutral proof metadata so execution and verification can record what browser evidence was collected, which provider path was used, what it cost, and what it could not prove.

This keeps the first slice aligned with the current Workspine architecture: `agent-browser` remains the default live UI proof path, provider-specific tools remain optional, raw artifacts stay local-only by default, and deterministic validation continues to inspect metadata instead of raw screenshots, traces, DOM dumps, or reports.

## Problem Frame

Agents can overclaim frontend completion when they only inspect source code, static tests, or screenshots without structured claim linkage. Workspine already has UI proof slots and observed proof bundles, but the current metadata does not make the browser-provider thesis measurable in-flight. In practice, snapshots can be heavy, screenshots may be necessary for visual truth, Chrome/CDP paths can be powerful but expensive or privacy-sensitive, and MCP wrappers should not become default infrastructure by accident.

This plan makes each provider path and capture mode comparable while preserving the current proof boundary: browser artifacts support existing evidence kinds; they do not create new evidence kinds.

## Requirements Trace

- R1. Preserve the existing five evidence kinds: `code`, `test`, `runtime`, `delivery`, and `human`.
- R2. Keep `agent-browser` as the default live rendered UI proof path in documentation and agent guidance.
- R3. Add optional metadata for provider selection, fallback path, capture modes, budgets, latency, text size, token estimate, artifact size, fidelity, and privacy posture.
- R4. Do not require Chrome DevTools MCP, Playwright MCP, new browser installs, CI, Storybook, or visual-regression infrastructure.
- R5. Validate new browser benchmark annotations deterministically when present, while keeping existing proof bundles valid.
- R6. Compare planned capture requirements to observed capture metadata when a planned UI proof slot opts into runtime capture requirements.
- R7. Keep raw screenshots, traces, videos, DOM snapshots, and reports local-only and unsafe to publish unless explicitly sanitized.
- R8. Document the provider chain: `agent-browser` primary, direct CDP attach as escalation, Chrome DevTools MCP and Playwright MCP only when already configured, browser launch only with explicit opt-in.
- R9. Record the `gpt-5.4-high` research/deepening model requirement as a planning constraint; do not claim model-pinned subagent research ran unless runtime routing can prove it.

## Scope Boundaries

- Do not implement live direct-CDP capture in this first slice.
- Do not add a new browser automation dependency.
- Do not introduce a new evidence kind such as `visual` or `browser`.
- Do not make Angular a required dependency or special-case validator path.
- Do not treat screenshots, snapshots, traces, DOM dumps, or framework state as verdicts by themselves.
- Do not change release, delivery, or public-proof privacy requirements.

### Deferred to Separate Tasks

- Live direct-CDP capture provider: separate feature after the proof contract can benchmark providers.
- Angular runtime adapter: separate feature after generic selected-element and framework-state metadata exists.
- Aggregated local metrics history across proof bundles: separate feature if per-bundle annotations prove useful.
- General model routing for arbitrary research and document-review subagents: separate model-orchestration feature. This plan only records the constraint and avoids model-unpinnable subagent claims.

## Context & Research

### Relevant Code and Patterns

- `distilled/templates/ui-proof.md` defines planned UI proof slots, observed proof bundles, privacy defaults, and deterministic validation guidance.
- `bin/lib/ui-proof.mjs` validates UI proof metadata and compares planned slots to observed bundles without inspecting raw artifact contents.
- `distilled/workflows/plan.md`, `distilled/workflows/execute.md`, `distilled/workflows/verify.md`, and `distilled/workflows/quick.md` already describe `agent-browser` as the default runtime proof path and Playwright tests as repeatable regression evidence.
- `agents/planner.md`, `agents/executor.md`, and `agents/verifier.md` mirror those workflow contracts for installed agent surfaces.
- `tests/phase.test.cjs` contains UI proof validation and compare behavior tests.
- `tests/gsdd.guards.test.cjs` contains locked guard tests for the UI proof contract, including provider-agnostic validation and the `agent-browser` default.
- `bin/lib/models.mjs` only exposes portable agent model config for `plan-checker` and `approach-explorer`; it does not currently provide general model-pinned research subagent routing.
- Local goal handoff captured sibling-repo browser-intent and ideaspine context used as origin material for this plan.

### Institutional Learnings

- Keep UI proof scoped to a claim, route/state, viewport, evidence kind, artifact link, privacy metadata, result, and claim limit.
- Artifact count is not proof.
- Raw UI artifacts default to local-only and unsafe.
- A fallback browser tool can support a narrowed local runtime claim, but it must not pretend the default path ran.
- Browser snapshots can become token-heavy; proof collection must be targeted and budgeted.
- Queryable targeted state beats dumping full DOM or component trees.
- Screenshots are evidence, not a verdict.
- Human acceptance is required for subjective visual taste, baseline acceptance, and privacy publication decisions, but it does not replace missing non-human evidence.

### External References

- Existing Workspine source references are tracked in `distilled/EVIDENCE-INDEX.md`.
- This plan relies on the repo's recorded browser proof references there rather than introducing a new external dependency.

## Key Technical Decisions

- Add optional `runtime_capture` metadata to observed proof bundles: This keeps old bundles valid while allowing new bundles to record provider, cost, fidelity, and capture-mode data.
- Add optional `runtime_capture_requirements` to planned UI proof slots: Planned slots opt into benchmark enforcement only when the proof claim needs it.
- Validate shape separately from proof sufficiency: `gsdd ui-proof validate` should reject malformed benchmark annotations; `gsdd ui-proof compare` should decide whether observed capture satisfies planned capture requirements.
- Keep provider IDs open but syntactically constrained: Use the existing concise tool-ID pattern instead of hard-coding a provider enum into validation.
- Keep capture modes enumerated: Capture modes need stable names so costs and fidelity can be compared across providers.
- Treat budget overruns as comparison failures only when a plan declares budgets: Existing proof bundles should not become invalid just because they lack budget metadata.
- Keep screenshots as actual artifact paths: The proof bundle should reference screenshot files and metadata, not inline binary data or a screenshot transcript.
- Direct CDP is an escalation strategy, not the default: It is powerful for DOM/CSS/computed-style evidence, but the first Workspine feature should measure provider paths before owning browser lifecycle.

## Open Questions

### Resolved During Planning

- Should Playwright MCP be the first-class default? No. Prior local context warned that snapshot cost can exceed practical phase-exit budgets, and current Workspine docs already default to `agent-browser`.
- Should Chrome DevTools MCP be the default? No. It is useful for deep debugging, but it has profile, privacy, and provider-lock risks and should be optional when already configured.
- Should V1 build Angular inspection? No. V1 should admit optional framework-state evidence without requiring Angular.
- Should the validator inspect raw screenshot pixels or DOM contents? No. Workspine's validator remains metadata-focused and provider-neutral.

### Deferred to Implementation

- Exact default numeric budgets: Implementation should start with conservative documented defaults and adjust only with tests and sample bundles.
- Exact token-estimation method: The first implementation can record `estimated_tokens` plus `token_estimate_method`; exact tokenizer parity is not required for metadata comparison.
- Exact capture-mode names after implementation touch: The list below is directional and should be finalized in constants when editing `bin/lib/ui-proof.mjs`.
- Whether comparison returns warnings or partial status for non-budget fidelity gaps: Implementation should follow existing `compareUiProofSlots` style and avoid weakening current blockers.

## High-Level Technical Design

> This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

Add optional planned-slot metadata:

```json
{
  "runtime_capture_requirements": {
    "provider_preference": ["agent-browser", "direct-cdp"],
    "fallback_policy": "record_availability_and_narrow_claim",
    "required_modes": ["screenshot", "interactive_snapshot"],
    "optional_modes": ["selected_element_dom", "computed_style", "console_delta", "network_delta", "framework_state"],
    "budgets": {
      "text_bytes_max": 24000,
      "estimated_tokens_max": 6000,
      "raw_artifact_bytes_max": 5000000,
      "screenshot_count_max": 4,
      "computed_style_properties_max": 80,
      "console_event_count_max": 50,
      "network_event_count_max": 50
    }
  }
}
```

Add optional observed-bundle metadata:

```json
{
  "runtime_capture": {
    "provider": {
      "primary": "agent-browser",
      "selected": "agent-browser",
      "fallback_chain": ["agent-browser", "direct-cdp", "chrome-devtools-mcp", "playwright-mcp", "manual"],
      "fallback_reason": null,
      "availability": [
        { "provider": "agent-browser", "status": "available" }
      ]
    },
    "captures": [
      {
        "mode": "screenshot",
        "slot_ids": ["ui-01"],
        "artifact_refs": ["{work_item_dir}/artifacts/example-1280.png"],
        "latency_ms": 420,
        "raw_bytes": 184224,
        "text_bytes": 0,
        "estimated_tokens": 0,
        "token_estimate_method": "not_applicable",
        "result": "passed"
      }
    ],
    "fidelity": {
      "sees_pixels": true,
      "includes_accessibility_tree": true,
      "includes_dom_subset": false,
      "includes_computed_styles": false,
      "includes_framework_state": false,
      "claim_limits": ["No selected-element computed style capture was required for this slot."]
    }
  }
}
```

Provider chain to document and benchmark:

| Provider path | Default role | Screenshot support | DOM/CSS depth | Main cost/risk | V1 treatment |
| --- | --- | --- | --- | --- | --- |
| `agent-browser` | Primary live UI proof path | Yes | Snapshot/refs, tool-dependent | Availability and snapshot size | Default in docs and examples |
| `direct-cdp` | Escalation | Yes | Deep DOM, CSS, runtime, network, logs | Approved browser profile and implementation complexity | Metadata-supported, live provider deferred |
| `chrome-devtools-mcp` | Optional configured deep-debug path | Yes | Deep DevTools surface | Profile/privacy/tool lock | Record only when already configured |
| `playwright-mcp` | Optional configured snapshot path | Yes | Accessibility snapshot oriented | Snapshot token cost and setup lock | Record only when already configured |
| `manual` | Last fallback or subjective judgment | Human-dependent | Human-dependent | Low automation assurance | Can waive, defer, or narrow claims only |

Initial capture-mode vocabulary:

| Mode | Meaning |
| --- | --- |
| `screenshot` | Pixel artifact for the exact route/state/viewport. |
| `interactive_snapshot` | Tool snapshot/refs used to identify and interact with rendered elements. |
| `accessibility_snapshot` | Accessibility-tree or role/name/state structure. |
| `dom_subset` | Scoped DOM structure, not a full page dump. |
| `selected_element_dom` | DOM and attributes for a targeted element or component root. |
| `computed_style` | Bounded computed-style declaration set for selected elements. |
| `console_delta` | Scoped console events observed during the proof window. |
| `network_delta` | Scoped network events observed during the proof window. |
| `framework_state` | Optional framework adapter state, such as Angular ownership or public bound state. |
| `manual_observation` | Human-recorded observation for subjective or fallback claims. |

Initial provider availability statuses: `available`, `unavailable`, `not_configured`, `skipped`, and `failed`.

## Implementation Units

- [ ] **Unit 1: Runtime Capture Metadata Validation**

**Goal:** Add optional validation for `runtime_capture` on observed bundles and `runtime_capture_requirements` on planned slots without changing existing required fields.

**Requirements:** R1, R3, R5, R7

**Dependencies:** None

**Files:**
- Modify: `bin/lib/ui-proof.mjs`
- Test: `tests/phase.test.cjs`

**Approach:**
- Introduce constants for browser capture mode IDs and budget metric field names.
- Introduce constants for provider availability statuses.
- Reuse existing status values where possible: capture `result` should use the current claim statuses.
- Validate provider IDs with the existing concise tool-ID pattern rather than adding provider-specific schema locks.
- Validate numeric metrics as non-negative finite numbers.
- Validate capture `artifact_refs` against declared `artifacts` when present, matching current observation-to-artifact linkage behavior.
- Validate raw artifact privacy through the existing artifact validation path, not through a second privacy system.
- Permit omitted `runtime_capture` and `runtime_capture_requirements` so existing bundles remain valid.

**Patterns to follow:**
- Existing `validateUiProofBundle`, `validateUiProofSlots`, `validateArtifacts`, and `validateObservationArtifactRefs` style in `bin/lib/ui-proof.mjs`.
- Existing invalid-metadata tests around UI proof bundles in `tests/phase.test.cjs`.

**Test scenarios:**
- Happy path: an existing valid proof bundle with no `runtime_capture` remains valid.
- Happy path: a valid bundle with `runtime_capture.provider`, one screenshot capture, and matching artifact refs validates.
- Happy path: a planned slot with `runtime_capture_requirements.required_modes` and budgets validates.
- Edge case: unknown but syntactically valid provider ID validates to preserve provider neutrality.
- Error path: provider ID with spaces or unsupported characters fails validation.
- Error path: capture mode outside the allowed mode list fails validation.
- Error path: provider availability status outside the allowed status list fails validation.
- Error path: negative `latency_ms`, `raw_bytes`, `text_bytes`, or `estimated_tokens` fails validation.
- Error path: capture `artifact_refs` points to an undeclared artifact and fails validation.
- Error path: raw screenshot artifact still fails public/release proof validation unless safe-to-publish metadata is valid.

**Verification:**
- `ui-proof` validation accepts old bundles, accepts valid annotated bundles, and rejects malformed benchmark annotations with actionable error codes.

- [ ] **Unit 2: Planned-vs-Observed Capture Comparison**

**Goal:** Make `gsdd ui-proof compare` evaluate planned runtime capture requirements against observed runtime capture metadata when a slot opts in.

**Requirements:** R3, R5, R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `bin/lib/ui-proof.mjs`
- Test: `tests/phase.test.cjs`

**Approach:**
- Extend slot comparison only when `runtime_capture_requirements` exists on the planned slot.
- Require each planned `required_modes` value to appear in at least one passed observed capture for the slot.
- Compare declared budgets to aggregated observed metrics for captures linked to the slot.
- Treat missing required modes or budget overruns as comparison issues, producing `partial` unless all other comparison logic already yields `missing`.
- Do not fail solely because the selected provider differs from the preferred provider if the observed bundle records availability, fallback reason, and claim limits.
- Do fail or downgrade when an observed fallback silently omits fallback reason and claim narrowing.
- Keep comparison output compatible with current `compareUiProofSlots` result shape.

**Patterns to follow:**
- Existing `compareSlotToBundle` issue construction and `decorateComparisonIssue` behavior in `bin/lib/ui-proof.mjs`.
- Existing phase verification tests for missing, partial, and satisfied UI proof comparison.

**Test scenarios:**
- Happy path: planned screenshot plus interactive snapshot requirements are satisfied by observed passed captures linked to the slot.
- Happy path: selected `direct-cdp` satisfies an `agent-browser` preference when `agent-browser` is recorded unavailable and the fallback reason is present.
- Edge case: optional capture modes are absent and do not block comparison.
- Edge case: captures for another slot do not satisfy the current slot.
- Error path: required `computed_style` capture is missing and comparison reports `partial`.
- Error path: observed `estimated_tokens` exceeds planned budget and comparison reports a budget issue.
- Error path: fallback provider is used without availability/fallback explanation and comparison records a fallback issue.
- Integration: `gsdd verify <phase>` still blocks phase closure when capture requirements are planned but observed capture metadata is absent or partial.

**Verification:**
- Planned capture requirements become deterministic comparison inputs without weakening current slot, route/state, viewport, artifact, privacy, and claim-limit checks.

- [ ] **Unit 3: UI Proof Template and Workflow Guidance**

**Goal:** Update the user-facing UI proof contract so planners, executors, and verifiers know when and how to collect benchmarked browser evidence.

**Requirements:** R2, R3, R4, R7, R8, R9

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `distilled/templates/ui-proof.md`
- Modify: `distilled/workflows/plan.md`
- Modify: `distilled/workflows/execute.md`
- Modify: `distilled/workflows/verify.md`
- Modify: `distilled/workflows/quick.md`
- Modify: `agents/planner.md`
- Modify: `agents/executor.md`
- Modify: `agents/verifier.md`
- Test: `tests/gsdd.guards.test.cjs`

**Approach:**
- Add a compact optional "Runtime Capture Benchmarks" section to `distilled/templates/ui-proof.md`.
- Show benchmark annotations as optional metadata, not as new required top-level fields for every bundle.
- Preserve existing default language: `agent-browser` first, project-native fallback when unavailable, Playwright tests as repeatable regression evidence.
- Add direct-CDP escalation language for selected-element DOM/CSS/computed-style claims without making direct-CDP a required provider.
- State that Chrome DevTools MCP and Playwright MCP are optional only when already configured and scoped to the claim.
- State that `gpt-5.4-high` research/deepening requirements must be proven through runtime model routing before an agent claims such review ran.
- Update installed agent surfaces with the same semantics so generated guidance stays coherent.

**Patterns to follow:**
- Existing wording in `distilled/templates/ui-proof.md` around default `agent-browser`, no new browser infrastructure, privacy defaults, and deterministic validation.
- Existing guard tests that preserve provider-agnostic validation and `agent-browser` default.

**Test scenarios:**
- Guard: docs still name `agent-browser` as the default live UI proof path.
- Guard: docs still prohibit adding Playwright, Cypress, Storybook, browser MCP, CI, or visual-regression tooling by default.
- Guard: docs mention direct-CDP only as an escalation/fallback path, not the default.
- Guard: docs require benchmark annotations to stay provider-neutral and budgeted.
- Guard: docs preserve raw artifact privacy defaults.
- Guard: agent role files mirror the updated provider chain and benchmark posture.

**Verification:**
- The generated guidance tells future agents how to collect screenshots plus targeted snapshots/CSS evidence without turning optional browser providers into default infrastructure.

- [ ] **Unit 4: Design Record and Evidence Index**

**Goal:** Record the architectural decision so future changes cannot reinterpret benchmark annotations as a provider lock or new evidence kind.

**Requirements:** R1, R2, R4, R7, R8

**Dependencies:** Unit 3

**Files:**
- Modify: `distilled/DESIGN.md`
- Modify: `distilled/EVIDENCE-INDEX.md`
- Test: `tests/gsdd.guards.test.cjs`

**Approach:**
- Add a design decision extending the existing UI proof decision with browser runtime capture benchmark annotations.
- Record the selected provider chain and the non-goals.
- Record why live direct-CDP implementation is deferred.
- Record that raw artifacts remain local-only by default.
- Record that validator behavior remains metadata-focused and provider-neutral.
- Add evidence-index entries for this plan, fixtures, and current Workspine files.

**Patterns to follow:**
- Existing decision-entry style in `distilled/DESIGN.md`.
- Existing evidence-index style around UI proof and design decisions.

**Test scenarios:**
- Guard: design docs preserve fixed evidence kinds.
- Guard: design docs preserve provider-neutral validation.
- Guard: design docs record `agent-browser` primary plus direct-CDP escalation without mandating Chrome DevTools MCP or Playwright MCP.
- Guard: evidence index references the new decision and relevant source files.

**Verification:**
- The decision record prevents future agents from treating benchmark metadata as permission to add a default sidecar, provider lock, or new evidence kind.

- [ ] **Unit 5: Local Fixtures and Dogfood Proof Examples**

**Goal:** Add compact example proof bundles and planned slots that demonstrate benchmark annotations without requiring a real browser provider during tests.

**Requirements:** R3, R5, R6, R7, R8

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Create: `fixtures/ui-proof/browser-runtime-capture-slots.json`
- Create: `fixtures/ui-proof/browser-runtime-capture-bundle.json`
- Modify: `tests/phase.test.cjs`
- Modify: `tests/gsdd.guards.test.cjs`

**Approach:**
- Keep fixtures synthetic and local-only.
- Include one satisfied `agent-browser` primary example with screenshot and interactive snapshot captures.
- Include one direct-CDP escalation example for selected-element DOM/CSS/computed-style capture, with explicit fallback reason and claim limits.
- Include no raw DOM dump content in fixtures; use metadata and artifact refs only.
- Use existing test helper patterns rather than adding fixture loaders unless local test conventions justify it.

**Patterns to follow:**
- Existing dogfood UI proof examples embedded in `tests/phase.test.cjs`.
- Existing fixture directory conventions.

**Test scenarios:**
- Happy path: fixture planned slots and observed bundle compare as satisfied.
- Happy path: direct-CDP fallback fixture is accepted because fallback is explicit and claim-limited.
- Error path: mutated fixture with missing screenshot capture produces partial comparison.
- Error path: mutated fixture with public claim backed by local-only screenshot remains invalid.
- Integration: fixture paths remain workspace-relative and do not require real screenshot files unless validation is explicitly run with local-artifact existence checks.

**Verification:**
- Future contributors have a compact, deterministic proof example for benchmark annotations and provider fallback behavior.

- [ ] **Unit 6: CLI Help, Health Messaging, and Backward Compatibility Review**

**Goal:** Make the new optional metadata discoverable without changing the top-level command surface unless implementation proves a command addition is necessary.

**Requirements:** R3, R4, R5, R9

**Dependencies:** Unit 1 through Unit 5

**Files:**
- Modify: `bin/lib/init-runtime.mjs`
- Modify: `bin/lib/rendering.mjs`
- Modify: `bin/lib/health.mjs`
- Modify: `README.md`
- Modify: `docs/USER-GUIDE.md`
- Test: `tests/gsdd.init.test.cjs`
- Test: `tests/gsdd.health.test.cjs`
- Test: `tests/gsdd.guards.test.cjs`

**Approach:**
- Prefer documenting the feature under the existing `ui-proof validate` and `ui-proof compare` commands.
- Avoid adding `gsdd ui-proof benchmark` unless implementation shows the existing command output cannot surface needed comparison issues cleanly.
- Update health fix hints only where malformed benchmark metadata should be actionable.
- Document that model-pinned subagent review claims require actual runtime routing support; otherwise agents should record reduced assurance.
- Preserve current command usage strings and output compatibility.

**Patterns to follow:**
- Existing help rendering in `bin/lib/init-runtime.mjs` and `bin/lib/rendering.mjs`.
- Existing health E10 wording around UI proof metadata.

**Test scenarios:**
- Happy path: `gsdd ui-proof validate` output shape remains compatible for old bundles.
- Happy path: health reports malformed benchmark metadata through existing UI proof metadata failure paths.
- Edge case: project without browser tooling still passes health when no UI proof bundle requires browser capture.
- Guard: help/docs do not imply a new browser provider must be installed.
- Guard: model-pinned research wording does not claim unsupported general subagent routing exists.

**Verification:**
- Users can discover benchmark annotations through existing UI proof docs and commands without a new browser command becoming an accidental product promise.

## System-Wide Impact

- **Interaction graph:** Planned slots feed `gsdd ui-proof compare`; observed bundles feed `gsdd ui-proof validate`, `gsdd ui-proof compare`, `gsdd health`, and `gsdd verify`.
- **Error propagation:** Malformed benchmark metadata should surface as validation errors; unmet planned capture requirements should surface as comparison issues and verification blockers where applicable.
- **State lifecycle risks:** Raw artifacts remain local files referenced by metadata; metadata must not inline screenshots, DOM dumps, traces, or sensitive browser state.
- **API surface parity:** Installed workflow docs and agent role docs must match the source `distilled/` contract.
- **Integration coverage:** Tests must cover direct validation, planned-vs-observed comparison, phase verification, health, guard docs, and old-bundle backward compatibility.
- **Unchanged invariants:** Fixed evidence kinds remain unchanged; `agent-browser` remains the default live runtime path; provider-specific tools remain optional; Playwright tests remain repeatable regression evidence, not a replacement for scoped runtime proof.

## Risks & Dependencies

| Risk | Mitigation |
| --- | --- |
| Benchmark metadata becomes a provider lock | Validate provider ID syntax, not a hard provider enum; document provider neutrality. |
| Metadata becomes too heavy | Store metrics and artifact refs, not raw DOM, screenshots, traces, or full logs. |
| Direct-CDP scope creeps into V1 | Record direct-CDP as escalation metadata only; defer live provider implementation. |
| Existing bundles break | Keep new fields optional and add old-bundle compatibility tests. |
| Compare output becomes noisy | Only enforce capture requirements when planned slots opt in. |
| Privacy rules fork | Reuse existing artifact privacy validation and public-claim checks. |
| Agents claim `gpt-5.4-high` review without proof | Document reduced assurance unless runtime model routing proves the requested model was used. |
| Docs drift from generated surfaces | Update source docs, agent role docs, and guard tests together. |

## Documentation / Operational Notes

- This is not a UI-visible feature, so the implementation plan itself should use `no_ui_proof_rationale` if converted into a `.planning` phase plan.
- Execution should be characterization-first around existing UI proof behavior: add tests that lock old valid bundles before adding new optional metadata.
- The implementation should not run or install browser tooling to satisfy tests.
- If implementation discovers that `runtime_capture` is a poor field name, the replacement must preserve the same boundary: optional, provider-neutral, metadata-only, and budgetable.
- Do not claim independent `gpt-5.4-high` research or document review unless a runtime route exposes model selection and records the model used.

## Plan Review Status

- `ce:plan` was used to produce this plan from the local goal handoff and repo research.
- Independent `document-review` subagents were not spawned because this runtime did not expose a model-selectable route, and the origin directive requires `gpt-5.4-high` for research/deepening subagents.
- Self-review checked scope boundaries, provider-default consistency, fixed evidence kinds, privacy invariants, benchmark vocabulary, test coverage expectations, repo-relative paths, ASCII encoding, and diff hygiene.
- Residual risk: run a model-pinned independent document-review pass before implementation if a runtime route can prove `gpt-5.4-high` was used.

## Sources & References

- Origin capture: local goal handoff retained outside the public PR.
- UI proof template: `distilled/templates/ui-proof.md`
- UI proof validator and comparator: `bin/lib/ui-proof.mjs`
- Planner workflow: `distilled/workflows/plan.md`
- Executor workflow: `distilled/workflows/execute.md`
- Verifier workflow: `distilled/workflows/verify.md`
- Quick workflow: `distilled/workflows/quick.md`
- Agent planner role: `agents/planner.md`
- Agent executor role: `agents/executor.md`
- Agent verifier role: `agents/verifier.md`
- Design record: `distilled/DESIGN.md`
- Evidence index: `distilled/EVIDENCE-INDEX.md`
- Model routing config: `bin/lib/models.mjs`
- UI proof tests: `tests/phase.test.cjs`
- Contract guard tests: `tests/gsdd.guards.test.cjs`
