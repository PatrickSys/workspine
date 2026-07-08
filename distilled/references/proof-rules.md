# Proof rules

One rule, stated once: **a claim backed only by reading code, or only by a human
saying so, cannot close a delivery claim.** Something must have actually run.

Evidence kinds (plain names): `code` (read the diff), `test` (a test ran),
`runtime` (the thing was executed and observed), `delivery` (merged / published /
installed), `human` (a person confirmed).

- Closing "this works" needs at least one of `test` or `runtime`.
- Closing "this shipped" needs `delivery`.
- `code` and `human` support a claim; alone they close nothing.
- UI work: proof means opening a real browser (agent-browser preferred,
  Playwright fallback), inspecting the rendered DOM and behavior — not
  screenshots alone. Record what was observed (see observation-record.md).

Failure-cause names for failed or partial browser/runtime proof:

- `product_bug`: the product behavior or rendered UI is wrong.
- `missing_infra`: the required runtime, credentials, fixture data, server, or
  browser path is unavailable.
- `flaky_harness`: the proof path is unstable or nondeterministic in a way that
  prevents a trustworthy result.
- `ambiguous_spec`: the expected behavior or acceptable result is unclear.
