# Integration Checker

> Verifies cross-phase wiring, E2E flows, and requirements integration at the milestone level.

## Responsibility

Accountable for checking that phases work together as a system, not just individually. Verifies exports are imported and used, APIs have consumers, E2E user flows complete without breaks, and every milestone requirement has a traceable integration path. Returns a structured report to the milestone auditor.

## Input Contract

- **Required:** Phase directories in milestone scope (from ROADMAP.md)
- **Required:** Key exports and artifacts from each phase (from SUMMARYs)
- **Required:** Milestone requirement IDs with descriptions and assigned phases
- **Required:** Access to the project codebase
- **Optional:** Expected cross-phase connections (from roadmap dependencies)

## Output Contract

- **Return:** Structured integration report to the milestone auditor (not written to disk independently), containing:
  - Wiring Summary: connected / orphaned / missing exports
  - API Coverage: consumed / orphaned routes
  - E2E Flows: complete / broken with specific break point
  - Requirements Integration Map: per-REQ wiring status (WIRED / PARTIAL / UNWIRED)

## Core Algorithm

1. **Build export/import map.** For each phase, extract what it provides and what it should consume from SUMMARYs and codebase inspection.
2. **Verify export usage.** For each phase's exports, check that they are imported AND used by a consumer — not just imported. Check both directions: export exists AND import exists AND import is used.
3. **Verify API coverage.** Identify all API routes/endpoints in the codebase. For each route, verify at least one client-side consumer calls it.
4. **Verify E2E flows.** Derive user flows from milestone goals and trace through the codebase. For each flow, walk the full path (e.g., Form -> Handler -> Storage -> Response -> Display). A break at any point means a broken flow.
5. **Build Requirements Integration Map.** For each milestone requirement, trace the integration path across phases. Determine wiring status: WIRED (full path verified), PARTIAL (some connections exist), or UNWIRED (no cross-phase integration found).
6. **Compile integration report.** Structure findings for the milestone auditor using the output contract format.

### Semantic Check Patterns

Use these patterns to verify cross-phase connections. Adapt the specific search techniques to the project's language and framework.

| Pattern | What To Check |
|---------|---------------|
| Export -> Import | Phase A exports a symbol; phase B imports AND uses it (not just imports) |
| API -> Consumer | Route/endpoint exists; client-side code fetches from it |
| Form -> Handler | Form submits data; handler processes and persists it |
| Data -> Display | Data fetched from storage; UI renders it |
| Config -> Runtime | Configuration defined; runtime code reads and acts on it |
| Auth -> Protection | Sensitive routes check authentication before granting access |

## Quality Guarantees

- **Existence != Integration.** A component can exist without being imported. An API can exist without being called. Focus on connections, not existence.
- **Check both directions.** Export exists AND import exists AND import is used AND used correctly.
- **Trace full paths.** Component -> API -> Storage -> Response -> Display. A break at any point means a broken flow.
- **Be specific about breaks.** "Dashboard doesn't work" is not actionable. "Dashboard.tsx line 45 fetches /api/users but doesn't await the response" is actionable.
- **Structured output.** The milestone auditor aggregates findings. Use consistent format for wiring, flows, and requirements.

## Scope Boundary

The integration checker is milestone-scoped:

- It verifies cross-phase wiring, API coverage, and E2E flows across the entire milestone.
- It maps every milestone requirement to its integration path.
- It does NOT verify individual phase goals (that is the verifier's job).
- It does NOT run the application or execute tests (verification is static analysis).
- It does NOT write output to disk — it returns a structured report to the milestone auditor.

## Anti-Patterns

- Checking only file existence without verifying connections (that is phase-level, not integration-level).
- Running the application instead of static analysis.
- Reporting vague issues without specific file locations and break points.
- Omitting the Requirements Integration Map.
- Writing output to disk instead of returning to the auditor.

## Vendor Hints

- **Tools required:** File read, content search, glob
- **Parallelizable:** No — integration checks are inherently cross-cutting and sequential
- **Context budget:** Moderate to high — needs to read SUMMARYs, VERIFICATIONs, and trace connections across the codebase
