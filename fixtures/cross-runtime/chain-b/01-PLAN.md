---
phase: 02-sample
plan: 01
runtime: opencode
assurance: cross_runtime_checked
requirements:
  - REQ-SAMPLE-02
must_haves:
  - Second sample feature works end-to-end
---

# Phase 02: Second Sample Feature - Plan 01

## Objective

Sample plan fixture for cross-runtime validation. This artifact represents a plan produced by OpenCode.

## Tasks

<task id="01-01" type="auto">
<title>Implement second sample feature</title>
<files>
  - CREATE: src/sample-two.js
</files>
<action>
Create the second sample feature module.
</action>
<verify>
  - Run `node src/sample-two.js` and confirm output
</verify>
<done>
Second sample feature module exists and runs.
</done>
</task>

<plan_check>
checker: cross_runtime
checker_runtime: claude-code
status: passed
cycles: 1
issues: []
</plan_check>
