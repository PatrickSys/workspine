// phase.mjs — Phase discovery, verification, and scaffolding
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { output } from './cli-utils.mjs';

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
    // Supports:
    // - checkbox statuses: [ ] / [x]
    // - legacy emoji markers in ROADMAP templates: not started / in progress / done
    // - mojibake-encoded variants that exist in some files
    const match = line.match(
      /^[-*]\s*(\[[ x]\]|\[-\]|â¬œ|ðŸ"„|âœ…|⬜|🔄|✅)\s*\*\*Phase\s+(\d+):\s*(.+?)\*\*/i
    );
    if (match) {
      const rawStatus = match[1].toLowerCase();
      let status = 'not_started';
      if (rawStatus === '[x]' || rawStatus === 'âœ…' || rawStatus === '✅') status = 'done';
      else if (rawStatus === '[-]') status = 'in_progress';
      else if (rawStatus === 'ðÿ"„' || rawStatus === '🔄') status = 'in_progress';
      phases.push({
        number: parseInt(match[2], 10),
        name: match[3].replace(/\*\*/g, '').split('-')[0].trim(),
        status,
      });
    }
  }
  return phases;
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
      phase: parseInt(phaseNum, 10),
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
