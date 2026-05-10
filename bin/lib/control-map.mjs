// control-map.mjs - computed-first workspace/worktree control map

import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { output, parseFlagValue } from './cli-utils.mjs';
import { evaluateLifecycleState } from './lifecycle-state.mjs';
import { checkDrift } from './session-fingerprint.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

const DEFAULT_ANNOTATIONS_RELATIVE_PATH = '.planning/.local/control-map.annotations.json';
const MAX_DIRTY_BUCKET_ENTRIES = 200;
const CLEANUP_STATES = Object.freeze(['active', 'paused', 'merged', 'abandoned', 'superseded', 'cleanup_deferred']);
const ACTIVE_ANNOTATION_STATES = Object.freeze(['active', 'paused', 'cleanup_deferred']);
const CONTROL_MAP_USAGE = 'Usage: gsdd control-map [--json] [--with-ignored] [--annotations <path>]';
const CONTROL_MAP_ANNOTATE_SET_USAGE = 'Usage: gsdd control-map annotate set [--id <id>] [--path <worktree>] --write-set <paths> [--owner <runtime>] [--scope <text>] [--cleanup-state <state>] [--next-step <text>] [--refresh] [--annotations <path>]';
const CONTROL_MAP_ANNOTATE_CLEAR_USAGE = 'Usage: gsdd control-map annotate clear (--id <id> | --path <worktree>) [--annotations <path>]';
const AUTHORITY_ORDER = Object.freeze([
  'repo_truth',
  'planning_artifacts',
  'checkpoint_narrative',
  'local_annotations',
  'vendor_session_forensics',
]);

function runGit(cwd, args) {
  const command = `git ${args.join(' ')}`;
  try {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 4,
      timeout: 10000,
    });
    const errorMessage = result.error ? result.error.message : '';
    return {
      ok: result.status === 0 && !result.error,
      status: result.status ?? (result.error ? -1 : null),
      stdout: String(result.stdout || '').trimEnd(),
      stderr: String(result.stderr || errorMessage || '').trimEnd(),
      command,
    };
  } catch (error) {
    return {
      ok: false,
      status: -1,
      stdout: '',
      stderr: error.message,
      command,
    };
  }
}

function runIgnoredCount(cwd) {
  const result = runGit(cwd, ['ls-files', '-o', '-i', '--exclude-standard']);
  if (!result.ok) {
    return {
      ok: false,
      count: 0,
      error: result.stderr || result.stdout || 'git ls-files ignored count failed',
    };
  }

  const count = result.stdout ? result.stdout.split('\n').filter(Boolean).length : 0;
  return { ok: true, count };
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function trimPathSlashes(value) {
  const normalized = normalizeSlashes(value).trim().replace(/^\.\/+/, '');
  if (!normalized || normalized === '.') return '.';
  return normalized.replace(/\/+$/g, '');
}

function normalizeRepoPath(rawPath, worktreePath = null) {
  const raw = normalizeSlashes(rawPath).trim();
  if (!raw) return null;
  const absolute = isAbsolute(raw) ? resolve(raw) : null;
  if (absolute && worktreePath && isInsideOrSame(worktreePath, absolute)) {
    return trimPathSlashes(relative(resolve(worktreePath), absolute));
  }
  return trimPathSlashes(raw);
}

function pathsIntersect(leftPath, rightPath) {
  const left = trimPathSlashes(leftPath);
  const right = trimPathSlashes(rightPath);
  if (!left || !right) return false;
  if (left === '.' || right === '.') return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function trackedStatusEntryPaths(entry) {
  const payload = String(entry || '').slice(3).trim();
  if (!payload) return [];
  if (payload.includes(' -> ')) return payload.split(' -> ').map((part) => part.trim()).filter(Boolean);
  return [payload];
}

function workspacePathLabel(workspaceRoot, targetPath) {
  const absolute = resolve(targetPath);
  const rel = relative(workspaceRoot, absolute);
  if (rel === '') return '.';
  if (!rel.startsWith('..') && !isAbsolute(rel)) return normalizeSlashes(rel);
  return normalizeSlashes(absolute);
}

function isInsideOrSame(parentPath, targetPath) {
  const rel = relative(resolve(parentPath), resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeReadJson(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf-8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseStatusBuckets(statusOutput) {
  const buckets = {
    branch_line: null,
    tracked: [],
    untracked: [],
    ignored: [],
  };

  for (const rawLine of String(statusOutput || '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith('## ')) {
      buckets.branch_line = line.slice(3);
      continue;
    }
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === '??') buckets.untracked.push(file);
    else if (code === '!!') buckets.ignored.push(file);
    else buckets.tracked.push(line);
  }

  return buckets;
}

function capBucket(entries) {
  return entries.length > MAX_DIRTY_BUCKET_ENTRIES ? entries.slice(0, MAX_DIRTY_BUCKET_ENTRIES) : entries;
}

function parseAheadBehind(branchLine) {
  if (!branchLine) return { ahead: null, behind: null };
  if (!branchLine.includes('...')) return { ahead: null, behind: null };
  const ahead = branchLine.match(/ahead (\d+)/)?.[1];
  const behind = branchLine.match(/behind (\d+)/)?.[1];
  return {
    ahead: ahead === undefined ? 0 : Number(ahead),
    behind: behind === undefined ? 0 : Number(behind),
  };
}

function dirtyRepoPathEntries(worktree) {
  const entries = [];
  for (const entry of worktree.dirty.tracked || []) {
    for (const repoPath of trackedStatusEntryPaths(entry)) {
      const normalized = normalizeRepoPath(repoPath, worktree.path);
      if (!normalized) continue;
      entries.push({
        worktree_id: worktree.id,
        worktree_path: worktree.path,
        kind: 'tracked',
        repo_path: normalized,
      });
    }
  }
  for (const entry of worktree.dirty.untracked || []) {
    const normalized = normalizeRepoPath(entry, worktree.path);
    if (!normalized) continue;
    entries.push({
      worktree_id: worktree.id,
      worktree_path: worktree.path,
      kind: 'untracked',
      repo_path: normalized,
    });
  }
  return entries;
}

function annotationWriteEntries(worktrees, annotations) {
  const byPath = new Map(worktrees.map((entry) => [normalizeSlashes(resolve(entry.path)), entry]));
  const entries = [];
  for (const annotation of annotations.worktrees || []) {
    if (!ACTIVE_ANNOTATION_STATES.includes(annotation.cleanup_state)) continue;
    if (!annotation.normalized_path || !Array.isArray(annotation.write_set) || annotation.write_set.length === 0) continue;
    const worktree = byPath.get(normalizeSlashes(resolve(annotation.normalized_path)));
    if (!worktree) continue;
    for (const rawPath of annotation.write_set) {
      if (typeof rawPath !== 'string') continue;
      const repoPath = normalizeRepoPath(rawPath, worktree.path);
      if (!repoPath) continue;
      entries.push({
        annotation_id: annotation.id,
        worktree_id: worktree.id,
        worktree_path: worktree.path,
        raw_path: normalizeSlashes(rawPath),
        repo_path: repoPath,
        cleanup_state: annotation.cleanup_state,
      });
    }
  }
  return entries;
}

function findWriteSetOverlaps(writeEntries) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < writeEntries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < writeEntries.length; rightIndex += 1) {
      const left = writeEntries[leftIndex];
      const right = writeEntries[rightIndex];
      if (left.annotation_id === right.annotation_id) continue;
      if (!pathsIntersect(left.repo_path, right.repo_path)) continue;
      overlaps.push({
        left_annotation_id: left.annotation_id,
        left_worktree_id: left.worktree_id,
        left_path: left.repo_path,
        right_annotation_id: right.annotation_id,
        right_worktree_id: right.worktree_id,
        right_path: right.repo_path,
      });
    }
  }
  return overlaps;
}

function findDirtyWriteSetOverlaps(writeEntries, dirtyEntries) {
  const overlaps = [];
  for (const writeEntry of writeEntries) {
    for (const dirtyEntry of dirtyEntries) {
      if (!pathsIntersect(writeEntry.repo_path, dirtyEntry.repo_path)) continue;
      overlaps.push({
        annotation_id: writeEntry.annotation_id,
        annotated_worktree_id: writeEntry.worktree_id,
        write_path: writeEntry.repo_path,
        dirty_worktree_id: dirtyEntry.worktree_id,
        dirty_path: dirtyEntry.repo_path,
        dirty_kind: dirtyEntry.kind,
      });
    }
  }
  return overlaps;
}

function readGitWorktree(pathValue, workspaceRoot, { includeIgnoredPaths = false, includeIgnoredCount = false } = {}) {
  const status = runGit(pathValue, [
    'status',
    '--short',
    '--branch',
    ...(includeIgnoredPaths ? ['--ignored'] : []),
    '--untracked-files=all',
  ]);
  const branch = runGit(pathValue, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = runGit(pathValue, ['rev-parse', 'HEAD']);
  const gitTopLevel = runGit(pathValue, ['rev-parse', '--show-toplevel']);
  const buckets = status.ok ? parseStatusBuckets(status.stdout) : parseStatusBuckets('');
  const ignoredCountResult = includeIgnoredCount && !includeIgnoredPaths ? runIgnoredCount(pathValue) : null;
  const ignoredEntries = includeIgnoredPaths ? capBucket(buckets.ignored) : [];
  const ignoredCount = includeIgnoredPaths
    ? buckets.ignored.length
    : ignoredCountResult && ignoredCountResult.ok
      ? ignoredCountResult.count
      : null;

  return {
    id: workspacePathLabel(workspaceRoot, pathValue),
    path: normalizeSlashes(resolve(pathValue)),
    path_relative: workspacePathLabel(workspaceRoot, pathValue),
    path_inside_workspace: isInsideOrSame(workspaceRoot, pathValue),
    git_valid: status.ok && branch.ok && head.ok,
    branch: branch.ok ? branch.stdout : null,
    head: head.ok ? head.stdout : null,
    git_top_level: gitTopLevel.ok ? normalizeSlashes(resolve(gitTopLevel.stdout)) : null,
    dirty: {
      tracked: capBucket(buckets.tracked),
      untracked: capBucket(buckets.untracked),
      ignored: ignoredEntries,
      counts: {
        tracked: buckets.tracked.length,
        untracked: buckets.untracked.length,
        ignored: ignoredCount,
      },
      omitted_counts: {
        tracked: Math.max(0, buckets.tracked.length - MAX_DIRTY_BUCKET_ENTRIES),
        untracked: Math.max(0, buckets.untracked.length - MAX_DIRTY_BUCKET_ENTRIES),
        ignored: includeIgnoredPaths ? Math.max(0, buckets.ignored.length - MAX_DIRTY_BUCKET_ENTRIES) : null,
      },
      ignored_paths_included: includeIgnoredPaths,
      ignored_count_included: includeIgnoredPaths || Boolean(ignoredCountResult),
      ignored_count_error: ignoredCountResult && !ignoredCountResult.ok ? ignoredCountResult.error : null,
    },
    ahead_behind: parseAheadBehind(buckets.branch_line),
    status_error: status.ok ? null : [status.stderr, status.stdout].filter(Boolean).join('\n') || 'git status failed',
  };
}

function parseWorktreeList(outputText) {
  const entries = [];
  let current = null;

  for (const line of String(outputText || '').split('\n')) {
    if (!line.trim()) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') {
      if (current) entries.push(current);
      current = { path: value, detached: false, bare: false };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch_ref = value;
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
  }
  if (current) entries.push(current);
  return entries;
}

function discoverGitWorktrees(workspaceRoot, { includeIgnoredPaths = false, includeIgnoredCount = false } = {}) {
  const listed = runGit(workspaceRoot, ['worktree', 'list', '--porcelain']);
  if (!listed.ok) {
    return {
      git_available: false,
      worktrees: [readGitWorktree(workspaceRoot, workspaceRoot, { includeIgnoredPaths, includeIgnoredCount: includeIgnoredCount || includeIgnoredPaths })],
      errors: [{ code: 'git_worktree_list_failed', message: listed.stderr || listed.stdout || 'git worktree list failed' }],
    };
  }

  const rawEntries = parseWorktreeList(listed.stdout);
  const paths = rawEntries.length > 0 ? rawEntries.map((entry) => entry.path) : [workspaceRoot];
  const byPath = new Map(rawEntries.map((entry) => [resolve(entry.path), entry]));
  return {
    git_available: true,
    worktrees: paths.map((pathValue) => {
      const isCanonical = resolve(pathValue) === resolve(workspaceRoot);
      const computed = readGitWorktree(pathValue, workspaceRoot, {
        includeIgnoredPaths,
        includeIgnoredCount: includeIgnoredPaths || (isCanonical && includeIgnoredCount),
      });
      const raw = byPath.get(resolve(pathValue)) || {};
      return {
        ...computed,
        branch_ref: raw.branch_ref || null,
        detached: raw.detached === true || computed.branch === 'HEAD',
        bare: raw.bare === true,
      };
    }),
    errors: [],
  };
}

function discoverRuntimeDirs(workspaceRoot) {
  const candidates = [
    { runtime: 'claude-code', rel: '.claude/worktrees' },
    { runtime: 'codex-cli', rel: '.codex/worktrees' },
    { runtime: 'opencode', rel: '.opencode/worktrees' },
  ];
  const dirs = [];
  for (const candidate of candidates) {
    const root = join(workspaceRoot, candidate.rel);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(root, entry.name);
      const dotGit = join(fullPath, '.git');
      dirs.push({
        runtime: candidate.runtime,
        path: normalizeSlashes(fullPath),
        path_relative: normalizeSlashes(join(candidate.rel, entry.name)),
        git_marker_exists: existsSync(dotGit),
        appears_git_worktree: existsSync(dotGit),
      });
    }
  }
  return dirs;
}

function normalizeAnnotationPath(workspaceRoot, annotation) {
  const raw = annotation.path || annotation.worktree_path || annotation.path_relative;
  if (!raw) return null;
  return normalizeSlashes(resolve(workspaceRoot, raw));
}

function resolveAnnotationFilePath(workspaceRoot, planningDir, annotationPathArg = null) {
  const annotationPath = annotationPathArg
    ? resolve(workspaceRoot, annotationPathArg)
    : join(planningDir, '.local', 'control-map.annotations.json');
  return {
    path: annotationPath,
    label: workspacePathLabel(workspaceRoot, annotationPath),
    inside_workspace: isInsideOrSame(workspaceRoot, annotationPath),
  };
}

function loadAnnotations(workspaceRoot, planningDir, annotationPathArg = null) {
  const resolved = resolveAnnotationFilePath(workspaceRoot, planningDir, annotationPathArg);
  const annotationPath = resolved.path;
  if (!resolved.inside_workspace) {
    return {
      path: resolved.label,
      exists: false,
      valid: false,
      errors: [{
        code: 'annotations_path_outside_workspace',
        path: resolved.label,
        message: 'Control-map annotations path must stay inside the workspace.',
      }],
      worktrees: [],
    };
  }
  if (!existsSync(annotationPath)) {
    return {
      path: resolved.label,
      exists: false,
      valid: true,
      errors: [],
      worktrees: [],
    };
  }

  const parsed = safeReadJson(annotationPath);
  if (!parsed.ok) {
    return {
      path: resolved.label,
      exists: true,
      valid: false,
      errors: [{ code: 'invalid_annotations_json', path: resolved.label, message: parsed.error }],
      worktrees: [],
    };
  }

  const rawWorktrees = Array.isArray(parsed.value?.worktrees)
    ? parsed.value.worktrees
    : Array.isArray(parsed.value?.annotations)
      ? parsed.value.annotations
      : [];
  const errors = [];
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    errors.push({ code: 'invalid_annotations_shape', path: resolved.label, message: 'Control-map annotations must be a JSON object.' });
  }
  if (rawWorktrees.length === 0 && parsed.value?.worktrees !== undefined && !Array.isArray(parsed.value.worktrees)) {
    errors.push({ code: 'invalid_worktrees_annotations', path: `${resolved.label}.worktrees`, message: 'worktrees must be an array.' });
  }

  const worktrees = rawWorktrees.filter((entry, index) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) return true;
    errors.push({ code: 'invalid_annotation', path: `worktrees[${index}]`, message: 'Annotation entries must be objects.' });
    return false;
  }).map((entry, index) => ({
    id: entry.id || `annotation-${index + 1}`,
    runtime_owner: entry.runtime_owner || entry.runtime || null,
    path: entry.path || entry.worktree_path || null,
    path_relative: entry.path_relative || null,
    normalized_path: normalizeAnnotationPath(workspaceRoot, entry),
    branch: entry.branch || null,
    last_known_head: entry.last_known_head || entry.head || null,
    intended_scope: entry.intended_scope || entry.scope || null,
    write_set: Array.isArray(entry.write_set) ? entry.write_set : [],
    cleanup_state: entry.cleanup_state || 'active',
    proof_state: entry.proof_state || null,
    next_step: entry.next_step || null,
    updated_at: entry.updated_at || null,
  }));

  for (const [index, entry] of worktrees.entries()) {
    if (!entry.normalized_path) errors.push({ code: 'missing_annotation_path', path: `worktrees[${index}].path`, message: 'Annotation must include path or path_relative.' });
    if (!CLEANUP_STATES.includes(entry.cleanup_state)) {
      errors.push({
        code: 'invalid_cleanup_state',
        path: `worktrees[${index}].cleanup_state`,
        message: `Unsupported cleanup_state: ${entry.cleanup_state}`,
      });
    }
  }

  return {
    path: resolved.label,
    exists: true,
    valid: errors.length === 0,
    errors,
    worktrees,
  };
}

function parseAnnotationMutationFlags(args, usage, { valueFlags, booleanFlags = [] }) {
  const allowedValueFlags = new Set(valueFlags);
  const allowedBooleanFlags = new Set(booleanFlags);
  const values = new Map();
  const listValues = new Map([['--write-set', []]]);
  const booleans = new Set();
  const unknown = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (allowedBooleanFlags.has(arg)) {
      booleans.add(arg);
      continue;
    }
    if (!allowedValueFlags.has(arg)) {
      unknown.push(arg);
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { valid: false, usage, error: `Missing value for ${arg}.` };
    }
    if (arg === '--write-set') listValues.get(arg).push(value);
    else values.set(arg, value);
    index += 1;
  }

  if (unknown.length > 0) {
    return { valid: false, usage, error: `Unsupported argument(s): ${unknown.join(', ')}` };
  }

  return {
    valid: true,
    values,
    listValues,
    booleans,
  };
}

function parseWriteSet(values, worktreePath) {
  const entries = [];
  for (const rawValue of values || []) {
    for (const part of String(rawValue).split(',')) {
      const normalized = normalizeRepoPath(part, worktreePath);
      if (normalized && !entries.includes(normalized)) entries.push(normalized);
    }
  }
  return entries;
}

function annotationPathLabelForWrite(workspaceRoot, worktreePath) {
  return workspacePathLabel(workspaceRoot, worktreePath);
}

function annotationIdForWorktree(worktree) {
  if (worktree.id === '.') return 'canonical';
  return worktree.id;
}

function serializeAnnotationEntry(workspaceRoot, entry) {
  const serialized = {
    id: entry.id,
    path: entry.path || annotationPathLabelForWrite(workspaceRoot, entry.normalized_path),
    cleanup_state: entry.cleanup_state || 'active',
  };
  if (entry.runtime_owner) serialized.runtime_owner = entry.runtime_owner;
  if (entry.branch) serialized.branch = entry.branch;
  if (entry.last_known_head) serialized.last_known_head = entry.last_known_head;
  if (entry.intended_scope) serialized.intended_scope = entry.intended_scope;
  if (Array.isArray(entry.write_set) && entry.write_set.length > 0) serialized.write_set = entry.write_set;
  if (entry.next_step) serialized.next_step = entry.next_step;
  if (entry.updated_at) serialized.updated_at = entry.updated_at;
  return serialized;
}

function writeAnnotationsDocument(workspaceRoot, annotationFile, worktrees) {
  mkdirSync(dirname(annotationFile.path), { recursive: true });
  const document = {
    schema_version: 1,
    worktrees: worktrees.map((entry) => serializeAnnotationEntry(workspaceRoot, entry)),
  };
  writeFileSync(annotationFile.path, `${JSON.stringify(document, null, 2)}\n`);
}

function buildMutationContext(context, annotationPathArg) {
  const annotationFile = resolveAnnotationFilePath(context.workspaceRoot, context.planningDir, annotationPathArg);
  if (!annotationFile.inside_workspace) {
    return {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'annotations_path_outside_workspace',
        annotations_path: annotationFile.label,
        message: 'Control-map annotations path must stay inside the workspace.',
      },
    };
  }

  const annotations = loadAnnotations(context.workspaceRoot, context.planningDir, annotationPathArg);
  if (!annotations.valid) {
    return {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'invalid_annotations',
        annotations_path: annotations.path,
        errors: annotations.errors,
      },
    };
  }

  const discovered = discoverGitWorktrees(context.workspaceRoot);
  return {
    ok: true,
    annotationFile,
    annotations,
    worktrees: discovered.worktrees,
  };
}

function findWorktreeByPath(worktrees, pathValue) {
  const normalized = normalizeSlashes(resolve(pathValue));
  return worktrees.find((worktree) => normalizeSlashes(resolve(worktree.path)) === normalized) || null;
}

function findAnnotationIndex(annotations, { id = null, normalizedPath = null } = {}) {
  if (id) {
    const byId = annotations.worktrees.findIndex((entry) => entry.id === id);
    if (byId !== -1) return byId;
  }
  if (normalizedPath) {
    return annotations.worktrees.findIndex((entry) => (
      entry.normalized_path && normalizeSlashes(resolve(entry.normalized_path)) === normalizeSlashes(resolve(normalizedPath))
    ));
  }
  return -1;
}

function staleAnnotationIssues(annotation, worktree) {
  const issues = [];
  if (annotation.branch && worktree.branch && annotation.branch !== worktree.branch) {
    issues.push({
      code: 'branch_mismatch',
      saved: annotation.branch,
      live: worktree.branch,
    });
  }
  if (annotation.last_known_head && worktree.head && annotation.last_known_head !== worktree.head) {
    issues.push({
      code: 'head_mismatch',
      saved: annotation.last_known_head,
      live: worktree.head,
    });
  }
  return issues;
}

function annotationMutationSummary(annotation) {
  return {
    id: annotation.id,
    path: annotation.path,
    runtime_owner: annotation.runtime_owner || null,
    branch: annotation.branch || null,
    last_known_head: annotation.last_known_head || null,
    intended_scope: annotation.intended_scope || null,
    write_set: annotation.write_set || [],
    cleanup_state: annotation.cleanup_state || 'active',
    next_step: annotation.next_step || null,
    updated_at: annotation.updated_at || null,
  };
}

function setAnnotation(context, args) {
  const parsed = parseAnnotationMutationFlags(args, CONTROL_MAP_ANNOTATE_SET_USAGE, {
    valueFlags: [
      '--annotations',
      '--cleanup-state',
      '--id',
      '--next-step',
      '--owner',
      '--path',
      '--runtime-owner',
      '--scope',
      '--write-set',
    ],
    booleanFlags: ['--refresh'],
  });
  if (!parsed.valid) return { ok: false, result: { status: 'blocked', reason: 'invalid_arguments', message: parsed.error, usage: parsed.usage } };

  const annotationPathArg = parsed.values.get('--annotations') || null;
  const mutation = buildMutationContext(context, annotationPathArg);
  if (!mutation.ok) return mutation;

  const explicitId = parsed.values.get('--id') || null;
  const pathValue = parsed.values.get('--path') || '.';
  const targetPath = resolve(context.workspaceRoot, pathValue);
  const worktree = findWorktreeByPath(mutation.worktrees, targetPath);
  if (!worktree || !worktree.git_valid) {
    return {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'worktree_not_found',
        message: `No live git worktree found for ${pathValue}.`,
        path: workspacePathLabel(context.workspaceRoot, targetPath),
      },
    };
  }

  const writeSet = parseWriteSet(parsed.listValues.get('--write-set'), worktree.path);
  if (writeSet.length === 0) {
    return {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'missing_write_set',
        message: 'Annotation set requires at least one --write-set value.',
        usage: CONTROL_MAP_ANNOTATE_SET_USAGE,
      },
    };
  }

  const normalizedPath = normalizeSlashes(resolve(worktree.path));
  const existingIndex = findAnnotationIndex(mutation.annotations, { id: explicitId, normalizedPath });
  const existing = existingIndex === -1 ? null : mutation.annotations.worktrees[existingIndex];

  const cleanupState = parsed.values.get('--cleanup-state') || existing?.cleanup_state || 'active';
  if (!CLEANUP_STATES.includes(cleanupState)) {
    return {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'invalid_cleanup_state',
        message: `Unsupported cleanup_state: ${cleanupState}`,
        supported_cleanup_states: CLEANUP_STATES,
      },
    };
  }

  const staleIssues = existing ? staleAnnotationIssues(existing, worktree) : [];
  const refresh = parsed.booleans.has('--refresh');
  if (staleIssues.length > 0 && !refresh) {
    return {
      ok: false,
      result: {
        operation: 'control-map annotate set',
        status: 'blocked',
        reason: 'stale_annotation',
        annotations_path: mutation.annotationFile.label,
        annotation_id: existing.id,
        stale_issues: staleIssues,
        message: 'Existing annotation is stale against live worktree truth; rerun with --refresh to update it or use annotate clear to remove it.',
      },
    };
  }

  const now = new Date().toISOString();
  const annotation = {
    id: explicitId || existing?.id || annotationIdForWorktree(worktree),
    path: annotationPathLabelForWrite(context.workspaceRoot, worktree.path),
    runtime_owner: parsed.values.get('--runtime-owner') || parsed.values.get('--owner') || existing?.runtime_owner || null,
    branch: worktree.branch,
    last_known_head: worktree.head,
    intended_scope: parsed.values.get('--scope') || existing?.intended_scope || null,
    write_set: writeSet,
    cleanup_state: cleanupState,
    next_step: parsed.values.get('--next-step') || existing?.next_step || null,
    updated_at: now,
  };
  const nextWorktrees = mutation.annotations.worktrees.slice();
  if (existingIndex === -1) nextWorktrees.push(annotation);
  else nextWorktrees[existingIndex] = annotation;
  writeAnnotationsDocument(context.workspaceRoot, mutation.annotationFile, nextWorktrees);

  return {
    ok: true,
    result: {
      operation: 'control-map annotate set',
      changed: true,
      status: existing ? (refresh && staleIssues.length > 0 ? 'refreshed' : 'updated') : 'created',
      annotations_path: mutation.annotationFile.label,
      annotation: annotationMutationSummary(annotation),
      stale_check: {
        status: staleIssues.length > 0 ? 'refreshed' : 'passed',
        issues: staleIssues,
      },
    },
  };
}

function clearAnnotation(context, args) {
  const parsed = parseAnnotationMutationFlags(args, CONTROL_MAP_ANNOTATE_CLEAR_USAGE, {
    valueFlags: ['--annotations', '--id', '--path'],
  });
  if (!parsed.valid) return { ok: false, result: { status: 'blocked', reason: 'invalid_arguments', message: parsed.error, usage: parsed.usage } };

  const id = parsed.values.get('--id') || null;
  const pathValue = parsed.values.get('--path') || null;
  if (!id && !pathValue) {
    return {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'missing_selector',
        message: 'Annotation clear requires --id or --path.',
        usage: CONTROL_MAP_ANNOTATE_CLEAR_USAGE,
      },
    };
  }

  const annotationPathArg = parsed.values.get('--annotations') || null;
  const mutation = buildMutationContext(context, annotationPathArg);
  if (!mutation.ok) return mutation;
  if (!mutation.annotations.exists) {
    return {
      ok: true,
      result: {
        operation: 'control-map annotate clear',
        changed: false,
        status: 'missing',
        annotations_path: mutation.annotationFile.label,
      },
    };
  }

  const normalizedPath = pathValue ? normalizeSlashes(resolve(context.workspaceRoot, pathValue)) : null;
  const existingIndex = findAnnotationIndex(mutation.annotations, { id, normalizedPath });
  if (existingIndex === -1) {
    return {
      ok: true,
      result: {
        operation: 'control-map annotate clear',
        changed: false,
        status: 'not_found',
        annotations_path: mutation.annotationFile.label,
        selector: id ? { id } : { path: workspacePathLabel(context.workspaceRoot, normalizedPath) },
      },
    };
  }

  const removed = mutation.annotations.worktrees[existingIndex];
  const nextWorktrees = mutation.annotations.worktrees.filter((_, index) => index !== existingIndex);
  writeAnnotationsDocument(context.workspaceRoot, mutation.annotationFile, nextWorktrees);

  return {
    ok: true,
    result: {
      operation: 'control-map annotate clear',
      changed: true,
      status: 'cleared',
      annotations_path: mutation.annotationFile.label,
      annotation: annotationMutationSummary(removed),
    },
  };
}

function cmdControlMapAnnotate(context, args) {
  const [operation, ...operationArgs] = args;
  let result;
  if (operation === 'set') result = setAnnotation(context, operationArgs);
  else if (operation === 'clear') result = clearAnnotation(context, operationArgs);
  else {
    result = {
      ok: false,
      result: {
        status: 'blocked',
        reason: 'invalid_operation',
        message: 'Usage: gsdd control-map annotate <set|clear> ...',
      },
    };
  }

  output(result.result);
  if (!result.ok) process.exitCode = 1;
}

function reconcileAnnotations(worktrees, annotations) {
  const warnings = [];
  const byPath = new Map(worktrees.map((entry) => [normalizeSlashes(resolve(entry.path)), entry]));
  const attached = new Map();

  for (const annotation of annotations.worktrees) {
    const worktree = annotation.normalized_path ? byPath.get(annotation.normalized_path) : null;
    if (!worktree) {
      warnings.push({
        code: 'stale_annotation_missing_worktree',
        severity: 'warn',
        message: `Annotation ${annotation.id} points at a missing or unlisted worktree.`,
        annotation_id: annotation.id,
      });
      continue;
    }
    attached.set(worktree.path, annotation);
    if (annotation.branch && worktree.branch && annotation.branch !== worktree.branch) {
      warnings.push({
        code: 'stale_annotation_branch_mismatch',
        severity: 'warn',
        message: `Annotation ${annotation.id} branch ${annotation.branch} does not match live branch ${worktree.branch}.`,
        annotation_id: annotation.id,
        worktree_id: worktree.id,
      });
    }
    if (annotation.last_known_head && worktree.head && annotation.last_known_head !== worktree.head) {
      warnings.push({
        code: 'stale_annotation_head_mismatch',
        severity: 'warn',
        message: `Annotation ${annotation.id} last_known_head does not match live HEAD.`,
        annotation_id: annotation.id,
        worktree_id: worktree.id,
      });
    }
  }

  return {
    worktrees: worktrees.map((worktree) => ({
      ...worktree,
      annotation: attached.get(worktree.path) || null,
    })),
    warnings,
  };
}

function classifyWorkflowState(planningDir) {
  const lifecycle = evaluateLifecycleState({ planningDir });
  const checkpointPath = join(planningDir, '.continue-here.md');
  const drift = existsSync(planningDir) ? checkDrift(planningDir) : { drifted: false, details: [] };
  const milestoneVersion = lifecycle.currentMilestone?.version || null;
  const milestoneTitle = lifecycle.currentMilestone?.title || null;
  const milestone = milestoneVersion || milestoneTitle
    ? { version: milestoneVersion, title: milestoneTitle }
    : null;
  return {
    current_milestone: milestone,
    current_phase: lifecycle.currentPhase?.number || null,
    next_phase: lifecycle.nextPhase?.number || null,
    non_phase_state: lifecycle.nonPhaseState || null,
    checkpoint: {
      exists: existsSync(checkpointPath),
      path: '.planning/.continue-here.md',
    },
    planning_drift: {
      drifted: drift.drifted,
      details: drift.details || [],
    },
  };
}

function addBranchStateRisks(risks, worktree, { canonical = false } = {}) {
  const ahead = worktree.ahead_behind?.ahead;
  const behind = worktree.ahead_behind?.behind;
  if (behind === null || behind === undefined || behind <= 0) return;
  const prefix = canonical ? 'canonical' : 'worktree';
  const label = canonical ? 'Canonical worktree' : `Worktree ${worktree.id}`;
  const branchDetails = {
    worktree_id: canonical ? undefined : worktree.id,
    branch: worktree.branch,
    ahead,
    behind,
  };

  if (ahead > 0) {
    risks.push({
      code: `${prefix}_branch_diverged_upstream`,
      severity: 'warn',
      ...branchDetails,
      message: `${label} has diverged from its upstream (${ahead} ahead, ${behind} behind).`,
    });
  } else {
    risks.push({
      code: `${prefix}_branch_behind_upstream`,
      severity: 'warn',
      ...branchDetails,
      message: `${label} is behind its upstream by ${behind} commit(s).`,
    });
  }
}

function buildRisks({ canonical, worktrees, annotations, rawAnnotations, runtimeDirs, workflowState, gitErrors }) {
  const risks = [];
  const writeEntries = annotationWriteEntries(worktrees, rawAnnotations || { worktrees: [] });
  const dirtyEntries = worktrees.flatMap((worktree) => dirtyRepoPathEntries(worktree));
  const writeSetOverlaps = findWriteSetOverlaps(writeEntries);
  const dirtyWriteSetOverlaps = findDirtyWriteSetOverlaps(writeEntries, dirtyEntries);

  for (const error of gitErrors) {
    risks.push({ code: error.code, severity: 'warn', message: error.message });
  }
  if (!canonical.git_valid) {
    risks.push({ code: 'canonical_git_invalid', severity: 'warn', message: `Canonical worktree git status failed: ${canonical.status_error || 'unknown error'}` });
  }
  addBranchStateRisks(risks, canonical, { canonical: true });
  if (canonical.dirty.counts.tracked > 0 || canonical.dirty.counts.untracked > 0) {
    risks.push({
      code: 'canonical_dirty',
      severity: 'warn',
      message: `Canonical worktree has tracked/untracked changes (${canonical.dirty.counts.tracked} tracked, ${canonical.dirty.counts.untracked} untracked).`,
    });
  }
  if (canonical.dirty.counts.tracked > 0 && (canonical.ahead_behind?.behind || 0) > 0) {
    risks.push({
      code: 'canonical_dirty_behind_upstream',
      severity: 'block',
      branch: canonical.branch,
      ahead: canonical.ahead_behind?.ahead,
      behind: canonical.ahead_behind?.behind,
      message: `Canonical worktree has tracked changes while behind upstream by ${canonical.ahead_behind.behind} commit(s).`,
    });
  }
  if (canonical.dirty.counts.ignored > 0) {
    risks.push({
      code: 'ignored_local_surfaces_present',
      severity: 'info',
      message: `Canonical worktree has ${canonical.dirty.counts.ignored} ignored local surface(s); do not describe the workspace as simply clean.`,
    });
  }
  for (const worktree of worktrees.filter((entry) => entry.path !== canonical.path)) {
    if (!worktree.git_valid) {
      risks.push({ code: 'worktree_git_invalid', severity: 'warn', worktree_id: worktree.id, message: `Worktree ${worktree.id} could not be inspected by git.` });
    }
    addBranchStateRisks(risks, worktree);
    if (worktree.detached) {
      risks.push({
        code: 'detached_candidate_worktree',
        severity: 'warn',
        worktree_id: worktree.id,
        message: `Worktree ${worktree.id} is detached; classify its intent before treating it as an execution surface.`,
      });
    }
    if (worktree.dirty.counts.tracked > 0 || worktree.dirty.counts.untracked > 0) {
      risks.push({
        code: 'sibling_worktree_dirty',
        severity: 'warn',
        worktree_id: worktree.id,
        message: `Sibling worktree ${worktree.id} has tracked/untracked changes.`,
      });
    }
    if (!worktree.annotation && (worktree.dirty.counts.tracked > 0 || worktree.dirty.counts.untracked > 0 || worktree.detached)) {
      risks.push({
        code: 'unannotated_candidate_worktree',
        severity: 'info',
        worktree_id: worktree.id,
        message: `Worktree ${worktree.id} has candidate-work signals but no local control-map annotation.`,
      });
    }
  }
  if (writeSetOverlaps.length > 0) {
    risks.push({
      code: 'write_set_overlap',
      severity: 'block',
      message: `Active control-map annotations have ${writeSetOverlaps.length} concrete write-set overlap(s).`,
      overlaps: writeSetOverlaps.slice(0, MAX_DIRTY_BUCKET_ENTRIES),
      omitted_count: Math.max(0, writeSetOverlaps.length - MAX_DIRTY_BUCKET_ENTRIES),
    });
  }
  if (dirtyWriteSetOverlaps.length > 0) {
    risks.push({
      code: 'dirty_path_write_set_overlap',
      severity: 'block',
      message: `Live dirty paths overlap annotated write sets (${dirtyWriteSetOverlaps.length} overlap(s)).`,
      overlaps: dirtyWriteSetOverlaps.slice(0, MAX_DIRTY_BUCKET_ENTRIES),
      omitted_count: Math.max(0, dirtyWriteSetOverlaps.length - MAX_DIRTY_BUCKET_ENTRIES),
    });
  }
  for (const warning of annotations.warnings || []) risks.push(warning);
  for (const error of annotations.errors || []) {
    risks.push({ code: error.code, severity: 'warn', message: error.message, path: error.path });
  }
  for (const runtimeDir of runtimeDirs.filter((entry) => !entry.appears_git_worktree)) {
    risks.push({
      code: 'orphan_runtime_dir',
      severity: 'info',
      message: `${runtimeDir.runtime} local directory is not a git worktree: ${runtimeDir.path_relative}`,
      path: runtimeDir.path_relative,
    });
  }
  if (workflowState.planning_drift.drifted) {
    risks.push({
      code: 'planning_state_drift',
      severity: 'warn',
      message: `Planning state drifted since the last fingerprint: ${workflowState.planning_drift.details.join('; ')}`,
    });
  }
  return risks;
}

function buildInterventions(risks) {
  const codes = new Set(risks.map((risk) => risk.code));
  const interventions = [];
  if (codes.has('canonical_git_invalid')) interventions.push('Fix git/safe.directory access before mutating this checkout.');
  if (codes.has('write_set_overlap')) interventions.push('Resolve overlapping local annotation write sets before starting another owned-write workflow.');
  if (codes.has('dirty_path_write_set_overlap')) interventions.push('Checkpoint, commit, stash, or explicitly classify dirty paths that overlap annotated write sets before owned-write transitions.');
  if (codes.has('canonical_dirty_behind_upstream')) interventions.push('Sync the canonical branch or preserve dirty canonical work before mutating a stale checkout.');
  if (codes.has('canonical_branch_behind_upstream') || codes.has('canonical_branch_diverged_upstream') || codes.has('worktree_branch_behind_upstream') || codes.has('worktree_branch_diverged_upstream')) interventions.push('Review upstream divergence before relying on stale branch state for implementation decisions.');
  if (codes.has('detached_candidate_worktree')) interventions.push('Classify detached worktree intent before using it for execution or cleanup decisions.');
  if (codes.has('canonical_dirty')) interventions.push('Checkpoint or classify canonical dirty work before planning, cleanup, merge, or broad execution.');
  if (codes.has('sibling_worktree_dirty') || codes.has('unannotated_candidate_worktree')) interventions.push('Review sibling worktree ownership and write set before starting overlapping implementation.');
  if (codes.has('stale_annotation_missing_worktree') || codes.has('stale_annotation_branch_mismatch') || codes.has('stale_annotation_head_mismatch')) interventions.push('Refresh or remove stale local control-map annotations after reviewing repo truth.');
  if (codes.has('planning_state_drift')) interventions.push('Review planning drift and rebaseline with session-fingerprint only after confirming the changes are intentional.');
  if (interventions.length === 0) interventions.push('No control-map intervention required before read-only status work.');
  return interventions;
}

export function buildControlMap({
  workspaceRoot,
  planningDir,
  annotationPath = null,
  includeIgnoredPaths = false,
  now = new Date(),
} = {}) {
  const root = resolve(workspaceRoot || process.cwd());
  const planning = planningDir || join(root, '.planning');
  const discovered = discoverGitWorktrees(root, { includeIgnoredPaths, includeIgnoredCount: includeIgnoredPaths });
  const annotations = loadAnnotations(root, planning, annotationPath);
  const reconciled = reconcileAnnotations(discovered.worktrees, annotations);
  const canonical = reconciled.worktrees.find((entry) => resolve(entry.path) === root)
    || reconciled.worktrees[0]
    || readGitWorktree(root, root, { includeIgnoredCount: true });
  const workflowState = classifyWorkflowState(planning);
  const runtimeDirs = discoverRuntimeDirs(root);
  const annotationReport = {
    path: annotations.path,
    exists: annotations.exists,
    valid: annotations.valid,
    errors: annotations.errors,
    warnings: reconciled.warnings,
  };
  const risks = buildRisks({
    canonical,
    worktrees: reconciled.worktrees,
    annotations: annotationReport,
    rawAnnotations: annotations,
    runtimeDirs,
    workflowState,
    gitErrors: discovered.errors,
  });

  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    operation: 'control-map',
    repo_root_id: canonical.git_top_level || normalizeSlashes(root),
    workspace_root: normalizeSlashes(root),
    default_annotations_path: DEFAULT_ANNOTATIONS_RELATIVE_PATH,
    authority: AUTHORITY_ORDER,
    canonical_worktree: canonical,
    worktrees: reconciled.worktrees,
    workflow_state: workflowState,
    annotations: annotationReport,
    runtime_dirs: runtimeDirs,
    risks,
    interventions: buildInterventions(risks),
  };
}

function printHuman(map) {
  const milestone = map.workflow_state.current_milestone
    ? [map.workflow_state.current_milestone.version, map.workflow_state.current_milestone.title].filter(Boolean).join(' ')
    : 'none';
  const ignoredLabel = map.canonical_worktree.dirty.ignored_count_included
    ? String(map.canonical_worktree.dirty.counts.ignored)
    : 'not scanned';
  console.log('gsdd control-map - computed workspace control map\n');
  console.log(`Workspace: ${map.workspace_root}`);
  console.log(`Authority: ${map.authority.join(' > ')}`);
  console.log(`Canonical: ${map.canonical_worktree.branch || 'unknown'} @ ${map.canonical_worktree.head || 'unknown'}`);
  console.log(`Workflow: milestone=${milestone}, phase=${map.workflow_state.current_phase || 'none'}, next=${map.workflow_state.next_phase || 'none'}`);
  console.log(`Checkpoint: ${map.workflow_state.checkpoint.path} (${map.workflow_state.checkpoint.exists ? 'present' : 'missing'})`);
  console.log(`Dirty buckets: ${map.canonical_worktree.dirty.counts.tracked} tracked, ${map.canonical_worktree.dirty.counts.untracked} untracked, ${ignoredLabel} ignored`);
  console.log(`Worktrees: ${map.worktrees.length}`);
  for (const worktree of map.worktrees) {
    const marker = worktree.path === map.canonical_worktree.path ? '*' : '-';
    const annotation = worktree.annotation ? ` owner=${worktree.annotation.runtime_owner || 'unspecified'} cleanup=${worktree.annotation.cleanup_state}` : '';
    const ignoredCount = worktree.dirty.ignored_count_included ? String(worktree.dirty.counts.ignored) : 'not-scanned';
    console.log(`  ${marker} ${worktree.id} branch=${worktree.branch || 'unknown'} dirty=${worktree.dirty.counts.tracked}/${worktree.dirty.counts.untracked}/${ignoredCount}${annotation}`);
  }
  if (map.risks.length > 0) {
    console.log('\nRisks:');
    for (const risk of map.risks) console.log(`  - [${risk.severity || 'info'}] ${risk.code}: ${risk.message}`);
  }
  console.log('\nInterventions:');
  for (const intervention of map.interventions) console.log(`  - ${intervention}`);
}

export function cmdControlMap(...args) {
  const jsonMode = args.includes('--json');
  const contextArgs = args.filter((arg) => arg !== '--json');
  const context = resolveWorkspaceContext(contextArgs);
  if (context.invalid) {
    console.error(context.error);
    process.exitCode = 1;
    return;
  }

  if (context.args[0] === 'annotate') {
    cmdControlMapAnnotate(context, context.args.slice(1));
    return;
  }

  const annotations = parseFlagValue(context.args, '--annotations');
  if (annotations.invalid) {
    console.error(CONTROL_MAP_USAGE);
    process.exitCode = 1;
    return;
  }
  const filteredArgs = context.args.filter((arg, index) => {
    if (arg === '--annotations') return false;
    if (index > 0 && context.args[index - 1] === '--annotations') return false;
    if (arg === '--with-ignored') return false;
    return true;
  });
  if (filteredArgs.length > 0) {
    console.error(CONTROL_MAP_USAGE);
    process.exitCode = 1;
    return;
  }

  const includeIgnoredPaths = context.args.includes('--with-ignored');
  const map = buildControlMap({
    workspaceRoot: context.workspaceRoot,
    planningDir: context.planningDir,
    annotationPath: annotations.value,
    includeIgnoredPaths,
  });
  if (jsonMode) output(map);
  else printHuman(map);
}
