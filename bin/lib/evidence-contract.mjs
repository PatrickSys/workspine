const EVIDENCE_KINDS = Object.freeze(['code', 'test', 'runtime', 'delivery', 'human']);
const DELIVERY_POSTURES = Object.freeze(['repo_only', 'delivery_sensitive']);
const CLOSURE_SURFACES = Object.freeze(['verify', 'audit-milestone', 'complete-milestone']);

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
      requiredKinds: Object.freeze(['code', 'runtime']),
      recommendedKinds: Object.freeze(['test', 'delivery', 'human']),
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

export { CLOSURE_SURFACES, DELIVERY_POSTURES, EVIDENCE_KINDS };

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
  };
}
