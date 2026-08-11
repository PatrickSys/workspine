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
  persistDecisionsDigest,
  readDecisionRecords,
  readJsonIfExists,
  resolveActiveMilestoneDir,
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
  const nativeIdentityPrefix = relative(planningDir, nativePhasesDir).replace(/\\/g, '/');
  const selection = phaseNumber ? resolveLifecyclePhaseSelection({ lifecycle, workspaceRoot, nativePhasesDir, nativeIdentityPrefix, selector: phaseNumber }) : null;
  const normalizedPhase = selection?.candidate?.phaseToken || (phaseNumber ? normalizePhaseToken(phaseNumber) : null);
  const usesBrownfieldAuthority = surface === 'plan' && normalizedPhase === 'brownfield-change';
  const usesPlanAmendAuthority = surface === 'plan' && normalizedPhase === 'amend';
  const usesNativeAuthority = selection?.candidate?.authority === 'native';
  const checkpointPath = join(planningDir, '.continue-here.md');
  const stateLabel = createStateLabeler(planningDir);
  const resumeWorkCheckpoint = surface === 'resume'
    ? evaluateResumeWorkCheckpoint({ planningDir, checkpointPath })
    : null;
  const planSelection = planPath
    ? resolveLifecyclePlanSelection({ lifecycle, workspaceRoot, nativePhasesDir, nativeIdentityPrefix, planPath, phaseSelection: selection })
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
    } else if (String(lifecycle.brownfieldChange.currentStatus || '').toLowerCase() === 'closed') {
      blockers.push(
        blocker(
          'brownfield_change_closed',
          'Brownfield-change planning cannot continue because CHANGE.md marks the change closed.',
          [stateLabel('brownfield-change', 'CHANGE.md')]
        )
      );
    }
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

  if (surface === 'resume' && !existsSync(checkpointPath) && lifecycle.nonPhaseState !== 'active_brownfield_change') {
    const checkpointLabel = stateLabel('.continue-here.md');
    const brownfieldLabel = stateLabel('brownfield-change', 'CHANGE.md');
    blockers.push(blocker('missing_checkpoint', `resume requires ${checkpointLabel} unless an active ${brownfieldLabel} continuity anchor exists.`, [checkpointLabel, brownfieldLabel]));
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

  if (!usesAlternateAuthority && lifecycle.phaseStatusAlignment.mismatches.length > 0) {
    warnings.push({
      code: 'roadmap_phase_status_mismatch',
      message: `ROADMAP.md overview/detail phase statuses disagree: ${lifecycle.phaseStatusAlignment.mismatches.join('; ')}`,
      artifacts: [stateLabel('ROADMAP.md')],
    });
  }

  // Every lifecycle verb consumes the same active-decision digest. The JSON field keeps the
  // existing machine-readable preflight contract intact while making the injected section
  // available to plan, execute, verify, and resume callers alike.
  const decisionsDigest = buildDecisionsDigest({
    workDir: decisionWorkDir,
    phase: normalizedPhase,
    paths: normalizedPhase ? [`phase:${normalizedPhase}`] : [],
  });

  if (decisionsDigest.directoryUnreadable) {
    warnings.push({
      code: 'decision_store_unreadable',
      message: 'Decision store could not be enumerated; lifecycle preflight continues with an empty digest.',
      artifacts: decisionsDigest.readErrors.map((entry) => entry.path),
    });
  }

  if (surface === 'plan') {
    persistDecisionsDigest(planningDir, { phase: normalizedPhase, digest: decisionsDigest });
  } else if (surface === 'execute') {
    warnings.push(...evaluateDecisionDispositionWarnings({
      planningDir,
      decisionWorkDir,
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
    const partitioned = partitionPlanChains(allPhaseArtifacts, { companionKinds: ['execute', 'verification'] });
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
      roadmapFallback: true,
    };
  }

  const phases = parseWorkRoadmapPhases(readFileSync(roadmapPath, 'utf-8'));
  const phaseEntry = phases.find((phase) => phase.number === phaseToken);
  if (!phaseEntry) {
    return null;
  }

  const allPhaseArtifacts = collectWorkPhaseArtifacts({ workspaceRoot, phasesDir, phaseToken });
  const partitioned = partitionPlanChains(allPhaseArtifacts, { companionKinds: ['execute', 'verification'] });
  return {
    milestoneDir,
    roadmapPath,
    phasesDir,
    phases,
    phaseEntry,
    phaseArtifacts: partitioned.currentArtifacts,
    historicalPhaseArtifacts: partitioned.historicalArtifacts,
    roadmapFallback: false,
  };
}

function deriveWorkPlanPhases(planArtifacts) {
  const phases = new Map();
  for (const artifact of planArtifacts) {
    if (phases.has(artifact.phaseToken)) continue;
    const frontmatter = parsePlanFrontmatter(readFileSync(artifact.path, 'utf-8'));
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

function evaluateResumeWorkCheckpoint({ planningDir, checkpointPath }) {
  if (!existsSync(checkpointPath)) return null;

  const workspaceRoot = resolve(planningDir, '..');
  const milestoneDir = resolveActiveMilestoneDir(join(workspaceRoot, '.work'));
  const roadmapPath = join(milestoneDir, 'ROADMAP.md');
  if (!existsSync(roadmapPath)) return null;

  let content = '';
  try {
    content = readFileSync(checkpointPath, 'utf-8');
  } catch {
    return null;
  }

  if (!/(^|[`"'(\s])\.work[\\/]+milestone([`"')\s/]|$)/i.test(content)) {
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

function evaluateDecisionDispositionWarnings({ planningDir, decisionWorkDir, planPath = null }) {
  const state = readJsonIfExists(join(planningDir, 'state.json'));
  const persisted = state.ok ? state.value?.lastDecisionsDigest : null;
  if (!persisted || !Array.isArray(persisted.records) || persisted.records.length === 0) return [];

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

  const current = readDecisionRecords(decisionWorkDir);
  const currentById = new Map(current.records.map((record) => [record.meta.id, record]));
  const stale = [];
  for (const persistedRecord of persisted.records) {
    const record = currentById.get(persistedRecord.id);
    const disposition = byId.get(persistedRecord.id);
    if (!record) {
      stale.push(`${persistedRecord.id}: record missing`);
      continue;
    }
    if (record.meta.status !== persistedRecord.status) {
      stale.push(`${persistedRecord.id}: status changed from ${persistedRecord.status} to ${record.meta.status}`);
    } else if (['superseded', 'invalidated'].includes(record.meta.status)) {
      stale.push(`${persistedRecord.id}: record is ${record.meta.status}`);
    } else if (disposition && record.meta.hash !== disposition.hash) {
      stale.push(`${persistedRecord.id}: body hash changed since acknowledgement`);
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
