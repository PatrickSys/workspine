---
name: Workspine (published as gsdd-cli)
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
- plan-milestone-gaps: `workflows/plan-milestone-gaps.md`
- quick: `workflows/quick.md`
</workflow>

<governance>
Mandatory:
- Read before you write. If `.planning/` exists, read `.planning/SPEC.md`, `.planning/ROADMAP.md`, `.planning/config.json`.
- Stay in scope. Implement only what the current phase plan describes.
- Never hallucinate. Confirm paths and APIs from repo or docs before use.
- Research-first when unfamiliar. Log evidence, then plan.
- Exists -> Substantive -> Wired gate before claiming done.
</governance>

<project_structure>
Workspine uses `.planning/` as the durable workspace:

```
.planning/
  SPEC.md
  ROADMAP.md
  config.json
  templates/
  phases/
  research/
```
</project_structure>

<adapters>
Recommended: generate adapters with `gsdd-cli`:

```bash
npx -y gsdd-cli init
npx -y gsdd-cli init --tools claude
npx -y gsdd-cli init --tools codex
npx -y gsdd-cli init --tools agents
```

Behavior:
- Always: generates open-standard skills at `.agents/skills/gsdd-*/SKILL.md` by embedding `distilled/workflows/*.md`, plus repo-local deterministic helpers at `.planning/bin/gsdd.mjs`.
- Optional: generates tool adapters (root `AGENTS.md`, Claude `.claude/skills` + `.claude/commands` alias + `.claude/agents`, OpenCode `.opencode/commands` + `.opencode/agents`, Codex CLI `.codex/agents/gsdd-plan-checker.toml`).
- Codex CLI: uses the portable skill entry surface and the generated `.codex/agents/` checker/approach-explorer agents; it does not use `.codex/AGENTS.md` as the primary integration path.
- Root `AGENTS.md` is only written when explicitly requested (so we do not pollute existing user governance).
</adapters>

<templates>
Use templates from `.planning/templates/` (copied from `distilled/templates/`) when producing planning artifacts.

Core:
- `.planning/templates/spec.md` -> `.planning/SPEC.md`
- `.planning/templates/roadmap.md` -> `.planning/ROADMAP.md`

Research:
- `.planning/templates/research/*.md` -> `.planning/research/*.md`

Brownfield codebase mapping:
- `.planning/templates/codebase/*.md` -> `.planning/codebase/*.md`
</templates>
