import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function renderOpenCodePlanChecker(delegateContent) {
  return `---
description: Fresh-context plan checker for GSDD plan drafts. Review-only; never edits plans directly.
mode: subagent
hidden: true
tools:
  write: false
  edit: false
  bash: false
---

${delegateContent.trim()}
`;
}

function renderOpenCodePlanCommand() {
  return `---
description: OpenCode-native phase planning with fresh-context plan checking for GSDD
subtask: false
---

You are the OpenCode-native \`/gsdd-plan\` command for GSDD phase planning.

Portable contract:
- Read \`.agents/skills/gsdd-plan/SKILL.md\` first. That file remains the canonical vendor-agnostic plan contract.
- Keep the portable contract honest: it defines the workflow, but it does not by itself prove fresh-context checker orchestration across runtimes.
- If the portable skill says plan is still a stub, treat that as a portability-status warning for the generic surface, not as a stop signal for this OpenCode-native adapter path.

Native OpenCode adapter rule:
- This command is the canonical OpenCode-native entry surface for \`/gsdd-plan\`.
- Stay in the primary conversation context for orchestration so the checker can run as its own fresh-context subagent.
- Use the native \`gsdd-plan-checker\` subagent for review-only checking.
- Do NOT claim that other runtimes have the same behavior unless their own adapters explicitly implement and prove it.

Execution flow:
1. Read \`.planning/SPEC.md\`, \`.planning/ROADMAP.md\`, \`.planning/config.json\`, relevant phase research, and any existing phase plan files.
2. Resolve the target phase from the command arguments. If no phase is provided, choose the first roadmap phase that is not complete.
3. Produce the initial phase plan according to \`.agents/skills/gsdd-plan/SKILL.md\`.
4. If \`.planning/config.json\` has \`workflow.planCheck: false\`, stop after planner self-check and explicitly report reduced assurance.
5. If \`workflow.planCheck: true\`, invoke the hidden \`gsdd-plan-checker\` subagent with fresh context.
6. Pass only explicit inputs to the checker:
   - target phase goal and requirement IDs
   - relevant locked decisions / deferred items from \`.planning/SPEC.md\`
   - relevant phase research file(s)
   - produced \`.planning/phases/*-PLAN.md\` file(s)
7. Require the checker to return JSON only using this schema:
   {
     "status": "passed" | "issues_found",
     "summary": "One sentence overall assessment",
     "issues": [
       {
         "dimension": "requirement_coverage | task_completeness | dependency_correctness | key_link_completeness | scope_sanity | must_have_quality | context_compliance",
         "severity": "blocker | warning",
         "description": "What is wrong",
         "plan": "01-PLAN",
         "task": "1-02",
         "fix_hint": "Specific revision instruction"
       }
     ]
   }
8. If the checker returns \`passed\`, finish and summarize.
9. If the checker returns \`issues_found\`, revise the existing plan files only where needed, then run the checker again.
10. Maximum 3 checker cycles total. If blockers remain after cycle 3, stop and escalate to the user instead of pretending the plan is ready.

Return a concise orchestration summary:
- target phase
- whether native plan checking ran
- checker cycle count
- final result: passed | reduced_assurance | escalated

Never return raw checker JSON without summarizing it.
`;
}

function createOpenCodeAdapter({ cwd, workflows, renderOpenCodeCommandContent, getDelegateContent }) {
  const commandsDir = join(cwd, '.opencode', 'commands');
  const agentsDir = join(cwd, '.opencode', 'agents');

  return {
    id: 'opencode',
    name: 'opencode',
    kind: 'native_capable',
    detect() {
      return existsSync(join(cwd, '.opencode'));
    },
    isInstalled() {
      return existsSync(commandsDir) || existsSync(agentsDir);
    },
    generate() {
      mkdirSync(commandsDir, { recursive: true });
      for (const workflow of workflows) {
        const content = workflow.name === 'gsdd-plan'
          ? renderOpenCodePlanCommand()
          : renderOpenCodeCommandContent(workflow);
        writeFileSync(
          join(commandsDir, `${workflow.name}.md`),
          content
        );
      }

      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'gsdd-plan-checker.md'),
        renderOpenCodePlanChecker(getDelegateContent('plan-checker.md'))
      );
    },
    summary(action) {
      return `${action} OpenCode slash commands (.opencode/commands/gsdd-*.md) and native agents (.opencode/agents/gsdd-*.md)`;
    },
  };
}

export { createOpenCodeAdapter };
