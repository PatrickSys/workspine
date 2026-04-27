import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import { join } from 'path';
import {
  PLAN_CHECK_DIMENSIONS,
  MAX_CHECKER_CYCLES,
  CHECKER_STATUSES,
} from '../lib/plan-constants.mjs';

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath.startsWith('~/')) {
    return join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function parseJsonc(content) {
  if (!content) return {};
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  let result = '';
  let inString = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (inString) {
      result += char;
      if (char === '\\' && i + 1 < content.length) {
        result += next;
        i += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      i++;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      if (i < content.length - 1) i += 2;
      continue;
    }

    result += char;
    i++;
  }

  return JSON.parse(result.replace(/,(\s*[}\]])/g, '$1'));
}

function readOpenCodeConfig(configPath) {
  if (!configPath || !existsSync(configPath)) return null;
  try {
    return parseJsonc(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

function getOpenCodeConfigPaths(cwd) {
  const globalConfig = join(os.homedir(), '.config', 'opencode', 'opencode.json');
  const customConfig = process.env.OPENCODE_CONFIG
    ? expandHome(process.env.OPENCODE_CONFIG)
    : null;
  const projectConfig = join(cwd, 'opencode.json');

  return [globalConfig, customConfig, projectConfig].filter(Boolean);
}

function detectOpenCodeConfiguredModel(cwd) {
  let configuredModel = null;

  for (const configPath of getOpenCodeConfigPaths(cwd)) {
    const config = readOpenCodeConfig(configPath);
    if (config && typeof config.model === 'string' && config.model.includes('/')) {
      configuredModel = config.model.trim();
    }
  }

  if (process.env.OPENCODE_CONFIG_CONTENT) {
    try {
      const inlineConfig = parseJsonc(process.env.OPENCODE_CONFIG_CONTENT);
      if (typeof inlineConfig.model === 'string' && inlineConfig.model.includes('/')) {
        configuredModel = inlineConfig.model.trim();
      }
    } catch {
      // Ignore malformed inline config and keep the best file-based result.
    }
  }

  return configuredModel;
}

function renderOpenCodeApproachExplorer(delegateContent, modelId = null) {
  const modelLine = modelId ? `model: ${modelId}\n` : '';
  return `---
description: Explores implementation approaches for a phase and aligns with the user through structured questioning before planning begins.
mode: subagent
${modelLine}tools:
  bash: false
---

${delegateContent.trim()}
`;
}

function renderOpenCodePlanChecker(delegateContent, modelId = null) {
  const modelLine = modelId ? `model: ${modelId}\n` : '';
  return `---
description: Fresh-context plan checker for GSDD plan drafts. Review-only; never edits plans directly.
mode: subagent
hidden: true
${modelLine}tools:
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
3. **Approach exploration** (before planning):
   a. Check \`.planning/config.json\` for \`workflow.discuss\`. If \`false\` or missing, skip to step 4 and report \`reduced_alignment\` in the summary.
   b. Check if \`{phase_dir}/{padded_phase}-APPROACH.md\` exists. If it does, offer the user: "Use existing" / "Update it" / "View it". If "Use existing", load decisions, then validate the alignment proof before step 4; proofless or invalid existing APPROACH.md must be updated, not silently trusted.
   c. If no APPROACH.md exists (or user chose "Update"): invoke the \`gsdd-approach-explorer\` subagent with the phase goal, requirement IDs, project config from \`.planning/config.json\` (especially \`workflow.discuss\`), SPEC locked decisions, phase research, and relevant codebase files.
   d. The explorer runs a GSD-style interactive conversation with the user (gray areas, research, deep-dive questions, assumptions) and writes APPROACH.md.
   e. Before planning, confirm APPROACH.md records all canonical proof fields: \`alignment_status\`, \`alignment_method\`, \`user_confirmed_at\`, \`explicit_skip_approved\`, \`skip_scope\`, \`skip_rationale\`, and \`confirmed_decisions\`. For \`alignment_status: user_confirmed\`, \`confirmed_decisions\` must name the locked decisions and skip fields may be \`false\`/\`N/A\`; for \`alignment_status: approved_skip\`, \`explicit_skip_approved: true\`, \`skip_scope\`, and \`skip_rationale\` must be substantive. Agent-only "No questions needed" is not valid proof under \`workflow.discuss: true\`.
   f. Load APPROACH.md decisions as locked constraints alongside SPEC.md decisions.
4. Produce the initial phase plan according to \`.agents/skills/gsdd-plan/SKILL.md\`. Pass APPROACH.md decisions (if any) as locked constraints to the planner.
5. If \`.planning/config.json\` has \`workflow.planCheck: false\`, stop after planner self-check and explicitly report reduced assurance. This only skips the independent checker; it does not skip the step 3 alignment-proof gate when \`workflow.discuss: true\`.
6. If \`workflow.planCheck: true\`, invoke the hidden \`gsdd-plan-checker\` subagent with fresh context.
7. Pass only explicit inputs to the checker:
   - target phase goal and requirement IDs
   - relevant locked decisions / deferred items from \`.planning/SPEC.md\`
   - project config from \`.planning/config.json\`, especially \`workflow.discuss\` and \`workflow.planCheck\`
   - approach decisions from \`.planning/phases/*-APPROACH.md\` (if exists)
   - relevant phase research file(s)
   - produced \`.planning/phases/*-PLAN.md\` file(s)
8. Require the checker to return a single JSON object with this shape:
   {
     "status": "issues_found",
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
   Status must be either "${CHECKER_STATUSES[0]}" or "${CHECKER_STATUSES[1]}". Use "passed" only when "issues": []; any blocker or warning must use "issues_found".
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

function createOpenCodeAdapter({
  cwd,
  workflows,
  renderOpenCodeCommandContent,
  getDelegateContent,
  getRuntimeModelOverride,
  loadProjectModelConfig,
}) {
  const commandsDir = join(cwd, '.opencode', 'commands');
  const agentsDir = join(cwd, '.opencode', 'agents');

  return {
    id: 'opencode',
    name: 'opencode',
    kind: 'native_capable',
    subagentFiles: [
      '.opencode/agents/gsdd-plan-checker.md',
      '.opencode/agents/gsdd-approach-explorer.md',
    ],
    detect() {
      return existsSync(join(cwd, '.opencode'));
    },
    isInstalled() {
      return existsSync(commandsDir) || existsSync(agentsDir);
    },
    generate() {
      const config = loadProjectModelConfig(cwd);
      const checkerModelId = getRuntimeModelOverride(config, 'opencode', 'plan-checker');
      const explorerModelId = getRuntimeModelOverride(config, 'opencode', 'approach-explorer');
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
        renderOpenCodePlanChecker(getDelegateContent('plan-checker.md'), checkerModelId)
      );
      writeFileSync(
        join(agentsDir, 'gsdd-approach-explorer.md'),
        renderOpenCodeApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelId)
      );
    },
    summary(action) {
      return `${action} OpenCode slash commands (.opencode/commands/gsdd-*.md) and native agents (.opencode/agents/gsdd-*.md)`;
    },
  };
}

export {
  createOpenCodeAdapter,
  detectOpenCodeConfiguredModel,
  renderOpenCodeApproachExplorer,
  renderOpenCodePlanChecker,
  renderOpenCodePlanCommand,
};
