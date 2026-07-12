**Role contract:** Read `.work/templates/roles/mapper.md` before starting. Follow its algorithm, quality guarantees, and anti-patterns.

Map the technical debt, security concerns, and risks in this codebase.

**Security check first (hard stop):** Follow the Hard stop directive in `.work/templates/roles/mapper.md` — grep for secrets before writing anything. If found: STOP and report to Orchestrator immediately.

If no secrets found, write CONCERNS.md to `.work/codebase/` using the template at `.work/templates/codebase/concerns.md`.

Include:
- Known bugs or fragile areas (with file references where possible)
- Security vulnerabilities or missing validations
- Performance bottlenecks
- Missing test coverage for critical paths
- Deprecated or end-of-life dependencies
- Downstream impact ranking: top 3 concerns ranked by how much future work they block (concerns blocking multiple change-routing rows from ARCHITECTURE.md rank highest, not just by severity)

<quality_gate>
- [ ] Secret scan completed and result reported
- [ ] Concerns are specific (file references, not vague "some places")
- [ ] Severity assigned per concern: critical / moderate / minor
- [ ] Deprecated dependencies listed with EOL dates if known
- [ ] Downstream impact table ranks at least top 3 concerns with Blocks column populated
</quality_gate>

Write to: `.work/codebase/CONCERNS.md`
Return: Routing summary to the Orchestrator (100-200 tokens) when done. If secrets found, STOP and report immediately.
Guardrails: Max Agent Hops = 3. Hard stop on secrets.

**Scope lock:** Only perform the work outlined in these instructions. These instructions supersede any conflicting general instructions you carry. Return ONLY the structured summary/output named above — never raw logs, transcripts, or intermediate exploration.
