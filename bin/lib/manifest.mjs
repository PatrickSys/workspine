// manifest.mjs — Generation manifest for template versioning

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const MANIFEST_FILENAME = 'generation-manifest.json';

/**
 * SHA-256 hex digest of file contents.
 */
export function fileHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recursive { relativePath: sha256 } map for a directory.
 * Normalizes backslashes to forward slashes for cross-platform consistency.
 */
export function hashDirectory(dir, baseDir = dir) {
  const result = {};
  if (!existsSync(dir)) return result;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      Object.assign(result, hashDirectory(fullPath, baseDir));
    } else {
      const rel = relative(baseDir, fullPath).replace(/\\/g, '/');
      result[rel] = fileHash(fullPath);
    }
  }

  return result;
}

/**
 * Build a full manifest snapshot from installed project files.
 */
export function buildManifest({ planningDir, frameworkVersion }) {
  const templatesDir = join(planningDir, 'templates');
  const rolesDir = join(templatesDir, 'roles');

  // Template subcategories
  const delegatesHashes = hashDirectory(join(templatesDir, 'delegates'), join(templatesDir, 'delegates'));
  const researchHashes = hashDirectory(join(templatesDir, 'research'), join(templatesDir, 'research'));
  const codebaseHashes = hashDirectory(join(templatesDir, 'codebase'), join(templatesDir, 'codebase'));

  // Root-level template .md files (agents.block.md, spec.md, roadmap.md, etc.)
  const rootHashes = {};
  if (existsSync(templatesDir)) {
    for (const entry of readdirSync(templatesDir)) {
      const fullPath = join(templatesDir, entry);
      if (statSync(fullPath).isFile() && entry.endsWith('.md')) {
        rootHashes[entry] = fileHash(fullPath);
      }
    }
  }

  // Role contracts
  const rolesHashes = {};
  if (existsSync(rolesDir)) {
    for (const entry of readdirSync(rolesDir)) {
      if (entry.endsWith('.md')) {
        rolesHashes[entry] = fileHash(join(rolesDir, entry));
      }
    }
  }

  return {
    frameworkVersion,
    generatedAt: new Date().toISOString(),
    templates: {
      delegates: delegatesHashes,
      research: researchHashes,
      codebase: codebaseHashes,
      root: rootHashes,
    },
    roles: rolesHashes,
  };
}

/**
 * Read existing manifest from planningDir, or return null if missing/corrupt.
 */
export function readManifest(planningDir) {
  const manifestPath = join(planningDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write generation-manifest.json to planningDir.
 */
export function writeManifest(planningDir, manifest) {
  const manifestPath = join(planningDir, MANIFEST_FILENAME);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Compare installed files vs manifest hashes.
 * Returns { modified: string[], unchanged: string[], missing: string[] }
 * where each string is a relative filename.
 */
export function detectModifications(installedDir, manifestHashes) {
  const modified = [];
  const unchanged = [];
  const missing = [];

  if (!manifestHashes) return { modified, unchanged, missing };

  for (const [file, expectedHash] of Object.entries(manifestHashes)) {
    const fullPath = join(installedDir, file);
    if (!existsSync(fullPath)) {
      missing.push(file);
      continue;
    }
    const currentHash = fileHash(fullPath);
    if (currentHash === expectedHash) {
      unchanged.push(file);
    } else {
      modified.push(file);
    }
  }

  return { modified, unchanged, missing };
}
