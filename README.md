<div align="center">

# Workspine

AI agents forget when the session ends. Workspine writes plans, decisions, and verification to `.planning/` so any agent or runtime can pick up where the last one stopped.

[![npm version](https://img.shields.io/npm/v/gsdd-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd-cli)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

```bash
npx -y gsdd-cli init
```

**Validated:** Claude Code, Codex CLI, OpenCode. **Qualified:** Cursor, Copilot, Gemini.

</div>

---

## How it works

`init` places workflow skills in `.agents/skills/` and optionally native adapters for your runtime. Then you run workflows through your agent — each one writes files to the repo:

| Workflow | Writes | What for |
|----------|--------|----------|
| `gsdd-new-project` | `.planning/SPEC.md`, `ROADMAP.md` | Define the project and phases |
| `gsdd-plan` | `.planning/phases/N/PLAN.md` | Research and review before any code gets written |
| `gsdd-execute` | `.planning/phases/N/SUMMARY.md` | Implement the approved plan, nothing more |
| `gsdd-verify` | `.planning/phases/N/VERIFICATION.md` | Confirm the plan's claims are actually true |

The discipline: plan first, execute only what's approved, verify before closing. Each phase summary carries forward what was decided, so the next session starts with context instead of from scratch.

Workspine ships 14 workflows. The package and CLI are `gsdd-cli` / `gsdd-*` — retained as the technical contract under the Workspine product name.

---

## Get started

```bash
npx -y gsdd-cli init                     # guided wizard
npx -y gsdd-cli init --tools claude      # Claude Code only
npx -y gsdd-cli init --tools opencode    # OpenCode only
npx -y gsdd-cli init --tools codex       # Codex CLI only
npx -y gsdd-cli init --tools all         # all runtimes
npx -y gsdd-cli init --auto --tools all  # headless / CI
```

### Which workflow to start with

| Situation | Start here |
|-----------|------------|
| New project, or brownfield work that's broad / milestone-shaped | `gsdd-new-project` — full initializer, runs codebase mapping internally when needed |
| Existing repo, and the change you want to make is already concrete | `gsdd-quick` — bounded-change lane, lighter ceremony |
| Existing repo is unfamiliar or risky and you want a baseline first | `gsdd-map-codebase` — orientation pass before choosing the above |

### Invoke through your agent

| Runtime | How |
|---------|-----|
| Claude Code / OpenCode | `/gsdd-plan` slash command |
| Codex CLI | `$gsdd-plan` skill reference |
| Codex VS Code / app | Native discovery if available |
| Cursor / Copilot / Gemini | Slash command if discovered |
| Any other agent | Open `.agents/skills/gsdd-plan/SKILL.md` |

### Team use

Commit `.planning/` so the team shares specs, roadmaps, phase plans, and verification reports. Each developer runs `init --tools <their-tool>` for their own runtime adapters without changing the shared delivery artifacts.

---

## Where it fits

Use Workspine when a feature takes more than one session, or when you need to switch between Claude, Codex, and Cursor without losing the thread. Skip it for quick, obvious edits — direct prompting is cheaper when the risk is small.

| Tool | Good for | vs Workspine |
|------|----------|--------------|
| **Workspine** | Work that spans sessions, agents, or runtimes where plans and proof need to stay in the repo | — |
| [GSD](https://github.com/gsd-build/get-shit-done) | Broad AI prompting suite — 81 commands, 78 workflows, 33 agents | Workspine is narrower: 14 workflows, fewer moving parts for the human in the loop |
| [OpenSpec](https://openspec.dev/) | Living spec + change proposals in a lightweight format | Workspine adds the execution, verification, and handoff layer on top of planning |
| [LeanSpec](https://www.lean-spec.dev/docs/guide/first-principles) | Minimal specs that fit LLM context | Workspine adds workflow gates and runtime entrypoints for when you need the full structure |
| [GitHub Spec Kit](https://github.com/github/spec-kit) | Spec-first planning workflows in `.specify/` | Similar space; Workspine is one CLI with one delivery loop instead of a broader ecosystem |
| [Kiro](https://kiro.dev/docs/) | IDE-native agent dev with specs, steering, hooks, and MCP | Kiro is IDE-only; Workspine works across terminal and IDE agents that can read repo files |
| [Tessl](https://tessl.io/enterprise/) | Hosted platform for distributing agent skills across teams | Tessl needs a control plane; Workspine is local-first with no hosted infrastructure |

<sub>Based on each tool's public docs as of May 2026. Open an issue if anything reads inaccurately.</sub>

---

## CLI

```bash
npx -y gsdd-cli init                    # guided install wizard
npx -y gsdd-cli health                  # workspace integrity check
npx -y gsdd-cli update                  # regenerate stale runtime surfaces
npx -y gsdd-cli models profile quality  # maximize review rigor
npx -y gsdd-cli models profile budget   # minimize cost
npx -y gsdd-cli control-map             # repo and planning state at a glance
npx -y gsdd-cli closeout-report         # read-only phase closeout replay
npx -y gsdd-cli phase-status 5 done     # mark a phase status in ROADMAP.md
npx -y gsdd-cli find-phase 5            # show phase info as JSON
npx -y gsdd-cli verify 5                # run artifact checks for a phase
npx -y gsdd-cli scaffold phase 5 name   # create a new phase plan file
npx -y gsdd-cli file-op copy ...        # deterministic workspace file ops
npx -y gsdd-cli session-fingerprint write   # rebaseline planning-state drift
npx -y gsdd-cli ui-proof validate path  # validate UI proof metadata
npx -y gsdd-cli registry-list           # list worktree coordination leases
npx -y gsdd-cli registry-show 5         # show lease for a specific phase
npx -y gsdd-cli registry-clear 5        # remove a lease record
npx -y gsdd-cli registry-crash 5 ...    # mark a lease crashed (P66 placeholder)
npx -y gsdd-cli help                    # show all commands
```

Full reference: [User Guide](docs/USER-GUIDE.md) · [Runtime Support](docs/RUNTIME-SUPPORT.md) · [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md)

---

## Credits

Fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), MIT licensed. Original git history retained.

MIT License. See [LICENSE](LICENSE) for details.
