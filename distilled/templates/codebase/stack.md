# Codebase Stack

**Analysis Date:** [YYYY-MM-DD]

<guidelines>
- List versions only when they matter (compatibility, breaking changes, reproducibility).
- Prefer commands and sources of truth (package.json, lockfiles, tool config) over memory.
- Capture the minimum needed for another agent to run, test, and ship changes safely.
- Include concrete commands and file paths.
</guidelines>

## Languages

Primary:
- [Language] [Version if relevant] - used in: `[paths]`

Secondary:
- [Language] [Version if relevant] - used in: `[paths]`

## Runtime

Environment:
- [Runtime] [Version if relevant]

Package manager:
- [Manager] [Version if relevant]
- Lockfile: [present/missing] - `[path]`

## Frameworks And Tooling

Core framework(s):
- [Framework] [Version if relevant] - purpose: [purpose]

Testing:
- [Tool] [Version if relevant] - purpose: [purpose]

Build / dev:
- [Tool] [Version if relevant] - purpose: [purpose]

Lint / format:
- [Tool] - config: `[path]`

## Key Dependencies (Only What Drives Architecture)

Critical libraries:
- [Package] - why it matters: [reason] - examples: `[paths]`

Infra/observability:
- [Package] - purpose: [reason] - config: `[paths]`

## Must-Know Packages

Flag 3–5 packages that new contributors must understand before making changes. These are not necessarily the most-used packages — they are the ones where misuse causes hard-to-debug problems.

Each entry: `package-name — why it's critical — risk: low|medium|high — common mistake: what goes wrong`

Risk levels: low (causes build errors — immediately visible), medium (causes runtime bugs — visible in testing), high (causes data corruption or silent failures — hard to detect).

- `[package]` — [why critical] — risk: [level] — common mistake: [what goes wrong]
- `[package]` — [why critical] — risk: [level] — common mistake: [what goes wrong]
- `[package]` — [why critical] — risk: [level] — common mistake: [what goes wrong]

## How To Run

Install:
- Command(s): `[commands]`

Dev:
- Command(s): `[commands]`

Test:
- Command(s): `[commands]`

Build:
- Command(s): `[commands]`

## Configuration

Env:
- How configured: [dotenv, env vars, config files]
- Key config files: `[paths]`

CI/CD:
- CI location: `[path]`
- Main checks: [list]

<good_examples>
Example (good):
- "Node 20, pnpm. Install: `pnpm i`. Tests: `pnpm test` (Vitest) + `pnpm test:e2e` (Playwright). Formatting: Prettier (`.prettierrc`). Lint: ESLint (`eslint.config.mjs`)."
- "DB migrations run via `pnpm db:migrate` (see `package.json` scripts)."
</good_examples>

---

*Stack analysis: [date]*
