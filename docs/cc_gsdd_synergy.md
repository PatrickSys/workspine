# Codebase-Context MCP ↔ GSDD Synergy Analysis

> **Date:** February 22, 2026  
> **Status:** Research complete — persisted for future reference  
> **Scope:** Comparing GSD's static mapper (4 subagents → 7 .md files) with codebase-context MCP (11 live tools), using angular-spotify as test codebase

---

## 1. What Each Project Does

| | GSD Mapper | Codebase-Context MCP |
|---|---|---|
| **Mechanism** | 4 Claude `Task()` subagents explore code, write 7 markdown docs to `.planning/codebase/` | Indexes codebase into LanceDB vector DB, exposes 11 MCP tools + CLI |
| **Output** | Static `.md` files (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS) | Dynamic JSON responses via MCP protocol or CLI |
| **Setup cost** | Requires Claude Code with `Task()` support (vendor lock-in) | Requires npm install + first indexing run (~30s) + LanceDB on disk |
| **Freshness** | Stale the moment code changes. Must re-run mapper | Incremental indexing via SHA-256 manifest diff (<100ms for no-change) |
| **Agent compatibility** | Claude Code only (uses `Task()`) | Any MCP-compatible agent + standalone CLI |

---

## 2. Tool-vs-Document Comparison (With Real Data)

### Test: `npx codebase-context metadata` (vs STACK.md / ARCHITECTURE.md)

**What CC returned for angular-spotify:**
```
- Framework: Angular 17.3.2, variant: unknown, state: ngrx
- Testing: Jest
- 560 files, 9367 lines, 289 components
- Component types: 53 components, 31 services, 199 modules, 3 directives, 1 pipe, 1 interceptor, 1 resolver
- Architecture: mixed, layers: 57 presentation, 23 business, 8 data, 58 unknown
- Project: Nx monorepo
- 20 categorized dependencies (framework, state, other)
```

**What GSD STACK.md template would produce:**
- Languages + versions (Primary: TypeScript 5.x, Secondary: JavaScript)
- Runtime (Node.js 20.x)
- Package manager + lockfile status
- Build/dev tools (Angular CLI, Nx, Webpack/esbuild)
- Configuration files (tsconfig.json, angular.json, nx.json, .env presence)
- Platform requirements (browser, PWA, service worker)
- Key dependencies with **why they matter** (not just names)

**Winner:** GSD STACK.md is **broader** (runtime, build tools, config, platform). CC metadata is **more structured** (component counts by type/layer, auto-categorized deps). CC misses runtime, build tools, config files, deployment target. **Neither is a superset of the other.**

---

### Test: `npx codebase-context patterns` (vs CONVENTIONS.md)

**What CC returned for angular-spotify:**
```
7 pattern categories with quantified data:
- DI: 84% Constructor injection (Declining) vs 16% inject() (Stable)
- Components: 100% Standalone (Stable)
- State: 100% RxJS (Stable)
- Inputs: 100% @Input decorator (Declining)
- Reactivity: 100% Effect (Stable)
- Testing: 100% Angular TestBed
- 5 Golden Files ranked by pattern adherence (card.component.ts = score 4)
- 3 memories from git history (auth refactors, timing fixes)
- Actionable guidance: "USE:", "PREFER:", "CAUTION:"
```

**What GSD CONVENTIONS.md template would produce:**
- Naming patterns (files, functions, variables, types)
- Code style (Prettier config, ESLint rules, line length, quotes, semicolons)
- Import organization (order, grouping, path aliases)
- Error handling strategy
- Logging approach
- Comment conventions (when/how, JSDoc usage)
- Function design (size limits, parameter patterns, return conventions)
- Module design (exports, barrel files)

**Winner:** They cover **completely different dimensions**. CC gives quantified framework-level patterns (DI, state, components) with trend data and golden files. GSD CONVENTIONS.md gives code-style conventions (naming, logging, error handling, function design) that CC doesn't cover at all. **These are complementary, not competing.**

---

### Test: `npx codebase-context style-guide` (vs CONVENTIONS.md)

**What CC returned:** `{"status": "no_results"}`

CC's style-guide tool only reads **existing** docs (STYLE_GUIDE.md, CONTRIBUTING.md, ARCHITECTURE.md). If none exist, it returns nothing. A GSD mapper would analyze the code and **create** CONVENTIONS.md from scratch.

**Winner:** GSD — it creates documentation when none exists. CC only reads pre-existing docs.

---

### Test: `npx codebase-context search --query "where is authentication handled"` (vs manual grep)

**What CC returned:**
```json
{
  "searchQuality": {"status": "ok", "confidence": 1},
  "results": [
    {"file": "auth.interceptor.ts:9-42", "summary": "Angular HTTP interceptor 'AuthInterceptor'", "score": 1.3, "type": "interceptor:core"},
    {"file": "auth.store.ts:41-255", "summary": "Angular service 'AuthStore'", "score": 1.24, "type": "service:business"},
    {"file": "artist.store.ts:10-68", "summary": "Angular service 'ArtistStore'", "score": 0.75},
    {"file": "unauthorized-modal.component.ts:5-20", "summary": "Angular component 'UnauthorizedModalComponent'", "score": 0.68},
    {"file": "application.effects.ts:9-76", "summary": "Angular service 'ApplicationEffects'", "score": 0.68}
  ],
  "relatedMemories": [
    "refactor: handle refresh token and first time login (0.72)",
    "refactor: update code to perform exchange token (0.72)",
    "fix: timing issue for AuthReady effect to register playback (0.52)"
  ]
}
```

**This is impressive.** It correctly identified the auth interceptor and auth store as top results, classified them by architectural type (interceptor:core, service:business), and attached related memories from git history about token handling changes. **No static .md doc can do this — it's live semantic search.**

**Winner:** CC — unambiguously. Semantic search with memory is not something static docs can replicate.

---

### Test: Not run — STRUCTURE.md, INTEGRATIONS.md, CONCERNS.md

CC has **no equivalent** for:
- **STRUCTURE.md** — "Where to put new code" guidance
- **INTEGRATIONS.md** — External APIs, auth providers, SDK clients, webhooks
- **CONCERNS.md** — Tech debt, fragile areas, security considerations, scaling limits

**Winner:** GSD mapper — these docs answer questions CC can't.

---

## 3. Honest Scorecard

| Dimension | GSD Mapper | CC MCP | Notes |
|---|:---:|:---:|---|
| **Stack documentation** | ✅ | ⬜ | CC misses runtime, build tools, config, platform |
| **Project structure** | ✅ | ⬜ | "Where to put new code" — CC has no equivalent |
| **External integrations** | ✅ | ⬜ | APIs, auth, webhooks — CC doesn't track |
| **Tech debt / concerns** | ✅ | ⬜ | CC has no concerns/tech-debt tool |
| **Code-style conventions** | ✅ | ⬜ | Naming, logging, error handling, function design — CC doesn't cover |
| **Quantified patterns** | ⬜ | ✅ | "84% constructor injection, declining" — GSD can't quantify |
| **Trend awareness** | ⬜ | ✅ | Rising/Stable/Declining — unique to CC |
| **Golden file selection** | ⬜ | ✅ | Algorithmic best-example selection — GSD mapper relies on agent judgment |
| **Semantic code search** | ⬜ | ✅ | "Where is auth handled?" → exact files with scores |
| **Decision memory** | ⬜ | ✅ | Git-extracted rationale surfaced alongside search/patterns |
| **Edit readiness / preflight** | ⬜ | ✅ | Risk assessment before edits |
| **Zero-friction setup** | ✅ | ⬜ | GSD needs only an agent. CC needs npm install + indexing + LanceDB |
| **Always fresh** | ⬜ | ✅ | Incremental indexing vs manual re-run |
| **Committable to git** | ✅ | ⬜ | Static .md files serve as team documentation |
| **Agent-agnostic** | ⬜* | ✅ | GSD mapper uses Claude `Task()`. CC works with any MCP agent + CLI |

*GSDD will fix this — mapper will use plain markdown workflows, no `Task()`.

---

## 4. Key Learnings for Each Project

### For GSDD (Lessons from Codebase-Context)

1. **Quantification matters.** "Uses constructor injection" isn't actionable. "84% constructor injection, declining" is. GSDD mapper templates should instruct agents to count occurrences and note trends.
2. **Golden files are valuable.** Instead of just listing conventions, identify 3-5 files that best represent the project's patterns. Include this in mapper output.
3. **Memory is a killer feature.** Static docs can't accumulate rationale over time. GSDD should at minimum document "WHY" decisions were made in SPEC.md/ROADMAP.md, and ideally surface them during plan/execute.
4. **Semantic search is unbeatable for "where is X?"** Static docs can't answer ad-hoc questions. If CC MCP is available, GSDD workflows should defer to it for code location queries.
5. **Style-guide from nothing.** CC's style-guide fails if no docs exist. GSDD mapper creates docs from scratch — this is a genuine advantage.

### For Codebase-Context (Lessons from GSD Mapper)

1. **Structure guidance is missing.** "Where do I put a new service?" is a critical developer question CC can't answer. Consider a `get_structure_guide` tool that infers from existing patterns.
2. **Integration discovery.** CC doesn't detect external APIs, auth providers, or webhooks. A `detect_integrations` tool scanning for SDK imports, HTTP clients, env vars would fill this gap.
3. **Code-style conventions are uncovered.** CC quantifies framework patterns (DI, state) but not code style (naming, error handling, logging, function design). These matter for consistency.
4. **Tech debt / concerns detection.** CC has no tool for surfacing TODO/FIXME density, large files, empty returns, or fragile areas. This is on the roadmap as v1.7 "Stability Layer" — it should be prioritized.
5. **Export to markdown.** CC's future "Rules Export" feature should include generating STACK.md/CONVENTIONS.md-style docs from index data. This would give CC the "committable docs" advantage.
6. **CLI discoverability.** The CLI is already excellent (`npx codebase-context patterns`). Adding slash commands for agents that support them would boost adoption.

---

## 5. Future Integration Opportunities

### Short-Term (Complementary, not dependent)

| Integration | How | Benefit |
|---|---|---|
| GSDD workflows call CC when available | `if CC MCP connected → get_team_patterns` instead of spawning mapper | Live quantified patterns instead of static docs |
| GSDD plan phase uses CC search | `search_codebase intent=edit` before writing plans | Preflight risk assessment |
| GSDD verify phase uses CC patterns | `get_team_patterns` to validate code follows conventions | Automated convention checking |
| CC exports GSDD-compatible docs | `export_map` CLI command → STACK.md, CONVENTIONS.md format | Best of both worlds |

### Medium-Term (Deeper integration)

| Integration | How | Benefit |
|---|---|---|
| CC as GSDD's "intelligence backend" | GSDD mapper calls CC tools instead of scanning code manually | Reuse CC's indexing + embeddings |
| GSDD memories → CC memory store | GSDD decisions/rationale written to CC's memory.json | Single source of truth for "why" |
| CC golden files → GSDD code examples | GSDD execute phase uses CC golden files as reference | AI writes code matching best examples |
| CC preflight → GSDD plan validation | Plans validated against CC's evidence locks | "Don't plan to modify file X without understanding it first" |

### Long-Term (Convergence opportunities)

| Opportunity | Notes |
|---|---|
| CC's v1.9 "Knowledge Distillation" + GSDD SPEC.md | Compress codebase into architectural signal for SPEC.md enrichment |
| CC's "Rules Export" → GSDD workflow templates | Auto-generate agent instructions from codebase data |
| CC's "Multi-Agent support" + GSDD agent orchestration | Shared governor/architect pattern for multi-agent workflows |
| GSDD's milestone lifecycle + CC's memory lifecycle | Project-level decision tracking across milestones |

---

## 6. Decision for GSDD

**GSDD must stand alone.** Codebase-context MCP is an optional power-up, never a dependency.

- ✅ Build our own mapper producing static .md docs (distilled from GSD templates)
- ✅ Add quantification instructions to templates ("count occurrences, note if pattern is growing or shrinking")
- ✅ Add golden file identification to mapper output
- ✅ Document CC integration points in SPEC.md ("if codebase-context MCP is available, prefer its tools for...")
- ❌ Don't require CC for any GSDD workflow
- ❌ Don't merge the projects — they solve different layers (intelligence vs workflow)
- ❌ Don't build semantic search into GSDD — defer to CC if available

---

*Synergy analysis complete. Both projects are stronger together, but must work independently.*
