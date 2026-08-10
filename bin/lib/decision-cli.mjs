import { output, parseFlagValue } from './cli-utils.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import {
  DECISION_RECORD_SCOPES,
  DECISION_RECORD_TYPES,
  recallDecisions,
  renderDecisionQueryResults,
  transitionDecisionRecord,
  writeDecisionRecord,
} from './work-context.mjs';

const REMEMBER_USAGE = 'Usage: gsdd remember "<text>" --type <decision|lesson|rule> --scope <repo|global> [--code path:line] [--why "<why>"]';
const REMEMBER_REMOVED_FLAG = ['--by', 'user'].join('-');
const REMEMBER_REMOVED_MESSAGE = `${REMEMBER_REMOVED_FLAG} was removed; use gsdd decisions promote <id> to activate a candidate.`;
const DECISIONS_USAGE = 'Usage: gsdd decisions query "<terms>" [--path <path>] | promote <id> | reject <id> [--reason <text>] | invalidate <id> --reason <text>';

export function cmdRemember(...rawArgs) {
  const workspace = resolveWorkspaceContext(rawArgs);
  if (workspace.invalid) return fail(workspace.error);
  try {
    const [text, ...args] = workspace.args;
    if (args.includes(REMEMBER_REMOVED_FLAG)) return fail(REMEMBER_REMOVED_MESSAGE);
    const type = requireFlag(args, '--type', REMEMBER_USAGE);
    const scope = requireFlag(args, '--scope', REMEMBER_USAGE);
    const why = parseFlagValue(args, '--why').value || 'Captured through gsdd remember; verify before activation.';
    const code = parseFlagValue(args, '--code').value;
    const status = 'candidate';
    if (!text || text.startsWith('--') || !DECISION_RECORD_TYPES.includes(type) || !DECISION_RECORD_SCOPES.includes(scope)) {
      return fail(REMEMBER_USAGE);
    }
    const result = writeDecisionRecord(workspace.planningDir, {
      type,
      status,
      scope,
      decision: text,
      why,
      source: 'agent-proposed',
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
    const [subcommand, subject, ...args] = workspace.args;
    if (!subject || subject.startsWith('--')) return fail(DECISIONS_USAGE);
    if (['promote', 'reject', 'invalidate'].includes(subcommand)) {
      const reasonArgsValid = args.length === 0
        || (args.length === 2 && args[0] === '--reason' && Boolean(args[1]));
      if (subcommand === 'promote' && args.length > 0) {
        return fail(DECISIONS_USAGE);
      }
      if (subcommand === 'invalidate' && !(args.length === 2 && args[0] === '--reason' && args[1])) {
        return fail(DECISIONS_USAGE);
      }
      if (subcommand === 'reject' && !reasonArgsValid) {
        return fail(DECISIONS_USAGE);
      }
      const reason = parseFlagValue(args, '--reason');
      if (reason.invalid || (subcommand === 'invalidate' && !reason.value)) return fail(DECISIONS_USAGE);
      const record = transitionDecisionRecord(workspace.planningDir, subject, subcommand, { reason: reason.value });
      output({ record: {
        id: record.meta.id,
        status: record.meta.status,
        ...(record.meta.invalidation_reason ? { invalidation_reason: record.meta.invalidation_reason } : {}),
        updated_at: record.meta.updated_at,
      } });
      return;
    }
    if (subcommand !== 'query') return fail(DECISIONS_USAGE);
    const terms = subject;
    const path = parseFlagValue(args, '--path');
    if (path.invalid || hasUnexpectedQueryArgs(args)) return fail(DECISIONS_USAGE);
    const recalled = recallDecisions({
      workDir: workspace.planningDir,
      terms,
      paths: path.value ? [path.value] : [],
      limit: 10,
    });
    console.log(renderDecisionQueryResults(recalled.records));
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
