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

Evidence class: `test`/`runtime`/`delivery` items are **deterministic** only when the command that produced them is recorded verbatim with its observed output. Manual/interactive browser proofs with a `No-command rationale` are **explicit-human-confirmation** evidence; they do not require a verbatim command and may satisfy `passed` alongside deterministic items. `code` and `human` are **judgment**. Judgment must never be presented as deterministic.

<good-example>Ran `npm test -- --runInBand tests/auth.test.ts` → exit 0, "12 passed". Claim: auth middleware behavior verified for the covered cases.</good-example>
<bad-example>"Tests pass" (no command, no output). Also bad: the plan said `npm test -- tests/auth.test.ts`, the summary reports `npm test -- tests/auth-new.test.ts` — a reworded command is a different claim.</bad-example>

Failure-cause names for failed or partial browser/runtime proof:

- `product_bug`: the product behavior or rendered UI is wrong.
- `missing_infra`: the required runtime, credentials, fixture data, server, or
  browser path is unavailable.
- `flaky_harness`: the proof path is unstable or nondeterministic in a way that
  prevents a trustworthy result.
- `ambiguous_spec`: the expected behavior or acceptable result is unclear.

## Decision dispositions

When a plan boundary emits a non-empty decision digest, PLAN.md may acknowledge it with
`decision_dispositions`: each entry names the decision `id`, the exact body `hash`, the persisted
`authority_fingerprint`, and one
`disposition`: `applied`, `not-applicable`, or `challenged`. `not-applicable` and `challenged`
entries require a nonblank `note`; `challenged` items are surfaced for user review. The digest
is persisted only by the plan preflight, and later execution warns when the persisted/current
authority membership differs or an acknowledged id, body hash, status, authority, or fingerprint
drifts. Decision records may also carry the additive optional
`invalidation_reason` field; rejected records remain on disk.
