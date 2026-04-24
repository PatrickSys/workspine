import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PHASE_LINE_RE = /^\s*[-*]\s*\[([ x-])\]\s*\*\*Phase\s+(\d+(?:\.\d+)*[a-z]?):\s*(.+?)\*\*(?:\s+—\s+\[([^\]]+)])?/i;
const PHASE_DETAIL_HEADING_RE = /^(#{3,})\s+Phase\s+(\d+(?:\.\d+)*[a-z]?)(?::|\b)/i;
const PHASE_DETAIL_STATUS_RE = /^\s*\*\*Status\*\*:\s*\[([ x-])\]/i;
const ACTIVE_MILESTONE_HEADING_RE = /^###\s+(v[^\s]+)\s+(.+)$/im;
const MILESTONE_LEDGER_HEADING_RE = /^##\s+(?:✅\s+)?(v[^\s]+)\s*(?:—|-)?\s*(.*)$/i;
const DETAILS_OPEN_RE = /<details\b/i;
const DETAILS_CLOSE_RE = /<\/details>/i;

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

  const phases = parseActiveRoadmapPhases(roadmap);
  const phaseStatusAlignment = evaluateRoadmapPhaseStatusAlignment(roadmap);
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
    phaseStatusAlignment,
    requirementAlignment: evaluateRequirementAlignment(spec, enrichedPhases, phaseStatusAlignment),
    provenance: provenance
      ? {
          provided: true,
          ...provenance,
        }
      : { provided: false },
  };
}

function evaluateRoadmapPhaseStatusAlignment(roadmap) {
  if (!roadmap) return { mismatches: [] };

  const overview = new Map();
  const details = new Map();
  const lines = normalizeContent(roadmap).split('\n');
  let inDetails = false;
  let currentDetailPhase = null;

  for (const line of lines) {
    if (DETAILS_OPEN_RE.test(line) && !DETAILS_CLOSE_RE.test(line)) {
      inDetails = true;
      currentDetailPhase = null;
      continue;
    }
    if (DETAILS_CLOSE_RE.test(line)) {
      inDetails = false;
      currentDetailPhase = null;
      continue;
    }
    if (inDetails) continue;

    const phaseMatch = line.match(PHASE_LINE_RE);
    if (phaseMatch) {
      const phaseToken = normalizePhaseToken(phaseMatch[2]);
      const status = normalizePhaseStatus(phaseMatch[1]);
      if (!overview.has(phaseToken)) overview.set(phaseToken, []);
      overview.get(phaseToken).push(status);
      continue;
    }

    const headingMatch = line.match(PHASE_DETAIL_HEADING_RE);
    if (headingMatch) {
      currentDetailPhase = normalizePhaseToken(headingMatch[2]);
      if (!details.has(currentDetailPhase)) details.set(currentDetailPhase, []);
      continue;
    }

    if (/^#+\s+/.test(line)) {
      currentDetailPhase = null;
      continue;
    }

    const statusMatch = line.match(PHASE_DETAIL_STATUS_RE);
    if (statusMatch && currentDetailPhase) {
      details.get(currentDetailPhase).push(normalizePhaseStatus(statusMatch[1]));
    }
  }

  const mismatches = [];
  const phaseTokens = new Set([...overview.keys(), ...details.keys()]);
  for (const phaseToken of [...phaseTokens].sort(comparePhaseTokens)) {
    const overviewStatuses = overview.get(phaseToken) || [];
    const detailStatuses = details.get(phaseToken) || [];
    if (overviewStatuses.length > 1) {
      mismatches.push(`Phase ${phaseToken} has multiple overview status entries`);
    }
    if (detailStatuses.length > 1) {
      mismatches.push(`Phase ${phaseToken} has multiple Phase Details status entries`);
    }
    if (overviewStatuses.length === 1 && details.has(phaseToken) && detailStatuses.length === 0) {
      mismatches.push(`Phase ${phaseToken} overview exists but Phase Details status is missing`);
    }
    if (detailStatuses.length > 0 && overviewStatuses.length === 0) {
      mismatches.push(`Phase ${phaseToken} Phase Details status exists but overview entry is missing`);
    }
    if (overviewStatuses.length === 1 && detailStatuses.length === 1 && overviewStatuses[0] !== detailStatuses[0]) {
      mismatches.push(`Phase ${phaseToken} overview status ${overviewStatuses[0]} disagrees with Phase Details status ${detailStatuses[0]}`);
    }
  }

  return { mismatches };
}

function comparePhaseTokens(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function readTextIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
}

function normalizeContent(content) {
  return String(content || '').replace(/\r\n/g, '\n');
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
    if (DETAILS_OPEN_RE.test(line) && !DETAILS_CLOSE_RE.test(line)) {
      inDetails = true;
      continue;
    }
    if (DETAILS_CLOSE_RE.test(line)) {
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

function evaluateRequirementAlignment(spec, phases, phaseStatusAlignment = { mismatches: [] }) {
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
