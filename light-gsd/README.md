# Light GSD (Get-Shit-Done)

A distilled, lightweight version of the Get-Shit-Done framework for AI agents.

## Philosophy

GSD is great, but sometimes it's too much. Light GSD strips away the complexity (multiple agents, waves, extensive configuration) and focuses on the core loop that works:

1.  **Plan**: Define a clear goal and a simple checklist of tasks.
2.  **Execute**: Do the work, task by task.
3.  **Review**: Verify the work.

This tool is designed to be used by AI agents (like Claude, ChatGPT, etc.) as a CLI tool to structure their work, or by humans to guide agents.

## Usage

### 1. Initialize

```bash
gsd-lite init
```

Creates a `.gsd-lite` directory for configuration (optional) and prepares the environment.

### 2. Plan

```bash
gsd-lite plan "I want to add a new feature X..."
```

Creates a `PLAN.md` file with a checklist of tasks based on your goal. If `PLAN.md` already exists, it updates it.

**Example `PLAN.md`:**

```markdown
# Plan: Add Feature X

- [ ] Create `src/feature-x.js`
- [ ] Add tests in `tests/feature-x.test.js`
- [ ] Update documentation
```

### 3. Execute

```bash
gsd-lite execute
```

Reads `PLAN.md`, finds the first unchecked task, and provides instructions to the agent to execute it. The agent (you) should then perform the task and mark it as done.

*Note: In the future, this can be automated to run sub-agents.*

### 4. Review

```bash
gsd-lite review
```

Verifies the work done. This can run a command (e.g., `npm test`) or just prompt for manual verification.

## File Structure

- `PLAN.md`: The single source of truth for the current task.
- `.gsd-lite/`: Configuration directory (optional).

## Why Light GSD?

- **Zero Config**: Just run it.
- **Single File State**: Everything is in `PLAN.md`. Easy to read, easy to edit.
- **Agent Friendly**: Output is optimized for LLMs to understand what to do next.
