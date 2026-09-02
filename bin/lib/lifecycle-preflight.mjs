import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { output } from './cli-utils.mjs';
import { buildControlMap } from './control-map.mjs';
import {
  collectNativePhaseArtifacts,
  evaluateLifecycleState,
  findUnpairedPlanArtifacts,
  normalizePhaseToken,
  partitionPlanChains,
  resolveLifecyclePlanSelection,
  resolveLifecyclePhaseSelection,
} from './lifecycle-state.mjs';
import {
  buildDecisionsDigest,
  getWorkPaths,
  inspectWorkMilestone,
  persistDecisionsDigest,
  readJsonIfExists,
  readContinuityCheckpoint,
  resolveActiveMilestoneDir,
  isValidApprovalReference,
  normalizeApprovalReference,
  hasDurableWorkflowApproval,
  transitionWorkflowState,
} from './work-context.mjs';
import { parsePlanFrontmatter } from './phase.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import { assertStateAuthority } from './state-dir.mjs';

const SURFACE_POLICIES = {
  progress: {
    classification: 'read_only',
    ownedWrites: [],
    explicitLifecycleMutation: 'none',
  },
  plan: {
    classification: 'owned_write',
    ownedWrites: ['research', 'plan'],
    explicitLifecycleMutation: 'none',
    phaseRequired: true,
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

const WORK_PHASE_LINE_RE = /^\s*[-*]\s*\[([ x-])\]\s*\*\*Phase\s+(\d+(?:\.\d+)*[A-Za-z]?):\s*(.+?)\*\*/i;

export function evaluateLifecyclePreflight({
  planningDir,
  surface,
  phaseNumber = null,
  planPath = null,
  planFlagPresent = false,
  duplicatePlanFlag = false,
  expectsMutation = 'none',
  controlMapReport = null,
} = {}) {
  if (!planningDir) {
    throw new Error('planningDir is required');
  }

  const policy = SURFACE_POLICIES[surface];
  if (!policy) {
    throw new Error(`Unsupported lifecycle surface: ${surface}`);
  }

  const lifecycle = evaluateLifecycleState({ planningDir });
  const workspaceRoot = resolve(planningDir, '..');
  const decisionWorkDir = getWorkPaths(workspaceRoot).workDir;
  const nativeMilestoneDir = resolveActiveMilestoneDir(join(workspaceRoot, '.work'));
  const nativePhasesDir = join(nativeMilestoneDir, 'phases');
  const workMilestoneAuthority = inspectWorkMilestone(decisionWorkDir);
  const nativeIdentityPrefix = relative(planningDir, nativePhasesDir).replace(/\\/g, '/');
  const malformedPlanFrontmatter = [];
  const selection = phaseNumber ? resolveLifecyclePhaseSelection({ lifecycle, workspaceRoot, nativePhasesDir, nativeIdentityPrefix, selector: phaseNumber, malformedPlanFrontmatter }) : null;
  const normalizedPhase = selection?.candidate?.phaseToken || (phaseNumber ? normalizePhaseToken(phaseNumber) : null);
  // The selected lane is the authority for every lifecycle consumer.  A
  // brownfield stream intentionally has no ROADMAP phase, so execute and
  // verify must stay on the same lane instead of falling through to the
  // roadmap phase blockers.
  const usesBrownfieldAuthority = ['plan', 'execute', 'verify'].includes(surface)
    && normalizedPhase === 'brownfield-change';
  const usesPlanAmendAuthority = surface === 'plan' && normalizedPhase === 'amend';
  const usesNativeAuthority = selection?.candidate?.authority === 'native';
  const checkpointPath = join(planningDir, '.continue-here.md');
  const stateLabel = createStateLabeler(planningDir);
  const continuityCheckpoint = surface === 'resume'
    ? readContinuityCheckpoint(planningDir)
    : null;
  const resumeWorkCheckpoint = surface === 'resume'
    ? evaluateResumeWorkCheckpoint({ planningDir, checkpointPath, checkpoint: continuityCheckpoint })
    : null;
  const planSelection = planPath
    ? resolveLifecyclePlanSelection({ lifecycle, workspaceRoot, nativePhasesDir, nativeIdentityPrefix, planPath, phaseSelection: selection, malformedPlanFrontmatter })
    : null;
  let workMilestone = normalizedPhase && (usesNativeAuthority || selection?.status !== 'selected')
    ? evaluateWorkMilestoneState({ planningDir, phaseToken: normalizedPhase })
    : null;
  if (usesNativeAuthority && workMilestone) {
    const selectedChain = planSelection?.status === 'selected' ? planSelection.plan.chainKey : null;
    const selectedArtifacts = (selection.candidate.artifacts || []).filter((artifact) => !selectedChain || artifact.chainKey === selectedChain);
    workMilestone = { ...workMilestone, phaseArtifacts: selectedArtifacts, historicalPhaseArtifacts: [] };
  }
  const usesWorkAuthority = Boolean((workMilestone?.phaseEntry && (usesNativeAuthority || selection?.status !== 'selected')) || resumeWorkCheckpoint);
  const usesAlternateAuthority = usesWorkAuthority || usesBrownfieldAuthority || usesPlanAmendAuthority;
  const ownedWrites = usesPlanAmendAuthority
    ? [...policy.ownedWrites, 'roadmap', 'phase-directories']
    : policy.ownedWrites;
  const specPath = join(planningDir, 'SPEC.md');
  const milestonesPath = join(planningDir, 'MILESTONES.md');
  const blockers = [];

  const malformedPlans = [
    ...(lifecycle.malformedPlanFrontmatter || []),
    ...malformedPlanFrontmatter,
    ...(workMilestone?.malformedPlanFrontmatter || []),
  ].filter((issue, index, all) => all.findIndex((candidate) => candidate.path === issue.path) === index);
  blockers.push(...buildMalformedPlanBlockers(malformedPlans));

  if (selection?.status === 'ambiguous') {
    blockers.push(blocker(
      'ambiguous_phase_selector',
      `Phase selector ${phaseNumber} matches multiple current identities; use one of: ${selection.choices.join(', ')}.`,
      selection.choices
    ));
  } else if (selection && !['selected', 'missing'].includes(selection.status)) {
    blockers.push(blocker(
      selection.reason || 'invalid_phase_selector',
      `Phase selector ${phaseNumber} is not an emitted lifecycle identity.`,
      []
    ));
  }
  if (planFlagPresent && (duplicatePlanFlag || !planPath || planPath.startsWith('--'))) {
    blockers.push(blocker('invalid_plan_selector', 'The --plan option requires one emitted PLAN path.', []));
  } else if (planSelection && planSelection.status !== 'selected') {
    blockers.push(blocker(
      planSelection.reason || 'missing_plan_selector',
      `Plan selector ${planPath} does not identify one current PLAN chain.`,
      []
    ));
  }

  if (!existsSync(planningDir)) {
    blockers.push(blocker('missing_planning_dir', `${stateLabel('.')} does not exist yet.`, [stateLabel('.')]));
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

  if (usesBrownfieldAuthority) {
    if (!lifecycle.brownfieldChange?.exists) {
      blockers.push(
        blocker(
          'missing_brownfield_change',
          `Brownfield-change planning requires an active ${stateLabel('brownfield-change', 'CHANGE.md')} continuity anchor.`,
          [stateLabel('brownfield-change', 'CHANGE.md')]
        )
      );
    } else if (surface !== 'verify' && String(lifecycle.brownfieldChange.currentStatus || '').toLowerCase() === 'closed') {
      blockers.push(
        blocker(
          'brownfield_change_closed',
          'Brownfield-change planning cannot continue because CHANGE.md marks the change closed.',
          [stateLabel('brownfield-change', 'CHANGE.md')]
        )
      );
    } else if ((lifecycle.brownfieldChange.contractErrors || []).length > 0) {
      blockers.push(
        blocker(
          'brownfield_contract_invalid',
          'Brownfield CHANGE.md is missing a required bounded-change contract field or contains competing operational authority.',
          [stateLabel('brownfield-change', 'CHANGE.md')]
        )
      );
    } else if (lifecycle.brownfieldChange.wideningRequested) {
      blockers.push(blocker(
        'brownfield_change_widening',
        'The bounded change requests milestone-sized widening; route through the explicit milestone workflow before continuing.',
        [stateLabel('brownfield-change', 'CHANGE.md')]
      ));
    } else if (surface === 'execute' && lifecycle.brownfieldChange.currentStatus !== 'active') {
      blockers.push(
        blocker(
          'brownfield_not_active',
          `Brownfield execution requires CHANGE.md posture active, not ${lifecycle.brownfieldChange.currentStatus || 'unknown'}.`,
          [stateLabel('brownfield-change', 'CHANGE.md')]
        )
      );
    } else if (surface === 'verify' && !['ready_for_verification', 'closed'].includes(lifecycle.brownfieldChange.currentStatus)) {
      blockers.push(
        blocker(
          'brownfield_not_ready',
          'Brownfield verification requires CHANGE.md posture ready_for_verification or closed.',
          [stateLabel('brownfield-change', 'CHANGE.md')]
        )
      );
    }
  }

  if (usesBrownfieldAuthority && workMilestoneAuthority.exists) {
    blockers.push(blocker(
      'authority_conflict',
      'Active brownfield-change authority and .work/milestone authority both exist; continuing would silently choose between two continuity roots.',
      [
        stateLabel('brownfield-change', 'CHANGE.md'),
        stateLabel('milestone', 'MILESTONE.md'),
        stateLabel('milestone', 'ROADMAP.md'),
      ]
    ));
  }

  if (normalizedPhase && !usesBrownfieldAuthority && !usesPlanAmendAuthority) {
    blockers.push(
      ...(usesWorkAuthority
        ? buildWorkPhaseBlockers({ workMilestone, phaseToken: normalizedPhase, surface, planSelection })
        : buildPhaseBlockers({ lifecycle, phaseToken: normalizedPhase, surface, stateLabel, selection, planSelection }))
    );
  }

  if (surface === 'audit-milestone') {
    blockers.push(...buildRoadmapAlignmentBlockers(lifecycle, stateLabel));
    blockers.push(...buildAuditBlockers(lifecycle, { stateLabel }));
  }

  if (surface === 'complete-milestone') {
    blockers.push(...buildRoadmapAlignmentBlockers(lifecycle, stateLabel));
    blockers.push(...buildAuditBlockers(lifecycle, { allowArchivedBlocker: true, stateLabel }));
    blockers.push(...buildCompletionBlockers(planningDir, lifecycle));
  }

  if (surface === 'new-milestone') {
    blockers.push(...buildRoadmapAlignmentBlockers(lifecycle, stateLabel));
    if (!existsSync(specPath)) {
      blockers.push(blocker('missing_spec', 'SPEC.md is required before starting a new milestone.', [stateLabel('SPEC.md')]));
    }
    if (!existsSync(milestonesPath)) {
      blockers.push(blocker('missing_milestones', 'MILESTONES.md is required before starting a new milestone.', [stateLabel('MILESTONES.md')]));
    }
    if (lifecycle.currentMilestone.version && lifecycle.currentMilestone.archiveState !== 'archived') {
      blockers.push(
        blocker(
          'active_milestone_in_progress',
          `Milestone ${lifecycle.currentMilestone.version} is still active. Archive or remove the active roadmap before starting the next milestone.`,
          [stateLabel('ROADMAP.md')]
        )
      );
    }
  }

  if (surface === 'resume' && continuityCheckpoint?.status === 'absent' && lifecycle.nonPhaseState !== 'active_brownfield_change') {
    const checkpointLabel = stateLabel('.continue-here.md');
    const brownfieldLabel = stateLabel('brownfield-change', 'CHANGE.md');
    blockers.push(blocker('missing_checkpoint', `resume requires ${checkpointLabel} unless an active ${brownfieldLabel} continuity anchor exists.`, [checkpointLabel, brownfieldLabel]));
  }
  if (surface === 'resume' && continuityCheckpoint && ['malformed', 'unreadable'].includes(continuityCheckpoint.status)) {
    const checkpointLabel = stateLabel('.continue-here.md');
    blockers.push(blocker(
      'malformed_checkpoint',
      `Repair ${checkpointLabel} before resuming; it is present but ${continuityCheckpoint.status} and will not be consumed.`,
      [checkpointLabel]
    ));
  }

  const warnings = [];
  const planningState = null;

  const controlMap = buildPreflightControlMap({
    planningDir,
    policy,
    existingBlockerCodes: new Set(blockers.map((entry) => entry.code)),
    controlMapReport,
  });
  for (const notice of controlMap.notices) {
    if (notice.severity === 'block') blockers.push(notice);
    else warnings.push(notice);
  }

  if (lifecycle.phaseStatusAlignment.mismatches.length > 0) {
    const mismatch = {
      code: 'roadmap_phase_status_mismatch',
      message: `ROADMAP.md overview/detail phase statuses disagree: ${lifecycle.phaseStatusAlignment.mismatches.join('; ')}`,
      artifacts: [stateLabel('ROADMAP.md')],
    };
    if (policy.classification === 'owned_write') blockers.push(blocker(mismatch.code, mismatch.message, mismatch.artifacts));
    else warnings.push(mismatch);
  }

  // Every lifecycle verb consumes the same active-decision digest. The JSON field keeps the
  // existing machine-readable preflight contract intact while making the injected section
  // available to plan, execute, verify, and resume callers alike.
  const decisionsDigest = buildDecisionsDigest({
    workDir: decisionWorkDir,
    phase: normalizedPhase,
    paths: normalizedPhase ? [`phase:${normalizedPhase}`] : [],
  });

  if (decisionsDigest.readErrors.length > 0) {
    const decisionIssue = {
      code: 'decision_store_unreadable',
      message: 'Decision records could not be read or parsed; lifecycle preflight refuses to continue until the decision store is repaired.',
      artifacts: decisionsDigest.readErrors.map((entry) => entry.path),
    };
    if (policy.classification === 'owned_write') blockers.push(blocker(decisionIssue.code, decisionIssue.message, decisionIssue.artifacts));
    else warnings.push(decisionIssue);
  }

  if (surface === 'plan' && blockers.length === 0) {
    persistDecisionsDigest(planningDir, { phase: normalizedPhase, digest: decisionsDigest });
  } else if (surface === 'execute') {
    warnings.push(...evaluateDecisionDispositionWarnings({
      planningDir,
      decisionsDigest,
      planPath: planSelection?.plan?.path || (selection?.status === 'selected' && selection.candidate.plans?.length === 1 ? selection.candidate.plans[0].path : null),
    }));
  }

  return {
    surface,
    phase: normalizedPhase,
    plan: planSelection?.status === 'selected'
      ? (planSelection.emittedPath || `phases/${planSelection.plan.displayPath}`)
      : null,
    classification: policy.classification,
    ownedWrites,
    explicitLifecycleMutation: policy.explicitLifecycleMutation,
    mutationRequest: expectsMutation,
    authority: usesPlanAmendAuthority ? 'plan_amend' : usesBrownfieldAuthority ? 'brownfield_change' : usesWorkAuthority ? 'work_milestone' : 'planning',
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    reason: blockers[0]?.code ?? null,
    blockers,
    warnings,
    decisionsDigest,
    planningState,
    controlMap: controlMap.summary,
    lifecycle: {
      authority: usesPlanAmendAuthority ? 'plan_amend' : usesBrownfieldAuthority ? 'brownfield_change' : usesWorkAuthority ? 'work_milestone' : 'planning',
      currentMilestone: lifecycle.currentMilestone,
      currentPhase: lifecycle.currentPhase ? lifecycle.currentPhase.number : null,
      nextPhase: lifecycle.nextPhase ? lifecycle.nextPhase.number : null,
      counts: lifecycle.counts,
      workMilestone: usesWorkAuthority
        ? {
            phase: workMilestone?.phaseEntry?.number ?? null,
            status: workMilestone?.phaseEntry?.status ?? null,
            roadmapPath: workMilestone?.roadmapPath
              ? relative(resolve(planningDir, '..'), workMilestone.roadmapPath).replace(/\\/g, '/')
              : null,
            milestoneDir: workMilestone?.milestoneDir
              ? relative(resolve(planningDir, '..'), workMilestone.milestoneDir).replace(/\\/g, '/')
              : null,
            source: resumeWorkCheckpoint ? 'checkpoint' : 'phase',
          }
        : null,
      brownfieldChange: usesBrownfieldAuthority
        ? {
            path: stateLabel('brownfield-change', 'CHANGE.md'),
            status: lifecycle.brownfieldChange.currentStatus,
            title: lifecycle.brownfieldChange.title,
            nextAction: lifecycle.brownfieldChange.nextAction,
          }
        : null,
      planAmend: usesPlanAmendAuthority
        ? {
            target: 'amend',
            path: stateLabel('ROADMAP.md'),
          }
        : null,
    },
  };
}

function buildPreflightControlMap({ planningDir, policy, existingBlockerCodes, controlMapReport = null }) {
  const empty = {
    summary: null,
    notices: [],
  };
  if (policy.classification !== 'owned_write' || !existsSync(planningDir)) return empty;

  const map = controlMapReport || buildControlMap({
    workspaceRoot: resolve(planningDir, '..'),
    planningDir,
  });
  const risks = (map.risks || []).filter((risk) => (
    !(existingBlockerCodes.has(risk.code) && risk.severity !== 'block')
  ));
  const stateLabel = createStateLabeler(planningDir);
  const notices = risks.map((risk) => ({
    ...controlMapNotice(risk, stateLabel),
    severity: risk.severity || 'info',
  }));

  return {
    summary: {
      riskCount: map.risks.length,
      noticeCount: notices.length,
      blockerCount: notices.filter((notice) => notice.severity === 'block').length,
      warningCount: notices.filter((notice) => notice.severity !== 'block').length,
      interventions: map.interventions || [],
    },
    notices,
  };
}

function controlMapNotice(risk, stateLabel) {
  return {
    code: risk.code,
    source: 'control-map',
    message: risk.message,
    artifacts: [`node ${stateLabel('bin', 'gsdd.mjs')} control-map --json`],
    risk,
  };
}

function buildPhaseBlockers({ lifecycle, phaseToken, surface, stateLabel, selection = null, planSelection = null }) {
  const blockers = [];
  const phaseEntry = lifecycle.phases.find((phase) => phase.number === phaseToken);
  if (!phaseEntry) {
    blockers.push(
      blocker(
        'missing_phase',
        `Phase ${phaseToken} was not found in the active roadmap.`,
        [stateLabel('ROADMAP.md')]
      )
    );
    return blockers;
  }

  const selectedDir = selection?.status === 'selected' ? selection.candidate.dir : null;
  const selectedChain = planSelection?.plan?.chainKey || null;
  const inSelection = (artifact) => artifact.phaseToken === phaseToken
    && (selectedDir === null || artifact.dir === selectedDir)
    && (!selectedChain || artifact.chainKey === selectedChain);
  const planArtifacts = lifecycle.phaseArtifacts.filter((artifact) => artifact.kind === 'plan' && inSelection(artifact));
  const pendingPlans = lifecycle.incompletePlans.filter(inSelection);

  if (surface === 'execute') {
    if (planArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_plan',
          `Phase ${phaseToken} cannot execute because no PLAN artifact exists.`,
          [stateLabel('phases')]
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

  if (surface === 'plan' && phaseEntry.status === 'done') {
    blockers.push(
      blocker(
        'phase_already_complete',
        `Phase ${phaseToken} is already complete and should not be planned again.`,
        [stateLabel('ROADMAP.md')]
      )
    );
  }

  if (surface === 'verify') {
    if (planArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_plan',
          `Phase ${phaseToken} cannot be verified because no PLAN artifact exists.`,
          [stateLabel('phases')]
        )
      );
    }
    if (pendingPlans.length > 0) {
      blockers.push(
        blocker(
          'missing_summary',
          `Phase ${phaseToken} cannot be verified because a current PLAN lacks its matching SUMMARY artifact.`,
          pendingPlans.map((artifact) => artifact.displayPath)
        )
      );
    }
  }

  return blockers;
}

function evaluateWorkMilestoneState({ planningDir, phaseToken }) {
  const workspaceRoot = resolve(planningDir, '..');
  const milestoneDir = resolveActiveMilestoneDir(join(workspaceRoot, '.work'));
  const roadmapPath = join(milestoneDir, 'ROADMAP.md');
  const phasesDir = join(milestoneDir, 'phases');

  if (!existsSync(roadmapPath)) {
    const allPhaseArtifacts = collectWorkPhaseArtifacts({ workspaceRoot, phasesDir });
    const malformedPlanFrontmatter = [];
    const partitioned = partitionPlanChains(allPhaseArtifacts, { companionKinds: ['execute', 'verification'], malformedPlanFrontmatter });
    const allPlanArtifacts = allPhaseArtifacts.filter((artifact) => artifact.kind === 'plan');
    if (allPlanArtifacts.length === 0) return null;
    const phases = deriveWorkPlanPhases(allPlanArtifacts);
    const phaseEntry = phases.find((phase) => phase.number === phaseToken);
    if (!phaseEntry) return null;
    return {
      milestoneDir,
      roadmapPath,
      phasesDir,
      phases,
      phaseEntry,
      phaseArtifacts: partitioned.currentArtifacts.filter((artifact) => artifact.phaseToken === phaseToken),
      historicalPhaseArtifacts: partitioned.historicalArtifacts.filter((artifact) => artifact.phaseToken === phaseToken),
      malformedPlanFrontmatter,
      roadmapFallback: true,
    };
  }

  const phases = parseWorkRoadmapPhases(readFileSync(roadmapPath, 'utf-8'));
  const phaseEntry = phases.find((phase) => phase.number === phaseToken);
  if (!phaseEntry) {
    return null;
  }

  const allPhaseArtifacts = collectWorkPhaseArtifacts({ workspaceRoot, phasesDir, phaseToken });
  const malformedPlanFrontmatter = [];
  const partitioned = partitionPlanChains(allPhaseArtifacts, { companionKinds: ['execute', 'verification'], malformedPlanFrontmatter });
  return {
    milestoneDir,
    roadmapPath,
    phasesDir,
    phases,
    phaseEntry,
    phaseArtifacts: partitioned.currentArtifacts,
    historicalPhaseArtifacts: partitioned.historicalArtifacts,
    malformedPlanFrontmatter,
    roadmapFallback: false,
  };
}

function deriveWorkPlanPhases(planArtifacts) {
  const phases = new Map();
  for (const artifact of planArtifacts) {
    if (phases.has(artifact.phaseToken)) continue;
    let frontmatter;
    try {
      frontmatter = parsePlanFrontmatter(readFileSync(artifact.path, 'utf-8'));
    } catch {
      frontmatter = { status: null };
    }
    phases.set(artifact.phaseToken, {
      number: artifact.phaseToken,
      title: artifact.displayPath,
      status: normalizePlanPhaseStatus(frontmatter.status),
    });
  }
  return [...phases.values()];
}

function normalizePlanPhaseStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (['done', 'complete', 'completed', 'shipped', 'verified'].includes(status)) return 'done';
  if (['in_progress', 'active'].includes(status)) return 'in_progress';
  return 'pending';
}

function parseWorkRoadmapPhases(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const match = line.match(WORK_PHASE_LINE_RE);
      if (!match) return null;
      return {
        status: parseWorkPhaseStatus(match[1]),
        number: normalizePhaseToken(match[2]),
        title: match[3].trim(),
      };
    })
    .filter(Boolean);
}

function parseWorkPhaseStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'x') return 'done';
  if (status === '-') return 'in_progress';
  return 'pending';
}

function evaluateResumeWorkCheckpoint({ planningDir, checkpointPath, checkpoint }) {
  if (!existsSync(checkpointPath) || checkpoint?.status !== 'valid') return null;

  const workspaceRoot = resolve(planningDir, '..');
  const milestoneDir = resolveActiveMilestoneDir(join(workspaceRoot, '.work'));
  const roadmapPath = join(milestoneDir, 'ROADMAP.md');
  if (!existsSync(roadmapPath)) return null;

  const checkpointText = Object.values(checkpoint.sections || {}).join('\n');
  if (!/(^|[`"'(\s])\.work[\\/]+milestone([`"')\s/]|$)/i.test(checkpointText)) {
    return null;
  }

  return {
    milestoneDir,
    roadmapPath,
  };
}

function collectWorkPhaseArtifacts({ workspaceRoot, phasesDir, phaseToken = null }) {
  return collectNativePhaseArtifacts({ workspaceRoot, phasesDir })
    .filter((artifact) => !phaseToken || artifact.phaseToken === phaseToken);
}

function evaluateDecisionDispositionWarnings({ planningDir, decisionsDigest, planPath = null }) {
  const state = readJsonIfExists(join(planningDir, 'state.json'));
  const persisted = state.ok ? state.value?.lastDecisionsDigest : null;
  if (!persisted || !Array.isArray(persisted.records)) return [];

  const dispositions = planPath && existsSync(planPath)
    ? parsePlanFrontmatter(readFileSync(planPath, 'utf-8')).decision_dispositions
    : null;
  const warnings = [];
  const entries = Array.isArray(dispositions) ? dispositions : [];
  const byId = new Map(entries.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  const missing = persisted.records.map((record) => record.id).filter((id) => !byId.has(id));
  if (dispositions === null || missing.length > 0) {
    warnings.push({
      code: 'decision_dispositions_missing',
      message: `PLAN.md decision dispositions are missing for persisted decision(s): ${(missing.length > 0 ? missing : persisted.records.map((record) => record.id)).join(', ')}.`,
      artifacts: planPath ? [planPath] : [],
    });
  }

  const currentRecords = Array.isArray(decisionsDigest?.records) ? decisionsDigest.records : [];
  const currentById = new Map(currentRecords.map((record) => [record.id, record]));
  const stale = [];
  for (const persistedRecord of persisted.records) {
    const record = currentById.get(persistedRecord.id);
    const disposition = byId.get(persistedRecord.id);
    if (!record) {
      stale.push(`${persistedRecord.id}: record was removed or is no longer owner-asserted`);
      continue;
    }
    for (const field of ['id', 'hash', 'status', 'authority', 'authority_fingerprint']) {
      if (record[field] !== persistedRecord[field]) {
        stale.push(`${persistedRecord.id}: ${field} changed since the persisted authority snapshot`);
        break;
      }
    }
    if (disposition && disposition.hash !== persistedRecord.hash) stale.push(`${persistedRecord.id}: PLAN body hash differs from the persisted authority snapshot`);
    if (disposition && disposition.authority_fingerprint !== persistedRecord.authority_fingerprint) stale.push(`${persistedRecord.id}: PLAN authority fingerprint differs from the persisted authority snapshot`);
  }
  for (const record of currentRecords) {
    if (!persisted.records.some((persistedRecord) => persistedRecord.id === record.id)) {
      stale.push(`${record.id}: new owner-asserted decision was added after the persisted authority snapshot`);
    }
  }
  if (stale.length > 0) {
    warnings.push({
      code: 'decision_ack_stale',
      message: `Decision acknowledgements are stale: ${stale.join('; ')}.`,
      artifacts: planPath ? [planPath] : [],
    });
  }
  return warnings;
}

function buildWorkPhaseBlockers({ workMilestone, phaseToken, surface, planSelection = null }) {
  const blockers = [];
  const selectedChain = planSelection?.status === 'selected' ? planSelection.plan.chainKey : null;
  const selectedArtifacts = workMilestone.phaseArtifacts.filter((artifact) => !selectedChain || artifact.chainKey === selectedChain);
  const planArtifacts = selectedArtifacts.filter((artifact) => artifact.kind === 'plan');
  const executeArtifacts = selectedArtifacts.filter((artifact) => artifact.kind === 'execute');
  const pendingPlans = findUnpairedPlanArtifacts(selectedArtifacts, { companionKind: 'execute' });

  if (surface === 'execute') {
    if (planArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_plan',
          `Phase ${phaseToken} cannot execute because no .work PLAN artifact exists.`,
          ['.work/milestone/phases/']
        )
      );
    } else if (pendingPlans.length === 0) {
      blockers.push(
        blocker(
          'no_pending_plan',
          `Phase ${phaseToken} has already been executed in .work/milestone.`,
          executeArtifacts.map((artifact) => artifact.displayPath)
        )
      );
    }
  }

  if (surface === 'plan' && workMilestone.phaseEntry.status === 'done') {
    blockers.push(
      blocker(
        'phase_already_complete',
        `Phase ${phaseToken} is already complete in .work/milestone and should not be planned again.`,
        ['.work/milestone/ROADMAP.md']
      )
    );
  }

  if (surface === 'verify') {
    if (planArtifacts.length === 0) {
      blockers.push(
        blocker(
          'missing_plan',
          `Phase ${phaseToken} cannot be verified because no .work PLAN artifact exists.`,
          ['.work/milestone/phases/']
        )
      );
    }
    if ((planArtifacts.length === 0 && executeArtifacts.length === 0) || pendingPlans.length > 0) {
      blockers.push(
        blocker(
          'missing_execute',
          pendingPlans.length > 0
            ? `Phase ${phaseToken} cannot be verified because a .work PLAN lacks its matching EXECUTE artifact.`
            : `Phase ${phaseToken} cannot be verified because no .work EXECUTE artifact exists yet.`,
          pendingPlans.length > 0
            ? pendingPlans.map((artifact) => artifact.displayPath)
            : ['.work/milestone/phases/']
        )
      );
    }
  }

  return blockers;
}

function buildRoadmapAlignmentBlockers(lifecycle, stateLabel) {
  if (lifecycle.phaseStatusAlignment.mismatches.length === 0) return [];
  return [
    blocker(
      'roadmap_phase_status_mismatch',
      `ROADMAP.md overview/detail phase statuses disagree: ${lifecycle.phaseStatusAlignment.mismatches.join('; ')}`,
      [stateLabel('ROADMAP.md')]
    ),
  ];
}

function buildMalformedPlanBlockers(issues) {
  return issues.map((issue) => blocker(
    'malformed_plan_frontmatter',
    `${issue.displayPath} has malformed retained PLAN frontmatter (${issue.error}). ${issue.repair}`,
    [issue.displayPath],
  ));
}

function buildAuditBlockers(lifecycle, { allowArchivedBlocker = false, stateLabel } = {}) {
  const blockers = [];
  if (!lifecycle.currentMilestone.version) {
    blockers.push(blocker('missing_milestone', 'No active or retained milestone could be derived from ROADMAP.md.', [stateLabel('ROADMAP.md')]));
    return blockers;
  }

  if (lifecycle.currentMilestone.archiveState === 'archived') {
    blockers.push(
      blocker(
        allowArchivedBlocker ? 'milestone_already_archived' : 'milestone_already_archived',
        `Milestone ${lifecycle.currentMilestone.version} is already archived-with-ROADMAP.md evidence.`,
        [stateLabel('ROADMAP.md'), stateLabel('MILESTONES.md')]
      )
    );
  }

  if (lifecycle.counts.total === 0) {
    blockers.push(blocker('missing_phases', 'No active milestone phases were found in ROADMAP.md.', [stateLabel('ROADMAP.md')]));
  } else if (lifecycle.counts.completed !== lifecycle.counts.total) {
    blockers.push(
      blocker(
        'incomplete_phases',
        `Milestone ${lifecycle.currentMilestone.version} still has incomplete phases (${lifecycle.counts.completed}/${lifecycle.counts.total} complete).`,
        [stateLabel('ROADMAP.md')]
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
        [stateLabel('phases')]
      )
    );
  }

  return blockers;
}

function buildCompletionBlockers(planningDir, lifecycle) {
  const stateLabel = createStateLabeler(planningDir);
  const auditPath = join(planningDir, `${lifecycle.currentMilestone.version}-MILESTONE-AUDIT.md`);
  if (!existsSync(auditPath)) {
    return [
      blocker(
        'missing_milestone_audit',
        `Milestone ${lifecycle.currentMilestone.version} cannot be completed without a milestone audit artifact.`,
        [stateLabel(`${lifecycle.currentMilestone.version}-MILESTONE-AUDIT.md`)]
      ),
    ];
  }

  const auditContent = readFileSync(auditPath, 'utf-8');
  const auditFrontmatter = extractFrontmatter(auditContent);
  const auditStatus = readTopLevelScalar(auditFrontmatter || auditContent, 'status');
  if (auditStatus !== 'passed') {
    return [
      blocker(
        'audit_not_passed',
        `Milestone ${lifecycle.currentMilestone.version} requires a passed audit before completion.`,
        [stateLabel(`${lifecycle.currentMilestone.version}-MILESTONE-AUDIT.md`)]
      ),
    ];
  }

  return [];
}

function extractFrontmatter(content) {
  const match = String(content || '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function readTopLevelScalar(frontmatter, key) {
  const match = String(frontmatter || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? cleanYamlValue(match[1]) : null;
}

function cleanYamlValue(value) {
  return stripInlineYamlComment(String(value || ''))
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function stripInlineYamlComment(value) {
  let current = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote) {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (char === '#' && !quote && (index === 0 || /\s/.test(value[index - 1]))) {
      return current.trimEnd();
    }
    current += char;
  }

  return current;
}

function blocker(code, message, artifacts) {
  return { code, message, artifacts };
}

function createStateLabeler(planningDir) {
  const workspaceRoot = resolve(planningDir, '..');
  return (...segments) => {
    const targetPath = resolve(join(planningDir, ...segments));
    const label = relative(workspaceRoot, targetPath);
    if (label === '') return '.';
    if (!label.startsWith('..') && !isAbsolute(label)) return label.replace(/\\/g, '/');
    return targetPath.replace(/\\/g, '/');
  };
}

export function cmdLifecyclePreflight(...args) {
  const { args: normalizedArgs, planningDir, state, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  try {
    assertStateAuthority(state);
  } catch (authorityError) {
    console.error(authorityError.message);
    process.exitCode = 1;
    return;
  }
  const [surface, maybePhase, ...rest] = normalizedArgs;
  const stateLabel = createStateLabeler(planningDir);

  if (!surface) {
    console.error(`Usage: node ${stateLabel('bin', 'gsdd.mjs')} lifecycle-preflight <surface> [phase] [--expects-mutation <none|phase-status>]`);
    process.exitCode = 1;
    return;
  }

  let phaseNumber = maybePhase && !maybePhase.startsWith('--') ? maybePhase : null;
  let expectsMutation = 'none';
  let planPath = null;
  let planFlagPresent = false;
  let duplicatePlanFlag = false;

  const flagArgs = phaseNumber ? rest : [maybePhase, ...rest].filter(Boolean);
  for (let index = 0; index < flagArgs.length; index += 1) {
    const arg = flagArgs[index];
    if (arg === '--expects-mutation') {
      expectsMutation = flagArgs[index + 1] ?? 'none';
      index += 1;
    } else if (arg === '--plan') {
      if (planFlagPresent) duplicatePlanFlag = true;
      planFlagPresent = true;
      planPath = flagArgs[index + 1] ?? null;
      index += 1;
    }
  }

  try {
    const result = evaluateLifecyclePreflight({ planningDir, surface, phaseNumber, planPath, planFlagPresent, duplicatePlanFlag, expectsMutation });
    output(result);
    if (!result.allowed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function normalizeLifecyclePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function readArtifactMetadata(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const metadata = {};
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const source = frontmatter ? frontmatter[1] : content;
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(status|result|approved|approval_status|authority|approved_by|completed|verification_status)\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, '').trim();
    metadata[match[1].toLowerCase()] = value;
  }
  return { content, metadata };
}

function lifecycleArtifactKind(filePath) {
  const name = filePath.split(/[\\/]/).pop().toUpperCase();
  const normalized = normalizeLifecyclePath(filePath).toLowerCase();
  if (normalized.includes('/brownfield-change/')) {
    if (name === 'CHANGE.MD') return 'brownfield_plan';
    if (name === 'HANDOFF.MD') return 'brownfield_context';
    if (name === 'VERIFICATION.MD') return 'brownfield_verification';
  }
  if (name === 'PLAN.MD' || /-PLAN\.MD$/.test(name)) return 'plan';
  if (name === 'SUMMARY.MD' || name === 'EXECUTE.MD' || /-(SUMMARY|EXECUTE)\.MD$/.test(name)) return 'execution';
  if (name === 'VERIFICATION.MD' || name === 'VERIFY.MD' || /-(VERIFICATION|VERIFY)\.MD$/.test(name)) return 'verification';
  return null;
}

function sameArtifactChain(planPath, artifactPath) {
  const planFile = planPath.split(/[\\/]/).pop();
  const artifactFile = artifactPath.split(/[\\/]/).pop();
  const planDir = planPath.slice(0, Math.max(0, planPath.length - planFile.length));
  const artifactDir = artifactPath.slice(0, Math.max(0, artifactPath.length - artifactFile.length));
  if (/[/\\]brownfield-change[/\\]CHANGE\.md$/i.test(planPath)
    && /[/\\]brownfield-change[/\\]VERIFICATION\.md$/i.test(artifactPath)) return true;
  if (planDir !== artifactDir) return false;
  if (planFile.toUpperCase() === 'PLAN.MD') return ['EXECUTE.MD', 'SUMMARY.MD', 'VERIFY.MD', 'VERIFICATION.MD'].includes(artifactFile.toUpperCase());
  const planName = planFile.replace(/\.md$/i, '').replace(/-PLAN$/i, '');
  const artifactName = artifactFile.replace(/\.md$/i, '').replace(/-(SUMMARY|EXECUTE|VERIFICATION|VERIFY)$/i, '');
  return planName === artifactName;
}

function metadataStatus(metadata) {
  return String(metadata.status || metadata.result || metadata.verification_status || '').toLowerCase().replace(/[-\s]+/g, '_');
}

function assertBrownfieldTransitionContract({ planningDir, target, plan }) {
  const brownfield = evaluateLifecycleState({ planningDir }).brownfieldChange;
  if ((brownfield.contractErrors || []).length > 0) {
    throw transitionErrorForCli('brownfield_contract_invalid', 'Brownfield CHANGE.md is missing a required bounded-change contract field.', brownfield.contractErrors);
  }
  if (brownfield.wideningRequested) {
    throw transitionErrorForCli('brownfield_change_widening', 'Brownfield change requests milestone-sized widening; use the explicit milestone workflow.', [plan.relative]);
  }
  if (target === 'execute' && brownfield.currentStatus !== 'active') {
    throw transitionErrorForCli('brownfield_not_active', `Brownfield execution requires CHANGE.md posture active, not ${brownfield.currentStatus || 'unknown'}.`, [plan.relative]);
  }
  if (target === 'audit' || target === 'next') {
    if (brownfield.currentStatus !== 'ready_for_verification' && brownfield.currentStatus !== 'closed') {
      throw transitionErrorForCli('brownfield_not_ready', 'Brownfield closeout requires CHANGE.md posture ready_for_verification or closed.', [plan.relative]);
    }
  }
}

function validateTransitionArtifact({ planningDir, target, planArg, artifactArg, authority, approvalRef, approvalRefProvided = false, approved = false, approvalRequested = false }) {
  const workspaceRoot = resolve(planningDir, '..');
  const stateLabel = createStateLabeler(planningDir);
  if (!planArg && !['blocked', 'ask_user'].includes(target)) {
    throw transitionErrorForCli('missing_plan_artifact', 'Lifecycle transition requires --plan <path>.', ['--plan']);
  }
  if (!authority && !['blocked', 'ask_user'].includes(target)) {
    throw transitionErrorForCli('missing_authority', 'Lifecycle transition requires --authority <owner|workflow|repo>.', ['--authority']);
  }
  const resolveInside = (value, label) => {
    const resolvedPath = resolve(workspaceRoot, value || '');
    const relativePath = normalizeLifecyclePath(relative(workspaceRoot, resolvedPath));
    if (!value || !relativePath || relativePath.startsWith('../') || relativePath === '..' || isAbsolute(relativePath)) {
      throw transitionErrorForCli('invalid_artifact_path', `${label} must be a workspace-relative artifact path.`, [String(value || label)]);
    }
    if (!existsSync(resolvedPath)) throw transitionErrorForCli('missing_artifact', `${label} does not exist: ${relativePath}.`, [relativePath]);
    return { path: resolvedPath, relative: relativePath };
  };
  const plan = planArg ? resolveInside(planArg, 'Plan artifact') : null;
  const artifact = artifactArg ? resolveInside(artifactArg, 'Lifecycle artifact') : null;
  const targetKind = target === 'plan' || target === 'execute' || target === 'approve' ? 'plan'
    : target === 'verify' ? 'execution'
      : ['audit', 'next', 'fix_gaps'].includes(target) ? 'verification' : null;
  if (['verify', 'audit', 'next', 'fix_gaps'].includes(target) && !artifactArg) {
    throw transitionErrorForCli('missing_artifact', `${target} lifecycle transition requires --artifact <path>.`, ['--artifact']);
  }
  const artifactKind = artifact ? lifecycleArtifactKind(artifact.path) : null;
  const planKind = plan ? lifecycleArtifactKind(plan.path) : null;
  const brownfieldChain = planKind === 'brownfield_plan';
  const artifactKindAllowed = target === 'verify' && brownfieldChain
    ? ['brownfield_verification', 'brownfield_plan'].includes(artifactKind)
    : targetKind === 'verification' && brownfieldChain
      ? artifactKind === 'brownfield_verification'
      : targetKind === 'plan' && brownfieldChain
        ? ['brownfield_plan', 'brownfield_context'].includes(artifactKind)
        : artifactKind === targetKind;
  if (targetKind && artifact && !artifactKindAllowed) {
    throw transitionErrorForCli('wrong_artifact_kind', `${target} requires a ${targetKind} artifact, not ${normalizeLifecyclePath(artifact.relative)}.`, [artifact.relative]);
  }
  if (targetKind === 'plan' && !['plan', 'brownfield_plan'].includes(planKind)) {
    throw transitionErrorForCli('wrong_plan_kind', `--plan must identify a PLAN artifact: ${plan.relative}.`, [plan.relative]);
  }
  if (targetKind && artifact && plan && !sameArtifactChain(plan.relative, artifact.relative)) {
    throw transitionErrorForCli('wrong_artifact_identity', 'Plan and lifecycle artifact belong to different lifecycle chains.', [plan.relative, artifact.relative]);
  }
  const planMeta = plan ? readArtifactMetadata(plan.path) : null;
  const artifactMeta = artifact ? readArtifactMetadata(artifact.path) : null;
  const planStatus = metadataStatus(planMeta?.metadata || {});
  const artifactStatus = metadataStatus(artifactMeta?.metadata || {});
  const durableWorkflowApproval = target === 'execute' && plan
    ? hasDurableWorkflowApproval(planningDir, plan.relative)
    : false;
  const normalizedApprovalRef = normalizeApprovalReference(approvalRef);
  if (target === 'execute' && approvalRefProvided) {
    throw transitionErrorForCli('approval_ref_not_allowed', 'Execute cannot supply or replace the owner-recorded approval reference.', ['--approval-ref']);
  }
  if (approvalRequested && (authority !== 'owner' || !isValidApprovalReference(normalizedApprovalRef))) {
    throw transitionErrorForCli('owner_approval_required', 'Explicit approval requires --authority owner and a valid non-sensitive --approval-ref.', ['--authority owner', '--approval-ref']);
  }
  if (authority !== 'owner' && normalizedApprovalRef) {
    throw transitionErrorForCli('approval_ref_authority_mismatch', 'Only owner authority may carry an approval reference.', ['--authority owner', '--approval-ref']);
  }
  let preWriteGuard = null;
  if (brownfieldChain && target !== 'blocked' && target !== 'ask_user') {
    preWriteGuard = () => assertBrownfieldTransitionContract({ planningDir, target, plan });
    preWriteGuard();
  }
  const explicitOwnerApproval = target === 'approve'
    && approved === true
    && authority === 'owner'
    && isValidApprovalReference(normalizedApprovalRef);
  if (target === 'execute' && !durableWorkflowApproval && !explicitOwnerApproval) {
    throw transitionErrorForCli('not_approved', 'The supplied PLAN is durable but has no owner-recorded approval for this exact plan identity.', [plan.relative]);
  }
  if (target === 'approve' && !['approved', 'accepted', 'complete'].includes(planStatus) && artifactStatus !== 'approved' && !durableWorkflowApproval && !explicitOwnerApproval) {
    throw transitionErrorForCli('not_approved', 'The supplied PLAN is durable but not approved; record approval before execution.', [plan.relative]);
  }
  if (target === 'verify' && !['complete', 'completed', 'done', 'passed', 'pass'].includes(artifactStatus)) {
    throw transitionErrorForCli('execution_incomplete', 'The supplied execution artifact is not marked complete.', [artifact.relative]);
  }
  if (['audit', 'next'].includes(target) && !['passed', 'pass', 'complete', 'completed'].includes(artifactStatus)) {
    throw transitionErrorForCli('verification_not_passed', 'The supplied verification artifact is not marked passed.', [artifact.relative]);
  }
  if (target === 'fix_gaps' && !['gaps_found', 'human_needed', 'blocked', 'failed', 'fail'].includes(artifactStatus)) {
    throw transitionErrorForCli('gaps_not_recorded', 'The supplied verification artifact does not record gaps or a human gate.', [artifact.relative]);
  }
  return {
    workspaceRoot,
    plan,
    artifact,
    planIdentity: plan?.relative || null,
    artifactIdentity: artifact?.relative || null,
    authority: authority || planMeta?.metadata?.authority || null,
    approvalRef: authority === 'owner' ? normalizedApprovalRef || null : null,
    approvalRequested,
    preWriteGuard,
    stateLabel,
  };
}

function transitionErrorForCli(code, message, evidence = []) {
  const error = new Error(message);
  error.code = code;
  error.evidence = evidence;
  return error;
}

export function cmdLifecycleTransition(...args) {
  const { args: normalizedArgs, planningDir, state, invalid, error } = resolveWorkspaceContext(args);
  const jsonMode = normalizedArgs.includes('--json');
  const respond = (value) => {
    if (jsonMode) output(value);
    else if (value.status === 'ok' || value.status === 'replayed') console.log(`Lifecycle transition ${value.status}: ${value.state?.current_state || value.target}.`);
    else console.error(`Lifecycle transition blocked: ${value.error}`);
  };
  if (invalid) {
    respond({ schema_version: 1, operation: 'lifecycle-transition', status: 'error', error });
    process.exitCode = 1;
    return;
  }
  try {
    assertStateAuthority(state);
    if (normalizedArgs.includes('--help') || normalizedArgs[0] === 'help') {
      console.log('Usage: lifecycle-transition <plan|approve|execute|verify|audit|next|fix_gaps|blocked|ask_user> --plan <path> [--artifact <path>] --authority <value> [--reason <text>] [--question <text>] [--json]');
      return;
    }
    const target = String(normalizedArgs.find((arg) => !arg.startsWith('--')) || '').toLowerCase();
    if (!target || target === 'help') throw transitionErrorForCli('usage', 'Usage: lifecycle-transition <plan|approve|execute|verify|audit|next|fix_gaps|blocked|ask_user> --plan <path> [--artifact <path>] --authority <value> [--reason <text>] [--json]');
    const flag = (name) => {
      const index = normalizedArgs.indexOf(name);
      return index === -1 ? null : normalizedArgs[index + 1] || null;
    };
    const planArg = flag('--plan');
    const artifactArg = flag('--artifact');
    const authority = flag('--authority');
    const approvalRef = flag('--approval-ref');
    const approvalRefProvided = normalizedArgs.includes('--approval-ref');
    const reason = flag('--reason');
    const question = flag('--question');
    const approved = String(flag('--approved') || '').toLowerCase() === 'true' || target === 'approve';
    const approvalRequested = target === 'approve' || String(flag('--approved') || '').toLowerCase() === 'true';
    const validated = validateTransitionArtifact({ planningDir, target, planArg, artifactArg, authority, approvalRef, approvalRefProvided, approved, approvalRequested });
    const result = transitionWorkflowState(getWorkPaths(validated.workspaceRoot).workDir, {
      target,
      planPath: validated.plan?.relative || null,
      planIdentity: validated.planIdentity,
      artifactPath: validated.artifact?.relative || null,
      artifactIdentity: validated.artifactIdentity,
      authority: validated.authority,
      approvalRef: validated.approvalRef,
      reason,
      question,
      approved,
      preWriteGuard: validated.preWriteGuard,
    });
    respond({ schema_version: 1, operation: 'lifecycle-transition', target, ...result, evidence: [validated.plan?.relative, validated.artifact?.relative].filter(Boolean) });
    if (result.status === 'error') process.exitCode = 1;
  } catch (transitionError) {
    const response = {
      schema_version: 1,
      operation: 'lifecycle-transition',
      status: 'error',
      error_code: transitionError.code || 'transition_blocked',
      error: transitionError.message,
      evidence: transitionError.evidence || [],
      changed: false,
    };
    respond(response);
    process.exitCode = 1;
  }
}
