import { createRootAgentsAdapter } from './agents.mjs';
import { createClaudeAdapter } from './claude.mjs';
import { createCodexAdapter } from './codex.mjs';
import { createOpenCodeAdapter } from './opencode.mjs';

export const ADAPTER_SOURCE_FILES = Object.freeze([
  'bin/adapters/agents.mjs',
  'bin/adapters/claude.mjs',
  'bin/adapters/codex.mjs',
  'bin/adapters/index.mjs',
  'bin/adapters/opencode.mjs',
]);

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
