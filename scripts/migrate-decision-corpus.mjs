#!/usr/bin/env node
// Throwaway-legal S1 seed: migrate only the standing rules and lessons named by D-88.
// The ledger remains the archive for one-time delivery verdicts.
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readDecisionRecords, writeDecisionRecord } from '../bin/lib/work-context.mjs';
import { resolveWorkspaceContext } from '../bin/lib/workspace-root.mjs';

const LEDGER_PATH = '.work/scratchpad/2026-07-05-session-decisions.md';
const EXPANSION_PATH = '.work/research/2026-07-11-decision-backend/CORPUS-EXPANSION.md';

// These are explicitly delivery-scoped outcomes. They stay searchable in the prose ledger,
// but D-88 says they must not become records. The count is reported by the migration result.
const SKIPPED_ONE_TIME_VERDICTS = [
  'D-16', 'D-24', 'D-47', 'D-71', 'D-75', 'D-76',
];

// The corpus is intentionally compact: related standing constraints retain their source refs
// in one record rather than turning every historical D-number into a separate live object.
const LEDGER_RECORDS = [
  rule('D-1', 'junior-litmus-4n8d', 'New Workspine surfaces must stay understandable to a junior agent.', 'The project setup ruling kept the junior-litmus principle after the one-time setup work finished.'),
  rule('D-3, D-31, D-51, D-61', 'auto-after-spec-h6a2', 'AUTO mode starts only after a spec exists, advances in batches, and exits at its named wall-clock boundary.', 'The AUTO contract requires a grounded spec, a loud done signal, and a bounded unattended interval.'),
  rule('D-4, D-26, D-49, D-50', 'research-quarantine-q5b7', 'Agentic research is quarantined behind its no-slop gate, while brainstorm entry and research prompts stay explicit.', 'The scope and prompt rules permit revival only through named evidence, authority, and a single grounded ask.'),
  rule('D-6, D-87', 'hooks-enforcement-c9f3', 'Hooks are an enforcement requirement; standing rules classify as advisory or enforceable before hook installation.', 'The hook rulings make enforcement a product requirement and retain record ids for traceability into the later M2 mechanism.'),
  rule('D-7, D-9, D-29, D-43, D-59, D-77', 'surface-admission-s4d6', 'New surface area needs cohesion and cognitive-load admission review; agents get markdown while humans get visual, jargon-free surfaces.', 'The cohesion, visual, delivery-channel, admission, and jargon rules require integration into existing readable surfaces before new commands or abstractions.'),
  rule('D-10', 'runtime-thesis-j7e1', 'Native runtimes stay primary and the product thesis remains locked.', 'The resolved multi-part ruling keeps the native runtime posture and delivery-spine thesis while excluding completed history and protect-flag work.'),
  rule('D-11', 'no-history-rewrite-k2p8', 'Do not rewrite project history after the audit.', 'The audit result permanently forecloses a history rewrite even though the audit itself is complete.'),
  rule('D-12, D-13', 'consumer-gates-a5m9', 'Protection gates serve consumers and init must not add a protect flag.', 'The gate boundary is consumer-facing; the rejected init flag remains out of scope.'),
  rule('D-15, D-45, D-63, D-64, eval-light', 'browser-proof-v3c4', 'Browser proof is first-class, evidence is structured, checkers reject cleanliness-only proof abstractions, and every real miss becomes a negative fixture.', 'The proof contract requires a live rendered check, a failure taxonomy, durable evidence fields, repository-specific checker intent, and a light failure corpus.'),
  rule('D-17', 'private-spec-r8x2', 'Internal Workspine specs live privately under .work.', 'The governance surface remains private while root public files stay product-facing.'),
  rule('D-5, D-14, D-18', 'content-first-z6q4', 'Keep workflow content and evolve it in place; the 14-to-5 cut is rejected.', 'The locked content-first verdict overturned the five-skill shape after the re-challenge.'),
  rule('D-19', 'frontmatter-diet-f8u1', 'Plan frontmatter stays small and earns every field through consumer value.', 'The approved diet protects assurance while rejecting metadata that does not help the next reader.'),
  rule('D-20, D-21', 'workflow-roles-e3k7', 'next routes, progress observes, and pause/resume extend rather than merge workflows.', 'Distinct workflow roles prevent context rot and avoid a new merged command surface.'),
  rule('D-22, D-36, D-40', 'plan-amend-n9r5', 'Plan uses EXTEND and AMEND modes, including bounded brownfield lanes; it carries step receipts and an explicit STOP marker while a separate gaps command stays dead.', 'The plan surface absorbs scoped amendments, mid-weight brownfield work, and process receipts instead of creating another lifecycle command.'),
  rule('D-25', 'challenge-not-sergeant-b4w6', 'Agents challenge unclear direction instead of complying as a sergeant.', 'The standing meta-rule requires a challenge when scope or authority is ambiguous.'),
  rule('D-32', 'agent-self-check-s2v8', 'The executing agent runs safe checks itself before handoff.', 'Verification is an execution responsibility rather than a deferred promise.'),
  rule('D-35, D-37', 'consumer-pr-flow-c7l3', 'Consumer phase work keeps PR gates and safe PR-cut support while dogfood uses direct commits.', 'D-80 changed dogfood flow, not the consumer PR safety feature.'),
  rule('D-39', 'consent-before-write-u5h2', 'AGENTS.md must stay small and agents never auto-write it without consent.', 'The durable consent rule limits governance mutation even when generated adapters are available.'),
  rule('D-42', 'fresh-context-spawn-g3t9', 'Spawn fresh-context agents only for the three justified orchestration cases.', 'The heuristic protects context rather than treating delegation as a default.'),
  lesson('D-44, D-65', 'people-field-d8y4', 'Decision records support people attribution and lessons as a first-class type; PR comments qualify but Slack does not.', 'The v1 taxonomy keeps useful provenance and reusable learning without turning every conversation into memory.'),
  rule('D-52', 'memory-privacy-h6n5', 'Memory remains under user control and does not silently leave the repo.', 'The privacy floor is reinforced by the private decision tier.'),
  rule('D-53, D-54', 'boundary-git-truth-p4k1', 'Every lifecycle boundary reads current git truth and checks planning sync after merge.', 'Boundary assertions prevent stale plan state from overriding repository reality.'),
  rule('D-55, D-56', 'config-quarantine-r7v2', 'Malformed or mode-conflicting configuration is quarantined and resolved, never silently rewritten or dead-ended.', 'Configuration integrity requires an explicit resolution rather than defaults that hide bad input.'),
  rule('D-46, D-57', 'context-diet-q1m6', 'Long steps emit a heartbeat while workflows reduce mandatory context through lazy reads and durable receipts.', 'The root context problem is forced rereading and invisible long work; workflow leverage comes from bounded input and recovery artifacts.'),
  rule('D-58, P65-no-lease', 'deterministic-scripts-w8c3', 'Repeated deterministic mechanics belong in action scripts, including atomic writes rather than reviving a lease model.', 'Agents call helpers for repeatable work instead of improvising shell operations or relying on leases that can orphan.'),
  rule('D-60', 'consolidate-merge-x2a7', 'Consolidate and merge lanes remains an always-legal escape hatch.', 'Parallel work cannot trap a repo in permanent lane fragmentation.'),
  rule('D-62', 'capture-moments-e6f9', 'Decision capture happens at explicit workflow moments, not inferred from chat.', 'IDEAS, pre-plan surfacing, topic split, and restore checks are the named capture points.'),
  rule('D-67', 'worktree-cleanup-d4r8', 'Stale worktrees and branches need cleanup without a new config flag.', 'The no-flag clause survives even while the broader M3 observatory feature remains parked.'),
  rule('D-73', 'codex-execution-f7k5', 'Codex executes planned phase work through codex exec with its own subagent rounds.', 'The execution mechanic is standing and keeps planning, execution, and review-agent roles distinct.'),
  rule('D-74', 'tarball-smoke-z3p6', 'Tarball installation smoke coverage remains a release invariant.', 'The smoke execution is complete, but the CI-level verification rule remains live.'),
  rule('D-28, D-33, D-38', 'adapter-extension-z4u6', 'Model tiering and workflow extensions remain adapter-computed and deferred until the proof loop is stable.', 'The runtime rules preserve the configuration direction without reopening adapters or extension surface prematurely.'),
  rule('D-23, D-78, D-2, D-48, M3-OPEN', 'm3-lane-truth-r2h8', 'Lane truth is parked for M3 with folder-only .work/changes as the default.', 'Three options remain open until M1/M2 usage supplies evidence; the prior lane re-challenge and pause-hook proposal are folded into this default.'),
  rule('D-72, D-80', 'direct-phase-commits-v6d1', 'Dogfood phase work lands as one direct commit to main instead of a PR.', 'The user replaced the former branch-stack and per-phase PR ceremony with a commit-diff review before the next phase.'),
  rule('D-66, D-81', 'commit-diff-review-k4s7', 'Review phase commits before push with terra or Opus; Fable is out, sol is tightly bounded, and cross-vendor second opinions use bare CLI.', 'The review-flow ruling keeps fresh-context review while constraining reviewer roles and their tool surface.', 'D-81'),
  rule('D-79, D-82', 'phase-go-gate-q9c2', 'Every Codex agent phase launch needs an explicit GO gate and the agreed M1 cadence.', 'The standing cadence rule prevents unreviewed phase starts and preserves the refined phase ordering.'),
  rule('D-8, D-27, D-83, D-84, D-85, D-86', 'file-first-recall-m5x8', 'Decision recall is file-first with a query-time edge map; persistent graph work is frozen.', 'The adopted design keeps records authoritative, adds state-dir-aware private storage, and kills persistent graph/index work until a measured need exists.'),
  rule('D-30, D-34, D-41, D-68, D-69, D-70', 'product-boundaries-y7n3', 'Enterprise posture stays light while named v2 laters and explicit scope-outs remain parked.', 'Product boundary decisions keep enterprise-heavy features, forensics, observability, sync, and advisor work visible without silently importing them into the current delivery spine.'),
  rule('D-89', 'validity-meta-rules-n6p3', 'Repo rules outrank private prefs; global tier = fallback, never silent promotion; auto-capture creates candidates only, remember promotes.', 'D-89 makes repository authority, global fallback, and explicit promotion the standing validity rules.'),
];

const EXPANSION_LESSONS = [
  lesson('LL-OPTIONAL-LOCAL-FILES', 'optional-files-r4e7', 'Optional local files must be described as optional in gaps and health output.', 'A past health-rule failure treated auto-created local files as universal repo requirements.'),
  lesson('LL-LOCAL-HELPER-RUNTIME', 'local-runtime-p8t2', 'Repo-local helper runtimes own their dependencies and do not proxy through package-manager lookup.', 'The consumer failure showed that a local helper is not deterministic if it shells back through npm.'),
  lesson('LL-MARKDOWN-RUNTIME-GAP', 'markdown-runtime-h3w6', 'Markdown contracts cannot close native runtime orchestration gaps by themselves.', 'Portable workflow prose and native runtime capability need an explicit boundary.'),
  lesson('LL-WORKFLOW-MUTABILITY', 'workflow-mutability-c5r9', 'Workflow mutation behavior follows mutability classification, not whether output looks like a report.', 'Write-surfaces must be classified and tested as such to avoid false read-only contracts.'),
  lesson('LL-AUTHORITY-TRUTH', 'authority-truth-d6k1', 'Authority surfaces must stay synchronized before auto-mode continues.', 'A contradiction among SPEC, ROADMAP, TODO, and repo truth is a blocker, not background context.'),
  lesson('LL-PREFLIGHT-DRIFT', 'preflight-drift-m2v5', 'Preflight drift and no-op status helpers fail closed.', 'Intentional planning mutations must rebaseline explicitly instead of weakening drift protection.'),
];

export function migrateDecisionCorpus({ root = process.cwd(), now = new Date(), dryRun = false } = {}) {
  const workspaceRoot = resolve(root);
  const ledger = readRequired(workspaceRoot, LEDGER_PATH);
  const expansion = readRequired(workspaceRoot, EXPANSION_PATH);
  validateMigrationInputs({ ledger, expansion });

  const workspace = resolveWorkspaceContext([], { cwd: workspaceRoot });
  if (workspace.invalid) throw new Error(workspace.error);
  const workDir = workspace.planningDir;
  const existing = readDecisionRecords(workDir).records;
  const created = [];
  const unchanged = [];
  for (const candidate of [...LEDGER_RECORDS, ...EXPANSION_LESSONS]) {
    const candidateRefs = candidate.legacy_ref.split(',').map((value) => value.trim());
    const matching = existing.find((record) => candidateRefs.every((ref) => (record.meta.legacy_ref || '').includes(ref)));
    if (matching) {
      unchanged.push(matching.meta.id);
      continue;
    }
    const evidence = candidate.source === 'corpus-expansion'
      ? extractCorpusEvidence(expansion, candidate.legacy_ref)
      : extractLedgerEvidence(ledger, candidate.primary_ref || candidate.legacy_ref);
    const record = {
      type: candidate.type,
      status: 'active',
      scope: 'repo',
      decision: candidate.decision,
      why: candidate.why,
      for: candidate.for,
      links: candidate.links,
      legacy_ref: candidate.legacy_ref,
      source: candidate.source,
      provenance: 'migration',
      body: `Migration evidence (${candidate.legacy_ref}):\n\n${evidence}`,
    };
    if (dryRun) {
      created.push({ id: null, legacy_ref: candidate.legacy_ref, decision: candidate.decision });
    } else {
      const result = writeDecisionRecord(workDir, record, { now, repoRoot: workspaceRoot });
      created.push({ id: result.id, legacy_ref: candidate.legacy_ref, decision: candidate.decision });
    }
  }

  return {
    status: dryRun ? 'dry_run' : 'ok',
    migrated_count: created.length,
    existing_count: unchanged.length,
    skipped_one_time_count: SKIPPED_ONE_TIME_VERDICTS.length,
    skipped_one_time_refs: SKIPPED_ONE_TIME_VERDICTS,
    records: created,
  };
}

function rule(legacy_ref, source_token, decision, why, primary_ref = null) {
  return standingRecord('rule', legacy_ref, source_token, decision, why, primary_ref);
}

function lesson(legacy_ref, source_token, decision, why) {
  return standingRecord('lesson', legacy_ref, source_token, decision, why);
}

function standingRecord(type, legacy_ref, source_token, decision, why, primary_ref = null) {
  const stateDirScoped = legacy_ref.includes('D-84') || legacy_ref.includes('D-85') || legacy_ref.includes('D-86');
  const laneScoped = legacy_ref.includes('M3-OPEN');
  return {
    type,
    legacy_ref,
    source_token,
    decision,
    why,
    for: stateDirScoped ? 'repo:current, path:bin/lib/state-dir.mjs' : laneScoped ? 'repo:current, milestone:m3, lane:worktrees' : 'repo:current',
    links: stateDirScoped ? 'code=bin/lib/state-dir.mjs:1' : null,
    source: legacy_ref.startsWith('LL-') ? 'corpus-expansion' : 'migrated-ledger',
    primary_ref,
  };
}

function readRequired(root, relativePath) {
  const filePath = join(root, relativePath);
  if (!existsSync(filePath)) throw new Error(`migration source missing: ${relativePath}`);
  return readFileSync(filePath, 'utf-8');
}

function validateMigrationInputs({ ledger, expansion }) {
  if (!ledger.includes('D-88 RULING') || !/ONLY STANDING RULES\s+and\s+LESSONS/.test(ledger)) {
    throw new Error('D-88 corpus principle is missing from the ledger');
  }
  if (!ledger.includes('D-89 RULING') || !ledger.includes('validity lifecycle')) {
    throw new Error('D-89 validity lifecycle is missing from the ledger');
  }
  if (!expansion.includes('CANDIDATE RECORDS') || !expansion.includes('Lesson Records')) {
    throw new Error('CORPUS-EXPANSION lesson candidates are missing');
  }
}

function extractLedgerEvidence(ledger, primaryRef) {
  const primary = primaryRef.split(',')[0].trim();
  const decisionNumber = primary.match(/^D-(\d+)$/)?.[1];
  const heading = decisionNumber
    ? ledger.match(new RegExp(`^## D-\\d{4}-\\d{2}-\\d{2}-${decisionNumber}(?:\\s|—)`, 'm'))
    : null;
  const index = heading?.index ?? ledger.indexOf(primary);
  if (index < 0) throw new Error(`ledger evidence missing for ${primary}`);
  return ledger.slice(index, Math.min(ledger.length, index + 1200)).trim();
}

function extractCorpusEvidence(expansion, legacyRef) {
  const token = {
    'LL-OPTIONAL-LOCAL-FILES': 'Optional local files must look optional in gaps',
    'LL-LOCAL-HELPER-RUNTIME': 'Local helper runtime must own dependencies',
    'LL-MARKDOWN-RUNTIME-GAP': 'Markdown cannot close runtime orchestration gaps',
    'LL-WORKFLOW-MUTABILITY': 'Workflow mutation must follow mutability classification',
    'LL-AUTHORITY-TRUTH': 'Authority surfaces must stay synchronized',
    'LL-PREFLIGHT-DRIFT': 'Preflight drift and no-op status helpers must fail-closed',
  }[legacyRef];
  const index = token ? expansion.toLowerCase().indexOf(token.toLowerCase()) : -1;
  if (index < 0) throw new Error(`corpus expansion evidence missing for ${legacyRef}`);
  const lineStart = expansion.lastIndexOf('\n', index) + 1;
  const lineEnd = expansion.indexOf('\n', index);
  return expansion.slice(lineStart, lineEnd < 0 ? expansion.length : lineEnd).trim();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = migrateDecisionCorpus({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(result, null, 2));
}
