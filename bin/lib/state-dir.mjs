import { lstatSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

export const STATE_DIR_NAME = '.work';
export const LEGACY_STATE_DIR_NAME = '.planning';
export const LEGACY_SIGNATURE = 'S2-config-v1';
export const LEGACY_ADOPTION_SIGNATURE = 'GSD-roadmap-v1';
export const MIGRATION_COMMAND = 'npx -y workspine init --migrate';
export const ADOPTION_COMMAND = 'npx -y workspine init --adopt-legacy';

function lstatIfPresent(filePath, lstat = lstatSync) {
  try {
    return lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function findLinkedEntry(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) return entryPath;
    if (stat.isDirectory()) {
      const linked = findLinkedEntry(entryPath);
      if (linked) return linked;
    }
  }
  return null;
}

function inspectLegacyState(legacyDir, legacyStat) {
  if (legacyStat.isSymbolicLink()) return { reason: 'linked_legacy_root' };
  if (!legacyStat.isDirectory()) return { reason: 'invalid_legacy_root' };

  try {
    if (findLinkedEntry(legacyDir)) return { reason: 'linked_legacy_entry' };
  } catch {
    return { reason: 'unreadable_legacy_tree' };
  }

  const configPath = join(legacyDir, 'config.json');
  let configStat;
  try {
    configStat = lstatIfPresent(configPath);
  } catch {
    return { reason: 'unreadable_config' };
  }
  if (!configStat) return { reason: 'missing_config' };
  if (configStat.isSymbolicLink() || !configStat.isFile()) return { reason: 'invalid_config_file' };

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { reason: 'malformed_config' };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { reason: 'invalid_config_object' };
  }
  if (config.initVersion !== 'v1.1') {
    return { reason: 'unsupported_init_version', detectedInitVersion: config.initVersion ?? null, initVersionPresent: Object.hasOwn(config, 'initVersion') };
  }

  const receiptStat = lstatIfPresent(join(legacyDir, 'migration-receipt.json'));
  if (receiptStat) return { reason: 'migration_receipt_exists' };

  const decisionsStat = lstatIfPresent(join(legacyDir, 'decisions'));
  if (decisionsStat && (!decisionsStat.isDirectory() || readdirSync(join(legacyDir, 'decisions')).length > 0)) {
    return { reason: 'nonempty_legacy_decisions' };
  }
  return {
    signature: LEGACY_SIGNATURE,
    detectedInitVersion: config.initVersion,
  };
}

// A historic roadmap-style .planning/ can be preserved without treating its
// unrecognized lifecycle as executable Workspine state. Unknown initVersion
// values belong to some other schema and must still refuse.
function inspectLegacyAdoption(legacyDir, legacy) {
  if (!['missing_config', 'unsupported_init_version'].includes(legacy.reason)
    || (legacy.reason === 'unsupported_init_version' && legacy.initVersionPresent)) return null;
  // A former Workspine migration or remembered decision store has distinct
  // authority. Its missing/partial config cannot downgrade that to GSD history.
  try {
    if (lstatIfPresent(join(legacyDir, 'migration-receipt.json'))) return null;
    const decisions = lstatIfPresent(join(legacyDir, 'decisions'));
    if (decisions && (!decisions.isDirectory() || decisions.isSymbolicLink()
      || readdirSync(join(legacyDir, 'decisions')).length > 0)) return null;
  } catch {
    return null;
  }
  for (const name of ['SPEC.md', 'ROADMAP.md']) {
    const filePath = join(legacyDir, name);
    let stat;
    try { stat = lstatIfPresent(filePath); } catch { return null; }
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size === 0) return null;
    try { if (!readFileSync(filePath, 'utf8').trim()) return null; } catch { return null; }
  }
  return { signature: LEGACY_ADOPTION_SIGNATURE };
}

export function hasStateMarker(root, { lstat = lstatSync } = {}) {
  const workspaceRoot = resolve(root);
  const workStat = lstatIfPresent(join(workspaceRoot, STATE_DIR_NAME), lstat);
  const legacyStat = lstatIfPresent(join(workspaceRoot, LEGACY_STATE_DIR_NAME), lstat);
  return Boolean(workStat || legacyStat);
}

export function resolveStateDir(root) {
  const workspaceRoot = resolve(root);
  const workDir = join(workspaceRoot, STATE_DIR_NAME);
  const legacyDir = join(workspaceRoot, LEGACY_STATE_DIR_NAME);
  const workStat = lstatIfPresent(workDir);
  const legacyStat = lstatIfPresent(legacyDir);
  const base = {
    root: workspaceRoot,
    dir: workDir,
    name: STATE_DIR_NAME,
    legacy: false,
    legacyDir,
    workExists: Boolean(workStat),
    legacyExists: Boolean(legacyStat),
    migrationNotice: null,
  };

  if (workStat && legacyStat) {
    return { ...base, status: 'dual_conflict', action: 'refuse', reason: 'both_state_roots_exist' };
  }
  if (workStat) {
    if (workStat.isSymbolicLink()) {
      return { ...base, status: 'current_unsafe', action: 'refuse', reason: 'linked_current_root' };
    }
    if (!workStat.isDirectory()) {
      return { ...base, status: 'current_unsafe', action: 'refuse', reason: 'invalid_current_root' };
    }
    return { ...base, status: 'current', action: 'use_current' };
  }
  if (!legacyStat) return { ...base, status: 'fresh', action: 'use_current' };

  const legacy = inspectLegacyState(legacyDir, legacyStat);
  if (legacy.signature === LEGACY_SIGNATURE) {
    return {
      ...base,
      ...legacy,
      status: 'legacy_migratable',
      action: 'migrate',
      migrationNotice: `Legacy .planning/ state requires migration. Run \`${MIGRATION_COMMAND}\`.`,
    };
  }
  const adoption = inspectLegacyAdoption(legacyDir, legacy);
  if (adoption) {
    return {
      ...base,
      ...legacy,
      ...adoption,
      status: 'legacy_adoptable',
      action: 'adopt',
      adoptionNotice: `Historic .planning/ has a different lifecycle. Run \`${ADOPTION_COMMAND}\` to archive its bytes privately and initialize a new .work/ root.`,
    };
  }
  return { ...base, ...legacy, status: 'legacy_unsupported', action: 'refuse' };
}

export function stateAuthorityGate(state) {
  if (state.status === 'fresh' || state.status === 'current') {
    return { allowed: true, status: state.status, message: null };
  }
  if (state.status === 'legacy_migratable') {
    return {
      allowed: false,
      status: state.status,
      message: `Legacy .planning/ state is not an active Workspine root. Run \`${MIGRATION_COMMAND}\`.`,
    };
  }
  if (state.status === 'legacy_adoptable') {
    return { allowed: false, status: state.status, message: state.adoptionNotice };
  }
  if (state.status === 'dual_conflict') {
    return {
      allowed: false,
      status: state.status,
      message: 'Both `.work/` and `.planning/` exist. Refusing split-root state. Resolve the two roots manually so only one remains; Workspine will not merge or delete either root.',
    };
  }
  if (state.status === 'current_unsafe') {
    return {
      allowed: false,
      status: state.status,
      message: 'Current `.work/` state root must be a real directory inside this workspace. Preserve any linked or colliding target bytes, replace `.work/` with a real local directory, then rerun health.',
    };
  }
  return {
    allowed: false,
    status: state.status,
    message: `Legacy .planning/ state is unsupported (${state.reason}). Preserve its bytes and reconcile this historical layout explicitly; Workspine will not adopt or overwrite unknown lifecycle state.`,
  };
}

export function assertStateAuthority(stateOrRoot) {
  const state = typeof stateOrRoot === 'string' ? resolveStateDir(stateOrRoot) : stateOrRoot;
  const gate = stateAuthorityGate(state);
  if (!gate.allowed) {
    const error = new Error(gate.message);
    error.code = 'state_authority_blocked';
    error.state = state;
    throw error;
  }
  return state;
}
