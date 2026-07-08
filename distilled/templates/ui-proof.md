# Browser Proof Observation Template

Use this template when work affects rendered UI or when a plan sets
`browser_proof_required: true`. Keep the record compact, claim-specific, and
attached to the relevant phase, quick task, or brownfield change.

Browser proof uses the existing closure evidence kinds only: `code`, `test`,
`runtime`, `delivery`, and `human`. Screenshots, traces, videos, reports,
accessibility scans, visual diffs, and manual notes are artifacts or activities
that map onto those evidence kinds. They are not new evidence kinds.

For live rendered UI evidence, default to `agent-browser`: open the route,
capture interactive refs when interaction is part of the claim, exercise the
changed flow, capture screenshots for planned viewport(s), and record
console/network observations when they affect the claim. If the repo already
has Playwright tests or a package script wrapping them, those remain the
repeatable regression path; use them as `test` evidence and use browser
observation for complementary runtime proof.

Do not introduce new Playwright, Cypress, Storybook, CI, browser MCP, or visual
regression infrastructure just to satisfy this template. Use Playwright
scripting only for checks `agent-browser` cannot cover cleanly, such as
JS-disabled behavior, structured console listeners, or multi-context testing.

Tool availability is part of the proof record. In runtimes where
`agent-browser` is not available, first state that availability constraint, then
use the closest project-native interactive browser path and narrow the claim to
what that fallback actually proves.

## Plan Declaration

Every UI-sensitive plan should contain:

```yaml
browser_proof_required: true
browser_proof_rationale: Visible route or interaction changes require rendered browser proof.
```

Plans that do not claim rendered UI behavior should contain:

```yaml
browser_proof_required: false
browser_proof_rationale: CLI/docs/backend-only work; no visible UI behavior is claimed.
```

When browser proof is required, the plan body should include:

```markdown
## Browser Proof Plan
Routes/states: /example route, role, data state, and UI state to inspect
Viewports: Desktop 1280px and mobile 390px, or a narrowed viewport claim
Runtime path: agent-browser preferred; explain fallback constraints if unavailable
Evidence command: npm run test:e2e -- --grep "changed flow"
Observations: Changed control is visible, interaction completes, no relevant console/network failures
Artifacts: .work/.../artifacts/example-1280.png (local-only unless sanitized)
Claim limit: Proves only this changed route/state and viewport set
```

If no command can reproduce the proof because the runtime path is manual or
interactive only, replace `Evidence command:` with:

```markdown
No-command rationale: agent-browser/manual refs were required for this local runtime; claim is limited to the observed session.
```

## Observation Record

Write one record per checked flow:

```markdown
## Browser Proof Observation

- Flow: /example route, role, data state, and UI state checked
- Viewports: 1280x720 desktop, 390x844 mobile
- Runtime path: agent-browser
- Evidence command: npm run test:e2e -- --grep "changed flow"
- Observed: Changed control rendered, interaction completed, no relevant console/network failures
- Artifacts:
  - .work/.../artifacts/example-1280.png — local-only, not safe to publish
  - .work/.../artifacts/example-390.png — local-only, not safe to publish
- Result: passed
- Claim limit: Proves only the scoped route/state, data setup, and viewport set.
- Stale after: route markup, interaction behavior, data fixture, or viewport assumptions change.
```

For failed or partial proof, use the failure-cause names defined in
`distilled/references/proof-rules.md` and record the narrowed claim or follow-up
trigger.

## Claim Boundary

Browser proof proves only the scoped route/state, environment, viewport,
observations, artifacts, and evidence kinds it records. It does not imply broad
visual quality, cross-browser coverage, full accessibility conformance,
production delivery, release readiness, or public proof unless those dimensions
are explicitly planned, evidenced, and safe to publish.
