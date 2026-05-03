// session-fingerprint.mjs — Planning state drift detection
//
// Computes a SHA-256 fingerprint from the combined contents of ROADMAP.md,
// SPEC.md, and config.json. When the fingerprint stored in
// .planning/.state-fingerprint.json no longer matches the live files, the
// preflight and health systems can warn that planning state drifted since
// the last recorded session.
//
// The fingerprint file is session-local and gitignored by convention.

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { output } from './cli-utils.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

const FINGERPRINT_FILE = '.state-fingerprint.json';
const FINGERPRINT_SOURCES = ['ROADMAP.md', 'SPEC.md', 'config.json'];
const FINGERPRINT_SCHEMA_VERSION = 2;
const FINGERPRINT_ALGORITHM = 'sha256:v2:exists-content';

/**
 * Compute a SHA-256 fingerprint from the planning truth files.
 * Missing files contribute an empty string (so a newly created file
 * registers as drift).
 */
export function computeFingerprint(planningDir) {
  const hash = createHash('sha256');
  const sources = {};
  const files = {};
  for (const file of FINGERPRINT_SOURCES) {
    const filePath = join(planningDir, file);
    const exists = existsSync(filePath);
    const content = exists ? readFileSync(filePath, 'utf-8') : '';
    hash.update(`${file}:${exists ? 'exists' : 'missing'}:${content}\n`);
    sources[file] = exists;
    files[file] = {
      exists,
      hash: createHash('sha256').update(content).digest('hex'),
    };
  }
  return { hash: hash.digest('hex'), sources, files };
}

function computeLegacyFingerprint(planningDir) {
  const hash = createHash('sha256');
  const sources = {};
  for (const file of FINGERPRINT_SOURCES) {
    const filePath = join(planningDir, file);
    const exists = existsSync(filePath);
    const content = exists ? readFileSync(filePath, 'utf-8') : '';
    hash.update(`${file}:${content}\n`);
    sources[file] = exists;
  }
  return { hash: hash.digest('hex'), sources };
}

export function cmdSessionFingerprint(...args) {
  const { args: normalizedArgs, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }

  const [action, ...flags] = normalizedArgs;
  if (action !== 'write') {
    console.error('Usage: node .planning/bin/gsdd.mjs session-fingerprint write [--allow-changed <ROADMAP.md,SPEC.md,config.json>]');
    process.exitCode = 1;
    return;
  }

  const allowChanged = parseAllowChanged(flags);
  if (allowChanged.invalid) {
    console.error('Usage: node .planning/bin/gsdd.mjs session-fingerprint write [--allow-changed <ROADMAP.md,SPEC.md,config.json>]');
    process.exitCode = 1;
    return;
  }

  if (allowChanged.files.length > 0) {
    const drift = checkDrift(planningDir);
    const changedFiles = drift.files.filter((file) => file.status !== 'unchanged').map((file) => file.file);
    const unexpected = changedFiles.filter((file) => !allowChanged.files.includes(file));
    if (unexpected.length > 0) {
      output({
        operation: 'session-fingerprint write',
        changedFiles,
        allowedChanged: allowChanged.files,
        written: false,
        reason: 'unexpected_planning_drift',
        unexpected,
      });
      process.exitCode = 1;
      return;
    }
  }

  output({ operation: 'session-fingerprint write', fingerprint: writeFingerprint(planningDir) });
}

function parseAllowChanged(flags) {
  const files = [];
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] !== '--allow-changed') return { invalid: true, files: [] };
    const value = flags[index + 1];
    if (!value || value.startsWith('--')) return { invalid: true, files: [] };
    files.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
    index += 1;
  }
  for (const file of files) {
    if (!FINGERPRINT_SOURCES.includes(file)) return { invalid: true, files: [] };
  }
  return { invalid: false, files: [...new Set(files)] };
}

/**
 * Read the stored fingerprint from .planning/.state-fingerprint.json.
 * Returns null if the file does not exist or is unparseable.
 */
export function readStoredFingerprint(planningDir) {
  const filePath = join(planningDir, FINGERPRINT_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write the current fingerprint to .planning/.state-fingerprint.json.
 */
export function writeFingerprint(planningDir) {
  const { hash, sources, files } = computeFingerprint(planningDir);
  const data = {
    schemaVersion: FINGERPRINT_SCHEMA_VERSION,
    algorithm: FINGERPRINT_ALGORITHM,
    hash,
    sources,
    files,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(join(planningDir, FINGERPRINT_FILE), JSON.stringify(data, null, 2) + '\n');
  return data;
}

/**
 * Check whether the current planning state has drifted from the stored
 * fingerprint. Returns { drifted, details, stored, current }.
 *
 * If no stored fingerprint exists, returns drifted: false with a note
 * that no baseline was found (first session after adoption).
 */
export function checkDrift(planningDir) {
  const stored = readStoredFingerprint(planningDir);
  const { hash: currentHash, sources: currentSources, files: currentFiles } = computeFingerprint(planningDir);

  if (!stored) {
    return {
      drifted: false,
      noBaseline: true,
      classification: 'no_baseline',
      details: ['No stored fingerprint found — first session or fingerprint was cleared.'],
      stored: null,
      current: { hash: currentHash, sources: currentSources, files: currentFiles },
      files: [],
    };
  }

  const isLegacy = !stored.schemaVersion && !stored.files;
  const comparison = isLegacy ? computeLegacyFingerprint(planningDir) : { hash: currentHash };
  const drifted = stored.hash !== comparison.hash;
  const details = [];
  const files = drifted
    ? FINGERPRINT_SOURCES.map((file) => classifyFileDrift(file, stored, currentSources, currentFiles, { legacy: isLegacy }))
    : FINGERPRINT_SOURCES.map((file) => ({ file, status: 'unchanged' }));
  if (drifted) {
    for (const file of files) {
      if (file.status === 'created') details.push(`${file.file} created`);
      else if (file.status === 'removed') details.push(`${file.file} removed`);
      else if (file.status === 'changed') details.push(`${file.file} changed`);
      else if (file.status === 'unknown') details.push(`${file.file} may have changed`);
    }
    if (details.length === 0) {
      details.push('Planning state hash changed since last recorded session.');
    }
  }

  return {
    drifted,
    noBaseline: false,
    classification: drifted ? 'planning_state_drift' : 'clean',
    compatibility: isLegacy ? 'legacy_v1' : null,
    needsBaselineRefresh: isLegacy && !drifted,
    details,
    files,
    stored: {
      hash: stored.hash,
      timestamp: stored.timestamp,
      schemaVersion: stored.schemaVersion ?? null,
      algorithm: stored.algorithm ?? null,
      files: stored.files ?? null,
    },
    current: { hash: currentHash, sources: currentSources, files: currentFiles },
  };
}

function classifyFileDrift(file, stored, currentSources, currentFiles, { legacy = false } = {}) {
  const was = stored.sources?.[file] ?? false;
  const now = currentSources[file];

  if (was && !now) return { file, status: 'removed' };
  if (!was && now) return { file, status: 'created' };
  if (!was && !now) return { file, status: 'unchanged' };
  if (legacy) return { file, status: 'unknown' };

  const storedFile = stored.files?.[file];
  if (!storedFile?.hash) return { file, status: 'unknown' };
  return {
    file,
    status: storedFile.hash === currentFiles[file].hash ? 'unchanged' : 'changed',
  };
}
