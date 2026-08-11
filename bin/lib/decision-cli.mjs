import { existsSync } from 'fs';
import { output, parseFlagValue } from './cli-utils.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import { assertStateAuthority } from './state-dir.mjs';
import {
  DECISION_RECORD_SCOPES,
  DECISION_RECORD_TYPES,
  getWorkPaths,
  recallDecisions,
  renderDecisionQueryResults,
  classifyDecisionAuthority,
  isValidApprovalReference,
  transitionDecisionRecord,
  WORK_DIR_NAME,
  writeDecisionRecord,
} from './work-context.mjs';

const REMEMBER_USAGE = 'Usage: gsdd remember "<text>" --type <decision|lesson|rule> --scope <repo|global> [--code path:line] [--why "<why>"]';
const REMEMBER_REMOVED_FLAG = ['--by', 'user'].join('-');
const REMEMBER_PROMOTION_GRAMMAR = 'gsdd decisions promote <id> --authority owner --approval-ref <non-sensitive-ref>';
const REMEMBER_REMOVED_MESSAGE = `${REMEMBER_REMOVED_FLAG} was removed; use ${REMEMBER_PROMOTION_GRAMMAR} to activate a candidate.`;
const REMEMBER_CANDIDATE_REMOVED_MESSAGE = `${REMEMBER_REMOVED_FLAG} was removed; generated remember records agent-proposed candidates only and cannot approve or activate them; use the main CLI with ${REMEMBER_PROMOTION_GRAMMAR}.`;
const DECISIONS_USAGE = 'Usage: gsdd decisions query "<terms>" [--path <path>] | promote <id> --authority owner --approval-ref <non-sensitive-ref> | reject <id> [--reason <text>] | invalidate <id> --reason <text>';
const DECISIONS_QUERY_USAGE = 'Usage: gsdd decisions query "<terms>" [--path <path>]';

export function cmdRemember(...rawArgs) {
  return runRemember(rawArgs, REMEMBER_REMOVED_MESSAGE);
}

export function cmdRememberCandidate(...rawArgs) {
  return runRemember(rawArgs, REMEMBER_CANDIDATE_REMOVED_MESSAGE);
}

function runRemember(rawArgs, removedMessage) {
  const workspace = resolveWorkspaceContext(rawArgs);
  if (workspace.invalid) return fail(workspace.error);
  try {
    assertStateAuthority(workspace.state);
    const workDir = resolveDecisionWorkDir(workspace);
    const [text, ...args] = workspace.args;
    if (args.includes(REMEMBER_REMOVED_FLAG)) return fail(removedMessage);
    return executeRememberCandidate(workspace, workDir, text, args);
  } catch (error) {
    fail(error.message);
  }
}

function executeRememberCandidate(workspace, workDir, text, args) {
  const type = requireFlag(args, '--type', REMEMBER_USAGE);
  const scope = requireFlag(args, '--scope', REMEMBER_USAGE);
  const why = parseFlagValue(args, '--why').value || 'Captured through gsdd remember; verify before activation.';
  const code = parseFlagValue(args, '--code').value;
  const status = 'candidate';
  if (!text || text.startsWith('--') || !DECISION_RECORD_TYPES.includes(type) || !DECISION_RECORD_SCOPES.includes(scope)) {
    return fail(REMEMBER_USAGE);
  }
  const result = writeDecisionRecord(workDir, {
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
}

export function cmdDecisions(...rawArgs) {
  const workspace = resolveWorkspaceContext(rawArgs);
  if (workspace.invalid) return fail(workspace.error);
  try {
    assertStateAuthority(workspace.state);
    const workDir = resolveDecisionWorkDir(workspace);
    const [subcommand, subject, ...args] = workspace.args;
    if (!subject || subject.startsWith('--')) return fail(DECISIONS_USAGE);
    if (['promote', 'reject', 'invalidate'].includes(subcommand)) {
      if (subcommand === 'promote') {
        const promotion = parsePromotionArgs(args);
        if (!promotion) return fail(DECISIONS_USAGE);
        const record = transitionDecisionRecord(workDir, subject, subcommand, promotion);
        output({ record: {
          id: record.meta.id,
          status: record.meta.status,
          authority: classifyDecisionAuthority(record).classification,
          source: record.meta.source || null,
          approval_authority: record.meta.approval_authority || null,
          approval_ref: record.meta.approval_ref || null,
          approval_body_hash: record.meta.approval_body_hash || null,
          approved_at: record.meta.approved_at || null,
          authority_fingerprint: record.meta.authority_fingerprint || null,
          updated_at: record.meta.updated_at,
        } });
        return;
      }
      const reasonArgsValid = args.length === 0
        || (args.length === 2 && args[0] === '--reason' && Boolean(args[1]));
      if (subcommand === 'invalidate' && !(args.length === 2 && args[0] === '--reason' && args[1])) {
        return fail(DECISIONS_USAGE);
      }
      if (subcommand === 'reject' && !reasonArgsValid) {
        return fail(DECISIONS_USAGE);
      }
      const reason = parseFlagValue(args, '--reason');
      if (reason.invalid || (subcommand === 'invalidate' && !reason.value)) return fail(DECISIONS_USAGE);
      const record = transitionDecisionRecord(workDir, subject, subcommand, { reason: reason.value });
      output({ record: {
        id: record.meta.id,
        status: record.meta.status,
        ...(record.meta.invalidation_reason ? { invalidation_reason: record.meta.invalidation_reason } : {}),
        updated_at: record.meta.updated_at,
      } });
      return;
    }
    if (subcommand !== 'query') return fail(DECISIONS_USAGE);
    return queryDecisions(workDir, subject, args, DECISIONS_USAGE);
  } catch (error) {
    fail(error.message);
  }
}

function parsePromotionArgs(args) {
  if (args.length !== 4
    || args[0] !== '--authority'
    || args[1] !== 'owner'
    || args[2] !== '--approval-ref'
    || !isValidApprovalReference(args[3])) {
    return null;
  }
  return { authority: 'owner', approvalRef: args[3] };
}

export function cmdDecisionsQuery(...rawArgs) {
  const workspace = resolveWorkspaceContext(rawArgs);
  if (workspace.invalid) return fail(workspace.error);
  try {
    assertStateAuthority(workspace.state);
    const workDir = resolveDecisionWorkDir(workspace);
    const [subcommand, terms, ...args] = workspace.args;
    if (subcommand !== 'query') return fail(DECISIONS_QUERY_USAGE);
    return queryDecisions(workDir, terms, args, DECISIONS_QUERY_USAGE);
  } catch (error) {
    fail(error.message);
  }
}

function queryDecisions(workDir, terms, args, usage) {
  if (!terms || terms.startsWith('--')) return fail(usage);
  const path = parseFlagValue(args, '--path');
  if (path.invalid || hasUnexpectedQueryArgs(args)) return fail(usage);
  const recalled = recallDecisions({
    workDir,
    terms,
    paths: path.value ? [path.value] : [],
    limit: 10,
  });
  console.log(renderDecisionQueryResults(recalled.records));
}

function resolveDecisionWorkDir(workspace) {
  const { workDir } = getWorkPaths(workspace.workspaceRoot);
  if (workspace.stateDirName !== WORK_DIR_NAME && !existsSync(workDir)) {
    throw new Error(
      `Decision commands require canonical ${WORK_DIR_NAME}/ authority. `
      + `This repo only has legacy ${workspace.stateDirName}/ lifecycle state. `
      + 'Run `gsdd next --init` first; migrate legacy lifecycle state explicitly when ready. '
      + `Decisions from ${workspace.stateDirName}/ are not imported automatically.`,
    );
  }
  return workDir;
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
