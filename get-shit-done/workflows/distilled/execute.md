<purpose>
Execute the specification (SPEC.md) using GSD executors.
</purpose>

<process>

## 1. Setup

Ensure `.planning/SPEC.md` exists.

## 2. Execute

Spawn `gsd-executor`.

```
Task(
  prompt="
    <objective>
    Execute the specification: .planning/SPEC.md
    </objective>

    <files_to_read>
    - .planning/SPEC.md
    - ./CLAUDE.md (if exists)
    - .planning/config.json (if exists)
    </files_to_read>

    <constraints>
    1. Read and follow .planning/SPEC.md tasks.
    2. Commit each task atomically.
    3. Create a SUMMARY.md at .planning/SUMMARY.md when complete.
    4. Handle deviations: fix bugs, but ask before architectural changes.
    5. Do not update ROADMAP.md or STATE.md (distilled mode).
    </constraints>

    <output>
    Write to: .planning/SUMMARY.md
    </output>
  ",
  subagent_type="gsd-executor",
  model="claude-3-sonnet-20240229",
  description="Execute Spec"
)
```

## 3. Finish

Report: "Execution complete. Summary at .planning/SUMMARY.md. Run `gsdd verify` to verify."

</process>
