/**
 * GSDD Scenario-Based Golden-Path Eval Suite
 *
 * Tests artifact-chain contracts across 3 golden paths and 2 native runtime chains.
 * No LLM calls — deterministic verification of workflow interconnections.
 *
 * Suite naming: S1-S5 (following G-suite convention for invariants).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

// --- Helpers ---

/** Extract content between XML-style tags: <tag>...</tag> */
function extractXmlSection(content, tag) {
  const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g');
  const matches = content.match(re);
  return matches ? matches.join('\n') : '';
}

/** Collect all default state path references from content */
function collectPlanningPaths(content) {
  const matches = content.match(/\.work\/[^\s)}>'"`,]+/g);
  return matches ? [...new Set(matches)] : [];
}

/** Check if content references a path pattern (supports wildcards like *) */
function referencesPath(content, pathPattern) {
  if (pathPattern.includes('*')) {
    const escaped = pathPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^\\s)}>\'",]+');
    return new RegExp(escaped).test(content);
  }
  return content.includes(pathPattern);
}

/** Read a generated SKILL.md from .agents/skills/ */
function readSkill(tmpDir, skillName) {
  const skillPath = path.join(tmpDir, '.agents', 'skills', skillName, 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), `Skill file missing: ${skillPath}`);
  return fs.readFileSync(skillPath, 'utf-8');
}

/** Read a file and return its content, or null if it doesn't exist */
function tryRead(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

const PAUSE_BYTE_ONE_INSTRUCTION = 'The file must begin with the opening YAML delimiter (`---`) as byte one; do not put a comment, blank line, or BOM before it.';
const PAUSE_AUTHORITY_NOTICE = '<!-- Historical pause checkpoint, not authority. On conflict, current Git, PLAN.md, SPEC.md, lifecycle artifacts, and current owner instructions outrank this file. -->';

// --- Init helper: runs init with given flags ---

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
// S1 — Greenfield Golden Path
// ============================================================

describe('S1 — Greenfield Golden Path (init → new-project → plan → execute → verify → audit-milestone)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  // --- init → new-project chain ---

  test('new-project load_context references templates installed by init', () => {
    const content = readSkill(tmpDir, 'work-new-project');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'new-project must have <load_context>');
    assert.ok(referencesPath(loadCtx, '.work/templates/spec.md'), 'must reference spec template');
    assert.ok(referencesPath(loadCtx, '.work/templates/roadmap.md'), 'must reference roadmap template');
    assert.ok(referencesPath(loadCtx, '.work/config.json'), 'must reference config.json');
  });

  test('init installs files that new-project references', () => {
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'spec.md')), 'spec template must exist');
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'roadmap.md')), 'roadmap template must exist');
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'config.json')), 'config.json must exist');
  });

  test('new-project researcher delegates reference installed delegate files', () => {
    const content = readSkill(tmpDir, 'work-new-project');
    const researcherDelegates = ['researcher-stack.md', 'researcher-architecture.md', 'researcher-features.md', 'researcher-pitfalls.md'];

    for (const delegate of researcherDelegates) {
      assert.ok(
        content.includes(delegate),
        `new-project must reference delegate ${delegate}`
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.work', 'templates', 'delegates', delegate)),
        `delegate file must be installed: ${delegate}`
      );
    }
  });

  test('new-project synthesizer delegate references installed delegate file', () => {
    const content = readSkill(tmpDir, 'work-new-project');
    assert.ok(content.includes('researcher-synthesizer.md'), 'must reference synthesizer delegate');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.work', 'templates', 'delegates', 'researcher-synthesizer.md')),
      'synthesizer delegate must be installed'
    );
  });

  // --- new-project → plan chain ---

  test('plan load_context references new-project outputs (SPEC.md, ROADMAP.md, research, plans)', () => {
    const content = readSkill(tmpDir, 'work-plan');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'plan must have <load_context>');
    assert.ok(referencesPath(loadCtx, '.work/SPEC.md'), 'plan must reference SPEC.md');
    assert.ok(referencesPath(loadCtx, '.work/ROADMAP.md'), 'plan must reference ROADMAP.md');
    assert.ok(referencesPath(loadCtx, '.work/research/'), 'plan must reference research directory');
    assert.ok(referencesPath(loadCtx, '.work/phases/'), 'plan must reference phases directory');
  });

  // --- plan → execute chain ---

  test('execute load_context references plan outputs with tiered read scope (PLAN.md, SPEC.md, ROADMAP.md)', () => {
    const content = readSkill(tmpDir, 'work-execute');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'execute must have <load_context>');
    assert.ok(referencesPath(loadCtx, 'PLAN.md'), 'execute must reference PLAN.md');
    assert.ok(referencesPath(loadCtx, '.work/SPEC.md'), 'execute must reference SPEC.md');
    assert.ok(referencesPath(loadCtx, '.work/ROADMAP.md'), 'execute must reference ROADMAP.md');
    assert.match(loadCtx, /mandatory_now/, 'execute load_context must identify mandatory_now reads');
    assert.match(loadCtx, /task_scoped/, 'execute load_context must identify task_scoped reads');
    assert.match(loadCtx, /reference_only/, 'execute load_context must identify reference_only reads');
    assert.match(loadCtx, /deferred_or_conditional/, 'execute load_context must identify deferred or conditional reads');
    assert.doesNotMatch(loadCtx, /Read every file below before performing any other actions/i,
      'execute load_context must not restore broad pre-action reread wording');
  });

  // --- execute → verify chain ---

  test('verify load_context references execute outputs (SUMMARY.md, PLAN.md, VERIFICATION.md)', () => {
    const content = readSkill(tmpDir, 'work-verify');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'verify must have <load_context>');
    assert.ok(referencesPath(loadCtx, 'PLAN.md'), 'verify must reference PLAN.md');
    assert.ok(referencesPath(loadCtx, 'SUMMARY.md'), 'verify must reference SUMMARY.md');
    assert.ok(referencesPath(loadCtx, 'ROADMAP.md'), 'verify must reference ROADMAP.md');
    assert.ok(referencesPath(content, 'VERIFICATION.md'), 'verify must reference VERIFICATION.md (for re-verification)');
  });

  test('verify skill preserves git delivery metadata contract', () => {
    const content = readSkill(tmpDir, 'work-verify');
    assert.ok(content.includes('<git_delivery_collection>'), 'verify skill must preserve the git delivery collection step');
    assert.ok(content.includes('<git_delivery_check>'), 'verify skill must preserve the git delivery frontmatter block');
    assert.ok(content.includes('commits_ahead_of_main'), 'verify skill must preserve commits_ahead_of_main in the frontmatter contract');
  });

  test('progress skill preserves unmerged commit visibility contract', () => {
    const content = readSkill(tmpDir, 'work-progress');
    assert.ok(content.includes('<unmerged_commits_check>'), 'progress skill must preserve the unmerged commit check');
    assert.ok(content.includes('Unmerged commits: [N] commit(s) on this branch not yet merged to main'), 'progress skill must preserve the conditional warning text');
  });

  test('progress skill preserves archived-with-ROADMAP routing split', () => {
    const content = readSkill(tmpDir, 'work-progress');
    assert.match(content, /archived-with-`?ROADMAP\.md`?|retained `?ROADMAP\.md`?/i,
      'progress skill must preserve the archived-with-ROADMAP routing language.');
    assert.match(content, /MILESTONES\.md/,
      'progress skill must preserve the shipped-ledger check.');
    assert.match(content, /MILESTONE-AUDIT\.md|archived milestone audit artifact/i,
      'progress skill must preserve the matching archived-audit check.');
    assert.match(content, /\/work-new-milestone/,
      'progress skill must preserve the archived-state route to /work-new-milestone.');
    assert.match(content, /\/work-audit-milestone/,
      'progress skill must preserve the audit-ready route to /work-audit-milestone.');
  });

  // --- verify → audit-milestone chain ---

  test('audit-milestone load_context references verify outputs (VERIFICATION.md, SUMMARY.md)', () => {
    const content = readSkill(tmpDir, 'work-audit-milestone');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'audit-milestone must have <load_context>');
    assert.ok(referencesPath(loadCtx, '.work/ROADMAP.md'), 'audit must reference ROADMAP.md');
    assert.ok(referencesPath(loadCtx, '.work/SPEC.md'), 'audit must reference SPEC.md');
    assert.ok(referencesPath(loadCtx, 'VERIFICATION.md'), 'audit must reference phase VERIFICATION.md files');
    assert.ok(referencesPath(loadCtx, 'SUMMARY.md'), 'audit must reference phase SUMMARY.md files');
  });

  test('audit-milestone integration-checker delegate references installed role contract', () => {
    const content = readSkill(tmpDir, 'work-audit-milestone');
    assert.ok(content.includes('integration-checker'), 'audit must reference integration-checker');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.work', 'templates', 'roles', 'integration-checker.md')),
      'integration-checker role must be installed'
    );
  });

  test('closure workflows preserve the shared evidence-gated closure language after generation', () => {
    const expectations = new Map([
      ['work-verify', ['code', 'test', 'runtime', 'delivery', 'human', 'repo_only', 'delivery_sensitive', 'required_evidence', 'missing_evidence']],
      ['work-audit-milestone', ['code', 'test', 'runtime', 'delivery', 'human', 'repo_only', 'delivery_sensitive', 'required_kinds', 'missing_kinds', 'repo_closeout', 'runtime_validated_closeout', 'delivery_supported_closeout', 'unsupported_claims', 'deferrals', 'contradiction_checks']],
      ['work-complete-milestone', ['repo_only', 'delivery_sensitive', 'missing_kinds', 'required_kinds', 'release_claim_posture', 'release_claim_contract', 'invalid waivers', 'failed contradiction checks']],
    ]);

    for (const [skillName, snippets] of expectations.entries()) {
      const content = readSkill(tmpDir, skillName);
      for (const snippet of snippets) {
        assert.ok(content.includes(snippet), `${skillName} must include ${snippet}`);
      }
    }
  });

  test('generated plan skill amend mode confirms next route after gap-phase generation', () => {
    const content = readSkill(tmpDir, 'work-plan');
    assert.match(content, /node \.work\/bin\/gsdd\.mjs lifecycle-preflight plan amend/,
      'generated plan skill must preflight amend mode before mutating ROADMAP.');
    assert.match(content, /node \.work\/bin\/gsdd\.mjs next --json/,
      'generated plan skill must confirm next-action routing after intentional ROADMAP writes.');
    assert.doesNotMatch(content, /\bgsdd next --json\b/,
      'generated plan skill must use the local helper path, not bare gsdd.');
    assert.match(content, /\/work-plan/,
      'generated plan skill must still route through /work-plan for amend/extend work.');
    assert.match(content, /\/work-audit-milestone/,
      'generated plan skill must preserve re-audit guidance after closure work.');
  });
});

// ============================================================
// S2 — Brownfield Path
// ============================================================

describe('S2 — Brownfield Path (init → map-codebase → new-project brownfield delegates)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  test('new-project has brownfield detection in detect_mode', () => {
    const content = readSkill(tmpDir, 'work-new-project');
    const detectMode = extractXmlSection(content, 'detect_mode');
    assert.ok(detectMode.length > 0, 'must have <detect_mode>');
    assert.ok(/brownfield/i.test(detectMode), 'detect_mode must mention brownfield');
  });

  test('new-project codebase_context references the 4 codebase map files', () => {
    const content = readSkill(tmpDir, 'work-new-project');
    const codebaseCtx = extractXmlSection(content, 'codebase_context');
    assert.ok(codebaseCtx.length > 0, 'must have <codebase_context>');

    const mapFiles = ['STACK.md', 'ARCHITECTURE.md', 'CONVENTIONS.md', 'CONCERNS.md'];
    for (const file of mapFiles) {
      assert.ok(codebaseCtx.includes(file), `codebase_context must reference ${file}`);
    }
  });

  test('map-codebase skill was generated', () => {
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-map-codebase', 'SKILL.md')),
      'map-codebase skill must exist'
    );
  });

  test('map-codebase references the 4 mapper delegates', () => {
    const content = readSkill(tmpDir, 'work-map-codebase');
    const mapperDelegates = ['mapper-tech.md', 'mapper-arch.md', 'mapper-quality.md', 'mapper-concerns.md'];

    for (const delegate of mapperDelegates) {
      assert.ok(content.includes(delegate), `map-codebase must reference ${delegate}`);
    }
  });

  test('map-codebase completion offers quick as the brownfield lane', () => {
    const content = readSkill(tmpDir, 'work-map-codebase');
    assert.ok(content.includes('/work-quick'), 'map-codebase must offer /work-quick as a next step');
    assert.ok(/brownfield/i.test(content), 'map-codebase must describe the quick path as brownfield feature work');
    assert.ok(/full lifecycle setup|project initialization/i.test(content),
      'map-codebase must preserve /work-new-project as the full initializer');
    assert.ok(/intentionally want to widen|only when the user intentionally wants to widen/i.test(content),
      'map-codebase must keep /work-new-project as an explicit widen path.');
    assert.ok(/Safest next change lane/i.test(content), 'map-codebase must synthesize a safest-next-change routing signal');
    assert.ok(/Highest-risk zones/i.test(content), 'map-codebase must synthesize highest-risk zones from the 4 docs');
    assert.ok(/Do NOT create a fifth persistent artifact/i.test(content),
      'map-codebase must keep the routing synthesis ephemeral rather than adding a fifth file');
  });

  test('each mapper delegate exists in .work/templates/delegates/', () => {
    const mapperDelegates = ['mapper-tech.md', 'mapper-arch.md', 'mapper-quality.md', 'mapper-concerns.md'];
    for (const delegate of mapperDelegates) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.work', 'templates', 'delegates', delegate)),
        `mapper delegate must be installed: ${delegate}`
      );
    }
  });

  test('mapper delegates reference mapper role at .work/templates/roles/mapper.md', () => {
    const mapperDelegates = ['mapper-tech.md', 'mapper-arch.md', 'mapper-quality.md', 'mapper-concerns.md'];
    for (const delegate of mapperDelegates) {
      const content = fs.readFileSync(
        path.join(tmpDir, '.work', 'templates', 'delegates', delegate),
        'utf-8'
      );
      assert.ok(
        content.includes('mapper.md'),
        `${delegate} must reference mapper role`
      );
    }
  });

  test('mapper role was installed by init', () => {
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.work', 'templates', 'roles', 'mapper.md')),
      'mapper.md role must be installed'
    );
  });
});

// ============================================================
// S3 — Quick-Task Path
// ============================================================

describe('S3 — Quick-Task Path (init → quick workflow isolation)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  test('quick prerequisites requires .work/ but NOT ROADMAP.md or SPEC.md', () => {
    const content = readSkill(tmpDir, 'work-quick');
    const prereqs = extractXmlSection(content, 'prerequisites');

    assert.ok(prereqs.length > 0, 'must have <prerequisites>');
    assert.ok(prereqs.includes('.work/'), 'prerequisites must require .work/');
    // ROADMAP.md appears only in negation ("is NOT required"), never as a positive prerequisite
    assert.ok(
      !prereqs.includes('ROADMAP.md') || prereqs.includes('NOT required'),
      'prerequisites must not positively require ROADMAP.md'
    );
    // SPEC.md must not appear in prerequisites at all — quick tasks are phase-independent
    assert.ok(
      !prereqs.includes('SPEC.md'),
      'prerequisites must not reference SPEC.md'
    );
  });

  test('quick delegates reference planner, executor, and verifier roles', () => {
    const content = readSkill(tmpDir, 'work-quick');
    assert.ok(content.includes('planner.md'), 'quick must reference planner role');
    assert.ok(content.includes('executor.md'), 'quick must reference executor role');
    assert.ok(content.includes('verifier.md'), 'quick must reference verifier role');
  });

  test('each role referenced by quick was installed by init', () => {
    const roles = ['planner.md', 'executor.md', 'verifier.md'];
    for (const role of roles) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.work', 'templates', 'roles', role)),
        `role must be installed: ${role}`
      );
    }
  });

  test('quick workflow does NOT reference researcher delegates', () => {
    const content = readSkill(tmpDir, 'work-quick');
    const researcherDelegates = ['researcher-stack.md', 'researcher-architecture.md', 'researcher-features.md', 'researcher-pitfalls.md'];
    for (const delegate of researcherDelegates) {
      assert.ok(!content.includes(delegate), `quick must NOT reference ${delegate}`);
    }
  });

  test('quick workflow does NOT reference ROADMAP.md requirement extraction', () => {
    const content = readSkill(tmpDir, 'work-quick');
    // Quick tasks explicitly say "No research phase, no ROADMAP requirements"
    assert.ok(
      content.includes('no ROADMAP requirements') || content.includes('No research phase'),
      'quick must explicitly exclude ROADMAP requirement extraction'
    );
  });

  test('quick can consume codebase-map context when available', () => {
    const content = readSkill(tmpDir, 'work-quick');
    assert.ok(content.includes('ARCHITECTURE.md'), 'quick must reference ARCHITECTURE.md for codebase context');
    assert.ok(content.includes('STACK.md'), 'quick must reference STACK.md for codebase context');
    assert.ok(content.includes('CONVENTIONS.md'), 'quick must reference CONVENTIONS.md for codebase context');
    assert.ok(content.includes('CONCERNS.md'), 'quick must reference CONCERNS.md for codebase context');
    assert.ok(/whichever.*are present|available docs|missing docs/i.test(content),
      'quick must tolerate partial codebase-map state by reading available docs and noting missing ones');
    assert.ok(/safest surfaces to touch/i.test(content), 'quick codebase context must capture safe-to-touch guidance');
    assert.ok(/risky zones to avoid/i.test(content), 'quick codebase context must capture risk boundaries');
    assert.ok(content.includes('$CODEBASE_CONTEXT') || /codebase context/i.test(content),
      'quick planner delegate must receive codebase context');
  });

  test('quick can build an inline brownfield baseline without codebase maps', () => {
    const content = readSkill(tmpDir, 'work-quick');
    assert.match(content, /inline brownfield baseline/i,
      'generated quick skill must build a just-enough inline brownfield baseline when maps are missing.');
    assert.match(content, /README\.md|package\.json|pyproject\.toml|Cargo\.toml/i,
      'generated quick skill must inspect stable repo-root guidance during the inline baseline.');
    assert.match(content, /provisional baseline|calling out unknowns/i,
      'generated quick skill must mark the inline baseline as provisional when uncertainty remains.');
  });

  test('quick preserves split escalation for undefined scope vs too many grey areas', () => {
    const content = readSkill(tmpDir, 'work-quick');
    assert.match(content, /bounded change is still undefined.*\/work-new-project/s,
      'generated quick skill must route undefined bounded changes to /work-new-project.');
    assert.match(content, /3\+ grey areas.*\/work-plan/s,
      'generated quick skill must route defined-but-too-ambiguous tasks to /work-plan.');
    assert.match(content, /intentional widen path|not the default fallback/i,
      'generated quick skill must keep /work-new-project as a widen-only move when concrete brownfield continuity already exists.');
    assert.match(content, /contains.*\/work-new-project.*switch to \/work-new-project/s,
      'generated quick skill must offer a /work-new-project switch option from the preview when the bounded change is still undefined.');
  });

  test('quick can escalate to map-codebase when the inline brownfield baseline is too weak', () => {
    const content = readSkill(tmpDir, 'work-quick');
    assert.match(content, /Orientation gap[\s\S]*\/work-map-codebase/s,
      'generated quick skill must recommend /work-map-codebase when orientation is still too weak after the inline baseline.');
    assert.match(content, /contains.*\/work-map-codebase.*switch to \/work-map-codebase/s,
      'generated quick skill must offer a /work-map-codebase switch from the preview when orientation remains too weak.');
  });

  test('progress treats codebase-only and quick-lane brownfield states as non-phase state instead of empty init state', () => {
    const content = readSkill(tmpDir, 'work-progress');
    assert.match(content, /codebase_only|codebase-only/i,
      'generated progress skill must classify codebase-only brownfield state.');
    assert.match(content, /quick_lane|quick lane/i,
      'generated progress skill must classify quick-lane brownfield state.');
    assert.match(content, /codebase-only brownfield state[\s\S]*\/work-quick/i,
      'generated progress skill must route codebase-only brownfield state toward /work-quick.');
    assert.match(content, /quick-lane brownfield state with incomplete quick work[\s\S]*\/work-quick/i,
      'generated progress skill must route incomplete quick-lane state toward /work-quick.');
  });
});

// ============================================================
// S4 — Native Runtime Chain (Claude + Codex)
// ============================================================

describe('S4 — Native Runtime Chain (Claude + Codex adapter completeness)', () => {
  let tmpDir;

  afterEach(() => { cleanup(tmpDir); });

  describe('Claude chain', () => {
    beforeEach(async () => {
      tmpDir = createTempProject();
      await initProject(tmpDir, '--auto', '--tools', 'claude');
    });

    test('Claude skill work-plan exists at .claude/skills/', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md')),
        'Claude work-plan skill must exist'
      );
    });

    test('Claude work-plan references the portable skill', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md'),
        'utf-8'
      );
      assert.ok(
        content.includes('.agents/skills/work-plan/SKILL.md'),
        'Claude plan skill must reference portable skill'
      );
    });

    test('Claude work-plan references work-plan-checker subagent', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'skills', 'work-plan', 'SKILL.md'),
        'utf-8'
      );
      assert.ok(
        content.includes('work-plan-checker'),
        'Claude plan skill must reference checker subagent'
      );
    });

    test('native checker exists at .claude/agents/work-plan-checker.md', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md')),
        'Claude checker agent must exist'
      );
    });

    test('checker content includes all 9 plan-check dimension names', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'),
        'utf-8'
      );
      const dimensions = [
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
      const retiredDimensions = [
        'scope_boundaries',
        'anti_regression_capture',
        'escalation_integrity',
        'closure_honesty',
        'high_leverage_review',
      ];
      for (const dim of dimensions) {
        assert.ok(content.includes(dim), `checker must include dimension: ${dim}`);
      }
      for (const dim of retiredDimensions) {
        assert.ok(!content.includes(dim), `checker must not include retired dimension: ${dim}`);
      }
    });

    test('native approach-explorer exists at .claude/agents/work-approach-explorer.md', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'work-approach-explorer.md')),
        'Claude approach-explorer agent must exist'
      );
    });

    test('Claude command exists at .claude/commands/work-plan.md', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'work-plan.md')),
        'Claude plan command must exist'
      );
    });

    test('Claude command references the Claude skill', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'commands', 'work-plan.md'),
        'utf-8'
      );
      assert.ok(
        content.includes('.claude/skills/work-plan/SKILL.md'),
        'command must reference Claude skill'
      );
    });

    test('plan-checker delegate has same 9 dimensions as native checker', () => {
      const delegate = fs.readFileSync(
        path.join(tmpDir, '.work', 'templates', 'delegates', 'plan-checker.md'),
        'utf-8'
      );
      const dimensions = [
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
      const retiredDimensions = [
        'scope_boundaries',
        'anti_regression_capture',
        'escalation_integrity',
        'closure_honesty',
        'high_leverage_review',
      ];
      for (const dim of dimensions) {
        assert.ok(delegate.includes(dim), `delegate must include dimension: ${dim}`);
      }
      for (const dim of retiredDimensions) {
        assert.ok(!delegate.includes(dim), `delegate must not include retired dimension: ${dim}`);
      }
    });

    test('OpenCode generated plan agents preserve alignment proof gate wording', async () => {
      const opencodeTmpDir = createTempProject();
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(opencodeTmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      const explorer = fs.readFileSync(
        path.join(opencodeTmpDir, '.opencode', 'agents', 'work-approach-explorer.md'),
        'utf-8'
      );
      const checker = fs.readFileSync(
        path.join(opencodeTmpDir, '.opencode', 'agents', 'work-plan-checker.md'),
        'utf-8'
      );
      cleanup(opencodeTmpDir);

      for (const [label, content] of [['explorer', explorer], ['checker', checker]]) {
        assert.match(content, /alignment_status/i, `OpenCode ${label} must include alignment_status.`);
        assert.match(content, /user_confirmed/i, `OpenCode ${label} must include user_confirmed proof state.`);
        assert.match(content, /approved_skip/i, `OpenCode ${label} must include approved_skip proof state.`);
      }
      assert.match(explorer, /\.work\/config\.json/i,
        'OpenCode explorer must receive project config for workflow.discuss validation.');
      assert.match(explorer, /workflow\.discuss/i,
        'OpenCode explorer must inspect workflow.discuss before writing alignment proof.');
      assert.match(checker, /\.work\/config\.json/i,
        'OpenCode checker must receive project config for workflow.discuss validation.');
      assert.match(checker, /No questions needed[\s\S]*blocker|blocker[\s\S]*No questions needed/i,
        'OpenCode checker must preserve no-questions-needed blocker language.');
    });

    test('OpenCode local runtime templates preserve alignment proof gate wording', async () => {
      const opencodeTmpDir = createTempProject();
      const restoreStdin = setNonInteractiveStdin();
      let role;
      let approach;
      let checker;
      try {
        const gsdd = await loadGsdd(opencodeTmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'opencode');
        role = fs.readFileSync(
          path.join(opencodeTmpDir, '.work', 'templates', 'roles', 'approach-explorer.md'),
          'utf-8'
        );
        approach = fs.readFileSync(
          path.join(opencodeTmpDir, '.work', 'templates', 'approach.md'),
          'utf-8'
        );
        checker = fs.readFileSync(
          path.join(opencodeTmpDir, '.work', 'templates', 'delegates', 'plan-checker.md'),
          'utf-8'
        );
      } finally {
        restoreStdin();
        cleanup(opencodeTmpDir);
      }

      assert.match(role, /workflow\.discuss/i,
        'local approach-explorer role must mention workflow.discuss alignment proof.');
      assert.match(role, /\.work\/config\.json/i,
        'local approach-explorer role must receive project config for workflow.discuss validation.');
      assert.match(role, /alignment_status[\s\S]*user_confirmed|user_confirmed[\s\S]*alignment_status/i,
        'local approach-explorer role must require user_confirmed alignment proof.');
      assert.match(role, /approved_skip/i,
        'local approach-explorer role must allow only explicit approved_skip proof.');
      assert.match(role, /No questions needed[\s\S]*explicitly approved|explicitly approved[\s\S]*No questions needed/i,
        'local approach-explorer role must reject agent-only no-questions-needed skips.');

      assert.match(approach, /## Alignment Proof/i,
        'local approach template must include Alignment Proof section.');
      assert.match(approach, /alignment_status/i,
        'local approach template must include alignment_status field.');
      assert.match(approach, /user_confirmed/i,
        'local approach template must include user_confirmed proof state.');
      assert.match(approach, /approved_skip/i,
        'local approach template must include approved_skip proof state.');

      assert.match(checker, /Alignment proof valid/i,
        'local plan-checker delegate must validate alignment proof.');
      assert.match(checker, /No questions needed[\s\S]*blocker|blocker[\s\S]*No questions needed/i,
        'local plan-checker delegate must block agent-only no-questions-needed claims.');
      assert.match(checker, /\.work\/config\.json/i,
        'local plan-checker delegate must read project config for workflow.discuss validation.');
    });

    test('installed generated Claude surfaces stay render-aligned after init', async () => {
      const freshness = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'runtime-freshness.mjs')).href}?t=${Date.now()}-${Math.random()}`);
      const gsdd = await loadGsdd(tmpDir);
      const report = freshness.evaluateRuntimeFreshness({
        cwd: tmpDir,
        workflows: gsdd.createCliContext(tmpDir).workflows,
      });

      assert.strictEqual(report.issueCount, 0, 'freshly generated Claude surfaces must match current render output');
    });
  });

  describe('Codex chain', () => {
    beforeEach(async () => {
      tmpDir = createTempProject();
      await initProject(tmpDir, '--auto', '--tools', 'codex');
    });

    test('Codex checker exists at .codex/agents/work-plan-checker.toml', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml')),
        'Codex checker TOML must exist'
      );
    });

    test('Codex checker contains all 9 dimension names', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'),
        'utf-8'
      );
      const dimensions = [
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
      const retiredDimensions = [
        'scope_boundaries',
        'anti_regression_capture',
        'escalation_integrity',
        'closure_honesty',
        'high_leverage_review',
      ];
      for (const dim of dimensions) {
        assert.ok(content.includes(dim), `Codex checker must include dimension: ${dim}`);
      }
      for (const dim of retiredDimensions) {
        assert.ok(!content.includes(dim), `Codex checker must not include retired dimension: ${dim}`);
      }
    });

    test('native approach-explorer exists at .codex/agents/work-approach-explorer.toml', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-approach-explorer.toml')),
        'Codex approach-explorer TOML must exist'
      );
    });

    test('Codex checker has sandbox_mode = "read-only"', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'),
        'utf-8'
      );
      assert.ok(
        content.includes('sandbox_mode = "read-only"'),
        'Codex checker must have read-only sandbox'
      );
    });

    test('installed generated Codex surfaces stay render-aligned after init', async () => {
      const freshness = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'runtime-freshness.mjs')).href}?t=${Date.now()}-${Math.random()}`);
      const gsdd = await loadGsdd(tmpDir);
      const report = freshness.evaluateRuntimeFreshness({
        cwd: tmpDir,
        workflows: gsdd.createCliContext(tmpDir).workflows,
      });

      assert.strictEqual(report.issueCount, 0, 'freshly generated Codex surfaces must match current render output');
    });
  });

  describe('S4 — kind structural contract', () => {
    let kindTmpDir;

    beforeEach(async () => {
      kindTmpDir = createTempProject();
      await initProject(kindTmpDir, '--auto', '--tools', 'claude,opencode,codex,agents');
    });

    afterEach(() => { cleanup(kindTmpDir); });

    test('claude (native_capable) generated agent files in .claude/agents/', () => {
      assert.ok(
        fs.existsSync(path.join(kindTmpDir, '.claude', 'agents', 'work-plan-checker.md')),
        'claude must generate at least one agent file'
      );
    });

    test('opencode (native_capable) generated agent files in .opencode/agents/', () => {
      assert.ok(
        fs.existsSync(path.join(kindTmpDir, '.opencode', 'agents', 'work-plan-checker.md')),
        'opencode must generate at least one agent file'
      );
    });

    test('codex (native_capable) generated agent files in .codex/agents/', () => {
      assert.ok(
        fs.existsSync(path.join(kindTmpDir, '.codex', 'agents', 'work-plan-checker.toml')),
        'codex must generate at least one agent file'
      );
    });

    test('agents (governance_only) wrote AGENTS.md but no agent subdirectory', () => {
      // The agents adapter is governance_only — it writes AGENTS.md but no agent dirs
      assert.ok(
        fs.existsSync(path.join(kindTmpDir, 'AGENTS.md')),
        'governance_only agents adapter must write AGENTS.md'
      );
      assert.ok(
        !fs.existsSync(path.join(kindTmpDir, '.agents', 'agents')),
        'governance_only agents adapter must not create an agent subdir'
      );
    });
  });
});

describe('S18 — Deterministic mechanics workflow surface', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  test('affected portable skills route checkpoint cleanup through the repo-local helper launcher', () => {
    const expectations = new Map([
      ['work-pause', ['node .work/bin/gsdd.mjs file-op delete .work/.continue-here.bak --missing ok']],
      ['work-resume', ['node .work/bin/gsdd.mjs file-op copy .work/.continue-here.md .work/.continue-here.bak', 'node .work/bin/gsdd.mjs file-op delete .work/.continue-here.md']],
      ['work-plan', ['node .work/bin/gsdd.mjs file-op delete .work/.continue-here.bak --missing ok']],
      ['work-execute', ['node .work/bin/gsdd.mjs file-op delete .work/.continue-here.bak --missing ok']],
      ['work-verify', ['node .work/bin/gsdd.mjs file-op delete .work/.continue-here.bak --missing ok']],
      ['work-quick', ['node .work/bin/gsdd.mjs file-op delete .work/.continue-here.bak --missing ok']],
    ]);

    for (const [skillName, snippets] of expectations.entries()) {
      const content = readSkill(tmpDir, skillName);
      for (const snippet of snippets) {
        assert.ok(content.includes(snippet), `${skillName} must include ${snippet}`);
      }
    }
  });

  test('resume portable skill no longer carries manual checkpoint copy/delete prose', () => {
    const content = readSkill(tmpDir, 'work-resume');
    assert.doesNotMatch(content, /(^|\n)\s*\d+\.\s*Copy `?\.work\/\.continue-here\.md`? to `?\.work\/\.continue-here\.bak`?/i,
      'work-resume must not keep the old manual checkpoint copy prose.');
    assert.doesNotMatch(content, /(^|\n)\s*\d+\.\s*Delete `?\.work\/\.continue-here\.md`?/i,
      'work-resume must not keep the old manual checkpoint delete prose.');
  });

  test('transition-sensitive portable skills route lifecycle eligibility through the repo-local helper launcher', () => {
    const expectations = new Map([
      ['work-plan', [
        'node .work/bin/gsdd.mjs lifecycle-preflight plan {phase_num}',
        'node .work/bin/gsdd.mjs lifecycle-preflight plan brownfield-change',
        'Do not run phase preflight before target classification',
      ]],
      ['work-execute', ['node .work/bin/gsdd.mjs lifecycle-preflight execute {phase_num} --expects-mutation phase-status', 'node .work/bin/gsdd.mjs phase-status']],
      ['work-verify', ['node .work/bin/gsdd.mjs lifecycle-preflight verify {phase_identity} --plan phases/{phase_dir}/{plan_id}-PLAN.md --expects-mutation phase-status', 'node .work/bin/gsdd.mjs phase-status']],
      ['work-audit-milestone', ['node .work/bin/gsdd.mjs lifecycle-preflight audit-milestone']],
      ['work-complete-milestone', ['node .work/bin/gsdd.mjs lifecycle-preflight complete-milestone']],
      ['work-new-milestone', ['node .work/bin/gsdd.mjs lifecycle-preflight new-milestone']],
      ['work-resume', ['node .work/bin/gsdd.mjs lifecycle-preflight resume']],
    ]);

    for (const [skillName, snippets] of expectations.entries()) {
      const content = readSkill(tmpDir, skillName);
      for (const snippet of snippets) {
        assert.ok(content.includes(snippet), `${skillName} must include ${snippet}`);
      }
    }
  });

  test('generated portable skills do not contain stale helper paths or bare lifecycle-preflight', () => {
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    for (const entry of fs.readdirSync(skillsDir).filter(name => name.startsWith('work-'))) {
      const content = readSkill(tmpDir, entry);
      assert.doesNotMatch(content, /\.agents[\\/]bin/i,
        `${entry} must not reference stale .agents/bin helper paths.`);
      assert.doesNotMatch(content, /(?<!node \.work\/bin\/gsdd\.mjs\s)gsdd\s+lifecycle-preflight\b/i,
        `${entry} must not call bare gsdd lifecycle-preflight.`);
    }
  });

  test('progress portable skill preserves the read-only lifecycle boundary', () => {
    const content = readSkill(tmpDir, 'work-progress');
    assert.ok(content.includes('progress` stays read-only.') || content.includes('progress stays read-only.'),
      'work-progress must preserve the read-only lifecycle boundary.');
    assert.ok(content.includes('Do not call `node .work/bin/gsdd.mjs phase-status` here.'),
      'work-progress must forbid node .work/bin/gsdd.mjs phase-status in the read-only reporter.');
    assert.ok(content.includes('downstream mutating workflow must rerun its own `node .work/bin/gsdd.mjs lifecycle-preflight ...` gate before acting.'),
      'work-progress must route downstream lifecycle transitions back through the repo-local helper launcher.');
  });

  test('generated resume/progress skills preserve the non-looping generic-checkpoint rule', () => {
    const resume = readSkill(tmpDir, 'work-resume');
    const progress = readSkill(tmpDir, 'work-progress');

    assert.match(resume, /generic.*next_action.*user decide/i,
      'work-resume must keep generic checkpoints user-routed through next_action.');
    assert.match(resume, /informational context rather than an automatic blocker/i,
      'work-resume must explain that generic checkpoints stay informational for downstream progress routing.');
    assert.match(progress, /`?generic`? checkpoints? (?:are|stay) informational-only/i,
      'work-progress must keep generic checkpoints informational-only.');
    assert.match(progress, /keep evaluating Branch B-F/i,
      'work-progress must continue routing to the real next action after showing an informational generic checkpoint.');
    assert.match(progress, /`?phase`? and `?quick`?.*blocking resume-owned surfaces/i,
      'work-progress must preserve blocking routing for phase and quick checkpoints.');
  });

  test('generated resume/progress skills preserve the brownfield continuity anchor and mismatch split', () => {
    const resume = readSkill(tmpDir, 'work-resume');
    const progress = readSkill(tmpDir, 'work-progress');

    assert.match(progress, /\.work\/brownfield-change\/CHANGE\.md/,
      'work-progress must preserve the active brownfield change path.');
    assert.match(progress, /active_brownfield_change/i,
      'work-progress must preserve the active_brownfield_change non-phase state.');
    assert.match(progress, /Run \/work-resume to restore the active brownfield change context/i,
      'work-progress must route the active brownfield change toward /work-resume.');
    assert.match(progress, /Brownfield continuity warning/i,
      'work-progress must preserve brownfield artifact/worktree warnings.');
    assert.match(progress, /strict-match rule/i,
      'work-progress must preserve the strict-match checkpoint precedence rule.');
    assert.match(progress, /branch alignment[\s\S]*scope alignment[\s\S]*still-active execution state/i,
      'work-progress must preserve all three strict-match checks.');

    assert.match(resume, /canonical operational continuity anchor/i,
      'work-resume must preserve CHANGE.md as the operational anchor.');
    assert.match(resume, /Do not flatten `CHANGE\.md` and `HANDOFF\.md` into co-equal operational sources/i,
      'work-resume must preserve the one-anchor, one-judgment-surface split.');
    assert.match(resume, /material brownfield artifact\/worktree mismatch|artifact\/worktree mismatch is material/i,
      'work-resume must preserve brownfield artifact/worktree mismatch handling.');
    assert.match(resume, /require acknowledgement before continuing the brownfield change/i,
      'work-resume must preserve the brownfield mismatch acknowledgement gate.');
    assert.match(resume, /strict-match rule/i,
      'work-resume must preserve the strict-match checkpoint precedence rule.');
    assert.match(resume, /branch alignment[\s\S]*scope alignment[\s\S]*still-active execution state/i,
      'work-resume must preserve all three strict-match checks.');
  });

  test('generated new-project skill keeps concrete brownfield continuity as a widen-only path', () => {
    const content = readSkill(tmpDir, 'work-new-project');
    assert.match(content, /Concrete brownfield continuity already exists/i,
      'work-new-project must recognize an existing concrete brownfield continuity state.');
    assert.match(content, /explicit widen path|intentionally want to widen/i,
      'work-new-project must keep /work-new-project as a widen-only move when CHANGE.md already exists.');
    assert.match(content, /CHANGE\.md[\s\S]*HANDOFF\.md[\s\S]*VERIFICATION\.md/i,
      'work-new-project must preserve the full brownfield artifact family during widening.');
  });

  test('generated new-milestone skill preserves brownfield widening inputs and context reuse', () => {
    const content = readSkill(tmpDir, 'work-new-milestone');
    assert.match(content, /brownfield_widening_inputs/i,
      'work-new-milestone must preserve the explicit brownfield widening section.');
    assert.match(content, /CHANGE\.md[\s\S]*HANDOFF\.md[\s\S]*VERIFICATION\.md/i,
      'work-new-milestone must preserve the full brownfield widening input set.');
    assert.match(content, /explicit widen request/i,
      'work-new-milestone must preserve explicit widen-request wording.');
    assert.match(content, /Do not force the user to rediscover this context/i,
      'work-new-milestone must preserve the no-rediscovery rule during widening.');
  });
});

// ============================================================
// S5 — Config-to-Content Propagation
// ============================================================

describe('S5 — Config-to-Content Propagation', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  test('auto config has workflow.research = true and new-project contains research section', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.work', 'config.json'), 'utf-8'));
    assert.strictEqual(config.workflow.research, true, 'default config must have workflow.research = true');

    const content = readSkill(tmpDir, 'work-new-project');
    const research = extractXmlSection(content, 'research');
    assert.ok(research.length > 0, 'new-project must contain <research> section');
  });

  test('auto config has workflow.planCheck = true and plan SKILL.md contains plan-check orchestration', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.work', 'config.json'), 'utf-8'));
    assert.strictEqual(config.workflow.planCheck, true, 'default config must have workflow.planCheck = true');

    const content = readSkill(tmpDir, 'work-plan');
    // The exact XML section tag used in plan.md — broad OR terms risk matching incidental strings
    assert.ok(
      content.includes('plan_check_orchestration'),
      'plan skill must contain the plan_check_orchestration section from the plan workflow source'
    );
  });

  test('auto config has gitProtocol with all 3 fields and generated execute contracts keep it authoritative', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.work', 'config.json'), 'utf-8'));
    assert.ok(config.gitProtocol, 'config must have gitProtocol');
    assert.ok(config.gitProtocol.branch, 'gitProtocol must have branch');
    assert.ok(config.gitProtocol.commit, 'gitProtocol must have commit');
    assert.ok(config.gitProtocol.pr, 'gitProtocol must have pr');

    const content = readSkill(tmpDir, 'work-execute');
    // 'gitProtocol' is the exact config key referenced in execute.md — not just any 'git' string
    assert.ok(
      content.includes('gitProtocol'),
      'execute skill must reference gitProtocol by name, not just any git string'
    );
    assert.match(content, /gitProtocol.*authoritative/i,
      'generated execute skill must treat gitProtocol as authoritative delivery guidance.');
    assert.match(content, /No default push or PR/i,
      'generated execute skill must forbid default push or PR creation.');
    assert.doesNotMatch(content, /gitProtocol.*advisory only/i,
      'generated execute skill must not retain the advisory-only downgrade.');
    const executor = fs.readFileSync(path.join(tmpDir, '.work', 'templates', 'roles', 'executor.md'), 'utf-8');
    assert.match(executor, /git-identity check/, 'generated executor role must include the commit-boundary identity check.');
    assert.match(executor, /No default push or PR/i, 'generated executor role must forbid default external delivery.');
  });

  test('auto config has modelProfile = balanced', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.work', 'config.json'), 'utf-8'));
    assert.strictEqual(config.modelProfile, 'balanced', 'default modelProfile must be balanced');
  });

  test('Claude checker agent has model field derived from balanced profile', () => {
    const checker = fs.readFileSync(
      path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'),
      'utf-8'
    );
    // balanced profile maps to sonnet for Claude
    assert.ok(
      checker.includes('model: sonnet'),
      'checker must have model: sonnet for balanced profile'
    );
  });
});

describe('S6 — Branch Safety Propagation', () => {
  let tmpDir;
  const pr67Title = 'chore: simplify agents.block.md to wildcard pointer + update G18 guards';
  const pr68Body = 'This branch also initializes the v1.0.0 Public Launch milestone locally';
  const pr91Title = 'feat: tighten search contract (Phase 8 - DISC-01 + SAFE-01)';

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  test('execute skill contains wrong-branch safety check', () => {
    const content = readSkill(tmpDir, 'work-execute');
    assert.match(content, /main.*master|master.*main/i,
      'generated execute skill must name main and master in the wrong-branch check.');
    assert.match(content, /STOP|hard-warn/i,
      'generated execute skill must preserve the stop/hard-warn branch safety wording.');
  });

  test('execute skill preserves naming-hygiene guidance for the recorded PR incidents', () => {
    const content = readSkill(tmpDir, 'work-execute');
    assert.match(content, /requirement/i,
      'generated execute skill must preserve requirement-ID naming hygiene.');
    assert.match(content, /milestone/i,
      'generated execute skill must preserve milestone-label naming hygiene.');
    assert.match(pr67Title, /\bG18\b/,
      'PR #67 regression fixture must preserve the leaked internal tracker token.');
    assert.match(pr68Body, /Public Launch milestone locally/i,
      'PR #68 regression fixture must preserve the leaked local milestone phrasing.');
    assert.match(pr91Title, /Phase 8 - DISC-01 \+ SAFE-01/,
      'PR #91 regression fixture must preserve the leaked phase and requirement labels.');
  });
});

describe('S7 — Provenance Propagation', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = createTempProject();
    await initProject(tmpDir, '--auto', '--tools', 'claude');
  });

  afterEach(() => { cleanup(tmpDir); });

  test('pause skill preserves draft-first checkpointing and three-question cap', () => {
    const content = readSkill(tmpDir, 'work-pause');
    assert.match(content, /Build a draft checkpoint from artifact truth/i,
      'generated pause skill must preserve draft-first checkpointing.');
    assert.match(content, /Ask at most 3 high-signal questions total/i,
      'generated pause skill must preserve the three-question cap.');
  });

  test('generated pause skill places the authority notice after byte-one YAML frontmatter', () => {
    const content = readSkill(tmpDir, 'work-pause');
    assert.ok(content.includes(PAUSE_BYTE_ONE_INSTRUCTION),
      'generated pause skill must state the byte-one YAML contract.');

    const templateStart = content.indexOf('```markdown\n---\nworkflow:');
    assert.notStrictEqual(templateStart, -1, 'generated pause skill must show the checkpoint template.');
    const closingDelimiter = content.indexOf('\n---\n', templateStart + 14);
    const notice = content.indexOf(PAUSE_AUTHORITY_NOTICE, templateStart);
    const firstSection = content.indexOf('<current_state>', templateStart);

    assert.ok(closingDelimiter > templateStart, 'checkpoint template must close frontmatter.');
    assert.ok(notice > closingDelimiter, 'authority notice must follow the closing YAML delimiter.');
    assert.ok(firstSection > notice, 'authority notice must precede the checkpoint sections.');
  });

  test('resume skill preserves provenance truth split and mismatch acknowledgement', () => {
    const content = readSkill(tmpDir, 'work-resume');
    assert.match(content, /checkpoint narrative truth/i,
      'generated resume skill must preserve checkpoint narrative truth.');
    assert.match(content, /planning\/artifact truth/i,
      'generated resume skill must preserve planning/artifact truth.');
    assert.match(content, /git\/worktree truth/i,
      'generated resume skill must preserve git/worktree truth.');
    assert.match(content, /continue despite mismatch/i,
      'generated resume skill must preserve explicit mismatch acknowledgement examples.');
  });

  test('verify and audit skills preserve fail-closed terminal artifact gates', () => {
    const verify = readSkill(tmpDir, 'work-verify');
    const audit = readSkill(tmpDir, 'work-audit-milestone');
    assert.match(verify, /Before any ROADMAP closure.*SUMMARY\.md.*still exists on disk/i,
      'generated verify skill must preserve the SUMMARY.md existence gate.');
    assert.match(audit, /results shown inline anyway/i,
      'generated audit skill must preserve the no-inline-fallback write gate wording.');
  });
});
