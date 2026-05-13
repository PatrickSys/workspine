// registry.mjs - Worktree Coordination Registry (Track C: JSON + atomic rename)
//
// Stores per-phase lease state in .planning/.local/registry.json.
// Uses only node:fs, node:path built-ins. Zero external deps.
//
// Write pattern: writeFileSync(.json.<pid>.tmp) then renameSync(.json.<pid>.tmp -> .json)
// for atomicity. No separate lock file. Per-PID tmp filenames eliminate the
// .tmp truncation race between concurrent CLI invocations; the final
// renameSync is last-writer-wins (lost-update semantics in the absence of
// locking — diagnosed via the read-after-write fingerprint warning below).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Path helpers (exported so closeout-report, tests, and future callers do not
// duplicate the path string).
// ---------------------------------------------------------------------------

export function registryPath(workspaceRoot) {
  return join(workspaceRoot, '.planning', '.local', 'registry.json');
}

export function registryTmpPath(workspaceRoot) {
  return join(workspaceRoot, '.planning', '.local', `registry.json.${process.pid}.tmp`);
}

export function registryExists(workspaceRoot) {
  return existsSync(registryPath(workspaceRoot));
}

function emptyRegistry() {
  return { schema_version: 1, leases: [] };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function quarantineCorruptFile(p, reason) {
  try {
    const broken = `${p}.broken-${Date.now()}`;
    renameSync(p, broken);
    process.stderr.write(
      `[gsdd registry] WARN: registry corrupt (${reason}); quarantined to ${broken}; starting fresh.\n`,
    );
  } catch {
    process.stderr.write(
      `[gsdd registry] WARN: registry corrupt (${reason}); quarantine rename failed; starting fresh.\n`,
    );
  }
}

function readRegistry(workspaceRoot) {
  const p = registryPath(workspaceRoot);
  if (!existsSync(p)) return emptyRegistry();
  let raw;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    quarantineCorruptFile(p, `parse error: ${err.message}`);
    return emptyRegistry();
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.leases)) {
    quarantineCorruptFile(p, 'shape invalid (leases is not an array)');
    return emptyRegistry();
  }
  return raw;
}

// safeRename — wraps renameSync with bounded retry for Windows EPERM/EBUSY,
// which fires when another process holds an open handle to the destination
// (e.g. a concurrent closeout-report read). Linux/macOS get a single attempt.
function safeRename(src, dst) {
  const isWindows = process.platform === 'win32';
  const maxAttempts = isWindows ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      const retriable = err && (err.code === 'EPERM' || err.code === 'EBUSY');
      if (!retriable || attempt === maxAttempts - 1) throw err;
      const deadline = Date.now() + 50;
      while (Date.now() < deadline) {
        // brief synchronous backoff; CLI context — acceptable
      }
    }
  }
}

function writeRegistry(workspaceRoot, data) {
  const target = registryPath(workspaceRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = registryTmpPath(workspaceRoot);
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  safeRename(tmp, target);

  // Read-after-write fingerprint warning: if a concurrent writer overwrote
  // our just-published registry, the lease count will not match what we
  // intended to publish. This is diagnostic only — last-writer-wins semantics
  // remain. The warning gives operators a visible signal that concurrent
  // writers raced and one of them lost.
  try {
    const reread = JSON.parse(readFileSync(target, 'utf8'));
    if (
      reread &&
      Array.isArray(reread.leases) &&
      reread.leases.length !== data.leases.length
    ) {
      process.stderr.write(
        `[gsdd registry] WARN: write-collision suspected — re-read shows ${reread.leases.length} leases; we wrote ${data.leases.length}. Another process may have published a conflicting state concurrently.\n`,
      );
    }
  } catch {
    // best-effort — silent on re-read errors (the write itself succeeded)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * openRegistry — ensure the registry directory and file exist on disk.
 * Returns a minimal handle for forward-compat (callers are not required to use it).
 * @param {string} workspaceRoot
 * @returns {{ path: string }}
 */
export function openRegistry(workspaceRoot) {
  const p = registryPath(workspaceRoot);
  mkdirSync(dirname(p), { recursive: true });
  if (!existsSync(p)) writeRegistry(workspaceRoot, emptyRegistry());
  return { path: p };
}

/**
 * grantLease — append a new lease with lease_state "open".
 * Throws if phase_id already has an open lease.
 *
 * Schema note: the `write_set` field is populated by P65 callers but the
 * advisory-layer logic that consumes it (overlap detection, plan-checker
 * integration) is owned by P69 (PARALLEL-03). P65 ships only the schema seam.
 *
 * Schema note: the `provenance_hash` field is reserved for SHA-256 of the
 * phase plan file at grant time; it stays null until a future phase wires
 * plan-file integrity checking. Keeping the field costs one JSON key per
 * lease and prevents a schema bump when integrity is added.
 *
 * @param {string} workspaceRoot
 * @param {{ phase_id: string, worktree_path?: string, agent_id?: string|null, branch_name?: string, write_set?: string[], provenance_hash?: string|null }} fields
 * @returns {object} the newly created lease
 */
export function grantLease(workspaceRoot, fields) {
  const {
    phase_id,
    worktree_path = '',
    agent_id = null,
    branch_name = '',
    write_set = [],
    provenance_hash = null,
  } = fields || {};

  if (!phase_id) throw new Error('grantLease: phase_id is required');

  const data = readRegistry(workspaceRoot);

  const existing = data.leases.find(
    (l) => l.phase_id === phase_id && l.lease_state === 'open',
  );
  if (existing) {
    throw new Error(
      `grantLease: phase ${phase_id} already has an open lease (granted_at ${existing.granted_at})`,
    );
  }

  const lease = {
    phase_id,
    worktree_path,
    agent_id,
    branch_name,
    lease_state: 'open',
    granted_at: new Date().toISOString(),
    closed_at: null,
    crashed_at: null,
    crash_reason: null,
    write_set,
    provenance_hash,
  };

  data.leases.push(lease);
  writeRegistry(workspaceRoot, data);
  return lease;
}

/**
 * closeLease — transition lease to "closed" and record closed_at.
 * Throws if no lease found for phase_id, or if the most recent lease for
 * phase_id is not in state "open" (audit-trail integrity: do not silently
 * re-stamp already-closed or crashed leases).
 * @param {string} workspaceRoot
 * @param {string} phase_id
 * @returns {object} the updated lease
 */
export function closeLease(workspaceRoot, phase_id) {
  const data = readRegistry(workspaceRoot);

  const idx = data.leases.findLastIndex((l) => l.phase_id === phase_id);
  if (idx === -1) {
    throw new Error(`closeLease: no lease found for phase ${phase_id}`);
  }

  const lease = data.leases[idx];
  if (lease.lease_state !== 'open') {
    throw new Error(
      `closeLease: phase ${phase_id} has lease_state "${lease.lease_state}", expected "open"`,
    );
  }

  data.leases[idx] = {
    ...lease,
    lease_state: 'closed',
    closed_at: new Date().toISOString(),
  };

  writeRegistry(workspaceRoot, data);
  return data.leases[idx];
}

/**
 * crashLease — transition lease to "crashed" and record crash_reason and crashed_at.
 * Stubbed at P65; wired by `gsdd registry-crash <phase> --reason <text>` in P66.
 * Throws if no lease found for phase_id.
 * @param {string} workspaceRoot
 * @param {string} phase_id
 * @param {string} reason
 * @returns {object} the updated lease
 */
export function crashLease(workspaceRoot, phase_id, reason) {
  const data = readRegistry(workspaceRoot);

  const idx = data.leases.findLastIndex((l) => l.phase_id === phase_id);
  if (idx === -1) {
    throw new Error(`crashLease: no lease found for phase ${phase_id}`);
  }

  data.leases[idx] = {
    ...data.leases[idx],
    lease_state: 'crashed',
    crashed_at: new Date().toISOString(),
    crash_reason: reason || null,
  };

  writeRegistry(workspaceRoot, data);
  return data.leases[idx];
}

/**
 * listLeases — return the leases array, or [] if no registry file exists.
 * @param {string} workspaceRoot
 * @returns {object[]}
 */
export function listLeases(workspaceRoot) {
  return readRegistry(workspaceRoot).leases;
}

/**
 * getLease — return the single lease object for phase_id, or null if not found.
 * Returns the last matching lease if multiple exist (e.g. re-granted after close).
 * @param {string} workspaceRoot
 * @param {string} phase_id
 * @returns {object|null}
 */
export function getLease(workspaceRoot, phase_id) {
  const matches = readRegistry(workspaceRoot).leases.filter((l) => l.phase_id === phase_id);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * clearLease — remove the most recent lease entry for phase_id.
 * Throws if lease_state is "open" and force is false.
 * Throws if no lease found for phase_id.
 * @param {string} workspaceRoot
 * @param {string} phase_id
 * @param {{ force?: boolean }} options
 */
export function clearLease(workspaceRoot, phase_id, { force = false } = {}) {
  const data = readRegistry(workspaceRoot);

  const idx = data.leases.findLastIndex((l) => l.phase_id === phase_id);
  if (idx === -1) {
    throw new Error(`clearLease: no lease found for phase ${phase_id}`);
  }

  const lease = data.leases[idx];
  if (lease.lease_state === 'open' && !force) {
    throw new Error(
      `clearLease: phase ${phase_id} has an open lease. Use --force to clear it.`,
    );
  }

  data.leases.splice(idx, 1);
  writeRegistry(workspaceRoot, data);
}
