import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function createRootAgentsAdapter({ cwd, stateDirName = '.work', renderAgentsBoundedBlock, renderAgentsFileContent, upsertBoundedBlock }, name = 'agents') {
  return {
    id: 'agents',
    name,
    kind: 'governance_only',
    subagentFiles: [],
    detect() {
      return false;
    },
    isInstalled() {
      return existsSync(join(cwd, 'AGENTS.md'));
    },
    generate() {
      const agentsPath = join(cwd, 'AGENTS.md');
      const block = renderAgentsBoundedBlock({ stateDirName });

      if (!existsSync(agentsPath)) {
        writeFileSync(agentsPath, renderAgentsFileContent({ stateDirName }));
        return;
      }

      const existing = readFileSync(agentsPath, 'utf-8');
      writeFileSync(agentsPath, upsertBoundedBlock(existing, block));
    },
    summary(action) {
      return `${action} root AGENTS.md (bounded GSDD block)`;
    },
  };
}

export { createRootAgentsAdapter };
