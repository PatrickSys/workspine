<div align="center">

# Workspine

[![npm version](https://img.shields.io/npm/v/workspine?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/workspine)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

A coding agent can move fast while quietly guessing what you meant. The next session may guess again.
Tests can pass while the result is still wrong.

Workspine is a workflow for coding agents.
It brings decisions to you and keeps development consistent across agents and sessions.

![Workspine turns a request into an owner-steered plan, implementation, and verification](assets/workspine-hero.webp)

```bash
npx -y workspine setup
```

Setup adds Workspine to the current repository: durable project state in `.work/` and workflow skills in
`.agents/skills/work-*`. Runtime-specific adapters are optional layers on top of that shared skill surface.

For a self-contained task with clear decisions and checks, your agent's normal workflow may be enough.
Use Workspine when you want the plan, decisions you approve, verification, and next-session handoff kept
with the repository.

Start in your coding agent's chat with one small planned change:

1. Ask the agent to use **`work-plan`** and describe the outcome and constraints.
2. Review the checked plan and answer any material questions. Give explicit owner approval in chat when
   it matches what you want; the agent records the approval against that plan and confirms it. You do not
   need to create an approval ID or edit a record.
3. Run **`work-execute`** to implement the approved plan.
4. Run **`work-verify`**, then inspect the change, check results, and any remaining gaps.

Verification is evidence-based. If the approved plan makes a UI claim, it can require real browser evidence;
passing code tests alone does not establish that rendered behavior.

Use **`work-quick`** when the change is already understood and needs less ceremony.
Use **`work-new-project`** when the project or milestone itself still needs shaping.

## What you keep

For example, suppose a docs sidebar should reveal a newly selected page while respecting manual collapse
on the current page. You choose that behavior and approve the plan. Workspine keeps that decision, the
implementation summary, and verification evidence in `.work/` in your repo. Inspect the diff and
reported checks against the behavior you chose. A fresh session can recover the decision and unfinished
work from those records.

The chat can end. The decisions stay with the work.

Stopping mid-work? Run `work-pause` and check that it saved the decisions, unfinished work, and next
action. In a fresh session in the same repo, run `work-resume` to continue or `work-progress` to see
the current state and next action.

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
