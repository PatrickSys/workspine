# Phase Approach Template

Template for `.planning/phases/XX-name/{phase_num}-APPROACH.md` — captures implementation decisions and validated assumptions for a phase.

**Purpose:** Document decisions that downstream agents need. Planner uses this to know WHAT choices are locked vs flexible. Plan-checker verifies plans honor these decisions.

**Key principle:** The top-level structure (`<domain>`, `<decisions>`, `<assumptions>`, `<deferred>`) is fixed. Section names WITHIN `<decisions>` emerge from what was actually discussed for THIS phase — a CLI phase has CLI-relevant sections, a UI phase has UI-relevant sections.

**Downstream consumers:**
- `planner` — Reads decisions to constrain implementation choices. Locked decisions must be implemented. Agent's Discretion items allow planner flexibility.
- `plan-checker` — Reads decisions to verify plans implement chosen approaches (approach_alignment dimension). Flags plans that contradict explicit user choices.

---

## File Template

```markdown
# Phase [X]: [Name] - Approach

**Explored:** [date]
**Status:** Ready for planning

<domain>
## Phase Boundary

[Clear statement of what this phase delivers — the scope anchor. This comes from ROADMAP.md and is fixed. Discussion clarifies implementation within this boundary.]

</domain>

<decisions>
## Implementation Decisions

### [Gray Area 1 that was discussed]
**Chosen approach:** [name]
**Alternatives considered:** [Option B], [Option C]
**Why this one:** [reasoning from research + user preference]
- [Specific decision from questioning]
- [Another decision if applicable]

### [Gray Area 2 that was discussed]
**Chosen approach:** [name]
**Alternatives considered:** [Option B]
**Why this one:** [reasoning]
- [Specific decision]

### Agent's Discretion
[Areas where user explicitly said "you decide" — the agent has flexibility here during planning/implementation]

</decisions>

<assumptions>
## Validated Assumptions

### Confirmed
- [confident] [assumption confirmed by user]

### Accepted (not challenged)
- [assuming] [assumption user didn't challenge — planner should still honor but note it]

### Corrected
- [corrected] [original assumption] → [user's correction]

</assumptions>

<deferred>
## Deferred Ideas

[Ideas that came up during discussion but belong in other phases. Captured here so they're not lost, but explicitly out of scope for this phase.]

[If none: "None — discussion stayed within phase scope"]

</deferred>

---

*Phase: XX-name*
*Approach explored: [date]*
```

## Good Examples

**Example 1: Visual feature (Dashboard)**

```markdown
# Phase 3: Interactive Dashboard - Approach

**Explored:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Build an interactive dashboard with configurable widgets. Users can view metrics and rearrange layout. Widget creation and custom data sources are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Chart rendering
**Chosen approach:** Recharts
**Alternatives considered:** D3 + custom components, Chart.js
**Why this one:** React-native, SSR-friendly, good defaults. Matches existing React patterns. D3 would give more control but requires more code for standard charts.
- Bar charts and line charts for metrics — no pie charts in v1
- Charts should be interactive (hover tooltips) but not editable
- Responsive: charts resize with widget container

### Widget layout
**Chosen approach:** react-grid-layout
**Alternatives considered:** CSS Grid + custom drag, @dnd-kit grid
**Why this one:** Purpose-built for dashboard grids. Layout serialization to JSON for persistence. Mature production usage.
- Drag-to-reorder enabled
- Resize handles on bottom-right corner
- 12-column grid, responsive breakpoints
- Layout persisted to localStorage (not server)

### Agent's Discretion
- Loading skeleton design
- Exact spacing and typography within widgets
- Error state handling for failed data fetches

</decisions>

<assumptions>
## Validated Assumptions

### Confirmed
- [confident] Using existing Tailwind patterns from Phase 1-2

### Accepted (not challenged)
- [assuming] Dashboard data comes from static JSON for v1 (no real API)

### Corrected
- [corrected] Dashboard is read-only → Widgets DO need drag reorder

</assumptions>

<deferred>
## Deferred Ideas

- Real-time data updates — future phase
- Custom widget creation — add to backlog
- Dashboard sharing/export — out of scope for v1

</deferred>

---

*Phase: 03-dashboard*
*Approach explored: 2026-03-22*
```

**Example 2: API feature (Authentication)**

```markdown
# Phase 1: Authentication - Approach

**Explored:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can register and log in with email/password. Session management via JWT. OAuth and MFA are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Session handling
**Chosen approach:** HTTP-only cookies with JWT
**Alternatives considered:** localStorage JWT, session-based (server-side)
**Why this one:** HTTP-only cookies prevent XSS token theft. JWT avoids server-side session storage. Standard pattern for Next.js apps.
- Access token: 15-minute expiry
- Refresh token: 7-day expiry, rotation on use
- Logout clears both tokens

### Error responses
**Chosen approach:** Structured JSON errors
**Alternatives considered:** Plain text errors, RFC 7807 Problem Details
**Why this one:** Consistent with existing API patterns. RFC 7807 is overkill for this project size.
- Always include: status code, error code, user-facing message
- Never include: stack traces, internal IDs
- Rate limit errors: include retry-after header

### Agent's Discretion
- Password hashing library (bcrypt vs argon2)
- Exact JWT payload structure
- Email validation regex vs library

</decisions>

<assumptions>
## Validated Assumptions

### Confirmed
- [confident] Email/password only for v1 (no OAuth)

### Accepted (not challenged)
- [assuming] No email verification required for v1

### Corrected
- [corrected] Single-device sessions → Allow multi-device (don't invalidate other sessions on login)

</assumptions>

<deferred>
## Deferred Ideas

- OAuth providers (Google, GitHub) — Phase 4
- MFA/2FA — add to backlog

</deferred>

---

*Phase: 01-authentication*
*Approach explored: 2026-03-22*
```

## Guidelines

**This template captures DECISIONS for downstream agents.**

The output should answer: "What choices are locked for the planner? Where does the planner have discretion?"

**After creation:**
- File lives in phase directory: `.planning/phases/XX-name/{phase_num}-APPROACH.md`
- Planner reads decisions to constrain implementation tasks
- Plan-checker verifies approach_alignment: plans must implement chosen approaches
- Downstream agents should NOT need to ask the user again about captured decisions
