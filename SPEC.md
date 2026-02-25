# GSDD — GSD Distilled Specification

> Living document. Source of truth for what GSDD is, what it takes from GSD, what it strips, and what the lifecycle looks like.
> **Last updated:** 2026-02-22 (v2 — agent-agnostic strategy, researched discovery mechanisms, OpenSpec/LeanSpec cross-refs)

---

## Self-Discipline Protocol: Rules for AI Agents Working on This Project

> [!CAUTION]
> Every AI agent (Claude Code, Gemini CLI, Codex CLI, Cursor, GitHub Copilot, Antigravity, or any other) working on this codebase MUST follow these rules. These exist because past sessions have repeatedly made the same mistakes.

### Mandatory Rules

1. **Never assume — verify against the repo or other sources like openspec, leanspec or this repo on the original GSD base.** Before writing anything about "what GSD does," `grep` or `view_file` to confirm. Past sessions have made claims contradicted by the actual source code.
2. **Never make this Claude-specific.** GSD was originally built for Claude Code. Every reference to `~/.claude/`, `AskUserQuestion`, `SlashCommand`, or `Task()` is a vendor lock-in. GSDD must be agent-agnostic from day one. BUT READ 3:
3. **Vendor-specific tools are valuable — abstract, don't drop.** `AskUserQuestion`, `Task()`, and `SlashCommand` are genuinely useful. Research has confirmed there's **no cross-agent standard** for these. Instead, GSDD must: (a) write workflows in plain markdown (agent-agnostic baseline), (b) create optional vendor-specific integration files that map GSDD commands to each agent's native hooks (see Agent Integration Strategy below).
4. **For every phase, research first.** Before implementing any phase, you MUST: (a) research what GSD does for that equivalent, (b) research what OpenSpec/LeanSpec do for the same, (c) research what AI coding agents (Claude Code, Gemini CLI, Codex CLI, Cursor, GitHub Copilot, Antigravity) provide natively so we don't reinvent the wheel, (d) decide what to keep/strip, (e) define the definition of done, (f) list common pitfalls. Only then implement.
5. **Don't reinvent — distill.** GSD works. It's just overcomplicated. Our job is to strip ceremony, not to redesign EXCEPT from the high leverage findings when we research.
6. **Keep the SPEC.md updated.** After every significant decision, update this file. It is the single source of truth.
7. **Never copy files into projects.** The current `gsdd init` copies the `distilled/` folder into projects. This is WRONG. Framework files live in a global location, project files live in `.planning/`.
8. **Staleness awareness.** `.md` planning files can become stale. Any workflow that reads planning files must verify their recency and flag potential staleness.
9. **Check Notion roadmap.** Before starting work, check the Notion Codebase Context MCP pages for the latest roadmap and priorities. *(Note: for the codebase-context project only — GSDD is independent)*

### Common Pitfalls to Avoid

| Pitfall | Why it happens | How to avoid |
|---------|---------------|--------------|
| Hardcoding `~/.claude/` paths | GSD source uses them everywhere (39+ files) | Use a `FRAMEWORK_DIR` variable resolved at install time |
| Using `AskUserQuestion` | Claude Code-specific tool (38+ call sites across 15 workflow files) | Use plain text prompts — every agent can ask questions |
| Using `Task()` subagent spawning | Claude-specific (35+ call sites across 15 workflows) | Write workflows that work single-agent; subagent spawning as enhancement |
| Copying framework into projects | Current broken `gsdd init` behavior | Framework stays global; only `.planning/` is project-local |
| Over-engineering config | GSD's 10+ config options overwhelm users | Sensible defaults, minimal config (`config.json` with mode only) |
| Skipping verification | Agents tend to skip verify steps | Verification is mandatory, not optional. Build it into the workflow |
| Massive workflow size consuming full session | GSD's new-project.md is 851 lines + 7 Task() spawns + 10+ AskUserQuestion rounds — this consumed a full 5h Claude Code Pro session | Keep workflows lean. Warn about token cost. Offer skip for optional steps. |

---

## What This Is

GSDD (GSD Distilled) is a **stripped-down, agent-agnostic fork of GSD** (Get Shit Done). It takes the proven spec-driven development lifecycle from GSD and removes the complexity ceiling — fewer commands, fewer files, fewer moving parts — while keeping the core loop that makes GSD work.

**Core loop:** `init → plan → execute → verify` — per phase, within milestones.

**Supported agents:** Claude Code, Gemini CLI, Codex CLI, Cursor, GitHub Copilot (extension/chat/CLI), Antigravity, any AI coding agent. Framework files are plain markdown — any agent that can read files can follow the workflows.

---

## GSD Codebase Map

> Reference map of GSD's structure so every decision about what to keep/strip is grounded in facts.

### Top-Level Structure

```
get-shit-done-distilled/    (the repo — a fork of GSD)
├── agents/                  # 11 subagent role definitions
├── bin/                     # 3 files (install.js, gsdd.mjs, gsd-tools.cjs entrypoint)
├── commands/gsd/            # 31 slash command files (.md)
├── distilled/               # Our GSDD framework (SKILL.md, workflows, templates)
├── get-shit-done/           # GSD framework internals
│   ├── bin/                 # gsd-tools.cjs + 11 lib modules
│   ├── references/          # 13 reference docs
│   ├── templates/           # 35 template files (project, roadmap, research, etc.)
│   └── workflows/           # 32 workflow files (51-851 lines each)
├── hooks/                   # 3 hook files (statusline, update-check, context-monitor)
├── tests/                   # 8 test files
└── scripts/                 # 1 build script
```

### Component Detail

#### Agents (11 files in `agents/`)
| Agent | Purpose | GSDD equivalent? |
|-------|---------|-------------------|
| `gsd-codebase-mapper.md` | Maps existing codebase structure | ⚠️ Maybe — useful for brownfield |
| `gsd-debugger.md` | Debugging subagent | ❌ Skip — single-agent debugging |
| `gsd-executor.md` | Executes plan tasks | ⚠️ Distill into workflow |
| `gsd-integration-checker.md` | Checks component integration | ❌ Skip |
| `gsd-phase-researcher.md` | Researches phase domain | ⚠️ Maybe — per-phase research |
| `gsd-plan-checker.md` | Validates plan quality | ❌ Skip — build checks into plan workflow |
| `gsd-planner.md` | Creates phase plans | ⚠️ Distill into workflow |
| `gsd-project-researcher.md` | Researches project domain (4x parallel) | ⚠️ Decision needed on parallel research |
| `gsd-research-synthesizer.md` | Synthesizes research outputs | ⚠️ Needed if research is kept |
| `gsd-roadmapper.md` | Creates phased roadmap | ⚠️ Distill into workflow |
| `gsd-verifier.md` | Verifies completed work | ⚠️ Distill into workflow |

> [!IMPORTANT]
> **Subagent decision:** GSD heavily relies on Claude's `Task()` subagent spawning (35+ call sites across 15 workflows). GSDD workflows must **work single-agent** as the baseline — all logic inline. Subagent spawning is a **core enhancement** (most modern agents support it), but every workflow must be functional without it. **Dedicate research before reimplementing subagent support.**

#### Slash Commands (31 files in `commands/gsd/`)
| Command | Category | Lines | GSDD? |
|---------|----------|-------|-------|
| `new-project.md` | Init | 37 | ✅ → `/gsdd:init` |
| `plan-phase.md` | Core | 37 | ✅ → `/gsdd:plan` |
| `execute-phase.md` | Core | 34 | ✅ → `/gsdd:execute` |
| `verify-work.md` | Core | 32 | ✅ → `/gsdd:verify` |
| `resume-work.md` | Core | 33 | ✅ → `/gsdd:resume` |
| `quick.md` | Core | 34 | ✅ → `/gsdd:quick` |
| `help.md` | Utility | 19 | ✅ → `/gsdd:help` |
| `progress.md` | Status | 21 | ✅ → `/gsdd:progress` |
| `new-milestone.md` | Milestone | 37 | ✅ → `/gsdd:milestone` |
| `complete-milestone.md` | Milestone | 101 | ✅ → `/gsdd:complete` |
| `discuss-phase.md` | Phase | 70 | ⚠️ Phase 2 |
| `research-phase.md` | Phase | 142 | ⚠️ Phase 2 |
| `map-codebase.md` | Utility | 60 | ⚠️ Phase 2 |
| `settings.md` | Config | 31 | ⚠️ Phase 2 |
| `audit-milestone.md` | Milestone | 30 | ⚠️ Phase 3 |
| `plan-milestone-gaps.md` | Milestone | 28 | ⚠️ Phase 3 |
| `add-phase.md` | Phase mgmt | 36 | ⚠️ Phase 3 |
| `insert-phase.md` | Phase mgmt | 25 | ⚠️ Phase 3 |
| `remove-phase.md` | Phase mgmt | 26 | ❌ Skip |
| `add-todo.md` | Todos | 40 | ❌ Skip |
| `check-todos.md` | Todos | 38 | ❌ Skip |
| `pause-work.md` | Session | 32 | ❌ Skip (resume covers it) |
| `debug.md` | Debug | 127 | ❌ Skip |
| `health.md` | Health | 20 | ❌ Skip |
| `cleanup.md` | Cleanup | 15 | ❌ Skip |
| `set-profile.md` | Config | 29 | ❌ Skip |
| `update.md` | Update | 32 | ❌ Skip |
| `join-discord.md` | Social | 13 | ❌ Skip |
| `reapply-patches.md` | Upgrade | 81 | ❌ Skip |
| `list-phase-assumptions.md` | Phase | 38 | ❌ Skip |
| `discovery-phase.md` | Phase | (in workflows only) | ❌ Skip |

> **Note:** Commands are thin wrappers (13-142 lines) that invoke workflows. The real logic is in `get-shit-done/workflows/` (51-851 lines each).

#### Workflows (32 files in `get-shit-done/workflows/`)
| Workflow | Lines | What it does | Vendor lock-in |
|----------|-------|--------------|---------------|
| `new-project.md` | **851** | Questioning → PROJECT.md → config → research → REQUIREMENTS.md → ROADMAP.md | `AskUserQuestion` (10x+), `Task()` (7x), `~/.claude/` (20x+) |
| `execute-phase.md` | 331 | Orchestrates plan execution with subagents | `Task()` (2x), `AskUserQuestion` (1x) |
| `execute-plan.md` | 325 | Actual plan execution by executor subagent | `Task()` referenced in pattern |
| `complete-milestone.md` | 479 | Archive milestone, evolve PROJECT.md, tag | `AskUserQuestion` (2x), `~/.claude/` |
| `discuss-phase.md` | 402 | Deep discussion before planning | `AskUserQuestion` (8x+) |
| `plan-phase.md` | 355 | Creates PLAN.md for a phase | `Task()` (5x), `AskUserQuestion` (1x) |
| `verify-phase.md` | 177 | Verifies phase completion | `~/.claude/` |
| `verify-work.md` | 416 | Detailed work verification | `Task()` (3x) |
| `new-milestone.md` | 276 | New milestone cycle | `AskUserQuestion` (5x), `Task()` (3x) |
| `quick.md` | 324 | Ad-hoc task execution | `Task()` (5x), `AskUserQuestion` (1x) |
| `resume-project.md` | 226 | Resume interrupted work | `~/.claude/` |
| `map-codebase.md` | 225 | Codebase structure mapping | `Task()` (4x) |
| *(20 more)* | 51-245 | Various utilities | Similar patterns |

#### Vendor-Specific API Usage (CRITICAL — must abstract)

| API | Count | What it does | Agent-agnostic replacement |
|-----|-------|-------------|---------------------------|
| `~/.claude/` paths | **39+ files** | Hardcoded config directory | `$FRAMEWORK_DIR` env variable or install-time path |
| `AskUserQuestion` | **38+ call sites** (15 workflow files + 14 command files) | Structured prompts with options | Plain text questions — every agent supports this |
| `Task()` subagent | **35+ call sites across 15 workflows** | Spawns specialized subagents | Inline workflow steps; subagents as core enhancement |
| `SlashCommand()` | **4 call sites** (2 workflows: `transition.md`, `new-project.md`) | Invokes other slash commands | Agent-specific command syntax (varies by tool) |
| `gsd-tools.cjs` CLI | **28 workflow files** | Git ops, state mgmt, roadmap parsing | Equivalent GSDD CLI or plain shell commands |

> [!WARNING]
> GSD was **built for Claude Code first**. The `install.js` adapter layer converts paths and frontmatter for OpenCode and Gemini, but the core workflows still assume Claude's unique APIs (`AskUserQuestion`, `Task()`, `SlashCommand()`). GSDD must not replicate this — workflows must use only plain markdown instructions that any agent can follow.

#### Templates (35 files in `get-shit-done/templates/`)
| Category | Files | Purpose | GSDD? |
|----------|-------|---------|-------|
| Project | `project.md`, `config.json` | Project definition, config | ✅ → Our SPEC.md + minimal config |
| Roadmap | `roadmap.md`, `state.md` | Roadmap + state tracking | ✅ → Our ROADMAP.md (with inline state) |
| Requirements | `requirements.md` | Requirement tracking | ✅ → Merged into SPEC.md |
| Research | `research.md`, `research-project/` (5 files) | Domain research templates | ⚠️ Single research template |
| Phase | `phase-prompt.md`, `planner-subagent-prompt.md` | Phase execution | ⚠️ Distill into workflow |
| Verification | `VALIDATION.md`, `verification-report.md`, `UAT.md`, `DEBUG.md` | Verification templates | ⚠️ Single verify template |
| Codebase | `codebase/` (7 files) | Codebase mapping output | ⚠️ Phase 2 |
| Summary | `summary.md` + variants (4 files) | Phase completion summaries | ✅ Single summary template |
| Milestone | `milestone.md`, `milestone-archive.md` | Milestone records | ✅ Keep |
| Context | `context.md`, `continue-here.md`, `discovery.md`, `user-setup.md` | Various context docs | ❌ Skip most |

#### bin/lib (11 modules in `get-shit-done/bin/lib/`)
| Module | Purpose | GSDD? |
|--------|---------|-------|
| `core.cjs` | Utility functions, git helpers | ⚠️ Distill essentials |
| `init.cjs` | Init context builder (brownfield detect, model resolution) | ✅ Simplified version |
| `phase.cjs` | Phase file management | ✅ Simplified |
| `roadmap.cjs` | Roadmap parsing/manipulation | ✅ Simplified |
| `config.cjs` | Config management | ⚠️ Minimal config |
| `state.cjs` | STATE.md management | ❌ Skip — inline in ROADMAP.md |
| `verify.cjs` | Verification utilities | ✅ Simplified |
| `milestone.cjs` | Milestone operations | ✅ Simplified |
| `commands.cjs` | Command routing | ⚠️ Simplified |
| `template.cjs` | Template processing | ⚠️ Simplified |
| `frontmatter.cjs` | YAML frontmatter parsing | ❌ Skip — GSDD uses plain markdown |

---

## Two Separate Concerns

### 1. `gsdd install` — Framework Setup (one-time)

Installs GSDD's framework files into agent-appropriate locations. Runs once per machine.

**What GSD's `install.js` does (1866 lines) — VERIFIED from local source:**
- Supports 3 runtimes: Claude Code, OpenCode, Gemini CLI
- Copies commands, workflows, agents, hooks with per-runtime conversion
- Converts `AskUserQuestion` → `question` (OpenCode), tool name mappings
- Converts YAML frontmatter between formats (md for Claude, md for OpenCode, TOML for Gemini)
- Interactive prompts for runtime selection + install location + statusline
- Local patch persistence across upgrades (SHA256 manifest)
- Handles CommonJS/ESM compatibility

**What GSDD `install` should do (stripped):**
- Support multiple agents: Claude Code, Gemini CLI, Codex CLI, Cursor, GitHub Copilot, Antigravity
- For Claude: `~/.claude/commands/gsdd/` + `~/.claude/get-shit-done-distilled/`
- For Gemini: `~/.gemini/commands/gsdd/` + `~/.gemini/get-shit-done-distilled/`
- For Codex, Cursor, GitHub Copilot, Antigravity: **⚠️ NEEDS DEDICATED RESEARCH** — initial web research found per-agent paths but these may be deprecated or not the optimal devex. Research must answer: slash commands vs skills vs AGENTS.md vs native plan mode integration.
- Generic: workflows are plain markdown, any agent can follow them from any path
- Skip: hooks, statusline, patch persistence, frontmatter conversion (keep markdown universal)

> [!IMPORTANT]
> **Pitfall: Don't build the converter.** GSD's install.js spends significant code converting Claude-specific frontmatter to OpenCode/Gemini format. If GSDD writes agent-agnostic markdown from the start, no conversion is needed. The install script just copies files.

### 2. `gsdd init` / `/gsdd:init` — Project Initialization (per-project)

Sets up a new project for spec-driven development within the current directory.

**Verified behavior of GSD `new-project.md` workflow (851 lines, 9 steps):**

| Step | GSD does... | GSDD does... | Pitfall to avoid |
|------|------------|-------------|-----------------|
| 1. Setup | CLI call: brownfield detection, model resolution, git state | Simplified: just check git + existing files | Don't require a running CLI server |
| 2. Brownfield | Detects source files, offers `/gsd:map-codebase` | Flag existing files, note for context | Don't auto-run a mapper without asking |
| 3. Deep questioning | Freeform → follow-up threads → decision gate (uses `AskUserQuestion` 10x) | Same depth, plain text questions | Don't rush — this is the highest-leverage step |
| 4. PROJECT.md | Synthesize context into structured doc | → Our SPEC.md template | Don't separate PROJECT.md and REQUIREMENTS.md — SPEC.md combines both |
| 5. Config | 10+ preferences → `config.json` (mode, depth, research, models, branching, etc.) | Minimal config: mode only (default: balanced) | Don't offer 10 choices — sensible defaults |
| 6. Research | 4 parallel `gsd-project-researcher` subagents → `gsd-research-synthesizer` → SUMMARY.md | Single-agent research, optional | Warn about token cost. Offer skip. |
| 7. Requirements | Feature scoping by category, REQ-IDs, REQUIREMENTS.md | Integrated into SPEC.md as must-haves | Don't create a separate REQUIREMENTS.md |
| 8. Roadmap | Spawns `gsd-roadmapper` → ROADMAP.md with phases, requirement mappings, success criteria | Same output, written inline by agent (no subagent needed) | Don't overspecify — checkboxes are enough |
| 9. Done | Summary + "next: `/gsd:discuss-phase 1`" | Summary + "next: `/gsdd:plan 1`" | Always tell the user what to do next |

---

## Research Decision: 4-Agent Parallel Research

**GSD's approach:**
- Spawns 4 `gsd-project-researcher` subagents in parallel: Stack, Features, Architecture, Pitfalls
- Each writes to `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`
- After all 4 complete: spawns `gsd-research-synthesizer` → `SUMMARY.md`
- Total: 5 subagent calls for research alone

**Pros:**
- Thorough coverage across 4 dimensions
- Parallel = faster than sequential (if agent supports it)
- One-time cost at project init (acceptable)

**Cons:**
- Consumes significant tokens (user confirmed new-project workflow consumed a full 5-hour Claude Code Pro session limit)
- Requires `Task()` subagent support (Claude-specific)
- 5 separate agent invocations = 5x context overhead

**GSDD recommendation:**
- **Default: single-agent sequential research** — agent researches stack → features → architecture → pitfalls in one session, writes to `.planning/research/SUMMARY.md`
- **Optional: parallel research** — if agent supports subagent spawning, allow it as an optimization
- **Always: warn user about token cost** and offer skip
- **Research is optional** — many projects don't need it (especially if user knows the domain)
- **For brownfield:** research is less useful — the code IS the research

---

## Long-Term Lifecycle: Milestones (Full Support) — GSDD Design

> **Note:** The lifecycle below is GSDD's design, distilled from GSD. GSD uses `PROJECT.md` + `REQUIREMENTS.md` + `STATE.md` + `.gsd-planning/`. GSDD simplifies to `SPEC.md` + `ROADMAP.md` + `.planning/`.

### The Lifecycle

```
/gsdd:init          → SPEC.md + ROADMAP.md (v1.0 with phases 1-N)
/gsdd:plan 1        → .planning/phases/1-name/PLAN.md
/gsdd:execute 1     → implements plan
/gsdd:verify 1      → verifies work, writes SUMMARY.md
  ... repeat for each phase ...
/gsdd:complete       → archives v1.0, evolves SPEC.md, tags in git
/gsdd:milestone      → questioning for v1.1, new ROADMAP.md (phases N+1-M)
  ... repeat lifecycle ...
```

### Key Files

| File | Purpose | Scope | Staleness risk |
|------|---------|-------|----------------|
| `SPEC.md` | What we're building (requirements, decisions, context) | Project lifetime — grows with Validated section | Medium — review at milestone boundaries |
| `ROADMAP.md` | Current milestone's phases + status | Per-milestone — archived when complete | Low — actively maintained |
| `phases/N-name/PLAN.md` | Tasks for one phase | Per-phase | Low — consumed and done |
| `phases/N-name/SUMMARY.md` | What was accomplished | Per-phase | None — immutable after creation |
| `milestones/vX.Y-ROADMAP.md` | Archived milestone roadmap | Per-milestone (archived) | None — historical record |
| `config.json` | Workflow preferences | Project lifetime | None — rarely changes |

### ROADMAP.md Format (Distilled)

```markdown
# Roadmap: [Project Name]

## Current: v1.0 MVP

### Phase 1: Foundation
- [ ] Set up project structure
- [ ] Configure database
- [ ] Create base models
Status: Not started

### Phase 2: Authentication
- [ ] User registration
- [ ] Login/logout
- [ ] Session management
Status: Not started

## Completed

### ✅ v0.1 Prototype (Phases 1-2) — shipped 2026-01-15
- [x] Phase 1: Spike (2 tasks) — completed 2026-01-10
- [x] Phase 2: Validation (3 tasks) — completed 2026-01-15
```

> Simple checkboxes. Statuses. That's it. No REQ-IDs, no traceability tables, no progress percentages. *(GSD's original uses REQ-IDs and mappings — we stripped those.)*

---

## Agent Integration Strategy (Agent-Agnostic)

### The Problem with GSD's Approach
GSD writes workflows for Claude Code, then the installer converts them for other agents. This creates:
1. Source of truth is Claude-specific
2. Conversion is lossy (some Claude features have no equivalent)
3. Every new agent needs a new converter

> **OpenSpec comparison (verified from [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) repo):** OpenSpec does NOT use init→plan→execute→verify. It uses a **change-based model**: `explore → new → ff → apply → verify → sync → archive` (10 slash commands). Each change gets its own folder with proposal, specs, design, and tasks. Changes are independent and can be parallel. Discovery: per-tool command syntax (Claude: `/opsx:new`, Cursor: `/opsx-new`, Copilot: `/opsx-new`, Trae: `/openspec-new-change`). Installs via `npm install -g @fission-ai/openspec` → `openspec init` per project. 33 releases, 48 contributors.
> **LeanSpec comparison (verified from [codervisor/lean-spec](https://github.com/codervisor/lean-spec) repo):** LeanSpec has NO rigid workflow — edit specs like code, commit, push, done. Specs are **<2,000 tokens** each (not lines — tokens). Distribution: `@leanspec/mcp` npm package + skills.sh (`lean-spec skill install`). Agent skill teaches `Discover → Design → Implement → Validate` but this isn't enforced. LeanSpec explicitly criticizes OpenSpec's AGENTS.md (>400 lines) as causing "context rot". 18 releases, 3 contributors.

### GSDD's Approach: Agent-Agnostic Source + Adapter Generation

**Core workflows are plain markdown.** No `AskUserQuestion`, no `Task()`, no `SlashCommand()`. Just:
- "Ask the user: ..." (every agent can do this)
- "Read the file at ..." (every agent can do this)
- "Create the file ..." (every agent can do this)
- "Run the command ..." (every agent can do this)

**Multi-agent support uses the ADAPTER GENERATOR pattern** (proven by OpenSpec across 24 AI tools, 48 contributors). Instead of GSD's converter approach (lossy, fragile), GSDD generates per-tool adapter files from agent-agnostic source:

```
gsdd init --tools claude,codex

→ Source: distilled/                  (agent-agnostic markdown)
→ Output for Claude Code:             .claude/skills/gsdd-*/SKILL.md  (skills with frontmatter)
→ Output for Codex CLI + universal:   AGENTS.md at project root       (governance + workflows)
→ Content: IDENTICAL workflows, different file format and location
```

**Why generators, not converters:** GSD's `install.js` converts Claude-specific frontmatter to other formats — this is lossy, brittle, and requires a new converter per agent. OpenSpec proved that generating tool-specific files from a single source is lossless and scalable. GSDD adopts this pattern.

> [!IMPORTANT]
> **AGENTS.md must persist all disciplines.** The generated adapter files should include an AGENTS.md (or equivalent) that captures GSDD's governance rules, principles, and workflow instructions in each agent's native format. This is not optional — it's how the framework's engineering discipline propagates across tools.

### Multi-Agent Delegation Models

Based on research into State of the Art agent patterns (LangChain, OpenAI Codex, Claude Agent Teams), GSDD defines explicit boundaries for how agents collaborate:

1. **The Orchestrator / Subagent Model (Hierarchical)**
   - **Pattern:** The main agent (Orchestrator) delegates a specific, bounded question to a temporary subagent, waits for the result, and integrates it.
   - **Best for:** Sequential, context-heavy tasks where precision is required before moving to the next step.
   - **GSDD Usage:** `init` and `plan` workflows. E.g., The Orchestrator gathers requirements, spins up a Subagent to research an unfamiliar framework, waits for the `<research_summary>`, and then writes `ROADMAP.md`.
   - **Context Control:** Prevents "context window rot" by ensuring the Orchestrator only sees the final summary, not the verbose research process.

2. **The Agent Team Model (Flat / Peer-to-Peer)**
   - **Pattern:** A Lead agent provisions a swarm of specialized agents that share a task list, work in parallel, and communicate directly.
   - **Best for:** Massive, loosely coupled tasks that can be executed concurrently without stepping on each other's toes.
   - **GSDD Usage:** `execute` workflow (Future iteration). When applying a `PLAN.md` with 5 independent tasks (e.g., UI component, backend route, db schema), an Agent Team is the optimal executor.

**Directive for Core Workflows:**
The initial GSDD push focuses exclusively on the **Orchestrator / Subagent** model utilizing explicit `<delegate>` tags in markdown to instruct the agent to fork its context or spawn a worker.

### Agent Discovery — VERIFIED (Feb 2026)

> [!NOTE]
> **Research completed Feb 22, 2026.** The table below is based on official documentation:
> - Claude Code: [Anthropic Skills docs](https://docs.anthropic.com/en/docs/claude-code/slash-commands)
> - Codex CLI: [openai.com Codex docs](https://openai.com/codex/)
> - AGENTS.md: [agents.md Linux Foundation standard](https://agents.md)
>
> **Answers to the 4 research questions from the preliminary sketch:**
> 1. **Best DX for triggering GSDD workflows?** → **Skills/slash commands** for Claude Code (SKILL.md with frontmatter), **AGENTS.md** for Codex CLI + 20 other tools. GSDD should generate BOTH: skills for Claude, AGENTS.md for everything else.
> 2. **How should GSDD work WITH existing plan modes?** → Claude Code has `Plan` and `Explore` agents built in. GSDD skills should use `context: fork` to run as subagents, leveraging the platform's own agent types, NOT replacing them.
> 3. **What do competitors use?** → OpenSpec generates per-tool skill files. LeanSpec uses an MCP server + `lean-spec skill install`. GSD copies commands to `.claude/commands/`.
> 4. **Is AGENTS.md a de facto standard?** → **YES.** AGENTS.md is now a Linux Foundation project ([lfprojects.org](https://lfprojects.org)), supported by 20+ tools: Codex, Cursor, Gemini CLI, GitHub Copilot, Windsurf, VS Code, Jules, Aider, Goose, Amp, RooCode, Devin, and more. **This is the universal fallback.**

#### Claude Code Adapter Format (Verified — Official Anthropic Docs)

Claude Code uses the **Skills** system. Each skill is a directory with a `SKILL.md`:

```
.claude/skills/gsdd-init/
├── SKILL.md           # Required — instructions + YAML frontmatter
├── templates/         # Optional — supporting files Claude reads on demand
└── scripts/           # Optional — scripts Claude can execute
```

**YAML frontmatter fields** (all optional except name):
| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Slash command name (e.g., `gsdd-init`) |
| `description` | string | When to auto-trigger this skill |
| `disable-model-invocation` | bool | `true` = only user can invoke via `/name` |
| `user-invocable` | bool | `false` = only Claude can invoke (background knowledge) |
| `allowed-tools` | list | Restrict tools: `Read, Grep, Glob` (read-only mode) |
| `context` | string | `fork` = run as subagent in isolated context |
| `agent` | string | `Explore`, `Plan`, or custom `.claude/agents/` |
| `argument-hint` | string | Hint text: `[phase-number]`, `[filename] [format]` |
| `model` | string | Override model selection |
| `hooks` | object | Pre/post execution hooks |

**Key features:**
- `$ARGUMENTS` / `$0`, `$1`, `$2` — argument substitution
- `!`command`` — dynamic context injection (executes command, injects output before Claude sees the prompt)
- `context: fork` — runs skill in subagent with isolated context (critical for GSDD — prevents context pollution)
- Supporting files: SKILL.md can link to `reference.md`, `examples.md` — Claude loads them on demand, not upfront

**GSDD adapter output** for Claude Code:
```
.claude/skills/gsdd-init/SKILL.md    → /gsdd-init
.claude/skills/gsdd-plan/SKILL.md    → /gsdd-plan
.claude/skills/gsdd-execute/SKILL.md → /gsdd-execute
.claude/skills/gsdd-verify/SKILL.md  → /gsdd-verify
.claude/skills/gsdd-quick/SKILL.md   → /gsdd-quick
```

#### Codex CLI Adapter Format (Verified — OpenAI Docs)

Codex CLI uses **hierarchical AGENTS.md** (no special skill format needed):

```
~/.codex/AGENTS.md           # Global defaults (loaded first)
<project-root>/AGENTS.md     # Project-level instructions (loaded second, overrides global)
<subdirectory>/AGENTS.md     # Directory-specific instructions (loaded third)
<any-level>/AGENTS.override.md  # Full replacement of AGENTS.md at that level
```

**Format:** Plain markdown. No YAML frontmatter. Sections typically include:
- Project overview
- Build and test commands
- Code style guidelines
- Testing instructions
- Security considerations

**GSDD adapter output** for Codex CLI:
```
<project-root>/AGENTS.md     → GSDD governance rules + workflow instructions
```

> [!IMPORTANT]
> **Codex CLI does NOT support slash commands or directory-based skills.** Its adapter is a single `AGENTS.md` file at project root containing all GSDD workflows and governance rules. The AGENTS.md must be self-contained: it IS the skill, the governance, and the instruction set all in one file. Keep it under 410 lines.

#### AGENTS.md Standard (Verified — Linux Foundation)

AGENTS.md is a **Linux Foundation standard** ([agents.md](https://agents.md)). Supported by 20+ tools:

| Tier | Tools |
|------|-------|
| **Core** (confirmed) | Codex, Cursor, Gemini CLI, GitHub Copilot, VS Code |
| **Growing** | Jules, Factory, Aider, Goose, Amp, RooCode, Windsurf |
| **Emerging** | Devin, Kilo Code, Phoenix, Semgrep, UiPath, Ona, opencode, Zed, Warp |

**Implication for GSDD:** Every `gsdd init` should generate an `AGENTS.md` at project root containing GSDD governance rules. This is the **universal fallback** — any tool that reads AGENTS.md gets GSDD discipline for free.

### Vendor-Specific Feature Mapping (Verified)

| GSDD Concept | Claude Code | Codex CLI | AGENTS.md (universal) |
|-------------|-------------|-----------|----------------------|
| Workflow trigger | `/gsdd-init` via Skills | Instructions in AGENTS.md | Instructions in AGENTS.md |
| Subagent execution | `context: fork` + `agent: Explore/Plan` | N/A (Codex handles internally) | N/A |
| Tool restrictions | `allowed-tools: Read, Grep` | N/A | N/A |
| Dynamic context | `!`command`` injection | N/A | N/A |
| Argument passing | `$ARGUMENTS`, `$0`-`$N` | N/A | N/A |
| Governance rules | Skill frontmatter + SKILL.md content | AGENTS.md sections | AGENTS.md sections |

**What we DON'T do:**
- Convert frontmatter between formats ❌ (generate from source)
- Assume any Claude-specific APIs in core workflows ❌
- Require a running CLI/server ❌
- Use deprecated `~/.codex/prompts/` ❌ (confirmed: use AGENTS.md hierarchy instead)

### Codebase-Context MCP Integration — PARKED

> **Status:** Parked for future consideration. Requires pre-indexed codebase, which adds friction. Could be opt-in in the future.
> Full analysis in `docs/cc_gsdd_synergy.md`.

---

## GSDD Phase Plan

> For each phase below, the implementation discipline is:
> 1. Research what GSD does (from local source)
> 2. Research what OpenSpec/LeanSpec do
> 3. Decide what to keep, strip, or modify
> 4. Define the definition of done
> 5. List common pitfalls
> 6. Implement
> 7. Review and verify

### Phase 1: Core Lifecycle + Multi-Agent (Claude Code + Codex CLI)

**Scope:** Core init→plan→execute→verify loop + adapter generator for 2 agents

| Item | Definition of Done |
|------|-------------------|
| Init workflow | Creates SPEC.md + ROADMAP.md via deep questioning (with research when domain unfamiliar) |
| Plan workflow | Creates PLAN.md with tasks + `<research_check>` step for unfamiliar domains |
| Execute workflow | Implements plan tasks with atomic commits |
| Verify workflow | Verifies phase completion against success criteria |
| Resume workflow | Detects and resumes incomplete work |
| Quick workflow | Ad-hoc tasks without full ceremony (first-class, not workaround) |
| **Adapter generator** | `gsdd init --tools claude,codex` generates per-tool files |
| **Claude Code adapter** | Skills in `.claude/skills/gsdd-*/SKILL.md` with frontmatter |
| **Codex CLI adapter** | Governance + workflows in project-root `AGENTS.md` (LF standard) |
| SKILL.md | System instructions, under 410 lines |
| Templates | SPEC.md, ROADMAP.md, research templates |
| `gsdd` CLI | `init`, `find-phase` commands |

**Pitfalls:** Init must remain thorough (deep questioning + optional research), not just fast. Research GSD/OpenSpec/LeanSpec equivalent before implementing each workflow. Validate distilled workflows produce equivalent quality to GSD originals.

> [!IMPORTANT]
> **Context budget:** No single workflow file >410 lines. SKILL.md + active workflow combined should target <600 lines total. If any file exceeds this, split into primary + on-demand sub-workflow. *(Budget informed by LeanSpec research: >400 lines causes "context rot", >3,500 tokens triggers split recommendation.)*

> [!IMPORTANT]
> **Validation strategy:** Before shipping each workflow, run functional parity test: same project through GSD and GSDD, compare output quality. Coverage map: every GSD workflow step → verify GSDD equivalent covers it.

### Phase 2: More Agents + Research Workflow (Cursor + Antigravity)

**Scope:** Cursor + Antigravity adapters + standalone research workflow

| Item | Definition of Done |
|------|-------------------|
| Cursor adapter | Rules in `.cursor/` with Cursor-specific command format |
| Antigravity adapter | Workflows in `.agents/workflows/gsdd/` |
| Research workflow | Standalone pre-planning research for complex phases |
| Discussion workflow | Pre-planning phase discussion for complex phases |
| Optional parallel | Agents with subagent support can parallelize research |

**Pitfalls:** Research each agent's config structure before building adapter. Don't treat all agents the same.

### Phase 3: Milestones + Long-Term

**Scope:** Milestone lifecycle, archival, SPEC.md evolution

| Item | Definition of Done |
|------|-------------------|
| Milestone completion | Archives roadmap/requirements, tags in git |
| New milestone | Re-runs questioning scoped to next batch |
| SPEC.md evolution | Validated requirements accumulate |
| Staleness detection | Flags planning files with configurable staleness threshold (default TBD — **needs research**) |

**Pitfalls:** Don't make ROADMAP.md grow unbounded. Don't lose context across milestones.

### Phase 4: Init Research Enhancement

**Scope:** Optional parallel research during init (stack, features, architecture, pitfalls)

| Item | Definition of Done |
|------|-------------------|
| Research agents | Single-agent research with summary output |
| Optional parallel | Agents with subagent support can parallelize (4 dimensions, like GSD) |

**Pitfalls:** Warn about token cost. Make research optional. Don't require 4 agents.

### Phase 5: Remaining Agents + Staleness

**Scope:** GitHub Copilot, Gemini CLI, Windsurf, and remaining agent adapters

| Item | Definition of Done |
|------|-------------------|
| Gemini CLI adapter | Slash commands in `~/.gemini/commands/gsdd/` |
| GitHub Copilot adapter | Prompts in `.github/prompts/` |
| Additional agents | As demand warrants (see OpenSpec's 24-tool list for reference) |
| Staleness protocol | Files older than threshold are flagged during resume |
| Staleness policy | Documented in workflow: when to refresh vs when to keep |

**Pitfalls:** Don't treat all agents the same — research each one's config structure.

---

## Slash Commands (Detailed)

### How workflows are triggered per agent (verified Feb 2026)

| Agent | Mechanism | Location | Trigger |
|-------|-----------|----------|---------|
| Claude Code | Skills (`SKILL.md` + YAML frontmatter) | `.claude/skills/gsdd-*/SKILL.md` | `/gsdd-init`, `/gsdd-plan`, etc. |
| Codex CLI | AGENTS.md (hierarchical, plain markdown) | `<project-root>/AGENTS.md` | Instructions read at session start |
| Gemini CLI | AGENTS.md or `commands/` | `~/.gemini/commands/gsdd/` or AGENTS.md | `/gsdd:init` or session instructions |
| Cursor | AGENTS.md or `.cursor/rules/*.mdc` | `<project-root>/AGENTS.md` | Session instructions (Phase 2) |
| GitHub Copilot | AGENTS.md | `<project-root>/AGENTS.md` | Session instructions (Phase 5) |
| Antigravity | `.agents/workflows/*.md` | `.agents/workflows/gsdd/` | Workflow system (Phase 2) |
| Any agent | Read `SKILL.md` directly | `distilled/SKILL.md` | Manual: "Read SKILL.md and follow init" |

### Phase 1 Commands (7)

| Command | What it does |
|---------|-------------|
| `/gsdd:init` | New project: questioning → SPEC.md → ROADMAP.md |
| `/gsdd:plan` | Plan a phase from roadmap → PLAN.md |
| `/gsdd:execute` | Execute a phase plan → code changes |
| `/gsdd:verify` | Verify completed work → SUMMARY.md |
| `/gsdd:resume` | Show status, resume where agent left off |
| `/gsdd:quick` | One-off task outside the roadmap |
| `/gsdd:help` | Show available commands |

### Phase 2 Commands (3)

| Command | What it does |
|---------|-------------|
| `/gsdd:milestone` | Start new milestone on existing project |
| `/gsdd:complete` | Mark milestone as shipped, archive |
| `/gsdd:progress` | Show project status and phase progress |

---

## Current Implementation Status

### What we have (in `distilled/`)
| File | Lines | Status |
|------|-------|--------|
| `SKILL.md` | 166 | ⚠️ Good foundation, needs agent-agnostic updates |
| `workflows/init.md` | 171 | ❌ Needs full rewrite per this spec |
| `workflows/plan.md` | 133 | ⚠️ Needs review against GSD |
| `workflows/execute.md` | 136 | ⚠️ Needs review against GSD |
| `workflows/verify.md` | 130 | ⚠️ Needs review against GSD |
| `templates/spec.md` | 62 | ⚠️ Good, may need expansion |
| `templates/roadmap.md` | 75 | ⚠️ Should use checkbox format |

### What we have (broken)
| File | Issue |
|------|-------|
| `bin/gsdd.mjs` | Copies `distilled/` into projects — wrong approach |
| `bin/install.js` | GSD's original — needs distilled version |

### What we need to build
See Phase Plan above.

---

## Open Questions

1. ~~**npm package name:**~~ **RESOLVED:** `gsdd`
2. ~~**STATE.md:**~~ **RESOLVED:** No STATE.md. ROADMAP.md tracks current position inline.
3. ~~**Codex CLI config:**~~ **PARTIALLY RESOLVED:** `AGENTS.MD` + `~/.codex/prompts/` — but prompts may be deprecated. Needs verification during Phase 1 research.
4. ~~**Cursor config:**~~ **PARTIALLY RESOLVED:** `.cursor/rules/*.mdc` — but this is Cursor-specific. Needs evaluation against universal alternatives.
5. **Subagent roles:** Follow GSD's approach smartly. Subagent spawning is **core workflow** (most AI agents already spawn subagents like explore/codebase_investigator). **Dedicate full research session before reimplementing.**
6. **AGENTS.md generation:** Only if it's the standard across OpenSpec, GSD, LeanSpec etc. Research whether there's a smarter/better alternative.
7. **Best devex for command discovery:** Slash commands? Skills? AGENTS.md? Native plan mode integration? **Dedicate full research before Phase 1.**

---

## Principles

1. **Less is more** — Every file, command, and step must earn its place
2. **Agent-agnostic** — Plain markdown, no vendor APIs in core workflows
3. **Same outcome, fewer knobs** — init → plan → execute → verify is how GSD works and it's proven. OpenSpec uses a different model (change-based: explore → new → apply → archive). LeanSpec has no rigid workflow at all. GSDD keeps GSD's phase loop but strips the ceremony.
4. **Global install, project state** — Framework lives in agent config dir, project state lives in `.planning/` *(GSD uses `.gsd-planning/` — we simplified the name)*
5. **Subagent spawning is core** — GSD relies on subagents. Most modern AI agents already spawn subagents (explore, codebase_investigator, etc.). GSDD must support this as a core workflow, not as optional. **Dedicate research before reimplementing.**
6. **Slash commands are the interface** — Users trigger workflows via commands, not by manually instructing the agent
7. **GSD as base, strip what's unnecessary** — Don't reinvent. Fork, strip, ship.
8. **Research before implement** — For each phase: research GSD/OpenSpec/LeanSpec → decide → define done → pitfalls → implement → review
9. **Staleness is real** — Planning files become stale. Every resume must check recency. *(LeanSpec addresses this by keeping specs under 2,000 tokens each — so they're easy to refresh. GSDD should have a staleness detection mechanism, threshold TBD.)*
10. **Milestones from day one** — Long-term lifecycle is not an afterthought
11. **Optional power-ups, not dependencies** — Codebase-context MCP and vendor-specific hooks are optional enhancements. Core GSDD works with just markdown files + subagent workflows.
12. **For any developer** — GSDD works for solo devs, pairs, and teams. `.planning/` state is human-readable and shareable across agents and humans.
13. **Generators, not converters** — Multi-agent support uses the adapter generator pattern (proven by OpenSpec across 24 tools). Same source → per-tool output. Never convert lossy formats.
14. **Context budget** — No single file >410 lines. Monitor combined context load (SKILL.md + workflow). If over 600 lines combined, split. *(Informed by LeanSpec: >400 lines triggers context rot, >3,500 tokens triggers split.)*
15. **Adopt, don't reinvent** — Embrace proven AI engineering, context engineering, and agentic engineering patterns from the ecosystem. If OpenSpec/LeanSpec/GSD solved it, learn from their approach.
16. **Research is built into plan** — No separate explore command. Plan workflow includes a `<research_check>` step: if the domain is unfamiliar, research first, then plan. Like a true engineer.
