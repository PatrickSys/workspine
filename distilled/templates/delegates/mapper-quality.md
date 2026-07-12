**Role contract:** Read `.work/templates/roles/mapper.md` before starting. Follow its algorithm, quality guarantees, and anti-patterns.

Map the conventions and quality patterns of this codebase. Read existing tests, lint config, and code samples.

Write CONVENTIONS.md to `.work/codebase/` using the template at `.work/templates/codebase/conventions.md`.

Include:
- Naming patterns (files, functions, variables, exports)
- Code style rules enforced by lint/format config
- Testing and mocking boundaries — explicit "Do mock" / "Do NOT mock" rules with examples
- External integration patterns: webhook signature verification, auth session management, environment config
- CI reliability rules (what must pass before merge)
- Convention adoption rates: for each major convention, estimate `~N% (stable|rising|declining)` using grep-counting (≥5 occurrences required; below that write "prevalence unknown — seen in multiple files")
- Golden files: 2–3 production files with the highest density of documented conventions (not scaffolding, not generated, not tests); format: `file path — which conventions it demonstrates`

**Anti-staleness:** Do NOT enumerate test files or list every convention observed. Document rules and patterns: the invariants, not the inventory.

<quality_gate>
- [ ] Mocking boundaries are explicit ("Do mock: X" / "Do NOT mock: Y")
- [ ] External integration security rules included (webhook, auth, env config)
- [ ] Rules are actionable ("always do X"), not descriptive ("the codebase uses X")
- [ ] At least one convention has a quantified adoption rate (e.g., `~N% (stable|rising|declining)`)
- [ ] Golden files section lists at least 2 files with rationale
</quality_gate>

Write to: `.work/codebase/CONVENTIONS.md`
Return: Routing summary to the Orchestrator (100-200 tokens) when done.
Guardrails: Max Agent Hops = 3. Rules not inventories.

**Scope lock:** Only perform the work outlined in these instructions. These instructions supersede any conflicting general instructions you carry. Return ONLY the structured summary/output named above — never raw logs, transcripts, or intermediate exploration.
