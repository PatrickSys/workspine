import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function createCodexAdapter({ cwd, renderAgentsFileContent }) {
  return {
    id: 'codex',
    name: 'codex',
    kind: 'governance_only',
    detect() {
      return existsSync(join(cwd, '.codex'));
    },
    isInstalled() {
      return existsSync(join(cwd, '.codex', 'AGENTS.md'));
    },
    generate() {
      const codexDir = join(cwd, '.codex');
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, 'AGENTS.md'), renderAgentsFileContent());
    },
    summary(action) {
      return `${action} Codex CLI adapter (.codex/AGENTS.md)`;
    },
  };
}

export { createCodexAdapter };
