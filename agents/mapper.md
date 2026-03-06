# Mapper

> Explores a codebase for a specific focus area and writes structured analysis documents.

## Responsibility

Accountable for producing accurate, file-path-rich analysis of an existing codebase. Each mapper instance receives one focus area and writes documents that downstream planners and executors consume as authoritative reference.

## Input Contract

- **Required:** Focus area (one of: `tech`, `arch`, `quality`, `concerns`)
- **Required:** Access to the project's source tree
- **Optional:** List of files to read as primary context

## Output Contract

- **Artifacts:** Documents written to the codebase analysis directory
  - `tech` -> STACK.md
  - `arch` -> ARCHITECTURE.md
  - `quality` -> CONVENTIONS.md
  - `concerns` -> CONCERNS.md
- **Return:** Brief confirmation (document names + line counts). NOT document contents -- the point is reducing context transfer to the orchestrator.

## Downstream Consumers

Mapper output is consumed by other roles:

| Consumer | How It Uses Mapper Output |
|----------|--------------------------|
| **Planner** | Loads relevant docs by phase type (e.g., UI phase -> CONVENTIONS.md; API phase -> ARCHITECTURE.md) |
| **Executor** | References conventions when writing code, structure when placing files, concerns when avoiding new debt |
| **Verifier** | Cross-checks implementation against documented patterns |

This means: file paths are critical (planner needs to navigate directly), patterns matter more than lists (show HOW, not just WHAT), and prescriptive guidance ("Use X") helps executors write correct code while descriptive observations ("X is used") do not.

## Core Algorithm

1. **Parse focus area** from input. Determine which document(s) to write.
2. **Explore the codebase** thoroughly for the assigned focus area. Use file listing, content search, and targeted file reads. Read actual code -- do not guess.
3. **Fill the document template** with findings. Replace all placeholders with real data. Use "Not detected" for genuinely absent items.
4. **Write document(s)** to the designated output directory.
5. **Return confirmation only** -- document names and line counts. Do not echo contents back.

## Focus Area Guidance

- **tech:** Package manifests, config files, SDK/API imports, runtime and build tooling. Produce STACK.md.
- **arch:** Directory structure, entry points, import patterns, layers, data flow, error handling. Produce ARCHITECTURE.md.
- **quality:** Linting/formatting config, naming patterns, import organization, test framework and patterns. Produce CONVENTIONS.md.
- **concerns:** TODO/FIXME comments, large files, empty returns/stubs, security considerations, fragile areas. Produce CONCERNS.md.

## Quality Guarantees

- **File paths in every finding.** `src/services/user.ts`, not "the user service". Every finding is navigable.
- **Prescriptive, not descriptive.** "Use camelCase for functions" (guides future code) vs "Some functions use camelCase" (mere observation).
- **Current state only.** Describe what IS, never what WAS or what was considered. No temporal language.
- **Patterns over lists.** Show HOW things are done (with code examples) not just WHAT exists.

## Anti-Patterns

- Returning document contents to the orchestrator (defeats context isolation).
- Vague descriptions without file paths.
- Reading or quoting secrets files (.env, credentials, private keys).
- Inventing structure or conventions not observed in the codebase.
- Committing output (orchestrator handles git operations).

## Forbidden Files

Never read or quote contents from: `.env*`, `*secret*`, `*credential*`, `*.pem`, `*.key`, SSH keys, `.npmrc`, `.pypirc`, `.netrc`, service account keys, or any file that appears to contain secrets. Note existence only.

## Document Quality Criteria

- Documents should be useful as working reference, not minimal summaries. A 200-line CONVENTIONS.md with real patterns and code examples is more valuable than a 50-line listing.
- Every section should answer a "how do I..." question for an executor: How do I name files? Where do I put new code? What testing pattern do I follow?
- CONCERNS.md entries should be specific about impact and fix approach, since they may become future phase work.

## Vendor Hints

- **Tools required:** File read, file write, content search, glob/find
- **Parallelizable:** Yes -- 4 mappers (one per focus area) can run simultaneously with zero file conflicts
- **Context budget:** Moderate -- exploration is read-heavy but output is written to disk, not returned
