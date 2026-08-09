// journey.mjs - Read-only delivery journey collection and ASCII rendering.

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { output, parseFlagValue } from './cli-utils.mjs';
import { evaluateLifecycleState, normalizePhaseToken } from './lifecycle-state.mjs';
import { parsePlanFrontmatter } from './phase.mjs';
import { resolveStateDir } from './state-dir.mjs';
import { readDecisionRecords, resolveActiveMilestoneDir } from './work-context.mjs';

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'closed', 'passed', 'shipped', 'verified']);
const RUNNING_STATUSES = new Set(['executing', 'in_progress']);
const BLOCKED_STATUSES = new Set(['blocked']);
const PENDING_STATUSES = new Set(['draft', 'not_started', 'pending', 'planned', 'todo']);

function readFileSafely(filePath) {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return status || 'unknown';
}

function statusFromMarkdown(content) {
  if (typeof content !== 'string') return 'unknown';
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^status:\s*(.*?)\s*$/im);
  if (!match) return 'unknown';
  const value = match[1].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  return normalizeStatus(value);
}

function gitRead(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function collectRecent(cwd) {
  const subjects = gitRead(cwd, ['log', '--since=48.hours', '--format=%s']);
  const generatedAt = gitRead(cwd, ['log', '-1', '--format=%cI']);
  if (subjects === null && generatedAt === null) return { recent: null, generatedAt: null };

  const recentSubjects = subjects ? subjects.split(/\r?\n/).filter(Boolean) : [];
  return {
    recent: {
      commits48h: recentSubjects.length,
      latest: recentSubjects[0] || null,
    },
    generatedAt: generatedAt || null,
  };
}

function listMilestoneDirs(stateDir, resolvedDir = resolveActiveMilestoneDir(stateDir)) {
  const dirs = [];
  const pluralDir = join(stateDir, 'milestones');
  if (existsSync(pluralDir)) {
    try {
      for (const name of readdirSync(pluralDir)) {
        const milestoneDir = join(pluralDir, name);
        if (existsSync(join(milestoneDir, 'MILESTONE.md'))) dirs.push(milestoneDir);
      }
    } catch {
      // A partially readable state directory is still a valid empty journey.
    }
  }

  if (existsSync(join(resolvedDir, 'MILESTONE.md')) && !dirs.includes(resolvedDir)) {
    dirs.push(resolvedDir);
  }

  return dirs.sort((left, right) => basename(left).localeCompare(basename(right)));
}

function readPhases(milestoneDir) {
  const phasesDir = join(milestoneDir, 'phases');
  if (!existsSync(phasesDir)) return [];

  let entries;
  try {
    entries = readdirSync(phasesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(phasesDir, entry.name, 'PLAN.md')))
    .map((entry) => {
      const planPath = join(phasesDir, entry.name, 'PLAN.md');
      const content = readFileSafely(planPath);
      let status = 'unknown';
      if (content !== null) {
        try {
          status = normalizeStatus(parsePlanFrontmatter(content).status);
        } catch {
          status = 'unknown';
        }
      }
      return { dir: entry.name, status };
    })
    .sort((left, right) => left.dir.localeCompare(right.dir));
}

function readMilestone(milestoneDir) {
  const content = readFileSafely(join(milestoneDir, 'MILESTONE.md'));
  return {
    name: basename(milestoneDir),
    status: statusFromMarkdown(content),
    phases: readPhases(milestoneDir),
    path: milestoneDir,
  };
}

function roadmapPhaseDir(phase) {
  const token = String(phase.number || '');
  const integerToken = token.match(/^(\d+)([a-z]?)$/i);
  const displayToken = integerToken
    ? `${integerToken[1].padStart(2, '0')}${integerToken[2] || ''}`
    : token;
  const slug = asciiText(phase.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${displayToken}-${slug}` : displayToken;
}

function phaseTokenFromDir(dir) {
  const match = String(dir || '').match(/^(\d+(?:\.\d+)*[a-z]?)(?:-|$)/i);
  return match ? normalizePhaseToken(match[1]) : null;
}

function currentRoadmapPhases(stateDir) {
  return evaluateLifecycleState({ planningDir: stateDir }).phases.map((phase) => ({
    dir: roadmapPhaseDir(phase),
    status: phase.status,
    token: normalizePhaseToken(phase.number),
  }));
}

function mergeCurrentPhases(historical, current) {
  if (current.length === 0) return historical;
  const currentTokens = new Set(current.map((phase) => phase.token));
  return [
    ...historical.filter((phase) => {
      const token = phaseTokenFromDir(phase.dir);
      return !token || !currentTokens.has(token);
    }),
    ...current.map(({ dir, status }) => ({ dir, status })),
  ].sort((left, right) => left.dir.localeCompare(right.dir, undefined, { numeric: true, sensitivity: 'base' }));
}

function phaseGlyph(status) {
  if (DONE_STATUSES.has(status)) return '[x]';
  if (RUNNING_STATUSES.has(status)) return '[>]';
  if (BLOCKED_STATUSES.has(status)) return '[!]';
  if (PENDING_STATUSES.has(status)) return '[ ]';
  return '[?]';
}

function isDone(status) {
  return DONE_STATUSES.has(normalizeStatus(status));
}

function progressBar(milestone) {
  const total = milestone.phases.length;
  if (total === 0) return '[__________]';
  const done = milestone.phases.filter((phase) => isDone(phase.status)).length;
  const filled = Math.round((done / total) * 10);
  return `[${'#'.repeat(filled)}${'_'.repeat(10 - filled)}]`;
}

function phaseLabel(dir) {
  const match = String(dir).match(/^([^ -]+)-(.*)$/);
  return match ? `${match[1]} ${match[2]}` : String(dir);
}

function asciiText(value) {
  return String(value || '').replace(/[^\x20-\x7E]/g, '?');
}

function quoteSubject(subject) {
  return asciiText(subject).replace(/[\r\n"]+/g, ' ').replace(/"/g, '\\"');
}

function decisionRecency(record) {
  const meta = record?.meta || {};
  const metadataTimes = [meta.updated_at, meta.created_at]
    .map((value) => Date.parse(String(value || '')))
    .filter(Number.isFinite);
  let fileTime = 0;
  if (record?.filePath) {
    try {
      fileTime = statSync(record.filePath).mtimeMs;
    } catch {
      // Metadata remains the canonical fallback when the record path cannot be statted.
    }
  }
  return {
    metadataTime: metadataTimes.length > 0 ? Math.max(...metadataTimes) : 0,
    fileTime,
    id: String(meta.id || ''),
  };
}

function latestDecision(records) {
  return records.reduce((latest, record) => {
    if (!latest) return record;
    const left = decisionRecency(latest);
    const right = decisionRecency(record);
    if (right.metadataTime !== left.metadataTime) return right.metadataTime > left.metadataTime ? record : latest;
    if (right.fileTime !== left.fileTime) return right.fileTime > left.fileTime ? record : latest;
    return right.id.localeCompare(left.id) > 0 ? record : latest;
  }, null);
}

function collectDecisions(stateDir) {
  const scanned = readDecisionRecords(stateDir);
  const records = Array.isArray(scanned.records) ? scanned.records : [];
  if (records.length === 0) return null;

  const counts = {
    active: 0,
    candidate: 0,
    invalidated: 0,
    superseded: 0,
  };
  for (const record of records) {
    const status = normalizeStatus(record?.meta?.status);
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
  }
  return {
    ...counts,
    latest: latestDecision(records)?.meta?.decision || null,
  };
}

function truncateDecision(value, maxLength = 60) {
  const text = asciiText(value).replace(/[\r\n]+/g, ' ');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function renderDecisions(decisions) {
  if (!decisions) return [];
  const parts = [];
  if (decisions.active > 0) parts.push(`${decisions.active} active`);
  if (decisions.candidate > 0) parts.push(`${decisions.candidate} candidate (awaiting promote)`);
  if (decisions.invalidated > 0) parts.push(`${decisions.invalidated} invalidated (mistakes recorded)`);
  if (decisions.superseded > 0) parts.push(`${decisions.superseded} superseded`);
  const lines = parts.length > 0 ? [`  decisions: ${parts.join(' . ')}`] : [];
  if (decisions.latest) lines.push(`  latest: "${quoteSubject(truncateDecision(decisions.latest))}"`);
  return lines;
}

export function collectJourney({ cwd = process.cwd() } = {}) {
  const { dir: stateDir } = resolveStateDir(cwd);
  const resolvedActiveDir = resolveActiveMilestoneDir(stateDir);
  const milestoneDirs = listMilestoneDirs(stateDir, resolvedActiveDir);
  const milestones = milestoneDirs.map(readMilestone);
  const activeIndex = resolvedActiveDir ? milestones.findIndex((milestone) => milestone.path === resolvedActiveDir) : -1;
  const roadmapPhases = currentRoadmapPhases(stateDir);
  const recentData = collectRecent(cwd);
  const decisions = collectDecisions(stateDir);

  const journey = {
    milestones: milestones.map((milestone, index) => {
      const active = index === activeIndex;
      return {
        name: milestone.name,
        status: milestone.status,
        phases: active ? mergeCurrentPhases(milestone.phases, roadmapPhases) : milestone.phases,
        active,
      };
    }),
    recent: recentData.recent || { commits48h: 0, latest: null },
    decisions,
  };
  if (recentData.generatedAt) journey.generatedAt = recentData.generatedAt;
  return journey;
}

export function renderJourney(journey, { now = new Date() } = {}) {
  if (!journey.milestones || journey.milestones.length === 0) {
    return 'No milestones found. Run `gsdd init` to start your workspace journey.';
  }

  const date = journey.generatedAt || now.toISOString();
  const lines = [
    ` WORKSPINE JOURNEY                                    ${date.slice(0, 10)}`,
    ' ==========================================================',
  ];
  for (const milestone of journey.milestones) {
    const here = milestone.active ? '   <- you are here' : '';
    const name = asciiText(milestone.name);
    const status = asciiText(milestone.status);
    lines.push(`  ${name.padEnd(16)} ${progressBar(milestone)}  ${status}${here}`.trimEnd());
    if (milestone.active) {
      for (const phase of milestone.phases) {
        lines.push(`    phase ${asciiText(phaseLabel(phase.dir)).padEnd(25)} ${phaseGlyph(normalizeStatus(phase.status))} ${asciiText(phase.status)}`);
      }
    }
  }
  lines.push(...renderDecisions(journey.decisions));
  lines.push(' ----------------------------------------------------------');
  const recent = journey.recent || { commits48h: 0, latest: null };
  const count = Number.isFinite(recent.commits48h) ? recent.commits48h : 0;
  const latest = recent.latest ? `   latest: "${quoteSubject(recent.latest)}"` : '';
  lines.push(`  last 48h: ${count} commit${count === 1 ? '' : 's'}${latest}`);
  return lines.join('\n');
}

export function createCmdJourney(context = {}) {
  return async (...args) => {
    const jsonFlag = parseFlagValue(args, '--json');
    const journey = collectJourney({ cwd: context.cwd || process.cwd() });
    if (jsonFlag.present) {
      output(journey);
      return;
    }
    console.log(renderJourney(journey));
  };
}
