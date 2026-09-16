import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';

export const GLOBAL_MANIFEST_FILENAME = 'workspine-file-manifest.json';

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function fileHash(filePath) {
  return sha256(readFileSync(filePath));
}

function pathIsInside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Inspect the install root plus every existing parent of a manifest-tracked
 * target without following links. Missing parents are safe for a later
 * create; linked/colliding parents must fail closed before health advertises
 * or update performs a write through them.
 */
export function inspectGlobalTrackedPath(rootDir, relativePath, containmentRoot = rootDir) {
  const root = resolve(rootDir);
  const anchor = resolve(containmentRoot);
  const target = resolve(root, relativePath);
  if (!pathIsInside(root, target) || target === root) {
    return { status: 'unsafe', message: 'target resolves outside the install root' };
  }
  if (!pathIsInside(anchor, root)) {
    return { status: 'unsafe', message: 'install root resolves outside its containment root' };
  }

  let anchorStat;
  try {
    anchorStat = lstatSync(anchor);
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'safe' };
    return { status: 'unreadable', message: 'containment root could not be inspected safely' };
  }
  if (anchorStat.isSymbolicLink()) return { status: 'linked', message: 'containment root is linked' };
  if (!anchorStat.isDirectory()) return { status: 'collision', message: 'containment root is not a directory' };

  let realAnchor;
  try {
    realAnchor = realpathSync(anchor);
  } catch {
    return { status: 'unreadable', message: 'containment root could not be resolved safely' };
  }

  let current = anchor;
  const parentParts = relative(anchor, dirname(target)).split(sep).filter(Boolean);
  for (const part of parentParts) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return { status: 'safe' };
      return { status: 'unreadable', message: 'target parent could not be inspected safely' };
    }
    if (stat.isSymbolicLink()) return { status: 'linked', message: 'target parent is linked' };
    if (!stat.isDirectory()) return { status: 'collision', message: 'target parent is not a directory' };
    let realCurrent;
    try {
      realCurrent = realpathSync(current);
    } catch {
      return { status: 'unreadable', message: 'target parent could not be resolved safely' };
    }
    if (!pathIsInside(realAnchor, realCurrent)) {
      return { status: 'unsafe', message: 'target parent resolves outside the containment root' };
    }
  }
  return { status: 'safe' };
}

export function readGlobalManifest(rootDir) {
  const manifestPath = join(rootDir, GLOBAL_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Distinguish a missing manifest from a corrupt or unsafe manifest path.  The
 * installer must make this distinction before it writes any target bytes.
 */
export function inspectGlobalManifest(rootDir, containmentRoot = rootDir) {
  const manifestPath = join(rootDir, GLOBAL_MANIFEST_FILENAME);
  const pathState = inspectGlobalTrackedPath(rootDir, GLOBAL_MANIFEST_FILENAME, containmentRoot);
  if (pathState.status !== 'safe') {
    return { path: manifestPath, status: pathState.status, manifest: null };
  }
  let stat;
  try {
    stat = lstatSync(manifestPath);
  } catch (error) {
    return {
      path: manifestPath,
      status: error?.code === 'ENOENT' ? 'missing' : 'unreadable',
      manifest: null,
    };
  }
  if (stat.isSymbolicLink()) return { path: manifestPath, status: 'linked', manifest: null };
  if (!stat.isFile()) return { path: manifestPath, status: 'collision', manifest: null };

  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    return { path: manifestPath, status: 'unreadable', manifest: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { path: manifestPath, status: 'corrupt', manifest: null };
  }
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? { path: manifestPath, status: 'valid', manifest }
    : { path: manifestPath, status: 'corrupt', manifest: null };
}

export function writeGlobalManifest(rootDir, manifest, containmentRoot = rootDir) {
  const before = inspectGlobalTrackedPath(rootDir, GLOBAL_MANIFEST_FILENAME, containmentRoot);
  if (before.status !== 'safe') {
    throw new Error(`Refusing global manifest write: ${before.message || before.status}.`);
  }
  mkdirSync(rootDir, { recursive: true });
  const after = inspectGlobalTrackedPath(rootDir, GLOBAL_MANIFEST_FILENAME, containmentRoot);
  if (after.status !== 'safe') {
    throw new Error(`Refusing global manifest write: ${after.message || after.status}.`);
  }
  writeFileSync(join(rootDir, GLOBAL_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2));
}

export function toManifestPath(rootDir, absolutePath) {
  return relative(rootDir, absolutePath).replace(/\\/g, '/');
}

export function writeManifestTrackedFile({
  rootDir,
  relativePath,
  content,
  previousManifest,
  nextFiles,
  dryRun = false,
  strictOwnership = false,
  containmentRoot = rootDir,
}) {
  const absolutePath = join(rootDir, relativePath);
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const expectedHash = sha256(content);
  const previousHash = previousManifest?.files?.[normalizedRelativePath] || null;

  const pathState = inspectGlobalTrackedPath(rootDir, normalizedRelativePath, containmentRoot);
  if (pathState.status !== 'safe') {
    return {
      relativePath: normalizedRelativePath,
      status: `skipped_${pathState.status}`,
      message: pathState.message || 'target path is unsafe',
    };
  }

  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') stat = null;
    else {
      return {
        relativePath: normalizedRelativePath,
        status: 'skipped_unreadable',
        message: 'existing target could not be inspected safely',
      };
    }
  }
  if (stat) {
    if (stat.isSymbolicLink()) {
      return {
        relativePath: normalizedRelativePath,
        status: 'skipped_linked',
        message: 'existing target is linked (symbolic link)',
      };
    }
    if (!stat.isFile()) {
      return {
        relativePath: normalizedRelativePath,
        status: 'skipped_collision',
        message: 'existing target collision: not a regular file',
      };
    }
    const currentHash = fileHash(absolutePath);
    if (currentHash === expectedHash) {
      if (strictOwnership && !previousHash) {
        return {
          relativePath: normalizedRelativePath,
          status: 'skipped_unmanaged',
          message: 'existing file is unowned (not tracked by Workspine manifest)',
        };
      }
      nextFiles[normalizedRelativePath] = expectedHash;
      return { relativePath: normalizedRelativePath, status: 'unchanged' };
    }
    if (!previousHash) {
      return {
        relativePath: normalizedRelativePath,
        status: 'skipped_unmanaged',
        message: 'existing file is unowned (not tracked by Workspine manifest)',
      };
    }
    if (currentHash !== previousHash) {
      return {
        relativePath: normalizedRelativePath,
        status: 'skipped_modified',
        message: 'existing Workspine-managed file was modified by the user',
      };
    }
  }

  if (!stat && strictOwnership && !previousHash) {
    return {
      relativePath: normalizedRelativePath,
      status: 'skipped_unmanaged',
      message: 'missing target is unowned (not tracked by Workspine manifest)',
    };
  }

  nextFiles[normalizedRelativePath] = expectedHash;
  if (!dryRun) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    const writePathState = inspectGlobalTrackedPath(rootDir, normalizedRelativePath, containmentRoot);
    if (writePathState.status !== 'safe') {
      delete nextFiles[normalizedRelativePath];
      return {
        relativePath: normalizedRelativePath,
        status: `skipped_${writePathState.status}`,
        message: writePathState.message || 'target path became unsafe before write',
      };
    }
    writeFileSync(absolutePath, content);
  }
  return { relativePath: normalizedRelativePath, status: dryRun ? 'would_write' : 'written' };
}

export function pruneStaleManifestTrackedFiles({
  rootDir,
  previousManifest,
  nextFiles,
  dryRun = false,
  containmentRoot = rootDir,
}) {
  if (!previousManifest?.files) return [];

  const root = resolve(rootDir);
  const results = [];
  for (const [relativePath, previousHash] of Object.entries(previousManifest.files)) {
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    if (nextFiles[normalizedRelativePath]) continue;

    const absolutePath = resolve(rootDir, normalizedRelativePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}\\`) && !absolutePath.startsWith(`${root}/`)) {
      results.push({
        relativePath: normalizedRelativePath,
        status: 'skipped_unsafe',
        message: 'previous manifest path resolves outside the install root',
      });
      continue;
    }

    const pathState = inspectGlobalTrackedPath(rootDir, normalizedRelativePath, containmentRoot);
    if (pathState.status !== 'safe') {
      results.push({
        relativePath: normalizedRelativePath,
        status: `skipped_${pathState.status}`,
        message: pathState.message || 'previous manifest path is unsafe',
      });
      continue;
    }

    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        results.push({ relativePath: normalizedRelativePath, status: 'removed_missing' });
        continue;
      }
      results.push({
        relativePath: normalizedRelativePath,
        status: 'skipped_unreadable',
        message: 'stale target could not be inspected safely',
      });
      continue;
    }
    if (stat.isSymbolicLink()) {
      results.push({
        relativePath: normalizedRelativePath,
        status: 'skipped_linked',
        message: 'stale target is linked (symbolic link)',
      });
      continue;
    }
    if (!stat.isFile()) {
      results.push({
        relativePath: normalizedRelativePath,
        status: 'skipped_collision',
        message: 'stale target collision: not a regular file',
      });
      continue;
    }
    const currentHash = fileHash(absolutePath);
    if (currentHash !== previousHash) {
      results.push({
        relativePath: normalizedRelativePath,
        status: 'skipped_modified',
        message: 'stale Workspine-managed file was modified by the user',
      });
      continue;
    }

    if (!dryRun) {
      const removePathState = inspectGlobalTrackedPath(rootDir, normalizedRelativePath, containmentRoot);
      if (removePathState.status !== 'safe') {
        results.push({
          relativePath: normalizedRelativePath,
          status: `skipped_${removePathState.status}`,
          message: removePathState.message || 'stale target path became unsafe before removal',
        });
        continue;
      }
      rmSync(absolutePath, { force: true });
    }
    results.push({ relativePath: normalizedRelativePath, status: dryRun ? 'would_remove' : 'removed_stale' });
  }

  return results;
}
