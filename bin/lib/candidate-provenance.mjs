import { lstatSync, readFileSync, realpathSync } from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { isAbsolute, relative, resolve, sep } from 'path';

function provenanceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isInside(root, target) {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!!path && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeGitStatus(status) {
  return String(status || '').replace(/\r\n/g, '\n');
}

export function captureGitCandidate(workspaceRoot, excludedPaths = []) {
  try {
    const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw provenanceError('candidate_git_failure', 'Git HEAD is not an exact commit.');
    const exclusions = ['.work', '.planning', ...excludedPaths]
      .map((path) => String(path || '').replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter(Boolean)
      .map((path) => `:(exclude,literal)${path}`);
    const status = normalizeGitStatus(execFileSync('git', [
      '-c', 'core.quotePath=true', 'status', '--porcelain=v1', '--untracked-files=all', '--', '.', ...exclusions,
    ], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }));
    return {
      commit: commit.toLowerCase(),
      dirtyFingerprint: `sha256:${sha256(Buffer.from(status, 'utf8'))}`,
      dirtyEntries: status.split('\n').filter(Boolean).length,
    };
  } catch (error) {
    if (error?.code === 'candidate_git_failure') throw error;
    throw provenanceError('candidate_git_failure', 'Could not read Git HEAD and dirty-set provenance.');
  }
}

export function resolveCandidateArtifact(workspaceRoot, artifactPath) {
  const candidate = String(artifactPath || '').trim();
  if (!candidate || isAbsolute(candidate) || /^[a-z][a-z0-9+.-]*:/i.test(candidate)
    || /[?*\[\]{}]/.test(candidate) || candidate.includes(',') || candidate.includes('\\')) {
    throw provenanceError('invalid_candidate_artifact_path', 'Candidate artifact path must be one explicit repo-relative path.');
  }
  const parts = candidate.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..') || ['.work', '.planning'].includes(parts[0].toLowerCase())) {
    throw provenanceError('invalid_candidate_artifact_path', 'Candidate artifact path must stay outside .work and .planning.');
  }
  const root = realpathSync(workspaceRoot);
  const target = resolve(root, candidate);
  if (!isInside(root, target)) throw provenanceError('invalid_candidate_artifact_path', 'Candidate artifact path resolves outside the workspace.');
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    let entry;
    try {
      entry = lstatSync(current);
    } catch {
      throw provenanceError('missing_candidate_artifact', 'Candidate artifact does not exist.');
    }
    if (entry.isSymbolicLink()) throw provenanceError('invalid_candidate_artifact_path', 'Candidate artifact path must not traverse a symlink.');
  }
  const stat = lstatSync(target);
  if (!stat.isFile()) throw provenanceError('invalid_candidate_artifact_path', 'Candidate artifact must be a regular file.');
  return target;
}

export function hashCandidateArtifact(workspaceRoot, artifactPath) {
  return `sha256:${sha256(readFileSync(resolveCandidateArtifact(workspaceRoot, artifactPath)))}`;
}

export function hashExactFile(filePath) {
  const entry = lstatSync(filePath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw provenanceError('invalid_candidate_plan', 'Referenced PLAN must be a regular file.');
  return `sha256:${sha256(readFileSync(filePath))}`;
}
