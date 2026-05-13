// registry-commands.mjs - CLI command handlers for the worktree coordination registry.
// Imported by bin/gsdd.mjs to keep the main entrypoint below the facade line limit.

import { listLeases, getLease, clearLease } from './registry.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

function resolveRegistryRoot(rawArgs) {
  const context = resolveWorkspaceContext(rawArgs);
  if (context.invalid) {
    console.error(context.error || 'Invalid workspace root');
    process.exitCode = 1;
    return { ok: false };
  }
  return { ok: true, workspaceRoot: context.workspaceRoot, args: context.args };
}

function stripInternalPrefix(message) {
  // Errors from registry.mjs are prefixed with the function name
  // (e.g. "clearLease: no lease found..."). Users do not need to see the
  // internal function name in the CLI output.
  return String(message || '').replace(/^[a-zA-Z]+:\s*/, '');
}

export async function cmdRegistryClear(...rawArgs) {
  const ctx = resolveRegistryRoot(rawArgs);
  if (!ctx.ok) return;
  const phase = ctx.args.find((a) => !a.startsWith('-'));
  const force = ctx.args.includes('--force');
  if (!phase) {
    console.error('Usage: gsdd registry-clear <phase> [--force]');
    process.exitCode = 1;
    return;
  }
  try {
    clearLease(ctx.workspaceRoot, phase, { force });
    console.log(`Lease for phase ${phase} cleared.`);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('open lease') && !force) {
      console.error(`Error: phase ${phase} has an open lease. Use --force to clear it.`);
    } else {
      console.error(`Error: ${stripInternalPrefix(msg)}`);
    }
    process.exitCode = 1;
  }
}

export async function cmdRegistryCrash(...rawArgs) {
  // Placeholder until P66 wires the debugger-role crashed-lease recovery
  // ceremony. The token is claimed here so the hyphenated CLI grammar is
  // locked in before P66 plans its CLI surface.
  console.error(
    'gsdd registry-crash: not yet implemented; available in P66 (debugger crashed-lease recovery).',
  );
  process.exitCode = 1;
}

export async function cmdRegistryList(...rawArgs) {
  const ctx = resolveRegistryRoot(rawArgs);
  if (!ctx.ok) return;
  const jsonMode = ctx.args.includes('--json');
  const leases = listLeases(ctx.workspaceRoot);
  if (jsonMode) {
    console.log(JSON.stringify(leases, null, 2));
    return;
  }
  if (leases.length === 0) {
    console.log('No leases found.');
    return;
  }
  console.log('phase  branch  state  granted_at');
  for (const l of leases) {
    console.log(`${l.phase_id}  ${l.branch_name}  ${l.lease_state}  ${l.granted_at}`);
  }
}

export async function cmdRegistryShow(...rawArgs) {
  const ctx = resolveRegistryRoot(rawArgs);
  if (!ctx.ok) return;
  const jsonMode = ctx.args.includes('--json');
  const phase = ctx.args.find((a) => !a.startsWith('-'));
  if (!phase) {
    console.error('Usage: gsdd registry-show <phase> [--json]');
    process.exitCode = 1;
    return;
  }
  const lease = getLease(ctx.workspaceRoot, phase);
  if (!lease) {
    console.error(`No lease found for phase ${phase}.`);
    process.exitCode = 1;
    return;
  }
  if (jsonMode) {
    console.log(JSON.stringify(lease, null, 2));
    return;
  }
  for (const [key, value] of Object.entries(lease)) {
    const display = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '');
    console.log(`${key}: ${display}`);
  }
}
