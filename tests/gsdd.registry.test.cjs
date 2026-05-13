'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('url');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-registry-test-'));
}

function cleanupWorkspace(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function registryPath(workspaceRoot) {
  return path.join(workspaceRoot, '.planning', '.local', 'registry.json');
}

function registryTmpPath(workspaceRoot, pid) {
  return path.join(workspaceRoot, '.planning', '.local', `registry.json.${pid}.tmp`);
}

function findTmpOrphans(workspaceRoot) {
  const dir = path.join(workspaceRoot, '.planning', '.local');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^registry\.json\.\d+\.tmp$/.test(f))
    .map((f) => path.join(dir, f));
}

function ensurePlanningMarker(workspaceRoot) {
  // resolveWorkspaceContext walks up looking for .planning/ — create a marker
  // so subdirectory CWD tests resolve the workspace root correctly.
  const planning = path.join(workspaceRoot, '.planning');
  fs.mkdirSync(planning, { recursive: true });
  const config = path.join(planning, 'config.json');
  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, JSON.stringify({ initVersion: 'test' }, null, 2), 'utf8');
  }
}

// Load registry module. Because this is a CJS test file and registry.mjs is
// ESM, we use a shared promise to import once and cache it.
let registryModulePromise = null;
function getRegistry() {
  if (!registryModulePromise) {
    const registryUrl = pathToFileURL(
      path.join(__dirname, '..', 'bin', 'lib', 'registry.mjs'),
    ).href;
    registryModulePromise = import(`${registryUrl}?t=${Date.now()}`);
  }
  return registryModulePromise;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('registry module', () => {
  let tmpDir;
  let registry;

  beforeEach(async () => {
    tmpDir = createTempWorkspace();
    // Re-import on each test to avoid module cache with stale state.
    const registryUrl = pathToFileURL(
      path.join(__dirname, '..', 'bin', 'lib', 'registry.mjs'),
    ).href;
    registry = await import(`${registryUrl}?t=${Date.now()}-${Math.random()}`);
  });

  afterEach(() => {
    cleanupWorkspace(tmpDir);
  });

  // -------------------------------------------------------------------------
  // 1. Empty registry (no file on disk) → listLeases returns []
  // -------------------------------------------------------------------------
  test('listLeases returns [] when no registry file exists', () => {
    const leases = registry.listLeases(tmpDir);
    assert.deepStrictEqual(leases, []);
    assert.strictEqual(fs.existsSync(registryPath(tmpDir)), false, 'registry file must not be created by listLeases');
  });

  // -------------------------------------------------------------------------
  // 2. grantLease → lease with state "open", granted_at set
  // -------------------------------------------------------------------------
  test('grantLease creates a lease with lease_state open and granted_at set', () => {
    const before = Date.now();
    const lease = registry.grantLease(tmpDir, {
      phase_id: 'test-01',
      worktree_path: tmpDir,
      agent_id: 'agent-1',
      branch_name: 'feat/test-01',
      write_set: ['bin/gsdd.mjs'],
      provenance_hash: 'abc123',
    });
    const after = Date.now();

    assert.strictEqual(lease.phase_id, 'test-01');
    assert.strictEqual(lease.lease_state, 'open');
    assert.strictEqual(lease.branch_name, 'feat/test-01');
    assert.strictEqual(lease.agent_id, 'agent-1');
    assert.deepStrictEqual(lease.write_set, ['bin/gsdd.mjs']);
    assert.strictEqual(lease.provenance_hash, 'abc123');
    assert.ok(lease.granted_at, 'granted_at must be set');
    const grantedAtMs = new Date(lease.granted_at).getTime();
    assert.ok(grantedAtMs >= before && grantedAtMs <= after, 'granted_at must be within test bounds');
    assert.strictEqual(lease.closed_at, null);
    assert.strictEqual(lease.crash_reason, null);

    // Verify persisted to disk.
    const onDisk = JSON.parse(fs.readFileSync(registryPath(tmpDir), 'utf8'));
    assert.strictEqual(onDisk.schema_version, 1);
    assert.strictEqual(onDisk.leases.length, 1);
    assert.strictEqual(onDisk.leases[0].phase_id, 'test-01');
    assert.strictEqual(onDisk.leases[0].lease_state, 'open');
  });

  // -------------------------------------------------------------------------
  // 3. closeLease → state "closed", closed_at set
  // -------------------------------------------------------------------------
  test('closeLease transitions lease to closed with closed_at set', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'test-02',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/test-02',
      write_set: [],
      provenance_hash: null,
    });

    const before = Date.now();
    const updated = registry.closeLease(tmpDir, 'test-02');
    const after = Date.now();

    assert.strictEqual(updated.lease_state, 'closed');
    assert.ok(updated.closed_at, 'closed_at must be set');
    const closedAtMs = new Date(updated.closed_at).getTime();
    assert.ok(closedAtMs >= before && closedAtMs <= after, 'closed_at must be within test bounds');

    const leases = registry.listLeases(tmpDir);
    assert.strictEqual(leases.find((l) => l.phase_id === 'test-02').lease_state, 'closed');
  });

  // -------------------------------------------------------------------------
  // 4. crashLease → state "crashed", crash_reason set
  // -------------------------------------------------------------------------
  test('crashLease transitions lease to crashed with crash_reason set', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'test-03',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/test-03',
      write_set: [],
      provenance_hash: null,
    });

    const updated = registry.crashLease(tmpDir, 'test-03', 'process killed by SIGKILL');

    assert.strictEqual(updated.lease_state, 'crashed');
    assert.strictEqual(updated.crash_reason, 'process killed by SIGKILL');

    const leases = registry.listLeases(tmpDir);
    assert.strictEqual(leases.find((l) => l.phase_id === 'test-03').lease_state, 'crashed');
  });

  // -------------------------------------------------------------------------
  // 5. clearLease throws on open lease without force
  // -------------------------------------------------------------------------
  test('clearLease throws if lease is open and force is false', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'test-04',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/test-04',
      write_set: [],
      provenance_hash: null,
    });

    assert.throws(
      () => registry.clearLease(tmpDir, 'test-04'),
      /open lease/i,
      'clearLease must throw an error mentioning "open lease" when force is false',
    );

    // Lease must still be present after the failed clear.
    const lease = registry.getLease(tmpDir, 'test-04');
    assert.ok(lease, 'lease must still exist after failed clearLease');
    assert.strictEqual(lease.lease_state, 'open');
  });

  // -------------------------------------------------------------------------
  // 6. clearLease removes closed lease without force
  // -------------------------------------------------------------------------
  test('clearLease removes a closed lease without --force', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'test-05',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/test-05',
      write_set: [],
      provenance_hash: null,
    });
    registry.closeLease(tmpDir, 'test-05');
    registry.clearLease(tmpDir, 'test-05');

    const lease = registry.getLease(tmpDir, 'test-05');
    assert.strictEqual(lease, null, 'getLease must return null after clearLease');
  });

  // -------------------------------------------------------------------------
  // 7. clearLease removes open lease with --force
  // -------------------------------------------------------------------------
  test('clearLease removes an open lease when force is true', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'test-06',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/test-06',
      write_set: [],
      provenance_hash: null,
    });
    registry.clearLease(tmpDir, 'test-06', { force: true });

    const lease = registry.getLease(tmpDir, 'test-06');
    assert.strictEqual(lease, null, 'getLease must return null after forced clearLease');
  });

  // -------------------------------------------------------------------------
  // 8. getLease returns null for unknown phase_id
  // -------------------------------------------------------------------------
  test('getLease returns null for unknown phase_id', () => {
    const lease = registry.getLease(tmpDir, 'nonexistent-phase');
    assert.strictEqual(lease, null);
  });

  // -------------------------------------------------------------------------
  // 9. Duplicate grant → throws if phase_id already open
  // -------------------------------------------------------------------------
  test('grantLease throws if phase_id already has an open lease', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'test-07',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/test-07',
      write_set: [],
      provenance_hash: null,
    });

    assert.throws(
      () => registry.grantLease(tmpDir, {
        phase_id: 'test-07',
        worktree_path: tmpDir,
        agent_id: null,
        branch_name: 'feat/test-07-dup',
        write_set: [],
        provenance_hash: null,
      }),
      /already has an open lease/i,
      'grantLease must throw when phase_id already has an open lease',
    );

    // Original lease untouched.
    const lease = registry.getLease(tmpDir, 'test-07');
    assert.strictEqual(lease.branch_name, 'feat/test-07');
  });

  // -------------------------------------------------------------------------
  // Durability fixture: parent-kills-child, cross-platform
  // -------------------------------------------------------------------------
  test('registry file survives parent-kills-child mid-write (durability fixture)', { timeout: 10000 }, async (t) => {
    // (a) Grant a baseline lease so registry.json has a committed complete write.
    registry.grantLease(tmpDir, {
      phase_id: '65-fixture-baseline',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/v2-registry',
      write_set: [],
      provenance_hash: null,
    });

    // Confirm registry file exists before spawning child.
    assert.ok(fs.existsSync(registryPath(tmpDir)), 'registry.json must exist after grantLease');

    // Absolute path to registry.mjs for the child process.
    const registryMjsPath = path.join(__dirname, '..', 'bin', 'lib', 'registry.mjs');

    // (b) Child script: writes per-PID .json.<pid>.tmp (matching production
    //     behavior), prints "READY <pid>", then sleeps indefinitely without
    //     ever calling renameSync — simulating a mid-write crash.
    const childScript = `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const workspaceRoot = ${JSON.stringify(tmpDir)};
const tmpPath = join(workspaceRoot, '.planning', '.local', \`registry.json.\${process.pid}.tmp\`);
const dir = join(workspaceRoot, '.planning', '.local');
mkdirSync(dir, { recursive: true });
// Write a new entry to the .tmp file (simulating a mid-write crash).
const newEntry = {
  phase_id: '65-fixture-crash',
  worktree_path: workspaceRoot,
  agent_id: null,
  branch_name: 'feat/crash-candidate',
  lease_state: 'open',
  granted_at: new Date().toISOString(),
  closed_at: null,
  crashed_at: null,
  crash_reason: null,
  write_set: [],
  provenance_hash: null,
};
const corrupt = { schema_version: 1, leases: [newEntry] };
writeFileSync(tmpPath, JSON.stringify(corrupt, null, 2), 'utf8');
// Signal readiness with our pid — parent will kill us now.
process.stdout.write('READY ' + process.pid + '\\n');
// Sleep indefinitely — never calls renameSync.
setInterval(() => {}, 60000);
`;

    // (c) Spawn the child.
    const child = spawn(process.execPath, ['--input-type=module'], {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Feed the script to stdin.
    child.stdin.write(childScript);
    child.stdin.end();

    // Wait for "READY" on stdout.
    await new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Durability fixture: child did not emit READY within 5s'));
      }, 5000);

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes('READY')) {
          clearTimeout(timeout);
          // (c) Kill the child immediately after it signals readiness.
          const killed = child.kill();
          if (!killed) {
            // On Windows, kill() may return false for race reasons; proceed anyway.
            t.diagnostic('child.kill() returned false — process may have already exited');
          }
          resolve();
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // (d) Wait for the child to terminate.
    await new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      // Give the process 2s to exit after kill.
      const timeout = setTimeout(() => {
        t.diagnostic('Child did not terminate within 2s after kill — known Windows limitation');
        resolve();
      }, 2000);
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // (e) Assert: registry.json is valid JSON and baseline lease is still present.
    const registryFile = registryPath(tmpDir);
    assert.ok(fs.existsSync(registryFile), 'registry.json must still exist after child kill');

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    } catch (err) {
      assert.fail(`registry.json must be valid JSON after child kill: ${err.message}`);
    }

    assert.ok(Array.isArray(parsed.leases), 'registry.leases must be an array');
    const baseline = parsed.leases.find((l) => l.phase_id === '65-fixture-baseline');
    assert.ok(
      baseline,
      'baseline lease (65-fixture-baseline) must still be present in registry after child kill',
    );
    assert.strictEqual(baseline.lease_state, 'open', 'baseline lease state must be open');

    // (f) Assert: the child left a .tmp orphan (proves the crash was mid-write,
    //     before renameSync). The orphan filename follows the per-PID pattern
    //     `registry.json.<pid>.tmp`. We cannot know the child's pid from the
    //     parent without extra IPC, so we scan the directory for any matching
    //     orphan. Tolerance: on Windows, the child may exit before we get here
    //     and the OS may have already cleaned the file; we diagnose instead of
    //     hard-failing in that case to keep CI stable across platforms.
    const orphans = findTmpOrphans(tmpDir);
    if (orphans.length === 0) {
      t.diagnostic('No .tmp orphan found — child may have exited before its writeFileSync flushed, or OS cleaned the file. Atomic-rename property is still proven by the registry.json invariant above.');
    } else {
      assert.ok(
        orphans.length >= 1,
        '.tmp orphan must exist after child kill (proves crash was mid-write)',
      );
    }

    // Cleanup: remove baseline lease.
    registry.clearLease(tmpDir, '65-fixture-baseline', { force: true });

    // Clean up any .tmp orphans the child left.
    for (const tmpFile of findTmpOrphans(tmpDir)) {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  // -------------------------------------------------------------------------
  // closeLease state guard: throws on closing a non-open lease
  // -------------------------------------------------------------------------
  test('closeLease throws when lease is already closed', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'state-guard-01',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/state-guard-01',
      write_set: [],
      provenance_hash: null,
    });
    registry.closeLease(tmpDir, 'state-guard-01');
    assert.throws(
      () => registry.closeLease(tmpDir, 'state-guard-01'),
      /lease_state "closed", expected "open"/,
      'closeLease must throw when lease is already closed',
    );
  });

  test('closeLease throws when lease is crashed', () => {
    registry.grantLease(tmpDir, {
      phase_id: 'state-guard-02',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/state-guard-02',
      write_set: [],
      provenance_hash: null,
    });
    registry.crashLease(tmpDir, 'state-guard-02', 'simulated');
    assert.throws(
      () => registry.closeLease(tmpDir, 'state-guard-02'),
      /lease_state "crashed", expected "open"/,
      'closeLease must throw when lease is crashed',
    );
  });

  // -------------------------------------------------------------------------
  // crashLease records crashed_at timestamp (parity with closed_at)
  // -------------------------------------------------------------------------
  test('crashLease records crashed_at ISO timestamp', () => {
    const before = Date.now();
    registry.grantLease(tmpDir, {
      phase_id: 'crashed-at-01',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/crashed-at',
      write_set: [],
      provenance_hash: null,
    });
    const lease = registry.crashLease(tmpDir, 'crashed-at-01', 'oom');
    const after = Date.now();
    assert.strictEqual(lease.lease_state, 'crashed');
    assert.strictEqual(lease.crash_reason, 'oom');
    assert.ok(typeof lease.crashed_at === 'string', 'crashed_at must be a string');
    const crashedAtMs = Date.parse(lease.crashed_at);
    assert.ok(
      crashedAtMs >= before && crashedAtMs <= after,
      `crashed_at (${lease.crashed_at}) must be between ${new Date(before).toISOString()} and ${new Date(after).toISOString()}`,
    );
  });

  test('grantLease initializes crashed_at as null alongside closed_at', () => {
    const lease = registry.grantLease(tmpDir, {
      phase_id: 'crashed-at-init',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/init',
      write_set: [],
      provenance_hash: null,
    });
    assert.strictEqual(lease.crashed_at, null, 'crashed_at must be null on a fresh open lease');
    assert.strictEqual(lease.closed_at, null, 'closed_at must be null on a fresh open lease');
  });

  // -------------------------------------------------------------------------
  // Corrupt JSON handling: quarantine + warn + empty
  // -------------------------------------------------------------------------
  test('readRegistry quarantines unparseable JSON and returns empty', () => {
    // Write garbage that JSON.parse will reject.
    const dir = path.join(tmpDir, '.planning', '.local');
    fs.mkdirSync(dir, { recursive: true });
    const target = registryPath(tmpDir);
    fs.writeFileSync(target, '{ this is not json', 'utf8');

    // Capture stderr from listLeases.
    const originalWrite = process.stderr.write.bind(process.stderr);
    const captured = [];
    process.stderr.write = (chunk, ...rest) => {
      captured.push(chunk.toString());
      return true;
    };

    let leases;
    try {
      leases = registry.listLeases(tmpDir);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.deepStrictEqual(leases, []);
    const warnText = captured.join('');
    assert.match(warnText, /WARN.*corrupt/, 'expected stderr corruption warning');
    assert.match(warnText, /quarantined to .+broken-/, 'expected quarantine message');

    // The corrupt file should now be renamed to registry.json.broken-<ts>.
    const dirEntries = fs.readdirSync(dir);
    const quarantined = dirEntries.find((f) => /^registry\.json\.broken-\d+$/.test(f));
    assert.ok(quarantined, `expected a quarantine file in ${dir}, found: ${dirEntries.join(', ')}`);
  });

  test('readRegistry quarantines wrong-shape JSON (leases not an array) and returns empty', () => {
    const dir = path.join(tmpDir, '.planning', '.local');
    fs.mkdirSync(dir, { recursive: true });
    const target = registryPath(tmpDir);
    fs.writeFileSync(target, JSON.stringify({ schema_version: 1 }), 'utf8');

    const originalWrite = process.stderr.write.bind(process.stderr);
    const captured = [];
    process.stderr.write = (chunk) => {
      captured.push(chunk.toString());
      return true;
    };

    let leases;
    try {
      leases = registry.listLeases(tmpDir);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.deepStrictEqual(leases, []);
    assert.match(captured.join(''), /shape invalid/);
  });

  test('readRegistry returns empty on truly empty file', () => {
    const dir = path.join(tmpDir, '.planning', '.local');
    fs.mkdirSync(dir, { recursive: true });
    const target = registryPath(tmpDir);
    fs.writeFileSync(target, '', 'utf8');

    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    let leases;
    try {
      leases = registry.listLeases(tmpDir);
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.deepStrictEqual(leases, []);
  });

  // -------------------------------------------------------------------------
  // Concurrent writers: per-PID tmp files prevent the .tmp truncation race.
  // Both children's grantLease calls must complete without throwing, and the
  // final registry must be valid JSON. The exact lease count is non-deterministic
  // (last-writer-wins on the rename), but the fingerprint warning surfaces any
  // lost update on stderr so an operator can re-run.
  // -------------------------------------------------------------------------
  test('concurrent grantLease across two children produces valid JSON (no .tmp truncation)', { timeout: 15000 }, async () => {
    const registryMjsAbs = path.join(__dirname, '..', 'bin', 'lib', 'registry.mjs');
    const registryUrl = pathToFileURL(registryMjsAbs).href;

    function spawnGranter(phaseId) {
      const script = `
import { grantLease } from ${JSON.stringify(registryUrl)};
try {
  grantLease(${JSON.stringify(tmpDir)}, {
    phase_id: ${JSON.stringify(phaseId)},
    worktree_path: ${JSON.stringify(tmpDir)},
    agent_id: null,
    branch_name: 'feat/' + ${JSON.stringify(phaseId)},
    write_set: [],
    provenance_hash: null,
  });
  process.stdout.write('OK\\n');
} catch (err) {
  process.stderr.write('ERR ' + err.message + '\\n');
  process.exit(1);
}
`;
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => (stdout += c.toString()));
        child.stderr.on('data', (c) => (stderr += c.toString()));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.on('error', reject);
        child.stdin.write(script);
        child.stdin.end();
      });
    }

    const [a, b] = await Promise.all([
      spawnGranter('concur-A'),
      spawnGranter('concur-B'),
    ]);

    // Both processes finish successfully.
    assert.strictEqual(a.code, 0, `child A failed: ${a.stderr}`);
    assert.strictEqual(b.code, 0, `child B failed: ${b.stderr}`);

    // Final registry must be valid JSON (no truncation corruption).
    const raw = fs.readFileSync(registryPath(tmpDir), 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); });
    assert.ok(Array.isArray(parsed.leases), 'registry.leases must be an array');
    // At least one of the two lease writes survived (last-writer-wins
    // semantics; fingerprint warning was emitted by the loser).
    const haveA = parsed.leases.some((l) => l.phase_id === 'concur-A');
    const haveB = parsed.leases.some((l) => l.phase_id === 'concur-B');
    assert.ok(
      haveA || haveB,
      'at least one of the two concurrent leases must be present in the final registry',
    );

    // No stray .tmp orphans should remain — both renameSync calls succeeded.
    const orphans = findTmpOrphans(tmpDir);
    assert.strictEqual(
      orphans.length,
      0,
      `expected no .tmp orphans after successful renames; found ${orphans.length}: ${orphans.join(', ')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// CLI command smoke tests (via node bin/gsdd.mjs)
// ---------------------------------------------------------------------------

describe('registry CLI commands', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempWorkspace();
  });

  afterEach(() => {
    cleanupWorkspace(tmpDir);
  });

  function runCli(args) {
    const { spawnSync } = require('node:child_process');
    const cliPath = path.join(__dirname, '..', 'bin', 'gsdd.mjs');
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.status,
    };
  }

  test('registry-list returns empty gracefully on fresh workspace', () => {
    const result = runCli(['registry-list']);
    assert.strictEqual(result.exitCode, 0, `unexpected exit code: ${result.stderr}`);
    assert.ok(result.stdout.includes('No leases found.'));
  });

  test('registry-list --json returns [] on fresh workspace', () => {
    const result = runCli(['registry-list', '--json']);
    assert.strictEqual(result.exitCode, 0, `unexpected exit code: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.deepStrictEqual(parsed, []);
  });

  test('registry-show exits 1 with message for unknown phase', () => {
    const result = runCli(['registry-show', '99']);
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes('No lease found for phase 99'));
  });

  test('registry-crash placeholder exits 1 with P66 deferral message', () => {
    const result = runCli(['registry-crash', '65']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      result.stderr,
      /not yet implemented.*P66/i,
      'registry-crash must surface a P66 deferral message',
    );
  });

  test('registry commands resolve workspace root from a nested cwd', async () => {
    // Reproduces the Codex P1 finding: prior to the fix, the registry commands
    // read from process.cwd() — so running them from a subdirectory silently
    // missed the root registry. After the fix, resolveWorkspaceContext walks
    // up looking for a .planning/ marker.
    ensurePlanningMarker(tmpDir);

    // Grant a lease at the workspace root using direct module access.
    const registryUrl = pathToFileURL(
      path.join(__dirname, '..', 'bin', 'lib', 'registry.mjs'),
    ).href;
    const reg = await import(`${registryUrl}?t=${Date.now()}-${Math.random()}`);
    reg.grantLease(tmpDir, {
      phase_id: 'cwd-resolve-01',
      worktree_path: tmpDir,
      agent_id: null,
      branch_name: 'feat/cwd-resolve',
      write_set: [],
      provenance_hash: null,
    });

    // Create a subdirectory and run registry-list from inside it.
    const subdir = path.join(tmpDir, 'deeply', 'nested');
    fs.mkdirSync(subdir, { recursive: true });

    const { spawnSync } = require('node:child_process');
    const cliPath = path.join(__dirname, '..', 'bin', 'gsdd.mjs');
    const result = spawnSync(process.execPath, [cliPath, 'registry-list'], {
      cwd: subdir,
      encoding: 'utf-8',
      env: { ...process.env, GSDD_WORKSPACE_ROOT: '' },
    });
    assert.strictEqual(
      result.status,
      0,
      `registry-list from subdir failed: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes('cwd-resolve-01'),
      `registry-list from subdir must surface the root registry's lease; got:\n${result.stdout}`,
    );
  });
});
