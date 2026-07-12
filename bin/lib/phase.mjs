// phase.mjs — Phase discovery, verification, and scaffolding
//
// IMPORTANT: No module-scope process.cwd() — ESM caching means sub-modules
// evaluate once, so CWD must be computed inside function bodies.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { output } from './cli-utils.mjs';
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

function extractFrontmatter(content) {
  const match = String(content || '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function readTopLevelScalar(frontmatter, key) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(frontmatter || '').match(new RegExp(`^${escapedKey}:\\s*(.*)$`, 'm'));
  return match ? normalizeScalarValue(match[1]) : null;
}

function hasTopLevelKey(frontmatter, key) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedKey}:\\s*.*$`, 'm').test(String(frontmatter || ''));
}

function readTopLevelBlock(frontmatter, key) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = String(frontmatter || '').replace(/\r\n/g, '\n').split('\n');
  const startIndex = lines.findIndex((line) => new RegExp(`^${escapedKey}:\\s*(.*)$`).test(line));
  if (startIndex === -1) return null;

  const scalar = normalizeScalarValue(lines[startIndex].replace(new RegExp(`^${escapedKey}:\\s*`), ''));
  const nested = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^\S[^:]*:\s*/.test(line)) break;
    if (line.trim()) nested.push(line.trim());
  }
  return { scalar, nested };
}

function parseFrontmatterScalar(value) {
  const withoutComment = stripInlineComment(value).trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
    || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function readTopLevelListOfMaps(frontmatter, key) {
  const lines = String(frontmatter || '').replace(/\r\n/g, '\n').split('\n');
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startIndex = lines.findIndex((line) => new RegExp(`^${escapedKey}:\\s*(.*)$`).test(line));
  if (startIndex === -1) return null;
  const inline = lines[startIndex].match(new RegExp(`^${escapedKey}:\\s*(.*)$`))?.[1]?.trim();
  if (inline === '[]') return [];

  const entries = [];
  let current = null;
  for (const line of lines.slice(startIndex + 1)) {
    if (/^\S/.test(line)) break;
    const item = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
    if (item) {
      if (current) entries.push(current);
      current = { [item[1].trim()]: parseFrontmatterScalar(item[2]) };
      continue;
    }
    const field = line.match(/^\s{2,}([^:]+):\s*(.*)$/);
    if (field && current) current[field[1].trim()] = parseFrontmatterScalar(field[2]);
  }
  if (current) entries.push(current);
  return entries;
}

export function parsePlanFrontmatter(content) {
  const frontmatter = extractFrontmatter(content);
  return {
    raw: frontmatter,
    status: readTopLevelScalar(frontmatter, 'status'),
    decision_dispositions: readTopLevelListOfMaps(frontmatter, 'decision_dispositions'),
  };
}

function legacyUiProofSlotsState(frontmatter) {
  const block = readTopLevelBlock(frontmatter, 'ui_proof_slots');
  if (!block) return null;
  if (/^\[\s*\]$/.test(block.scalar)) return 'empty';
  if (isMeaningfulFieldValue(block.scalar)) return 'present';
  return block.nested.length > 0 ? 'present' : 'empty';
}

function stripInlineComment(value) {
  const text = String(value || '');
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (quote === '"' && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return text.slice(0, index);
  }
  return text;
}

function normalizeScalarValue(value) {
  let normalized = stripInlineComment(value).trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function extractMarkdownSection(content, heading) {
  return extractMarkdownSections(content, heading)[0] || '';
}

function extractMarkdownSections(content, heading) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  const escapedHeading = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingMatcher = new RegExp(`^##\\s+${escapedHeading}\\s*$`, 'gim');
  const matches = Array.from(normalized.matchAll(headingMatcher));
  return matches.map((headingMatch, index) => {
    const start = headingMatch.index + headingMatch[0].length;
    const nextStart = matches[index + 1]?.index;
    const rest = normalized.slice(start, nextStart);
    const nextHeadingIndex = rest.search(/^##\s+/m);
    return (nextHeadingIndex === -1 ? rest : rest.slice(0, nextHeadingIndex)).trim();
  }).filter(Boolean);
}

function sectionFieldValue(section, label) {
  const text = String(section || '');
  const escapedLabel = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*(?:[-*]\\s*)?${escapedLabel}:\\s*(.*)$`, 'im').exec(text);
  if (!match) return '';

  const inlineValue = normalizeScalarValue(match[1]);
  if (inlineValue) return inlineValue;

  const nestedValues = [];
  const followingLines = text.slice(match.index + match[0].length).split(/\r?\n/);
  for (const line of followingLines) {
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break;
    const nestedBullet = line.match(/^\s+[-*]\s*(.+)$/);
    if (nestedBullet) {
      nestedValues.push(nestedBullet[1].trim());
      continue;
    }
    const nestedText = line.match(/^\s{2,}(.+)$/);
    if (nestedText) {
      nestedValues.push(nestedText[1].trim());
      continue;
    }
    break;
  }
  return normalizeScalarValue(nestedValues.join(' '));
}

function isMeaningfulFieldValue(value) {
  const normalized = normalizeScalarValue(value);
  if (!normalized) return false;
  if (/^n\/?a$/i.test(normalized)) return false;
  if (/^(none|null|nil|~|tbd|todo|unknown)$/i.test(normalized)) return false;
  if (/^\[.*\]$/.test(normalized)) return false;
  if (/^<.*>$/.test(normalized)) return false;
  return true;
}

function nonEmptyField(section, label) {
  const value = sectionFieldValue(section, label);
  return isMeaningfulFieldValue(value);
}

function firstFieldValue(section, labels) {
  for (const label of labels) {
    const value = sectionFieldValue(section, label);
    if (isMeaningfulFieldValue(value)) return value;
  }
  return '';
}

function evidenceKindValues(section) {
  const value = firstFieldValue(section, ['Evidence kind', 'Evidence kinds']);
  return value
    .split(/[,/;|]|\band\b/i)
    .map((part) => normalizeScalarValue(part).toLowerCase())
    .filter(Boolean);
}

function hasSupportedBrowserProofEvidenceKind(section) {
  return evidenceKindValues(section).some((kind) => kind === 'runtime' || kind === 'test');
}

function hasPassingBrowserProofResult(section) {
  const value = firstFieldValue(section, ['Result']).toLowerCase();
  if (!isMeaningfulFieldValue(value)) return false;
  if (/\b(not\s+passed|fail(?:ed|ing)?|partial|partly|blocked|waived|deferred|missing|not[_ -]?applicable|unknown)\b/i.test(value)) {
    return false;
  }
  return /\b(pass(?:ed|ing)?|satisfied|success(?:ful)?)\b/i.test(value);
}

function isBoundedBrowserProofClaim(section) {
  const value = firstFieldValue(section, ['Claim limit']).toLowerCase();
  if (!isMeaningfulFieldValue(value)) return false;
  if (/\b(no limit|unlimited|entire app|whole app|full app|complete app|everything works|all works|all flows|all ui|all screens|works everywhere)\b/i.test(value)) {
    return false;
  }
  return true;
}

function hasPrivacySafetyNote(section) {
  if (firstFieldValue(section, ['Privacy/safety', 'Privacy note', 'Safety note', 'Safe to publish'])) return true;
  const artifacts = firstFieldValue(section, ['Artifacts']);
  return /\b(local[-_ ]?only|safe to publish|not safe to publish|publishable|private|unsafe|sanitized)\b/i.test(artifacts);
}

function browserProofFixHint(code) {
  if (code === 'retired_browser_proof_contract') {
    return 'Replace retired ui_proof_slots/no_ui_proof_rationale fields with browser_proof_required and browser_proof_rationale.';
  }
  if (code === 'legacy_browser_proof_contract') {
    return 'Update PLAN.md frontmatter to browser_proof_required: false and browser_proof_rationale when you next touch this phase.';
  }
  if (code === 'legacy_browser_proof_slots_require_migration') {
    return 'Migrate non-empty ui_proof_slots to browser_proof_required: true plus a Browser Proof Plan before verifying this phase.';
  }
  if (code === 'conflicting_browser_proof_contract') {
    return 'Use either the new browser_proof_* frontmatter or the legacy ui_proof_* frontmatter, not both.';
  }
  if (code === 'missing_browser_proof_declaration') {
    return 'Add browser_proof_required: true|false and browser_proof_rationale to PLAN.md frontmatter.';
  }
  if (code === 'invalid_browser_proof_required') {
    return 'Set browser_proof_required to true or false in PLAN.md frontmatter.';
  }
  if (code === 'missing_browser_proof_rationale') {
    return 'Add a nonblank browser_proof_rationale explaining why browser proof is or is not required.';
  }
  if (code === 'missing_browser_proof_plan') {
    return 'Add a ## Browser Proof Plan section or set browser_proof_required: false with a rationale if the work is not UI-sensitive.';
  }
  if (code === 'missing_browser_proof_observation') {
    return 'Record a ## Browser Proof Observation in SUMMARY.md or link to an observation record before verifying browser-sensitive work.';
  }
  if (code === 'incomplete_browser_proof_observation') {
    return 'Complete the Browser Proof Observation fields or narrow the proof claim.';
  }
  if (code === 'failed_browser_proof_observation') {
    return 'Record a passing browser-proof observation, or narrow the claim and leave verification blocked.';
  }
  if (code === 'unsupported_browser_proof_evidence_kind') {
    return 'Use Evidence kind: runtime or Evidence kind: test for browser proof, or narrow the claim.';
  }
  if (code === 'overbroad_browser_proof_claim') {
    return 'Narrow Claim limit to the exact route, state, viewport, and behavior actually observed.';
  }
  if (code === 'invalid_browser_proof_observation_link') {
    return 'Link browser-proof observation records as repo-local regular files inside this workspace.';
  }
  if (code === 'unmatched_browser_proof_observation') {
    return 'Add a Plan field to each Browser Proof Observation that names the exact required PLAN.md artifact.';
  }
  return 'Complete the Browser Proof Plan fields or narrow the proof claim.';
}

function evaluateBrowserProofContract(planContent, planPath) {
  const frontmatter = extractFrontmatter(planContent);
  let requiredRaw = readTopLevelScalar(frontmatter, 'browser_proof_required');
  let rationale = readTopLevelScalar(frontmatter, 'browser_proof_rationale');
  let declarationPresent = requiredRaw !== null || rationale !== null;
  const legacySlots = legacyUiProofSlotsState(frontmatter);
  const legacyRationale = readTopLevelScalar(frontmatter, 'no_ui_proof_rationale');
  const legacyNoUiCompatible = !declarationPresent
    && legacySlots === 'empty'
    && isMeaningfulFieldValue(legacyRationale);
  const retiredKeys = ['ui_proof_slots', 'no_ui_proof_rationale', 'proof_bundle_version', 'claim_limits']
    .filter((key) => hasTopLevelKey(frontmatter, key));
  const blockers = [];
  const warnings = [];

  if (declarationPresent && retiredKeys.length > 0) {
    blockers.push({
      code: 'conflicting_browser_proof_contract',
      severity: 'blocker',
      path: planPath,
      message: `PLAN.md mixes new browser-proof field(s) with retired field(s): ${retiredKeys.join(', ')}.`,
      fix_hint: browserProofFixHint('conflicting_browser_proof_contract'),
    });
    return {
      path: planPath,
      declaration_present: declarationPresent,
      required: null,
      rationale,
      legacy_compatible: false,
      satisfied: false,
      warnings,
      blockers,
    };
  }

  if (!declarationPresent && legacySlots === 'present') {
    blockers.push({
      code: 'legacy_browser_proof_slots_require_migration',
      severity: 'blocker',
      path: planPath,
      message: 'PLAN.md uses legacy non-empty ui_proof_slots; migrate them to browser_proof_required plus a Browser Proof Plan before verification.',
      fix_hint: browserProofFixHint('legacy_browser_proof_slots_require_migration'),
    });
    return {
      path: planPath,
      declaration_present: false,
      required: null,
      rationale: legacyRationale,
      legacy_compatible: false,
      satisfied: false,
      warnings,
      blockers,
    };
  }

  if (!declarationPresent && legacySlots === 'empty' && !isMeaningfulFieldValue(legacyRationale)) {
    blockers.push({
      code: 'missing_browser_proof_rationale',
      severity: 'blocker',
      path: planPath,
      message: 'Legacy ui_proof_slots: [] requires a meaningful no_ui_proof_rationale, or migration to browser_proof_required/browser_proof_rationale.',
      fix_hint: browserProofFixHint('missing_browser_proof_rationale'),
    });
    return {
      path: planPath,
      declaration_present: false,
      required: null,
      rationale: legacyRationale,
      legacy_compatible: false,
      satisfied: false,
      warnings,
      blockers,
    };
  }

  if (legacyNoUiCompatible) {
    requiredRaw = 'false';
    rationale = legacyRationale;
    declarationPresent = true;
    warnings.push({
      code: 'legacy_browser_proof_contract',
      severity: 'warning',
      path: planPath,
      message: 'PLAN.md uses legacy no-UI proof frontmatter; treating it as browser_proof_required: false for compatibility.',
      fix_hint: browserProofFixHint('legacy_browser_proof_contract'),
    });
  }

  const blockingRetiredKeys = legacyNoUiCompatible
    ? retiredKeys.filter((key) => key !== 'ui_proof_slots' && key !== 'no_ui_proof_rationale')
    : retiredKeys;

  if (blockingRetiredKeys.length > 0) {
    blockers.push({
      code: 'retired_browser_proof_contract',
      severity: 'blocker',
      path: planPath,
      message: `PLAN.md uses retired browser-proof field(s): ${blockingRetiredKeys.join(', ')}.`,
      fix_hint: browserProofFixHint('retired_browser_proof_contract'),
    });
  }

  if (!declarationPresent && retiredKeys.length === 0) {
    blockers.push({
      code: 'missing_browser_proof_declaration',
      severity: 'blocker',
      path: planPath,
      message: 'PLAN.md must declare browser_proof_required and browser_proof_rationale before verification.',
      fix_hint: browserProofFixHint('missing_browser_proof_declaration'),
    });
    return {
      path: planPath,
      declaration_present: false,
      required: null,
      rationale: null,
      legacy_compatible: false,
      satisfied: false,
      warnings,
      blockers,
    };
  }

  const normalizedRequired = String(requiredRaw || '').toLowerCase();
  const required = normalizedRequired === 'true'
    ? true
    : normalizedRequired === 'false'
      ? false
      : null;

  if (required === null) {
    blockers.push({
      code: 'invalid_browser_proof_required',
      severity: 'blocker',
      path: planPath,
      message: 'browser_proof_required must be true or false when the browser-proof contract is declared.',
      fix_hint: browserProofFixHint('invalid_browser_proof_required'),
    });
  }

  if (!isMeaningfulFieldValue(rationale)) {
    blockers.push({
      code: 'missing_browser_proof_rationale',
      severity: 'blocker',
      path: planPath,
      message: 'browser_proof_rationale is required when the browser-proof contract is declared.',
      fix_hint: browserProofFixHint('missing_browser_proof_rationale'),
    });
  }

  if (required === true) {
    const section = extractMarkdownSection(planContent, 'Browser Proof Plan');
    if (!section) {
      blockers.push({
        code: 'missing_browser_proof_plan',
        severity: 'blocker',
        path: planPath,
        message: 'browser_proof_required is true but PLAN.md has no ## Browser Proof Plan section.',
        fix_hint: browserProofFixHint('missing_browser_proof_plan'),
      });
    } else {
      const missingFields = ['Routes/states', 'Viewports', 'Runtime path', 'Observations', 'Artifacts', 'Claim limit']
        .filter((field) => !nonEmptyField(section, field));
      const hasEvidenceCommand = nonEmptyField(section, 'Evidence command');
      const hasNoCommandRationale = nonEmptyField(section, 'No-command rationale');
      if (!hasEvidenceCommand && !hasNoCommandRationale) {
        missingFields.push('Evidence command or No-command rationale');
      }
      if (!hasSupportedBrowserProofEvidenceKind(section)) {
        missingFields.push('Evidence kind');
      }
      if (!hasPrivacySafetyNote(section)) {
        missingFields.push('Privacy/safety');
      }
      if (!isBoundedBrowserProofClaim(section)) {
        missingFields.push('bounded Claim limit');
      }
      if (missingFields.length > 0) {
        blockers.push({
          code: 'incomplete_browser_proof_plan',
          severity: 'blocker',
          path: planPath,
          message: `Browser Proof Plan is missing required field(s): ${missingFields.join(', ')}.`,
          fix_hint: browserProofFixHint('incomplete_browser_proof_plan'),
        });
      }
    }
  }

  return {
    path: planPath,
    declaration_present: declarationPresent,
    required,
    rationale,
    legacy_compatible: legacyNoUiCompatible,
    satisfied: blockers.length === 0,
    warnings,
    blockers,
  };
}

function sanitizeLinkedObservationPath(value) {
  let text = normalizeScalarValue(value);
  const markdownLink = text.match(/^\[[^\]]+\]\(([^)]+)\)$/);
  if (markdownLink) text = markdownLink[1].trim();
  text = text.replace(/^`|`$/g, '').trim();
  return text;
}

function isInsidePath(parent, child) {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function readLinkedObservationRecords(summaryContent, summaryFullPath, workspaceRoot) {
  const records = [];
  const blockers = [];
  const matcher = /^\s*(?:[-*]\s*)?(?:Browser Proof Observation|Browser proof observation|Observation record|Browser proof record):\s*(.+)$/gim;
  let match;
  while ((match = matcher.exec(String(summaryContent || '')))) {
    const linkedPath = sanitizeLinkedObservationPath(match[1]);
    if (!linkedPath) continue;
    if (/^[a-z]+:\/\//i.test(linkedPath)) {
      blockers.push({
        code: 'invalid_browser_proof_observation_link',
        severity: 'blocker',
        path: linkedPath,
        message: 'Browser Proof Observation link must be a repo-local relative file path, not a URL.',
        fix_hint: browserProofFixHint('invalid_browser_proof_observation_link'),
      });
      continue;
    }
    if (isAbsolute(linkedPath)) {
      blockers.push({
        code: 'invalid_browser_proof_observation_link',
        severity: 'blocker',
        path: linkedPath,
        message: 'Browser Proof Observation link must be a repo-local relative file path.',
        fix_hint: browserProofFixHint('invalid_browser_proof_observation_link'),
      });
      continue;
    }

    const candidates = [resolve(dirname(summaryFullPath), linkedPath), resolve(workspaceRoot, linkedPath)]
      .filter((candidate, index, list) => list.indexOf(candidate) === index);
    const existingPath = candidates.find((candidate) => existsSync(candidate));
    if (!existingPath) {
      blockers.push({
        code: 'invalid_browser_proof_observation_link',
        severity: 'blocker',
        path: linkedPath,
        message: 'Browser Proof Observation link does not resolve to an existing file in this workspace.',
        fix_hint: browserProofFixHint('invalid_browser_proof_observation_link'),
      });
      continue;
    }
    try {
      const realWorkspaceRoot = realpathSync(workspaceRoot);
      const realExistingPath = realpathSync(existingPath);
      if (!isInsidePath(realWorkspaceRoot, realExistingPath)) {
        blockers.push({
          code: 'invalid_browser_proof_observation_link',
          severity: 'blocker',
          path: linkedPath,
          message: 'Browser Proof Observation link resolves outside this workspace.',
          fix_hint: browserProofFixHint('invalid_browser_proof_observation_link'),
        });
        continue;
      }
      const stat = statSync(existingPath);
      if (!stat.isFile()) {
        blockers.push({
          code: 'invalid_browser_proof_observation_link',
          severity: 'blocker',
          path: linkedPath,
          message: 'Browser Proof Observation link must resolve to a regular file.',
          fix_hint: browserProofFixHint('invalid_browser_proof_observation_link'),
        });
        continue;
      }
      records.push(readFileSync(existingPath, 'utf-8'));
    } catch (error) {
      blockers.push({
        code: 'invalid_browser_proof_observation_link',
        severity: 'blocker',
        path: linkedPath,
        message: `Browser Proof Observation link could not be read: ${error.code || error.message}.`,
        fix_hint: browserProofFixHint('invalid_browser_proof_observation_link'),
      });
    }
  }
  return { records, blockers };
}

function findBrowserProofObservationSections(summaryContent, summaryFullPath, workspaceRoot) {
  const linked = readLinkedObservationRecords(summaryContent, summaryFullPath, workspaceRoot);
  return {
    sections: [
      ...extractMarkdownSections(summaryContent, 'Browser Proof Observation'),
      ...linked.records
        .flatMap((record) => extractMarkdownSections(record, 'Browser Proof Observation')),
    ].filter(Boolean),
    blockers: linked.blockers,
  };
}

function browserProofObservationIssues(section) {
  const requiredFieldSets = [
    ['Flow', 'Routes/states'],
    ['Viewports'],
    ['Runtime path'],
    ['Evidence kind', 'Evidence kinds'],
    ['Evidence command', 'No-command rationale'],
    ['Observed', 'Observations'],
    ['Artifacts'],
    ['Result'],
    ['Claim limit'],
  ];
  const missingFields = requiredFieldSets
    .filter((labels) => !labels.some((label) => nonEmptyField(section, label)))
    .map((labels) => labels.join(' or '));
  if (!hasPrivacySafetyNote(section)) {
    missingFields.push('Privacy/safety');
  }
  const issues = missingFields.length > 0
    ? [{
        code: 'incomplete_browser_proof_observation',
        missingFields,
        message: `Browser Proof Observation is missing required observed-proof field(s): ${missingFields.join(', ')}.`,
      }]
    : [];
  if (!hasSupportedBrowserProofEvidenceKind(section)) {
    issues.push({
      code: 'unsupported_browser_proof_evidence_kind',
      message: 'Browser Proof Observation evidence kind must include runtime or test.',
    });
  }
  if (!hasPassingBrowserProofResult(section)) {
    issues.push({
      code: 'failed_browser_proof_observation',
      message: 'Browser Proof Observation result is not an explicit pass.',
    });
  }
  if (!isBoundedBrowserProofClaim(section)) {
    issues.push({
      code: 'overbroad_browser_proof_claim',
      message: 'Browser Proof Observation claim limit is missing or too broad.',
    });
  }
  return issues;
}

function isCompleteBrowserProofObservation(section) {
  return browserProofObservationIssues(section).length === 0;
}

function normalizeArtifactReference(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function observationReferencesPlan(section, planPath) {
  const planReference = sectionFieldValue(section, 'Plan')
    || sectionFieldValue(section, 'Plan artifact')
    || sectionFieldValue(section, 'PLAN');
  if (!isMeaningfulFieldValue(planReference)) return false;
  const normalizedReferences = normalizeArtifactReference(planReference)
    .split(/[\n,;]+/)
    .map((reference) => reference.trim().replace(/^\.\//, ''))
    .filter(Boolean);
  const normalizedPlanPath = normalizeArtifactReference(planPath);
  return normalizedReferences.some((reference) => reference === normalizedPlanPath);
}

function evaluateBrowserProofObservation(browserProofPlans, matchingSummaries, phasesDir, workspaceRoot) {
  const requiredPlans = browserProofPlans.filter((plan) => plan.required === true);
  if (requiredPlans.length === 0 || matchingSummaries.length === 0) {
    return {
      satisfied: true,
      sections: [],
      warnings: [],
      blockers: [],
    };
  }

  const sections = matchingSummaries.flatMap((summaryPath) => {
    const summaryFullPath = join(phasesDir, summaryPath);
    if (!existsSync(summaryFullPath)) return [];
    const found = findBrowserProofObservationSections(
      readFileSync(summaryFullPath, 'utf-8'),
      summaryFullPath,
      workspaceRoot
    );
    return found.sections.map((section) => ({ section, summaryPath }));
  });
  const linkBlockers = matchingSummaries.flatMap((summaryPath) => {
    const summaryFullPath = join(phasesDir, summaryPath);
    if (!existsSync(summaryFullPath)) return [];
    return findBrowserProofObservationSections(
      readFileSync(summaryFullPath, 'utf-8'),
      summaryFullPath,
      workspaceRoot
    ).blockers.map((blocker) => ({ ...blocker, path: `${summaryPath}: ${blocker.path}` }));
  });

  if (sections.length === 0 && linkBlockers.length === 0) {
    return {
      satisfied: false,
      sections,
      warnings: [],
      blockers: [{
        code: 'missing_browser_proof_observation',
        severity: 'blocker',
        path: matchingSummaries.join(', '),
        message: 'A plan requires browser proof, but no SUMMARY.md or linked record contains ## Browser Proof Observation.',
        fix_hint: browserProofFixHint('missing_browser_proof_observation'),
      }],
    };
  }

  const issueBlockers = sections.flatMap(({ section, summaryPath }) => (
    browserProofObservationIssues(section).map((issue) => ({
      code: issue.code,
      severity: 'blocker',
      path: summaryPath,
      message: issue.message,
      fix_hint: browserProofFixHint(issue.code),
    }))
  ));
  const completeSections = sections.filter(({ section }) => isCompleteBrowserProofObservation(section));
  if (completeSections.length === 0) {
    return {
      satisfied: false,
      sections: sections.map(({ section }) => section),
      warnings: [],
      blockers: [...linkBlockers, ...issueBlockers],
    };
  }

  const unmatchedPlans = requiredPlans.filter((plan) => (
    !completeSections.some(({ section }) => observationReferencesPlan(section, plan.path))
  ));
  const unmatchedBlockers = unmatchedPlans.map((plan) => ({
    code: 'unmatched_browser_proof_observation',
    severity: 'blocker',
    path: plan.path,
    message: `No complete Browser Proof Observation references required plan ${plan.path}.`,
    fix_hint: browserProofFixHint('unmatched_browser_proof_observation'),
  }));
  const blockers = [...linkBlockers, ...issueBlockers, ...unmatchedBlockers];
  if (blockers.length === 0) {
    return {
      satisfied: true,
      sections: sections.map(({ section }) => section),
      warnings: [],
      blockers: [],
    };
  }

  return {
    satisfied: false,
    sections: sections.map(({ section }) => section),
    warnings: [],
    blockers,
  };
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
  const stateName = basename(planningDir);
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
    }
    output({ phase: phaseNumber, status, roadmap: `${stateName}/ROADMAP.md`, changed });
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
  const stateName = basename(planningDir);

  if (!existsSync(planningDir)) {
    output({ error: `No ${stateName}/ directory found. Run \`npx -y gsdd-cli init\` then the new-project workflow first.` });
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
  const stateName = basename(planningDir);

  if (!existsSync(planningDir)) {
    return { ok: false, error: `No ${stateName}/ directory found.`, exitCode: 1 };
  }
  const phasesDir = join(planningDir, 'phases');
  const matchingPlans = findFiles(phasesDir, `${padPhase(phaseNum)}-PLAN`);
  const matchingSummaries = findFiles(phasesDir, `${padPhase(phaseNum)}-SUMMARY`);
  const prerequisiteBlockers = [];
  if (matchingPlans.length === 0) {
    prerequisiteBlockers.push({
      code: 'missing_phase_plan',
      severity: 'blocker',
      path: `${stateName}/phases/${padPhase(phaseNum)}-*/${padPhase(phaseNum)}-PLAN.md`,
      message: `No PLAN.md artifact was found for phase ${normalizePhaseToken(phaseNum)}.`,
      fix_hint: `Run /gsdd-plan ${normalizePhaseToken(phaseNum)} before verifying this phase.`,
    });
  }
  if (matchingPlans.length > 0 && matchingSummaries.length === 0) {
    prerequisiteBlockers.push({
      code: 'missing_phase_summary',
      severity: 'blocker',
      path: `${stateName}/phases/${padPhase(phaseNum)}-*/${padPhase(phaseNum)}-SUMMARY.md`,
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
  const browserProofPlans = matchingPlans.map((planPath) => {
    const fullPath = join(phasesDir, planPath);
    return existsSync(fullPath)
      ? evaluateBrowserProofContract(readFileSync(fullPath, 'utf-8'), planPath)
      : {
          path: planPath,
          declaration_present: false,
          required: null,
          rationale: null,
          satisfied: true,
          warnings: [],
          blockers: [],
        };
  });
  const browserProofObservationStatus = evaluateBrowserProofObservation(
    browserProofPlans,
    matchingSummaries,
    phasesDir,
    workspaceRoot
  );
  const browserProofBlockers = [
    ...browserProofPlans.flatMap((plan) => plan.blockers),
    ...browserProofObservationStatus.blockers,
  ];
  const browserProofWarnings = [
    ...browserProofPlans.flatMap((plan) => plan.warnings || []),
    ...(browserProofObservationStatus.warnings || []),
  ];
  const artifactStatus = evaluatePlanArtifacts(artifacts);
  const legacyVerified = matchingPlans.length > 0 && matchingSummaries.length > 0;
  const blockedOn = [
    ...(prerequisiteBlockers.length > 0 ? ['prerequisites'] : []),
    ...(artifactStatus.satisfied ? [] : ['artifacts']),
    ...(browserProofBlockers.length > 0 ? ['browser_proof'] : []),
  ];
  const closureVerified = legacyVerified
    && prerequisiteBlockers.length === 0
    && artifactStatus.satisfied
    && browserProofBlockers.length === 0;

  const result = {
    phase: normalizePhaseToken(phaseNum),
    exists: matchingPlans.length > 0,
    plans: matchingPlans,
    summaries: matchingSummaries,
    artifacts,
    allExist: artifacts.every((artifact) => artifact.exists),
    artifact_status: artifactStatus,
    browser_proof_status: {
      satisfied: browserProofBlockers.length === 0,
      plans: browserProofPlans,
      observations: browserProofObservationStatus,
      warnings: browserProofWarnings,
      blockers: browserProofBlockers,
    },
    verified: closureVerified,
    legacy_verified: legacyVerified,
    phase_artifacts_present: legacyVerified,
    prerequisite_status: {
      satisfied: prerequisiteBlockers.length === 0,
      blockers: prerequisiteBlockers,
    },
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
