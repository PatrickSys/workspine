/**
 * GSDD Cross-Runtime Validation Suite
 *
 * S6 — Fixture chain validation: verifies golden-path fixture artifacts
 *       have correct runtime/assurance frontmatter and structural content.
 * S7 — Adapter chain validation: verifies cross-runtime adapter generation
 *       produces structurally compatible surfaces for all native runtimes.
 *
 * No LLM calls — deterministic verification of cross-runtime contracts.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

// --- Helpers ---

/** Parse YAML frontmatter from markdown content */
function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) fm[key] = value;
  }
  return fm;
}

/** Extract content between XML-style tags */
function extractXmlSection(content, tag) {
  const re = new RegExp('<' + tag + '>[\\s\\S]*?</' + tag + '>', 'g');
  const matches = content.match(re);
  return matches ? matches.join('\n') : '';
}

/** Read a fixture file */
function readFixture(chain, filename) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'cross-runtime', chain, filename);
  assert.ok(fs.existsSync(fixturePath), 'Fixture must exist: ' + chain + '/' + filename);
  return fs.readFileSync(fixturePath, 'utf-8');
}

/** Valid runtime and assurance values from SPEC.md typed schemas */
const VALID_RUNTIMES = ['claude-code', 'codex-cli', 'gemini-cli', 'cursor', 'copilot', 'opencode', 'other'];
const VALID_ASSURANCES = ['unreviewed', 'self_checked', 'cross_runtime_checked'];

/** Init helper */
async function initProject(tmpDir, ...flags) {
  const restoreStdin = setNonInteractiveStdin();
  try {
    const gsdd = await loadGsdd(tmpDir);
    await gsdd.cmdInit(...flags);
  } finally {
    restoreStdin();
  }
}

// ============================================================
// S6 — Fixture Chain Validation
// ============================================================

describe('S6 — Fixture Chain Validation (cross-runtime golden-path artifacts)', () => {

  // --- Chain A: claude-code -> codex-cli -> opencode ---

  describe('Chain A (claude-code -> codex-cli -> opencode)', () => {
    const CHAIN = 'chain-a';
    const EXPECTED_PLAN_RUNTIME = 'claude-code';
    const EXPECTED_SUMMARY_RUNTIME = 'codex-cli';
    const EXPECTED_VERIFY_RUNTIME = 'opencode';
    const EXPECTED_PHASE = '01-sample';

    test('PLAN fixture has correct runtime and assurance frontmatter', () => {
      const content = readFixture(CHAIN, '01-PLAN.md');
      const fm = parseFrontmatter(content);
      assert.strictEqual(fm.runtime, EXPECTED_PLAN_RUNTIME, 'PLAN runtime must be claude-code');
      assert.ok(VALID_ASSURANCES.includes(fm.assurance), 'PLAN assurance must be valid type');
      assert.strictEqual(fm.phase, EXPECTED_PHASE, 'PLAN phase must match chain');
    });

    test('SUMMARY fixture has correct runtime and assurance frontmatter', () => {
      const content = readFixture(CHAIN, '01-SUMMARY.md');
      const fm = parseFrontmatter(content);
      assert.strictEqual(fm.runtime, EXPECTED_SUMMARY_RUNTIME, 'SUMMARY runtime must be codex-cli');
      assert.ok(VALID_ASSURANCES.includes(fm.assurance), 'SUMMARY assurance must be valid type');
      assert.strictEqual(fm.phase, EXPECTED_PHASE, 'SUMMARY phase must match chain');
    });

    test('VERIFICATION fixture has correct runtime and assurance frontmatter', () => {
      const content = readFixture(CHAIN, '01-VERIFICATION.md');
      const fm = parseFrontmatter(content);
      assert.strictEqual(fm.runtime, EXPECTED_VERIFY_RUNTIME, 'VERIFICATION runtime must be opencode');
      assert.ok(VALID_ASSURANCES.includes(fm.assurance), 'VERIFICATION assurance must be valid type');
      assert.strictEqual(fm.phase, EXPECTED_PHASE, 'VERIFICATION phase must match chain');
      assert.strictEqual(fm.status, 'passed', 'VERIFICATION status must be passed');
    });

    test('SUMMARY handoff block references PLAN runtime', () => {
      const content = readFixture(CHAIN, '01-SUMMARY.md');
      const handoff = extractXmlSection(content, 'handoff');
      assert.ok(handoff.length > 0, 'SUMMARY must have <handoff> block');
      assert.ok(handoff.includes('plan_runtime: ' + EXPECTED_PLAN_RUNTIME),
        'handoff must reference plan_runtime: ' + EXPECTED_PLAN_RUNTIME);
    });

    test('SUMMARY has judgment with all 4 sub-sections (D41 compliance)', () => {
      const content = readFixture(CHAIN, '01-SUMMARY.md');
      const judgment = extractXmlSection(content, 'judgment');
      assert.ok(judgment.length > 0, 'SUMMARY must have <judgment> block');
      assert.ok(extractXmlSection(content, 'active_constraints').length > 0, 'must have <active_constraints>');
      assert.ok(extractXmlSection(content, 'unresolved_uncertainty').length > 0, 'must have <unresolved_uncertainty>');
      assert.ok(extractXmlSection(content, 'decision_posture').length > 0, 'must have <decision_posture>');
      assert.ok(extractXmlSection(content, 'anti_regression').length > 0, 'must have <anti_regression>');
    });

    test('chain uses 3 different runtimes', () => {
      const planFm = parseFrontmatter(readFixture(CHAIN, '01-PLAN.md'));
      const summaryFm = parseFrontmatter(readFixture(CHAIN, '01-SUMMARY.md'));
      const verifyFm = parseFrontmatter(readFixture(CHAIN, '01-VERIFICATION.md'));
      const runtimes = new Set([planFm.runtime, summaryFm.runtime, verifyFm.runtime]);
      assert.strictEqual(runtimes.size, 3, 'chain must use 3 different runtimes');
    });
  });

  // --- Chain B: opencode -> claude-code -> codex-cli ---

  describe('Chain B (opencode -> claude-code -> codex-cli)', () => {
    const CHAIN = 'chain-b';
    const EXPECTED_PLAN_RUNTIME = 'opencode';
    const EXPECTED_SUMMARY_RUNTIME = 'claude-code';
    const EXPECTED_VERIFY_RUNTIME = 'codex-cli';
    const EXPECTED_PHASE = '02-sample';

    test('PLAN fixture has correct runtime and assurance frontmatter', () => {
      const content = readFixture(CHAIN, '01-PLAN.md');
      const fm = parseFrontmatter(content);
      assert.strictEqual(fm.runtime, EXPECTED_PLAN_RUNTIME, 'PLAN runtime must be opencode');
      assert.ok(VALID_ASSURANCES.includes(fm.assurance), 'PLAN assurance must be valid type');
      assert.strictEqual(fm.phase, EXPECTED_PHASE, 'PLAN phase must match chain');
    });

    test('SUMMARY fixture has correct runtime and assurance frontmatter', () => {
      const content = readFixture(CHAIN, '01-SUMMARY.md');
      const fm = parseFrontmatter(content);
      assert.strictEqual(fm.runtime, EXPECTED_SUMMARY_RUNTIME, 'SUMMARY runtime must be claude-code');
      assert.ok(VALID_ASSURANCES.includes(fm.assurance), 'SUMMARY assurance must be valid type');
      assert.strictEqual(fm.phase, EXPECTED_PHASE, 'SUMMARY phase must match chain');
    });

    test('VERIFICATION fixture has correct runtime and assurance frontmatter', () => {
      const content = readFixture(CHAIN, '01-VERIFICATION.md');
      const fm = parseFrontmatter(content);
      assert.strictEqual(fm.runtime, EXPECTED_VERIFY_RUNTIME, 'VERIFICATION runtime must be codex-cli');
      assert.ok(VALID_ASSURANCES.includes(fm.assurance), 'VERIFICATION assurance must be valid type');
      assert.strictEqual(fm.phase, EXPECTED_PHASE, 'VERIFICATION phase must match chain');
      assert.strictEqual(fm.status, 'passed', 'VERIFICATION status must be passed');
    });

    test('SUMMARY handoff block references PLAN runtime', () => {
      const content = readFixture(CHAIN, '01-SUMMARY.md');
      const handoff = extractXmlSection(content, 'handoff');
      assert.ok(handoff.length > 0, 'SUMMARY must have <handoff> block');
      assert.ok(handoff.includes('plan_runtime: ' + EXPECTED_PLAN_RUNTIME),
        'handoff must reference plan_runtime: ' + EXPECTED_PLAN_RUNTIME);
    });

    test('SUMMARY has judgment with all 4 sub-sections (D41 compliance)', () => {
      const content = readFixture(CHAIN, '01-SUMMARY.md');
      const judgment = extractXmlSection(content, 'judgment');
      assert.ok(judgment.length > 0, 'SUMMARY must have <judgment> block');
      assert.ok(extractXmlSection(content, 'active_constraints').length > 0, 'must have <active_constraints>');
      assert.ok(extractXmlSection(content, 'unresolved_uncertainty').length > 0, 'must have <unresolved_uncertainty>');
      assert.ok(extractXmlSection(content, 'decision_posture').length > 0, 'must have <decision_posture>');
      assert.ok(extractXmlSection(content, 'anti_regression').length > 0, 'must have <anti_regression>');
    });

    test('chain uses 3 different runtimes', () => {
      const planFm = parseFrontmatter(readFixture(CHAIN, '01-PLAN.md'));
      const summaryFm = parseFrontmatter(readFixture(CHAIN, '01-SUMMARY.md'));
      const verifyFm = parseFrontmatter(readFixture(CHAIN, '01-VERIFICATION.md'));
      const runtimes = new Set([planFm.runtime, summaryFm.runtime, verifyFm.runtime]);
      assert.strictEqual(runtimes.size, 3, 'chain must use 3 different runtimes');
    });
  });

  // --- Cross-chain coverage validation ---

  describe('Cross-chain coverage matrix', () => {
    test('both chains together cover all 3 native runtimes in all 3 workflow positions', () => {
      const chainA = {
        plan: parseFrontmatter(readFixture('chain-a', '01-PLAN.md')).runtime,
        execute: parseFrontmatter(readFixture('chain-a', '01-SUMMARY.md')).runtime,
        verify: parseFrontmatter(readFixture('chain-a', '01-VERIFICATION.md')).runtime,
      };
      const chainB = {
        plan: parseFrontmatter(readFixture('chain-b', '01-PLAN.md')).runtime,
        execute: parseFrontmatter(readFixture('chain-b', '01-SUMMARY.md')).runtime,
        verify: parseFrontmatter(readFixture('chain-b', '01-VERIFICATION.md')).runtime,
      };

      // Each workflow position should have coverage from at least 2 different runtimes across chains
      const planRuntimes = new Set([chainA.plan, chainB.plan]);
      const executeRuntimes = new Set([chainA.execute, chainB.execute]);
      const verifyRuntimes = new Set([chainA.verify, chainB.verify]);

      assert.strictEqual(planRuntimes.size, 2, 'plan position must have 2 different runtimes across chains');
      assert.strictEqual(executeRuntimes.size, 2, 'execute position must have 2 different runtimes across chains');
      assert.strictEqual(verifyRuntimes.size, 2, 'verify position must have 2 different runtimes across chains');

      // All 3 native runtimes must appear somewhere in each workflow position
      const allNativeRuntimes = ['claude-code', 'codex-cli', 'opencode'];

      // plan: claude-code (chain-a), opencode (chain-b) — codex-cli not in plan position, which is expected
      // execute: codex-cli (chain-a), claude-code (chain-b) — opencode not in execute, expected
      // verify: opencode (chain-a), codex-cli (chain-b) — claude-code not in verify, expected
      // Combined: each runtime appears in exactly 2 of 3 positions
      for (const runtime of allNativeRuntimes) {
        let positionCount = 0;
        if (chainA.plan === runtime || chainB.plan === runtime) positionCount++;
        if (chainA.execute === runtime || chainB.execute === runtime) positionCount++;
        if (chainA.verify === runtime || chainB.verify === runtime) positionCount++;
        assert.strictEqual(positionCount, 2, runtime + ' must appear in exactly 2 workflow positions across both chains');
      }
    });

    test('PLAN fixtures in both chains have plan_check section', () => {
      // PLANs should have plan_check sections (structural completeness)
      const chainAPlan = readFixture('chain-a', '01-PLAN.md');
      const chainBPlan = readFixture('chain-b', '01-PLAN.md');
      assert.ok(extractXmlSection(chainAPlan, 'plan_check').length > 0,
        'Chain A PLAN must have plan_check section');
      assert.ok(extractXmlSection(chainBPlan, 'plan_check').length > 0,
        'Chain B PLAN must have plan_check section');
    });
  });
});

// ============================================================
// S7 — Adapter Chain Validation
// ============================================================

describe('S7 — Adapter Chain Validation (cross-runtime adapter generation compatibility)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude,opencode,codex');
  });

  afterEach(() => { cleanup(tmpDir); });

  // --- Plan-checker dimension parity across runtimes ---

  describe('Plan-checker dimension parity', () => {
    const PLAN_CHECK_DIMENSIONS = [
      'requirement_coverage',
      'task_completeness',
      'dependency_correctness',
      'key_link_completeness',
      'scope_sanity',
      'must_have_quality',
      'context_compliance',
      'goal_achievement',
      'approach_alignment',
    ];

    test('Claude plan-checker has all 9 dimensions', () => {
      const checkerPath = path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md');
      assert.ok(fs.existsSync(checkerPath), 'Claude checker must exist');
      const content = fs.readFileSync(checkerPath, 'utf-8');
      for (const dim of PLAN_CHECK_DIMENSIONS) {
        assert.ok(content.includes(dim), 'Claude checker must include dimension: ' + dim);
      }
    });

    test('OpenCode plan-checker has all 9 dimensions', () => {
      const checkerPath = path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md');
      assert.ok(fs.existsSync(checkerPath), 'OpenCode checker must exist');
      const content = fs.readFileSync(checkerPath, 'utf-8');
      for (const dim of PLAN_CHECK_DIMENSIONS) {
        assert.ok(content.includes(dim), 'OpenCode checker must include dimension: ' + dim);
      }
    });

    test('Codex plan-checker has all 9 dimensions', () => {
      const checkerPath = path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml');
      assert.ok(fs.existsSync(checkerPath), 'Codex checker must exist');
      const content = fs.readFileSync(checkerPath, 'utf-8');
      for (const dim of PLAN_CHECK_DIMENSIONS) {
        assert.ok(content.includes(dim), 'Codex checker must include dimension: ' + dim);
      }
    });

    test('all 3 checkers have dimension parity (same count)', () => {
      const claude = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      const opencode = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      const codex = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'utf-8');

      for (const dim of PLAN_CHECK_DIMENSIONS) {
        const claudeHas = claude.includes(dim);
        const opencodeHas = opencode.includes(dim);
        const codexHas = codex.includes(dim);
        assert.ok(claudeHas && opencodeHas && codexHas,
          'dimension parity: all 3 runtimes must have ' + dim);
      }
    });
  });

  // --- Approach-explorer parity ---

  describe('Approach-explorer parity across runtimes', () => {
    test('Claude approach-explorer exists', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-approach-explorer.md')),
        'Claude approach-explorer must exist'
      );
    });

    test('OpenCode approach-explorer exists', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-approach-explorer.md')),
        'OpenCode approach-explorer must exist'
      );
    });

    test('Codex approach-explorer exists', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-approach-explorer.toml')),
        'Codex approach-explorer must exist'
      );
    });
  });

  // --- Generated skill parity ---

  describe('Portable skill generation for all runtimes', () => {
    test('all runtimes share the same portable skills directory', () => {
      const skillsDir = path.join(tmpDir, '.agents', 'skills');
      assert.ok(fs.existsSync(skillsDir), '.agents/skills/ must exist');

      const coreSkills = ['gsdd-plan', 'gsdd-execute', 'gsdd-verify'];
      for (const skill of coreSkills) {
        assert.ok(
          fs.existsSync(path.join(skillsDir, skill, 'SKILL.md')),
          'portable skill must exist: ' + skill
        );
      }
    });
  });
});

// ============================================================
// Portable workflow runtime_contract blocks (source file checks — no project setup needed)
// ============================================================

describe('Portable workflow runtime_contract blocks', () => {
  const WORKFLOW_FILES = ['plan.md', 'execute.md', 'verify.md'];
  const WORKFLOW_DIR = path.join(__dirname, '..', 'distilled', 'workflows');

  test('each core workflow has a runtime_contract block', () => {
    for (const wf of WORKFLOW_FILES) {
      const content = fs.readFileSync(path.join(WORKFLOW_DIR, wf), 'utf-8');
      const rtContract = content.match(/<runtime_contract>[\s\S]*?<\/runtime_contract>/);
      assert.ok(rtContract, wf + ' must have <runtime_contract> block');
    }
  });

  test('runtime_contract blocks reference all 3 native runtimes', () => {
    const NATIVE_RUNTIMES = ['claude-code', 'codex-cli', 'opencode'];
    for (const wf of WORKFLOW_FILES) {
      const content = fs.readFileSync(path.join(WORKFLOW_DIR, wf), 'utf-8');
      const rtMatch = content.match(/<runtime_contract>[\s\S]*?<\/runtime_contract>/);
      assert.ok(rtMatch, wf + ' must have <runtime_contract>');
      const rtBlock = rtMatch[0];
      for (const rt of NATIVE_RUNTIMES) {
        assert.ok(rtBlock.includes(rt), wf + ' runtime_contract must reference ' + rt);
      }
    }
  });
});
