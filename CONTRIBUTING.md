# Contributing

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
Every commit that lands on `main` must follow this format:

```
<type>(<optional scope>): <description>
```

### Types and semver effect

| Type | Bump | When |
|------|------|------|
| `feat` | minor | New user-visible capability |
| `fix` | patch | Bug fix |
| `perf` | patch | Performance improvement |
| `revert` | patch | Reverts a previous commit |
| `feat!` / `BREAKING CHANGE:` footer | minor (pre-1.0) | API break |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | none | No release triggered |

`chore(release):` is written by the release bot — do not use it manually.

Do not manually bump `package.json` versions or run `npm publish` from a local checkout or feature branch. Releases are cut from `main` by the `Release` GitHub Actions workflow through semantic-release, npm trusted publishing, and Conventional Commits.

## Running tests

Node 22 or newer. `engines.node` in package.json is `>=22`, so an older runtime is not supported.

```bash
node tests/run-all.cjs
```

There is deliberately no `npm test` script: `tests/` is
excluded from the published tarball, so an `npm test` on an installed package would fail. The guard
is `tests/gsdd.invariants.test.cjs:1870`. The suite ran in 208
seconds on 2026-08-19 across 25 files. There is no faster subset target; `scripts` holds
only `prepublishOnly`.

## Git hooks

A fresh clone must run this once before its first commit:

```bash
git config core.hooksPath .githooks
```

Git deliberately does not enable hooks from a clone. Nothing under `.git/hooks/` is
fetched, and repository config is not fetched either, so `core.hooksPath` is a local
setting every contributor sets for themselves. Cloning this repo and committing without
running that command means the hook does not run.

The tracked hook is `.githooks/commit-msg`. It strips three things from the commit
message before the commit is written: a `Claude-Session:` trailer pointing at a
claude.ai URL, a `Co-Authored-By: Claude` trailer, and a `Generated with [Claude Code]`
line. It then collapses the blank lines the removal left behind and exits 0, so it never
blocks a commit; it only edits the message.

This implements the owner standing order of 2026-08-19: no agent-session trailer appears
in any commit in this repository, ever.

The hook is a convenience, not the rule. The standing order is the rule. A contributor
whose hook is not installed, or who commits through a tool that bypasses hooks, is still
bound by it and is responsible for the message being clean. Do not treat a passing commit
as evidence the hook ran.
