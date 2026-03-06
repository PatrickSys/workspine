**Security: Before exploring, read and follow the `<forbidden_files>` section from `.agents/skills/gsdd-map-codebase/SKILL.md`.** Never read or quote contents from files matching those patterns. Note existence only.

**Output quality:** File paths are critical for downstream agents. Use backtick-formatted paths (`src/...`). Show patterns, not lists. Be prescriptive ("Use X"), not descriptive ("Some use X").

Map the architecture and structure of this codebase. Read key source files to understand component boundaries, data flow, and patterns.

Write ARCHITECTURE.md to `.planning/codebase/` using the template at `.planning/templates/codebase/architecture.md`.

Include:
- Major components and their responsibilities (what belongs in each, what doesn't)
- Data flow direction (not just "they communicate" — which way does data move)
- "Change Routing" table: where to add new code by change type (new endpoint? new model? new UI component?)
- Key architectural patterns used (e.g., event-driven, layered, modular monolith)

**Anti-staleness:** Do NOT include static directory trees or full file inventories. DO include file paths for key components, entry points, and architectural boundaries (e.g., `src/services/user.ts`) -- downstream agents navigate directly to files.

<quality_gate>
- [ ] Components have clear responsibility boundaries
- [ ] Data flow direction is explicit
- [ ] Change Routing table is populated (where to add new code by type)
- [ ] Hard-to-reverse architectural decisions flagged
</quality_gate>

Write to: `.planning/codebase/ARCHITECTURE.md`
Return: 3-5 sentence summary to the Orchestrator when done.
Guardrails: Max Agent Hops = 3. No static directory dumps.
