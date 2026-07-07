// control-map.mjs - computed-first workspace/worktree control map

import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { output, parseFlagValue } from './cli-utils.mjs';
import { evaluateLifecycleState } from './lifecycle-state.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

const DEFAULT_ANNOTATIONS_RELATIVE_PATH = '.planning/.local/control-map.annotations.json';
const MAX_DIRTY_BUCKET_ENTRIES = 200;
const CLEANUP_STATES = Object.freeze(['active', 'paused', 'merged', 'abandoned', 'superseded', 'cleanup_deferred']);
const ACTIVE_ANNOTATION_STATES = Object.freeze(['active', 'paused', 'cleanup_deferred']);
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
        classified_worktree_id: writeEntry.worktree_id,
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

  function fixHintForRisk(risk) {
    const code = risk.code;
    switch (code) {
      case 'canonical_git_invalid':
      case 'worktree_git_invalid': {
        const targetPath = risk.worktree_id || canonical.path;
        return `Run \`git config --global --add safe.directory ${targetPath}\`, then re-run \`gsdd control-map --json\`.`;
      }
      case 'canonical_dirty':
        return 'Commit, stash, or checkpoint the canonical changes before planning, cleanup, merge, or broad execution.';
      case 'canonical_dirty_behind_upstream':
        return 'Commit/stash the canonical changes or sync the branch; do not mutate a dirty checkout that is behind upstream.';
      case 'canonical_branch_behind_upstream':
      case 'canonical_branch_diverged_upstream':
      case 'worktree_branch_behind_upstream':
      case 'worktree_branch_diverged_upstream':
        return 'Review upstream divergence (fetch/merge/rebase) before treating this branch state as an execution surface.';
      case 'detached_candidate_worktree':
        return 'Classify the detached worktree intent (active vs abandoned) before using it for execution or cleanup decisions.';
      case 'sibling_worktree_dirty':
      case 'unclassified_candidate_worktree':
        return 'Review sibling worktree ownership and write set before starting overlapping implementation.';
      case 'write_set_overlap':
        return 'Resolve overlapping local annotation write sets before starting another owned-write workflow.';
      case 'dirty_path_write_set_overlap':
        return 'Checkpoint or classify dirty paths that overlap classified write sets before owned-write transitions.';
      default:
        return null;
    }
  }

  for (const error of gitErrors) {
    risks.push({ code: error.code, severity: 'warn', message: error.message });
  }
  if (!canonical.git_valid) {
    const risk = {
      code: 'canonical_git_invalid',
      severity: 'warn',
      path: normalizeSlashes(canonical.path),
      message: `Canonical worktree git status failed: ${canonical.status_error || 'unknown error'}`,
    };
    risk.fix_hint = fixHintForRisk(risk);
    risks.push(risk);
  }
  addBranchStateRisks(risks, canonical, { canonical: true });
  if (canonical.dirty.counts.tracked > 0 || canonical.dirty.counts.untracked > 0) {
    const risk = {
      code: 'canonical_dirty',
      severity: 'warn',
      message: `Canonical worktree has tracked/untracked changes (${canonical.dirty.counts.tracked} tracked, ${canonical.dirty.counts.untracked} untracked).`,
    };
    risk.fix_hint = fixHintForRisk(risk);
    risks.push(risk);
  }
  if (canonical.dirty.counts.tracked > 0 && (canonical.ahead_behind?.behind || 0) > 0) {
    const risk = {
      code: 'canonical_dirty_behind_upstream',
      severity: 'block',
      branch: canonical.branch,
      ahead: canonical.ahead_behind?.ahead,
      behind: canonical.ahead_behind?.behind,
      message: `Canonical worktree has tracked changes while behind upstream by ${canonical.ahead_behind.behind} commit(s).`,
    };
    risk.fix_hint = fixHintForRisk(risk);
    risks.push(risk);
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
      const risk = {
        code: 'worktree_git_invalid',
        severity: 'warn',
        worktree_id: worktree.id,
        message: `Worktree ${worktree.id} could not be inspected by git.`,
      };
      risk.fix_hint = fixHintForRisk(risk);
      risks.push(risk);
    }
    addBranchStateRisks(risks, worktree);
    if (worktree.detached) {
      const risk = {
        code: 'detached_candidate_worktree',
        severity: 'warn',
        worktree_id: worktree.id,
        message: `Worktree ${worktree.id} is detached; classify its intent before treating it as an execution surface.`,
      };
      risk.fix_hint = fixHintForRisk(risk);
      risks.push(risk);
    }
    if (worktree.dirty.counts.tracked > 0 || worktree.dirty.counts.untracked > 0) {
      const risk = {
        code: 'sibling_worktree_dirty',
        severity: 'warn',
        worktree_id: worktree.id,
        message: `Sibling worktree ${worktree.id} has tracked/untracked changes.`,
      };
      risk.fix_hint = fixHintForRisk(risk);
      risks.push(risk);
    }
    if (!worktree.annotation && (worktree.dirty.counts.tracked > 0 || worktree.dirty.counts.untracked > 0 || worktree.detached)) {
      const risk = {
        code: 'unclassified_candidate_worktree',
        severity: 'info',
        worktree_id: worktree.id,
        message: `Worktree ${worktree.id} has candidate-work signals but no local control-map annotation.`,
      };
      risk.fix_hint = fixHintForRisk(risk);
      risks.push(risk);
    }
  }
  if (writeSetOverlaps.length > 0) {
    const risk = {
      code: 'write_set_overlap',
      severity: 'block',
      message: `Active control-map annotations have ${writeSetOverlaps.length} concrete write-set overlap(s).`,
      overlaps: writeSetOverlaps.slice(0, MAX_DIRTY_BUCKET_ENTRIES),
      omitted_count: Math.max(0, writeSetOverlaps.length - MAX_DIRTY_BUCKET_ENTRIES),
    };
    risk.fix_hint = fixHintForRisk(risk);
    risks.push(risk);
  }
  if (dirtyWriteSetOverlaps.length > 0) {
    const risk = {
      code: 'dirty_path_write_set_overlap',
      severity: 'block',
      message: `Live dirty paths overlap classified write sets (${dirtyWriteSetOverlaps.length} overlap(s)).`,
      overlaps: dirtyWriteSetOverlaps.slice(0, MAX_DIRTY_BUCKET_ENTRIES),
      omitted_count: Math.max(0, dirtyWriteSetOverlaps.length - MAX_DIRTY_BUCKET_ENTRIES),
    };
    risk.fix_hint = fixHintForRisk(risk);
    risks.push(risk);
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
  // Ensure the common closure risks expose actionable fix guidance even when
  // the originating helper (for example branch-state risks) didn't attach it.
  for (const risk of risks) {
    if (!risk.fix_hint) {
      const hint = fixHintForRisk(risk);
      if (hint) risk.fix_hint = hint;
    }
  }
  return risks;
}

function buildInterventions(risks) {
  const codes = new Set(risks.map((risk) => risk.code));
  const interventions = [];
  if (codes.has('canonical_git_invalid')) interventions.push('Fix git/safe.directory access before mutating this checkout.');
  if (codes.has('write_set_overlap')) interventions.push('Resolve overlapping local annotation write sets before starting another owned-write workflow.');
  if (codes.has('dirty_path_write_set_overlap')) interventions.push('Checkpoint, commit, stash, or explicitly classify dirty paths that overlap classified write sets before owned-write transitions.');
  if (codes.has('canonical_dirty_behind_upstream')) interventions.push('Sync the canonical branch or preserve dirty canonical work before mutating a stale checkout.');
  if (codes.has('canonical_branch_behind_upstream') || codes.has('canonical_branch_diverged_upstream') || codes.has('worktree_branch_behind_upstream') || codes.has('worktree_branch_diverged_upstream')) interventions.push('Review upstream divergence before relying on stale branch state for implementation decisions.');
  if (codes.has('detached_candidate_worktree')) interventions.push('Classify detached worktree intent before using it for execution or cleanup decisions.');
  if (codes.has('canonical_dirty')) interventions.push('Checkpoint or classify canonical dirty work before planning, cleanup, merge, or broad execution.');
  if (codes.has('sibling_worktree_dirty') || codes.has('unclassified_candidate_worktree')) interventions.push('Review sibling worktree ownership and write set before starting overlapping implementation.');
  if (codes.has('stale_annotation_missing_worktree') || codes.has('stale_annotation_branch_mismatch') || codes.has('stale_annotation_head_mismatch')) interventions.push('Refresh or remove stale local control-map annotations after reviewing repo truth.');
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
