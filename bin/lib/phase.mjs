// phase.mjs — Phase discovery, verification, and scaffolding
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { output } from './cli-utils.mjs';

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

function findFiles(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(prefix) || f.startsWith(prefix.replace(/^0+/, '')));
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

export function updateRoadmapPhaseStatus(roadmap, phaseNumber, status) {
  const marker = PHASE_STATUS_MARKERS[status];
  if (!marker) {
    throw new Error(`Unsupported phase status: ${status}`);
  }

  const normalizedTarget = normalizePhaseToken(phaseNumber);
  let matchCount = 0;

  const updated = roadmap
    .split('\n')
    .map((line) => {
      const match = line.match(ROADMAP_PHASE_STATUS_RE);
      if (!match) return line;
      if (normalizePhaseToken(match[4]) !== normalizedTarget) return line;
      matchCount += 1;
      return `${match[1]}${marker}${match[3]}`;
    })
    .join('\n');

  if (matchCount === 0) {
    throw new Error(`Phase ${phaseNumber} was not found in ROADMAP.md`);
  }

  if (matchCount > 1) {
    throw new Error(`Phase ${phaseNumber} matched multiple ROADMAP.md entries`);
  }

  return updated;
}

export function cmdPhaseStatus(...args) {
  const cwd = process.cwd();
  const planningDir = join(cwd, '.planning');
  const roadmapPath = join(planningDir, 'ROADMAP.md');
  const [phaseNumber, status] = args;

  if (!phaseNumber || !status) {
    console.error('Usage: gsdd phase-status <phase-number> <not_started|todo|in_progress|done>');
    process.exit(1);
  }

  if (!existsSync(roadmapPath)) {
    console.error('No ROADMAP.md found. Run the new-project workflow first.');
    process.exit(1);
  }

  try {
    const roadmap = readFileSync(roadmapPath, 'utf-8');
    const updated = updateRoadmapPhaseStatus(roadmap, phaseNumber, status);
    const changed = updated !== roadmap;
    if (changed) {
      writeFileSync(roadmapPath, updated);
    }
    output({ phase: phaseNumber, status, roadmap: '.planning/ROADMAP.md', changed });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

export function cmdFindPhase(...args) {
  const cwd = process.cwd();
  const planningDir = join(cwd, '.planning');
  const phaseNum = args[0];

  if (!existsSync(planningDir)) {
    output({ error: 'No .planning/ directory found. Run `gsdd init` then the new-project workflow first.' });
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

  const allFiles = existsSync(phasesDir) ? readdirSync(phasesDir) : [];
  const plans = allFiles.filter((f) => f.includes('PLAN'));
  const summaries = allFiles.filter((f) => f.includes('SUMMARY'));

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
  const cwd = process.cwd();
  const planningDir = join(cwd, '.planning');
  const phaseNum = args[0];
  if (!phaseNum) {
    console.error('Usage: gsdd verify <phase-number>');
    process.exit(1);
  }

  if (!existsSync(planningDir)) {
    console.error('No .planning/ directory found.');
    process.exit(1);
  }

  const planFile = findFiles(join(planningDir, 'phases'), `${padPhase(phaseNum)}-PLAN`)[0];
  if (!planFile) {
    console.error(`No plan found for phase ${phaseNum}`);
    process.exit(1);
  }

  const planPath = join(planningDir, 'phases', planFile);
  const plan = readFileSync(planPath, 'utf-8');

  const fileMatches = plan.matchAll(/<files>([\s\S]*?)<\/files>/g);
  const expectedFiles = [];
  for (const match of fileMatches) {
    const lines = match[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'));
    for (const line of lines) {
      const fileMatch = line.match(/(?:CREATE|MODIFY):\s*(.+)/);
      if (fileMatch) expectedFiles.push(fileMatch[1].trim());
    }
  }

  const results = expectedFiles.map((f) => {
    const fullPath = join(cwd, f);
    const exists = existsSync(fullPath);
    let substantive = false;
    if (exists) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const meaningfulLines = content.split('\n').filter(
          (l) => l.trim() && !/^\s*(\/\/|\/\*|\*|#)/.test(l)
        );
        substantive = meaningfulLines.length >= 3 && !content.includes('// TODO: implement');
      } catch {
        substantive = false;
      }
    }
    return { file: f, exists, substantive };
  });

  const antiPatterns = [];
  for (const r of results) {
    if (!r.exists) continue;
    try {
      const content = readFileSync(join(cwd, r.file), 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (/TODO|FIXME|HACK|XXX/.test(line)) {
          antiPatterns.push({ file: r.file, line: i + 1, pattern: 'TODO/FIXME', content: line.trim() });
        }
        if (/catch\s*\([^)]*\)\s*\{[\s]*\}/.test(line) || /catch\s*\([^)]*\)\s*\{\s*$/.test(line)) {
          antiPatterns.push({ file: r.file, line: i + 1, pattern: 'Empty catch', content: line.trim() });
        }
      });
    } catch {
      // skip unreadable files
    }
  }

  output({
    phase: parseInt(phaseNum, 10),
    artifacts: results,
    allExist: results.every((r) => r.exists),
    allSubstantive: results.filter((r) => r.exists).every((r) => r.substantive),
    antiPatterns,
    antiPatternCount: antiPatterns.length,
  });
}

export function cmdScaffold(...args) {
  const cwd = process.cwd();
  const planningDir = join(cwd, '.planning');
  const [type, ...rest] = args;

  if (type !== 'phase') {
    console.error('Usage: gsdd scaffold phase <number> [name]');
    process.exit(1);
  }

  const phaseNum = rest[0];
  const phaseName = rest.slice(1).join(' ');
  if (!phaseNum) {
    console.error('Usage: gsdd scaffold phase <number> [name]');
    process.exit(1);
  }

  const phasesDir = join(planningDir, 'phases');
  mkdirSync(phasesDir, { recursive: true });

  const planFile = join(phasesDir, `${padPhase(phaseNum)}-PLAN.md`);
  if (existsSync(planFile)) {
    console.log(`  - ${basename(planFile)} already exists`);
    return;
  }

  const content = `# Phase ${phaseNum}: ${phaseName || '[Name]'} - Plan

## Phase Goal
[From ROADMAP.md]

## Requirements Covered
[REQ-IDs from SPEC.md]

## Approach
[2-3 sentences]

## Must-Haves (from success criteria)
1. [Success criterion]

## Tasks

<!-- Add tasks using XML format:
<task id="${phaseNum}-01">
  <files>
    - CREATE: path/to/file
  </files>
  <action>Description of what to implement</action>
  <verify>How to verify it works</verify>
  <done>When is this task done</done>
</task>
-->

## Notes
`;

  writeFileSync(planFile, content);
  console.log(`  - created ${basename(planFile)}`);
}
