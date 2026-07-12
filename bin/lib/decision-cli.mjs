import { output, parseFlagValue } from './cli-utils.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import {
  DECISION_RECORD_SCOPES,
  DECISION_RECORD_TYPES,
  recallDecisions,
  renderDecisionsDigest,
  writeDecisionRecord,
} from './work-context.mjs';

const REMEMBER_USAGE = 'Usage: gsdd remember "<text>" --type <decision|lesson|rule> --scope <repo|global> [--code path:line] [--why "<why>"] [--by-user]';
const DECISIONS_USAGE = 'Usage: gsdd decisions query "<terms>" [--path <path>]';

export function cmdRemember(...rawArgs) {
  const workspace = resolveWorkspaceContext(rawArgs);
  if (workspace.invalid) return fail(workspace.error);
  try {
    const [text, ...args] = workspace.args;
    const type = requireFlag(args, '--type', REMEMBER_USAGE);
    const scope = requireFlag(args, '--scope', REMEMBER_USAGE);
    const why = parseFlagValue(args, '--why').value || 'Captured through gsdd remember; verify before activation.';
    const code = parseFlagValue(args, '--code').value;
    const byUser = args.includes('--by-user');
    const status = byUser ? 'active' : 'candidate';
    if (!text || text.startsWith('--') || !DECISION_RECORD_TYPES.includes(type) || !DECISION_RECORD_SCOPES.includes(scope)) {
      return fail(REMEMBER_USAGE);
    }
    const result = writeDecisionRecord(workspace.planningDir, {
      type,
      status,
      scope,
      decision: text,
      why,
      source: byUser ? 'user' : 'agent-proposed',
      links: code ? { code } : null,
      body: `${text}\n\nWhy: ${why}`,
    }, { repoRoot: workspace.workspaceRoot });
    output({
      schema_version: 1,
      operation: 'remember',
      status,
      record: { id: result.id, path: result.path },
      duplicate_warnings: result.duplicateWarnings,
    });
  } catch (error) {
    fail(error.message);
  }
}

export function cmdDecisions(...rawArgs) {
  const workspace = resolveWorkspaceContext(rawArgs);
  if (workspace.invalid) return fail(workspace.error);
  try {
    const [subcommand, terms, ...args] = workspace.args;
    if (subcommand !== 'query' || !terms || terms.startsWith('--')) return fail(DECISIONS_USAGE);
    const path = parseFlagValue(args, '--path');
    if (path.invalid || hasUnexpectedQueryArgs(args)) return fail(DECISIONS_USAGE);
    const recalled = recallDecisions({
      workDir: workspace.planningDir,
      terms,
      paths: path.value ? [path.value] : [],
      limit: 10,
    });
    console.log(renderDecisionsDigest(recalled.records));
  } catch (error) {
    fail(error.message);
  }
}

function requireFlag(args, name, usage) {
  const parsed = parseFlagValue(args, name);
  if (parsed.invalid || !parsed.value) throw new Error(usage);
  return parsed.value;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function hasUnexpectedQueryArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--path' || !args[index + 1]) return true;
    index += 1;
  }
  return false;
}
