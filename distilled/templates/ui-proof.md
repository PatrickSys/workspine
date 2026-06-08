# UI Proof Bundle Template

Use this template when work affects rendered UI or when a plan defines `ui_proof_slots`. Keep the bundle compact, claim-specific, and attached to the relevant phase, quick task, or brownfield change.

UI proof uses the existing closure evidence kinds only: `code`, `test`, `runtime`, `delivery`, and `human`. Screenshots, traces, videos, reports, accessibility scans, Gherkin, visual diffs, and manual notes are artifact types or activities that map onto those evidence kinds. They are not new evidence kinds.

For live rendered UI evidence, default to `agent-browser`: open the route, capture an interactive snapshot/refs when interaction is part of the claim, exercise the changed flow, capture screenshots for the planned viewport(s), and record console/network observations when they affect the claim. If the repo already has Playwright tests or a package script wrapping them, those remain the canonical repeatable regression path; use them as `test` evidence and use `agent-browser` for complementary live runtime proof. Do not introduce new Playwright, Cypress, Storybook, CI, browser MCP, or visual-regression infrastructure just to satisfy this template. Use Playwright scripting only for checks `agent-browser` cannot cover cleanly, such as JS-disabled behavior, structured console listeners, or multi-context testing.

Tool availability is part of the proof record. In runtimes where `agent-browser` is not available, first state that availability constraint, then use the closest project-native interactive browser path and record the fallback in `evidence_inputs.tools_used`, `commands_or_manual_steps`, and `claim_limits`. A fallback can support a narrowed local runtime claim, but it must not silently pretend that the default `agent-browser` path ran.

## Planned Proof Slots

Every UI-sensitive plan needs either at least one slot under `ui_proof_slots` or an explicit `no_ui_proof_rationale` explaining why no rendered UI proof is required.

```yaml
ui_proof_slots:
  - slot_id: ui-01
    requirement_id: REQ-01
    claim: "User can complete the changed flow without a broken rendered UI."
    route_state: "/example route, role, data state, and UI state to inspect"
    required_evidence_kinds: [test, runtime]
    optional_evidence_kinds: [human]
    minimum_observations:
      - "Changed control is visible and usable in the stated state."
      - "Expected interaction completes without console/runtime error."
    expected_artifact_types: [screenshot, report]
    validation_command: "gsdd ui-proof compare {work_item_dir}/ui-proof-slots.json {work_item_dir}/UI-PROOF.md"
    environment:
      app_url: "http://localhost:3000"
      data_state: "synthetic or seeded data"
    viewport:
      width: 1280
      height: 720
      notes: "State why this viewport is enough for the claim, or add separate slots/observations for mobile, desktop, or responsive states."
    manual_acceptance_required: false
    claim_limit: "Does not prove cross-browser layout, full accessibility conformance, production delivery, or unrelated UI states."
    runtime_capture_requirements:
      provider_preference: [agent-browser, direct-cdp]
      fallback_policy: "record_availability_and_narrow_claim"
      required_modes: [screenshot, interactive_snapshot]
      optional_modes: [selected_element_dom, computed_style, console_delta, network_delta, framework_state]
      budgets:
        text_bytes_max: 24000
        estimated_tokens_max: 6000
        raw_artifact_bytes_max: 5000000
        screenshot_count_max: 4
        computed_style_properties_max: 80
no_ui_proof_rationale: null
```

Slot rules:
- Keep each slot tied to one exact UI claim.
- Use the lightest proof that can catch a botched rendered experience for that claim.
- Specify the route/state, viewport choice, minimum observations, expected artifact types, and runnable validation path tightly enough that a checker can reject vague proof before execution.
- The planner chooses the viewport set, but the slot must explain the choice. Include desktop and mobile proof when the claim covers responsive layout or when the changed surface is likely to behave differently across those sizes; otherwise narrow the claim limit.
- Source annotations, AST/cAST findings, semantic search hits, comments, and Semble-like retrieval may help discover proof obligations. They are discovery hints only; they do not satisfy proof slots.
- Do not add Playwright, Cypress, Storybook, Cucumber, CI, browser MCP, or visual-regression tooling by default.
- Add optional `runtime_capture_requirements` only when the slot needs benchmarkable browser-provider or capture-cost proof; omit it for ordinary UI proof that can be compared by the base slot fields.
- Human approval is required for visual taste, accessibility judgment, baseline acceptance, subjective polish/layout quality, and privacy publication decisions.
- Human approval does not replace required non-human evidence when the slot requires `code`, `test`, `runtime`, or `delivery` evidence.

## Observed Proof Bundle

Create or update this bundle during execution or verification when planned UI proof slots exist. JSON is the canonical machine-readable proof bundle format. Markdown proof files must include fenced JSON for deterministic validation.

Replace placeholders such as `{work_item_dir}` with the current phase, quick-task, or brownfield-change directory before running commands or validating the bundle.

```json
{
  "proof_bundle_version": 1,
  "scope": {
    "work_item": "phase-or-quick-or-brownfield-id",
    "requirement_ids": ["REQ-01"],
    "slot_ids": ["ui-01"],
    "claim": "User can complete the changed flow without a broken rendered UI."
  },
  "route_state": {
    "route": "/example",
    "state": "role, data state, feature flag, loading/error/empty state, or component story"
  },
  "environment": {
    "app_url": "http://localhost:3000",
    "browser": "agent-browser default; record fallback when unavailable",
    "browser_version": "record if known",
    "os": "record if relevant",
    "data_state": "synthetic or seeded data"
  },
  "viewport": {
    "width": 1280,
    "height": 720,
    "device_scale_factor": "record if relevant"
  },
  "evidence_inputs": {
    "kinds": ["test", "runtime"],
    "tools_used": ["playwright", "agent-browser"]
  },
  "commands_or_manual_steps": [
    {
      "command": "npm run test:e2e -- changed-flow.spec.ts",
      "exit_code": 0,
      "result": "passed",
      "attempts": 1
    },
    {
      "command": "agent-browser open http://localhost:3000/example && agent-browser snapshot -i && agent-browser screenshot {work_item_dir}/artifacts/example-1280.png --full",
      "result": "passed",
      "attempts": 1
    },
    {
      "manual_step": "Using agent-browser refs, complete the changed interaction as a synthetic user and check for visible breakage or relevant console/network failures.",
      "result": "passed"
    }
  ],
  "observations": [
    {
      "observation": "Changed control is visible and completes the flow.",
      "claim": "User can complete the changed flow without a broken rendered UI.",
      "route_state": {
        "route": "/example",
        "state": "role, data state, feature flag, loading/error/empty state, or component story"
      },
      "evidence_kind": "runtime",
      "artifact_refs": ["test-results/changed-flow-report/index.html", "{work_item_dir}/artifacts/example-1280.png"],
      "privacy": {
        "data_classification": "synthetic",
        "raw_artifacts_safe_to_publish": false,
        "retention": "temporary_review"
      },
      "result": "passed",
      "claim_limit": "Does not prove Safari/WebKit behavior."
    }
  ],
  "artifacts": [
    {
      "path": "test-results/changed-flow-report/index.html",
      "type": "report",
      "visibility": "local_only",
      "retention": "temporary_review",
      "sensitivity": "possible",
      "safe_to_publish": false,
      "notes": "Local report only; not public proof."
    },
    {
      "path": "{work_item_dir}/artifacts/example-1280.png",
      "type": "screenshot",
      "visibility": "local_only",
      "retention": "temporary_review",
      "sensitivity": "possible",
      "safe_to_publish": false,
      "notes": "Local screenshot only; not public proof unless sanitized and reclassified."
    }
  ],
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
        "screenshot_count": 1,
        "token_estimate_method": "not_applicable",
        "result": "passed"
      },
      {
        "mode": "interactive_snapshot",
        "slot_ids": ["ui-01"],
        "latency_ms": 180,
        "raw_bytes": 0,
        "text_bytes": 2200,
        "estimated_tokens": 550,
        "token_estimate_method": "rough_char_div_4",
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
  },
  "privacy": {
    "data_classification": "synthetic",
    "redactions": [],
    "raw_artifacts_safe_to_publish": false,
    "retention": "Keep metadata bundle; keep raw artifacts only while needed for review or failed proof triage."
  },
  "manual_acceptance": {
    "required": false,
    "reviewer": null,
    "result": "not_applicable"
  },
  "result": {
    "claim_status": "passed",
    "comparison_status_by_slot": {
      "ui-01": "satisfied"
    },
    "failure_classification": null
  },
  "claim_limits": [
    "Does not prove Safari/WebKit behavior.",
    "Does not prove full WCAG conformance.",
    "Does not prove deployed production behavior."
  ]
}
```

Bundle rules:
- Reference raw screenshots, traces, videos, DOM snapshots, reports, accessibility scans, Gherkin, and visual diffs by path or link. Do not store raw binary or sensitive artifacts inline.
- Each observation must identify the claim, route/state, evidence kind, artifact references behind it, privacy metadata, result, and claim limit it supports.
- Every observation `artifact_refs` value must match an `artifacts[].path` or `artifacts[].url` value.
- Artifact count is never proof. Unsupported or weakly linked artifacts are `partial`, `missing`, `waived`, or `deferred`, not `satisfied`.
- Each artifact must record the locked privacy fields `visibility`, `retention`, `sensitivity`, and `safe_to_publish`.
- Raw screenshots, traces, videos, DOM snapshots, and reports default to `visibility: local_only` plus `safe_to_publish: false` unless explicitly classified as sanitized and safe to publish.
- Local-only or `safe_to_publish: false` artifacts can support local review only; they must not back tracked, public, delivery, release, or publication proof claims.
- Human acceptance may close a narrowed claim only by recording waiver, deferment, or proof debt; it must not upgrade missing or mismatched non-human proof to `satisfied`.
- Quick-mode UI proof should use deterministic synthetic IDs such as `quick-001` and `quick-001-ui-01` when roadmap requirement IDs do not exist.
- Classify failed UI proof using existing GSDD gap/proof-debt language: `product_bug`, `missing_infra`, `flaky_harness`, or `ambiguous_spec`. Do not add new result statuses or evidence kinds for those causes.

## Runtime Capture Benchmarks

Use `runtime_capture_requirements` on planned slots and `runtime_capture` on observed bundles to benchmark browser evidence only when the claim needs provider choice, capture fidelity, or cost to be measurable. These fields are optional and metadata-only; existing proof bundles remain valid without them.

Provider chain:
- Default live UI proof remains `agent-browser`.
- Use direct-CDP only as an explicit escalation for selected-element DOM, CSS, computed-style, console, network, or framework-state claims that the default path cannot prove cleanly.
- Chrome DevTools MCP and Playwright MCP are optional only when already configured, scoped to the claim, and recorded as fallback metadata.
- Do not add browser tooling, browser installs, CI, Storybook, browser MCP, or visual-regression infrastructure just to fill these fields.

Stable capture modes are `screenshot`, `interactive_snapshot`, `accessibility_snapshot`, `dom_subset`, `selected_element_dom`, `computed_style`, `console_delta`, `network_delta`, `framework_state`, and `manual_observation`. Provider availability statuses are `available`, `unavailable`, `not_configured`, `skipped`, and `failed`.

Budget fields are `text_bytes_max`, `estimated_tokens_max`, `raw_artifact_bytes_max`, `screenshot_count_max`, `computed_style_properties_max`, `console_event_count_max`, and `network_event_count_max`. The comparator enforces them only when a planned slot declares them.

Keep raw screenshots, traces, videos, DOM, reports, console/network logs, and framework-state captures referenced as local artifacts or summarized metadata; do not inline raw sensitive state. Claims that a research, deepening, or document-review pass used a pinned model such as `gpt-5.4-high` need runtime model-routing evidence before the proof bundle can claim that review actually ran.

## Deterministic Validation

Use `gsdd ui-proof validate <path>` on JSON proof-bundle metadata or markdown fenced JSON before relying on a bundle for closure; add `--claim <public|publication|tracked|delivery|release>` only when validating that stronger proof use. Use `gsdd ui-proof compare <planned-slots-json> [observed-bundle-json ...]` when verifying planned proof slots against observed bundles through the deterministic product-facing path. Required planned-slot fields are `slot_id`, `claim`, `route_state`, `required_evidence_kinds`, `minimum_observations`, `expected_artifact_types`, `validation_command`, `environment`, `viewport`, `manual_acceptance_required`, and `claim_limit`. Required observed-bundle top-level fields are `proof_bundle_version`, `scope`, `route_state`, `environment`, `viewport`, `evidence_inputs`, `commands_or_manual_steps`, `observations`, `artifacts`, `privacy`, `result`, and `claim_limits`. Optional `runtime_capture_requirements` and `runtime_capture` metadata is validated when present and compared only for slots that opt in. The validator checks planned-slot specificity, runtime capture modes, provider availability statuses, budget metric fields, required bundle and observation fields, structured command/manual-step entries, fixed evidence kinds, concise `tools_used` IDs, `result.claim_status`, observation `result`, comparison statuses, failure classification for failed/partial proof, non-empty claim limits, locked artifact and observation privacy fields, observation-to-artifact references, workspace-relative/http(s) artifact references, existing local artifact paths when validating from files, and explicit public/tracked/delivery proof claims that rely on local-only, unsafe, unsanitized, or privacy-contradictory artifacts. `claim_status`, observation `result`, runtime capture `result`, and command/manual-step `result` use `passed`, `failed`, `partial`, `waived`, `deferred`, or `not_applicable`; failed/partial proof uses `product_bug`, `missing_infra`, `flaky_harness`, or `ambiguous_spec`. It does not inspect raw screenshot, trace, video, DOM, or report contents and does not require any specific browser provider such as `agent-browser`.

## Comparison Statuses

Use these statuses when comparing planned slots to observed proof:

| Status | Meaning | Claim impact |
| --- | --- | --- |
| `satisfied` | Required observations and evidence kinds are present, scoped, and inspectable for the exact claim. | Supports the scoped UI claim. |
| `partial` | Some proof exists, but observations, artifact references, evidence kinds, privacy metadata, or assurance are weaker than planned. | Record a reduced claim or gap. |
| `missing` | Required proof is absent. | Blocks the UI claim unless explicitly waived or deferred. |
| `waived` | A human or approved plan waiver accepts the risk. | Does not prove the UI claim. |
| `deferred` | Proof moved to later work. | Current work must not claim the UI behavior is proven. |
| `not_applicable` | Accepted rationale says no UI proof is required. | No UI proof gap for that claim. |

Proof debt notes should name the slot, claim, route/state, missing or weak linkage, human acceptance basis, narrowed claim limit, and follow-up trigger.

## Claim Boundary

A UI proof bundle proves only the scoped claim, route/state, environment, viewport, observations, and evidence kinds it records. It does not imply broad visual quality, cross-browser coverage, full accessibility conformance, production delivery, release readiness, or public proof unless those dimensions are explicitly planned, evidenced, and classified safe to publish.
