# Authorization Matrix Template

> OWASP-style authorization matrix for systematic auth verification.
> Create `.planning/AUTH_MATRIX.md` using this template when your project has multiple user roles or protected resources.

## When to Create This Matrix

Create an authorization matrix when your project has:
- Multiple user roles (e.g., anonymous, user, admin, owner)
- Protected resources that vary by role
- Ownership-scoped data (users can only access their own records)
- Admin or operator surfaces that must be restricted

Skip this matrix for single-role projects or projects with no auth requirements.

## Matrix Format

Use the OWASP pivot format: rows are resources, columns are roles, cells are permissions.

### Permission Values

| Value | Meaning |
|-------|---------|
| ALLOW | Role can perform this action on any matching resource |
| DENY  | Role must be explicitly rejected (not just "no route") |
| OWN   | Role can perform this action only on resources they own |
| N/A   | Action does not apply to this resource |

### Matrix Table

```markdown
| Resource | Action | anonymous | user | admin |
|----------|--------|-----------|------|-------|
| /login   | POST   | ALLOW     | ALLOW| ALLOW |
| /profile | GET    | DENY      | OWN  | ALLOW |
| /profile | PUT    | DENY      | OWN  | ALLOW |
| /users   | GET    | DENY      | DENY | ALLOW |
| /users   | DELETE | DENY      | DENY | ALLOW |
| /posts   | GET    | ALLOW     | ALLOW| ALLOW |
| /posts   | POST   | DENY      | ALLOW| ALLOW |
| /posts   | DELETE | DENY      | OWN  | ALLOW |
```

Adapt the table to your project's actual resources, actions, and roles. Add or remove columns as needed.

## Sensitive Surfaces

The following resource categories MUST have matrix coverage when they exist in your project:

- **User-scoped data** (profiles, settings, personal records) — require OWN or DENY
- **Admin surfaces** (user management, system config, audit logs) — require DENY for non-admin roles
- **Financial data** (billing, payments, subscriptions) — require explicit DENY or OWN
- **Destructive actions** (delete, bulk operations, account removal) — require explicit role gates
- **API keys and credentials** — require DENY for non-owner roles

If a sensitive surface exists in your codebase but is missing from the matrix, the integration checker's narrative auth check (Step 4) will still flag it — Step 4 runs unconditionally regardless of whether this matrix exists. Step 4a only verifies cells that are already in the matrix.

## How the Integration Checker Uses This Matrix

During milestone audits, the integration checker (Step 4a) will:

1. Parse each row of the matrix table(s)
2. For each cell (resource x role x expected permission):
   - **ALLOW**: Verify the role can access the resource (no auth gate blocks it)
   - **DENY**: Verify explicit rejection exists (middleware, guard, or policy denies access)
   - **OWN**: Verify ownership check is enforced (not just auth, but scoped to the user's records)
3. Report each cell as:
   - **VERIFIED**: Implementation matches the matrix expectation
   - **MISMATCH**: Implementation contradicts the matrix (e.g., DENY expected but no guard found)
   - **UNTESTED**: Cannot determine from static analysis (e.g., dynamic policy evaluation)

The narrative auth check (Step 4) always runs regardless of whether this matrix exists.

## File Location

Save your project's authorization matrix as `.planning/AUTH_MATRIX.md`.

The integration checker will automatically detect and consume it when present. No configuration needed.
