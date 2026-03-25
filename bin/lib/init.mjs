// init.mjs - thin public facade for init/update commands and prompt helpers

import { createCmdInit, createCmdUpdate } from './init-flow.mjs';
import { createInitPromptApi, promptChoiceList } from './init-prompts.mjs';
import { buildRuntimeChoices, detectPlatforms, getHelpText, normalizeRequestedTools } from './init-runtime.mjs';

function cmdHelp() {
  console.log(getHelpText());
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
