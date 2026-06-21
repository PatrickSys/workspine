<div align="center">

# Workspine

Workspine is a repo-native delivery spine for AI-assisted software work: planning, checking, execution, verification, and handoff live in the repo so any agent or runtime can pick up where the last one stopped.

Directly validated today: Claude Code, Codex CLI, OpenCode. Qualified support: Cursor, Copilot, Gemini.

The public product name is Workspine. The retained technical contracts remain `gsdd-cli`, `gsdd`, `gsdd-*`, and `.planning/`.

[![npm version](https://img.shields.io/npm/v/gsdd-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd-cli)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

```bash
npx -y gsdd-cli init
```

Use `npx -y gsdd-cli init` for repo-local setup. Use `npx -y gsdd-cli install --global` to install reusable Workspine skills and native runtime surfaces into your agent homes so they are available across repos.

</div>

Tracked consumer proof pack: [docs/proof/consumer-node-cli/README.md](docs/proof/consumer-node-cli/README.md)

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

For agent continuity across long sessions, `gsdd next` reads `.work/` plus repo truth and emits the next coherent action as a structured packet. Use `gsdd next --init` to bootstrap `.work`; plain `gsdd next` is read-only. Captured stdout defaults to JSON; use `gsdd next --format human` for the compact supervisor card.

`gsdd next` keeps the human surface tight and the agent surface structured. JSON packets include typed `next_action` values for CLI commands, workflow skills, manual review, and user-question gates. Blocking questions, decisions, graph rebuilds, and dogfood findings use explicit subcommands; duplicate question, decision, and dogfood IDs replay as unchanged when the content matches and fail unless `--replace` is passed when the content differs. The continuity graph records answer and supersession edges so future agents can reconstruct decision history without rereading raw transcripts.

Workspine ships 14 workflows. The package and CLI are `gsdd-cli` / `gsdd-*` — retained as the technical contract under the Workspine product name.

---

## What This Is

Workspine gives coding agents a durable workflow spine for work that spans sessions, agents, or runtimes. It does not host a control plane; it writes portable planning and proof artifacts into the repo.

Workspine began as a fork of Get Shit Done and keeps the verification-first delivery spine while stripping runtime lock-in.

---

## Getting Started

### Quickstart

```bash
npx -y gsdd-cli init
```

`init` is the guided install wizard for repo-local setup. It creates `.agents/skills/gsdd-*` workflow entrypoints and the `.planning/bin/gsdd*` helper runtime in the current repo; optional runtime adapters improve native discovery.

Invoke after init:

- Claude Code / OpenCode: slash commands such as `/gsdd-plan`.
- Codex CLI: portable `gsdd-plan` skill reference (`$gsdd-plan`), with `.codex/agents/gsdd-plan-checker.toml` for native checker isolation.
- Cursor / Copilot / Gemini: Use slash commands if your tool discovers `.agents/skills`; if it does not, open `.agents/skills/gsdd-<workflow>/SKILL.md`.

Headless setup is available for CI or scripted installs:

```bash
npx -y gsdd-cli init --auto --tools all
npx -y gsdd-cli init --auto --tools codex --brief path/to/brief.md
```

### Global Agent Install

If `gsdd-cli` is installed globally, install reusable Workspine surfaces into your agent homes:

```bash
npx -y gsdd-cli install --global
npx -y gsdd-cli install --global --tools claude,opencode,codex,copilot
```

When run in a TTY without `--tools`, `install --global` lets you select which agents to install. It does not create `.planning/` in the current repo. It writes Workspine-managed skills, native agent surfaces, and per-runtime manifests under the selected agent homes:

| Target | Global surfaces |
|--------|-----------------|
| Claude Code | `~/.claude/skills`, `~/.claude/commands`, `~/.claude/agents` |
| OpenCode | `~/.agents/skills`, `~/.config/opencode/commands`, `~/.config/opencode/agents` |
| Codex CLI | `~/.agents/skills`, `~/.codex/agents` |
| GitHub Copilot CLI | `~/.agents/skills`, `~/.copilot/agents` |

Install availability is not a parity claim. Claude Code, OpenCode, and Codex CLI remain the directly validated runtimes; GitHub Copilot CLI is available as a qualified global target.

OpenCode honors `OPENCODE_CONFIG_DIR` for commands and agents; Workspine installs portable skills once in the shared agent-compatible global root.

### Which workflow to start with

| Situation | Start here |
|-----------|------------|
| New project, or brownfield work that's broad / milestone-shaped | `gsdd-new-project` — full initializer, runs codebase mapping internally when needed |
| Existing repo, and the change you want to make is already concrete | `gsdd-quick` — bounded-change lane, lighter ceremony |
| Existing repo is unfamiliar or risky and you want a baseline first | `gsdd-map-codebase` — orientation pass before choosing the above |

### Team Use

Commit `.planning/` so the team shares specs, roadmaps, phase plans, and verification reports. Use `commitDocs` in `.planning/config.json` to control whether documentation changes are expected as part of workflow execution. Each developer runs `init --tools <their-tool>` for their own repo-local runtime adapters without changing the shared delivery artifacts.

### What to Track in Git

Track `.planning/`, `.agents/skills/`, and any selected runtime adapters that are part of the team workflow. Track durable `.work/` contract and research files when they define shared milestone truth. Do not track `.planning/.local/` or mutable `.work` runtime files such as `state.json`, graph logs, open questions, evidence manifests, handoff notes, or raw dogfood drafts unless you deliberately export or sanitize them.

---

## Configuration

Use model profiles to tune cost and rigor:

```bash
npx -y gsdd-cli models profile quality   # maximize rigor
npx -y gsdd-cli models profile balanced  # default balance
npx -y gsdd-cli models profile budget    # minimize cost
```

## Troubleshooting

Inside a repo-local `.planning/` workspace, start with `npx -y gsdd-cli health`. It checks local generated runtime surfaces against current render output and reports whether `npx -y gsdd-cli update` can repair drift. To repair or refresh a personal global install, rerun `npx -y gsdd-cli install --global --tools <targets>`. For details, see the [User Guide](docs/USER-GUIDE.md).

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
npx -y gsdd-cli health                  # workspace integrity check
npx -y gsdd-cli update                  # regenerate stale runtime surfaces
npx -y gsdd-cli update --templates      # refresh runtime surfaces and template payloads
npx -y gsdd-cli next --json             # read .work continuity and emit the next action packet
npx -y gsdd-cli next --format human     # show the compact supervisor card
npx -y gsdd-cli next --init             # bootstrap .work continuity state explicitly
npx -y gsdd-cli rigor                   # run planning/document guardrails
npx -y gsdd-cli file-op                 # deterministic repo-local copy/delete helper
npx -y gsdd-cli models profile quality  # maximize review rigor
npx -y gsdd-cli models profile budget   # minimize cost
npx -y gsdd-cli session-fingerprint     # capture session continuity metadata
npx -y gsdd-cli ui-proof                # collect UI proof artifacts
npx -y gsdd-cli control-map             # repo and planning state at a glance
npx -y gsdd-cli closeout-report         # summarize closeout evidence
npx -y gsdd-cli find-phase              # locate a roadmap phase
npx -y gsdd-cli phase-status            # inspect or update phase status
npx -y gsdd-cli verify                  # run verification discipline checks
npx -y gsdd-cli scaffold                # scaffold planning surfaces
npx -y gsdd-cli help                    # print command help
```

Full reference: [User Guide](docs/USER-GUIDE.md) · [Runtime Support](docs/RUNTIME-SUPPORT.md) · [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md)

---

## Credits

Fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), MIT licensed. Original git history retained.

MIT License. See [LICENSE](LICENSE) for details.
