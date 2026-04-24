import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { evaluateLifecycleState } from './lifecycle-state.mjs';
import {
  getRuntimeFreshnessRepairGuidance,
  summarizeRuntimeFreshnessIssues,
} from './runtime-freshness.mjs';
import { checkDrift } from './session-fingerprint.mjs';

export const TRUTH_CHECK_IDS = ['W7', 'W8', 'W9', 'W10', 'W11', 'W12'];

export function runTruthChecks(planningDir, frameworkDir, actualCheckIds, options = {}) {
  const warnings = [];
  const designPath = join(frameworkDir, 'distilled', 'DESIGN.md');
  const readmePath = join(frameworkDir, 'distilled', 'README.md');
  const workflowsDir = join(frameworkDir, 'distilled', 'workflows');
  const gapsPath = join(frameworkDir, '.internal-research', 'gaps.md');
  const specPath = join(planningDir, 'SPEC.md');
  const roadmapPath = join(planningDir, 'ROADMAP.md');
  const lifecycle = evaluateLifecycleState({ planningDir });

  if (existsSync(designPath)) {
    const documentedIds = extractHealthTableIds(readFileSync(designPath, 'utf-8'));
    const missingFromDesign = actualCheckIds.filter((id) => !documentedIds.includes(id));
    const extraInDesign = documentedIds.filter((id) => !actualCheckIds.includes(id));
    if (missingFromDesign.length > 0 || extraInDesign.length > 0) {
      const parts = [];
      if (missingFromDesign.length > 0) parts.push(`missing in DESIGN.md: ${missingFromDesign.join(', ')}`);
      if (extraInDesign.length > 0) parts.push(`extra in DESIGN.md: ${extraInDesign.join(', ')}`);
      warnings.push({
        id: 'W7',
        severity: 'WARN',
        message: `DESIGN.md health check table is out of sync (${parts.join('; ')})`,
        fix: 'Update distilled/DESIGN.md section 20 to match the implemented health checks',
      });
    }
  }

  if (existsSync(readmePath) && existsSync(workflowsDir)) {
    const readme = readFileSync(readmePath, 'utf-8');
    const workflowFiles = readdirSync(workflowsDir).filter((entry) => entry.endsWith('.md')).sort();
    const statusEntries = extractReadmeStatusEntries(readme);
    const treeEntries = extractReadmeWorkflowTreeEntries(readme);
    const issues = [];
    if (statusEntries.length !== workflowFiles.length) {
      issues.push(`status table ${statusEntries.length} != workflows dir ${workflowFiles.length}`);
    }
    if (treeEntries.length !== workflowFiles.length) {
      issues.push(`framework tree ${treeEntries.length} != workflows dir ${workflowFiles.length}`);
    }
    const missingStatus = workflowFiles.filter((name) => !statusEntries.includes(name));
    const missingTree = workflowFiles.filter((name) => !treeEntries.includes(name));
    if (missingStatus.length > 0) issues.push(`missing from status table: ${missingStatus.join(', ')}`);
    if (missingTree.length > 0) issues.push(`missing from framework tree: ${missingTree.join(', ')}`);
    if (issues.length > 0) {
      warnings.push({
        id: 'W8',
        severity: 'WARN',
        message: `distilled/README.md workflow inventory is out of sync (${issues.join('; ')})`,
        fix: 'Update distilled/README.md workflow status table and framework file tree to match distilled/workflows/',
      });
    }
  }

  if (existsSync(gapsPath)) {
    const gapRefs = extractRepoLocalPaths(readFileSync(gapsPath, 'utf-8'));
    const missingRefs = gapRefs.filter((ref) => !existsSync(join(frameworkDir, ref)));
    if (missingRefs.length > 0) {
      warnings.push({
        id: 'W9',
        severity: 'WARN',
        message: `gaps.md references missing repo-local paths (${missingRefs.join(', ')})`,
        fix: 'Annotate stale gap references as resolved or update them to current repo truth',
      });
    }
  }

  if (existsSync(roadmapPath)) {
    const mismatches = [
      ...(existsSync(specPath) ? lifecycle.requirementAlignment.mismatches : []),
      ...lifecycle.phaseStatusAlignment.mismatches,
    ];
    if (mismatches.length > 0) {
      warnings.push({
        id: 'W10',
        severity: 'WARN',
        message: `ROADMAP/SPEC requirement status drift (${mismatches.join('; ')})`,
        fix: 'Reconcile .planning/ROADMAP.md phase completion markers with .planning/SPEC.md requirement checkboxes',
      });
    }
  }

  if (options.runtimeFreshnessReport?.issueCount > 0) {
    warnings.push({
      id: 'W11',
      severity: 'WARN',
      message: `Installed generated runtime surfaces drift from current render output (${summarizeRuntimeFreshnessIssues(options.runtimeFreshnessReport)})`,
      fix: getRuntimeFreshnessRepairGuidance(options.runtimeFreshnessReport),
    });
  }

  const drift = checkDrift(planningDir);
  if (drift.drifted) {
    warnings.push({
      id: 'W12',
      severity: 'WARN',
      message: `Planning state drifted since last recorded session (${drift.details.join('; ')})`,
      fix: 'Review the changes, then run a lifecycle workflow to update the fingerprint',
    });
  }

  return warnings;
}

function extractHealthTableIds(content) {
  const section = extractSection(content, '## 20. Workspace Health Diagnostics', '## 21.');
  if (!section) return [];
  return [...normalizeContent(section).matchAll(/^\|\s*([EWI]\d+)\s*\|/gm)].map((result) => result[1]);
}

function extractReadmeStatusEntries(content) {
  const section = extractSection(content, '## Current Status', 'Architecture notes:');
  if (!section) return [];
  return [...normalizeContent(section).matchAll(/\|\s*`([^`]+\.md)`\s*\|/g)].map((result) => result[1]);
}

function extractReadmeWorkflowTreeEntries(content) {
  const section = extractSection(content, '## Files In This Framework', '## ');
  const match = normalizeContent(section || '').match(/```[\s\S]*?workflows\/\n([\s\S]*?)\n\s*templates\//);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'));
}

function extractRepoLocalPaths(content) {
  const allowedRoots = [
    'AGENTS.md',
    'README.md',
    'CHANGELOG.md',
    'SPEC.md',
    'package.json',
    '.planning/',
    '.internal-research/',
    '.agents/',
    '.claude/',
    '.opencode/',
    '.codex/',
    '.worktrees/',
    'bin/',
    'distilled/',
    'tests/',
    'fixtures/',
    'agents/',
  ];
  const refs = new Set();
  for (const result of content.matchAll(/`([^`]+)`/g)) {
    const value = result[1].trim();
    if (!looksLikeRepoLocalPath(value, allowedRoots)) continue;
    refs.add(value.replace(/\\/g, '/').replace(/\/$/, ''));
  }
  return [...refs];
}

function looksLikeRepoLocalPath(value, allowedRoots) {
  if (value.includes(' ')) return false;
  if (value.startsWith('/')) return false;
  if (value.startsWith('$')) return false;
  if (value.startsWith('..')) return false;
  if (value.includes('://')) return false;
  if (value.startsWith('feat/') || value.startsWith('fix/') || value.startsWith('pr') || value.startsWith('origin/')) return false;
  if (allowedRoots.some((root) => value === root || value.startsWith(root))) return true;
  return false;
}

function extractSection(content, startMarker, endMarker) {
  const normalized = normalizeContent(content);
  const start = normalized.indexOf(startMarker);
  if (start === -1) return '';
  const rest = normalized.slice(start);
  if (!endMarker) return rest;
  const end = rest.indexOf(endMarker, startMarker.length);
  return end === -1 ? rest : rest.slice(0, end);
}

function normalizeContent(content) {
  return content.replace(/\r\n/g, '\n');
}
