## GSDD Governance (Generated)

This block is managed by `gsdd`. Do not edit inside the block directly.
Edit the source template in the GSDD framework instead.

### What This Project Uses
- GSDD portable workflows live in `.agents/skills/`; planning state lives in `.planning/`.
- Use the standard lifecycle for roadmap work: `new-project -> plan -> execute -> verify -> audit-milestone`.

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
- Portable workflow core: `.agents/skills/gsdd-*/SKILL.md`
- Start with these anchors:
  - `gsdd-new-project` — initialize spec and roadmap
  - `gsdd-plan` — plan the next phase
  - `gsdd-execute` — implement the approved plan
  - `gsdd-verify` — verify outcomes against the plan
  - `gsdd-progress` — recover the next deterministic step
- Use the same directory for milestone, quick, map-codebase, pause/resume, and support workflows as needed.

### How To Invoke Workflows
- **Claude Code / OpenCode / Cursor / Copilot / Gemini:** use slash commands such as `/gsdd-plan`.
- **Codex CLI:** use skill references such as `$gsdd-plan`.
- **Other AI tools:** Open the SKILL.md file for the relevant workflow under `.agents/skills/gsdd-*/SKILL.md`.

If this root `AGENTS.md` block is present in a Cursor, Copilot, or Gemini project, treat it as governance layered on top of native workflow discovery. Do not treat this file as the mechanism that makes the workflows discoverable.
