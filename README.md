<div align="center">

# Workspine

[![npm version](https://img.shields.io/npm/v/workspine?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/workspine)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

A coding agent can move fast while quietly guessing what you meant. The next session may guess again.
Tests can pass while the result is still wrong.

It brings decisions to you and keeps development consistent across agents and sessions.

![Workspine turns a request into an owner-steered plan, implementation, and verification](assets/workspine-hero.webp)

```bash
npx -y workspine setup
```

Setup adds Workspine to the current repository: durable project state in `.work/` and workflow skills in
`.agents/skills/work-*`. Runtime-specific adapters are optional layers on top of that shared skill surface.

Start with one small planned change:

1. Run **`work-plan`** so the agent turns the request into a checked plan.
2. Review the plan. Nothing executes until your explicit owner approval.
3. Run **`work-execute`** to implement the approved plan.
4. Run **`work-verify`** to check the result against it.

Verification is evidence-based. If the approved plan makes a UI claim, it can require real browser evidence;
passing code tests alone does not establish that rendered behavior.

Use **`work-quick`** when the change is already understood and needs less ceremony.
Use **`work-new-project`** when the project or milestone itself still needs shaping.

## What you keep

Workspine records the plan, the decisions you approve, what changed, and what was verified in `.work/`
in your repo.
The chat can end. The decisions stay with the work.

Stopping mid-work? Run `work-pause`. In a fresh session, run `work-resume` to continue or `work-progress`
to see the current state and next action without re-explaining the project.

## Use Workspine

### Quickstart

Ask your coding agent to run `work-plan`. Use its slash command or skill reference when it discovers the installed skills.
If discovery is unavailable, open `.agents/skills/work-<workflow>/SKILL.md` and follow it directly.
After you approve the plan, run `work-execute`, then `work-verify`.

You normally interact through those `work-*` skills. The generated `.work/bin/` helper runtime is for workflow
mechanics and advanced recovery, not a command catalog you need to learn before using Workspine.

Use `npx -y workspine health` to check the installation and `npx -y workspine update` to repair
generated files. Both are network-free.

If you already have a legacy `.planning/` workspace, setup offers a byte-preserving move to `.work/`
and explains why. It never migrates silently, and declining leaves the old files untouched.

Install it, try one real change, and [report any friction](https://github.com/PatrickSys/workspine/issues/new?template=friction.yml).

## Details

**An AI development harness for coding agents.** Humans normally interact through the `work-*` skills; the deeper
lifecycle and helper machinery stays in the repository for the agents and for inspection when needed.

- [User Guide](docs/USER-GUIDE.md) for every workflow and command.
- [Runtime Support](docs/RUNTIME-SUPPORT.md) for tool-specific installation and invocation.
- [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md) for what the checks do and do not establish.
- [Changelog](CHANGELOG.md) for migration and compatibility notes.

Workspine requires Node `>=22`. The compatibility command `workspine init` remains available throughout
the `0.35.x` release line. The `gsdd` binary alias is removed in the next minor release.

MIT. See [LICENSE](LICENSE).
