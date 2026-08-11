import { createHash } from 'crypto';
import { lstatSync, readFileSync, readdirSync, renameSync } from 'fs';
import { join, relative } from 'path';
import { writeFileAtomic } from './atomic-write.mjs';
import { LEGACY_SIGNATURE, resolveStateDir } from './state-dir.mjs';

function normalizedRelative(root, filePath) {
  return relative(root, filePath).replace(/\\/g, '/');
}

function collectEntries(root, directory = root, entries = []) {
  const children = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const child of children) {
    const filePath = join(directory, child.name);
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked legacy entry: ${normalizedRelative(root, filePath)}`);
    const entryPath = normalizedRelative(root, filePath);
    if (stat.isDirectory()) {
      entries.push({ path: `${entryPath}/`, type: 'directory' });
      collectEntries(root, filePath, entries);
    } else if (stat.isFile()) {
      const bytes = readFileSync(filePath);
      entries.push({
        path: entryPath,
        type: 'file',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } else {
      throw new Error(`Refusing unsupported legacy entry: ${entryPath}`);
    }
  }
  return entries;
}

export function digestLegacyTree(legacyDir) {
  const entries = collectEntries(legacyDir);
  const digestInput = entries.map((entry) => JSON.stringify(entry)).join('\n');
  return {
    entryCount: entries.length,
    sha256: createHash('sha256').update(digestInput).digest('hex'),
    entries,
  };
}

export function migrateLegacyState(root, {
  now = new Date(),
  rename = renameSync,
  writeReceipt = writeFileAtomic,
} = {}) {
  const state = resolveStateDir(root);
  if (state.status !== 'legacy_migratable' || state.signature !== LEGACY_SIGNATURE) {
    throw new Error(`Legacy state is not migratable (${state.status}${state.reason ? `: ${state.reason}` : ''}).`);
  }

  const digest = digestLegacyTree(state.legacyDir);
  const receipt = {
    schema_version: 1,
    signature: LEGACY_SIGNATURE,
    source: '.planning',
    destination: '.work',
    detected_init_version: state.detectedInitVersion,
    pre_migration_entry_count: digest.entryCount,
    pre_migration_tree_sha256: digest.sha256,
    migrated_at: now.toISOString(),
    method: 'same-parent-rename',
  };
  const receiptPath = join(state.dir, 'migration-receipt.json');

  rename(state.legacyDir, state.dir);
  try {
    writeReceipt(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    try {
      rename(state.dir, state.legacyDir);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Migration receipt failed and rollback could not restore .planning/.');
    }
    throw error;
  }

  return { receipt, receiptPath, state: resolveStateDir(root) };
}
