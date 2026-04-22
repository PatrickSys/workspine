import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const BROWNFIELD_CHANGE_DIR = 'brownfield-change';

const PHASE_LINE_RE = /^\s*[-*]\s*\[([ x-])\]\s*\*\*Phase\s+(\d+(?:\.\d+)*[a-z]?):\s*(.+?)\*\*(?:\s+—\s+\[([^\]]+)])?/i;
const ACTIVE_MILESTONE_HEADING_RE = /^###\s+(v[^\s]+)\s+(.+)$/im;
const MILESTONE_LEDGER_HEADING_RE = /^##\s+(?:✅\s+)?(v[^\s]+)\s*(?:—|-)?\s*(.*)$/i;

export function evaluateLifecycleState({ planningDir, provenance = null } = {}) {
  if (!planningDir) {
    throw new Error('planningDir is required');
  }

  const specPath = join(planningDir, 'SPEC.md');
  const roadmapPath = join(planningDir, 'ROADMAP.md');
  const milestonesPath = join(planningDir, 'MILESTONES.md');
  const phasesDir = join(planningDir, 'phases');

  const spec = readTextIfExists(specPath);
  const roadmap = readTextIfExists(roadmapPath);
  const milestones = readTextIfExists(milestonesPath);
  const brownfieldChange = readBrownfieldChangeState(planningDir);
  const nonPhaseState = deriveNonPhaseState({
    planningDir,
    hasSpec: Boolean(spec.trim()),
    hasRoadmap: Boolean(roadmap.trim()),
    brownfieldChange,
  });

  const phases = parseActiveRoadmapPhases(roadmap);
  const phaseArtifacts = collectPhaseArtifacts(phasesDir);
  const enrichedPhases = phases.map((phase) => {
    const matchingArtifacts = phaseArtifacts.filter((artifact) => artifact.phaseToken === phase.number);
    const hasPlan = matchingArtifacts.some((artifact) => artifact.kind === 'plan');
    const hasSummary = matchingArtifacts.some((artifact) => artifact.kind === 'summary');
    return {
      ...phase,
      hasArtifacts: matchingArtifacts.length > 0,
      hasPlan,
      hasSummary,
      artifacts: matchingArtifacts,
    };
  });

  const incompletePlans = phaseArtifacts.filter((artifact) => {
    if (artifact.kind !== 'plan') return false;
    return !phaseArtifacts.some((candidate) =>
      candidate.dir === artifact.dir &&
      candidate.baseId === artifact.baseId &&
      candidate.kind === 'summary'
    );
  });

  const counts = {
    total: enrichedPhases.length,
    completed: enrichedPhases.filter((phase) => phase.status === 'done').length,
    inProgress: enrichedPhases.filter((phase) => phase.status === 'in_progress').length,
    notStarted: enrichedPhases.filter((phase) => phase.status === 'not_started').length,
  };

  const milestoneLedger = parseMilestoneLedger(milestones);
  const currentMilestone = deriveCurrentMilestone({
    roadmap,
    planningDir,
    milestoneLedger,
    counts,
  });

  return {
    paths: {
      specPath,
      roadmapPath,
      milestonesPath,
      phasesDir,
    },
    currentMilestone,
    phases: enrichedPhases,
    currentPhase: enrichedPhases.find((phase) => phase.status === 'in_progress') || null,
    nextPhase: enrichedPhases.find((phase) => phase.status === 'not_started') || null,
    counts,
    phaseArtifacts,
    incompletePlans,
    brownfieldChange,
    nonPhaseState,
    requirementAlignment: evaluateRequirementAlignment(spec, enrichedPhases),
    provenance: provenance
      ? {
          provided: true,
          ...provenance,
        }
      : { provided: false },
  };
}

function readTextIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
}

function normalizeContent(content) {
  return String(content || '').replace(/\r\n/g, '\n');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizePhaseToken(value) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)*)([a-z]?)$/i);
  if (!match) return raw;

  const numericSegments = match[1]
    .split('.')
    .map((segment) => String(parseInt(segment, 10)));
  return `${numericSegments.join('.')}${match[2] || ''}`;
}

function normalizePhaseStatus(marker) {
  const normalized = String(marker || '').trim().toLowerCase();
  if (normalized === 'x') return 'done';
  if (normalized === '-') return 'in_progress';
  return 'not_started';
}

function parseActiveRoadmapPhases(roadmap) {
  if (!roadmap) return [];

  const phases = [];
  let inDetails = false;

  for (const line of normalizeContent(roadmap).split('\n')) {
    if (line.includes('<details>') && !line.includes('</details>')) {
      inDetails = true;
      continue;
    }
    if (line.includes('</details>')) {
      inDetails = false;
      continue;
    }
    if (inDetails) continue;

    const match = line.match(PHASE_LINE_RE);
    if (!match) continue;

    phases.push({
      number: normalizePhaseToken(match[2]),
      title: match[3].trim(),
      status: normalizePhaseStatus(match[1]),
      requirements: splitRequirementList(match[4]),
    });
  }

  return phases;
}

export function readBrownfieldChangeState(planningDir) {
  const dir = join(planningDir, BROWNFIELD_CHANGE_DIR);
  const changePath = join(dir, 'CHANGE.md');
  const handoffPath = join(dir, 'HANDOFF.md');

  if (!existsSync(changePath)) {
    return {
      exists: false,
      dir,
      changePath,
      handoffPath,
      title: null,
      changeId: null,
      currentStatus: null,
      currentIntegrationSurface: null,
      currentOwnerRuntime: null,
      nextAction: null,
      declaredOwnedPaths: [],
      handoff: null,
    };
  }

  const changeArtifact = readMarkdownArtifact(changePath);
  const handoffArtifact = existsSync(handoffPath) ? readMarkdownArtifact(handoffPath) : null;
  const currentStatusSection = extractMarkdownSection(changeArtifact.body, 'Current Status');
  const nextActionSection = extractMarkdownSection(changeArtifact.body, 'Next Action');
  const sliceSection = extractMarkdownSection(changeArtifact.body, 'PR Slice Ownership');

  return {
    exists: true,
    dir,
    changePath,
    handoffPath,
    title: extractMarkdownHeading(changeArtifact.body),
    changeId: changeArtifact.frontmatter.change || null,
    currentStatus: changeArtifact.frontmatter.status || extractBulletLabel(currentStatusSection, 'Current posture'),
    currentIntegrationSurface: extractBulletLabel(currentStatusSection, 'Current branch / integration surface'),
    currentOwnerRuntime: extractBulletLabel(currentStatusSection, 'Current owner / runtime'),
    nextAction: collapseMarkdownSection(nextActionSection),
    declaredOwnedPaths: parseOwnedPathHints(sliceSection),
    handoff: handoffArtifact
      ? {
          updated: handoffArtifact.frontmatter.updated || null,
          activeConstraints: collapseMarkdownSection(extractMarkdownSection(handoffArtifact.body, 'Active Constraints')),
          unresolvedUncertainty: collapseMarkdownSection(extractMarkdownSection(handoffArtifact.body, 'Unresolved Uncertainty')),
          decisionPosture: collapseMarkdownSection(extractMarkdownSection(handoffArtifact.body, 'Decision Posture')),
          antiRegression: collapseMarkdownSection(extractMarkdownSection(handoffArtifact.body, 'Anti-Regression')),
          nextActionContext: collapseMarkdownSection(extractMarkdownSection(handoffArtifact.body, 'Next Action')),
        }
      : null,
  };
}

export function deriveNonPhaseState({ planningDir, hasSpec, hasRoadmap, brownfieldChange } = {}) {
  if (brownfieldChange?.exists) return 'active_brownfield_change';
  if (hasRoadmap) return null;
  if (hasSpec) return 'between_milestones';
  if (hasSubstantiveCodebaseMaps(planningDir)) return 'codebase_only';
  if (hasQuickLaneArtifacts(planningDir)) return 'quick_lane';
  return null;
}

function splitRequirementList(rawRequirements = '') {
  return String(rawRequirements)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function collectPhaseArtifacts(phasesDir) {
  if (!existsSync(phasesDir)) return [];

  const artifacts = [];
  for (const entry of readdirSync(phasesDir, { withFileTypes: true })) {
    const entryPath = join(phasesDir, entry.name);
    if (entry.isFile()) {
      const artifact = classifyPhaseArtifact('', entry.name);
      if (artifact) artifacts.push(artifact);
      continue;
    }

    if (!entry.isDirectory()) continue;

    for (const child of readdirSync(entryPath, { withFileTypes: true })) {
      if (!child.isFile()) continue;
      const artifact = classifyPhaseArtifact(entry.name, child.name);
      if (artifact) artifacts.push(artifact);
    }
  }

  return artifacts;
}

function classifyPhaseArtifact(dir, name) {
  const baseIdMatch = name.match(/^(\d+(?:\.\d+)*[a-z]?(?:-\d+)?)/i);
  const phaseTokenMatch = (dir ? dir.match(/^(\d+(?:\.\d+)*[a-z]?)-/i) : null)
    || name.match(/^(\d+(?:\.\d+)*[a-z]?)/i);

  if (!baseIdMatch || !phaseTokenMatch) return null;

  let kind = 'other';
  if (name.includes('PLAN')) kind = 'plan';
  else if (name.includes('SUMMARY')) kind = 'summary';
  else if (name.includes('VERIFICATION')) kind = 'verification';
  else if (name.includes('APPROACH')) kind = 'approach';

  return {
    dir,
    name,
    displayPath: dir ? `${dir}/${name}` : name,
    baseId: baseIdMatch[1],
    phaseToken: normalizePhaseToken(phaseTokenMatch[1]),
    kind,
  };
}

function parseMilestoneLedger(content) {
  if (!content) return [];

  const entries = [];
  let current = null;

  for (const line of normalizeContent(content).split('\n')) {
    const headingMatch = line.match(MILESTONE_LEDGER_HEADING_RE);
    if (headingMatch) {
      if (current) entries.push(current);
      current = {
        version: headingMatch[1],
        title: headingMatch[2].trim(),
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) entries.push(current);

  return entries.map((entry) => {
    const section = entry.lines.join('\n');
    const statusMatch = section.match(/^- Status:\s*(.+)$/im);
    const shipped = /(^- Status:\s*shipped$)|(^- Shipped:\s+)/im.test(section) || /^✅/.test(entry.title);
    return {
      version: entry.version,
      title: entry.title.replace(/^✅\s*/, ''),
      status: statusMatch ? statusMatch[1].trim().toLowerCase() : shipped ? 'shipped' : 'unknown',
      shipped,
    };
  });
}

function deriveCurrentMilestone({ roadmap, planningDir, milestoneLedger, counts }) {
  const normalizedRoadmap = normalizeContent(roadmap);
  const headingMatch = normalizedRoadmap.match(ACTIVE_MILESTONE_HEADING_RE);
  if (!headingMatch) {
    return {
      version: null,
      title: null,
      shippedInLedger: false,
      hasMatchingAudit: false,
      archiveState: 'unknown',
      counts,
    };
  }

  const version = headingMatch[1];
  const title = headingMatch[2].trim();
  const ledgerEntry = milestoneLedger.find((entry) => entry.version === version) || null;
  const auditPath = join(planningDir, `${version}-MILESTONE-AUDIT.md`);
  const hasMatchingAudit = existsSync(auditPath);
  const shippedInLedger = Boolean(ledgerEntry?.shipped);

  return {
    version,
    title,
    shippedInLedger,
    hasMatchingAudit,
    archiveState: shippedInLedger && hasMatchingAudit ? 'archived' : 'active',
    counts,
  };
}

function evaluateRequirementAlignment(spec, phases) {
  const checkedRequirements = new Set(
    [...normalizeContent(spec).matchAll(/- \[x\] \*\*\[([A-Z0-9-]+)]\*\*/g)].map((result) => result[1])
  );

  const roadmapRequirements = new Map();
  for (const phase of phases) {
    for (const requirementId of phase.requirements) {
      roadmapRequirements.set(requirementId, phase.status === 'done');
    }
  }

  const mismatches = [];
  for (const [requirementId, roadmapStatus] of roadmapRequirements.entries()) {
    const specChecked = checkedRequirements.has(requirementId);
    if (roadmapStatus && !specChecked) {
      mismatches.push(`${requirementId} phase complete but SPEC unchecked`);
    }
    if (!roadmapStatus && specChecked) {
      mismatches.push(`${requirementId} SPEC checked but phase incomplete`);
    }
  }

  return {
    checkedRequirements,
    roadmapRequirements,
    mismatches,
  };
}

function readMarkdownArtifact(filePath) {
  const raw = readTextIfExists(filePath);
  const normalized = normalizeContent(raw);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      raw: normalized,
      frontmatter: {},
      body: normalized,
    };
  }

  return {
    raw: normalized,
    frontmatter: parseFrontmatter(match[1]),
    body: normalized.slice(match[0].length),
  };
}

function parseFrontmatter(content) {
  const data = {};
  for (const line of normalizeContent(content).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;
    data[match[1]] = match[2].trim();
  }
  return data;
}

function extractMarkdownHeading(content) {
  return normalizeContent(content).match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
}

function extractMarkdownSection(content, heading) {
  const normalized = normalizeContent(content);
  const headingMatch = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm').exec(normalized);
  if (!headingMatch) return '';

  const start = headingMatch.index + headingMatch[0].length;
  const remainder = normalized.slice(start).replace(/^\n/, '');
  const nextHeading = /\n##\s+/.exec(remainder);
  const end = nextHeading ? nextHeading.index : remainder.length;
  return remainder.slice(0, end).trim();
}

function extractBulletLabel(section, label) {
  const match = normalizeContent(section).match(
    new RegExp(`^[-*]\\s+${escapeRegExp(label)}\\s*:\\s*(.+)$`, 'im')
  );
  return match ? match[1].trim() : null;
}

function collapseMarkdownSection(section) {
  return normalizeContent(section)
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .join(' ');
}

function parseOwnedPathHints(section) {
  const lines = normalizeContent(section)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  const paths = [];

  for (const line of lines.slice(2)) {
    const columns = line.split('|').map((column) => column.trim());
    const owned = columns[3];
    if (!owned) continue;

    for (const candidate of owned.split(',')) {
      const normalized = normalizeOwnedPathHint(candidate);
      if (normalized) paths.push(normalized);
    }
  }

  return [...new Set(paths)];
}

function normalizeOwnedPathHint(value) {
  const normalized = String(value || '')
    .replace(/[`[\]]/g, '')
    .trim()
    .replace(/\\/g, '/');
  if (!normalized) return null;
  if (/^(disjoint write set|owned files \/ modules|what this slice does|planned)$/i.test(normalized)) {
    return null;
  }
  if (!/[/.\\*]/.test(normalized)) return null;
  return normalized;
}

function hasSubstantiveCodebaseMaps(planningDir) {
  const dir = join(planningDir, 'codebase');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((entry) => entry.toLowerCase().endsWith('.md'));
}

function hasQuickLaneArtifacts(planningDir) {
  const dir = join(planningDir, 'quick');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).length > 0;
}
