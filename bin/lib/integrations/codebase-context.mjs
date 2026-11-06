import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { createHash } from 'crypto';
import {
  DEFAULT_INTEGRATIONS,
  loadProjectModelConfig,
  mergeCodebaseContextIntegration,
  patchIntegrations,
} from '../integrations-config.mjs';
import { output, parseFlagValue } from '../cli-utils.mjs';
import { resolveStateDir } from '../state-dir.mjs';
import { writeFileAtomic } from '../atomic-write.mjs';

export const INTEGRATION_DIR = 'integrations/codebase-context';

/**
 * Workspine helper subcommands (plan-context, edit-preflight) are not codebase-context CLI
 * commands. They invoke the published CLI, which wraps MCP tools:
 * - plan-context → `patterns` (get_team_patterns) + per-file `search --intent explore` (search_codebase)
 * - edit-preflight → `search --intent edit` (search_codebase preflight card)
 */
export const CODEBASE_CONTEXT_BRIDGE = Object.freeze({
  planContext: Object.freeze([
    { argv: ['patterns', '--json'], mcpTool: 'get_team_patterns' },
    { argv: ['search', '--query', '<file>', '--intent', 'explore', '--json', '--limit', '3'], mcpTool: 'search_codebase' },
  ]),
  editPreflight: Object.freeze([
    { argv: ['search', '--query', '<query>', '--intent', 'edit', '--json', '--limit', '10'], mcpTool: 'search_codebase' },
  ]),
});

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

export { mergeCodebaseContextIntegration };

export function integrationArtifactDir(workDir) {
  return join(workDir, INTEGRATION_DIR);
}

function slugify(value) {
  return String(value || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';
}

function parseFilesFlag(flagArgs) {
  const raw = parseFlagValue(flagArgs, '--files').value;
  if (!raw) return [];
  return raw.split(',').map((part) => normalizeSlashes(part).trim()).filter(Boolean);
}

function parseCliJson(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

function resolveCliInvocation(command, args) {
  if (command.endsWith('.js')) {
    return { executable: process.execPath, argv: [command, ...args], displayCommand: command };
  }
  return { executable: command, argv: args, displayCommand: command };
}

function recordInvocation(invocations, command, argv, mcpTool) {
  const { executable, argv: execArgv, displayCommand } = resolveCliInvocation(command, argv);
  invocations.push({
    command: displayCommand,
    argv: executable === process.execPath ? [process.execPath, ...execArgv] : [displayCommand, ...argv],
    mcpTool,
  });
}

export function createCodebaseContextRunner({ execFile, exists = existsSync } = {}) {
  if (typeof execFile !== 'function') {
    throw new Error('createCodebaseContextRunner requires execFile');
  }

  function probeCli(command, cwd) {
    try {
      const { executable, argv } = resolveCliInvocation(command, ['--version']);
      execFile(executable, argv, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  function runCli(command, args, cwd) {
    const { executable, argv } = resolveCliInvocation(command, args);
    return execFile(executable, argv, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, CODEBASE_ROOT: cwd },
    });
  }

  return { probeCli, runCli, exists, resolveCliInvocation };
}

export function buildSkippedReceipt(reason, extra = {}) {
  return {
    schema_version: 1,
    integration: 'codebase-context',
    status: reason === 'disabled' ? 'disabled' : 'unavailable',
    reason,
    bridge: CODEBASE_CONTEXT_BRIDGE,
    ...extra,
  };
}

export function runPlanContext({
  workspaceRoot,
  workDir,
  config,
  files = [],
  planPath = null,
  json = false,
  now = new Date(),
  runner,
} = {}) {
  const integration = mergeCodebaseContextIntegration(config);
  const artifactPath = join(integrationArtifactDir(workDir), 'plan-context.json');
  const relativeArtifact = normalizeSlashes(relative(workspaceRoot, artifactPath));
  const ccInvocations = [];

  if (!integration.enabled) {
    const body = buildSkippedReceipt('disabled', { artifact: relativeArtifact, files, plan_path: planPath });
    if (json) output(body);
    else console.log('codebase-context integration is disabled in .work/config.json');
    return body;
  }

  const command = integration.command || DEFAULT_INTEGRATIONS.codebaseContext.command;
  if (!runner.probeCli(command, workspaceRoot)) {
    const body = buildSkippedReceipt('cli_not_found', {
      command,
      artifact: relativeArtifact,
      files,
      plan_path: planPath,
    });
    if (json) output(body);
    else console.log(`codebase-context CLI not found (${command}); skipping plan context`);
    return body;
  }

  if (files.length === 0) {
    const body = {
      schema_version: 1,
      integration: 'codebase-context',
      status: 'error',
      error: 'missing_files',
      message: 'plan-context requires --files with at least one repo-relative path',
      artifact: relativeArtifact,
      bridge: CODEBASE_CONTEXT_BRIDGE,
    };
    if (json) output(body);
    else console.error(body.message);
    process.exitCode = 1;
    return body;
  }

  const patternsArgv = ['patterns', '--json'];
  recordInvocation(ccInvocations, command, patternsArgv, 'get_team_patterns');
  const patterns = parseCliJson(runner.runCli(command, patternsArgv, workspaceRoot));

  const fileSearches = [];
  for (const file of files.slice(0, 8)) {
    const query = `implementation and conventions for ${file}`;
    const searchArgv = ['search', '--query', query, '--intent', 'explore', '--json', '--limit', '3'];
    recordInvocation(ccInvocations, command, searchArgv, 'search_codebase');
    fileSearches.push({
      file,
      query,
      response: parseCliJson(runner.runCli(command, searchArgv, workspaceRoot)),
    });
  }

  const body = {
    schema_version: 1,
    integration: 'codebase-context',
    status: 'ok',
    recorded_at: now.toISOString(),
    command,
    bridge: CODEBASE_CONTEXT_BRIDGE,
    codebase_context_invocations: ccInvocations,
    plan_path: planPath,
    files,
    patterns,
    file_searches: fileSearches,
    artifact: relativeArtifact,
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileAtomic(artifactPath, `${JSON.stringify(body, null, 2)}\n`);
  if (json) output(body);
  else console.log(`Recorded plan context at ${relativeArtifact}`);
  return body;
}

export function runEditPreflight({
  workspaceRoot,
  workDir,
  config,
  files = [],
  query,
  taskId = null,
  json = false,
  now = new Date(),
  runner,
} = {}) {
  const integration = mergeCodebaseContextIntegration(config);
  const safeTask = slugify(taskId || now.toISOString());
  const artifactPath = join(integrationArtifactDir(workDir), 'preflight', `${safeTask}.json`);
  const relativeArtifact = normalizeSlashes(relative(workspaceRoot, artifactPath));
  const logPath = join(integrationArtifactDir(workDir), 'preflight-log.jsonl');
  const ccInvocations = [];

  if (!integration.enabled) {
    const body = buildSkippedReceipt('disabled', {
      artifact: relativeArtifact,
      files,
      query: query || null,
      task_id: taskId,
    });
    if (json) output(body);
    else console.log('codebase-context integration is disabled in .work/config.json');
    return body;
  }

  const command = integration.command || DEFAULT_INTEGRATIONS.codebaseContext.command;
  if (!runner.probeCli(command, workspaceRoot)) {
    const body = buildSkippedReceipt('cli_not_found', {
      command,
      artifact: relativeArtifact,
      files,
      query: query || null,
      task_id: taskId,
    });
    if (json) output(body);
    else console.log(`codebase-context CLI not found (${command}); skipping edit preflight`);
    return body;
  }

  if (!String(query || '').trim()) {
    const body = {
      schema_version: 1,
      integration: 'codebase-context',
      status: 'error',
      error: 'missing_query',
      message: 'edit-preflight requires --query describing the intended edit',
      artifact: relativeArtifact,
      bridge: CODEBASE_CONTEXT_BRIDGE,
    };
    if (json) output(body);
    else console.error(body.message);
    process.exitCode = 1;
    return body;
  }

  const fileHint = files.length > 0 ? ` Files: ${files.join(', ')}.` : '';
  const searchQuery = `${String(query).trim()}.${fileHint}`;
  const searchArgv = ['search', '--query', searchQuery, '--intent', 'edit', '--json', '--limit', '10'];
  recordInvocation(ccInvocations, command, searchArgv, 'search_codebase');
  const response = parseCliJson(runner.runCli(command, searchArgv, workspaceRoot));

  const body = {
    schema_version: 1,
    integration: 'codebase-context',
    status: 'ok',
    recorded_at: now.toISOString(),
    command,
    bridge: CODEBASE_CONTEXT_BRIDGE,
    codebase_context_invocations: ccInvocations,
    task_id: taskId,
    files,
    query: String(query).trim(),
    search_query: searchQuery,
    response,
    preflight: response?.preflight ?? null,
    artifact: relativeArtifact,
    digest: createHash('sha256').update(JSON.stringify(response ?? {})).digest('hex'),
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileAtomic(artifactPath, `${JSON.stringify(body, null, 2)}\n`);
  writeFileSync(logPath, `${JSON.stringify({
    recorded_at: body.recorded_at,
    task_id: taskId,
    files,
    query: body.query,
    ready: body.preflight?.ready ?? null,
    artifact: relativeArtifact,
  })}\n`, { flag: 'a' });
  writeFileAtomic(join(integrationArtifactDir(workDir), 'last-preflight.json'), `${JSON.stringify(body, null, 2)}\n`);

  if (json) output(body);
  else console.log(`Recorded edit preflight at ${relativeArtifact}`);
  return body;
}

export function showIntegrationStatus({ config, workspaceRoot, runner } = {}) {
  const integration = mergeCodebaseContextIntegration(config);
  const command = integration.command || DEFAULT_INTEGRATIONS.codebaseContext.command;
  const cliAvailable = runner.probeCli(command, workspaceRoot);
  return {
    schema_version: 1,
    integrations: {
      codebaseContext: {
        enabled: integration.enabled,
        command,
        cli_available: cliAvailable,
        artifact_dir: `.work/${INTEGRATION_DIR}`,
        bridge: CODEBASE_CONTEXT_BRIDGE,
      },
    },
  };
}

export function setIntegrationEnabled(cwd, enabled) {
  return patchIntegrations(cwd, { codebaseContext: { enabled: Boolean(enabled) } });
}

export function cmdCodebaseContextSubcommand(subcommand, flagArgs, {
  cwd = process.cwd(),
  json = flagArgs.includes('--json'),
  runner = null,
  loadConfig = loadProjectModelConfig,
} = {}) {
  const workspace = resolveStateDir(cwd);
  const workspaceRoot = resolve(workspace.dir, '..');
  const workDir = workspace.dir;
  const config = loadConfig(workspaceRoot);
  const execRunner = runner ?? createCodebaseContextRunner({ execFile: execFileSync });

  switch (subcommand) {
    case 'plan-context':
      return runPlanContext({
        workspaceRoot,
        workDir,
        config,
        files: parseFilesFlag(flagArgs),
        planPath: parseFlagValue(flagArgs, '--plan').value,
        json,
        runner: execRunner,
      });
    case 'edit-preflight':
      return runEditPreflight({
        workspaceRoot,
        workDir,
        config,
        files: parseFilesFlag(flagArgs),
        query: parseFlagValue(flagArgs, '--query').value,
        taskId: parseFlagValue(flagArgs, '--task').value,
        json,
        runner: execRunner,
      });
    case 'enable':
      setIntegrationEnabled(workspaceRoot, true);
      console.log('  - enabled integrations.codebaseContext');
      return null;
    case 'disable':
      setIntegrationEnabled(workspaceRoot, false);
      console.log('  - disabled integrations.codebaseContext');
      return null;
    case 'show':
      output(showIntegrationStatus({ config, workspaceRoot, runner: execRunner }));
      return null;
    default:
      console.error('Usage: integrations codebase-context <plan-context|edit-preflight|enable|disable|show> [flags]');
      console.error('  (Workspine helpers; codebase-context CLI: patterns, search --intent explore|edit, map, …)');
      process.exitCode = 1;
      return null;
  }
}
