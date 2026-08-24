// manifest.mjs — Generation manifest for template versioning

import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from './atomic-write.mjs';
import { ADAPTER_SOURCE_FILES } from '../adapters/index.mjs';

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

function hashRelativeFiles(baseDir, relativePaths) {
  const normalizedPaths = [...new Set(relativePaths.map((file) => String(file).replace(/\\/g, '/')))].sort();
  return Object.fromEntries(normalizedPaths.map((file) => [file, fileHash(join(baseDir, file))]));
}

/**
 * Build a full manifest snapshot from installed project files.
 */
export function buildManifest({ planningDir, frameworkVersion, runtimeHelperPaths = null, templateOwnership, adapterOwnership = null, adapterInventory = null }) {
  const runtimeHelpersDir = join(planningDir, 'bin');

  // Generation ownership is always source-derived by init/update. A fallback
  // directory snapshot would silently adopt consumer files on any mutation path.
  if (!templateOwnership?.templates || !templateOwnership?.roles) {
    throw new Error('Refusing to build generation manifest without explicit template ownership. Re-run init/update with validated template sources.');
  }

  const runtimeHelpersHashes = Array.isArray(runtimeHelperPaths)
    ? hashRelativeFiles(planningDir, runtimeHelperPaths)
    : hashDirectory(runtimeHelpersDir, planningDir);

  const manifest = {
    frameworkVersion,
    generatedAt: new Date().toISOString(),
    templates: {
      ...templateOwnership.templates,
    },
    roles: templateOwnership.roles,
    runtimeHelpers: runtimeHelpersHashes,
  };
  if (adapterOwnership) {
    manifest.adapterSources = adapterOwnership.adapterSources;
    manifest.adapterFiles = adapterOwnership.adapterFiles;
    if (adapterOwnership.adapterSelection) manifest.adapterSelection = adapterOwnership.adapterSelection;
    if (adapterInventory) manifest.adapterInventory = adapterInventory;
  }
  return manifest;
}

function pathIsInside(root, target) {
  const delta = relative(root, target);
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta));
}

function sourceRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

// Kept local to avoid making the manifest a second authority for adapter
// discovery. The registry remains the source of the target list; this list is
// only the immutable source inventory recorded in the existing manifest.
function adapterSourceHashes() {
  const root = sourceRoot();
  return Object.fromEntries(ADAPTER_SOURCE_FILES.map((source) => [source, fileHash(join(root, source.replace(/^bin[\\/]/, '')))]));
}

function adapterOwnershipEntries(manifest) {
  const files = manifest?.adapterFiles;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const entries = new Map();
  for (const [relativePath, value] of Object.entries(files)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.adapter !== 'string' || value.adapter.length === 0
      || typeof value.source !== 'string' || value.source.length === 0
      || !/^[a-f0-9]{64}$/.test(value.sourceHash)
      || !/^[a-f0-9]{64}$/.test(value.hash)) return null;
    entries.set(relativePath.replace(/\\/g, '/'), value);
  }
  return entries;
}

function adapterSourcePath(source) {
  if (typeof source !== 'string' || !ADAPTER_SOURCE_FILES.includes(source) && source !== 'bin/lib/init-flow.mjs') {
    throw new Error(`Refusing adapter update: ${source || 'an owned source'} is not a known Workspine adapter source.`);
  }
  const absolute = join(sourceRoot(), source.replace(/^bin[\\/]/, ''));
  if (!existsSync(absolute)) throw new Error(`Refusing adapter update: source ${source} is missing from this package.`);
  return absolute;
}

function adapterRecoveryIdentity(targetPath, oldHash, sourceHash) {
  return createHash('sha256').update(`${targetPath}\0${oldHash}\0${sourceHash}\0replace`).digest('hex');
}

function adapterRecoveryPaths(planningDir, stateDirName, targetPath, oldHash, sourceHash) {
  const identity = adapterRecoveryIdentity(targetPath, oldHash, sourceHash);
  const root = resolve(planningDir, '.local', 'template-recovery');
  return {
    root,
    bytes: join(root, `${identity}.original`),
    receipt: join(root, `${identity}.json`),
    relativeBytes: `${stateDirName}/.local/template-recovery/${identity}.original`,
  };
}

function assertSafeAdapterTarget(workspaceRoot, absolutePath, label) {
  const root = resolve(workspaceRoot);
  const target = resolve(absolutePath);
  if (!pathIsInside(root, target)) throw new Error(`Refusing adapter update: ${label} escapes the workspace root. Move it aside and retry.`);

  let current = root;
  const parentParts = relative(root, dirname(target)).split(sep).filter(Boolean);
  for (const part of parentParts) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing adapter update: ${label} parent must be a real directory.`);
    if (!pathIsInside(realpathSync(root), realpathSync(current))) throw new Error(`Refusing adapter update: ${label} parent resolves outside the workspace root.`);
  }

  let stat;
  try {
    // lstat deliberately sees dangling links; existsSync would incorrectly
    // classify them as missing and allow the generator to follow the link.
    stat = lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error(`Refusing adapter update: ${label} could not be inspected safely.`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing adapter update: ${label} must be a regular file.`);
  if (!pathIsInside(realpathSync(root), realpathSync(target))) throw new Error(`Refusing adapter update: ${label} resolves outside the workspace root.`);
}

/**
 * Read-only preflight for all local generated adapter/shared-skill targets.
 * No directory, recovery, manifest, or target bytes are written here.
 */
export function planAdapterGeneration({ cwd, planningDir, targets, manifest, stateDirName = '.work', requireManifest = false, requireExistingNativeTargets = false }) {
  const manifestPath = join(planningDir, MANIFEST_FILENAME);
  const hasManifest = existsSync(manifestPath);
  const ownership = adapterOwnershipEntries(manifest);
  if (requireManifest && (!hasManifest || !ownership || !manifest?.adapterSources || typeof manifest.adapterSources !== 'object' || Array.isArray(manifest.adapterSources))) {
    throw new Error('Refusing adapter update: generation manifest ownership is missing or corrupt. Re-run init to establish ownership, then retry.');
  }
  if (requireManifest && Array.isArray(manifest?.adapterSelection) && manifest?.adapterInventory && typeof manifest.adapterInventory === 'object') {
    const selectedAdapters = new Set(['shared-skills', ...manifest.adapterSelection]);
    for (const adapterName of selectedAdapters) {
      const inventory = manifest.adapterInventory[adapterName];
      if (!inventory || !Array.isArray(inventory.files)) {
        throw new Error(`Refusing adapter update: inventory for selected adapter ${adapterName} is missing or corrupt. Restore the manifest and retry.`);
      }
      for (const relativePath of inventory.files.map((file) => String(file).replace(/\\/g, '/'))) {
        if (!ownership.has(relativePath)) {
          throw new Error(`Refusing adapter update: ownership for selected target ${relativePath} is missing from the generation manifest. Restore the manifest and retry.`);
        }
      }
    }
  }
  const changes = [];
  const workspaceRoot = resolve(cwd);

  for (const target of targets) {
    const relativePath = String(target.relativePath).replace(/\\/g, '/');
    const absolutePath = resolve(workspaceRoot, relativePath);
    assertSafeAdapterTarget(workspaceRoot, absolutePath, relativePath);
    const targetExists = existsSync(absolutePath);
    if (!targetExists) {
      if (requireManifest && !ownership?.has(relativePath)) {
        throw new Error(`Refusing adapter update: ownership for missing target ${relativePath} is absent from the generation manifest. Restore the manifest and retry.`);
      }
      if (requireExistingNativeTargets && target.adapter !== 'shared-skills' && ownership?.has(relativePath)) {
        throw new Error(`Refusing adapter update: owned target ${relativePath} is missing. Restore it or re-run init to establish ownership.`);
      }
      continue;
    }

    const owned = ownership?.get(relativePath);
    if (!owned) {
      // A pre-existing AGENTS.md with the bounded marker is the one
      // compatibility case where init may extend a consumer file before the
      // first local manifest exists. The adapter's bounded upsert preserves
      // everything outside that marker; an unmarked file remains a collision.
      if (!hasManifest && target.adapter === 'agents') {
        const existing = readFileSync(absolutePath, 'utf-8');
        if (existing.includes('<!-- BEGIN GSDD -->') && existing.includes('<!-- END GSDD -->')) continue;
      }
      const reason = hasManifest
        ? 'is not generation-manifest-owned'
        : 'exists without a generation manifest';
      throw new Error(`Refusing adapter update: ${relativePath} ${reason}; move or rename the consumer file, then retry.`);
    }

    const source = target.source || owned.source;
    const sourcePath = adapterSourcePath(source);
    const currentSourceHash = fileHash(sourcePath);
    if (owned.source && owned.source !== source) {
      throw new Error(`Refusing adapter update: ${relativePath} has inconsistent source provenance. Restore the manifest entry and retry.`);
    }
    if (source !== 'bin/lib/init-flow.mjs' && (!manifest?.adapterSources || !Object.hasOwn(manifest.adapterSources, source))) {
      throw new Error(`Refusing adapter update: source provenance for ${source} is missing. Restore the manifest entry and retry.`);
    }
    if (manifest?.adapterSources?.[source] && !/^[a-f0-9]{64}$/.test(manifest.adapterSources[source])) {
      throw new Error(`Refusing adapter update: source provenance for ${source} is corrupt. Restore the manifest entry and retry.`);
    }
    const currentHash = fileHash(absolutePath);
    if (currentHash === owned.hash) continue;
    // Recovery records the source bytes that will actually replace the target,
    // never the stale source hash from the previous manifest generation.
    const sourceHash = currentSourceHash;
    const recovery = adapterRecoveryPaths(planningDir, stateDirName, relativePath, currentHash, sourceHash);
    for (const destination of [recovery.bytes, recovery.receipt]) {
      assertSafeAdapterTarget(workspaceRoot, destination, `recovery destination for ${relativePath}`);
      if (existsSync(destination)) {
        const stat = lstatSync(destination);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing adapter update: conflicting recovery for ${relativePath}. Preserve the existing recovery and retry.`);
      }
    }
    const originalBytes = readFileSync(absolutePath);
    const receipt = Buffer.from(JSON.stringify({
      targetPath: relativePath,
      action: 'replace',
      oldHash: currentHash,
      newHash: sourceHash,
      recoveryPath: recovery.relativeBytes,
    }, null, 2));
    if (existsSync(recovery.bytes) && !readFileSync(recovery.bytes).equals(originalBytes)) {
      throw new Error(`Refusing adapter update: conflicting recovery bytes for ${relativePath}. Preserve the existing recovery and retry.`);
    }
    if (existsSync(recovery.receipt) && !readFileSync(recovery.receipt).equals(receipt)) {
      throw new Error(`Refusing adapter update: conflicting recovery receipt for ${relativePath}. Preserve the existing recovery and retry.`);
    }
    changes.push({ relativePath, absolutePath, originalBytes, recovery, receipt });
  }

  return { changes, targets, ownership };
}

/** Persist byte-exact recovery evidence after a successful preflight. */
export function applyAdapterRecovery(plan, { isDry = false } = {}) {
  if (isDry) return;
  for (const change of plan.changes) {
    if (!existsSync(change.recovery.root)) mkdirSync(change.recovery.root, { recursive: true });
    if (!existsSync(change.recovery.bytes)) writeFileAtomic(change.recovery.bytes, change.originalBytes);
    if (!existsSync(change.recovery.receipt)) writeFileAtomic(change.recovery.receipt, change.receipt);
    if (!readFileSync(change.recovery.bytes).equals(change.originalBytes) || !readFileSync(change.recovery.receipt).equals(change.receipt)) {
      throw new Error(`Refusing adapter update: recovery verification failed for ${change.relativePath}. No adapter was replaced.`);
    }
  }
}

/** Build the adapter ownership projection from the registry's explicit targets. */
export function buildAdapterOwnership({ cwd, planningDir, targets, existingManifest = null, selectedPlatforms = [] }) {
  const existing = adapterOwnershipEntries(existingManifest) ?? new Map();
  const selected = new Set(
    Array.isArray(existingManifest?.adapterSelection)
      ? existingManifest.adapterSelection.filter((name) => typeof name === 'string')
      : [...existing].map(([, value]) => value?.adapter).filter((name) => typeof name === 'string'),
  );
  for (const platform of selectedPlatforms) selected.add(platform);
  selected.add('shared-skills');
  // Start from the validated existing ownership map. A scoped update only
  // reconciles its explicit targets; dropping the other entries would make
  // the next scoped update fail closed as an unowned collision.
  const files = Object.fromEntries(existing.entries());
  for (const target of targets) {
    const relativePath = String(target.relativePath).replace(/\\/g, '/');
    const absolutePath = resolve(cwd, relativePath);
    if (!existsSync(absolutePath)) continue;
    const prior = existing.get(relativePath);
    if (!selected.has(target.adapter) && prior) {
      files[relativePath] = prior;
      continue;
    }
    const source = target.source || 'bin/adapters/index.mjs';
    const sourceHash = target.sourceHash || fileHash(join(sourceRoot(), source.replace(/^bin[\\/]/, '')));
    files[relativePath] = {
      adapter: target.adapter,
      source,
      sourceHash,
      hash: fileHash(absolutePath),
    };
  }
  return {
    adapterSources: adapterSourceHashes(),
    adapterFiles: files,
    adapterSelection: [...selected].filter((name) => name !== 'shared-skills').sort(),
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
  writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
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
