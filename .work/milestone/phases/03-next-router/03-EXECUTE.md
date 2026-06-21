# Phase 3 Execute Packet

## Implemented

- Added `bin/lib/next.mjs` with packet builders and state router.
- Wired `next` into `bin/gsdd.mjs` and runtime help.
- Added JSON and human output modes.
- Added routing for `ask_user`, `research`, `plan`, `execute`, `verify`, `audit`, `fix_gaps`, `dogfood`, `pause`, `blocked`, and `complete`.

## Files

- `bin/lib/next.mjs`
- `bin/gsdd.mjs`
- `bin/lib/init-runtime.mjs`
- `README.md`
- `tests/gsdd.next.test.cjs`

## Verify

- `rtk node bin/gsdd.mjs next --json`
- `rtk node bin/gsdd.mjs next`
- `rtk node --test --test-reporter=spec tests/gsdd.next.test.cjs`
