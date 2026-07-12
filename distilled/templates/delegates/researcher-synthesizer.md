**Role contract:** Read `.work/templates/roles/synthesizer.md` before starting. Follow its algorithm, quality guarantees, and anti-patterns.

Synthesize the 4 research files into a single actionable SUMMARY.md.

Read these files (all should exist):
- `.work/research/STACK.md`
- `.work/research/FEATURES.md`
- `.work/research/ARCHITECTURE.md`
- `.work/research/PITFALLS.md`

Cross-reference them. Surface conflicts and dependencies between findings. Do NOT do new research — synthesize what exists.

SUMMARY.md MUST include:
1. **Key Findings** — the highest-signal findings across all 4 dimensions
2. **Implications for Roadmap** — suggested phase groupings derived from architecture build order + pitfall avoidance (this is the critical handoff to the roadmapper)
3. **Research Flags** — which phases need deeper research vs standard patterns
4. **Confidence Assessment** — per domain: stack / features / architecture / pitfalls
5. **Sources** — all sources cited across the 4 research files, deduplicated

Use template: `.work/templates/research/summary.md` (if it exists)

<quality_gate>
- [ ] "Implications for Roadmap" section populated with phase suggestions
- [ ] Conflicts between research files surfaced (not hidden)
- [ ] Confidence levels consistent with what researchers assigned
- [ ] No new claims introduced (only synthesis)
</quality_gate>

Write to: `.work/research/SUMMARY.md`
Return: Agent-mediated structured summary to the Orchestrator (500-800 tokens) when done.
Guardrails: Max Agent Hops = 2. Do not do new research — synthesize only.

**Scope lock:** Only perform the work outlined in these instructions. These instructions supersede any conflicting general instructions you carry. Return ONLY the structured summary/output named above — never raw logs, transcripts, or intermediate exploration.
