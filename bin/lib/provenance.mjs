function normalizePrState(prState) {
  if (!prState) return 'none';
  return String(prState).trim().toLowerCase();
}

function normalizeCount(value) {
  if (value === 'unknown' || value === null || value === undefined) return 'unknown';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 'unknown';
}

function normalizeCheckpointWorkflow(workflow) {
  const normalized = String(workflow || 'generic').trim().toLowerCase();
  return ['phase', 'quick', 'generic'].includes(normalized) ? normalized : 'generic';
}

export function classifyCheckpointRouting(workflow) {
  const normalizedWorkflow = normalizeCheckpointWorkflow(workflow);
  const progressBlocks = normalizedWorkflow === 'phase' || normalizedWorkflow === 'quick';

  return {
    workflow: normalizedWorkflow,
    routingClass: progressBlocks ? 'blocking' : 'informational',
    progressBlocks,
    resumeOwnsCleanup: true,
  };
}

export function parseGitStatusShort(statusText = '') {
  const lines = statusText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const files = [];
  for (const line of lines) {
    const match = line.match(/^(.)(.)\s+(.+)$/);
    if (!match) continue;

    const indexStatus = match[1];
    const worktreeStatus = match[2];
    if (indexStatus === '!' && worktreeStatus === '!') continue;

    const rawPath = match[3].replace(/\\/g, '/');
    const renameMatch = rawPath.match(/^(.*?)\s+->\s+(.*?)$/);
    const filePath = renameMatch ? renameMatch[2] : rawPath;
    files.push({
      path: filePath,
      fromPath: renameMatch ? renameMatch[1] : null,
      staged: indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!',
      unstaged: worktreeStatus !== ' ' && worktreeStatus !== '?' && worktreeStatus !== '!',
      untracked: indexStatus === '?' || worktreeStatus === '?',
    });
  }

  return {
    files,
    stagedCount: files.filter((file) => file.staged).length,
    unstagedCount: files.filter((file) => file.unstaged).length,
    untrackedCount: files.filter((file) => file.untracked).length,
    dirty: files.length > 0,
  };
}

export function classifyBrownfieldCheckpointPrecedence({
  checkpoint = {},
  planning = {},
  quick = {},
  brownfieldChange = {},
  git = {},
  status = parseGitStatusShort(git.statusShort || ''),
} = {}) {
  const checkpointRouting = classifyCheckpointRouting(checkpoint.workflow);
  if (!brownfieldChange?.exists) {
    return {
      primary: checkpointRouting.progressBlocks ? 'checkpoint' : 'none',
      checkpointRouting,
      branchAligned: false,
      scopeAligned: false,
      executionActive: false,
      checkpointCanOverrideBrownfield: false,
      strictMatchRequired: false,
    };
  }

  if (checkpointRouting.workflow === 'generic') {
    return {
      primary: 'brownfield_change',
      checkpointRouting,
      branchAligned: false,
      scopeAligned: false,
      executionActive: false,
      checkpointCanOverrideBrownfield: false,
      strictMatchRequired: true,
    };
  }

  const brownfieldMismatch = classifyBrownfieldArtifactMismatch({
    brownfieldChange,
    git,
    status,
  });
  const currentBranch = normalizeBranchName(git.branch);
  const checkpointBranch = normalizeBranchName(checkpoint.branch);
  const brownfieldBranch = normalizeBranchName(brownfieldChange.currentIntegrationSurface);
  const branchAligned = Boolean(
    currentBranch
    && checkpointBranch
    && brownfieldBranch
    && checkpointBranch === currentBranch
    && brownfieldBranch === currentBranch
  );
  const scopeAligned = !brownfieldMismatch.warnings.some((warning) =>
    warning.id === 'brownfield_scope_mismatch' || warning.id === 'brownfield_status_mismatch'
  );
  const executionActive = checkpointExecutionIsActive({
    checkpoint,
    checkpointRouting,
    planning,
    quick,
  });
  const checkpointCanOverrideBrownfield = branchAligned && scopeAligned && executionActive;

  return {
    primary: checkpointCanOverrideBrownfield ? 'checkpoint' : 'brownfield_change',
    checkpointRouting,
    branchAligned,
    scopeAligned,
    executionActive,
    checkpointCanOverrideBrownfield,
    strictMatchRequired: true,
  };
}

export function classifyBrownfieldArtifactMismatch({
  brownfieldChange = {},
  git = {},
  status = parseGitStatusShort(git.statusShort || ''),
} = {}) {
  if (!brownfieldChange?.exists) {
    return {
      warnings: [],
      requiresAcknowledgement: false,
      outsideOwnedPaths: [],
    };
  }

  const warnings = [];
  const declaredBranch = normalizeDeclaredBranch(brownfieldChange.currentIntegrationSurface);
  const branch = String(git.branch || '').trim().toLowerCase();
  if (declaredBranch && branch && declaredBranch !== branch) {
    warnings.push({
      id: 'brownfield_branch_mismatch',
      severity: 'acknowledgement_required',
      summary: `CHANGE.md says the active integration surface is "${brownfieldChange.currentIntegrationSurface}", but git reports "${git.branch}".`,
    });
  }

  const ownedPaths = normalizeOwnedPaths(brownfieldChange.declaredOwnedPaths || []);
  const outsideOwnedPaths = ownedPaths.length === 0
    ? []
    : status.files
      .map((file) => file.path)
      .filter((filePath) => !ownedPaths.some((ownedPath) => matchesOwnedPath(filePath, ownedPath)));
  if (outsideOwnedPaths.length > 0) {
    warnings.push({
      id: 'brownfield_scope_mismatch',
      severity: 'acknowledgement_required',
      summary: `Dirty files fall outside the CHANGE.md write scope: ${outsideOwnedPaths.join(', ')}`,
    });
  }

  if ((brownfieldChange.currentStatus === 'closed' || brownfieldChange.currentStatus === 'ready_for_verification') && status.dirty) {
    warnings.push({
      id: 'brownfield_status_mismatch',
      severity: 'acknowledgement_required',
      summary: `CHANGE.md marks the change as "${brownfieldChange.currentStatus}", but the live worktree is still dirty.`,
    });
  }

  return {
    warnings,
    requiresAcknowledgement: warnings.some((warning) => warning.severity === 'acknowledgement_required'),
    outsideOwnedPaths,
  };
}

export function buildProvenanceSnapshot({
  checkpoint = {},
  planning = {},
  quick = {},
  brownfieldChange = {},
  git = {},
} = {}) {
  const checkpointRouting = classifyCheckpointRouting(checkpoint.workflow);
  const status = parseGitStatusShort(git.statusShort || '');
  const commitsAheadOfMain = normalizeCount(git.commitsAheadOfMain);
  const commitsAheadOfRemote = normalizeCount(git.commitsAheadOfRemote);
  const prState = normalizePrState(git.prState);
  const brownfieldMismatch = classifyBrownfieldArtifactMismatch({ brownfieldChange, git, status });
  const brownfieldRouting = classifyBrownfieldCheckpointPrecedence({
    checkpoint,
    planning,
    quick,
    brownfieldChange,
    git,
    status,
  });

  const warnings = [];

  if (status.dirty) {
    warnings.push({
      id: 'dirty_worktree',
      severity: 'warning',
      summary: 'Local worktree contains staged, unstaged, or untracked changes.',
    });
  }

  if (commitsAheadOfMain !== 'unknown' && commitsAheadOfMain > 0) {
    warnings.push({
      id: 'ahead_of_main',
      severity: 'warning',
      summary: `${commitsAheadOfMain} commit(s) are ahead of main on the current branch.`,
    });
  }

  if (commitsAheadOfRemote !== 'unknown' && commitsAheadOfRemote > 0) {
    warnings.push({
      id: 'unpushed_commits',
      severity: 'warning',
      summary: `${commitsAheadOfRemote} commit(s) are ahead of the tracked remote branch.`,
    });
  }

  if (prState === 'none') {
    warnings.push({
      id: 'missing_pr',
      severity: 'warning',
      summary: 'No pull request is associated with the current branch.',
    });
  }

  if (git.staleBranch) {
    warnings.push({
      id: 'stale_branch',
      severity: 'warning',
      summary: 'The current branch is stale or spent relative to the intended integration surface.',
    });
  }

  if (git.mixedScope) {
    warnings.push({
      id: 'mixed_scope',
      severity: 'warning',
      summary: 'The current worktree appears to mix multiple write scopes or phases.',
    });
  }

  if (git.materialCheckpointMismatch) {
    warnings.push({
      id: 'checkpoint_mismatch',
      severity: 'acknowledgement_required',
      summary: 'Checkpoint narrative truth materially understates or conflicts with the live branch/worktree truth.',
    });
  }

  warnings.push(...brownfieldMismatch.warnings);

  return {
    checkpoint: {
      workflow: checkpointRouting.workflow,
      phase: checkpoint.phase ?? null,
      branch: checkpoint.branch || null,
      runtime: checkpoint.runtime || 'unknown',
      hasNarrative: Boolean(checkpoint.hasNarrative),
      routing: checkpointRouting,
    },
    planning: {
      currentPhase: planning.currentPhase || null,
      nextPhase: planning.nextPhase || null,
      completedPhaseCount: Number.isFinite(Number(planning.completedPhaseCount))
        ? Number(planning.completedPhaseCount)
        : 0,
    },
    brownfieldChange: {
      exists: Boolean(brownfieldChange?.exists),
      title: brownfieldChange?.title || null,
      currentStatus: brownfieldChange?.currentStatus || null,
      currentIntegrationSurface: brownfieldChange?.currentIntegrationSurface || null,
      nextAction: brownfieldChange?.nextAction || null,
      declaredOwnedPaths: brownfieldChange?.declaredOwnedPaths || [],
    },
    routing: {
      primary: brownfieldRouting.primary,
      strictMatchRequired: brownfieldRouting.strictMatchRequired,
      checkpointCanOverrideBrownfield: brownfieldRouting.checkpointCanOverrideBrownfield,
      branchAligned: brownfieldRouting.branchAligned,
      scopeAligned: brownfieldRouting.scopeAligned,
      executionActive: brownfieldRouting.executionActive,
    },
    git: {
      branch: git.branch || 'unknown',
      prState,
      commitsAheadOfMain,
      commitsAheadOfRemote,
      stagedCount: status.stagedCount,
      unstagedCount: status.unstagedCount,
      untrackedCount: status.untrackedCount,
      dirty: status.dirty,
    },
    integrationSurface: {
      staleBranch: Boolean(git.staleBranch),
      mixedScope: Boolean(git.mixedScope),
      materialCheckpointMismatch: Boolean(git.materialCheckpointMismatch),
      materialBrownfieldMismatch: brownfieldMismatch.requiresAcknowledgement,
    },
    warnings,
    requiresAcknowledgement: warnings.some((warning) => warning.severity === 'acknowledgement_required'),
  };
}

function normalizeBranchName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/');
}

function normalizeDeclaredBranch(value) {
  return normalizeBranchName(value);
}

function normalizeOwnedPaths(values) {
  return values
    .map((value) => String(value || '').trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

function matchesOwnedPath(filePath, ownedPath) {
  if (ownedPath.includes('*')) {
    const prefix = ownedPath.split('*')[0];
    return filePath.startsWith(prefix);
  }
  return filePath === ownedPath
    || filePath.startsWith(`${ownedPath}/`)
    || ownedPath.startsWith(`${filePath}/`);
}

function checkpointExecutionIsActive({
  checkpoint = {},
  checkpointRouting = classifyCheckpointRouting(checkpoint.workflow),
  planning = {},
  quick = {},
} = {}) {
  if (checkpointRouting.workflow === 'quick') {
    return quick.hasIncompleteWork === true;
  }

  if (checkpointRouting.workflow !== 'phase') {
    return false;
  }

  const checkpointPhase = normalizePhaseRef(checkpoint.phase);
  if (!checkpointPhase) return false;

  const phases = Array.isArray(planning.phases) ? planning.phases : [];
  if (phases.length > 0) {
    const matchingPhase = phases.find((phase) => normalizePhaseRef(phase.number) === checkpointPhase);
    return Boolean(matchingPhase && matchingPhase.status !== 'done');
  }

  const currentPhase = normalizePhaseRef(planning.currentPhase);
  const nextPhase = normalizePhaseRef(planning.nextPhase);
  return checkpointPhase === currentPhase || checkpointPhase === nextPhase;
}

function normalizePhaseRef(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  const match = raw.match(/^(\d+(?:\.\d+)*)([a-z]?)$/i);
  if (!match) return raw;

  const numericSegments = match[1]
    .split('.')
    .map((segment) => String(parseInt(segment, 10)));
  return `${numericSegments.join('.')}${match[2] || ''}`;
}
