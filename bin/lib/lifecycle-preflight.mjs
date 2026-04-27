import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { output } from './cli-utils.mjs';
import {
  DELIVERY_POSTURES,
  EVIDENCE_KINDS,
  RELEASE_CLAIM_POSTURES,
  describeEvidenceSurface,
  evaluateReleaseClaimCloseoutContract,
  getEvidenceContract,
} from './evidence-contract.mjs';
import { evaluateLifecycleState, normalizePhaseToken } from './lifecycle-state.mjs';
import { checkDrift } from './session-fingerprint.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

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

const RELEASE_CONTRADICTION_CHECKS = Object.freeze([
  'evidence',
  'public_surface',
  'runtime',
  'delivery',
  'planning_drift',
  'generated_surface',
]);

const RELEASE_CONTRADICTION_STATUSES = Object.freeze(['passed', 'failed', 'not_applicable']);

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
    blockers.push(...buildRoadmapAlignmentBlockers(lifecycle));
    blockers.push(...buildAuditBlockers(lifecycle));
  }

  if (surface === 'complete-milestone') {
    blockers.push(...buildRoadmapAlignmentBlockers(lifecycle));
    blockers.push(...buildAuditBlockers(lifecycle, { allowArchivedBlocker: true }));
    blockers.push(...buildCompletionBlockers(planningDir, lifecycle));
  }

  if (surface === 'new-milestone') {
    blockers.push(...buildRoadmapAlignmentBlockers(lifecycle));
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

  if (surface === 'resume' && !existsSync(checkpointPath) && lifecycle.nonPhaseState !== 'active_brownfield_change') {
    blockers.push(blocker('missing_checkpoint', 'resume requires .planning/.continue-here.md unless an active .planning/brownfield-change/CHANGE.md continuity anchor exists.', ['.planning/.continue-here.md', '.planning/brownfield-change/CHANGE.md']));
  }

  const warnings = [];
  let planningState = null;

  if (existsSync(planningDir)) {
    const drift = checkDrift(planningDir);
    planningState = {
      classification: drift.classification,
      drifted: drift.drifted,
      noBaseline: drift.noBaseline,
      details: drift.details,
      files: drift.files,
    };
    if (drift.drifted) {
      const driftNotice = {
        code: 'planning_state_drift',
        message: `${surface} cannot proceed because planning state drifted since the last recorded session: ${drift.details.join('; ')}`,
        artifacts: ['.planning/ROADMAP.md', '.planning/SPEC.md', '.planning/config.json'],
        details: drift.details,
        files: drift.files,
      };
      if (policy.classification === 'owned_write') {
        blockers.push(driftNotice);
      } else {
        warnings.push({
          ...driftNotice,
          message: `Planning state has drifted since the last recorded session: ${drift.details.join('; ')}`,
        });
      }
    }
  }

  if (lifecycle.phaseStatusAlignment.mismatches.length > 0) {
    warnings.push({
      code: 'roadmap_phase_status_mismatch',
      message: `ROADMAP.md overview/detail phase statuses disagree: ${lifecycle.phaseStatusAlignment.mismatches.join('; ')}`,
      artifacts: ['.planning/ROADMAP.md'],
    });
  }

  return {
    surface,
    phase: normalizedPhase,
    classification: policy.classification,
    ownedWrites: policy.ownedWrites,
    explicitLifecycleMutation: policy.explicitLifecycleMutation,
    closureEvidence: describeEvidenceSurface(surface),
    mutationRequest: expectsMutation,
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    reason: blockers[0]?.code ?? null,
    blockers,
    warnings,
    planningState,
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

  if (surface === 'plan' && phaseEntry.status === 'done') {
    blockers.push(
      blocker(
        'phase_already_complete',
        `Phase ${phaseToken} is already complete and should not be planned again.`,
        ['.planning/ROADMAP.md']
      )
    );
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

function buildRoadmapAlignmentBlockers(lifecycle) {
  if (lifecycle.phaseStatusAlignment.mismatches.length === 0) return [];
  return [
    blocker(
      'roadmap_phase_status_mismatch',
      `ROADMAP.md overview/detail phase statuses disagree: ${lifecycle.phaseStatusAlignment.mismatches.join('; ')}`,
      ['.planning/ROADMAP.md']
    ),
  ];
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
  const auditFrontmatter = extractFrontmatter(auditContent);
  const auditStatus = readTopLevelScalar(auditFrontmatter || auditContent, 'status');
  if (auditStatus !== 'passed') {
    return [
      blocker(
        'audit_not_passed',
        `Milestone ${lifecycle.currentMilestone.version} requires a passed audit before completion.`,
        [auditPath]
      ),
    ];
  }

  const releaseContractBlockers = buildReleaseClaimCompletionBlockers(auditContent, auditPath);
  if (releaseContractBlockers.length > 0) return releaseContractBlockers;

  return [];
}

function buildReleaseClaimCompletionBlockers(auditContent, auditPath) {
  const frontmatter = extractFrontmatter(auditContent);
  const deliveryPosture = readTopLevelScalar(frontmatter, 'delivery_posture');
  const releaseClaimPosture = readTopLevelScalar(frontmatter, 'release_claim_posture');
  const evidenceBlock = extractYamlBlock(frontmatter, 'evidence_contract');
  const releaseBlock = extractYamlBlock(frontmatter, 'release_claim_contract');
  const missing = [];

  if (!deliveryPosture) missing.push('delivery_posture');
  if (!releaseClaimPosture) missing.push('release_claim_posture');
  if (!evidenceBlock) missing.push('evidence_contract');
  if (!releaseBlock) missing.push('release_claim_contract');

  if (missing.length > 0) {
    return [blocker(
      'missing_release_claim_contract',
      `Milestone audit is missing release closeout metadata (${missing.join(', ')}). Re-run audit before completion.`,
      [auditPath]
    )];
  }

  const requiredKinds = readBlockList(evidenceBlock, 'required_kinds');
  const observedKinds = readBlockList(evidenceBlock, 'observed_kinds');
  const missingKinds = readBlockList(evidenceBlock, 'missing_kinds');
  const unsupportedClaims = readBlockList(releaseBlock, 'unsupported_claims');
  const waivedKinds = readBlockList(releaseBlock, 'waivers');
  const deferrals = readBlockList(releaseBlock, 'deferrals');
  const contradictionChecks = readNestedStatusBlock(releaseBlock, 'contradiction_checks');
  const blockers = [];
  const invalidEvidenceKinds = [
    ...findInvalidEvidenceKinds('required_kinds', requiredKinds),
    ...findInvalidEvidenceKinds('observed_kinds', observedKinds),
    ...findInvalidEvidenceKinds('missing_kinds', missingKinds),
    ...findInvalidEvidenceKinds('waivers', waivedKinds),
  ];

  if (requiredKinds.length === 0 && observedKinds.length === 0) {
    blockers.push(blocker(
      'missing_release_evidence_contract',
      'Milestone audit evidence_contract must include required_kinds and observed_kinds before completion.',
      [auditPath]
    ));
  }

  if (!DELIVERY_POSTURES.includes(deliveryPosture)) {
    blockers.push(blocker(
      'invalid_delivery_posture',
      `Milestone audit has invalid delivery_posture (${deliveryPosture}). Re-run audit before completion.`,
      [auditPath]
    ));
  }

  if (!RELEASE_CLAIM_POSTURES.includes(releaseClaimPosture)) {
    blockers.push(blocker(
      'invalid_release_claim_posture',
      `Milestone audit has invalid release_claim_posture (${releaseClaimPosture}). Re-run audit before completion.`,
      [auditPath]
    ));
  }

  if (invalidEvidenceKinds.length > 0) {
    blockers.push(blocker(
      'invalid_release_evidence_kinds',
      `Milestone audit has invalid release evidence kind values (${invalidEvidenceKinds.join(', ')}). Supported values are ${EVIDENCE_KINDS.join(', ')}.`,
      [auditPath]
    ));
  }

  const missingContradictionChecks = RELEASE_CONTRADICTION_CHECKS.filter((name) => !(name in contradictionChecks));
  const unknownContradictionChecks = Object.keys(contradictionChecks)
    .filter((name) => !RELEASE_CONTRADICTION_CHECKS.includes(name));
  const invalidContradictionChecks = Object.entries(contradictionChecks)
    .filter(([, status]) => !RELEASE_CONTRADICTION_STATUSES.includes(status))
    .map(([name]) => name);

  if (missingContradictionChecks.length > 0) {
    blockers.push(blocker(
      'missing_release_contradiction_checks',
      `Milestone audit release_claim_contract.contradiction_checks is missing required checks (${missingContradictionChecks.join(', ')}).`,
      [auditPath]
    ));
  }

  if (invalidContradictionChecks.length > 0) {
    blockers.push(blocker(
      'invalid_release_contradiction_checks',
      `Milestone audit release_claim_contract.contradiction_checks has invalid statuses (${invalidContradictionChecks.join(', ')}).`,
      [auditPath]
    ));
  }

  if (unknownContradictionChecks.length > 0) {
    blockers.push(blocker(
      'unknown_release_contradiction_checks',
      `Milestone audit release_claim_contract.contradiction_checks has unknown checks (${unknownContradictionChecks.join(', ')}). Supported checks are ${RELEASE_CONTRADICTION_CHECKS.join(', ')}.`,
      [auditPath]
    ));
  }

  if (!DELIVERY_POSTURES.includes(deliveryPosture) || !RELEASE_CLAIM_POSTURES.includes(releaseClaimPosture)) {
    return blockers;
  }

  const releaseEvaluation = evaluateReleaseClaimCloseoutContract({
    surface: 'complete-milestone',
    deliveryPosture,
    releaseClaimPosture,
    observedKinds,
    waivedKinds,
    unsupportedClaims,
    deferrals,
    contradictionChecks,
  });

  if (DELIVERY_POSTURES.includes(deliveryPosture)) {
    const evidenceContract = getEvidenceContract('complete-milestone', deliveryPosture);
    const enforcedRequiredKinds = [...new Set([...evidenceContract.requiredKinds, ...releaseEvaluation.requiredKinds])];
    const undeclaredRequiredKinds = enforcedRequiredKinds.filter((kind) => !requiredKinds.includes(kind));
    const recomputedMissingKinds = enforcedRequiredKinds.filter((kind) => !observedKinds.includes(kind));

    if (undeclaredRequiredKinds.length > 0) {
      blockers.push(blocker(
        'invalid_release_evidence_contract',
        `Milestone audit evidence_contract.required_kinds omits required closeout evidence (${undeclaredRequiredKinds.join(', ')}).`,
        [auditPath]
      ));
    }

    if (recomputedMissingKinds.length > 0) {
      blockers.push(blocker(
        'missing_required_release_evidence',
        `Milestone audit observed evidence is missing required closeout kinds (${recomputedMissingKinds.join(', ')}).`,
        [auditPath]
      ));
    }
  }

  if (missingKinds.length > 0) {
    blockers.push(blocker(
      'missing_required_release_evidence',
      `Milestone audit is missing required evidence kinds for closeout (${missingKinds.join(', ')}).`,
      [auditPath]
    ));
  }

  if (releaseEvaluation.invalidWaivers.length > 0) {
    blockers.push(blocker(
      'invalid_release_waivers',
      `Milestone audit has invalid waivers for missing required evidence (${releaseEvaluation.invalidWaivers.join(', ')}).`,
      [auditPath]
    ));
  }
  if (releaseEvaluation.blockers.some((releaseBlocker) => releaseBlocker.code === 'incompatible_release_claim_posture')) {
    blockers.push(blocker(
      'incompatible_release_claim_posture',
      `Milestone audit release_claim_posture (${releaseClaimPosture}) is incompatible with delivery_posture (${deliveryPosture}).`,
      [auditPath]
    ));
  }
  if (releaseEvaluation.unresolvedUnsupportedClaims.length > 0) {
    blockers.push(blocker(
      'unsupported_release_claims',
      `Milestone audit has unsupported release claims without downgrade or deferral (${releaseEvaluation.unresolvedUnsupportedClaims.join(', ')}).`,
      [auditPath]
    ));
  }
  if (releaseEvaluation.failedContradictionChecks.length > 0) {
    blockers.push(blocker(
      'failed_release_contradiction_checks',
      `Milestone audit has failed release contradiction checks (${releaseEvaluation.failedContradictionChecks.join(', ')}).`,
      [auditPath]
    ));
  }

  return blockers;
}

function extractFrontmatter(content) {
  const match = String(content || '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function readTopLevelScalar(frontmatter, key) {
  const match = String(frontmatter || '').match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? cleanYamlValue(match[1]) : null;
}

function extractYamlBlock(frontmatter, key) {
  const lines = String(frontmatter || '').replace(/\r\n/g, '\n').split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line.trim()));
  if (startIndex === -1) return '';

  const collected = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^[A-Za-z0-9_-]+:\s*/.test(line)) break;
    collected.push(line);
  }
  return collected.join('\n');
}

function readBlockList(block, key) {
  const lines = String(block || '').replace(/\r\n/g, '\n').split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^\\s+${key}:`).test(line));
  if (startIndex === -1) return [];
  const baseIndent = lines[startIndex].match(/^\s*/)[0].length;

  const inline = lines[startIndex].match(/^\s+[^:]+:\s*\[([^\]]*)\]/);
  if (inline) return splitInlineList(inline[1]);

  const collected = [];
  for (const line of lines.slice(startIndex + 1)) {
    const indent = line.match(/^\s*/)[0].length;
    if (line.trim() && indent <= baseIndent && /^\s*[A-Za-z0-9_-]+:\s*/.test(line)) break;
    collected.push(line);
  }

  return parseYamlListItems(collected, baseIndent)
    .map((item) => item.join(' '))
    .map(cleanYamlValue);
}

function parseYamlListItems(lines, baseIndent) {
  const items = [];
  let current = null;
  let itemIndent = null;

  for (const line of lines) {
    const match = line.match(/^(\s*)-\s*(.+?)\s*$/);
    const indent = line.match(/^\s*/)[0].length;

    if (match && indent > baseIndent && (itemIndent === null || indent === itemIndent)) {
      if (current) items.push(current);
      current = [match[2]];
      itemIndent = indent;
      continue;
    }

    if (current && line.trim()) {
      current.push(line.trim());
    }
  }

  if (current) items.push(current);
  return items;
}

function findInvalidEvidenceKinds(field, kinds) {
  return kinds
    .filter((kind) => !EVIDENCE_KINDS.includes(kind))
    .map((kind) => `${field}: ${kind}`);
}

function readNestedStatusBlock(block, key) {
  const nested = extractIndentedBlock(block, key);
  const statuses = {};
  for (const line of nested.split('\n')) {
    const match = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) statuses[match[1]] = cleanYamlValue(match[2]);
  }
  return statuses;
}

function extractIndentedBlock(block, key) {
  const lines = String(block || '').replace(/\r\n/g, '\n').split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^\\s+${key}:`).test(line));
  if (startIndex === -1) return '';
  const baseIndent = lines[startIndex].match(/^\s*/)[0].length;

  const collected = [];
  for (const line of lines.slice(startIndex + 1)) {
    const indent = line.match(/^\s*/)[0].length;
    if (line.trim() && indent <= baseIndent && /^\s*[A-Za-z0-9_-]+:\s*/.test(line)) break;
    collected.push(line);
  }
  return collected.join('\n');
}

function splitInlineList(value) {
  return splitCommaAware(value)
    .map(cleanYamlValue)
    .filter(Boolean);
}

function splitCommaAware(value) {
  const items = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of String(value || '')) {
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
    if (char === ',' && !quote) {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  items.push(current);
  return items;
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

export function cmdLifecyclePreflight(...args) {
  const { args: normalizedArgs, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const [surface, maybePhase, ...rest] = normalizedArgs;

  if (!surface) {
    console.error('Usage: node .planning/bin/gsdd.mjs lifecycle-preflight <surface> [phase] [--expects-mutation <none|phase-status>]');
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
