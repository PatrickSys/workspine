// phase.mjs — Phase discovery, verification, and scaffolding
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join, relative } from 'path';
import { output } from './cli-utils.mjs';
import { writeFingerprint } from './session-fingerprint.mjs';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import {
  compareUiProofSlots,
  findUiProofBundleFiles,
  parseUiProofSlotsContent,
  readUiProofBundleFile,
} from './ui-proof.mjs';

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
  const baseIdMatch = name.match(/^(\d+(?:\.\d+)*[a-z]?(?:-\d+)?)/i);
  const dirMatch = dir ? dir.match(/^(\d+(?:\.\d+)*[a-z]?)-/i) : null;
  const nameMatch = name.match(/^(\d+(?:\.\d+)*[a-z]?)/i);
  const phaseToken = normalizePhaseToken((dirMatch || nameMatch)?.[1] || '');

  let kind = 'OTHER';
  if (baseIdMatch && isNamedPhaseArtifact(name, baseIdMatch[1], 'PLAN')) kind = 'PLAN';
  else if (baseIdMatch && isNamedPhaseArtifact(name, baseIdMatch[1], 'SUMMARY')) kind = 'SUMMARY';

  return {
    dir,
    name,
    displayPath: dir ? `${dir}/${name}` : name,
    phaseToken,
    kind,
  };
}

function isNamedPhaseArtifact(name, baseId, kind) {
  return name.toLowerCase() === `${baseId.toLowerCase()}-${kind.toLowerCase()}.md`;
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
    const moveMatch = line.match(/^\s*-\s*(RENAME|MOVE):\s*(.+?)\s*->\s*(.+?)\s*$/i);
    if (moveMatch) {
      const operation = moveMatch[1].toLowerCase();
      const from = moveMatch[2].replace(/^`|`$/g, '').trim();
      const to = moveMatch[3].replace(/^`|`$/g, '').trim();
      if (!from || !to || seen.has(`${operation}:${from}->${to}`)) continue;
      seen.add(`${operation}:${from}->${to}`);
      artifacts.push({
        operation,
        from,
        to,
        file: to,
        exists: existsSync(join(workspaceRoot, to)),
      });
      continue;
    }

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

function isPlanArtifactSatisfied(artifact) {
  if (artifact.operation === 'delete') return !artifact.exists;
  return artifact.exists;
}

function planArtifactFixHint(artifact) {
  if (artifact.operation === 'delete') {
    return `Complete the planned DELETE for ${artifact.file}, or revise the plan if the file should remain.`;
  }
  return `Create or update ${artifact.file} so the planned ${artifact.operation.toUpperCase()} artifact exists, or revise the plan if it is no longer in scope.`;
}

function evaluatePlanArtifacts(artifacts) {
  const unsatisfied = artifacts
    .filter((artifact) => !isPlanArtifactSatisfied(artifact))
    .map((artifact) => ({
      ...artifact,
      severity: 'blocker',
      expected: artifact.operation === 'delete' ? 'absent' : 'present',
      fix_hint: planArtifactFixHint(artifact),
    }));
  return {
    satisfied: unsatisfied.length === 0,
    unsatisfied,
  };
}

function normalizeUiProofIssue(issue) {
  return {
    ...issue,
    severity: issue.severity || 'blocker',
    fix_hint: issue.fix_hint || issue.fix || 'Fix the UI proof issue before claiming verification is complete.',
  };
}

function stripInlineComment(value) {
  return String(value || '').replace(/\s+#.*$/, '').trim();
}

function stripOuterScalarQuotes(value) {
  return String(value)
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/g, '$2')
    .trim();
}

function normalizeNullableFrontmatterValue(value) {
  const stripped = stripOuterScalarQuotes(value);
  if (!stripped) return '';
  if (stripped === '~') return '';
  if (/^null$/i.test(stripped)) return '';
  return stripped;
}

function extractUiProofSlotIds(value) {
  const ids = [];
  const slotPattern = /['"]?slot_id['"]?\s*:\s*['"]?([^,'"\]\s}]+)['"]?/g;
  for (const match of String(value || '').matchAll(slotPattern)) {
    ids.push(match[1].replace(/^['"]|['"]$/g, ''));
  }
  return ids;
}

function readPlanFrontmatter(planContent) {
  const content = String(planContent || '');
  if (!content.startsWith('---')) return '';
  const lines = content.split(/\r?\n/);
  const frontmatter = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return frontmatter.join('\n');
    frontmatter.push(lines[index]);
  }
  return '';
}

function frontmatterKeyBlock(frontmatter, key) {
  const lines = String(frontmatter || '').split(/\r?\n/);
  const keyPattern = new RegExp(`^${key}:[ \\t]*(.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(keyPattern);
    if (!match) continue;
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (/^\S[^:\n]*:\s*/.test(line)) break;
      block.push(line);
    }
    return { inline: stripInlineComment(match[1]), block };
  }
  return null;
}

function frontmatterScalar(frontmatter, key) {
  const entry = frontmatterKeyBlock(frontmatter, key);
  if (!entry) return null;
  if (entry.inline && !['|', '>'].includes(entry.inline)) return entry.inline;
  return entry.block
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function readPlanUiProofContract(planContent) {
  const frontmatter = readPlanFrontmatter(planContent);
  const slotsEntry = frontmatterKeyBlock(frontmatter, 'ui_proof_slots');
  const rationale = normalizeNullableFrontmatterValue(frontmatterScalar(frontmatter, 'no_ui_proof_rationale') || '');
  const result = {
    hasUiProofKey: Boolean(slotsEntry),
    declaresSlots: false,
    explicitEmptySlots: false,
    noUiProofRationale: rationale,
    hasNoUiProofRationale: Boolean(rationale.trim()),
    slotIds: [],
  };

  if (!slotsEntry) return result;

  if (slotsEntry.inline) {
    if (['[]', 'null', '~'].includes(slotsEntry.inline)) {
      result.explicitEmptySlots = true;
      return result;
    }
    result.declaresSlots = true;
    result.slotIds.push(...extractUiProofSlotIds(slotsEntry.inline));
    return result;
  }

  let sawMeaningfulLine = false;
  for (const line of slotsEntry.block) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    sawMeaningfulLine = true;
    if (/^\s+-\s+/.test(line)) result.declaresSlots = true;
    result.slotIds.push(...extractUiProofSlotIds(trimmed));
  }

  result.explicitEmptySlots = !result.declaresSlots && !sawMeaningfulLine;
  return result;
}

function findUiProofSlotPlansAndFiles(planningDir, planDisplayPaths) {
  const candidates = new Set();
  const declaredPlans = [];
  const declaredSlotIds = [];
  const noUiPlans = [];
  const contractErrors = [];
  const names = new Set([
    'ui-proof-slots.json',
    'ui-proof-slots.md',
    'UI-PROOF-SLOTS.json',
    'UI-PROOF-SLOTS.md',
    'planned-ui-proof.json',
    'planned-ui-proof.md',
  ]);

  for (const planDisplayPath of planDisplayPaths) {
    const fullPlanPath = join(planningDir, 'phases', planDisplayPath);
    if (!existsSync(fullPlanPath)) continue;
    const planContent = readFileSync(fullPlanPath, 'utf-8');
    const relPlanPath = relative(planningDir, fullPlanPath).replace(/\\/g, '/');
    const contract = readPlanUiProofContract(planContent);
    const planDir = dirname(fullPlanPath);
    const sidecars = [];
    if (existsSync(planDir)) {
      for (const entry of readdirSync(planDir, { withFileTypes: true })) {
        if (entry.isFile() && names.has(entry.name)) {
          sidecars.push(join(planDir, entry.name));
        }
      }
    }

    if (contract.hasUiProofKey && !contract.declaresSlots && !contract.hasNoUiProofRationale) {
      contractErrors.push(normalizeUiProofIssue({
        code: 'missing_no_ui_proof_rationale',
        path: `${relPlanPath}.no_ui_proof_rationale`,
        message: 'Plan declares empty ui_proof_slots but does not provide a no_ui_proof_rationale.',
        fix: 'Add a nonblank no_ui_proof_rationale for non-UI work, or declare required UI proof slots and add a planned slots artifact.',
      }));
    }

    if (contract.hasNoUiProofRationale && !contract.declaresSlots) {
      noUiPlans.push({ plan: relPlanPath, sidecars });
      continue;
    }

    if (!contract.declaresSlots) continue;

    declaredPlans.push(relPlanPath);
    for (const slotId of contract.slotIds) {
      declaredSlotIds.push({ plan: relPlanPath, slot_id: slotId });
    }
    for (const entry of readdirSync(planDir, { withFileTypes: true })) {
      if (entry.isFile() && names.has(entry.name)) {
        candidates.add(join(planDir, entry.name));
      }
    }
  }
  return { declaredPlans, declaredSlotIds, noUiPlans, contractErrors, files: [...candidates].sort() };
}

function comparePhaseUiProof({ planningDir, workspaceRoot, planDisplayPaths }) {
  const plannedDiscovery = findUiProofSlotPlansAndFiles(planningDir, planDisplayPaths);
  const plannedFiles = plannedDiscovery.files;
  const phaseDirs = new Set(planDisplayPaths.map((planDisplayPath) => dirname(join(planningDir, 'phases', planDisplayPath))));
  const observedFiles = findUiProofBundleFiles(planningDir)
    .filter((filePath) => phaseDirs.has(dirname(filePath)));

  const plannedSlots = [];
  const errors = [];
  const warnings = [];
  const planned = [];
  const observed = [];

  errors.push(...plannedDiscovery.contractErrors);
  for (const noUiPlan of plannedDiscovery.noUiPlans) {
    for (const filePath of noUiPlan.sidecars) {
      warnings.push({
        code: 'stale_ui_proof_sidecar_ignored',
        severity: 'warn',
        path: relative(workspaceRoot, filePath).replace(/\\/g, '/'),
        message: `Plan ${noUiPlan.plan} records no_ui_proof_rationale, so the UI proof sidecar is ignored for closure.`,
        fix_hint: 'Remove or classify the stale sidecar if it no longer belongs to this non-UI phase.',
      });
    }
  }

  for (const filePath of plannedFiles) {
    const rel = relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const parsed = parseUiProofSlotsContent(readFileSync(filePath, 'utf-8'), rel);
    planned.push(rel);
    plannedSlots.push(...parsed.slots);
    errors.push(...parsed.errors.map(normalizeUiProofIssue));
  }

  if (plannedSlots.length > 0 && plannedDiscovery.declaredSlotIds.length > 0) {
    const plannedSlotIds = new Set(plannedSlots.map((slot) => String(slot?.slot_id || '')));
    for (const declaredSlot of plannedDiscovery.declaredSlotIds) {
      if (plannedSlotIds.has(String(declaredSlot.slot_id))) continue;
      errors.push(normalizeUiProofIssue({
        code: 'planned_ui_proof_slots_drift',
        path: `${declaredSlot.plan}.ui_proof_slots`,
        message: `Plan declares UI proof slot ${declaredSlot.slot_id}, but no matching slot exists in the planned UI proof artifact.`,
        fix: 'Update ui-proof-slots.json or ui-proof-slots.md beside the plan so it matches the plan-declared slot IDs, or update the plan declaration.',
      }));
    }
  }

  const observedBundles = [];
  for (const filePath of observedFiles) {
    const rel = relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const parsed = readUiProofBundleFile(filePath);
    observed.push(rel);
    if (parsed.errors.length > 0) {
      errors.push(...parsed.errors.map((error) => normalizeUiProofIssue({ ...error, path: error.path || rel })));
      continue;
    }
    observedBundles.push({
      source: rel,
      bundle: parsed.bundle,
      options: {
        requireLocalArtifactExists: true,
        workspaceRoot,
        bundleDir: dirname(filePath),
      },
    });
  }

  if (plannedFiles.length === 0 && plannedDiscovery.declaredPlans.length > 0) {
    const missingError = {
      code: 'missing_planned_ui_proof_slots_file',
      severity: 'blocker',
      path: plannedDiscovery.declaredPlans[0],
      message: 'Plan declares ui_proof_slots but no ui-proof-slots artifact was found beside the plan.',
      fix_hint: 'Create ui-proof-slots.json or ui-proof-slots.md beside the plan, or set ui_proof_slots: [] with a no_ui_proof_rationale if the phase is not UI-sensitive.',
    };
    return {
      planned,
      observed,
      status: 'missing',
      comparison: { status: 'missing', slots: [], errors: [missingError] },
      errors: [missingError],
      warnings,
    };
  }

  if (plannedFiles.length === 0) {
    return {
      planned,
      observed,
      status: errors.length > 0 ? 'partial' : 'not_applicable',
      comparison: null,
      errors,
      warnings,
    };
  }

  const comparison = errors.length > 0
    ? { status: 'partial', slots: [], errors: errors.map(normalizeUiProofIssue) }
    : compareUiProofSlots(plannedSlots, observedBundles);

  return {
    planned,
    observed,
    status: comparison.status,
    comparison,
    errors: comparison.errors || errors,
    warnings,
  };
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

export function buildPhaseVerificationReport(...args) {
  const { args: normalizedArgs, workspaceRoot, planningDir, invalid, error } = resolveWorkspaceContext(args);
  if (invalid) {
    return { ok: false, error, exitCode: 1 };
  }
  const phaseNum = normalizedArgs[0];
  if (!phaseNum) {
    return { ok: false, error: 'Usage: gsdd verify <phase-number>', exitCode: 1 };
  }

  if (!existsSync(planningDir)) {
    return { ok: false, error: 'No .planning/ directory found.', exitCode: 1 };
  }
  const phasesDir = join(planningDir, 'phases');
  const matchingPlans = findFiles(phasesDir, `${padPhase(phaseNum)}-PLAN`);
  const matchingSummaries = findFiles(phasesDir, `${padPhase(phaseNum)}-SUMMARY`);
  const prerequisiteBlockers = [];
  if (matchingPlans.length === 0) {
    prerequisiteBlockers.push({
      code: 'missing_phase_plan',
      severity: 'blocker',
      path: `.planning/phases/${padPhase(phaseNum)}-*/${padPhase(phaseNum)}-PLAN.md`,
      message: `No PLAN.md artifact was found for phase ${normalizePhaseToken(phaseNum)}.`,
      fix_hint: `Run /gsdd-plan ${normalizePhaseToken(phaseNum)} before verifying this phase.`,
    });
  }
  if (matchingPlans.length > 0 && matchingSummaries.length === 0) {
    prerequisiteBlockers.push({
      code: 'missing_phase_summary',
      severity: 'blocker',
      path: `.planning/phases/${padPhase(phaseNum)}-*/${padPhase(phaseNum)}-SUMMARY.md`,
      message: `No SUMMARY.md artifact was found for phase ${normalizePhaseToken(phaseNum)}.`,
      fix_hint: `Run /gsdd-execute ${normalizePhaseToken(phaseNum)} before verifying this phase.`,
    });
  }
  const artifacts = matchingPlans.flatMap((planPath) => {
    const fullPath = join(phasesDir, planPath);
    return existsSync(fullPath)
      ? extractPlanFileArtifacts(readFileSync(fullPath, 'utf-8'), workspaceRoot)
      : [];
  });
  const artifactStatus = evaluatePlanArtifacts(artifacts);
  const uiProof = comparePhaseUiProof({
    planningDir,
    workspaceRoot,
    planDisplayPaths: matchingPlans,
  });
  const uiProofSatisfied = ['satisfied', 'not_applicable'].includes(uiProof.status);
  const legacyVerified = matchingPlans.length > 0 && matchingSummaries.length > 0;
  const uiProofGate = {
    status: uiProof.status,
    required: uiProof.status !== 'not_applicable',
    satisfied: uiProofSatisfied,
    blocks_verification: uiProof.status !== 'not_applicable' && !uiProofSatisfied,
    required_block: uiProof.status !== 'not_applicable' && !uiProofSatisfied ? 'ui-proof-failed' : null,
  };
  const blockedOn = [
    ...(prerequisiteBlockers.length > 0 ? ['prerequisites'] : []),
    ...(artifactStatus.satisfied ? [] : ['artifacts']),
    ...(uiProofGate.blocks_verification ? ['ui_proof'] : []),
  ];
  const closureVerified = legacyVerified && prerequisiteBlockers.length === 0 && artifactStatus.satisfied && uiProofSatisfied;

  const result = {
    phase: normalizePhaseToken(phaseNum),
    exists: matchingPlans.length > 0,
    plans: matchingPlans,
    summaries: matchingSummaries,
    artifacts,
    allExist: artifacts.every((artifact) => artifact.exists),
    artifact_status: artifactStatus,
    uiProof,
    verified: closureVerified,
    legacy_verified: legacyVerified,
    phase_artifacts_present: legacyVerified,
    prerequisite_status: {
      satisfied: prerequisiteBlockers.length === 0,
      blockers: prerequisiteBlockers,
    },
    ui_proof: uiProofGate,
    blocked_on: blockedOn,
    blocks_verification: blockedOn.length > 0,
  };
  return { ok: true, result, exitCode: closureVerified ? 0 : 1 };
}

export function cmdVerify(...args) {
  const report = buildPhaseVerificationReport(...args);
  if (!report.ok) {
    console.error(report.error);
    process.exitCode = report.exitCode;
    return;
  }
  output(report.result);
  if (report.exitCode !== 0) process.exitCode = report.exitCode;
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
  const created = !existsSync(planPath);
  if (created) {
    writeFileSync(planPath, `# Phase ${phaseNum} Plan\n\n## Goal\n- \n\n## Tasks\n- [ ] \n`);
  }
  output({ created, path: planPath.replace(/\\/g, '/'), phase: normalizePhaseToken(phaseNum) });
}
