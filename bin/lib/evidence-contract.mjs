const EVIDENCE_KINDS = Object.freeze(['code', 'test', 'runtime', 'delivery', 'human']);
const DELIVERY_POSTURES = Object.freeze(['repo_only', 'delivery_sensitive']);
const CLOSURE_SURFACES = Object.freeze(['verify', 'audit-milestone', 'complete-milestone']);
const RELEASE_CLAIM_POSTURES = Object.freeze([
  'repo_closeout',
  'runtime_validated_closeout',
  'delivery_supported_closeout',
]);

const LEGACY_EVIDENCE_ALIASES = Object.freeze({
  code: 'code',
  test: 'test',
  runtime: 'runtime',
  delivery: 'delivery',
  human: 'human',
  'code-evidence': 'code',
  'repo-test': 'test',
  'runtime-check': 'runtime',
  'user-confirmation': 'human',
});

const EVIDENCE_MATRIX = Object.freeze({
  verify: Object.freeze({
    repo_only: Object.freeze({
      requiredKinds: Object.freeze(['code']),
      recommendedKinds: Object.freeze(['test']),
      blockedSoloKinds: Object.freeze(['human', 'delivery']),
    }),
    delivery_sensitive: Object.freeze({
      requiredKinds: Object.freeze(['code', 'runtime', 'delivery']),
      recommendedKinds: Object.freeze(['test', 'human']),
      blockedSoloKinds: Object.freeze(['code', 'human']),
    }),
  }),
  'audit-milestone': Object.freeze({
    repo_only: Object.freeze({
      requiredKinds: Object.freeze(['code', 'test']),
      recommendedKinds: Object.freeze(['runtime', 'human']),
      blockedSoloKinds: Object.freeze(['human', 'delivery']),
    }),
    delivery_sensitive: Object.freeze({
      requiredKinds: Object.freeze(['code', 'test', 'runtime', 'delivery']),
      recommendedKinds: Object.freeze(['human']),
      blockedSoloKinds: Object.freeze(['code', 'human']),
    }),
  }),
  'complete-milestone': Object.freeze({
    repo_only: Object.freeze({
      requiredKinds: Object.freeze(['code', 'test']),
      recommendedKinds: Object.freeze(['runtime']),
      blockedSoloKinds: Object.freeze(['human', 'delivery']),
    }),
    delivery_sensitive: Object.freeze({
      requiredKinds: Object.freeze(['code', 'test', 'runtime', 'delivery']),
      recommendedKinds: Object.freeze(['human']),
      blockedSoloKinds: Object.freeze(['code', 'human']),
    }),
  }),
});

const CONTRADICTION_CATEGORIES = Object.freeze([
  'evidence',
  'public_surface',
  'runtime',
  'delivery',
  'planning_drift',
  'generated_surface',
]);

const RELEASE_CLAIM_MATRIX = Object.freeze({
  repo_closeout: Object.freeze({
    deliveryPosture: 'repo_only',
    requiredClaimKinds: Object.freeze([]),
    allowedClaim: 'Repo-local milestone or phase closeout is supported by planning and repository artifacts only.',
    invalidClaim: 'Do not imply runtime validation, delivery, publication, or public support from repo-local closeout alone.',
  }),
  runtime_validated_closeout: Object.freeze({
    deliveryPosture: 'repo_only',
    requiredClaimKinds: Object.freeze(['runtime']),
    allowedClaim: 'Runtime behavior or a runtime surface was directly executed and observed for the named runtime or surface.',
    invalidClaim: 'Do not generalize validation from one runtime or generated surface to another.',
  }),
  delivery_supported_closeout: Object.freeze({
    deliveryPosture: 'delivery_sensitive',
    requiredClaimKinds: Object.freeze([]),
    allowedClaim: 'Externally consumed release, support, install, or delivery claims are supported by the delivery-sensitive evidence bar.',
    invalidClaim: 'Do not imply merge, package, tag, GitHub Release, publication, generated-surface freshness, or public support without matching delivery evidence.',
  }),
});

const CONTRADICTION_BLOCKERS_BY_POSTURE = Object.freeze({
  repo_closeout: Object.freeze(['evidence', 'public_surface', 'planning_drift']),
  runtime_validated_closeout: Object.freeze(['evidence', 'runtime', 'generated_surface', 'planning_drift']),
  delivery_supported_closeout: CONTRADICTION_CATEGORIES,
});

export { CLOSURE_SURFACES, DELIVERY_POSTURES, EVIDENCE_KINDS, RELEASE_CLAIM_POSTURES };

export function normalizeEvidenceKind(kind) {
  if (!kind) {
    return null;
  }

  return LEGACY_EVIDENCE_ALIASES[kind] ?? null;
}

export function normalizeEvidenceKinds(kinds = []) {
  const normalized = [];
  for (const kind of kinds) {
    const resolved = normalizeEvidenceKind(kind);
    if (resolved && !normalized.includes(resolved)) {
      normalized.push(resolved);
    }
  }
  return normalized;
}

export function isClosureSurface(surface) {
  return CLOSURE_SURFACES.includes(surface);
}

export function normalizeReleaseClaimPosture(posture) {
  return RELEASE_CLAIM_POSTURES.includes(posture) ? posture : 'repo_closeout';
}

export function getEvidenceContract(surface, deliveryPosture) {
  const matrix = EVIDENCE_MATRIX[surface];
  if (!matrix) {
    throw new Error(`Unsupported closure evidence surface: ${surface}`);
  }

  const posture = matrix[deliveryPosture];
  if (!posture) {
    throw new Error(`Unsupported delivery posture for ${surface}: ${deliveryPosture}`);
  }

  return {
    surface,
    deliveryPosture,
    supportedKinds: [...EVIDENCE_KINDS],
    requiredKinds: [...posture.requiredKinds],
    recommendedKinds: [...posture.recommendedKinds],
    blockedSoloKinds: [...posture.blockedSoloKinds],
  };
}

export function describeEvidenceSurface(surface) {
  if (!isClosureSurface(surface)) {
    return null;
  }

  return {
    surface,
    supportedKinds: [...EVIDENCE_KINDS],
    deliveryPostures: DELIVERY_POSTURES.map((deliveryPosture) => getEvidenceContract(surface, deliveryPosture)),
    releaseClaimPostures: RELEASE_CLAIM_POSTURES.map((releaseClaimPosture) => getReleaseClaimContract(surface, releaseClaimPosture)),
  };
}

function uniqueKinds(kinds) {
  return [...new Set(kinds)];
}

function getDowngradePosture(observedKinds) {
  if (observedKinds.includes('runtime')) {
    return 'runtime_validated_closeout';
  }
  return 'repo_closeout';
}

export function getReleaseClaimContract(surface, releaseClaimPosture = 'repo_closeout') {
  const posture = normalizeReleaseClaimPosture(releaseClaimPosture);
  const claim = RELEASE_CLAIM_MATRIX[posture];
  const evidence = getEvidenceContract(surface, claim.deliveryPosture);
  const requiredKinds = uniqueKinds([...evidence.requiredKinds, ...claim.requiredClaimKinds]);

  return {
    surface,
    releaseClaimPosture: posture,
    deliveryPosture: claim.deliveryPosture,
    supportedKinds: [...EVIDENCE_KINDS],
    requiredKinds,
    requiredClaimKinds: [...claim.requiredClaimKinds],
    allowedClaim: claim.allowedClaim,
    invalidClaim: claim.invalidClaim,
    waiverRule: 'Waivers may only narrow the release claim posture or defer an unsupported claim; they never satisfy missing required evidence for the stronger claim.',
    deferralRule: 'Deferrals must name the unsupported claim, missing evidence kinds, and later workflow or milestone candidate when known.',
    contradictionCategories: [...CONTRADICTION_CATEGORIES],
  };
}

export function evaluateReleaseClaimPosture({
  surface,
  releaseClaimPosture = 'repo_closeout',
  observedKinds = [],
  waivedKinds = [],
} = {}) {
  const contract = getReleaseClaimContract(surface, releaseClaimPosture);
  const observed = normalizeEvidenceKinds(observedKinds);
  const waived = normalizeEvidenceKinds(waivedKinds);
  const missingKinds = contract.requiredKinds.filter((kind) => !observed.includes(kind));
  const invalidWaivers = waived.filter((kind) => missingKinds.includes(kind));
  const hasUnsupportedStrongClaim = contract.releaseClaimPosture !== 'repo_closeout' && missingKinds.length > 0;

  return {
    surface: contract.surface,
    releaseClaimPosture: contract.releaseClaimPosture,
    deliveryPosture: contract.deliveryPosture,
    requiredKinds: [...contract.requiredKinds],
    observedKinds: observed,
    missingKinds,
    invalidWaivers,
    status: missingKinds.length === 0 && invalidWaivers.length === 0 ? 'supported' : 'unsupported',
    disposition: hasUnsupportedStrongClaim ? 'downgrade_or_defer' : missingKinds.length > 0 ? 'block_or_defer' : 'proceed',
    downgradeTo: hasUnsupportedStrongClaim ? getDowngradePosture(observed) : null,
    deferredClaims: hasUnsupportedStrongClaim
      ? [{ claim: contract.releaseClaimPosture, missingKinds }]
      : [],
  };
}

export function evaluateReleaseClaimCloseoutContract({
  surface,
  deliveryPosture = null,
  releaseClaimPosture = 'repo_closeout',
  observedKinds = [],
  waivedKinds = [],
  unsupportedClaims = [],
  deferrals = [],
  contradictionChecks = {},
} = {}) {
  const posture = evaluateReleaseClaimPosture({
    surface,
    releaseClaimPosture,
    observedKinds,
    waivedKinds,
  });
  const failedContradictionChecks = Object.entries(contradictionChecks)
    .filter(([, status]) => status === 'failed')
    .map(([name]) => name);
  const blockingContradictionChecks = failedContradictionChecks.filter((name) =>
    CONTRADICTION_BLOCKERS_BY_POSTURE[posture.releaseClaimPosture].includes(name)
  );
  const unresolvedUnsupportedClaims = unsupportedClaims.filter((claim) =>
    !deferrals.some((deferral) => namesUnsupportedClaim(deferral, claim))
  );
  const blockers = [];

  if (deliveryPosture && deliveryPosture !== posture.deliveryPosture) {
    blockers.push({
      code: 'incompatible_release_claim_posture',
      details: [`${deliveryPosture} cannot support ${posture.releaseClaimPosture}; expected ${posture.deliveryPosture}`],
    });
  }

  if (posture.missingKinds.length > 0) {
    blockers.push({ code: 'missing_required_release_evidence', details: posture.missingKinds });
  }
  if (posture.invalidWaivers.length > 0) {
    blockers.push({ code: 'invalid_release_waivers', details: posture.invalidWaivers });
  }
  if (unresolvedUnsupportedClaims.length > 0) {
    blockers.push({ code: 'unsupported_release_claims', details: unresolvedUnsupportedClaims });
  }
  if (blockingContradictionChecks.length > 0) {
    blockers.push({ code: 'failed_release_contradiction_checks', details: blockingContradictionChecks });
  }

  return {
    ...posture,
    unsupportedClaims: [...unsupportedClaims],
    deferrals: [...deferrals],
    failedContradictionChecks: blockingContradictionChecks,
    allFailedContradictionChecks: failedContradictionChecks,
    unresolvedUnsupportedClaims,
    blockers,
    status: blockers.length === 0 ? 'supported' : 'unsupported',
  };
}

function namesUnsupportedClaim(deferral, claim) {
  const normalizedDeferral = normalizeClaimText(deferral);
  const normalizedClaim = normalizeClaimText(claim);
  if (!normalizedDeferral || !normalizedClaim) return false;
  return normalizedDeferral.includes(normalizedClaim) && isStructuredDeferral(normalizedDeferral);
}

function isStructuredDeferral(normalizedDeferral) {
  const namesEvidenceKind = EVIDENCE_KINDS.some((kind) => normalizedDeferral.includes(kind));
  const namesLaterTarget = /\b(later|next|future|workflow|milestone|phase|gsdd)\b/.test(normalizedDeferral);
  return namesEvidenceKind && namesLaterTarget;
}

function normalizeClaimText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
