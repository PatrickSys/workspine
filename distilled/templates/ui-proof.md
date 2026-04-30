# UI Proof Bundle Template

Use this template when work affects rendered UI or when a plan defines `ui_proof_slots`. Keep the bundle compact, claim-specific, and attached to the relevant phase, quick task, or brownfield change.

UI proof uses the existing closure evidence kinds only: `code`, `test`, `runtime`, `delivery`, and `human`. Screenshots, traces, videos, reports, accessibility scans, Gherkin, visual diffs, and manual notes are artifact types or activities that map onto those evidence kinds. They are not new evidence kinds.

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
    environment:
      app_url: "http://localhost:3000"
      data_state: "synthetic or seeded data"
    viewport:
      width: 1280
      height: 720
      notes: "Use project default unless responsive behavior is part of the claim."
    manual_acceptance_required: false
    claim_limit: "Does not prove cross-browser layout, full accessibility conformance, production delivery, or unrelated UI states."
no_ui_proof_rationale: null
```

Slot rules:
- Keep each slot tied to one exact UI claim.
- Use the lightest proof that can catch a botched rendered experience for that claim.
- Source annotations, AST/cAST findings, semantic search hits, comments, and Semble-like retrieval may help discover proof obligations. They are discovery hints only; they do not satisfy proof slots.
- Do not add Playwright, Cypress, Storybook, Cucumber, CI, browser MCP, or visual-regression tooling by default.
- Human approval is required for visual taste, accessibility judgment, baseline acceptance, subjective polish/layout quality, and privacy publication decisions.
- Human approval does not replace required non-human evidence when the slot requires `code`, `test`, `runtime`, or `delivery` evidence.

## Observed Proof Bundle

Create or update this bundle during execution or verification when planned UI proof slots exist. JSON is the canonical machine-readable proof bundle format. Markdown proof files must include fenced JSON for deterministic validation.

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
    "browser": "project default or manual browser",
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
    "tools_used": ["manual"]
  },
  "commands_or_manual_steps": [
    {
      "command": "npm run test:e2e -- changed-flow.spec.ts",
      "exit_code": 0,
      "result": "passed",
      "attempts": 1
    },
    {
      "manual_step": "Open /example as synthetic user and complete the changed interaction.",
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
      "artifact_refs": ["test-results/changed-flow-report/index.html"],
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
    }
  ],
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
    }
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

## Deterministic Validation

Use `gsdd ui-proof validate <path>` on JSON proof-bundle metadata or markdown fenced JSON before relying on a bundle for closure; add `--claim <public|publication|tracked|delivery|release>` only when validating that stronger proof use. Use `gsdd ui-proof compare <planned-slots-json> [observed-bundle-json ...]` when verifying planned proof slots against observed bundles through the deterministic product-facing path. Required observed-bundle top-level fields are `proof_bundle_version`, `scope`, `route_state`, `environment`, `viewport`, `evidence_inputs`, `commands_or_manual_steps`, `observations`, `artifacts`, `privacy`, `result`, and `claim_limits`. The validator checks required bundle and observation fields, structured command/manual-step entries, fixed evidence kinds, `result.claim_status`, observation `result`, comparison statuses, non-empty claim limits, locked artifact and observation privacy fields, observation-to-artifact references, workspace-relative/http(s) artifact references, and explicit public/tracked/delivery proof claims that rely on local-only, unsafe, unsanitized, or privacy-contradictory artifacts. `claim_status`, observation `result`, and command/manual-step `result` use `passed`, `failed`, `partial`, `waived`, `deferred`, or `not_applicable`. It is metadata-only and does not inspect raw screenshot, trace, video, DOM, or report contents.

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
