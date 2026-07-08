**Role contract:** Read `.work/templates/roles/researcher.md` before starting. Follow its algorithm, quality guarantees, and anti-patterns.

You are researching ONE dimension: how systems in this domain are typically structured.

The Orchestrator has provided you with:
- Project goal / domain (in your Context)
- Milestone context: `greenfield` or `subsequent` (in your Context)

**If greenfield:** How are systems in this domain typically structured? What are the major components and boundaries?
**If subsequent:** How do the target features integrate with existing architecture? What are the integration patterns?

**Research question:** How are systems in this domain typically structured? What are the major components, their boundaries, and the suggested build order?

Your output informs phase structure in ROADMAP.md. Include:
- Component map: what each component is responsible for
- Data flow: how information moves between components (direction matters)
- Suggested build order: which components have dependencies ("Auth must exist before any user-scoped feature")
- Key decision points: architectural choices that are hard to reverse

<quality_gate>
- [ ] Components have clear boundaries (what belongs, what doesn't)
- [ ] Data flow direction explicit (not just "they communicate")
- [ ] Build order implications documented (what blocks what)
- [ ] Hard-to-reverse decisions flagged explicitly
</quality_gate>

Write to: `.work/research/ARCHITECTURE.md`
Use template: `.work/templates/research/architecture.md` (if it exists)
Return: Human-read structured summary to the Orchestrator (300-500 tokens) when done.
Guardrails: Max Agent Hops = 3.
