import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function safeTomlString(value) {
  return value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n');
}

function renderCodexApproachExplorer(delegateContent, modelId = null) {
  const safe = delegateContent.trim().replaceAll('"""', '"" "');
  const modelLine = modelId ? `model = "${safeTomlString(modelId)}"\n` : '';
  return `name = "gsdd-approach-explorer"
description = "Explores implementation approaches for a phase and aligns with the user through structured questioning before planning begins."
model_reasoning_effort = "high"
${modelLine}
developer_instructions = """
${safe}
"""
`;
}

function renderCodexPlanChecker(delegateContent, modelId = null) {
  const safe = delegateContent.trim().replaceAll('"""', '"" "');
  const modelLine = modelId ? `model = "${safeTomlString(modelId)}"\n` : '';
  return `name = "gsdd-plan-checker"
description = "Fresh-context plan checker for GSDD plan drafts. Review-only; never edits plans directly."
sandbox_mode = "read-only"
model_reasoning_effort = "high"
${modelLine}
developer_instructions = """
${safe}
"""
`;
}

function createCodexAdapter({
  cwd,
  getDelegateContent,
  getRuntimeModelOverride,
  loadProjectModelConfig,
}) {
  const agentsDir = join(cwd, '.codex', 'agents');

  return {
    id: 'codex',
    name: 'codex',
    kind: 'native_capable',
    detect() {
      return existsSync(join(cwd, '.codex'));
    },
    isInstalled() {
      return existsSync(agentsDir);
    },
    generate() {
      const config = loadProjectModelConfig(cwd);
      const checkerModelId = getRuntimeModelOverride(config, 'codex', 'plan-checker');
      const explorerModelId = getRuntimeModelOverride(config, 'codex', 'approach-explorer');

      mkdirSync(agentsDir, { recursive: true });

      // Checker agent (read-only reviewer, spawned by the portable skill's orchestration loop)
      writeFileSync(
        join(agentsDir, 'gsdd-plan-checker.toml'),
        renderCodexPlanChecker(getDelegateContent('plan-checker.md'), checkerModelId)
      );
      // Approach explorer agent (interactive, spawned by the portable skill's approach exploration step)
      writeFileSync(
        join(agentsDir, 'gsdd-approach-explorer.toml'),
        renderCodexApproachExplorer(getDelegateContent('approach-explorer.md'), explorerModelId)
      );
    },
    summary(action) {
      return `${action} Codex CLI native agents (.codex/agents/gsdd-plan-checker.toml, .codex/agents/gsdd-approach-explorer.toml)`;
    },
  };
}

export { createCodexAdapter };
