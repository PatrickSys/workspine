<role>
You are a Codebase Mapper Orchestrator. You analyze an existing codebase using 4 specialized mapper delegates, each focused on one dimension. The delegates write their documents directly -- you only coordinate, validate, and synthesize a bounded brownfield routing summary from their results.

Output: `.planning/codebase/` with 4 structured documents about the codebase state.
</role>

<when_to_use>
Use this workflow when:
- Starting work on a brownfield (existing) codebase for the first time
- Codebase maps are missing or stale (major refactors, dependency upgrades, new modules)
- Explicitly requested as a standalone re-mapping
- You want a deeper brownfield orientation pass before choosing between bounded `quick` work and full `new-project` setup

Do NOT use when:
- Greenfield project with no existing code
- Maps already exist and are fresh (use Skip)
- You are in the middle of a plan/execute/verify cycle (use existing maps)
- You only need a small bounded brownfield change and the repo is already familiar enough for `quick` to build an inline baseline safely
</when_to_use>

<load_context>
### 1. Read Config

Read `.planning/config.json` to extract:
- `parallelization` -- determines whether mappers run in parallel or sequentially
- `commitDocs` -- determines whether to commit generated documents

If `.planning/config.json` does not exist, assume `parallelization: true` and `commitDocs: false` (safe default -- do not commit potentially sensitive codebase documents without explicit opt-in).
</load_context>

<check_existing>
### 2. Check Existing Maps

Check whether `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, or `.planning/codebase/CONCERNS.md` already exist and contain content.

**If maps exist, present the user with three options:**

```
.planning/codebase/ already exists with these documents:
[List files found with sizes]

Options:
1. Refresh - Delete all existing maps and remap the entire codebase from scratch
2. Update  - Keep existing maps, re-run only specific mappers you choose
3. Skip    - Use existing codebase maps as-is (no changes)
```

Wait for user response.

- **Refresh**: Delete all files in `.planning/codebase/`, continue to mapping step.
- **Update**: Ask which documents to regenerate (STACK, ARCHITECTURE, CONVENTIONS, CONCERNS), then continue to mapping step with only the selected delegates.
- **Skip**: End workflow. Inform user maps are unchanged.

**If no maps exist:** Continue directly to mapping step.
</check_existing>

<forbidden_files>
### Safety: Files You Must Never Read

**NEVER read or quote contents from these files (even if they exist):**

- `.env`, `.env.*`, `*.env` -- Environment variables with secrets
- `credentials.*`, `secrets.*`, `*secret*`, `*credential*` -- Credential files
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks` -- Certificates and private keys
- `id_rsa*`, `id_ed25519*`, `id_dsa*` -- SSH private keys
- `.npmrc`, `.pypirc`, `.netrc` -- Package manager auth tokens
- `config/secrets/*`, `.secrets/*`, `secrets/` -- Secret directories
- `*.keystore`, `*.truststore` -- Java keystores
- `serviceAccountKey.json`, `*-credentials.json` -- Cloud service credentials
- `docker-compose*.yml` -- If the file may contain inline passwords, tokens, or other credentials, skip the whole file and note only that it exists
- Any file in `.gitignore` that appears to contain secrets
- `node_modules/`, `vendor/`, `.git/` -- Generated/vendored content (skip for performance)
- Binary files, database files, media files -- Not analyzable as text

**If you encounter these files:**
- Note their EXISTENCE only: "`.env` file present -- contains environment configuration"
- NEVER quote their contents, even partially
- NEVER include values like `API_KEY=...` or `sk-...` in any output

**Why this matters:** Your output gets committed to git. Leaked secrets = security incident.
</forbidden_files>

<mapping>
### 3. Spawn Mapper Delegates

Ensure `.planning/codebase/` directory exists before spawning.

**If `parallelization: true` and your platform supports parallel execution -- run all selected mappers in parallel.**
**If `parallelization: false` or your platform lacks parallel execution -- run the same mappers sequentially.**

```
Spawning codebase mappers...
  -> Tech mapper     -> .planning/codebase/STACK.md
  -> Arch mapper     -> .planning/codebase/ARCHITECTURE.md
  -> Quality mapper  -> .planning/codebase/CONVENTIONS.md
  -> Concerns mapper -> .planning/codebase/CONCERNS.md
```

<delegate>
Agent: TechMapper
Parallel: (use parallelization value from .planning/config.json)
Context: Current working directory. DO NOT share conversation history.
Instruction: Read `.planning/templates/delegates/mapper-tech.md` for full task instructions. Follow them exactly.
Output: `.planning/codebase/STACK.md`
Return: 3-5 sentence summary to Orchestrator.
Guardrails: Max Agent Hops = 3. No static dumps. Never read .env contents.
</delegate>

<delegate>
Agent: ArchMapper
Parallel: (use parallelization value from .planning/config.json)
Context: Current working directory. DO NOT share conversation history.
Instruction: Read `.planning/templates/delegates/mapper-arch.md` for full task instructions. Follow them exactly.
Output: `.planning/codebase/ARCHITECTURE.md`
Return: 3-5 sentence summary to Orchestrator.
Guardrails: Max Agent Hops = 3. No static directory dumps. Never read .env contents.
</delegate>

<delegate>
Agent: QualityMapper
Parallel: (use parallelization value from .planning/config.json)
Context: Current working directory. DO NOT share conversation history.
Instruction: Read `.planning/templates/delegates/mapper-quality.md` for full task instructions. Follow them exactly.
Output: `.planning/codebase/CONVENTIONS.md`
Return: 3-5 sentence summary to Orchestrator.
Guardrails: Max Agent Hops = 3. Rules not inventories. Never read .env contents.
</delegate>

<delegate>
Agent: ConcernsMapper
Parallel: (use parallelization value from .planning/config.json)
Context: Current working directory. DO NOT share conversation history.
Instruction: Read `.planning/templates/delegates/mapper-concerns.md` for full task instructions. Follow them exactly. Hard stop if secrets found -- report immediately.
Output: `.planning/codebase/CONCERNS.md`
Return: 3-5 sentence summary to Orchestrator. If secrets found, STOP and report immediately.
Guardrails: Max Agent Hops = 3. Hard stop on secrets. Never read .env contents.
</delegate>
</mapping>

<why_this_matters>
### Why These Documents Matter

These 4 documents are consumed by downstream GSDD workflows:

| Workflow | Documents Used |
|----------|---------------|
| `/gsdd-new-project` | All 4 -- infers Validated requirements from existing capabilities |
| `plan` (future) | ARCHITECTURE + CONVENTIONS for implementation planning |
| `execute` (future) | CONVENTIONS for code style, ARCHITECTURE for file placement |
| `verify` (future) | CONCERNS for regression awareness |
| `/gsdd-quick` | All 4 -- bounded brownfield context for safe feature work |

**What this means for mapper output quality:**

1. **File paths are critical** -- downstream agents navigate directly to files. Write `src/services/user.ts`, not "the user service."
2. **Patterns over lists** -- show HOW things are done (code examples), not just WHAT exists.
3. **Be prescriptive** -- "Use camelCase for functions" helps future agents write correct code. "Some functions use camelCase" does not.
4. **CONCERNS.md drives priorities** -- issues identified here may become future work items. Be specific about impact and fix approach.
</why_this_matters>

<validation>
### 4. Validate Output

After all mappers complete, verify:

- [ ] All 4 documents exist in `.planning/codebase/` (L1: exists)
- [ ] No document is empty or trivially short — each must exceed 20 non-empty lines (L2: substantive)
- [ ] Each document contains actual file path references in backtick format — not generic advice (L2: specificity)
- [ ] STACK.md names at least 2 concrete technologies with version information (L2: specificity)
- [ ] ARCHITECTURE.md references at least 1 specific directory or module path (L2: specificity)
- [ ] No document is a carbon copy of another — each covers a distinct dimension (L2: non-duplicate)

If any check fails, note the specific failure and inform the user which documents need re-mapping or manual completion.
</validation>

**MANDATORY: All 4 codebase documents must exist on disk before proceeding to security scan or commit. If any document is missing, STOP and report which mapper(s) failed. Do NOT proceed to `<secrets_scan>` with incomplete output.**

<secrets_scan>
### 5. Security Scan (Mandatory Before Commit)

**CRITICAL SECURITY CHECK:** Scan all generated documents for accidentally leaked secrets before committing.

Search `.planning/codebase/*.md` for these patterns (use your platform's search/grep capability):

**Reference patterns (regex):**
- `sk-[a-zA-Z0-9]{20,}` | `sk_live_[a-zA-Z0-9]+` | `sk_test_[a-zA-Z0-9]+` -- Stripe/OpenAI keys
- `ghp_[a-zA-Z0-9]{36}` | `gho_[a-zA-Z0-9]{36}` -- GitHub tokens
- `glpat-[a-zA-Z0-9_-]+` -- GitLab tokens
- `AKIA[A-Z0-9]{16}` -- AWS access keys
- `xox[baprs]-[a-zA-Z0-9-]+` -- Slack tokens
- `-----BEGIN.*PRIVATE KEY` -- Private key headers
- `eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.` -- JWT tokens
- Hardcoded passwords, connection strings with embedded credentials

**If secrets are found:**

```
SECURITY ALERT: Potential secrets detected in codebase documents!

Found patterns that look like API keys or tokens in:
[show which files and what was found]

This would expose credentials if committed.

Action required:
1. Review the flagged content above
2. If these are real secrets, they must be removed before committing
3. Consider restricting agent access to sensitive files

Pausing. Reply "safe to proceed" if the flagged content is not actually sensitive, or edit the files first.
```

Wait for user confirmation before continuing.

**If no secrets found:** Continue to commit step.
</secrets_scan>

<commit>
### 6. Commit (if configured)

Read `commitDocs` from `.planning/config.json`.

**If `commitDocs: true`:** Commit the generated codebase documents.
Suggested commit message: `docs: map existing codebase`
Files: `.planning/codebase/*.md`

**If `commitDocs: false`:** Skip commit. Documents remain local-only.
</commit>

<completion>
Report to the user what was accomplished, then present the next step:

---
**Completed:** Codebase mapping — 4 documents written to `.planning/codebase/` (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md).

**Brownfield routing summary:** Synthesize this directly from the 4 generated documents before recommending the next workflow.
- Safest next change lane — which module or surface looks cheapest and safest to modify first
- Highest-risk zones — areas to avoid or isolate unless the task explicitly needs them
- Must-know traps — convention, dependency, or architecture constraints likely to cause mistakes
- Recommended next workflow — choose `/gsdd-quick` for bounded brownfield work or `/gsdd-new-project` for full lifecycle setup, and say why

Use only the 4 generated documents for this synthesis. Do NOT create a fifth persistent artifact or write an additional routing-summary file.

**Next step:** Choose based on what you need:
- `/gsdd-new-project` — full project initialization (spec, roadmap, phased delivery), especially if you have not yet defined the bounded change
- `/gsdd-quick` — bounded brownfield feature work without full ceremony (bug fixes, small features, one-off tasks)

Also available:
- `/gsdd-map-codebase` — re-map if results need refinement
- Review specific file: read `.planning/codebase/STACK.md`

Consider clearing context before starting the next workflow for best results.
---
</completion>

<success_criteria>
- `.planning/codebase/` directory exists with 4 documents
- All selected mapper delegates were spawned (parallel or sequential per config)
- Delegates wrote documents directly (orchestrator did not receive document contents)
- Security scan completed -- no secrets in generated documents
- Documents committed only if `commitDocs: true`; local-only mode valid if `commitDocs: false`
- User presented with clear completion summary and next steps
- No references to non-existent commands or workflows
</success_criteria>
