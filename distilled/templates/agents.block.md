## GSDD Governance (Generated)

Managed by `gsdd`; edit the framework template, not this block.

Lifecycle: `new-project -> plan -> execute -> verify -> audit-milestone`.

Core skills: `work-new-project`, `work-plan`, `work-execute`, `work-verify`, `work-progress`.
Planning state: `.work/` (supported legacy `.planning/` state requires explicit migration). Portable workflows: `.agents/skills/work-*/SKILL.md`.
Install/repair: `npx -y workspine setup` creates repo-local skills, planning state and this routing guide (`--no-agents` skips it); `npx -y workspine init` remains the advanced entrypoint. `npx -y workspine health` checks generated surfaces; `npx -y workspine update` repairs drift. For an existing global install, use `npx -y workspine health --global` and follow its safe-update or manual-resolution guidance. This guide points to portable skills; it does not replace them or install native adapters.

Invoke: `/work-plan` (Claude, OpenCode; Cursor/Copilot/Gemini when skill discovery is available) · `$work-plan` (Codex CLI, plan-only until explicit owner approval and `$work-execute`) · open SKILL.md directly elsewhere. Native adapters: `setup --agent <claude|opencode|codex>` in a fresh repo; `init --tools <target>` in an existing workspace.

Rules:
1. Read before writing roadmap work: `.work/SPEC.md`, `.work/ROADMAP.md`, `.work/config.json`, and the relevant phase plan when one exists; use matching `.planning/` paths only in legacy workspaces.
2. Stay in scope. Implement only what the approved plan or direct user request says. Record unrelated ideas as TODOs.
3. Verify before claiming done: artifact exists, content is substantive, and it is wired into the system.
4. Research unfamiliar domains from real docs and code; never hallucinate paths or APIs.
5. Do not pollute core workflows with vendor-specific syntax; workflow entry lives in `.agents/skills/`, helpers in `.work/bin/`, and native adapters in their tool-specific directories.
6. Git guidance in `.work/config.json` -> `gitProtocol` is advisory; follow the repo's own conventions first.

If `.work/` is missing, run `npx -y workspine setup`; then use `work-plan` for a bounded change or `work-new-project` for broader scope. Bare `gsdd` commands require a global install.
