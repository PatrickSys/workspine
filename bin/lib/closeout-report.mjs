// closeout-report.mjs - read-only post-merge closure replay report

import { output, parseFlagValue } from './cli-utils.mjs';
import { buildControlMap } from './control-map.mjs';
import { evaluateLifecyclePreflight } from './lifecycle-preflight.mjs';
import { evaluateLifecycleState, normalizePhaseToken } from './lifecycle-state.mjs';
import { buildPhaseVerificationReport } from './phase.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

const USAGE = 'Usage: gsdd closeout-report [--json] [--phase <N>]';

function severityFromRisk(risk) {
  if (risk.severity === 'block') return 'blocker';
  if (risk.severity === 'warn') return 'warn';
  return risk.severity || 'info';
}

function notice(source, severity, entry) {
  return {
    source,
    severity,
    code: entry.code || entry.id || 'unknown',
    message: entry.message,
    fix: entry.fix || entry.fix_hint || null,
    path: entry.path || null,
  };
}

function latestCompletedPhase(lifecycle) {
  const completed = lifecycle.phases.filter((phase) => phase.status === 'done');
  return completed.length > 0 ? completed[completed.length - 1] : null;
}

async function buildHealthReportSafe(ctx, args) {
  try {
    const health = await import('./health.mjs');
    return health.buildHealthReport(ctx, args);
  } catch (error) {
    return {
      status: 'degraded',
      errors: [],
      warnings: [{
        id: 'W_CLOSEOUT_HEALTH_UNAVAILABLE',
        severity: 'WARN',
        message: `Health report builder unavailable in this helper runtime: ${error.message}`,
        fix: 'Run the source CLI `gsdd health --json` for full health diagnostics, or refresh generated helper support.',
      }],
      info: [],
    };
  }
}

function summarizeControlMap(map) {
  return {
    status: map.risks.some((risk) => risk.severity === 'block')
      ? 'blocked'
      : map.risks.some((risk) => risk.severity === 'warn')
        ? 'warnings'
        : 'clear',
    authority: map.authority,
    canonical_worktree: {
      branch: map.canonical_worktree.branch,
      head: map.canonical_worktree.head,
      dirty: map.canonical_worktree.dirty,
      ahead_behind: map.canonical_worktree.ahead_behind,
    },
    worktree_count: map.worktrees.length,
    risks: map.risks,
    interventions: map.interventions,
  };
}

function summarizePreflight(preflight) {
  return {
    status: preflight.status,
    allowed: preflight.allowed,
    reason: preflight.reason,
    blockers: preflight.blockers,
    warnings: preflight.warnings,
  };
}

function summarizePhaseVerification(report) {
  if (!report.ok) {
    return {
      status: 'blocked',
      verified: false,
      error: report.error,
      blocked_on: ['verification'],
    };
  }
  return {
    status: report.result.verified ? 'passed' : 'blocked',
    verified: report.result.verified,
    phase_artifacts_present: report.result.phase_artifacts_present,
    prerequisite_status: report.result.prerequisite_status,
    artifact_status: report.result.artifact_status,
    blocked_on: report.result.blocked_on,
    blocks_verification: report.result.blocks_verification,
  };
}

function collectBlockers({ health, preflight, phaseReport }) {
  const blockers = [];
  const uiProofErrors = phaseReport.result?.uiProof?.errors || [];
  const uiProofGate = phaseReport.result?.ui_proof || {};

  blockers.push(...health.errors.map((entry) => notice('health', 'blocker', entry)));
  blockers.push(...preflight.blockers.map((entry) => notice('preflight', 'blocker', entry)));

  if (!phaseReport.ok) {
    blockers.push(notice('phase_verification', 'blocker', {
      code: 'phase_verification_error',
      message: phaseReport.error,
      fix_hint: 'Run the direct verify command for the selected phase and repair the reported prerequisite.',
    }));
  } else {
    for (const blockerEntry of phaseReport.result.prerequisite_status.blockers || []) {
      blockers.push(notice('phase_verification', 'blocker', blockerEntry));
    }
    for (const artifact of phaseReport.result.artifact_status.unsatisfied || []) {
      blockers.push(notice('phase_verification', 'blocker', {
        code: 'unsatisfied_plan_artifact',
        message: `${artifact.file} is not ${artifact.expected}.`,
        fix_hint: artifact.fix_hint,
        path: artifact.file,
      }));
    }
    for (const entry of uiProofErrors) {
      blockers.push(notice('ui_proof', entry.severity === 'warn' ? 'warn' : 'blocker', entry));
    }
    if (uiProofErrors.length === 0 && uiProofGate.blocks_verification) {
      blockers.push(notice('ui_proof', 'blocker', {
        code: uiProofGate.required_block || 'ui_proof_verification_failed',
        message: `UI proof verification is required for phase ${phaseReport.result.phase} but reported status ${uiProofGate.status}.`,
        fix_hint: 'Run the phase-specific UI proof checks and supply a passing observed proof bundle for each declared slot.',
      }));
    }
  }

  return blockers.filter((entry) => entry.severity === 'blocker');
}

function collectWarnings({ controlMap, health, preflight, phaseReport }) {
  const warnings = [];
  warnings.push(...controlMap.risks
    .filter((risk) => risk.severity !== 'block')
    .map((risk) => notice('control_map', severityFromRisk(risk), risk)));
  warnings.push(...health.warnings.map((entry) => notice('health', 'warn', entry)));
  warnings.push(...preflight.warnings
    .filter((entry) => entry.source !== 'control-map')
    .map((entry) => notice('preflight', entry.severity === 'info' ? 'info' : 'warn', entry)));
  if (phaseReport.ok) {
    warnings.push(...(phaseReport.result.uiProof?.warnings || []).map((entry) => notice('ui_proof', 'warn', entry)));
  }
  return warnings;
}

function nextSafeAction({ blockers, warnings, phaseNumber }) {
  if (blockers.length > 0) {
    return {
      command: `gsdd verify ${phaseNumber}`,
      reason: 'Repair blockers before treating closeout as replayed.',
    };
  }
  if (warnings.length > 0) {
    return {
      command: 'gsdd control-map --json',
      reason: 'Review warnings before claiming the local environment is clean.',
    };
  }
  return {
    command: `gsdd verify ${phaseNumber}`,
    reason: 'Phase implementation is replay-clean; run formal verification for closure if it has not already been recorded.',
  };
}

export async function buildCloseoutReport(ctx = {}, args = []) {
  const context = resolveWorkspaceContext(args, { cwd: ctx.cwd || process.cwd() });
  if (context.invalid) {
    return {
      ok: false,
      error: context.error,
      exitCode: 1,
    };
  }

  const phaseArg = parseFlagValue(context.args, '--phase');
  if (phaseArg.invalid) {
    return { ok: false, error: USAGE, exitCode: 1 };
  }

  const filteredArgs = context.args.filter((arg, index) => {
    if (arg === '--json') return false;
    if (arg === '--phase') return false;
    if (index > 0 && context.args[index - 1] === '--phase') return false;
    return true;
  });
  if (filteredArgs.length > 0) {
    return { ok: false, error: USAGE, exitCode: 1 };
  }

  const lifecycle = evaluateLifecycleState({ planningDir: context.planningDir });
  const selectedPhase = phaseArg.present
    ? normalizePhaseToken(phaseArg.value)
    : latestCompletedPhase(lifecycle)?.number || null;
  if (!selectedPhase) {
    return {
      ok: false,
      error: 'No completed phase found. Pass --phase <N> to replay a specific phase.',
      exitCode: 1,
    };
  }

  const controlMap = buildControlMap({
    workspaceRoot: context.workspaceRoot,
    planningDir: context.planningDir,
  });
  const health = await buildHealthReportSafe(ctx, ['--workspace-root', context.workspaceRoot]);
  const preflight = evaluateLifecyclePreflight({
    planningDir: context.planningDir,
    surface: 'verify',
    phaseNumber: selectedPhase,
    expectsMutation: 'phase-status',
    controlMapReport: controlMap,
  });
  const phaseReport = buildPhaseVerificationReport('--workspace-root', context.workspaceRoot, selectedPhase);
  const blockers = collectBlockers({ health, preflight, phaseReport });
  const warnings = collectWarnings({ controlMap, health, preflight, phaseReport });
  const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warnings' : 'clear';

  return {
    ok: true,
    exitCode: blockers.length > 0 ? 1 : 0,
    result: {
      schema_version: 1,
      operation: 'closeout-report',
      generated_at: new Date().toISOString(),
      workspace_root: context.workspaceRoot.replace(/\\/g, '/'),
      phase: selectedPhase,
      scope: {
        defaulted_to_latest_completed: !phaseArg.present,
        latest_completed_phase: latestCompletedPhase(lifecycle)?.number || null,
      },
      status,
      blockers,
      warnings,
      next_safe_action: nextSafeAction({ blockers, warnings, phaseNumber: selectedPhase }),
      control_map: summarizeControlMap(controlMap),
      health: {
        status: health.status,
        errors: health.errors,
        warnings: health.warnings,
        info: health.info,
      },
      preflight: summarizePreflight(preflight),
      phase_verification: summarizePhaseVerification(phaseReport),
      ui_proof: phaseReport.ok ? phaseReport.result.ui_proof : null,
    },
  };
}

function printHuman(report) {
  console.log('gsdd closeout-report - read-only closure replay\n');
  console.log(`Phase: ${report.phase}`);
  console.log(`Status: ${report.status}`);
  if (report.blockers.length > 0) {
    console.log('\nBlockers:');
    for (const blocker of report.blockers) console.log(`  - [${blocker.source}] ${blocker.code}: ${blocker.message}`);
  }
  if (report.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of report.warnings) console.log(`  - [${warning.source}] ${warning.code}: ${warning.message}`);
  }
  console.log(`\nNext safe action: ${report.next_safe_action.command}`);
  console.log(`Reason: ${report.next_safe_action.reason}`);
}

export function createCmdCloseoutReport(ctx = {}) {
  return async function cmdCloseoutReport(...args) {
    const jsonMode = args.includes('--json');
    const report = await buildCloseoutReport(ctx, args);
    if (!report.ok) {
      console.error(report.error);
      process.exitCode = report.exitCode;
      return;
    }
    if (jsonMode) output(report.result);
    else printHuman(report.result);
    if (report.exitCode !== 0) process.exitCode = report.exitCode;
  };
}
