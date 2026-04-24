# Runtime Support Matrix

Workspine is designed as a portable multi-runtime delivery framework, but the proof bar is not the same for every runtime today.

This matrix is the release-floor truth surface.

Human setup and repair commands in this document use `npx -y gsdd-cli ...` because that works without a global install. If you installed `gsdd-cli` globally, the equivalent bare `gsdd ...` command is fine.

## Support tiers

### Directly validated

The workflow contract has direct repo proof for these runtimes:

- **Claude Code**
- **Codex CLI**
- **OpenCode**

These are the strongest public runtime claims.

### Qualified support

These runtimes use the same portable workflow surfaces, but this release does not claim equal runtime proof or equal ergonomics:

- **Cursor**
- **GitHub Copilot**
- **Gemini CLI**

Codex CLI support means the terminal Codex CLI runtime. It does not automatically prove equal behavior in the Codex VS Code extension or Codex app; for those surfaces, use native discovery when available or open/paste the generated skill file manually.

### Fallback / manual use

Any tool that can read the generated markdown workflows can still use the framework manually, but that is outside the current native-proof story.

## Current runtime surfaces

| Runtime | Current claim | Entry surface | Notes |
| --- | --- | --- | --- |
| Claude Code | Directly validated | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` | Native surface has direct lifecycle evidence; installed generated files are freshness-checked locally |
| OpenCode | Directly validated | `.opencode/commands/`, `.opencode/agents/` | Native command and checker path; installed generated files are freshness-checked locally |
| Codex CLI | Directly validated | `.agents/skills/gsdd-*` plus `.codex/agents/gsdd-plan-checker.toml` | Portable skill entry, native checker adapter, direct lifecycle evidence, and generated-surface freshness checks |
| Codex VS Code / app | Fallback only | `.agents/skills/gsdd-*` opened or pasted manually unless discovery is available | Separate product surface from Codex CLI; no equal runtime-proof claim |
| Cursor | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; generated skill files are freshness-checked locally, but the runtime is not claimed as parity-validated |
| GitHub Copilot | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; generated skill files are freshness-checked locally, but the runtime is not claimed as parity-validated |
| Gemini CLI | Qualified support | `.agents/skills/gsdd-*` | Skill/slash path when discovery is available; governance is optional, generated skill files are freshness-checked locally, and parity is not claimed |

## Generated-surface freshness

The authored source contract stays in `distilled/workflows/*`. Generated runtime-facing files are trusted only through deterministic rendering:

- `npx -y gsdd-cli health` compares any installed generated surfaces under `.agents/skills/`, `.planning/bin/`, `.claude/`, `.opencode/`, and `.codex/` against current render output.
- Workflow-internal deterministic helper commands run through `node .planning/bin/gsdd.mjs ...`.
- `npx -y gsdd-cli update` regenerates drifted generated surfaces from the authored workflow and delegate sources.
- Bare `gsdd health` and `gsdd update` are equivalent only when `gsdd-cli` is globally installed.
- Missing generated surfaces are not treated as drift unless the corresponding runtime surface is actually installed locally.

## Entry and helper surfaces

- `.agents/skills/gsdd-*/SKILL.md` is the compact open-standard workflow entry surface. Agents read these files to know what workflow to run.
- `.planning/bin/gsdd.mjs` is the internal repo-local helper runtime. Generated workflows use `node .planning/bin/gsdd.mjs ...` for deterministic file, lifecycle, and status helpers instead of depending on an ambient global binary.
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
