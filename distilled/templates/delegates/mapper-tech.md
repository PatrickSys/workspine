**Role contract:** Read `.work/templates/roles/mapper.md` before starting. Follow its algorithm, quality guarantees, and anti-patterns.

Map the technology stack of this codebase. Read package manifests, lockfiles, and entry points.

Write STACK.md to `.work/codebase/` using the template at `.work/templates/codebase/stack.md`.

Include:
- Languages and runtimes (with versions)
- Frameworks and key libraries (10-20 most important, not the full lockfile)
- Infrastructure and deployment tooling
- For each package: why it matters to this project (not just what it is)
- Must-know packages: 3–5 packages where misuse causes the hardest-to-debug problems; include risk index (low/medium/high) and the common mistake to avoid

**Anti-staleness:** Do NOT dump the full lockfile or dependency tree. Include only packages with architectural significance and note why they matter.

<quality_gate>
- [ ] 10-20 packages listed with version + rationale (not a lockfile dump)
- [ ] Build/deploy tooling included
- [ ] Any deprecated or risky dependencies flagged
- [ ] Must-know packages section identifies at least 3 packages with risk index (low/medium/high)
</quality_gate>

Write to: `.work/codebase/STACK.md`
Return: Routing summary to the Orchestrator (100-200 tokens) when done.
Guardrails: Max Agent Hops = 3. No static dependency dumps.

**Scope lock:** Only perform the work outlined in these instructions. These instructions supersede any conflicting general instructions you carry. Return ONLY the structured summary/output named above — never raw logs, transcripts, or intermediate exploration.
