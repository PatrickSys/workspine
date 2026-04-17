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

    const filePath = match[3].replace(/\\/g, '/');
    files.push({
      path: filePath,
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

export function buildProvenanceSnapshot({
  checkpoint = {},
  planning = {},
  git = {},
} = {}) {
  const checkpointRouting = classifyCheckpointRouting(checkpoint.workflow);
  const status = parseGitStatusShort(git.statusShort || '');
  const commitsAheadOfMain = normalizeCount(git.commitsAheadOfMain);
  const commitsAheadOfRemote = normalizeCount(git.commitsAheadOfRemote);
  const prState = normalizePrState(git.prState);

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

  return {
    checkpoint: {
      workflow: checkpointRouting.workflow,
      phase: checkpoint.phase ?? null,
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
    },
    warnings,
    requiresAcknowledgement: warnings.some((warning) => warning.severity === 'acknowledgement_required'),
  };
}
