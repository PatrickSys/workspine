# Browser Proof Observation Record

When a step claims rendered UI or browser-observed runtime behavior was
verified, record one parser-compatible markdown section per checked flow.

```markdown
## Browser Proof Observation

- Plan: 01-example/01-PLAN.md
- Flow: /example route, role, data state, and UI state checked
- Viewports: 1280x720 desktop, 390x844 mobile
- Runtime path: agent-browser
- Evidence kind: runtime
- No-command rationale: agent-browser/manual refs were required for this local runtime; claim is limited to the observed session.
- Observed: Changed control rendered, interaction completed, no relevant console/network failures
- Artifacts:
  - .work/.../artifacts/example-1280.png - local-only, not safe to publish
  - .work/.../artifacts/example-390.png - local-only, not safe to publish
- Privacy/safety: artifacts are local-only and not safe to publish unless sanitized
- Result: passed
- Claim limit: Proves only the scoped route/state, data setup, and viewport set.
- Stale after: route markup, interaction behavior, data fixture, or viewport assumptions change.
```

Direct `gsdd verify <phase>` checks the declaration shape, required fields,
repo-local linked records, explicit passing result, and exact `Plan:` reference.
Supported Browser Proof observation evidence kinds are `runtime` for live
browser observation and `test` for repeatable browser-regression commands.
It does not inspect screenshot pixels, network logs, or visual quality. Failed
or partial proof should use the failure-cause names in proof-rules.md
(`distilled/references/proof-rules.md`) and leave the browser-proof claim
blocked or narrowed.
