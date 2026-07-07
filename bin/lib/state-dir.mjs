// state-dir.mjs — Single source of truth for the Workspine state directory.
//
// Workspine keeps everything in ONE folder: .work/. Older projects used
// .planning/. This module is the only place that decides which folder the tool
// reads and writes for a given repo root. No other module may hardcode the name.

import { existsSync } from 'fs';
import { join } from 'path';

export const STATE_DIR_NAME = '.work';
export const LEGACY_STATE_DIR_NAME = '.planning';

export const MIGRATION_NOTICE =
  'Note: reading legacy .planning/ — new Workspine projects use .work/. Your .planning/ still works; move its files under .work/ when convenient.';

// True when a repo root already holds Workspine state in EITHER the current
// (.work) or legacy (.planning) location. Used for workspace-root discovery.
export function hasStateMarker(root) {
  return (
    existsSync(join(root, STATE_DIR_NAME, 'config.json')) ||
    existsSync(join(root, STATE_DIR_NAME)) ||
    existsSync(join(root, LEGACY_STATE_DIR_NAME, 'config.json')) ||
    existsSync(join(root, LEGACY_STATE_DIR_NAME))
  );
}

// Decide which state directory to use for a repo root.
// Precedence (config.json is the "really initialized" marker):
//   1. .work/config.json     -> .work     (migration done / new project)
//   2. .planning/config.json -> .planning (legacy; dual-read + notice)
//   3. .work/ dir            -> .work
//   4. .planning/ dir        -> .planning (legacy; dual-read + notice)
//   5. neither               -> .work     (brand-new repo default)
export function resolveStateDir(root) {
  const workDir = join(root, STATE_DIR_NAME);
  const legacyDir = join(root, LEGACY_STATE_DIR_NAME);
  const work = { dir: workDir, name: STATE_DIR_NAME, legacy: false, migrationNotice: null };
  const legacy = { dir: legacyDir, name: LEGACY_STATE_DIR_NAME, legacy: true, migrationNotice: MIGRATION_NOTICE };

  if (existsSync(join(workDir, 'config.json'))) return work;
  if (existsSync(join(legacyDir, 'config.json'))) return legacy;
  if (existsSync(workDir)) return work;
  if (existsSync(legacyDir)) return legacy;
  return work;
}
