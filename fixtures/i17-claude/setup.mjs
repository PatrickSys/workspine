#!/usr/bin/env node

/**
 * I17 Fixture Scaffold — creates a disposable project with a deliberately
 * flawed PLAN.md for testing Claude's max-3 plan-checker escalation loop.
 *
 * Usage:
 *   node fixtures/i17-claude/setup.mjs [target-dir]
 *
 * If no target-dir is given, creates a temp directory.
 * After scaffolding, open the directory in Claude Code and run /gsdd-plan 1.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const targetDir = process.argv[2]
  || await mkdtemp(join(tmpdir(), 'gsdd-i17-'));

console.log(`Scaffolding I17 fixture in: ${targetDir}`);

// Step 1: Run gsdd init
try {
  execSync('npx gsdd init --tools claude', { cwd: targetDir, stdio: 'inherit' });
} catch (e) {
  console.error('gsdd init failed. Ensure gsdd is available via npx.');
  console.error(e.message);
  process.exit(1);
}

// Step 2: Write minimal SPEC.md
const specContent = `# I17 Test Project

## Requirements

- [REQ-01] Users can view a list of items
- [REQ-02] Users can create a new item

## Key Decisions

- Use Node.js with Express
- SQLite for storage
`;

await writeFile(join(targetDir, '.planning', 'SPEC.md'), specContent);

// Step 3: Write minimal ROADMAP.md
const roadmapContent = `# Roadmap

## Phases

- [ ] **Phase 1: Core CRUD** — Users can view and create items

## Phase Details

### Phase 1: Core CRUD

**Goal:** Users can view and create items
**Status:** [ ]
**Requirements:** REQ-01, REQ-02
**Success Criteria:**
- Users can see a list of items
- Users can add an item and see it appear in the list
**Depends on:** none
`;

await writeFile(join(targetDir, '.planning', 'ROADMAP.md'), roadmapContent);

// Step 4: Write deliberately flawed PLAN.md
const phaseDir = join(targetDir, '.planning', 'phases', '01-core-crud');
await mkdir(phaseDir, { recursive: true });

const planContent = `---
phase: 01-core-crud
plan: 01
type: execute
wave: 1
depends_on: []
files-modified:
  - src/index.ts
autonomous: true
---

# Phase 01: Core CRUD - Plan 01

## Objective
Build the core features.

## Tasks

<task id="01-01" type="auto">
  <files>
    - CREATE: src/index.ts
  </files>
  <action>
    Set up the project.
  </action>
  <done>
    It works.
  </done>
</task>

<task id="01-02" type="auto">
  <files>
    - MODIFY: src/index.ts
  </files>
  <action>
    Add items feature.
  </action>
  <verify>
    - Run \`npm test -- tests/items.test.ts\`
  </verify>
  <done>
    Items work.
  </done>
</task>

## Notes
This plan is deliberately flawed for I17 validation:
- Missing requirements frontmatter (triggers requirement_coverage)
- Missing must_haves frontmatter (triggers must_have_quality)
- Task 01-01 has no <verify> section (triggers task_completeness)
- Task 01-02 references uncreated test file (triggers dependency_correctness)
- Vague done criteria (triggers must_have_quality)
- Vague action descriptions (triggers task_completeness)
`;

await writeFile(join(phaseDir, '01-PLAN.md'), planContent);

console.log(`
=== I17 Fixture Ready ===

Directory: ${targetDir}

Flaws in 01-PLAN.md (should trigger ≥4 checker dimensions):
  1. Missing 'requirements' frontmatter  → requirement_coverage
  2. Missing 'must_haves' frontmatter    → must_have_quality
  3. Task 01-01 has no <verify>          → task_completeness
  4. Task 01-02 refs uncreated test file → dependency_correctness
  5. Vague <done> criteria               → must_have_quality
  6. Vague <action> descriptions         → task_completeness

Next steps:
  1. Open this directory in Claude Code
  2. Run: /gsdd-plan 1
  3. Observe checker cycles and capture evidence per .internal-research/i17-fixture-guide.md
`);
