import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { createHash } from 'crypto';
import { DEFAULT_INTEGRATIONS, loadProjectModelConfig, writeProjectConfig } from '../config.mjs';
import { output, parseFlagValue } from '../cli-utils.mjs';
import { resolveStateDir } from '../state-dir.mjs';
import { writeFileAtomic } from '../atomic-write.mjs';

export const INTEGRATION_DIR = 'integrations/codebase-context';

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function mergeCodebaseContextIntegration(config = {}) {
  const existing = config?.integrations?.codebaseContext ?? {};
  return {
    ...DEFAULT_INTEGRATIONS.codebaseContext,
    ...existing,
    enabled: existing.enabled === true,
  };
}

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

function directoryScopes(files, workspaceRoot) {
  const scopes = new Set();
  for (const file of files) {
    const absolute = resolve(workspaceRoot, file);
    const rel = normalizeSlashes(relative(workspaceRoot, absolute));
    if (!rel || rel.startsWith('..')) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
    scopes.add(dir === '' ? '.' : dir);
  }
  return [...scopes].slice(0, 12);
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

export function createCodebaseContextRunner({ execFile, exists = existsSync } = {}) {
  if (typeof execFile !== 'function') {
    throw new Error('createCodebaseContextRunner requires execFile');
  }

  function probeCli(command, cwd) {
    try {
      execFile(command, ['--version'], {
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
    return execFile(command, args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, CODEBASE_ROOT: cwd },
    });
  }

  return { probeCli, runCli, exists };
}

export function buildSkippedReceipt(reason, extra = {}) {
  return {
    schema_version: 1,
    integration: 'codebase-context',
    status: reason === 'disabled' ? 'disabled' : 'unavailable',
    reason,
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
    };
    if (json) output(body);
    else console.error(body.message);
    process.exitCode = 1;
    return body;
  }

  const patternsStdout = runner.runCli(command, ['patterns', '--json'], workspaceRoot);
  const patterns = parseCliJson(patternsStdout);

  const scopes = directoryScopes(files, workspaceRoot);
  const scopedSearches = [];
  for (const scope of scopes) {
    const query = scope === '.'
      ? 'team patterns and conventions for repository root files'
      : `team patterns and conventions for files under ${scope}`;
    const stdout = runner.runCli(command, [
      'search',
      '--query',
      query,
      '--intent',
      'explore',
      '--json',
      '--limit',
      '5',
    ], workspaceRoot);
    scopedSearches.push({
      scope,
      query,
      response: parseCliJson(stdout),
    });
  }

  const body = {
    schema_version: 1,
    integration: 'codebase-context',
    status: 'ok',
    recorded_at: now.toISOString(),
    command,
    plan_path: planPath,
    files,
    directory_scopes: scopes,
    patterns,
    scoped_searches: scopedSearches,
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
    };
    if (json) output(body);
    else console.error(body.message);
    process.exitCode = 1;
    return body;
  }

  const fileHint = files.length > 0 ? ` Files: ${files.join(', ')}.` : '';
  const searchQuery = `${String(query).trim()}.${fileHint}`;
  const stdout = runner.runCli(command, [
    'search',
    '--query',
    searchQuery,
    '--intent',
    'edit',
    '--json',
    '--limit',
    '10',
  ], workspaceRoot);
  const response = parseCliJson(stdout);

  const body = {
    schema_version: 1,
    integration: 'codebase-context',
    status: 'ok',
    recorded_at: now.toISOString(),
    command,
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
  const cliAvailable = integration.enabled ? runner.probeCli(command, workspaceRoot) : false;
  return {
    schema_version: 1,
    integrations: {
      codebaseContext: {
        enabled: integration.enabled,
        command,
        cli_available: cliAvailable,
        artifact_dir: `.work/${INTEGRATION_DIR}`,
      },
    },
  };
}

export function setIntegrationEnabled(cwd, enabled, { writeConfig = writeProjectConfig, loadConfig = loadProjectModelConfig } = {}) {
  const config = loadConfig(cwd);
  config.integrations = config.integrations || {};
  config.integrations.codebaseContext = {
    ...mergeCodebaseContextIntegration(config),
    enabled: Boolean(enabled),
  };
  writeConfig(config, cwd);
  return config.integrations.codebaseContext;
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
      setIntegrationEnabled(workspaceRoot, true, { loadConfig, writeConfig: writeProjectConfig });
      console.log('  - enabled integrations.codebaseContext');
      return null;
    case 'disable':
      setIntegrationEnabled(workspaceRoot, false, { loadConfig, writeConfig: writeProjectConfig });
      console.log('  - disabled integrations.codebaseContext');
      return null;
    case 'show':
      output(showIntegrationStatus({ config, workspaceRoot, runner: execRunner }));
      return null;
    default:
      console.error('Usage: integrations codebase-context <plan-context|edit-preflight|enable|disable|show> [flags]');
      process.exitCode = 1;
      return null;
  }
}
