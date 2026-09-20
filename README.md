<div align="center">

# Workspine

[![npm version](https://img.shields.io/npm/v/workspine?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/workspine)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

A coding agent can move fast while quietly guessing what you meant. The next session may guess again.
Tests can pass while the result is still wrong.

**An AI development harness for coding agents.**

It brings decisions to you and keeps development consistent across agents and sessions.

![Workspine turns a request into an owner-steered plan, implementation, and verification](assets/workspine-hero.webp)

```bash
npx -y workspine setup
```

Setup adds Workspine to the current repository. Run it from the repo root with Node `>=22`.
Then, in your coding agent's chat, start with one small planned change:

1. Run **`work-plan`** so the agent turns the request into a checked plan.
2. Review the plan the agent shows or links. Give explicit owner approval in chat, or ask for changes.
3. Run **`work-execute`** to implement the approved plan.
4. Run **`work-verify`** to check the result against it. Inspect the diff, check results, and any remaining gaps.

Use **`work-quick`** when the change is already understood and needs less ceremony.
Use **`work-new-project`** when the project or milestone itself still needs shaping.

## What you keep

Workspine records the plan, the decisions you approve, what changed, and what was verified in `.work/`
in your repo.
The chat can end. The decisions stay with the work.

If you already have a legacy `.planning/` workspace, setup offers a byte-preserving move to `.work/`
and explains why. It never migrates silently, and declining leaves the old files untouched.

## Use Workspine

### Quickstart

The `work-*` names are agent workflows, not terminal commands. In chat, ask the agent to use
`work-plan` with your request. Use its slash command or skill reference when it discovers the installed skills.
If discovery is unavailable, open `.agents/skills/work-<workflow>/SKILL.md` and ask the agent to follow it;
for planning, that is `.agents/skills/work-plan/SKILL.md`.
The [User Guide](docs/USER-GUIDE.md#fast-path) shows the approval and review steps.

Before ending a session mid-work, run `work-pause`. In the next session, use `work-resume`;
use `work-progress` when you only need the current status and next action.

For a self-contained task whose decisions and checks already fit your agent's native workflow,
that workflow may be enough. Workspine is useful when you want an explicit plan, owner decisions,
and verification kept with the repo across sessions.

Use `npx -y workspine health` to check the installation and `npx -y workspine update` to repair
generated files. The health and update operations are network-free; `npx` may first download the package.

Install it, try one real change, and [report any friction](https://github.com/PatrickSys/workspine/issues/new?template=friction.yml).

## Details

- [User Guide](docs/USER-GUIDE.md) for every workflow and command.
- [Runtime Support](docs/RUNTIME-SUPPORT.md) for tool-specific installation and invocation.
- [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md) for what the checks do and do not establish.
- [Changelog](CHANGELOG.md) for migration and compatibility notes.

Workspine requires Node `>=22`. The compatibility command `workspine init` remains available throughout
the `0.35.x` release line. The `gsdd` binary alias is removed in the next minor release.

MIT. See [LICENSE](LICENSE).
