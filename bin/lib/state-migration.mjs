import { createHash } from 'crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { writeFileAtomic } from './atomic-write.mjs';
import { LEGACY_ADOPTION_SIGNATURE, LEGACY_SIGNATURE, resolveStateDir } from './state-dir.mjs';

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

// Explicit first-use adoption preserves the old GSD tree as local historical
// evidence. Nothing from its unknown PLAN/ROADMAP becomes active Workspine
// authority, and the old .planning root disappears only after a safe rename.
export function adoptLegacyState(root, {
  now = new Date(),
  rename = renameSync,
  writeReceipt = writeFileAtomic,
} = {}) {
  const state = resolveStateDir(root);
  if (state.status !== 'legacy_adoptable' || state.signature !== LEGACY_ADOPTION_SIGNATURE) {
    throw new Error(`Legacy state is not adoptable (${state.status}${state.reason ? `: ${state.reason}` : ''}).`);
  }
  const digest = digestLegacyTree(state.legacyDir);
  const receipt = {
    schema_version: 1,
    signature: LEGACY_ADOPTION_SIGNATURE,
    source: '.planning',
    archive: '.work/.local/legacy-planning',
    destination: '.work',
    status: 'historical_input_only',
    pre_adoption_entry_count: digest.entryCount,
    pre_adoption_tree_sha256: digest.sha256,
    adopted_at: now.toISOString(),
    method: 'staged-same-parent-rename',
    next_action: 'Review the archived historical SPEC/ROADMAP, then explicitly plan selected work in the new .work/ authority.',
  };
  const stagingRoot = mkdtempSync(join(state.root, '.work-adoption-'));
  const localDir = join(stagingRoot, '.local');
  const archive = join(localDir, 'legacy-planning');
  const ignorePath = join(localDir, '.gitignore');
  const stagedReceipt = join(stagingRoot, 'adoption-receipt.json');
  let moved = false;
  let activated = false;
  try {
    mkdirSync(localDir);
    // Nested ignore protection applies even before generated root .gitignore
    // settings exist and after a partially completed init.
    writeFileSync(ignorePath, '*\n!.gitignore\n', { flag: 'wx' });
    rename(state.legacyDir, archive);
    moved = true;
    const retained = digestLegacyTree(archive);
    if (retained.sha256 !== digest.sha256 || retained.entryCount !== digest.entryCount) {
      throw new Error('Historical legacy content changed during adoption; source restored without establishing .work authority.');
    }
    writeReceipt(stagedReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
    // Recheck after the receipt writer: an owner's concurrent edit during
    // that synchronous callback must remain historical source data rather
    // than yield a receipt that falsely seals the earlier archive digest.
    // This narrows the known window; it is not a lock against a separate
    // process changing bytes after the final check.
    const finalRetained = digestLegacyTree(archive);
    if (finalRetained.sha256 !== digest.sha256 || finalRetained.entryCount !== digest.entryCount) {
      throw new Error('Historical legacy content changed during adoption; source restored without establishing .work authority.');
    }
    const concurrentState = resolveStateDir(state.root);
    if (concurrentState.workExists || concurrentState.legacyExists) {
      throw new Error('Workspine or a competing legacy root appeared during adoption; refusing split authority.');
    }
    rename(stagingRoot, state.dir);
    activated = true;
  } catch (error) {
    if (moved && !activated) {
      try { rename(archive, state.legacyDir); moved = false; }
      catch (restorationError) {
        throw new AggregateError([error, restorationError], 'Adoption failed and the retained staging archive could not be restored.');
      }
    }
    if (!activated) {
      // Only our own empty staging entries can be removed. If another process
      // added anything, leave the stage for recovery instead of deleting it.
      try { rmSync(stagedReceipt); } catch (cause) { if (cause.code !== 'ENOENT') throw new AggregateError([error, cause], 'Adoption staging cleanup failed.'); }
      try { rmSync(ignorePath); } catch (cause) { if (cause.code !== 'ENOENT') throw new AggregateError([error, cause], 'Adoption staging cleanup failed.'); }
      try { rmdirSync(localDir); } catch (cause) { if (cause.code !== 'ENOENT') throw new AggregateError([error, cause], 'Adoption staging cleanup failed.'); }
      rmdirSync(stagingRoot);
    }
    throw error;
  }
  return { receipt, receiptPath: join(state.dir, 'adoption-receipt.json'), state: resolveStateDir(state.root) };
}
