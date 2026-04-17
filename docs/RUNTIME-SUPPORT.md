# Runtime Support Matrix

Workspine is designed as a portable multi-runtime delivery framework, but the proof bar is not the same for every runtime today.

This matrix is the release-floor truth surface.

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

### Fallback / manual use

Any tool that can read the generated markdown workflows can still use the framework manually, but that is outside the current native-proof story.

## Current runtime surfaces

| Runtime | Current claim | Entry surface | Notes |
| --- | --- | --- | --- |
| Claude Code | Directly validated | `.claude/skills/`, `.claude/commands/`, `.claude/agents/` | Native surface was a mandatory Phase 32 validation target; installed generated files are freshness-checked locally |
| OpenCode | Directly validated | `.opencode/commands/`, `.opencode/agents/` | Native command and checker path; installed generated files are freshness-checked locally |
| Codex CLI | Directly validated | `.agents/skills/gsdd-*` plus `.codex/agents/gsdd-plan-checker.toml` | Portable skill entry, native checker adapter, mandatory Phase 32 validation target |
| Cursor | Qualified support | `.agents/skills/gsdd-*` | Skills-native path; generated skill files are freshness-checked locally, but the runtime is not claimed as parity-validated |
| GitHub Copilot | Qualified support | `.agents/skills/gsdd-*` | Skills-native path; generated skill files are freshness-checked locally, but the runtime is not claimed as parity-validated |
| Gemini CLI | Qualified support | `.agents/skills/gsdd-*` | Skills-native path; governance is optional, generated skill files are freshness-checked locally, and parity is not claimed |

## Generated-surface freshness

The authored source contract stays in `distilled/workflows/*`. Generated runtime-facing files are trusted only through deterministic rendering:

- `gsdd health` compares any installed generated surfaces under `.agents/skills/`, `.claude/`, `.opencode/`, and `.codex/` against current render output.
- `gsdd update` regenerates drifted generated surfaces from the authored workflow and delegate sources.
- Missing generated surfaces are not treated as drift unless the corresponding runtime surface is actually installed locally.

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
- `gsdd health` / `gsdd update`
