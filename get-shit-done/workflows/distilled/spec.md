<purpose>
Create a specification (SPEC.md) for a goal, with optional research. Distilled workflow.
</purpose>

<process>

## 1. Setup

Extract goal from arguments.
Ensure `.planning` directory exists.

## 2. Research (Optional)

Check for `--research` flag.

**If `--research`:**
Spawn `gsd-project-researcher` to investigate.

```
Task(
  prompt="
    <objective>
    Research the goal: ${GOAL}
    Identify key requirements, tech stack choices, and potential pitfalls.
    </objective>

    <output>
    Write to: .planning/RESEARCH.md
    </output>
  ",
  subagent_type="general-purpose",
  model="claude-3-opus-20240229",
  description="Research goal"
)
```

## 3. Create Spec

Spawn `gsd-planner`.

```
Task(
  prompt="
    <objective>
    Create a specification and plan for the goal: ${GOAL}
    </objective>

    <files_to_read>
    - .planning/RESEARCH.md (if exists)
    - ./CLAUDE.md (if exists)
    </files_to_read>

    <constraints>
    1. Create a SINGLE file: .planning/SPEC.md
    2. Format it as a standard GSD PLAN.md (XML tasks), but name it SPEC.md.
    3. IGNORE roadmap requirements/IDs (this is a standalone spec).
    4. Include a 'must_haves' section for verification.
    5. Plan for atomic execution steps.
    6. Set 'autonomous: true' unless user interaction is strictly required.
    </constraints>

    <output>
    Write to: .planning/SPEC.md
    </output>
  ",
  subagent_type="gsd-planner",
  model="claude-3-opus-20240229",
  description="Create Spec"
)
```

## 4. Finish

Report: "Spec created at .planning/SPEC.md. Run `gsdd execute` to start."

</process>
