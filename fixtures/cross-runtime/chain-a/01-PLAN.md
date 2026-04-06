---
phase: 01-sample
plan: 01
runtime: claude-code
assurance: cross_runtime_checked
requirements:
  - REQ-SAMPLE-01
must_haves:
  - Sample feature works end-to-end
---

# Phase 01: Sample Feature - Plan 01

## Objective

Sample plan fixture for cross-runtime validation. This artifact represents a plan produced by Claude Code.

## Tasks

<task id="01-01" type="auto">
<title>Implement sample feature</title>
<files>
  - CREATE: src/sample.js
</files>
<action>
Create the sample feature module.
</action>
<verify>
  - Run `node src/sample.js` and confirm output
</verify>
<done>
Sample feature module exists and runs.
</done>
</task>

<plan_check>
checker: cross_runtime
checker_runtime: opencode
status: passed
cycles: 1
issues: []
</plan_check>
