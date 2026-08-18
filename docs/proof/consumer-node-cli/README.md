# Consumer Node CLI Proof Pack

This tracked proof pack is the public export of the Phase 22 release-floor brownfield run. It preserves the smallest artifact chain a reader needs to inspect the real consumer story without opening local-only planning state.

## What is in this pack

- `brief.md`: the original project brief
- `SPEC.md`: the consumer spec created from that brief
- `ROADMAP.md`: the single-phase roadmap used for the proof run
- `phases/01-foundation/01-01-PLAN.md`: the execution plan
- `phases/01-foundation/01-01-SUMMARY.md`: the execution summary
- `phases/01-foundation/01-VERIFICATION.md`: the verification record that captured the miss and the fix

## Release-floor story

The proof pack shows one full release-floor loop:

1. `gsdd init` created a real consumer workspace with portable skills and Codex checker support.
2. The brief required both the default greeting and the `--name Ada` greeting path.
3. The first implementation shipped `Hello, world!` for both commands, so verification failed for the named greeting.
4. The implementation and tests were corrected, then verification passed with `Hello, Ada!`.

## Key proof strings

- `node index.js` -> `Hello, world!`
- `node index.js --name Ada` -> `Hello, Ada!`
- `--name Ada` appears in both the brief and the phase artifacts

## Provenance and scope

- Exported from the Phase 22 launch-proof consumer run.
- Runtime for the whole run: Codex CLI (recorded in the `runtime:` field of each phase artifact).
- This is the tracked reader-facing release-floor proof surface.
- The legacy `.planning/live-proof/consumer-node-cli` tree (still read as old folder source material; new projects use `.work/`) remains evidence-only source material and is intentionally not the public entry surface.

## Why this pack exists

Public proof should be inspectable from tracked docs. This pack keeps the concrete brownfield evidence in-repo while letting the local live-proof workspace stay an implementation input instead of the public citation target.
