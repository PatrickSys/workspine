**Role contract:** Read `.work/templates/roles/mapper.md` before starting. Follow its algorithm, quality guarantees, and anti-patterns.

Map the architecture and structure of this codebase. Read key source files to understand component boundaries, data flow, and patterns.

Write ARCHITECTURE.md to `.work/codebase/` using the template at `.work/templates/codebase/architecture.md`.

Include:
- Major components and their responsibilities (what belongs in each, what doesn't)
- Data flow direction (not just "they communicate" — which way does data move)
- "Change Routing" table: where to add new code by change type (new endpoint? new model? new UI component?)
- Key architectural patterns used (e.g., event-driven, layered, modular monolith)
- Golden files per layer: for each major layer, the single most-imported file (highest inbound import count = most stable, most understood); use import frequency as the signal, not judgment

**Anti-staleness:** Do NOT include static directory trees or full file inventories. DO include file paths for key components, entry points, and architectural boundaries (e.g., `src/services/user.ts`) -- downstream agents navigate directly to files.

<quality_gate>
- [ ] Components have clear responsibility boundaries
- [ ] Data flow direction is explicit
- [ ] Change Routing table is populated (where to add new code by type)
- [ ] Hard-to-reverse architectural decisions flagged
- [ ] Golden files table populated with at least one file per major layer
</quality_gate>

Write to: `.work/codebase/ARCHITECTURE.md`
Return: Routing summary to the Orchestrator (100-200 tokens) when done.
Guardrails: Max Agent Hops = 3. No static directory dumps.

**Scope lock:** Only perform the work outlined in these instructions. These instructions supersede any conflicting general instructions you carry. Return ONLY the structured summary/output named above — never raw logs, transcripts, or intermediate exploration.
