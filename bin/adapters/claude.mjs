import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  PLAN_CHECK_DIMENSIONS,
  MAX_CHECKER_CYCLES,
  CHECKER_STATUSES,
} from '../lib/plan-constants.mjs';

const CLAUDE_MODEL_PROFILES = {
  quality: 'opus',
  balanced: 'sonnet',
  budget: 'haiku',
};

function renderClaudeApproachExplorer(delegateContent, modelAlias = 'opus') {
  return `---
name: gsdd-approach-explorer
description: Explores implementation approaches for a phase and aligns with the user through structured questioning before planning begins.
model: ${modelAlias}
tools: Read, Grep, Glob, WebSearch, WebFetch, Write, AskUserQuestion
---

${delegateContent.trim()}
`;
}

function renderClaudePlanChecker(delegateContent, modelAlias = 'sonnet') {
  return `---
name: gsdd-plan-checker
description: Fresh-context plan checker for GSDD plan drafts. Review-only; never edits plans directly.
model: ${modelAlias}
tools: Read, Grep, Glob
---

${delegateContent.trim()}
`;
}

function renderClaudePlanSkill() {
  return `---
name: gsdd-plan
description: Claude-native Phase planning with fresh-context plan checking for GSDD
argument-hint: [phase-number]
---

You are the Claude-native \`/gsdd-plan\` skill for GSDD phase planning.

Portable contract:
- Read \`.agents/skills/gsdd-plan/SKILL.md\` first. That file remains the canonical vendor-agnostic plan contract.
- Keep the portable contract honest: it defines the workflow, but it does not by itself prove fresh-context checker orchestration across runtimes.
- If the portable skill says plan is still a stub, treat that as a portability-status warning for the generic surface, not as a stop signal for this Claude-native adapter path.

Native Claude adapter rule:
- This skill is the canonical Claude-native entry surface for \`/gsdd-plan\`.
- Stay in the primary Claude context for orchestration. Do NOT fork this skill into a subagent, because the checker must run as its own fresh-context subagent.
- Use the native \`gsdd-plan-checker\` subagent to regain the fresh-context checker pass that portable markdown alone cannot guarantee.
- Do NOT claim that other runtimes have the same behavior unless their own adapters explicitly implement and prove it.

Execution flow:
1. Read \`.planning/SPEC.md\`, \`.planning/ROADMAP.md\`, \`.planning/config.json\`, relevant phase research, and any existing phase plan files.
2. Resolve the target phase from the command arguments. If no phase is provided, choose the first roadmap phase that is not complete.
3. **Approach exploration** (before planning):
   a. Check \`.planning/config.json\` for \`workflow.discuss\`. If \`false\` or missing, skip to step 4 and report \`reduced_alignment\` in the summary.
   b. Check if \`{phase_dir}/{padded_phase}-APPROACH.md\` exists. If it does, offer the user: "Use existing" / "Update it" / "View it". If "Use existing", load decisions, then validate the alignment proof before step 4; proofless or invalid existing APPROACH.md must be updated, not silently trusted.
   c. If no APPROACH.md exists (or user chose "Update"): invoke the native \`gsdd-approach-explorer\` subagent with the phase goal, requirement IDs, project config from \`.planning/config.json\` (especially \`workflow.discuss\`), SPEC locked decisions, phase research, and relevant codebase files.
   d. The explorer runs a GSD-style interactive conversation with the user (gray areas, research, deep-dive questions, assumptions) and writes APPROACH.md.
   e. Before planning, confirm APPROACH.md records all canonical proof fields: \`alignment_status\`, \`alignment_method\`, \`user_confirmed_at\`, \`explicit_skip_approved\`, \`skip_scope\`, \`skip_rationale\`, and \`confirmed_decisions\`. For \`alignment_status: user_confirmed\`, \`confirmed_decisions\` must name the locked decisions and skip fields may be \`false\`/\`N/A\`; for \`alignment_status: approved_skip\`, \`explicit_skip_approved: true\`, \`skip_scope\`, and \`skip_rationale\` must be substantive. Agent-only "No questions needed" is not valid proof under \`workflow.discuss: true\`.
   f. Load APPROACH.md decisions as locked constraints alongside SPEC.md decisions.
4. Produce the initial phase plan according to \`.agents/skills/gsdd-plan/SKILL.md\`. Pass APPROACH.md decisions (if any) as locked constraints to the planner.
5. If \`.planning/config.json\` has \`workflow.planCheck: false\`, stop after planner self-check and explicitly report reduced assurance. This only skips the independent checker; it does not skip the step 3 alignment-proof gate when \`workflow.discuss: true\`.
6. If \`workflow.planCheck: true\`, invoke the native \`gsdd-plan-checker\` subagent with fresh context.
7. Pass only explicit inputs to the checker:
   - target phase goal and requirement IDs
   - relevant locked decisions / deferred items from \`.planning/SPEC.md\`
   - project config from \`.planning/config.json\`, especially \`workflow.discuss\` and \`workflow.planCheck\`
   - approach decisions from \`.planning/phases/*-APPROACH.md\` (if exists)
   - relevant phase research file(s)
   - produced \`.planning/phases/*-PLAN.md\` file(s)
8. Require the checker to return a single JSON object with this shape:
   {
     "status": "passed",
     "summary": "One sentence overall assessment",
     "issues": [
       {
         "dimension": "${PLAN_CHECK_DIMENSIONS.join(' | ')}",
         "severity": "blocker | warning",
         "description": "What is wrong",
         "plan": "01-PLAN",
         "task": "1-02",
         "fix_hint": "Specific revision instruction"
       }
     ]
   }
   Status must be either "${CHECKER_STATUSES[0]}" or "${CHECKER_STATUSES[1]}".
9. If the checker returns \`passed\`, finish and summarize.
10. If the checker returns \`issues_found\`, revise the existing plan files only where needed, then run the checker again.
11. Maximum ${MAX_CHECKER_CYCLES} checker cycles total. If blockers remain after cycle ${MAX_CHECKER_CYCLES}, stop and escalate to the user instead of pretending the plan is ready.

Return a concise orchestration summary:
- target phase
- whether approach exploration ran (and alignment level: full | reduced_alignment | skipped)
- whether native plan checking ran
- checker cycle count
- final result: passed | reduced_assurance | escalated

Never return raw checker JSON without summarizing it.
`;
}

function renderClaudePlanCommand() {
  return `---
description: Compatibility alias for the Claude-native \`/gsdd-plan\` skill
argument-hint: [phase-number]
allowed-tools: Read
---

Read \`.claude/skills/gsdd-plan/SKILL.md\` and execute that skill as the canonical Claude-native \`/gsdd-plan\` entry.

Rules:
- Do NOT duplicate orchestration logic here.
- Do NOT fork into a separate planning subagent.
- Preserve the argument value and apply it when resolving the target phase.
`;
}

function createClaudeAdapter({ cwd, workflows, renderSkillContent, getDelegateContent, resolveRuntimeAgentModel }) {
  const skillsDir = join(cwd, '.claude', 'skills');
  const commandsDir = join(cwd, '.claude', 'commands');
  const agentsDir = join(cwd, '.claude', 'agents');

  return {
    id: 'claude',
    name: 'claude',
    kind: 'native_capable',
    subagentFiles: [
      '.claude/agents/gsdd-plan-checker.md',
      '.claude/agents/gsdd-approach-explorer.md',
    ],
    detect() {
      return existsSync(join(cwd, 'CLAUDE.md')) || existsSync(join(cwd, '.claude'));
    },
    isInstalled() {
      return existsSync(skillsDir) || existsSync(commandsDir) || existsSync(agentsDir);
    },
    generate() {
      const checkerModelAlias = resolveRuntimeAgentModel({
        cwd,
        runtime: 'claude',
        agentId: 'plan-checker',
        profileMap: CLAUDE_MODEL_PROFILES,
      });
      const explorerModelAlias = resolveRuntimeAgentModel({
        cwd,
        runtime: 'claude',
        agentId: 'approach-explorer',
        profileMap: CLAUDE_MODEL_PROFILES,
      });
      for (const workflow of workflows) {
        const dir = join(skillsDir, workflow.name);
        mkdirSync(dir, { recursive: true });
        const content = workflow.name === 'gsdd-plan'
          ? renderClaudePlanSkill()
          : renderSkillContent(workflow);
        writeFileSync(join(dir, 'SKILL.md'), content);
      }

      mkdirSync(commandsDir, { recursive: true });
      writeFileSync(join(commandsDir, 'gsdd-plan.md'), renderClaudePlanCommand());

      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'gsdd-plan-checker.md'),
        renderClaudePlanChecker(getDelegateContent('plan-checker.md'), checkerModelAlias)
      );
      writeFileSync(
        join(agentsDir, 'gsdd-approach-explorer.md'),
        renderClaudeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelAlias)
      );
    },
    summary(action) {
      return `${action} Claude Code skills (.claude/skills/gsdd-*), native commands (.claude/commands/gsdd-*.md), and native agents (.claude/agents/gsdd-*.md)`;
    },
  };
}

export {
  createClaudeAdapter,
  CLAUDE_MODEL_PROFILES,
  renderClaudeApproachExplorer,
  renderClaudePlanChecker,
  renderClaudePlanCommand,
  renderClaudePlanSkill,
};
