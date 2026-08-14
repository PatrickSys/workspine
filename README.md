<div align="center">

# Workspine

Workspine is a Spec Driven Development framework for AI-assisted software work: planning, checking, execution, verification, and handoff live in the repo. Explicit persisted artifacts let another agent or runtime pick up the work; decisions keep their why.

Proof status: one real consumer lifecycle with Codex checker support. Qualified support: Cursor, Copilot, Gemini.

The public product name is Workspine. The retained technical contracts remain `gsdd-cli`, `gsdd`, `gsdd-*`, and `.work/`.

[![npm version](https://img.shields.io/npm/v/gsdd-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd-cli)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

```bash
npx -y gsdd-cli init
```

Use `npx -y gsdd-cli init` for repo-local setup. For reusable cross-repo surfaces, run `npx -y gsdd-cli install --global` to choose targets interactively, or pass `--tools <targets>` in a fresh/headless home. Use `--auto` to refresh detected existing agent homes.

The public CLI and generated helper show a default-on update notice using sequential/best-effort checks when their contained `.work/.local` cache is writable. There is no lock or cross-process concurrency guarantee. The check is anonymous, uses a two-second timeout and 64 KiB/normalized-version limits, sends no credentials or repository data, and failures never block commands. Use `--no-update-notice` or `GSDD_UPDATE_AWARENESS=0` to opt out. `health` and `update` are network-free; run `npx -y gsdd-cli update` for explicit repair. This notice is limited to the supported public CLI/generated helper: it does not imply a native/TUI startup hook, automatic context transfer, runtime parity, or protection against adversarial concurrent cache-path swaps.

The supported package runtime floor is Node >=22.

</div>

Tracked consumer proof pack: [docs/proof/consumer-node-cli/README.md](docs/proof/consumer-node-cli/README.md)

---

## How it works

`init` places workflow skills in `.agents/skills/` and optionally native adapters for your runtime. Then you run workflows through your agent — each one writes files to the repo:

| Workflow | Writes | What for |
|----------|--------|----------|
| `gsdd-new-project` | `.work/SPEC.md`, `ROADMAP.md` | Define the project and phases |
| `gsdd-plan` | `.work/phases/N/PLAN.md` | Research and review before any code gets written |
| `gsdd-execute` | `.work/phases/N/SUMMARY.md` | Implement the approved plan, nothing more |
| `gsdd-verify` | `.work/phases/N/VERIFICATION.md` | Confirm the plan's claims are actually true |

The discipline: plan first, execute only what's approved, verify before closing. Each phase summary carries forward what was decided, so the next session starts with context instead of from scratch.

For agent continuity across long sessions, explicitly run `gsdd-pause` to write `.work/.continue-here.md`. `gsdd next` then reads that file, `.work/`, and repo truth into a structured, read-only packet; the checkpoint is context beneath PLAN/SPEC/lifecycle/Git truth. Use `gsdd next --init` to bootstrap `.work`; plain `gsdd next` never creates a background compaction or automatic context-transfer hook. Captured stdout defaults to JSON; use `gsdd next --format human` for the compact supervisor card.

`gsdd next` keeps the human surface tight and the agent surface structured. JSON packets include typed `next_action` values for CLI commands, workflow skills, manual review, and user-question gates. Blocking questions, decisions, graph rebuilds, and dogfood findings use explicit subcommands; duplicate question, decision, and dogfood IDs replay as unchanged when the content matches and fail unless `--replace` is passed when the content differs. The continuity graph records answer and supersession edges so future agents can reconstruct decision history without rereading raw transcripts.

Workspine ships 13 workflows. The package and CLI are `gsdd-cli` / `gsdd-*` — retained as the technical contract under the Workspine product name.

---

## What This Is

Workspine gives coding agents a durable workflow for work that spans sessions, agents, or runtimes. There is no hosted service; it writes portable planning and proof artifacts into the repo.

Workspine began as a fork of Get Shit Done and keeps the verification-first workflow while stripping runtime lock-in.

---

## Getting Started

### Quickstart

```bash
npx -y gsdd-cli init
```

This creates:

1. `.work/` — durable workspace with templates, role contracts, and config
2. `.agents/skills/gsdd-*` — compact open-standard workflow entrypoints for agents
3. `.work/bin/gsdd.mjs` — generated internal workflow plumbing for deterministic commands inside generated skills, not a second public package CLI (run helper commands from the repo root)
4. Optional tool-specific adapters you choose in the install wizard (Claude skills/commands/agents, OpenCode commands/agents, Codex CLI agents, optional governance)

Then pick the first workflow lane that matches your situation:

- `gsdd-new-project` for greenfield work, fuzzy brownfield work, or milestone-shaped work
- `gsdd-quick` for a concrete bounded brownfield change
- `gsdd-map-codebase` first when the repo is unfamiliar, risky, or needs a deeper baseline before choosing a lane

In a terminal, `npx -y gsdd-cli init` opens a guided install wizard. If you installed the package globally, `gsdd init` is the equivalent shorthand:

- Step 1: select the runtimes/vendors you want to support
- Step 2: decide separately whether repo-wide `AGENTS.md` governance is worth installing
- Step 3: configure planning defaults in the same guided flow

Portable `.agents/skills/gsdd-*` skills and the repo-local `.work/bin/gsdd.mjs` helper runtime are always generated. The helper is generated internal workflow plumbing, not a second public package CLI. The wizard controls extra native adapters and optional governance, not the portable baseline. Workflow helper commands assume the repo root as the current working directory.
When those generated surfaces exist locally, `npx -y gsdd-cli health` checks them against current render output instead of asking you to trust manual review. If installed globally, `gsdd health` is equivalent.

### Launch Proof Status

- **Recorded proof:** the proof pack below records a full plan -> execute -> verify lifecycle on a real consumer project, including Codex checker support. Claude Code and OpenCode run the same generated workflow surface.
- **Qualified support:** Cursor, Copilot, and Gemini CLI can use the shared `.agents/skills/` surface when their skill or slash discovery sees it; this release does not claim the same runtime proof or ergonomics.
- **Runtime-surface freshness:** Installed generated skills and native adapters are renderer-checked locally; repair stays deterministic through `npx -y gsdd-cli update` or, when globally installed, `gsdd update`.

Start with the public proof pack:

- [Brownfield proof](docs/BROWNFIELD-PROOF.md)
- [Exported consumer proof pack](docs/proof/consumer-node-cli/README.md)
- [Runtime support matrix](docs/RUNTIME-SUPPORT.md)
- [Verification discipline](docs/VERIFICATION-DISCIPLINE.md)

### Quickstart (after init)

Invoke after init:

- Claude Code / OpenCode: slash commands such as `/gsdd-plan`.
- Codex CLI: portable `gsdd-plan` skill reference (`$gsdd-plan`), with `.codex/agents/gsdd-plan-checker.toml` for native checker isolation.
- Cursor / Copilot / Gemini: Use slash commands if your tool discovers `.agents/skills`; if it does not, open `.agents/skills/gsdd-<workflow>/SKILL.md`.

Headless setup is available for CI or scripted installs:

```bash
npx -y gsdd-cli init --auto --tools all
npx -y gsdd-cli init --auto --tools codex --brief path/to/brief.md
```

For repo-local setup, `init --auto` sets the legacy-named `autoAdvance` key only for brief-driven `gsdd-new-project` creation of `SPEC.md` and `ROADMAP.md`. It stops before plan, execute, verify, release, or delivery. This is separate from global-install `--auto`, which refreshes detected existing agent homes.

### Global Agent Install

If `gsdd-cli` is installed globally, install reusable Workspine surfaces into your agent homes:

```bash
npx -y gsdd-cli install --global
npx -y gsdd-cli install --global --auto
npx -y gsdd-cli install --global --tools claude,opencode,codex,copilot
```

For a fresh install, choose targets in the interactive picker or pass `--tools <targets>` explicitly. Use `--auto` for a non-interactive refresh of detected existing agent homes; when none are detected it writes nothing and prints one exact command per supported target. It does not create `.work/` in the current repo. It writes Workspine-managed skills, native agent surfaces, and per-runtime manifests under the selected agent homes:

| Target | Global surfaces |
|--------|-----------------|
| Claude Code | `~/.claude/skills`, `~/.claude/commands`, `~/.claude/agents` |
| OpenCode | `~/.agents/skills`, `~/.config/opencode/commands`, `~/.config/opencode/agents` |
| Codex CLI | `~/.agents/skills`, `~/.codex/agents` |
| GitHub Copilot CLI | `~/.agents/skills`, `~/.copilot/agents` |

Install availability is not a parity claim. Repo proof currently covers Claude Code, OpenCode, and Codex CLI paths; GitHub Copilot CLI is available as a qualified global target.

OpenCode honors `OPENCODE_CONFIG_DIR` for commands and agents; Workspine installs portable skills once in the shared agent-compatible global root.

### Which workflow to start with

| Situation | Start here |
|-----------|------------|
| New project, or brownfield work that's broad / milestone-shaped | `gsdd-new-project` — full initializer, runs codebase mapping internally when needed |
| Existing repo, and the change you want to make is already concrete | `gsdd-quick` — bounded-change lane, lighter ceremony |
| Existing repo is unfamiliar or risky and you want a baseline first | `gsdd-map-codebase` — orientation pass before choosing the above |

### Team Use

Commit `.work/` so the team shares specs, roadmaps, phase plans, and verification reports. Use `commitDocs` in `.work/config.json` to control whether documentation changes are expected as part of workflow execution. Each developer runs `init --tools <their-tool>` for their own repo-local runtime adapters without changing the shared delivery artifacts.

### What to Track in Git

Track `.work/`, `.agents/skills/`, and any selected runtime adapters that are part of the team workflow. Track durable `.work/` contract and research files when they define shared milestone truth. Do not track `.work/.local/` or mutable `.work` runtime files such as `state.json`, graph logs, open questions, evidence manifests, handoff notes, or raw dogfood drafts unless you deliberately export or sanitize them.

---

## Configuration

Model profiles choose model cost and quality. Rigor is a separate configuration axis for workflow alignment and quality gates:

```bash
npx -y gsdd-cli models profile quality   # maximize model quality
npx -y gsdd-cli models profile balanced  # default cost/quality balance
npx -y gsdd-cli models profile budget    # minimize model cost
npx -y gsdd-cli rigor                    # inspect configuration and effective rigor gates
npx -y gsdd-cli rigor high               # update configuration to the high rigor gates
```

`gsdd rigor` inspects or updates configuration; it does not itself run planning or document guardrails.

## Troubleshooting

Inside a repo-local `.work/` workspace, start with `npx -y gsdd-cli health`. It checks local generated runtime surfaces against current render output and reports whether `npx -y gsdd-cli update` can repair drift. To repair or refresh detected existing personal installs, rerun `npx -y gsdd-cli install --global --auto`; in a fresh or explicitly scoped setup use `npx -y gsdd-cli install --global --tools <targets>`. For details, see the [User Guide](docs/USER-GUIDE.md).

---

## Where it fits

Use Workspine when a feature takes more than one session, or when you need to switch between Claude, Codex, and Cursor without losing the thread. Skip it for quick, obvious edits — direct prompting is cheaper when the risk is small.

| Tool | Good for | vs Workspine |
|------|----------|--------------|
| **Workspine** | Work that spans sessions, agents, or runtimes where plans and proof need to stay in the repo | — |
| [GSD](https://github.com/gsd-build/get-shit-done) | Broad AI prompting suite — 81 commands, 78 workflows, 33 agents | Workspine is narrower: 13 workflows, fewer moving parts for the human in the loop |
| [OpenSpec](https://openspec.dev/) | Living spec + change proposals in a lightweight format | Workspine adds the execution, verification, and handoff layer on top of planning |
| [LeanSpec](https://www.lean-spec.dev/docs/guide/first-principles) | Minimal specs that fit LLM context | Workspine adds workflow gates and runtime entrypoints for when you need the full structure |
| [GitHub Spec Kit](https://github.com/github/spec-kit) | Spec-first planning workflows in `.specify/` | Similar space; Workspine is one CLI with one delivery loop instead of a broader ecosystem |
| [Kiro](https://kiro.dev/docs/) | IDE-native agent dev with specs, steering, hooks, and MCP | Kiro is IDE-only; Workspine works across terminal and IDE agents that can read repo files |
| [Tessl](https://tessl.io/enterprise/) | Hosted platform for distributing agent skills across teams | Tessl needs a hosted service; Workspine is local-first with no hosted infrastructure |

<sub>Based on each tool's public docs as of May 2026. Open an issue if anything reads inaccurately.</sub>

---

## CLI

```bash
npx -y gsdd-cli health                  # workspace integrity check
npx -y gsdd-cli git-identity check      # read-only identity check before an owned commit
npx -y gsdd-cli update                  # regenerate stale runtime surfaces
npx -y gsdd-cli update --templates      # refresh runtime surfaces and template payloads
npx -y gsdd-cli next --json             # read .work continuity and emit the next action packet
npx -y gsdd-cli next --format human     # show the compact supervisor card
npx -y gsdd-cli next --init             # bootstrap .work continuity state explicitly
npx -y gsdd-cli journey                 # show the milestone and phase delivery journey, including decisions and mistakes # (experimental)
npx -y gsdd-cli remember "Use direct commits" --type rule --scope repo # (experimental)
npx -y gsdd-cli decisions query "current git flow" --path bin/gsdd.mjs # (experimental)
npx -y gsdd-cli decisions promote <id> --authority owner --approval-ref <non-sensitive-ref> # (experimental)
npx -y gsdd-cli decisions reject <id> --reason "No longer applicable" # (experimental)
npx -y gsdd-cli decisions invalidate <id> --reason "Superseded by the current policy" # (experimental)
npx -y gsdd-cli rigor                   # inspect or update rigor configuration
npx -y gsdd-cli file-op                 # deterministic repo-local copy/delete helper
npx -y gsdd-cli models profile quality  # prefer model quality
npx -y gsdd-cli models profile budget   # minimize cost
npx -y gsdd-cli find-phase              # locate a roadmap phase
npx -y gsdd-cli phase-status            # inspect or update phase status
npx -y gsdd-cli verify                  # run verification discipline checks
npx -y gsdd-cli scaffold                # scaffold planning surfaces
npx -y gsdd-cli help                    # print command help
```

Decision promotion is a cooperative, auditable owner assertion rather than human authentication. The assertion is stored on the same decision record and binds the exact decision id, body hash, authority label, non-sensitive reference, and timestamp. Candidate provenance remains `agent-proposed`; older active records without a complete assertion stay readable but require review until explicitly re-attested. The generated `.work/bin/gsdd.mjs` helper remains candidate/query-only.

Full reference: [User Guide](docs/USER-GUIDE.md) · [Runtime Support](docs/RUNTIME-SUPPORT.md) · [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md)

---

## Credits

Fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), MIT licensed. Original git history retained.

MIT License. See [LICENSE](LICENSE) for details.
