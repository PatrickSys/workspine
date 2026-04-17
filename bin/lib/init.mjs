// init.mjs - thin public facade for init/update commands and prompt helpers

import { createCmdInit, createCmdUpdate } from './init-flow.mjs';
import { createInitPromptApi, promptChoiceList } from './init-prompts.mjs';
import { buildRuntimeChoices, detectPlatforms, getHelpText, normalizeRequestedTools } from './init-runtime.mjs';

function cmdHelp() {
  console.log(`${getHelpText().trimEnd()}
  file-op <copy|delete|regex-sub>
                              Run deterministic workspace-confined file copy/delete/text mutation
  phase-status <N> <status>   Update ROADMAP.md phase status ([ ] / [-] / [x])
  lifecycle-preflight <surface> [phase]
                              Inspect deterministic lifecycle gate results for a workflow surface
`);
}

export {
  buildRuntimeChoices,
  cmdHelp,
  createCmdInit,
  createCmdUpdate,
  createInitPromptApi,
  detectPlatforms,
  normalizeRequestedTools,
  promptChoiceList,
};
