## GSDD Governance (Generated)

This block is managed by `gsdd`. Do not edit inside the block directly.
Edit the source template in the GSDD framework instead.

### What This Project Uses
- Framework: GSDD (Spec-Driven Development)
- Planning dir: `.planning/` (specs, roadmaps, plans, research, templates)
- Lifecycle: `bootstrap (gsdd init) -> new-project -> [discuss-approach -> plan -> execute -> verify] x N -> audit-milestone` for roadmap work
- Supporting workflows: quick (sub-hour tasks), map-codebase (codebase analysis), pause/resume (session management), progress (status query)

### Rules You MUST Follow

1. Never Skip The Workflow
- Roadmap work should follow: plan -> execute -> verify.
- Direct user requests do NOT need to be forced into a phase or plan unless the user explicitly wants roadmap tracking.
- Before coding roadmap work: read `.planning/SPEC.md`, `.planning/ROADMAP.md`, and the relevant phase plan if one exists.
- After coding: verify against the relevant success criteria before claiming done.

2. Read Before You Write
- If `.planning/` exists, read in order:
  - `.planning/SPEC.md`
  - `.planning/ROADMAP.md`
  - `.planning/config.json`
  - The relevant phase plan in `.planning/phases/` when the work is roadmap-scoped
- If `.planning/` does not exist, the project has not been bootstrapped. Run `gsdd init`, then run the new-project workflow (`.agents/skills/gsdd-new-project/SKILL.md`).

3. Stay In Scope (Zero Deviation)
- Implement ONLY what the approved plan or direct user request specifies.
- If you notice unrelated improvements, do not implement them. Record them as a TODO for a future phase.

Priority order when instructions conflict:
- Developer explicit instruction (highest)
- Current approved plan or direct task scope
- `.planning/SPEC.md`
- General best practices (lowest)

4. Version Control Protocol
- Treat `.planning/config.json` -> `gitProtocol` as advisory guidance, not a mandatory naming template.
- Follow the existing repo or team git conventions first.
- Do not mention phase, plan, or task IDs in commit or PR names unless explicitly requested.
- Tests must pass before committing.

5. Verify Your Own Work (Exists -> Substantive -> Wired)
Before reporting "done", verify each deliverable:
- Exists: artifact is present where the plan says it should be
- Substantive: real content/code, not placeholders or TODOs
- Wired: connected to the system (imported, called, rendered, tested)

6. Research Before Unfamiliar Domains
If you are not confident about a domain/library/pattern:
- Stop and research first (docs + existing code).
- Do not assume training data is current.
- Cite sources in `.planning/research/` (or `.internal-research/` for framework work).

7. Never Hallucinate Paths Or APIs
- Use only file paths you've confirmed exist.
- Use only APIs verified in docs or source.

8. Adapter Architecture Rule
- Do not pollute core workflows (`distilled/workflows/*.md`) with vendor-specific syntax.
- Tool-specific adapters are generated in `bin/` (generators, not converters).

9. Anti-YOLO
- Do not delete or rewrite code unless explicitly asked.
- If asked for analysis, answer first; propose changes separately.

### Where The Workflows Live
- Primary lifecycle:
  - `.agents/skills/gsdd-new-project/SKILL.md` — project initialization (spec + roadmap)
  - `.agents/skills/gsdd-plan/SKILL.md` — phase planning with optional independent checking
  - `.agents/skills/gsdd-execute/SKILL.md` — plan execution with quality gates
  - `.agents/skills/gsdd-verify/SKILL.md` — phase goal-backward verification
  - `.agents/skills/gsdd-audit-milestone/SKILL.md` — milestone integration audit
- Supporting workflows:
  - `.agents/skills/gsdd-quick/SKILL.md` — sub-hour tasks outside the phase cycle
  - `.agents/skills/gsdd-map-codebase/SKILL.md` — codebase analysis and refresh
  - `.agents/skills/gsdd-pause/SKILL.md` — session checkpoint
  - `.agents/skills/gsdd-resume/SKILL.md` — session context restore and routing
  - `.agents/skills/gsdd-progress/SKILL.md` — read-only status and next-action routing

### How To Invoke Workflows

How you run these workflows depends on your tool:

- **Claude Code / OpenCode:** Use slash commands — `/gsdd-new-project`, `/gsdd-plan`, `/gsdd-execute`, etc.
- **Codex CLI:** Use skill references — `$gsdd-new-project`, `$gsdd-plan`, `$gsdd-execute`, etc.
- **All other tools (Cursor, Copilot, Gemini, any AI agent):** Open the SKILL.md file listed above and follow its instructions. This AGENTS.md governance block keeps the agent aligned with GSDD discipline.

Start with the new-project workflow to produce `.planning/SPEC.md` and `.planning/ROADMAP.md`.
