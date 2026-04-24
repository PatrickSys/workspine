// phase.mjs — Phase discovery, verification, and scaffolding
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { output } from './cli-utils.mjs';
import { writeFingerprint } from './session-fingerprint.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';

const PHASE_STATUS_MARKERS = {
  not_started: '[ ]',
  todo: '[ ]',
  in_progress: '[-]',
  done: '[x]',
};

const PHASE_MARKER_RE = '(\\[[ x]\\]|\\[-\\]|â¬œ|ðŸ"„|âœ…|⬜|🔄|✅)';
const PHASE_TOKEN_RE = '(\\d+(?:\\.\\d+)*[a-z]?)';
const PHASE_LINE_RE = new RegExp(
  `^[-*]\\s*${PHASE_MARKER_RE}\\s*\\*\\*Phase\\s+${PHASE_TOKEN_RE}:\\s*(.+?)\\*\\*`,
  'i'
);
const ROADMAP_PHASE_STATUS_RE = new RegExp(
  `^(\\s*[-*]\\s*)${PHASE_MARKER_RE}(\\s*\\*\\*Phase\\s+${PHASE_TOKEN_RE}:.*)$`,
  'i'
);
const PHASE_DETAIL_HEADING_RE = new RegExp(`^#{3,}\\s+Phase\\s+${PHASE_TOKEN_RE}(?::|\\b)`, 'i');
const PHASE_DETAIL_STATUS_RE = new RegExp(`^(\\s*\\*\\*Status\\*\\*:\\s*)${PHASE_MARKER_RE}(.*)$`, 'i');
const DETAILS_OPEN_RE = /<details\b/i;
const DETAILS_CLOSE_RE = /<\/details>/i;

function findFiles(dir, prefix) {
  if (!existsSync(dir)) return [];

  const phaseArtifactPrefix = String(prefix).match(/^(\d+(?:\.\d+)*[a-z]?)-(PLAN|SUMMARY)$/i);
  if (!phaseArtifactPrefix) {
    return readdirSync(dir).filter((f) => f.startsWith(prefix) || f.startsWith(prefix.replace(/^0+/, '')));
  }

  const targetPhase = normalizePhaseToken(phaseArtifactPrefix[1]);
  const targetKind = phaseArtifactPrefix[2].toUpperCase();

  return listPhaseArtifacts(dir)
    .filter((artifact) => artifact.phaseToken === targetPhase && artifact.kind === targetKind)
    .map((artifact) => artifact.displayPath);
}

function listPhaseArtifacts(dir) {
  if (!existsSync(dir)) return [];

  const artifacts = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const artifact = classifyPhaseArtifact('', entry.name);
      if (artifact) artifacts.push(artifact);
      continue;
    }

    if (!entry.isDirectory()) continue;

    const entryPath = join(dir, entry.name);
    for (const child of readdirSync(entryPath, { withFileTypes: true })) {
      if (!child.isFile()) continue;
      const artifact = classifyPhaseArtifact(entry.name, child.name);
      if (artifact) artifacts.push(artifact);
    }
  }

  return artifacts;
}

function classifyPhaseArtifact(dir, name) {
  const dirMatch = dir ? dir.match(/^(\d+(?:\.\d+)*[a-z]?)-/i) : null;
  const nameMatch = name.match(/^(\d+(?:\.\d+)*[a-z]?)/i);
  const phaseToken = normalizePhaseToken((dirMatch || nameMatch)?.[1] || '');

  let kind = 'OTHER';
  if (name.includes('PLAN')) kind = 'PLAN';
  else if (name.includes('SUMMARY')) kind = 'SUMMARY';

  return {
    dir,
    name,
    displayPath: dir ? `${dir}/${name}` : name,
    phaseToken,
    kind,
  };
}

function padPhase(n) {
  return String(n).padStart(2, '0');
}

function parsePhaseStatuses(roadmap) {
  const phases = [];
  const lines = roadmap.split('\n');
  for (const line of lines) {
    const match = line.match(PHASE_LINE_RE);
    if (match) {
      const rawStatus = match[1].toLowerCase();
      let status = 'not_started';
      if (rawStatus === '[x]' || rawStatus === 'âœ…' || rawStatus === '✅') status = 'done';
      else if (rawStatus === '[-]') status = 'in_progress';
      else if (rawStatus === 'ðÿ"„' || rawStatus === '🔄') status = 'in_progress';
      phases.push({
        number: match[2],
        name: match[3].replace(/\*\*/g, '').split('-')[0].trim(),
        status,
      });
    }
  }
  return phases;
}

function normalizePhaseToken(value) {
  const raw = String(value).trim().toLowerCase();
  const match = raw.match(/^(\d+(?:\.\d+)*)([a-z]?)$/i);
  if (!match) return raw;

  const numericSegments = match[1]
    .split('.')
    .map((segment) => String(parseInt(segment, 10)));
  return `${numericSegments.join('.')}${match[2] || ''}`;
}

function extractPlanFileArtifacts(planContent, workspaceRoot) {
  const artifacts = [];
  const seen = new Set();

  for (const line of planContent.split('\n')) {
    const match = line.match(/^\s*-\s*(CREATE|MODIFY|DELETE|READ|TOUCH):\s*(.+?)\s*$/i);
    if (!match) continue;

    const operation = match[1].toLowerCase();
    const file = match[2].replace(/^`|`$/g, '').trim();
    if (!file || seen.has(`${operation}:${file}`)) continue;
    seen.add(`${operation}:${file}`);
    artifacts.push({
      operation,
      file,
      exists: existsSync(join(workspaceRoot, file)),
    });
  }

  return artifacts;
}

export function updateRoadmapPhaseStatus(roadmap, phaseNumber, status) {
  const marker = PHASE_STATUS_MARKERS[status];
  if (!marker) {
    throw new Error(`Unsupported phase status: ${status}`);
  }

  const normalizedTarget = normalizePhaseToken(phaseNumber);
  const lines = roadmap.split('\n');
  const overviewIndexes = [];
  const detailSections = [];
  let inArchivedDetails = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (DETAILS_OPEN_RE.test(lines[index]) && !DETAILS_CLOSE_RE.test(lines[index])) {
      inArchivedDetails = true;
      continue;
    }
    if (DETAILS_CLOSE_RE.test(lines[index])) {
      inArchivedDetails = false;
      continue;
    }
    if (inArchivedDetails) continue;

    const overviewMatch = lines[index].match(ROADMAP_PHASE_STATUS_RE);
    if (overviewMatch && normalizePhaseToken(overviewMatch[4]) === normalizedTarget) {
      overviewIndexes.push({ index, match: overviewMatch });
      continue;
    }

    const headingMatch = lines[index].match(PHASE_DETAIL_HEADING_RE);
    if (headingMatch && normalizePhaseToken(headingMatch[1]) === normalizedTarget) {
      let statusIndex = -1;
      let statusMatch = null;
      for (let detailIndex = index + 1; detailIndex < lines.length; detailIndex += 1) {
        if (/^#+\s+/.test(lines[detailIndex])) break;
        const candidate = lines[detailIndex].match(PHASE_DETAIL_STATUS_RE);
        if (candidate) {
          statusIndex = detailIndex;
          statusMatch = candidate;
          break;
        }
      }
      detailSections.push({ headingIndex: index, statusIndex, statusMatch });
    }
  }

  if (overviewIndexes.length === 0) {
    throw new Error(`Phase ${phaseNumber} was not found in ROADMAP.md`);
  }

  if (overviewIndexes.length > 1) {
    throw new Error(`Phase ${phaseNumber} matched multiple ROADMAP.md entries`);
  }

  if (detailSections.length > 1) {
    throw new Error(`Phase ${phaseNumber} matched multiple Phase Details sections in ROADMAP.md`);
  }

  if (detailSections.length === 1 && detailSections[0].statusIndex === -1) {
    throw new Error(`Phase ${phaseNumber} has a Phase Details section but no **Status** line in ROADMAP.md`);
  }

  const updatedLines = [...lines];
  const overview = overviewIndexes[0];
  updatedLines[overview.index] = `${overview.match[1]}${marker}${overview.match[3]}`;

  if (detailSections.length === 1) {
    const detail = detailSections[0];
    updatedLines[detail.statusIndex] = `${detail.statusMatch[1]}${marker}${detail.statusMatch[3]}`;
  }

  return updatedLines.join('\n');
}

export function cmdPhaseStatus(...args) {
  const { args: normalizedArgs, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const roadmapPath = join(planningDir, 'ROADMAP.md');
  const [phaseNumber, status] = normalizedArgs;

  if (!phaseNumber || !status) {
    console.error('Usage: gsdd phase-status <phase-number> <not_started|todo|in_progress|done>');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(roadmapPath)) {
    console.error('No ROADMAP.md found. Run the new-project workflow first.');
    process.exitCode = 1;
    return;
  }

  try {
    const roadmap = readFileSync(roadmapPath, 'utf-8');
    const updated = updateRoadmapPhaseStatus(roadmap, phaseNumber, status);
    const changed = updated !== roadmap;
    if (changed) {
      writeFileSync(roadmapPath, updated);
      try { writeFingerprint(planningDir); } catch { /* best-effort */ }
    }
    output({ phase: phaseNumber, status, roadmap: '.planning/ROADMAP.md', changed });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export function cmdFindPhase(...args) {
  const { args: normalizedArgs, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    output({ error });
    process.exitCode = 1;
    return;
  }
  const phaseNum = normalizedArgs[0];

  if (!existsSync(planningDir)) {
    output({ error: 'No .planning/ directory found. Run `npx -y gsdd-cli init` then the new-project workflow first.' });
    return;
  }

  const roadmapPath = join(planningDir, 'ROADMAP.md');
  if (!existsSync(roadmapPath)) {
    output({ error: 'No ROADMAP.md found. Run the new-project workflow first.' });
    return;
  }

  const phasesDir = join(planningDir, 'phases');
  const researchDir = join(planningDir, 'research');

  if (phaseNum) {
    const plans = findFiles(phasesDir, `${padPhase(phaseNum)}-PLAN`);
    const summaries = findFiles(phasesDir, `${padPhase(phaseNum)}-SUMMARY`);

    output({
      phase: normalizePhaseToken(phaseNum),
      directory: phasesDir,
      plans,
      summaries,
      hasResearch: existsSync(researchDir) && readdirSync(researchDir).length > 0,
      incomplete: plans.filter((p) => !summaries.some((s) => s.replace('SUMMARY', '') === p.replace('PLAN', ''))),
    });
    return;
  }

  const allArtifacts = listPhaseArtifacts(phasesDir);
  const plans = allArtifacts.filter((artifact) => artifact.kind === 'PLAN');
  const summaries = allArtifacts.filter((artifact) => artifact.kind === 'SUMMARY');

  const roadmap = readFileSync(roadmapPath, 'utf-8');
  const phases = parsePhaseStatuses(roadmap);

  output({
    phases,
    planCount: plans.length,
    summaryCount: summaries.length,
    currentPhase: phases.find((p) => p.status === 'in_progress') || phases.find((p) => p.status === 'not_started') || null,
    hasResearch: existsSync(researchDir) && readdirSync(researchDir).length > 0,
  });
}

export function cmdVerify(...args) {
  const { args: normalizedArgs, workspaceRoot, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const phaseNum = normalizedArgs[0];
  if (!phaseNum) {
    console.error('Usage: gsdd verify <phase-number>');
    process.exitCode = 1; return;
  }

  if (!existsSync(planningDir)) {
    console.error('No .planning/ directory found.');
    process.exitCode = 1; return;
  }
  const phasesDir = join(planningDir, 'phases');
  const matchingPlans = findFiles(phasesDir, `${padPhase(phaseNum)}-PLAN`);
  const matchingSummaries = findFiles(phasesDir, `${padPhase(phaseNum)}-SUMMARY`);
  const artifacts = matchingPlans.flatMap((planPath) => {
    const fullPath = join(phasesDir, planPath);
    return existsSync(fullPath)
      ? extractPlanFileArtifacts(readFileSync(fullPath, 'utf-8'), workspaceRoot)
      : [];
  });

  const result = {
    phase: normalizePhaseToken(phaseNum),
    exists: matchingPlans.length > 0,
    plans: matchingPlans,
    summaries: matchingSummaries,
    artifacts,
    allExist: artifacts.every((artifact) => artifact.exists),
    verified: matchingPlans.length > 0 && matchingSummaries.length > 0,
  };
  output(result);
}

export function cmdScaffold(...args) {
  const { args: normalizedArgs, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  const kind = normalizedArgs[0];
  const phaseNum = normalizedArgs[1];
  const phaseName = normalizedArgs[2] || 'phase';
  if (kind !== 'phase' || !phaseNum) {
    console.error('Usage: gsdd scaffold phase <phase-number> [phase-name]');
    process.exitCode = 1; return;
  }
  mkdirSync(planningDir, { recursive: true });
  const phasesDir = join(planningDir, 'phases');
  mkdirSync(phasesDir, { recursive: true });
  const dirName = `${padPhase(phaseNum)}-${phaseName.replace(/\s+/g, '-').toLowerCase()}`;
  const phaseDir = join(phasesDir, dirName);
  mkdirSync(phaseDir, { recursive: true });
  const planPath = join(phaseDir, `${padPhase(phaseNum)}-PLAN.md`);
  if (!existsSync(planPath)) {
    writeFileSync(planPath, `# Phase ${phaseNum} Plan\n\n## Goal\n- \n\n## Tasks\n- [ ] \n`);
  }
  output({ created: !existsSync(planPath), path: planPath.replace(/\\/g, '/'), phase: normalizePhaseToken(phaseNum) });
}
