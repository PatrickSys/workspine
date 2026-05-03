import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { output } from './cli-utils.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

const EVIDENCE_KINDS = Object.freeze(['code', 'test', 'runtime', 'delivery', 'human']);
const COMPARISON_STATUSES = Object.freeze(['satisfied', 'partial', 'missing', 'waived', 'deferred', 'not_applicable']);
const CLAIM_STATUSES = Object.freeze(['passed', 'failed', 'partial', 'waived', 'deferred', 'not_applicable']);
const ARTIFACT_VISIBILITIES = Object.freeze(['local_only', 'repo_tracked', 'public']);
const RAW_ARTIFACT_TYPES = Object.freeze(['screenshot', 'trace', 'video', 'dom_snapshot', 'dom-snapshot', 'dom', 'report']);
const PUBLIC_CLAIM_USES = Object.freeze(['public', 'publication', 'tracked', 'delivery', 'release']);
const CLAIM_USES = Object.freeze([...PUBLIC_CLAIM_USES, 'local', 'local_only']);
const REQUIRED_BUNDLE_FIELDS = Object.freeze([
  'proof_bundle_version',
  'scope',
  'route_state',
  'environment',
  'viewport',
  'evidence_inputs',
  'commands_or_manual_steps',
  'observations',
  'artifacts',
  'privacy',
  'result',
  'claim_limits',
]);
const REQUIRED_SCOPE_FIELDS = Object.freeze(['work_item', 'claim', 'requirement_ids', 'slot_ids']);
const REQUIRED_ARTIFACT_FIELDS = Object.freeze(['visibility', 'retention', 'sensitivity', 'safe_to_publish']);
const REQUIRED_OBSERVATION_FIELDS = Object.freeze(['observation', 'claim', 'route_state', 'evidence_kind', 'artifact_refs', 'privacy', 'result', 'claim_limit']);
const REQUIRED_PRIVACY_FIELDS = Object.freeze(['data_classification', 'raw_artifacts_safe_to_publish', 'retention']);

class UiProofError extends Error {}

function fail(message) {
  console.error(message);
  throw new UiProofError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function pathLabel(basePath, key) {
  return basePath ? `${basePath}.${key}` : key;
}

function addError(errors, code, path, message, fix) {
  errors.push({ code, path, message, fix });
}

function requireField(obj, field, path, errors) {
  if (!isPlainObject(obj) || !hasValue(obj[field])) {
    addError(errors, 'missing_required_field', pathLabel(path, field), `Missing required UI proof field: ${pathLabel(path, field)}`, 'Add the required field to the proof bundle metadata.');
    return false;
  }
  return true;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function artifactType(artifact) {
  const explicit = typeof artifact.type === 'string' ? artifact.type.toLowerCase() : '';
  const artifactPath = typeof artifact.path === 'string' ? artifact.path.toLowerCase() : '';
  if (/screenshot|\.png$|\.jpe?g$|\.webp$/.test(artifactPath)) return 'screenshot';
  if (/trace|\.zip$/.test(artifactPath)) return 'trace';
  if (/video|\.mp4$|\.webm$|\.mov$/.test(artifactPath)) return 'video';
  if (/dom|\.html?$/.test(artifactPath)) return 'dom_snapshot';
  if (/report/.test(artifactPath)) return 'report';
  return explicit;
}

function isRawUiArtifact(artifact) {
  return RAW_ARTIFACT_TYPES.includes(artifactType(artifact));
}

function collectClaimUses(bundle, options) {
  const uses = new Set();
  for (const value of normalizeArray(options.claimUse).concat(normalizeArray(options.claimUses))) {
    uses.add(String(value).toLowerCase());
  }

  const explicitSources = [
    bundle?.proof_claim,
    bundle?.proof_claims,
    bundle?.claim_context?.proof_use,
    bundle?.claim_context?.proof_uses,
    bundle?.publication?.intended_use,
  ];
  for (const source of explicitSources) {
    for (const value of normalizeArray(source)) uses.add(String(value).toLowerCase());
  }

  return [...uses];
}

function validateClaimUses(bundle, options, errors) {
  for (const value of collectClaimUses(bundle, options)) {
    if (!CLAIM_USES.includes(value)) {
      addError(errors, 'unsupported_claim_use', 'proof_claim', `Unsupported UI proof claim use: ${value}`, `Use only: ${CLAIM_USES.join(', ')}.`);
    }
  }
}

function hasPublicClaim(bundle, options) {
  return collectClaimUses(bundle, options).some((value) => PUBLIC_CLAIM_USES.includes(value));
}

function validateObservationPrivacy(privacy, path, errors) {
  for (const field of REQUIRED_PRIVACY_FIELDS) requireField(privacy, field, path, errors);
  if (hasValue(privacy?.raw_artifacts_safe_to_publish) && typeof privacy.raw_artifacts_safe_to_publish !== 'boolean') {
    addError(errors, 'invalid_raw_artifacts_safe_to_publish', `${path}.raw_artifacts_safe_to_publish`, 'raw_artifacts_safe_to_publish must be a boolean.', 'Use false unless all raw artifacts are explicitly safe to publish.');
  }
}

function validateCommandsOrManualSteps(bundle, errors) {
  for (const [index, step] of normalizeArray(bundle?.commands_or_manual_steps).entries()) {
    const stepPath = `commands_or_manual_steps[${index}]`;
    if (!isPlainObject(step)) {
      addError(errors, 'invalid_proof_step', stepPath, 'UI proof command/manual step entry must be an object.', 'Record a command or manual_step plus its result.');
      continue;
    }
    if (!hasValue(step.command) && !hasValue(step.manual_step)) {
      addError(errors, 'missing_proof_step_action', stepPath, 'UI proof command/manual step must include command or manual_step.', 'Record the exact command or manual step used to generate the observation.');
    }
    if (!hasValue(step.result)) {
      addError(errors, 'missing_proof_step_result', `${stepPath}.result`, 'UI proof command/manual step must include result.', `Record result using: ${CLAIM_STATUSES.join(', ')}.`);
    } else if (!CLAIM_STATUSES.includes(step.result)) {
      addError(errors, 'invalid_proof_step_result', `${stepPath}.result`, `Invalid UI proof command/manual step result: ${step.result}`, `Use only: ${CLAIM_STATUSES.join(', ')}.`);
    }
  }
}

function validateObservations(bundle, errors) {
  for (const [index, observation] of normalizeArray(bundle?.observations).entries()) {
    const observationPath = `observations[${index}]`;
    if (!isPlainObject(observation)) {
      addError(errors, 'invalid_observation', observationPath, 'UI proof observation entry must be an object.', 'Record observation metadata with claim, route_state, evidence_kind, artifact_refs, privacy, result, and claim_limit.');
      continue;
    }
    for (const field of REQUIRED_OBSERVATION_FIELDS) requireField(observation, field, observationPath, errors);
    if (hasValue(observation.evidence_kind) && !EVIDENCE_KINDS.includes(observation.evidence_kind)) {
      addError(errors, 'unsupported_evidence_kind', `${observationPath}.evidence_kind`, `Unsupported UI proof observation evidence kind: ${observation.evidence_kind}`, `Use only: ${EVIDENCE_KINDS.join(', ')}.`);
    }
    if (hasValue(observation.result) && !CLAIM_STATUSES.includes(observation.result)) {
      addError(errors, 'invalid_observation_result', `${observationPath}.result`, `Invalid UI proof observation result: ${observation.result}`, `Use only: ${CLAIM_STATUSES.join(', ')}.`);
    }
    validateObservationPrivacy(observation.privacy, `${observationPath}.privacy`, errors);
  }
}

function validateEvidenceKinds(bundle, errors) {
  const kinds = normalizeArray(bundle?.evidence_inputs?.kinds);
  if (kinds.length === 0) {
    addError(errors, 'missing_evidence_kinds', 'evidence_inputs.kinds', 'Missing UI proof evidence kinds.', 'Record at least one fixed evidence kind: code, test, runtime, delivery, or human.');
  }
  for (const [index, kind] of kinds.entries()) {
    if (!EVIDENCE_KINDS.includes(kind)) {
      addError(errors, 'unsupported_evidence_kind', `evidence_inputs.kinds[${index}]`, `Unsupported UI proof evidence kind: ${kind}`, `Use only: ${EVIDENCE_KINDS.join(', ')}.`);
    }
  }
}

function validateResult(bundle, errors) {
  if (!isPlainObject(bundle?.result)) return;
  if (!hasValue(bundle.result.claim_status)) {
    addError(errors, 'missing_claim_status', 'result.claim_status', 'Missing UI proof result claim status.', `Record claim_status using: ${CLAIM_STATUSES.join(', ')}.`);
  } else if (!CLAIM_STATUSES.includes(bundle.result.claim_status)) {
    addError(errors, 'invalid_claim_status', 'result.claim_status', `Invalid UI proof claim status: ${bundle.result.claim_status}`, `Use only: ${CLAIM_STATUSES.join(', ')}.`);
  }
}

function validateComparisonStatuses(bundle, errors) {
  const statuses = bundle?.result?.comparison_status_by_slot;
  if (!isPlainObject(statuses)) {
    addError(errors, 'missing_comparison_statuses', 'result.comparison_status_by_slot', 'Missing UI proof comparison statuses by slot.', `Record one status per slot using: ${COMPARISON_STATUSES.join(', ')}.`);
    return;
  }
  const slotIds = normalizeArray(bundle?.scope?.slot_ids);
  const slotSet = new Set(slotIds);
  for (const slotId of slotIds) {
    if (!hasValue(statuses[slotId])) {
      addError(errors, 'missing_comparison_status', `result.comparison_status_by_slot.${slotId}`, `Missing UI proof comparison status for slot: ${slotId}`, `Record one status per slot using: ${COMPARISON_STATUSES.join(', ')}.`);
    }
  }
  for (const [slot, status] of Object.entries(statuses)) {
    if (slotSet.size > 0 && !slotSet.has(slot)) {
      addError(errors, 'unknown_comparison_slot', `result.comparison_status_by_slot.${slot}`, `UI proof comparison status references undeclared slot: ${slot}`, 'Use only slot IDs declared in scope.slot_ids.');
    }
    if (!COMPARISON_STATUSES.includes(status)) {
      addError(errors, 'invalid_comparison_status', `result.comparison_status_by_slot.${slot}`, `Invalid UI proof comparison status: ${status}`, `Use only: ${COMPARISON_STATUSES.join(', ')}.`);
    }
  }
}

function validateClaimLimits(bundle, errors) {
  const claimLimits = normalizeArray(bundle?.claim_limits);
  if (claimLimits.length === 0) {
    addError(errors, 'missing_claim_limits', 'claim_limits', 'Missing UI proof claim limits.', 'Add at least one claim limit that narrows what this proof does not prove.');
  }
}

function artifactReference(artifact) {
  if (!isPlainObject(artifact)) return null;
  if (typeof artifact.path === 'string' && artifact.path.trim()) return artifact.path.trim();
  if (typeof artifact.url === 'string' && artifact.url.trim()) return artifact.url.trim();
  return null;
}

function validateArtifactReferenceSafety(ref, path, errors) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    if (!/^https?:\/\//i.test(ref)) {
      addError(errors, 'invalid_artifact_ref_location', path, `UI proof artifact reference uses an unsupported URL scheme: ${ref}`, 'Use a workspace-relative path or an http(s) URL; do not reference local file URLs.');
    }
    return;
  }
  if (ref.startsWith('//') || isAbsolute(ref) || ref.split(/[\\/]+/).includes('..')) {
    addError(errors, 'invalid_artifact_ref_location', path, `UI proof artifact reference must stay workspace-relative: ${ref}`, 'Use a relative path under the workspace, or an http(s) URL for external sanitized evidence.');
  }
}

function isSanitizedSensitivity(value) {
  return typeof value === 'string' && /(^|[_\s-])(sanitized|public_safe|public-safe)($|[_\s-])/.test(value.toLowerCase());
}

function validateArtifacts(bundle, errors, publicClaim) {
  const artifacts = normalizeArray(bundle?.artifacts);
  if (artifacts.length === 0) {
    addError(errors, 'missing_artifacts', 'artifacts', 'Missing UI proof artifacts list.', 'Record artifact metadata for each referenced proof artifact.');
    return new Set();
  }

  const artifactRefs = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    const artifactPath = `artifacts[${index}]`;
    if (!isPlainObject(artifact)) {
      addError(errors, 'invalid_artifact', artifactPath, 'UI proof artifact entry must be an object.', 'Record path/type plus privacy metadata for each artifact.');
      continue;
    }
    const ref = artifactReference(artifact);
    if (!ref) {
      addError(errors, 'missing_artifact_ref', artifactPath, 'UI proof artifact must include path or url.', 'Reference raw UI artifacts by path or URL; do not inline them.');
    } else {
      validateArtifactReferenceSafety(ref, artifactPath, errors);
      artifactRefs.add(ref);
    }
    for (const field of REQUIRED_ARTIFACT_FIELDS) {
      requireField(artifact, field, artifactPath, errors);
    }
    if (hasValue(artifact.visibility) && !ARTIFACT_VISIBILITIES.includes(artifact.visibility)) {
      addError(errors, 'invalid_visibility', `${artifactPath}.visibility`, `Invalid UI proof artifact visibility: ${artifact.visibility}`, `Use only: ${ARTIFACT_VISIBILITIES.join(', ')}.`);
    }
    if (hasValue(artifact.safe_to_publish) && typeof artifact.safe_to_publish !== 'boolean') {
      addError(errors, 'invalid_safe_to_publish', `${artifactPath}.safe_to_publish`, 'safe_to_publish must be a boolean.', 'Use true only after explicit safe-to-publish classification; otherwise use false.');
    }
    if (isRawUiArtifact(artifact) && artifact.visibility !== 'local_only' && artifact.safe_to_publish !== true) {
      addError(errors, 'unsafe_raw_artifact', artifactPath, 'Raw UI artifacts are local-only by default unless explicitly classified safe to publish.', 'Set visibility: local_only and safe_to_publish: false, or document sanitized public-safe classification.');
    }
    if (publicClaim && (artifact.visibility === 'local_only' || artifact.safe_to_publish !== true)) {
      addError(errors, 'unsafe_public_proof_claim', artifactPath, 'Public/tracked/delivery UI proof claims cannot rely on local-only or unsafe artifacts.', 'Use local-only claim language, or provide sanitized artifacts with safe_to_publish: true and non-local visibility.');
    }
    if (publicClaim && isRawUiArtifact(artifact) && !isSanitizedSensitivity(artifact.sensitivity)) {
      addError(errors, 'unsafe_public_artifact_sensitivity', `${artifactPath}.sensitivity`, 'Public/tracked/delivery raw UI proof artifacts must be classified sanitized.', 'Set sensitivity to a sanitized/public-safe classification after explicit review, or narrow the proof claim.');
    }
  }
  return artifactRefs;
}

function validatePrivacy(bundle, errors, publicClaim) {
  validateObservationPrivacy(bundle.privacy, 'privacy', errors);
  if (publicClaim && bundle.privacy?.raw_artifacts_safe_to_publish !== true) {
    addError(errors, 'unsafe_public_proof_privacy', 'privacy.raw_artifacts_safe_to_publish', 'Public/tracked/delivery UI proof claims require bundle privacy metadata to classify raw artifacts safe to publish.', 'Use local-only claim language, or set raw_artifacts_safe_to_publish: true after sanitized/public-safe review.');
  }
}

function validatePublicObservationPrivacy(bundle, errors, publicClaim) {
  if (!publicClaim) return;
  for (const [index, observation] of normalizeArray(bundle?.observations).entries()) {
    if (!isPlainObject(observation)) continue;
    if (observation.privacy?.raw_artifacts_safe_to_publish !== true) {
      addError(errors, 'unsafe_public_observation_privacy', `observations[${index}].privacy.raw_artifacts_safe_to_publish`, 'Public/tracked/delivery UI proof claims require observation privacy metadata to classify raw artifacts safe to publish.', 'Use local-only claim language, or set raw_artifacts_safe_to_publish: true after sanitized/public-safe review.');
    }
  }
}

function validateObservationArtifactRefs(bundle, artifactRefs, errors) {
  for (const [index, observation] of normalizeArray(bundle?.observations).entries()) {
    if (!isPlainObject(observation)) continue;
    for (const [refIndex, ref] of normalizeArray(observation.artifact_refs).entries()) {
      if (!artifactRefs.has(ref)) {
        addError(errors, 'unknown_artifact_ref', `observations[${index}].artifact_refs[${refIndex}]`, `Observation references undeclared UI proof artifact: ${ref}`, 'Add the artifact to artifacts[] or correct the observation artifact reference.');
      }
    }
  }
}

function stableString(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function valuesMatch(planned, observed) {
  if (!hasValue(planned)) return true;
  if (!hasValue(observed)) return false;
  return stableString(planned) === stableString(observed);
}

function slotId(slot, index) {
  return slot?.slot_id || slot?.slotId || slot?.id || `ui-proof-slot-${index + 1}`;
}

function observationText(observation) {
  if (typeof observation === 'string') return observation;
  if (isPlainObject(observation) && typeof observation.observation === 'string') return observation.observation;
  return '';
}

function includesObservation(observations, expected) {
  const expectedText = typeof expected === 'string' ? expected.trim() : observationText(expected).trim();
  if (!expectedText) return true;
  return observations.some((observation) => observationText(observation).includes(expectedText));
}

function normalizeObservedBundle(entry) {
  if (entry?.bundle) {
    return {
      bundle: entry.bundle,
      validation: entry.validation || validateUiProofBundle(entry.bundle, entry.options || {}),
      source: entry.source || entry.filePath || 'observed bundle',
    };
  }
  return {
    bundle: entry,
    validation: validateUiProofBundle(entry),
    source: 'observed bundle',
  };
}

function compareSlotToBundle(slot, slotIdValue, observed) {
  const issues = [];
  const bundle = observed.bundle;
  const observations = normalizeArray(bundle?.observations);
  if (!observed.validation.valid) {
    issues.push({
      code: 'invalid_observed_bundle',
      path: observed.source,
      message: `Observed UI proof bundle for slot ${slotIdValue} failed metadata validation.`,
      details: observed.validation.errors,
    });
  }

  const bundleStatus = bundle?.result?.comparison_status_by_slot?.[slotIdValue];
  if (bundle?.result?.claim_status !== 'passed') {
    issues.push({
      code: 'unsatisfied_observed_claim_status',
      path: 'result.claim_status',
      message: `Observed UI proof bundle claim status is ${bundle?.result?.claim_status || 'missing'} for slot ${slotIdValue}.`,
    });
  }
  if (bundleStatus !== 'satisfied') {
    issues.push({
      code: 'unsatisfied_observed_comparison_status',
      path: `result.comparison_status_by_slot.${slotIdValue}`,
      message: `Observed UI proof bundle reports ${bundleStatus || 'missing'} for slot ${slotIdValue}.`,
    });
  }

  const requiredKinds = normalizeArray(slot?.required_evidence_kinds || slot?.requiredEvidenceKinds);
  const observedKinds = normalizeArray(bundle?.evidence_inputs?.kinds);
  const missingKinds = requiredKinds.filter((kind) => !observedKinds.includes(kind));
  if (missingKinds.length > 0) {
    issues.push({
      code: 'missing_required_evidence_kind',
      path: 'evidence_inputs.kinds',
      message: `Observed UI proof for slot ${slotIdValue} is missing required evidence kind(s): ${missingKinds.join(', ')}.`,
    });
  }
  const missingNonHuman = missingKinds.filter((kind) => kind !== 'human');
  if (missingNonHuman.length > 0 && observedKinds.includes('human')) {
    issues.push({
      code: 'human_evidence_cannot_bypass_required_non_human_evidence',
      path: 'evidence_inputs.kinds',
      message: `Human evidence cannot satisfy missing non-human UI proof evidence for slot ${slotIdValue}: ${missingNonHuman.join(', ')}.`,
    });
  }

  if (!valuesMatch(slot?.route_state || slot?.routeState, bundle?.route_state)) {
    issues.push({
      code: 'route_state_mismatch',
      path: 'route_state',
      message: `Observed UI proof route/state does not match planned slot ${slotIdValue}.`,
    });
  }

  if (!valuesMatch(slot?.environment, bundle?.environment)) {
    issues.push({
      code: 'environment_mismatch',
      path: 'environment',
      message: `Observed UI proof environment does not match planned slot ${slotIdValue}.`,
    });
  }

  if (!valuesMatch(slot?.viewport, bundle?.viewport)) {
    issues.push({
      code: 'viewport_mismatch',
      path: 'viewport',
      message: `Observed UI proof viewport does not match planned slot ${slotIdValue}.`,
    });
  }

  const requirementId = slot?.requirement_id || slot?.requirementId;
  if (hasValue(requirementId) && !normalizeArray(bundle?.scope?.requirement_ids).includes(requirementId)) {
    issues.push({
      code: 'requirement_mismatch',
      path: 'scope.requirement_ids',
      message: `Observed UI proof bundle does not declare planned requirement ${requirementId} for slot ${slotIdValue}.`,
    });
  }

  if (hasValue(slot?.claim) && bundle?.scope?.claim !== slot.claim) {
    issues.push({
      code: 'claim_mismatch',
      path: 'scope.claim',
      message: `Observed UI proof bundle claim does not match planned slot ${slotIdValue}.`,
    });
  }

  if (hasValue(slot?.claim) && !observations.some((observation) => observation?.claim === slot.claim)) {
    issues.push({
      code: 'observation_claim_mismatch',
      path: 'observations[].claim',
      message: `Observed UI proof observations do not support the exact planned claim for slot ${slotIdValue}.`,
    });
  }

  const supportingObservations = observations
    .map((observation, index) => ({ observation, index }))
    .filter(({ observation }) => !hasValue(slot?.claim) || observation?.claim === slot.claim);

  if (hasValue(slot?.route_state || slot?.routeState)) {
    for (const { observation, index } of supportingObservations) {
      if (!valuesMatch(slot?.route_state || slot?.routeState, observation?.route_state)) {
        issues.push({
          code: 'observation_route_state_mismatch',
          path: `observations[${index}].route_state`,
          message: `Observed UI proof observation route/state does not match planned slot ${slotIdValue}.`,
        });
      }
    }
  }

  const passedSupportingKinds = new Set(
    supportingObservations
      .filter(({ observation }) => observation?.result === 'passed')
      .map(({ observation }) => observation?.evidence_kind)
      .filter(Boolean)
  );
  const missingSupportingKinds = requiredKinds.filter((kind) => !passedSupportingKinds.has(kind));
  if (missingSupportingKinds.length > 0) {
    issues.push({
      code: 'missing_supporting_observation_evidence_kind',
      path: 'observations[].evidence_kind',
      message: `Observed UI proof for slot ${slotIdValue} lacks passed supporting observation(s) for required evidence kind(s): ${missingSupportingKinds.join(', ')}.`,
    });
  }

  for (const [index, step] of normalizeArray(bundle?.commands_or_manual_steps).entries()) {
    if (step?.result !== 'passed') {
      issues.push({
        code: 'unsatisfied_proof_step',
        path: `commands_or_manual_steps[${index}].result`,
        message: `Observed UI proof command/manual step is ${step?.result || 'missing'} for slot ${slotIdValue}.`,
      });
    }
  }

  const manualAcceptanceRequired = slot?.manual_acceptance_required === true || slot?.manualAcceptanceRequired === true;
  if (manualAcceptanceRequired) {
    if (!observedKinds.includes('human')) {
      issues.push({
        code: 'missing_manual_acceptance_evidence',
        path: 'evidence_inputs.kinds',
        message: `Observed UI proof for slot ${slotIdValue} is missing required human evidence for manual acceptance.`,
      });
    }
    if (!passedSupportingKinds.has('human')) {
      issues.push({
        code: 'missing_manual_acceptance_observation',
        path: 'observations[].evidence_kind',
        message: `Observed UI proof for slot ${slotIdValue} lacks a passed human observation for manual acceptance.`,
      });
    }
  }

  for (const { observation, index } of supportingObservations) {
    if (observation?.result !== 'passed') {
      issues.push({
        code: 'unsatisfied_observation_result',
        path: `observations[${index}].result`,
        message: `Observed UI proof observation is ${observation?.result || 'missing'} for slot ${slotIdValue}.`,
      });
    }
  }

  for (const expected of normalizeArray(slot?.minimum_observations || slot?.minimumObservations)) {
    if (!includesObservation(supportingObservations.map(({ observation }) => observation), expected)) {
      issues.push({
        code: 'missing_minimum_observation',
        path: 'observations',
        message: `Observed UI proof for slot ${slotIdValue} is missing a planned minimum observation.`,
      });
    }
  }

  if (hasValue(slot?.claim_limit || slot?.claimLimit)) {
    const claimLimit = slot.claim_limit || slot.claimLimit;
    if (!normalizeArray(bundle?.claim_limits).includes(claimLimit)) {
      issues.push({
        code: 'missing_claim_limit',
        path: 'claim_limits',
        message: `Observed UI proof for slot ${slotIdValue} does not preserve the planned claim limit.`,
      });
    }
  }

  const status = issues.length === 0 ? 'satisfied' : (bundleStatus === 'missing' ? 'missing' : 'partial');
  return { status, issues, source: observed.source };
}

export function compareUiProofSlots(plannedSlots, observedBundles) {
  const slots = normalizeArray(plannedSlots);
  const bundles = normalizeArray(observedBundles).map(normalizeObservedBundle);
  const results = [];
  const errors = [];

  for (const observed of bundles) {
    if (!observed.validation.valid) {
      errors.push({
        code: 'invalid_observed_bundle',
        path: observed.source,
        message: `Observed UI proof bundle ${observed.source} failed metadata validation.`,
        details: observed.validation.errors,
      });
    }
  }

  for (const [index, slot] of slots.entries()) {
    const slotIdValue = slotId(slot, index);
    const matchingBundles = bundles.filter((observed) => normalizeArray(observed.bundle?.scope?.slot_ids).includes(slotIdValue));
    if (matchingBundles.length === 0) {
      results.push({
        slot_id: slotIdValue,
        status: 'missing',
        issues: [{
          code: 'missing_observed_bundle',
          path: 'scope.slot_ids',
          message: `No observed UI proof bundle declares planned slot ${slotIdValue}.`,
        }],
      });
      continue;
    }

    const candidates = matchingBundles.map((observed) => compareSlotToBundle(slot, slotIdValue, observed));
    const satisfied = candidates.find((candidate) => candidate.status === 'satisfied');
    if (satisfied) {
      results.push({ slot_id: slotIdValue, status: 'satisfied', issues: [], source: satisfied.source });
      continue;
    }
    const partial = candidates.find((candidate) => candidate.status === 'partial') || candidates[0];
    results.push({ slot_id: slotIdValue, status: partial.status, issues: partial.issues, source: partial.source });
  }

  const statuses = results.map((result) => result.status);
  const status = errors.length > 0
    ? 'partial'
    : statuses.length === 0
    ? 'not_applicable'
    : statuses.every((value) => value === 'satisfied')
      ? 'satisfied'
      : statuses.every((value) => value === 'missing')
        ? 'missing'
        : 'partial';

  return { status, slots: results, errors };
}

export function validateUiProofBundle(bundle, options = {}) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(bundle)) {
    addError(errors, 'invalid_bundle', '', 'UI proof bundle must be an object.', 'Provide structured UI proof metadata.');
    return { valid: false, errors, warnings };
  }

  for (const field of REQUIRED_BUNDLE_FIELDS) requireField(bundle, field, '', errors);
  for (const field of REQUIRED_SCOPE_FIELDS) requireField(bundle.scope, field, 'scope', errors);
  const publicClaim = hasPublicClaim(bundle, options);
  validateClaimUses(bundle, options, errors);
  validateEvidenceKinds(bundle, errors);
  validateCommandsOrManualSteps(bundle, errors);
  validateObservations(bundle, errors);
  validateResult(bundle, errors);
  validateComparisonStatuses(bundle, errors);
  validateClaimLimits(bundle, errors);
  validatePrivacy(bundle, errors, publicClaim);
  validatePublicObservationPrivacy(bundle, errors, publicClaim);
  const artifactRefs = validateArtifacts(bundle, errors, publicClaim);
  validateObservationArtifactRefs(bundle, artifactRefs, errors);

  return { valid: errors.length === 0, errors, warnings };
}

function parseJsonOrFencedContent(content, filePath, label) {
  const trimmed = content.trim();
  if (!trimmed) {
    return { value: null, errors: [{ code: 'empty_file', path: filePath, message: `${label} file is empty.`, fix: 'Write JSON metadata before validating.' }] };
  }

  const jsonCandidates = [trimmed];
  const fenceMatches = [...trimmed.matchAll(/```(?:json|ui-proof-json)?\s*([\s\S]*?)```/gi)];
  for (const match of fenceMatches) jsonCandidates.push(match[1].trim());

  for (const candidate of jsonCandidates) {
    try {
      return { value: JSON.parse(candidate), errors: [] };
    } catch {
      // Try next candidate; final error is reported below.
    }
  }

  return {
    value: null,
    errors: [{ code: 'unparseable_json', path: filePath, message: `${label} metadata is not valid JSON.`, fix: 'Use a .json file or a markdown fenced JSON block; no YAML parser dependency is installed.' }],
  };
}

export function parseUiProofBundleContent(content, filePath = 'UI proof bundle') {
  const parsed = parseJsonOrFencedContent(content, filePath, 'UI proof bundle');
  return { bundle: parsed.value, errors: parsed.errors.map((error) => ({
    ...error,
    code: error.code === 'empty_file' ? 'empty_bundle_file' : error.code === 'unparseable_json' ? 'unparseable_bundle' : error.code,
    message: error.code === 'empty_file'
      ? 'UI proof bundle file is empty.'
      : error.code === 'unparseable_json'
        ? 'UI proof bundle metadata is not valid JSON.'
        : error.message,
    fix: error.code === 'empty_file'
      ? 'Write JSON UI proof metadata before validating.'
      : error.fix,
  })) };
}

export function parseUiProofSlotsContent(content, filePath = 'UI proof slots') {
  const parsed = parseJsonOrFencedContent(content, filePath, 'UI proof slots');
  if (parsed.errors.length > 0) return { slots: [], errors: parsed.errors };

  const value = parsed.value;
  const slots = Array.isArray(value)
    ? value
    : normalizeArray(value?.ui_proof_slots || value?.uiProofSlots || value?.planned_slots || value?.plannedSlots);

  if (slots.length === 0) {
    return {
      slots: [],
      errors: [{
        code: 'missing_planned_slots',
        path: filePath,
        message: 'Planned UI proof input must be an array or contain ui_proof_slots.',
        fix: 'Provide JSON with an array of planned slots or an object with ui_proof_slots.',
      }],
    };
  }

  return { slots, errors: [] };
}

export function readUiProofBundleFile(filePath) {
  return parseUiProofBundleContent(readFileSync(filePath, 'utf-8'), filePath);
}

function walkForUiProofFiles(dir, results) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkForUiProofFiles(fullPath, results);
      continue;
    }
    const name = entry.toLowerCase();
    if (['ui-proof.json', 'ui-proof.md', 'proof-bundle.json'].includes(name)) {
      results.add(fullPath);
    }
  }
}

export function findUiProofBundleFiles(planningDir) {
  const results = new Set();
  for (const relativePath of [
    'UI-PROOF.json',
    'ui-proof.json',
    'ui-proof.md',
    'ui-proof/UI-PROOF.json',
    'ui-proof/proof-bundle.json',
    'brownfield-change/UI-PROOF.json',
  ]) {
    const fullPath = join(planningDir, relativePath);
    if (existsSync(fullPath)) results.add(fullPath);
  }
  for (const relativeDir of ['phases', 'quick', 'brownfield-change']) {
    walkForUiProofFiles(join(planningDir, relativeDir), results);
  }
  return [...results].sort();
}

function resolveWorkspacePath(cwd, target) {
  const workspaceRoot = resolve(cwd);
  const resolved = resolve(workspaceRoot, target);
  const rel = relative(workspaceRoot, resolved);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return resolved;
  fail(`Path must stay inside the workspace: ${target}`);
}

function parseClaimUse(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--claim') fail('Usage: gsdd ui-proof validate <path> [--claim <public|publication|tracked|delivery|release>]');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) fail('Usage: gsdd ui-proof validate <path> [--claim <public|publication|tracked|delivery|release>]');
    values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
    index += 1;
  }
  for (const value of values) {
    if (!PUBLIC_CLAIM_USES.includes(value)) fail(`Unsupported UI proof claim use: ${value}`);
  }
  return values;
}

function cmdValidate(cwd, args) {
  const [targetArg, ...flags] = args;
  if (!targetArg) fail('Usage: gsdd ui-proof validate <path> [--claim <public|publication|tracked|delivery|release>]');
  const target = resolveWorkspacePath(cwd, targetArg);
  if (!existsSync(target) || statSync(target).isDirectory()) fail(`UI proof bundle file does not exist: ${targetArg}`);

  const parsed = readUiProofBundleFile(target);
  const validation = parsed.errors.length > 0
    ? { valid: false, errors: parsed.errors, warnings: [] }
    : validateUiProofBundle(parsed.bundle, { claimUses: parseClaimUse(flags) });

  output({ operation: 'ui-proof validate', target: targetArg, valid: validation.valid, errors: validation.errors, warnings: validation.warnings });
  if (!validation.valid) process.exitCode = 1;
}

function cmdCompare(cwd, args) {
  const [plannedArg, ...observedArgs] = args;
  if (!plannedArg) fail('Usage: gsdd ui-proof compare <planned-slots-json> [observed-bundle-json ...]');

  const plannedPath = resolveWorkspacePath(cwd, plannedArg);
  if (!existsSync(plannedPath) || statSync(plannedPath).isDirectory()) fail(`Planned UI proof slots file does not exist: ${plannedArg}`);

  const planned = parseUiProofSlotsContent(readFileSync(plannedPath, 'utf-8'), plannedArg);
  const observedBundles = [];
  const observedTargets = [];
  const observedErrors = [];

  for (const observedArg of observedArgs) {
    const observedPath = resolveWorkspacePath(cwd, observedArg);
    if (!existsSync(observedPath) || statSync(observedPath).isDirectory()) fail(`Observed UI proof bundle file does not exist: ${observedArg}`);
    const parsed = readUiProofBundleFile(observedPath);
    if (parsed.errors.length > 0) {
      observedErrors.push(...parsed.errors.map((error) => ({ ...error, path: observedArg })));
      observedBundles.push({
        bundle: {},
        validation: { valid: false, errors: parsed.errors, warnings: [] },
        source: observedArg,
      });
    } else {
      observedBundles.push({ bundle: parsed.bundle, source: observedArg });
    }
    observedTargets.push(observedArg);
  }

  const comparison = planned.errors.length > 0
    ? { status: 'missing', slots: [], errors: planned.errors }
    : compareUiProofSlots(planned.slots, observedBundles);

  output({
    operation: 'ui-proof compare',
    planned: plannedArg,
    observed: observedTargets,
    status: comparison.status,
    slots: comparison.slots,
    errors: [...(comparison.errors || []), ...observedErrors],
  });
  if (!['satisfied', 'not_applicable'].includes(comparison.status)) process.exitCode = 1;
}

export function cmdUiProof(...args) {
  const { args: normalizedArgs, workspaceRoot, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const [operation, ...rest] = normalizedArgs;
  try {
    switch (operation) {
      case 'validate':
        cmdValidate(workspaceRoot, rest);
        return;
      case 'compare':
        cmdCompare(workspaceRoot, rest);
        return;
      default:
        fail('Usage: gsdd ui-proof <validate|compare> ...');
    }
  } catch (error) {
    if (error instanceof UiProofError) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

export {
  ARTIFACT_VISIBILITIES as UI_PROOF_ARTIFACT_VISIBILITIES,
  COMPARISON_STATUSES as UI_PROOF_COMPARISON_STATUSES,
  EVIDENCE_KINDS as UI_PROOF_EVIDENCE_KINDS,
  RAW_ARTIFACT_TYPES as UI_PROOF_RAW_ARTIFACT_TYPES,
};
