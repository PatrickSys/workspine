<purpose>
Verify the executed specification (SPEC.md) using GSD verifiers.
</purpose>

<process>

## 1. Setup

Ensure `.planning/SPEC.md` exists.

## 2. Verify

Spawn `gsd-verifier`.

```
Task(
  prompt="
    <objective>
    Verify the implementation of: .planning/SPEC.md
    </objective>

    <files_to_read>
    - .planning/SPEC.md
    - .planning/SUMMARY.md (if exists)
    - ./CLAUDE.md (if exists)
    </files_to_read>

    <constraints>
    1. Read 'must_haves' from SPEC.md.
    2. Check each requirement against the codebase.
    3. Run automated tests if specified in SPEC.md.
    4. Create a VERIFICATION.md report.
    </constraints>

    <output>
    Write to: .planning/VERIFICATION.md
    </output>
  ",
  subagent_type="gsd-verifier",
  model="claude-3-sonnet-20240229",
  description="Verify Spec"
)
```

## 3. Finish

Report: "Verification complete. Report at .planning/VERIFICATION.md."

</process>
