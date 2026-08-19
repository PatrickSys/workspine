# Runtime Support Matrix

Workspine is a Spec Driven Development framework with portable multi-runtime workflow surfaces, but the proof bar is not the same for every runtime today.

This matrix is the release-floor truth surface.

The package runtime floor is Node >=22. Update awareness is limited to the supported public CLI/generated helper, and within it to commands that already write to `.work/`; read-only commands such as `next` and `verify` never check or cache. It uses sequential/best-effort anonymous metadata checks, with no lock or cross-process concurrency guarantee, a two-second timeout, 64 KiB/normalized-version limits, no credentials or repository data, and a contained `.work/.local` cache with nonblocking failures. Use `--no-update-notice` or `GSDD_UPDATE_AWARENESS=0` to opt out. `health` and `update` are network-free; run `npx -y workspine update` for explicit repair. No native/TUI startup hook, automatic context transfer, runtime parity, or protection against adversarial concurrent cache-path swaps is implied.

Human repo setup and repair commands in this document use `npx -y workspine ...` because that works without a global install. If you installed `workspine` globally, the equivalent bare `gsdd ...` command is fine. For fresh cross-repo setup, run `npx -y workspine install --global` interactively or pass `--tools <targets>`; use `--auto` to refresh detected existing agent homes.

The install contract is deliberately skills-first: `npx -y workspine init` always creates `.agents/skills/gsdd-*` and `.work/bin/gsdd*`; runtime-specific adapters are optional discovery or orchestration helpers layered on top.

Global install is separate from repo bootstrap. It does not create `.work/`; it writes selected runtime surfaces under user-level agent homes and records Workspine ownership in per-runtime manifests.

## Support tiers

### Recorded proof

One end-to-end lifecycle run is recorded, on Codex CLI:

- Codex CLI

That run is the strongest public runtime claim here, and it covers the terminal Codex CLI runtime only.

### Generated-surface proof

These runtimes receive the same generated skill and adapter files, freshness-checked locally against current render output. No end-to-end run of theirs is recorded here:

- Claude Code
- OpenCode

### Qualified support

These runtimes read the same portable workflow surfaces; none is claimed as parity-validated, and ergonomics vary:

- Cursor
- GitHub Copilot
- Gemini CLI

Codex CLI support means the terminal Codex CLI runtime. It does not automatically prove equal behavior in the Codex VS Code extension or Codex app; for those surfaces, use native discovery when available or open/paste the generated skill file manually.

### Fallback / manual use

Any tool that can read the generated markdown workflows can still use the framework manually, but that is outside the current native-proof story.

## Current runtime surfaces

Two surfaces matter for users:

- `.agents/skills/gsdd-*` is the shared workflow entry surface. Depending on the runtime, users invoke those workflows as `/gsdd-*`, `$gsdd-*`, or by opening the skill markdown directly.
- `.work/bin/gsdd*` is an internal local helper surface used by workflow-embedded lifecycle mechanics after init; the primary user entry surface remains `.agents/skills/gsdd-*` above.

| Runtime | Current claim | Entry surface | Notes |
| --- | --- | --- | --- |
| Claude Code | Generated-surface proof | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` | Native adapter surface is generated and freshness-checked locally; no recorded end-to-end run |
| OpenCode | Generated-surface proof | `.opencode/commands/`, `.opencode/agents/` | Native command and checker path, generated and freshness-checked locally; no recorded end-to-end run |
| Codex CLI | Recorded proof | `.agents/skills/gsdd-*` plus `.codex/agents/gsdd-plan-checker.toml` | Portable skill entry, native checker adapter, recorded lifecycle evidence, and generated-surface freshness checks |
| Codex VS Code / app | Fallback only | `.agents/skills/gsdd-*` opened or pasted manually unless discovery is available | Separate product surface from Codex CLI; no equal runtime-proof claim |
| Cursor | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; generated skill files are freshness-checked locally |
| GitHub Copilot | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; generated skill files are freshness-checked locally |
| Gemini CLI | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; governance is optional and generated skill files are freshness-checked locally |

## Global install surfaces

For a fresh install, choose targets interactively or run `npx -y workspine install --global --tools <targets>`. Use `npx -y workspine install --global --auto` to refresh detected existing agent homes; when none are detected it writes nothing and prints exact explicit commands. Supported target IDs are `claude,opencode,codex,copilot`:

| Target | Global surfaces |
| --- | --- |
| Claude Code | `~/.claude/skills`, `~/.claude/commands`, `~/.claude/agents` |
| OpenCode | `~/.agents/skills`, `~/.config/opencode/commands`, `~/.config/opencode/agents` |
| Codex CLI | `~/.agents/skills`, `~/.codex/agents` |
| GitHub Copilot CLI | `~/.agents/skills`, `~/.copilot/agents` |

Install availability is not a parity claim. GitHub Copilot CLI can receive global Workspine surfaces, but it remains in the qualified-support tier unless the release-floor proof for Copilot is raised deliberately.

When `OPENCODE_CONFIG_DIR` is set, OpenCode commands and agents are installed under that custom config root. Skills remain under the shared agent-compatible global root (`~/.agents/skills`), which OpenCode, Codex CLI, and GitHub Copilot CLI can all discover.

## Repo-Local Generated-Surface Freshness

The authored source contract stays in `distilled/workflows/*`. Generated runtime-facing files are trusted only through deterministic rendering:

- `npx -y workspine health` compares generated surfaces in the current repo-local `.work/` workspace under `.agents/skills/`, `.work/bin/`, `.claude/`, `.opencode/`, and `.codex/` against current render output.
- Workflow-internal deterministic helper commands run through `node .work/bin/gsdd.mjs ...`.
- `npx -y workspine update` regenerates drifted generated surfaces from the authored workflow and delegate sources.
- Bare `gsdd health` and `gsdd update` are equivalent only when `workspine` is globally installed.
- Missing generated surfaces are not treated as drift unless the corresponding runtime surface is actually installed locally.
- Detected existing global installs are refreshed by rerunning `npx -y workspine install --global --auto`; fresh or explicitly scoped installs use `npx -y workspine install --global --tools <targets>`. Global runtime probes remain an internal pressure-harness concern, not a public install flag.

## Entry and helper surfaces

- `.agents/skills/gsdd-*/SKILL.md` is the compact open-standard workflow entry surface. Agents read these files to know what workflow to run.
- `.work/bin/gsdd.mjs` is the internal repo-local helper runtime. Generated workflows use `node .work/bin/gsdd.mjs ...` for deterministic file/lifecycle/status helpers instead of depending on an ambient global binary.
- Native adapter and governance surfaces are optional ergonomics. They can improve discovery or routing in a specific runtime, but they are not required for the portable workflow contract.

## What stays portable

The portable invariant for this release is the workflow contract:

- planning
- checking and revision loops
- execution discipline
- verification
- handoff and durable repo artifacts

## What does not stay equal yet

This release does **not** claim that every runtime has:

- the same native adapter richness
- the same invocation ergonomics
- the same validation depth
- the same checker/orchestration mechanics

Portable contract does not mean equal UX everywhere.

## Proof references

- `README.md`
- `docs/BROWNFIELD-PROOF.md`
- `docs/proof/consumer-node-cli/README.md`
- `docs/VERIFICATION-DISCIPLINE.md`
- `npx -y workspine health` / `npx -y workspine update` (or bare `gsdd ...` when globally installed)
