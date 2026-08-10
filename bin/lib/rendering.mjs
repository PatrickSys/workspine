import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = join(__dirname, '..', '..', 'distilled');
const HELPER_LIB_FILES = Object.freeze([
  'atomic-write.mjs',
  'cli-utils.mjs',
  'control-map.mjs',
  'decision-cli.mjs',
  'file-ops.mjs',
  'lifecycle-preflight.mjs',
  'lifecycle-state.mjs',
  'next.mjs',
  'phase.mjs',
  'state-dir.mjs',
  'work-context.mjs',
  'workspace-root.mjs',
]);
const DEFAULT_STATE_DIR_NAME = '.work';

function normalizeStateDirName(stateDirName = DEFAULT_STATE_DIR_NAME) {
  return stateDirName || DEFAULT_STATE_DIR_NAME;
}

function localizeStateDirReferences(content, { stateDirName = DEFAULT_STATE_DIR_NAME } = {}) {
  const normalized = normalizeStateDirName(stateDirName);
  if (normalized === DEFAULT_STATE_DIR_NAME) return content;
  return String(content).replace(/\.work(?=\/|\\|`|'|"|\)|\]|\}|,|\.|:|;|\s|$)/g, normalized);
}

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

function renderSkillContent(workflow, options = {}) {
  const workflowContent = localizeStateDirReferences(getWorkflowContent(workflow.workflow), options);
  return `---
name: ${workflow.name}
description: ${workflow.description}
context: fork
agent: ${workflow.agent}
---

${workflowContent}`;
}

function renderPlanningCliLauncher({ stateDirName = DEFAULT_STATE_DIR_NAME } = {}) {
  const helperPath = `${normalizeStateDirName(stateDirName)}/bin/gsdd.mjs`;
  const checkpointBackupPath = `${normalizeStateDirName(stateDirName)}/.continue-here.bak`;
  return `#!/usr/bin/env node

import { cmdFileOp } from './lib/file-ops.mjs';
import { cmdLifecyclePreflight } from './lib/lifecycle-preflight.mjs';
import { cmdPhaseStatus, cmdVerify } from './lib/phase.mjs';
import { buildControlMap } from './lib/control-map.mjs';
import { cmdDecisionsQuery, cmdRememberCandidate } from './lib/decision-cli.mjs';
import { createCmdNext } from './lib/next.mjs';
import { bootstrapHelperWorkspace, consumeWorkspaceRootArg, resolveWorkspaceContext } from './lib/workspace-root.mjs';

const HELPER_CONTEXT = {
  cwd: process.cwd(),
  workflows: [],
  frameworkVersion: 'generated-helper',
};
const cmdNext = createCmdNext(HELPER_CONTEXT);

function cmdControlMap(...controlArgs) {
  const context = resolveWorkspaceContext([], { cwd: HELPER_CONTEXT.cwd });
  const report = buildControlMap({
    workspaceRoot: context.workspaceRoot,
    planningDir: context.planningDir,
    includeIgnoredPaths: controlArgs.includes('--with-ignored'),
  });
  console.log(JSON.stringify(report, null, 2));
}

const COMMANDS = {
  'control-map': cmdControlMap,
  decisions: cmdDecisionsQuery,
  'file-op': cmdFileOp,
  'lifecycle-preflight': cmdLifecyclePreflight,
  'phase-status': cmdPhaseStatus,
  remember: cmdRememberCandidate,
  verify: cmdVerify,
  next: cmdNext,
};

function printHelp() {
  console.log([
    'Usage: node ${helperPath} [--workspace-root <path>] <command> [args]',
    '',
    'Local workflow helper commands:',
    '  control-map [--json] [--with-ignored]',
    '                               Print computed repo/worktree/workflow state for workflow-internal checks',
    '  remember "<text>" --type <decision|lesson|rule> --scope <repo|global>',
    '                               Capture an agent-proposed candidate; this is not approval',
    '  decisions query "<terms>" [--path <path>]',
    '                               Query stored decisions read-only; no transition commands',
    '  file-op <copy|delete|regex-sub>',
    '                               Raw workspace-confined file mutation; outside decision authority protocol',
    '                               Example: node ${helperPath} file-op delete ${checkpointBackupPath} --missing ok',
    '  phase-status <N> <status>   Update ROADMAP.md phase status ([ ] / [-] / [x])',
    '                               Example: node ${helperPath} phase-status 1 done',
    '  verify <N>                  Run direct phase artifact checks',
    '                               Example: node ${helperPath} verify 1',
    '  lifecycle-preflight <surface> [phase]',
    '                               Inspect lifecycle gate results for a workflow surface',
    '                               Example: node ${helperPath} lifecycle-preflight verify 1 --expects-mutation phase-status',
    '  next [--json] [--init]',
    '                               Route to the next safe Workspine action from ${normalizeStateDirName(stateDirName)}, brownfield, planning, and repo truth',
    '',
    'Advanced option:',
    '  --workspace-root <path>     Override workspace root discovery before or after the subcommand',
  ].join('\\n'));
}

function applyWorkspaceRootOverride(workspaceRootArg) {
  if (!workspaceRootArg) {
    bootstrapHelperWorkspace(import.meta.url);
    HELPER_CONTEXT.cwd = process.cwd();
    return true;
  }

  const context = resolveWorkspaceContext(['--workspace-root', workspaceRootArg]);
  if (context.invalid) {
    console.error(context.error);
    process.exitCode = 1;
    return false;
  }

  process.env.GSDD_WORKSPACE_ROOT = context.workspaceRoot;
  HELPER_CONTEXT.cwd = context.workspaceRoot;
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

function buildPlanningCliHelperEntries(options = {}) {
  return [
    {
      relativePath: 'bin/gsdd.mjs',
      content: renderPlanningCliLauncher(options),
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

function buildPortableSkillEntries(workflows, options = {}) {
  return workflows.map((workflow) => ({
    relativePath: `.agents/skills/${workflow.name}/SKILL.md`,
    content: renderSkillContent(workflow, options),
  }));
}

function renderOpenCodeCommandContent(workflow, options = {}) {
  const workflowContent = localizeStateDirReferences(getWorkflowContent(workflow.workflow), options);
  return `---
description: ${workflow.description}
---

${workflowContent}`;
}

function renderAgentsBoundedBlock(options = {}) {
  const blockPath = join(DISTILLED_DIR, 'templates', 'agents.block.md');
  if (existsSync(blockPath)) return localizeStateDirReferences(readFileSync(blockPath, 'utf-8'), options).trim();
  const stateDirName = normalizeStateDirName(options.stateDirName);
  const planningLine = stateDirName === DEFAULT_STATE_DIR_NAME
    ? 'Planning state: `.work/` (legacy `.planning/` workspaces are still read).'
    : 'Planning state: `.planning/` (legacy workspace; new Workspine projects use `.work/`).';
  return `## GSDD Governance (Generated)\n\n- Framework: GSDD\n- ${planningLine}\n- Workflows: .agents/skills/gsdd-*/SKILL.md`;
}

function renderAgentsFileContent(options = {}) {
  const templatePath = join(DISTILLED_DIR, 'templates', 'agents.md');
  if (existsSync(templatePath)) {
    const template = readFileSync(templatePath, 'utf-8');
    return template.replace('{{GSDD_BLOCK}}', renderAgentsBoundedBlock(options)).trimEnd() + '\n';
  }
  const block = renderAgentsBoundedBlock(options);
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
  localizeStateDirReferences,
  renderAgentsBoundedBlock,
  renderAgentsFileContent,
  renderOpenCodeCommandContent,
  renderPlanningCliLauncher,
  renderSkillContent,
  upsertBoundedBlock,
};
