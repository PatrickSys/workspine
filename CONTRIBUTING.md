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

## Running tests

```bash
npm run test:gsdd
```
