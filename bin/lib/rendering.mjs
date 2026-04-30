import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', '..', 'distilled');
const HELPER_LIB_FILES = Object.freeze([
  'cli-utils.mjs',
  'evidence-contract.mjs',
  'file-ops.mjs',
  'lifecycle-preflight.mjs',
  'lifecycle-state.mjs',
  'phase.mjs',
  'session-fingerprint.mjs',
  'ui-proof.mjs',
  'workspace-root.mjs',
]);

function getWorkflowContent(workflowFile) {
  const filePath = join(DISTILLED_DIR, 'workflows', workflowFile);
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8');
  return `<!-- Workflow file not found: ${workflowFile} -->\n`;
}

function getDelegateContent(delegateFile) {
  const filePath = join(DISTILLED_DIR, 'templates', 'delegates', delegateFile);
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8');
  return `<!-- Delegate file not found: ${delegateFile} -->\n`;
}

function renderSkillContent(workflow) {
  const workflowContent = getWorkflowContent(workflow.workflow);
  return `---
name: ${workflow.name}
description: ${workflow.description}
context: fork
agent: ${workflow.agent}
---

${workflowContent}`;
}

function renderPlanningCliLauncher() {
  return `#!/usr/bin/env node

import { cmdFileOp } from './lib/file-ops.mjs';
import { cmdLifecyclePreflight } from './lib/lifecycle-preflight.mjs';
import { cmdPhaseStatus } from './lib/phase.mjs';
import { cmdSessionFingerprint } from './lib/session-fingerprint.mjs';
import { cmdUiProof } from './lib/ui-proof.mjs';
import { bootstrapHelperWorkspace, consumeWorkspaceRootArg, resolveWorkspaceContext } from './lib/workspace-root.mjs';

const COMMANDS = {
  'file-op': cmdFileOp,
  'lifecycle-preflight': cmdLifecyclePreflight,
  'phase-status': cmdPhaseStatus,
  'session-fingerprint': cmdSessionFingerprint,
  'ui-proof': cmdUiProof,
};

function printHelp() {
  console.log([
    'Usage: node .planning/bin/gsdd.mjs [--workspace-root <path>] <command> [args]',
    '',
    'Local workflow helper commands:',
    '  file-op <copy|delete|regex-sub>',
    '                               Run deterministic workspace-confined file operations',
    '                               Example: node .planning/bin/gsdd.mjs file-op delete .planning/.continue-here.bak --missing ok',
    '  phase-status <N> <status>   Update ROADMAP.md phase status ([ ] / [-] / [x])',
    '                               Example: node .planning/bin/gsdd.mjs phase-status 1 done',
    '  lifecycle-preflight <surface> [phase]',
    '                               Inspect lifecycle gate results for a workflow surface',
    '                               Example: node .planning/bin/gsdd.mjs lifecycle-preflight verify 1 --expects-mutation phase-status',
    '  session-fingerprint write [--allow-changed <ROADMAP.md,SPEC.md,config.json>]',
    '                               Rebaseline planning-state drift after reviewing changed planning files',
    '  ui-proof validate <path> [--claim <public|publication|tracked|delivery|release>]',
    '                               Validate UI proof metadata; use --claim for stronger proof uses',
    '  ui-proof compare <planned-slots-json> [observed-bundle-json ...]',
    '                               Compare planned UI proof slots against observed bundles',
    '',
    'Advanced option:',
    '  --workspace-root <path>     Override workspace root discovery before or after the subcommand',
  ].join('\\n'));
}

function applyWorkspaceRootOverride(workspaceRootArg) {
  if (!workspaceRootArg) {
    bootstrapHelperWorkspace(import.meta.url);
    return true;
  }

  const context = resolveWorkspaceContext(['--workspace-root', workspaceRootArg]);
  if (context.invalid) {
    console.error(context.error);
    process.exitCode = 1;
    return false;
  }

  process.env.GSDD_WORKSPACE_ROOT = context.workspaceRoot;
  try {
    process.chdir(context.workspaceRoot);
  } catch {
    // best-effort: command handlers also resolve from GSDD_WORKSPACE_ROOT
  }
  return true;
}

async function main() {
  const parsed = consumeWorkspaceRootArg(process.argv.slice(2));
  if (parsed.invalid) {
    console.error('Usage: --workspace-root <path>');
    process.exitCode = 1;
    return;
  }

  if (!applyWorkspaceRootOverride(parsed.workspaceRootArg)) return;

  const [command, ...args] = parsed.args;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  await handler(...args);
}

await main();
`;
}

function renderPlanningCliShellShim() {
  return `#!/usr/bin/env sh

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/gsdd.mjs" "$@"
`;
}

function renderPlanningCliCmdShim() {
  return `@echo off
setlocal
node "%~dp0gsdd.mjs" %*
`;
}

function renderPlanningCliPowerShellShim() {
  return `#!/usr/bin/env pwsh
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir 'gsdd.mjs') @args
exit $LASTEXITCODE
`;
}

function readHelperLibContent(fileName) {
  return readFileSync(join(__dirname, fileName), 'utf-8');
}

function buildPlanningCliHelperEntries() {
  return [
    {
      relativePath: 'bin/gsdd.mjs',
      content: renderPlanningCliLauncher(),
    },
    {
      relativePath: 'bin/gsdd',
      content: renderPlanningCliShellShim(),
    },
    {
      relativePath: 'bin/gsdd.cmd',
      content: renderPlanningCliCmdShim(),
    },
    {
      relativePath: 'bin/gsdd.ps1',
      content: renderPlanningCliPowerShellShim(),
    },
    ...HELPER_LIB_FILES.map((fileName) => ({
      relativePath: `bin/lib/${fileName}`,
      content: readHelperLibContent(fileName),
    })),
  ];
}

function buildPortableSkillEntries(workflows) {
  return workflows.map((workflow) => ({
    relativePath: `.agents/skills/${workflow.name}/SKILL.md`,
    content: renderSkillContent(workflow),
  }));
}

function renderOpenCodeCommandContent(workflow) {
  const workflowContent = getWorkflowContent(workflow.workflow);
  return `---
description: ${workflow.description}
---

${workflowContent}`;
}

function renderAgentsBoundedBlock() {
  const blockPath = join(DISTILLED_DIR, 'templates', 'agents.block.md');
  if (existsSync(blockPath)) return readFileSync(blockPath, 'utf-8').trim();
  return '## GSDD Governance (Generated)\n\n- Framework: GSDD\n- Planning: .planning/\n- Workflows: .agents/skills/gsdd-*/SKILL.md';
}

function renderAgentsFileContent() {
  const templatePath = join(DISTILLED_DIR, 'templates', 'agents.md');
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, 'utf-8');
    return template.replace('{{GSDD_BLOCK}}', renderAgentsBoundedBlock()).trimEnd() + '\n';
  }
  const block = renderAgentsBoundedBlock();
  return `# AGENTS.md - GSDD Governance\n\n<!-- BEGIN GSDD -->\n${block}\n<!-- END GSDD -->\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertBoundedBlock(existing, blockContent) {
  const begin = '<!-- BEGIN GSDD -->';
  const end = '<!-- END GSDD -->';
  const bounded = `${begin}\n${blockContent.trimEnd()}\n${end}`;

  const re = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  if (re.test(existing)) return existing.replace(re, bounded);

  const lines = existing.split(/\r?\n/);
  const h1Idx = lines.findIndex((line) => /^#\s+/.test(line));
  if (h1Idx !== -1) {
    const insertAt = h1Idx + 1;
    const out = [
      ...lines.slice(0, insertAt),
      '',
      bounded,
      '',
      ...lines.slice(insertAt),
    ];
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  return `${bounded}\n\n${existing}`.replace(/\n{3,}/g, '\n\n');
}

export {
  buildPlanningCliHelperEntries,
  buildPortableSkillEntries,
  getDelegateContent,
  getWorkflowContent,
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderPlanningCliLauncher,
  renderSkillContent,
  upsertBoundedBlock,
};
