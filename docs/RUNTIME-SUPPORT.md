# Runtime Support Matrix

Workspine is a Spec Driven Development framework with portable multi-runtime workflow surfaces, but the proof bar is not the same for every runtime today.

This matrix is the release-floor truth surface.

Human repo setup and repair commands in this document use `npx -y gsdd-cli ...` because that works without a global install. If you installed `gsdd-cli` globally, the equivalent bare `gsdd ...` command is fine. For cross-repo personal use, `npx -y gsdd-cli install --global --auto` installs reusable Workspine skills and native runtime surfaces into detected agent homes.

The install contract is deliberately skills-first: `npx -y gsdd-cli init` always creates `.agents/skills/gsdd-*` and `.work/bin/gsdd*`; runtime-specific adapters are optional discovery or orchestration helpers layered on top.

Global install is separate from repo bootstrap. It does not create `.work/`; it writes selected runtime surfaces under user-level agent homes and records Workspine ownership in per-runtime manifests.

## Support tiers

### Recorded proof

The workflow contract has recorded repo proof for these runtimes:

- **Claude Code**
- **Codex CLI**
- **OpenCode**

These are the strongest public runtime claims, but they are not broad parity claims across every related app or extension surface.

### Qualified support

These runtimes use the same portable workflow surfaces, but they do not carry equal runtime proof or equal ergonomics today:

- **Cursor**
- **GitHub Copilot**
- **Gemini CLI**

Codex CLI support means the terminal Codex CLI runtime. It does not automatically prove equal behavior in the Codex VS Code extension or Codex app; for those surfaces, use native discovery when available or open/paste the generated skill file manually.

### Fallback / manual use

Any tool that can read the generated markdown workflows can still use the framework manually, but that is outside the current native-proof story.

## Current runtime surfaces

Two surfaces matter for users:

- `.agents/skills/gsdd-*` is the shared workflow entry surface. Depending on the runtime, users invoke those workflows as `/gsdd-*`, `$gsdd-*`, or by opening the skill markdown directly.
- `.work/bin/gsdd*` is an internal local helper surface used by workflow-embedded lifecycle mechanics after init. It is not the primary user entry surface.

| Runtime | Current claim | Entry surface | Notes |
| --- | --- | --- | --- |
| Claude Code | Recorded proof | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` | Native surface has recorded lifecycle evidence; installed generated files are freshness-checked locally |
| OpenCode | Recorded proof | `.opencode/commands/`, `.opencode/agents/` | Native command and checker path; installed generated files are freshness-checked locally |
| Codex CLI | Recorded proof | `.agents/skills/gsdd-*` plus `.codex/agents/gsdd-plan-checker.toml` | Portable skill entry, native checker adapter, recorded lifecycle evidence, and generated-surface freshness checks |
| Codex VS Code / app | Fallback only | `.agents/skills/gsdd-*` opened or pasted manually unless discovery is available | Separate product surface from Codex CLI; no equal runtime-proof claim |
| Cursor | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; generated skill files are freshness-checked locally, but the runtime is not claimed as parity-validated |
| GitHub Copilot | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; generated skill files are freshness-checked locally, but the runtime is not claimed as parity-validated |
| Gemini CLI | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; governance is optional, generated skill files are freshness-checked locally, and parity is not claimed |

## Global install surfaces

`npx -y gsdd-cli install --global --auto` can install personal cross-repo surfaces for detected agent homes. Use `npx -y gsdd-cli install --global --tools <targets>` to override detection explicitly. Supported targets:

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

- `npx -y gsdd-cli health` compares generated surfaces in the current repo-local `.work/` workspace under `.agents/skills/`, `.work/bin/`, `.claude/`, `.opencode/`, and `.codex/` against current render output.
- Workflow-internal deterministic helper commands run through `node .work/bin/gsdd.mjs ...`.
- `npx -y gsdd-cli update` regenerates drifted generated surfaces from the authored workflow and delegate sources.
- Bare `gsdd health` and `gsdd update` are equivalent only when `gsdd-cli` is globally installed.
- Missing generated surfaces are not treated as drift unless the corresponding runtime surface is actually installed locally.
- Global user-home installs are refreshed by rerunning `npx -y gsdd-cli install --global --auto` or explicitly scoped with `npx -y gsdd-cli install --global --tools <targets>`; global runtime probes remain an internal pressure-harness concern, not a public install flag.

## Entry and helper surfaces

- `.agents/skills/gsdd-*/SKILL.md` is the compact open-standard workflow entry surface. Agents read these files to know what workflow to run.
- `.work/bin/gsdd.mjs` is the internal repo-local helper runtime. Generated workflows use `node .work/bin/gsdd.mjs ...` for deterministic file, lifecycle, and status helpers instead of depending on an ambient global binary.
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
- `npx -y gsdd-cli health` / `npx -y gsdd-cli update` (or bare `gsdd ...` when globally installed)
