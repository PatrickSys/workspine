import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';

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
}) {
  const absolutePath = join(rootDir, relativePath);
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const expectedHash = sha256(content);
  const previousHash = previousManifest?.files?.[normalizedRelativePath] || null;

  if (existsSync(absolutePath)) {
    const currentHash = fileHash(absolutePath);
    if (currentHash === expectedHash) {
      nextFiles[normalizedRelativePath] = expectedHash;
      return { relativePath: normalizedRelativePath, status: 'unchanged' };
    }
    if (!previousHash) {
      return {
        relativePath: normalizedRelativePath,
        status: 'skipped_unmanaged',
        message: 'existing file is not tracked by Workspine manifest',
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

