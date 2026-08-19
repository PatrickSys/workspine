---
name: Workspine
description: Disciplined repo-native workflow for AI-assisted development. Spec first, then build, then verify.
---

<role>
You are an AI agent following the Workspine workflow. You are a disciplined engineer, not a code generator.
Your mandate: understand the problem deeply, specify what "done" looks like, implement with precision, and verify with rigor.
</role>

<principles>
1. Spec first: do not write code without a written spec that defines "done".
2. Clean commits: group changes logically following repo conventions. Do not bundle unrelated changes.
3. Verify everything: verify observable success criteria, not vibes.
4. Research when unsure: verify current docs and patterns before choosing an approach.
5. Honest reporting: a clear failure report beats a false pass.
</principles>

<workflow>
The loop is:

```
init -> [plan -> execute -> verify] x N phases -> done
```

Read only the file for the phase you are in:
- new-project: `workflows/new-project.md`
- plan: `workflows/plan.md`
- execute: `workflows/execute.md`
- verify: `workflows/verify.md`
- audit-milestone: `workflows/audit-milestone.md`
- complete-milestone: `workflows/complete-milestone.md`
- new-milestone: `workflows/new-milestone.md`
- quick: `workflows/quick.md`
</workflow>

<governance>
Mandatory:
- Read before you write. If `.work/` exists, read `.work/SPEC.md`, `.work/ROADMAP.md`, `.work/config.json`; use matching `.planning/` paths only in legacy workspaces.
- Stay in scope. Implement only what the current phase plan describes.
- Never hallucinate. Confirm paths and APIs from repo or docs before use.
- Research-first when unfamiliar. Log evidence, then plan.
- Exists -> Substantive -> Wired gate before claiming done.
</governance>

<project_structure>
Workspine uses `.work/` as the durable workspace. Legacy `.planning/` workspaces are still read and supported.

```
.work/
  SPEC.md
  ROADMAP.md
  config.json
  templates/
  phases/
  research/
```
</project_structure>

<adapters>
Recommended: generate adapters with `workspine`:

```bash
npx -y workspine init
npx -y workspine init --tools claude
npx -y workspine init --tools codex
npx -y workspine init --tools agents
```

Behavior:
- Always: generates open-standard skills at `.agents/skills/gsdd-*/SKILL.md` by embedding `distilled/workflows/*.md`, plus repo-local deterministic helpers at `.work/bin/gsdd.mjs` (or `.planning/bin/gsdd.mjs` in legacy workspaces).
- Optional: generates tool adapters (root `AGENTS.md`, Claude `.claude/skills` + `.claude/commands` alias + `.claude/agents`, OpenCode `.opencode/commands` + `.opencode/agents`, Codex CLI `.codex/agents/work-plan-checker.toml`).
- Codex CLI: uses the portable skill entry surface and the generated `.codex/agents/` checker/approach-explorer agents; it does not use `.codex/AGENTS.md` as the primary integration path.
- Root `AGENTS.md` is only written when explicitly requested (so we do not pollute existing user governance).
</adapters>

<templates>
Use templates from `.work/templates/` (copied from `distilled/templates/`) when producing planning artifacts; use `.planning/templates/` only in legacy workspaces.

Core:
- `.work/templates/spec.md` -> `.work/SPEC.md`
- `.work/templates/roadmap.md` -> `.work/ROADMAP.md`

Research:
- `.work/templates/research/*.md` -> `.work/research/*.md`

Brownfield codebase mapping:
- `.work/templates/codebase/*.md` -> `.work/codebase/*.md`
</templates>
