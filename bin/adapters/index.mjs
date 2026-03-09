import { createRootAgentsAdapter } from './agents.mjs';
import { createClaudeAdapter } from './claude.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createOpenCodeAdapter } from './opencode.mjs';

function createAdapterRegistry(context) {
  const agentsAdapter = createRootAgentsAdapter(context, 'agents');

  return {
    claude: createClaudeAdapter(context),
    opencode: createOpenCodeAdapter(context),
    codex: createCodexAdapter(context),
    agents: agentsAdapter,
    cursor: createRootAgentsAdapter(context, 'cursor'),
    copilot: createRootAgentsAdapter(context, 'copilot'),
    gemini: createRootAgentsAdapter(context, 'gemini'),
  };
}

export { createAdapterRegistry };
