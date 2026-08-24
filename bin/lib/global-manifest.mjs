import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

export const GLOBAL_MANIFEST_FILENAME = 'workspine-file-manifest.json';

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function fileHash(filePath) {
  return sha256(readFileSync(filePath));
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
export function inspectGlobalManifest(rootDir) {
  const manifestPath = join(rootDir, GLOBAL_MANIFEST_FILENAME);
  let stat;
  try {
    stat = lstatSync(manifestPath);
  } catch {
    return { path: manifestPath, status: 'missing', manifest: null };
  }
  if (stat.isSymbolicLink()) return { path: manifestPath, status: 'linked', manifest: null };
  if (!stat.isFile()) return { path: manifestPath, status: 'collision', manifest: null };

  const manifest = readGlobalManifest(rootDir);
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? { path: manifestPath, status: 'valid', manifest }
    : { path: manifestPath, status: 'corrupt', manifest: null };
}

export function writeGlobalManifest(rootDir, manifest) {
  mkdirSync(rootDir, { recursive: true });
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
}) {
  const absolutePath = join(rootDir, relativePath);
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const expectedHash = sha256(content);
  const previousHash = previousManifest?.files?.[normalizedRelativePath] || null;

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

  nextFiles[normalizedRelativePath] = expectedHash;
  if (!dryRun) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return { relativePath: normalizedRelativePath, status: dryRun ? 'would_write' : 'written' };
}

export function pruneStaleManifestTrackedFiles({
  rootDir,
  previousManifest,
  nextFiles,
  dryRun = false,
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

    if (!dryRun) rmSync(absolutePath, { force: true });
    results.push({ relativePath: normalizedRelativePath, status: dryRun ? 'would_remove' : 'removed_stale' });
  }

  return results;
}
