import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { output } from './cli-utils.mjs';
import { evaluateLifecycleState, normalizePhaseToken } from './lifecycle-state.mjs';

const SURFACE_POLICIES = {
  progress: {
    classification: 'read_only',
    ownedWrites: [],
    explicitLifecycleMutation: 'none',
  },
  execute: {
    classification: 'owned_write',
    ownedWrites: ['summary'],
    explicitLifecycleMutation: 'phase-status',
    phaseRequired: true,
  },
  verify: {
    classification: 'owned_write',
    ownedWrites: ['verification'],
    explicitLifecycleMutation: 'phase-status',
    phaseRequired: true,
  },
  'audit-milestone': {
    classification: 'owned_write',
    ownedWrites: ['milestone-audit'],
    explicitLifecycleMutation: 'none',
  },
  'complete-milestone': {
    classification: 'owned_write',
    ownedWrites: ['milestone-archives', 'milestones-ledger', 'spec', 'roadmap'],
    explicitLifecycleMutation: 'none',
  },
  'new-milestone': {
    classification: 'owned_write',
    ownedWrites: ['spec', 'roadmap', 'phase-directories'],
    explicitLifecycleMutation: 'none',
  },
  resume: {
    classification: 'owned_write',
    ownedWrites: ['checkpoint-cleanup'],
    explicitLifecycleMutation: 'none',
  },
};

export function evaluateLifecyclePreflight({
  planningDir,
  surface,
  phaseNumber = null,
  expectsMutation = 'none',
} = {}) {
  if (!planningDir) {
    throw new Error('planningDir is required');
  }

  const policy = SURFACE_POLICIES[surface];
  if (!policy) {
    throw new Error(`Unsupported lifecycle surface: ${surface}`);
  }

  const lifecycle = evaluateLifecycleState({ planningDir });
  const normalizedPhase = phaseNumber ? normalizePhaseToken(phaseNumber) : null;
  const checkpointPath = join(planningDir, '.continue-here.md');
  const specPath = join(planningDir, 'SPEC.md');
  const milestonesPath = join(planningDir, 'MILESTONES.md');
  const blockers = [];

  if (!existsSync(planningDir)) {
    blockers.push(blocker('missing_planning_dir', '.planning/ does not exist yet.', ['.planning/']));
  }

  if (expectsMutation !== 'none' && expectsMutation !== policy.explicitLifecycleMutation) {
    blockers.push(
      blocker(
        'illegal_lifecycle_mutation',
        `${surface} is classified as ${policy.classification} and cannot mutate lifecycle state via ${expectsMutation}.`,
        []
      )
    );
  }

  if (policy.phaseRequired && !normalizedPhase) {
    blockers.push(blocker('missing_phase_argument', `${surface} requires an explicit phase number.`, []));
  }

  if (normalizedPhase) {
    blockers.push(...buildPhaseBlockers({ lifecycle, phaseToken: normalizedPhase, surface }));
  }

  if (surface === 'audit-milestone') {
    blockers.push(...buildAuditBlockers(lifecycle));
  }

  if (surface === 'complete-milestone') {
    blockers.push(...buildAuditBlockers(lifecycle, { allowArchivedBlocker: true }));
    blockers.push(...buildCompletionBlockers(planningDir, lifecycle));
  }

  if (surface === 'new-milestone') {
    if (!existsSync(specPath)) {
      blockers.push(blocker('missing_spec', 'SPEC.md is required before starting a new milestone.', ['.planning/SPEC.md']));
    }
    if (!existsSync(milestonesPath)) {
      blockers.push(blocker('missing_milestones', 'MILESTONES.md is required before starting a new milestone.', ['.planning/MILESTONES.md']));
    }
    if (lifecycle.currentMilestone.version && lifecycle.currentMilestone.archiveState !== 'archived') {
      blockers.push(
        blocker(
          'active_milestone_in_progress',
          `Milestone ${lifecycle.currentMilestone.version} is still active. Archive or remove the active roadmap before starting the next milestone.`,
          ['.planning/ROADMAP.md']
        )
      );
    }
  }

  if (surface === 'resume' && !existsSync(checkpointPath)) {
    blockers.push(blocker('missing_checkpoint', 'resume requires .planning/.continue-here.md to exist.', ['.planning/.continue-here.md']));
  }

  return {
    surface,
    phase: normalizedPhase,
    classification: policy.classification,
    ownedWrites: policy.ownedWrites,
    explicitLifecycleMutation: policy.explicitLifecycleMutation,
    mutationRequest: expectsMutation,
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    reason: blockers[0]?.code ?? null,
    blockers,
    lifecycle: {
      currentMilestone: lifecycle.currentMilestone,
      currentPhase: lifecycle.currentPhase ? lifecycle.currentPhase.number : null,
      nextPhase: lifecycle.nextPhase ? lifecycle.nextPhase.number : null,
      counts: lifecycle.counts,
    },
  };
}

function buildPhaseBlockers({ lifecycle, phaseToken, surface }) {
  const blockers = [];
  const phaseEntry = lifecycle.phases.find((phase) => phase.number === phaseToken);
  if (!phaseEntry) {
    blockers.push(
      blocker(
        'missing_phase',
        `Phase ${phaseToken} was not found in the active roadmap.`,
        ['.planning/ROADMAP.md']
      )
    );
    return blockers;
  }

  const planArtifacts = lifecycle.phaseArtifacts.filter((artifact) => artifact.phaseToken === phaseToken && artifact.kind === 'plan');
  const summaryArtifacts = lifecycle.phaseArtifacts.filter((artifact) => artifact.phaseToken === phaseToken && artifact.kind === 'summary');
  const pendingPlans = planArtifacts.filter(
    (artifact) => !summaryArtifacts.some((candidate) => candidate.dir === artifact.dir && candidate.baseId === artifact.baseId)
  );

  if (surface === 'execute') {
    if (planArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_plan',
          `Phase ${phaseToken} cannot execute because no PLAN artifact exists.`,
          ['.planning/phases/']
        )
      );
    } else if (pendingPlans.length === 0) {
      blockers.push(
        blocker(
          'no_pending_plan',
          `Phase ${phaseToken} has no pending PLAN artifacts left to execute.`,
          planArtifacts.map((artifact) => artifact.displayPath)
        )
      );
    }
  }

  if (surface === 'verify') {
    if (planArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_plan',
          `Phase ${phaseToken} cannot be verified because no PLAN artifact exists.`,
          ['.planning/phases/']
        )
      );
    }
    if (summaryArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_summary',
          `Phase ${phaseToken} cannot be verified because no SUMMARY artifact exists yet.`,
          ['.planning/phases/']
        )
      );
    }
  }

  return blockers;
}

function buildAuditBlockers(lifecycle, { allowArchivedBlocker = false } = {}) {
  const blockers = [];
  if (!lifecycle.currentMilestone.version) {
    blockers.push(blocker('missing_milestone', 'No active or retained milestone could be derived from ROADMAP.md.', ['.planning/ROADMAP.md']));
    return blockers;
  }

  if (lifecycle.currentMilestone.archiveState === 'archived') {
    blockers.push(
      blocker(
        allowArchivedBlocker ? 'milestone_already_archived' : 'milestone_already_archived',
        `Milestone ${lifecycle.currentMilestone.version} is already archived-with-ROADMAP.md evidence.`,
        ['.planning/ROADMAP.md', '.planning/MILESTONES.md']
      )
    );
  }

  if (lifecycle.counts.total === 0) {
    blockers.push(blocker('missing_phases', 'No active milestone phases were found in ROADMAP.md.', ['.planning/ROADMAP.md']));
  } else if (lifecycle.counts.completed !== lifecycle.counts.total) {
    blockers.push(
      blocker(
        'incomplete_phases',
        `Milestone ${lifecycle.currentMilestone.version} still has incomplete phases (${lifecycle.counts.completed}/${lifecycle.counts.total} complete).`,
        ['.planning/ROADMAP.md']
      )
    );
  }

  const phasesMissingVerification = lifecycle.phases
    .filter((phase) => phase.status === 'done')
    .filter((phase) => !phase.artifacts.some((artifact) => artifact.kind === 'verification'))
    .map((phase) => phase.number);

  if (phasesMissingVerification.length > 0) {
    blockers.push(
      blocker(
        'missing_verification',
        `Completed phases are missing VERIFICATION artifacts (${phasesMissingVerification.join(', ')}).`,
        ['.planning/phases/']
      )
    );
  }

  return blockers;
}

function buildCompletionBlockers(planningDir, lifecycle) {
  const auditPath = join(planningDir, `${lifecycle.currentMilestone.version}-MILESTONE-AUDIT.md`);
  if (!existsSync(auditPath)) {
    return [
      blocker(
        'missing_milestone_audit',
        `Milestone ${lifecycle.currentMilestone.version} cannot be completed without a milestone audit artifact.`,
        [auditPath]
      ),
    ];
  }

  const auditContent = readFileSync(auditPath, 'utf-8');
  const statusMatch = auditContent.match(/^status:\s*(.+)$/m);
  if (!statusMatch || statusMatch[1].trim() !== 'passed') {
    return [
      blocker(
        'audit_not_passed',
        `Milestone ${lifecycle.currentMilestone.version} requires a passed audit before completion.`,
        [auditPath]
      ),
    ];
  }

  return [];
}

function blocker(code, message, artifacts) {
  return { code, message, artifacts };
}

export function cmdLifecyclePreflight(...args) {
  const cwd = process.cwd();
  const planningDir = join(cwd, '.planning');
  const [surface, maybePhase, ...rest] = args;

  if (!surface) {
    console.error('Usage: gsdd lifecycle-preflight <surface> [phase] [--expects-mutation <none|phase-status>]');
    process.exitCode = 1;
    return;
  }

  let phaseNumber = maybePhase && !maybePhase.startsWith('--') ? maybePhase : null;
  let expectsMutation = 'none';

  const flagArgs = phaseNumber ? rest : [maybePhase, ...rest].filter(Boolean);
  for (let index = 0; index < flagArgs.length; index += 1) {
    const arg = flagArgs[index];
    if (arg === '--expects-mutation') {
      expectsMutation = flagArgs[index + 1] ?? 'none';
      index += 1;
    }
  }

  try {
    const result = evaluateLifecyclePreflight({ planningDir, surface, phaseNumber, expectsMutation });
    output(result);
    if (!result.allowed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
