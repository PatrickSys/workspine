## GSDD Governance (Generated)

Managed by `gsdd`; edit the framework template, not this block.

Lifecycle: `new-project -> plan -> execute -> verify -> audit-milestone`.

Core skills: `gsdd-new-project`, `gsdd-plan`, `gsdd-execute`, `gsdd-verify`, `gsdd-progress`.
Planning state: `.planning/`. Portable workflows: `.agents/skills/gsdd-*/SKILL.md`.

Invoke: `/gsdd-plan` (Claude, OpenCode; Cursor/Copilot/Gemini when skill discovery is available) · `$gsdd-plan` (Codex CLI, plan-only until `$gsdd-execute`) · open SKILL.md directly elsewhere.

Rules:
1. Read before writing roadmap work: `.planning/SPEC.md`, `.planning/ROADMAP.md`, `.planning/config.json`, and the relevant phase plan when one exists.
2. Stay in scope. Implement only what the approved plan or direct user request says. Record unrelated ideas as TODOs.
3. Verify before claiming done: artifact exists, content is substantive, and it is wired into the system.
4. Research unfamiliar domains from real docs and code; never hallucinate paths or APIs.
5. Do not pollute core workflows with vendor-specific syntax; workflow entry lives in `.agents/skills/`, helpers in `.planning/bin/`, and native adapters in their tool-specific directories.
6. Git guidance in `.planning/config.json` -> `gitProtocol` is advisory; follow the repo's own conventions first.

If `.planning/` is missing, run `npx -y gsdd-cli init` then `gsdd-new-project`; bare `gsdd init` is equivalent only when globally installed.

