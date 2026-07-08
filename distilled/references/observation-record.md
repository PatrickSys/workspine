# Observation record

When a step claims UI or runtime behavior was verified, write down what was
actually observed. Plain markdown, one record per checked flow:

- **flow**: which screen/route/behavior was checked (plans name these up front:
  a plan touching UI lists the flows that need a real-browser look).
- **tool**: what did the looking (`agent-browser`, `playwright`, `manual`,
  or a project command).
- **observed**: what actually happened — rendered DOM state, behavior on
  interaction, console/network errors seen or absent.
- **artifacts**: paths to screenshot / console log / network log, if captured.
- **safe to publish**: yes/no — may the artifacts leave the repo (no secrets,
  no private data)?
- **stale after**: what change would invalidate this observation (optional).
- **result**: worked / failed (say why) / partly (say what is missing).

This replaces the retired machine-validated UI-proof bundle (`ui_proof_slots`,
`gsdd ui-proof validate/compare`). The structure survives; the JSON schema
validator does not.
