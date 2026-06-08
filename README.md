<div align="center">

# Workspine

A repo-native delivery spine for the part of AI coding that still needs human judgment: planning, checking, execution, verification, and handoff.

Workspine keeps plans, decisions, proof, and handoff state in the repo so another session, agent, or runtime can continue from repo truth instead of chat memory.

[![npm version](https://img.shields.io/npm/v/gsdd-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/gsdd-cli)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

```bash
npx -y gsdd-cli init
```

Directly validated today: Claude Code, Codex CLI, OpenCode.
Qualified support: Cursor, Copilot, Gemini can use the shared skills surface when their skill or slash discovery sees it; proof and ergonomics differ from the directly validated runtimes.

</div>

---

## What This Is

Workspine is a small set of workflow sources plus the `gsdd` CLI. It creates:

- `.planning/` for specs, roadmaps, phase plans, summaries, verification reports, and handoff state.
- `.agents/skills/gsdd-*/SKILL.md` as the portable workflow entry surface.
- `.planning/bin/gsdd.mjs` as the repo-local helper runtime for deterministic commands from the repo root.
- Optional runtime adapters for tools that benefit from native surfaces.

Workspine ships 14 workflows. The product name is Workspine, while the package, CLI commands, workflow prefixes, and workspace directory remain `gsdd-cli`, `gsdd`, `gsdd-*`, and `.planning/` - these are retained technical contracts, not rename residue.

Workspine began as a fork of Get Shit Done, whose long-horizon delivery spine proved the problem was real. Workspine keeps that useful discipline while narrowing the public surface around repo-native planning, execution, verification, and handoff.

Launch proof posture:

- Directly validated in repo truth: Claude Code, Codex CLI, OpenCode.
- Qualified support only: Cursor, Copilot, Gemini can use `.agents/skills/` plus optional governance when skill or slash discovery is available.
- Codex CLI is separate from Codex VS Code and the Codex app; use native discovery there when available, otherwise open or paste `.agents/skills/gsdd-*/SKILL.md`.
- Generated runtime surfaces are checked by `gsdd health` against current render output and repaired deterministically with `npx -y gsdd-cli update`.
- Public proof entrypoints: [Brownfield Proof](docs/BROWNFIELD-PROOF.md), [consumer proof pack](docs/proof/consumer-node-cli/README.md), [Runtime Support](docs/RUNTIME-SUPPORT.md), and [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md).

## Getting Started

### Quickstart

Run the guided install wizard in a project root:

```bash
npx -y gsdd-cli init
```

Then invoke workflows through your agent:

- Claude Code / OpenCode: use slash commands such as `/gsdd-plan`.
- Codex CLI: use skill references such as `$gsdd-plan`.
- Cursor / Copilot / Gemini: Use slash commands if your tool discovers them; if it does not, open `.agents/skills/gsdd-<workflow>/SKILL.md`.
- Any other agent: open the matching `SKILL.md` file directly.

Headless setup is available for scripts and prepared briefs:

```bash
npx -y gsdd-cli init --auto --tools codex --brief brief.md
```

### Invoke Through Your Agent

| Runtime | How |
|---------|-----|
| Claude Code / OpenCode | `/gsdd-plan` slash command |
| Codex CLI | `$gsdd-plan` skill reference; Codex uses the portable `gsdd-plan` entry and can add a native checker agent at `.codex/agents/gsdd-plan-checker.toml` |
| Codex VS Code / app | Native discovery if available; otherwise open or paste the generated `SKILL.md` |
| Cursor / Copilot / Gemini | `/gsdd-plan` slash command when skill/slash discovery is available; if it is not, open `.agents/skills/gsdd-<workflow>/SKILL.md` |
| Any other agent | Open `.agents/skills/gsdd-plan/SKILL.md` |

### Which Workflow To Start With

| Situation | Start here |
|-----------|------------|
| New project, broad brownfield work, or milestone-shaped work | `gsdd-new-project` |
| Existing repo with a concrete bounded change | `gsdd-quick` |
| Unfamiliar or risky repo where you want orientation first | `gsdd-map-codebase` |

### Team Use

Commit shared planning artifacts when `commitDocs` is enabled for the team. Developers can regenerate their own runtime adapters with `npx -y gsdd-cli init --tools <runtime>` without changing the shared delivery state.

### What to Track in Git

Track `.planning/SPEC.md`, `.planning/ROADMAP.md`, phase plans, summaries, verification reports, and public proof docs. Treat `.planning/.local/`, local browser captures, unsafe screenshots, and machine-specific runtime artifacts as local-only unless a plan explicitly narrows and approves publication.

## Workflow

```text
npx -y gsdd-cli init       -> bootstrap .planning/, skills, and optional adapters
/gsdd-new-project          -> create SPEC.md and ROADMAP.md
/gsdd-plan N               -> create a reviewed phase plan
/gsdd-execute N            -> implement the approved plan
/gsdd-verify N             -> verify before closing the phase
/gsdd-audit-milestone      -> check cross-phase integration
/gsdd-complete-milestone   -> archive and evolve the roadmap
/gsdd-new-milestone        -> begin the next milestone
/gsdd-quick                -> bounded task outside the phase cycle
/gsdd-pause                -> write a checkpoint
/gsdd-resume               -> restore context and route next action
/gsdd-progress             -> report status without mutating files
```

## Configuration

Use model profiles to trade cost against review depth:

```bash
npx -y gsdd-cli models profile quality   # maximize review rigor
npx -y gsdd-cli models profile balanced  # default balance
npx -y gsdd-cli models profile budget    # minimize cost
npx -y gsdd-cli rigor thorough           # raise planning/review rigor
```

`npx -y gsdd-cli health` checks generated runtime surfaces against current render output. If surfaces drift, repair them with `npx -y gsdd-cli update` or regenerate only templates with `npx -y gsdd-cli update --templates`.

## CLI Commands

| Command | Purpose |
|---------|---------|
| `npx -y gsdd-cli init` | Guided install wizard and headless initialization |
| `npx -y gsdd-cli update --templates` | Regenerate installed runtime surfaces and templates |
| `npx -y gsdd-cli models` | Inspect or set model profiles |
| `npx -y gsdd-cli rigor` | Set workflow rigor defaults |
| `npx -y gsdd-cli health` | Check workspace integrity and generated-surface freshness |
| `npx -y gsdd-cli ui-proof validate` | Validate UI proof metadata |
| `npx -y gsdd-cli ui-proof compare` | Compare planned UI proof slots to observed bundles |
| `npx -y gsdd-cli control-map` | Show repo, worktree, and planning state |
| `npx -y gsdd-cli closeout-report` | Replay closeout blockers, warnings, and next action |
| `npx -y gsdd-cli find-phase` | Resolve a phase number or title |
| `npx -y gsdd-cli phase-status` | Update ROADMAP phase status deterministically |
| `npx -y gsdd-cli verify` | Run direct phase verification helpers |
| `npx -y gsdd-cli scaffold` | Scaffold planning artifacts for tests or fixtures |
| `npx -y gsdd-cli session-fingerprint` | Compute a local session fingerprint |
| `npx -y gsdd-cli file-op` | Run deterministic file copy/delete helpers used by generated workflows |
| `npx -y gsdd-cli help` | Show CLI help |

`ui-proof validate` and `ui-proof compare` also understand optional browser runtime capture annotations, so plans can record provider choice, screenshot/snapshot modes, budgets, and fallback reasons without installing browser tooling by default.

Full reference: [User Guide](docs/USER-GUIDE.md), [Runtime Support](docs/RUNTIME-SUPPORT.md), [Verification Discipline](docs/VERIFICATION-DISCIPLINE.md).

## Troubleshooting

Start with:

```bash
npx -y gsdd-cli health
```

If health reports stale generated surfaces, run `npx -y gsdd-cli update`. For command usage and recovery examples, see the [User Guide](docs/USER-GUIDE.md).

## Credits

Workspine began as a fork of [Get Shit Done](https://github.com/gsd-build/get-shit-done) by [Lex Christopherson](https://github.com/glittercowboy), MIT licensed. Original git history retained.

MIT License. See [LICENSE](LICENSE) for details.
