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

/** Collect all .planning/ path references from content */
function collectPlanningPaths(content) {
  const matches = content.match(/\.planning\/[^\s)}>'"`,]+/g);
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
    const content = readSkill(tmpDir, 'gsdd-new-project');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'new-project must have <load_context>');
    assert.ok(referencesPath(loadCtx, '.planning/templates/spec.md'), 'must reference spec template');
    assert.ok(referencesPath(loadCtx, '.planning/templates/roadmap.md'), 'must reference roadmap template');
    assert.ok(referencesPath(loadCtx, '.planning/config.json'), 'must reference config.json');
  });

  test('init installs files that new-project references', () => {
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'spec.md')), 'spec template must exist');
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roadmap.md')), 'roadmap template must exist');
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'config.json')), 'config.json must exist');
  });

  test('new-project researcher delegates reference installed delegate files', () => {
    const content = readSkill(tmpDir, 'gsdd-new-project');
    const researcherDelegates = ['researcher-stack.md', 'researcher-architecture.md', 'researcher-features.md', 'researcher-pitfalls.md'];

    for (const delegate of researcherDelegates) {
      assert.ok(
        content.includes(delegate),
        `new-project must reference delegate ${delegate}`
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'delegates', delegate)),
        `delegate file must be installed: ${delegate}`
      );
    }
  });

  test('new-project synthesizer delegate references installed delegate file', () => {
    const content = readSkill(tmpDir, 'gsdd-new-project');
    assert.ok(content.includes('researcher-synthesizer.md'), 'must reference synthesizer delegate');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'delegates', 'researcher-synthesizer.md')),
      'synthesizer delegate must be installed'
    );
  });

  // --- new-project → plan chain ---

  test('plan load_context references new-project outputs (SPEC.md, ROADMAP.md, research, plans)', () => {
    const content = readSkill(tmpDir, 'gsdd-plan');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'plan must have <load_context>');
    assert.ok(referencesPath(loadCtx, '.planning/SPEC.md'), 'plan must reference SPEC.md');
    assert.ok(referencesPath(loadCtx, '.planning/ROADMAP.md'), 'plan must reference ROADMAP.md');
    assert.ok(referencesPath(loadCtx, '.planning/research/'), 'plan must reference research directory');
    assert.ok(referencesPath(loadCtx, '.planning/phases/'), 'plan must reference phases directory');
  });

  // --- plan → execute chain ---

  test('execute load_context references plan outputs (PLAN.md, SPEC.md, ROADMAP.md)', () => {
    const content = readSkill(tmpDir, 'gsdd-execute');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'execute must have <load_context>');
    assert.ok(referencesPath(loadCtx, 'PLAN.md'), 'execute must reference PLAN.md');
    assert.ok(referencesPath(loadCtx, '.planning/SPEC.md'), 'execute must reference SPEC.md');
    assert.ok(referencesPath(loadCtx, '.planning/ROADMAP.md'), 'execute must reference ROADMAP.md');
  });

  // --- execute → verify chain ---

  test('verify load_context references execute outputs (SUMMARY.md, PLAN.md, VERIFICATION.md)', () => {
    const content = readSkill(tmpDir, 'gsdd-verify');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'verify must have <load_context>');
    assert.ok(referencesPath(loadCtx, 'PLAN.md'), 'verify must reference PLAN.md');
    assert.ok(referencesPath(loadCtx, 'SUMMARY.md'), 'verify must reference SUMMARY.md');
    assert.ok(referencesPath(loadCtx, 'ROADMAP.md'), 'verify must reference ROADMAP.md');
    assert.ok(referencesPath(content, 'VERIFICATION.md'), 'verify must reference VERIFICATION.md (for re-verification)');
  });

  test('verify skill preserves git delivery metadata contract', () => {
    const content = readSkill(tmpDir, 'gsdd-verify');
    assert.ok(content.includes('<git_delivery_collection>'), 'verify skill must preserve the git delivery collection step');
    assert.ok(content.includes('<git_delivery_check>'), 'verify skill must preserve the git delivery frontmatter block');
    assert.ok(content.includes('commits_ahead_of_main'), 'verify skill must preserve commits_ahead_of_main in the frontmatter contract');
  });

  test('progress skill preserves unmerged commit visibility contract', () => {
    const content = readSkill(tmpDir, 'gsdd-progress');
    assert.ok(content.includes('<unmerged_commits_check>'), 'progress skill must preserve the unmerged commit check');
    assert.ok(content.includes('Unmerged commits: [N] commit(s) on this branch not yet merged to main'), 'progress skill must preserve the conditional warning text');
  });

  test('progress skill preserves archived-with-ROADMAP routing split', () => {
    const content = readSkill(tmpDir, 'gsdd-progress');
    assert.match(content, /archived-with-`?ROADMAP\.md`?|retained `?ROADMAP\.md`?/i,
      'progress skill must preserve the archived-with-ROADMAP routing language.');
    assert.match(content, /MILESTONES\.md/,
      'progress skill must preserve the shipped-ledger check.');
    assert.match(content, /MILESTONE-AUDIT\.md|archived milestone audit artifact/i,
      'progress skill must preserve the matching archived-audit check.');
    assert.match(content, /\/gsdd-new-milestone/,
      'progress skill must preserve the archived-state route to /gsdd-new-milestone.');
    assert.match(content, /\/gsdd-audit-milestone/,
      'progress skill must preserve the audit-ready route to /gsdd-audit-milestone.');
  });

  // --- verify → audit-milestone chain ---

  test('audit-milestone load_context references verify outputs (VERIFICATION.md, SUMMARY.md)', () => {
    const content = readSkill(tmpDir, 'gsdd-audit-milestone');
    const loadCtx = extractXmlSection(content, 'load_context');

    assert.ok(loadCtx.length > 0, 'audit-milestone must have <load_context>');
    assert.ok(referencesPath(loadCtx, '.planning/ROADMAP.md'), 'audit must reference ROADMAP.md');
    assert.ok(referencesPath(loadCtx, '.planning/SPEC.md'), 'audit must reference SPEC.md');
    assert.ok(referencesPath(loadCtx, 'VERIFICATION.md'), 'audit must reference phase VERIFICATION.md files');
    assert.ok(referencesPath(loadCtx, 'SUMMARY.md'), 'audit must reference phase SUMMARY.md files');
  });

  test('audit-milestone integration-checker delegate references installed role contract', () => {
    const content = readSkill(tmpDir, 'gsdd-audit-milestone');
    assert.ok(content.includes('integration-checker'), 'audit must reference integration-checker');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'integration-checker.md')),
      'integration-checker role must be installed'
    );
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
    const content = readSkill(tmpDir, 'gsdd-new-project');
    const detectMode = extractXmlSection(content, 'detect_mode');
    assert.ok(detectMode.length > 0, 'must have <detect_mode>');
    assert.ok(/brownfield/i.test(detectMode), 'detect_mode must mention brownfield');
  });

  test('new-project codebase_context references the 4 codebase map files', () => {
    const content = readSkill(tmpDir, 'gsdd-new-project');
    const codebaseCtx = extractXmlSection(content, 'codebase_context');
    assert.ok(codebaseCtx.length > 0, 'must have <codebase_context>');

    const mapFiles = ['STACK.md', 'ARCHITECTURE.md', 'CONVENTIONS.md', 'CONCERNS.md'];
    for (const file of mapFiles) {
      assert.ok(codebaseCtx.includes(file), `codebase_context must reference ${file}`);
    }
  });

  test('map-codebase skill was generated', () => {
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-map-codebase', 'SKILL.md')),
      'map-codebase skill must exist'
    );
  });

  test('map-codebase references the 4 mapper delegates', () => {
    const content = readSkill(tmpDir, 'gsdd-map-codebase');
    const mapperDelegates = ['mapper-tech.md', 'mapper-arch.md', 'mapper-quality.md', 'mapper-concerns.md'];

    for (const delegate of mapperDelegates) {
      assert.ok(content.includes(delegate), `map-codebase must reference ${delegate}`);
    }
  });

  test('map-codebase completion offers quick as the brownfield lane', () => {
    const content = readSkill(tmpDir, 'gsdd-map-codebase');
    assert.ok(content.includes('/gsdd-quick'), 'map-codebase must offer /gsdd-quick as a next step');
    assert.ok(/brownfield/i.test(content), 'map-codebase must describe the quick path as brownfield feature work');
    assert.ok(/full lifecycle setup|project initialization/i.test(content),
      'map-codebase must preserve /gsdd-new-project as the full initializer');
    assert.ok(/Safest next change lane/i.test(content), 'map-codebase must synthesize a safest-next-change routing signal');
    assert.ok(/Highest-risk zones/i.test(content), 'map-codebase must synthesize highest-risk zones from the 4 docs');
    assert.ok(/Do NOT create a fifth persistent artifact/i.test(content),
      'map-codebase must keep the routing synthesis ephemeral rather than adding a fifth file');
  });

  test('each mapper delegate exists in .planning/templates/delegates/', () => {
    const mapperDelegates = ['mapper-tech.md', 'mapper-arch.md', 'mapper-quality.md', 'mapper-concerns.md'];
    for (const delegate of mapperDelegates) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'delegates', delegate)),
        `mapper delegate must be installed: ${delegate}`
      );
    }
  });

  test('mapper delegates reference mapper role at .planning/templates/roles/mapper.md', () => {
    const mapperDelegates = ['mapper-tech.md', 'mapper-arch.md', 'mapper-quality.md', 'mapper-concerns.md'];
    for (const delegate of mapperDelegates) {
      const content = fs.readFileSync(
        path.join(tmpDir, '.planning', 'templates', 'delegates', delegate),
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
      fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'mapper.md')),
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

  test('quick prerequisites requires .planning/ but NOT ROADMAP.md or SPEC.md', () => {
    const content = readSkill(tmpDir, 'gsdd-quick');
    const prereqs = extractXmlSection(content, 'prerequisites');

    assert.ok(prereqs.length > 0, 'must have <prerequisites>');
    assert.ok(prereqs.includes('.planning/'), 'prerequisites must require .planning/');
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
    const content = readSkill(tmpDir, 'gsdd-quick');
    assert.ok(content.includes('planner.md'), 'quick must reference planner role');
    assert.ok(content.includes('executor.md'), 'quick must reference executor role');
    assert.ok(content.includes('verifier.md'), 'quick must reference verifier role');
  });

  test('each role referenced by quick was installed by init', () => {
    const roles = ['planner.md', 'executor.md', 'verifier.md'];
    for (const role of roles) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', role)),
        `role must be installed: ${role}`
      );
    }
  });

  test('quick workflow does NOT reference researcher delegates', () => {
    const content = readSkill(tmpDir, 'gsdd-quick');
    const researcherDelegates = ['researcher-stack.md', 'researcher-architecture.md', 'researcher-features.md', 'researcher-pitfalls.md'];
    for (const delegate of researcherDelegates) {
      assert.ok(!content.includes(delegate), `quick must NOT reference ${delegate}`);
    }
  });

  test('quick workflow does NOT reference ROADMAP.md requirement extraction', () => {
    const content = readSkill(tmpDir, 'gsdd-quick');
    // Quick tasks explicitly say "No research phase, no ROADMAP requirements"
    assert.ok(
      content.includes('no ROADMAP requirements') || content.includes('No research phase'),
      'quick must explicitly exclude ROADMAP requirement extraction'
    );
  });

  test('quick can consume codebase-map context when available', () => {
    const content = readSkill(tmpDir, 'gsdd-quick');
    assert.ok(content.includes('ARCHITECTURE.md'), 'quick must reference ARCHITECTURE.md for codebase context');
    assert.ok(content.includes('STACK.md'), 'quick must reference STACK.md for codebase context');
    assert.ok(content.includes('CONVENTIONS.md'), 'quick must reference CONVENTIONS.md for codebase context');
    assert.ok(content.includes('CONCERNS.md'), 'quick must reference CONCERNS.md for codebase context');
    assert.ok(/safest surfaces to touch/i.test(content), 'quick codebase context must capture safe-to-touch guidance');
    assert.ok(/risky zones to avoid/i.test(content), 'quick codebase context must capture risk boundaries');
    assert.ok(content.includes('$CODEBASE_CONTEXT') || /codebase context/i.test(content),
      'quick planner delegate must receive codebase context');
  });

  test('quick preserves split escalation for undefined scope vs too many grey areas', () => {
    const content = readSkill(tmpDir, 'gsdd-quick');
    assert.match(content, /bounded change is still undefined.*\/gsdd-new-project/s,
      'generated quick skill must route undefined bounded changes to /gsdd-new-project.');
    assert.match(content, /3\+ grey areas.*\/gsdd-plan/s,
      'generated quick skill must route defined-but-too-ambiguous tasks to /gsdd-plan.');
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

    test('Claude skill gsdd-plan exists at .claude/skills/', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md')),
        'Claude gsdd-plan skill must exist'
      );
    });

    test('Claude gsdd-plan references the portable skill', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'),
        'utf-8'
      );
      assert.ok(
        content.includes('.agents/skills/gsdd-plan/SKILL.md'),
        'Claude plan skill must reference portable skill'
      );
    });

    test('Claude gsdd-plan references gsdd-plan-checker subagent', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'),
        'utf-8'
      );
      assert.ok(
        content.includes('gsdd-plan-checker'),
        'Claude plan skill must reference checker subagent'
      );
    });

    test('native checker exists at .claude/agents/gsdd-plan-checker.md', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md')),
        'Claude checker agent must exist'
      );
    });

    test('checker content includes all 9 plan-check dimension names', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'),
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
      for (const dim of dimensions) {
        assert.ok(content.includes(dim), `checker must include dimension: ${dim}`);
      }
    });

    test('native approach-explorer exists at .claude/agents/gsdd-approach-explorer.md', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-approach-explorer.md')),
        'Claude approach-explorer agent must exist'
      );
    });

    test('Claude command exists at .claude/commands/gsdd-plan.md', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md')),
        'Claude plan command must exist'
      );
    });

    test('Claude command references the Claude skill', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md'),
        'utf-8'
      );
      assert.ok(
        content.includes('.claude/skills/gsdd-plan/SKILL.md'),
        'command must reference Claude skill'
      );
    });

    test('plan-checker delegate has same 9 dimensions as native checker', () => {
      const delegate = fs.readFileSync(
        path.join(tmpDir, '.planning', 'templates', 'delegates', 'plan-checker.md'),
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
      for (const dim of dimensions) {
        assert.ok(delegate.includes(dim), `delegate must include dimension: ${dim}`);
      }
    });
  });

  describe('Codex chain', () => {
    beforeEach(async () => {
      tmpDir = createTempProject();
      await initProject(tmpDir, '--auto', '--tools', 'codex');
    });

    test('Codex checker exists at .codex/agents/gsdd-plan-checker.toml', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml')),
        'Codex checker TOML must exist'
      );
    });

    test('Codex checker contains all 9 dimension names', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
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
      for (const dim of dimensions) {
        assert.ok(content.includes(dim), `Codex checker must include dimension: ${dim}`);
      }
    });

    test('native approach-explorer exists at .codex/agents/gsdd-approach-explorer.toml', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-approach-explorer.toml')),
        'Codex approach-explorer TOML must exist'
      );
    });

    test('Codex checker has sandbox_mode = "read-only"', () => {
      const content = fs.readFileSync(
        path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
        'utf-8'
      );
      assert.ok(
        content.includes('sandbox_mode = "read-only"'),
        'Codex checker must have read-only sandbox'
      );
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
        fs.existsSync(path.join(kindTmpDir, '.claude', 'agents', 'gsdd-plan-checker.md')),
        'claude must generate at least one agent file'
      );
    });

    test('opencode (native_capable) generated agent files in .opencode/agents/', () => {
      assert.ok(
        fs.existsSync(path.join(kindTmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md')),
        'opencode must generate at least one agent file'
      );
    });

    test('codex (native_capable) generated agent files in .codex/agents/', () => {
      assert.ok(
        fs.existsSync(path.join(kindTmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml')),
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

  test('affected portable skills route checkpoint cleanup through gsdd file-op', () => {
    const expectations = new Map([
      ['gsdd-pause', ['gsdd file-op delete .planning/.continue-here.bak --missing ok']],
      ['gsdd-resume', ['gsdd file-op copy .planning/.continue-here.md .planning/.continue-here.bak', 'gsdd file-op delete .planning/.continue-here.md']],
      ['gsdd-plan', ['gsdd file-op delete .planning/.continue-here.bak --missing ok']],
      ['gsdd-execute', ['gsdd file-op delete .planning/.continue-here.bak --missing ok']],
      ['gsdd-verify', ['gsdd file-op delete .planning/.continue-here.bak --missing ok']],
      ['gsdd-quick', ['gsdd file-op delete .planning/.continue-here.bak --missing ok']],
    ]);

    for (const [skillName, snippets] of expectations.entries()) {
      const content = readSkill(tmpDir, skillName);
      for (const snippet of snippets) {
        assert.ok(content.includes(snippet), `${skillName} must include ${snippet}`);
      }
    }
  });

  test('resume portable skill no longer carries manual checkpoint copy/delete prose', () => {
    const content = readSkill(tmpDir, 'gsdd-resume');
    assert.doesNotMatch(content, /(^|\n)\s*\d+\.\s*Copy `?\.planning\/\.continue-here\.md`? to `?\.planning\/\.continue-here\.bak`?/i,
      'gsdd-resume must not keep the old manual checkpoint copy prose.');
    assert.doesNotMatch(content, /(^|\n)\s*\d+\.\s*Delete `?\.planning\/\.continue-here\.md`?/i,
      'gsdd-resume must not keep the old manual checkpoint delete prose.');
  });

  test('execute and verify portable skills route roadmap transitions through gsdd phase-status', () => {
    for (const skillName of ['gsdd-execute', 'gsdd-verify']) {
      const content = readSkill(tmpDir, skillName);
      assert.ok(content.includes('gsdd phase-status'), `${skillName} must reference gsdd phase-status.`);
    }
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
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf-8'));
    assert.strictEqual(config.workflow.research, true, 'default config must have workflow.research = true');

    const content = readSkill(tmpDir, 'gsdd-new-project');
    const research = extractXmlSection(content, 'research');
    assert.ok(research.length > 0, 'new-project must contain <research> section');
  });

  test('auto config has workflow.planCheck = true and plan SKILL.md contains plan-check orchestration', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf-8'));
    assert.strictEqual(config.workflow.planCheck, true, 'default config must have workflow.planCheck = true');

    const content = readSkill(tmpDir, 'gsdd-plan');
    // The exact XML section tag used in plan.md — broad OR terms risk matching incidental strings
    assert.ok(
      content.includes('plan_check_orchestration'),
      'plan skill must contain the plan_check_orchestration section from the plan workflow source'
    );
  });

  test('auto config has gitProtocol with all 3 fields and execute references gitProtocol', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf-8'));
    assert.ok(config.gitProtocol, 'config must have gitProtocol');
    assert.ok(config.gitProtocol.branch, 'gitProtocol must have branch');
    assert.ok(config.gitProtocol.commit, 'gitProtocol must have commit');
    assert.ok(config.gitProtocol.pr, 'gitProtocol must have pr');

    const content = readSkill(tmpDir, 'gsdd-execute');
    // 'gitProtocol' is the exact config key referenced in execute.md — not just any 'git' string
    assert.ok(
      content.includes('gitProtocol'),
      'execute skill must reference gitProtocol by name, not just any git string'
    );
  });

  test('auto config has modelProfile = balanced', () => {
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf-8'));
    assert.strictEqual(config.modelProfile, 'balanced', 'default modelProfile must be balanced');
  });

  test('Claude checker agent has model field derived from balanced profile', () => {
    const checker = fs.readFileSync(
      path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'),
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
    const content = readSkill(tmpDir, 'gsdd-execute');
    assert.match(content, /main.*master|master.*main/i,
      'generated execute skill must name main and master in the wrong-branch check.');
    assert.match(content, /STOP|hard-warn/i,
      'generated execute skill must preserve the stop/hard-warn branch safety wording.');
  });

  test('execute skill preserves naming-hygiene guidance for the recorded PR incidents', () => {
    const content = readSkill(tmpDir, 'gsdd-execute');
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
    const content = readSkill(tmpDir, 'gsdd-pause');
    assert.match(content, /Build a draft checkpoint from artifact truth/i,
      'generated pause skill must preserve draft-first checkpointing.');
    assert.match(content, /Ask at most 3 high-signal questions total/i,
      'generated pause skill must preserve the three-question cap.');
  });

  test('resume skill preserves provenance truth split and mismatch acknowledgement', () => {
    const content = readSkill(tmpDir, 'gsdd-resume');
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
    const verify = readSkill(tmpDir, 'gsdd-verify');
    const audit = readSkill(tmpDir, 'gsdd-audit-milestone');
    assert.match(verify, /Before any ROADMAP closure.*SUMMARY\.md.*still exists on disk/i,
      'generated verify skill must preserve the SUMMARY.md existence gate.');
    assert.match(audit, /results shown inline anyway/i,
      'generated audit skill must preserve the no-inline-fallback write gate wording.');
  });
});
