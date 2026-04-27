/**
 * GSDD CLI Tests - Specialized plan adapter surfaces
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

describe('specialized plan adapter surfaces', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('claude plan skill is the primary native surface and stays out of forked subagent mode', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude');
    } finally {
      restoreStdin();
    }

    const claudePlanSkill = fs.readFileSync(
      path.join(tmpDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    const claudeNewProjectSkill = fs.readFileSync(
      path.join(tmpDir, '.claude', 'skills', 'gsdd-new-project', 'SKILL.md'),
      'utf-8'
    );
    const claudePlanCommand = fs.readFileSync(
      path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md'),
      'utf-8'
    );

    assert.match(claudePlanSkill, /^name: gsdd-plan/m);
    assert.match(claudePlanSkill, /canonical Claude-native entry surface/);
    assert.match(claudePlanSkill, /Do NOT fork this skill into a subagent/);
    assert.match(claudePlanSkill, /not as a stop signal for this Claude-native adapter path/);
    assert.match(claudePlanSkill, /Maximum 3 checker cycles total/);
    assert.match(claudePlanSkill, /"status": "passed"/);
    assert.match(claudePlanSkill, /Status must be either "passed" or "issues_found"\./);
    assert.match(claudePlanSkill, /alignment_status: user_confirmed/);
    assert.match(claudePlanSkill, /alignment_status: approved_skip/);
    assert.match(claudePlanSkill, /No questions needed.*not valid proof|not valid proof.*No questions needed/);
    assert.match(claudePlanSkill, /Use existing[\s\S]{0,220}validate the alignment proof/i);
    assert.match(claudePlanSkill, /gsdd-approach-explorer[\s\S]{0,240}\.planning\/config\.json[\s\S]{0,100}workflow\.discuss/i);
    assert.match(claudePlanSkill, /workflow\.planCheck: false[\s\S]{0,260}does not skip[\s\S]{0,160}alignment-proof gate/i);
    assert.match(claudePlanSkill, /\.planning\/config\.json[\s\S]{0,120}workflow\.discuss[\s\S]{0,80}workflow\.planCheck/i);
    assert.doesNotMatch(claudePlanSkill, /^context: fork$/m);
    assert.doesNotMatch(claudePlanSkill, /^agent:/m);

    assert.match(claudeNewProjectSkill, /^context: fork$/m);
    assert.match(claudeNewProjectSkill, /^agent: Code$/m);

    assert.match(claudePlanCommand, /Compatibility alias/);
    assert.match(claudePlanCommand, /\.claude\/skills\/gsdd-plan\/SKILL\.md/);
    assert.doesNotMatch(claudePlanCommand, /Maximum 3 checker cycles total/);
  });

  test('opencode plan command is specialized and checker agent is hidden', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'opencode');
    } finally {
      restoreStdin();
    }

    const opencodePlanCommand = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'commands', 'gsdd-plan.md'),
      'utf-8'
    );
    const opencodeExecuteCommand = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'commands', 'gsdd-execute.md'),
      'utf-8'
    );
    const opencodePlanChecker = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );

    assert.match(opencodePlanCommand, /^subtask: false$/m);
    assert.match(opencodePlanCommand, /canonical OpenCode-native entry surface/);
    assert.match(opencodePlanCommand, /hidden `gsdd-plan-checker` subagent/);
    assert.match(opencodePlanCommand, /not as a stop signal for this OpenCode-native adapter path/);
    assert.match(opencodePlanCommand, /Maximum 3 checker cycles total/);
    assert.match(opencodePlanCommand, /"status": "passed"/);
    assert.match(opencodePlanCommand, /Status must be either "passed" or "issues_found"\./);
    assert.match(opencodePlanCommand, /alignment_status: user_confirmed/);
    assert.match(opencodePlanCommand, /alignment_status: approved_skip/);
    assert.match(opencodePlanCommand, /all canonical proof fields[\s\S]{0,260}alignment_status[\s\S]{0,80}alignment_method[\s\S]{0,80}user_confirmed_at[\s\S]{0,80}explicit_skip_approved[\s\S]{0,80}skip_scope[\s\S]{0,80}skip_rationale[\s\S]{0,80}confirmed_decisions/);
    assert.match(opencodePlanCommand, /confirmed_decisions/);
    assert.match(opencodePlanCommand, /explicit_skip_approved: true/);
    assert.match(opencodePlanCommand, /skip_scope/);
    assert.match(opencodePlanCommand, /skip_rationale/);
    assert.match(opencodePlanCommand, /No questions needed.*not valid proof|not valid proof.*No questions needed/);
    assert.match(opencodePlanCommand, /Use existing[\s\S]{0,220}validate the alignment proof/i);
    assert.match(opencodePlanCommand, /gsdd-approach-explorer[\s\S]{0,220}\.planning\/config\.json[\s\S]{0,80}workflow\.discuss/i);
    assert.match(opencodePlanCommand, /workflow\.planCheck: false[\s\S]{0,260}does not skip[\s\S]{0,160}alignment-proof gate/i);
    assert.match(opencodePlanCommand, /\.planning\/config\.json[\s\S]{0,120}workflow\.discuss[\s\S]{0,80}workflow\.planCheck/i);

    assert.doesNotMatch(opencodeExecuteCommand, /^subtask: false$/m);

    assert.match(opencodePlanChecker, /^mode: subagent$/m);
    assert.match(opencodePlanChecker, /^hidden: true$/m);
    assert.match(opencodePlanChecker, /Return JSON only/);
    assert.match(opencodePlanChecker, /alignment_status/);
    assert.match(opencodePlanChecker, /\.planning\/config\.json/);
  });

  test('portable skill is the Codex entry surface with checker invocation instructions', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    // Checker agent must exist
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml')));

    // No planner TOML — portable skill is the entry surface
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-planner.toml')));

    // Portable skill must be self-sufficient for Codex
    const portableSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.match(portableSkill, /How Plan Checking Works/);
    assert.match(portableSkill, /Invoking the Checker/);
    assert.match(portableSkill, /gsdd-plan-checker/);
    assert.match(portableSkill, /Maximum 3 checker cycles total/);
    assert.match(portableSkill, /"status": "passed"/);
    assert.match(portableSkill, /Status must be either "passed" or "issues_found"\./);
    assert.match(portableSkill, /reduced_assurance/);
    assert.match(portableSkill, /Orchestration Summary/);
    assert.match(portableSkill, /Planning stops here|plan-only/i);
    assert.match(portableSkill, /separate run.*gsdd-execute|explicitly wants implementation to begin/i);
    assert.doesNotMatch(portableSkill, /execute the plan/i);

    // Must NOT contain vendor-specific content
    assert.doesNotMatch(portableSkill, /Codex-Native/);
    assert.doesNotMatch(portableSkill, /spawn_agent/);
    assert.doesNotMatch(portableSkill, /\.codex\/agents\//);
    assert.doesNotMatch(portableSkill, /\.claude\/agents\//);
    assert.doesNotMatch(portableSkill, /\.opencode\/agents\//);
  });

  test('portable skill keeps the explicit execute unlock without adding Codex-only planner logic', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const portableSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );

    assert.match(portableSkill, /Planning stops here|plan-only/i);
    assert.match(portableSkill, /\/gsdd-execute/);
    assert.doesNotMatch(portableSkill, /\.codex\/AGENTS\.md/i);
    assert.doesNotMatch(portableSkill, /gsdd-planner\.toml/i);
  });

  test('codex plan-checker is a read-only TOML agent with delegate content', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const codexPlanChecker = fs.readFileSync(
      path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
      'utf-8'
    );

    assert.match(codexPlanChecker, /^name = "gsdd-plan-checker"/m);
    assert.match(codexPlanChecker, /^sandbox_mode = "read-only"/m);
    assert.match(codexPlanChecker, /^model_reasoning_effort = "high"/m);
    assert.match(codexPlanChecker, /developer_instructions/);
    assert.match(codexPlanChecker, /Return JSON only/);
    assert.match(codexPlanChecker, /Runnable\?/);
    assert.match(codexPlanChecker, /Fast\?/);
    assert.match(codexPlanChecker, /Ordered\?/);

    // Must NOT have a model line by default (inherits from parent session)
    assert.doesNotMatch(codexPlanChecker, /^model = /m);
  });

  test('plan-checker delegate includes verify quality sub-checks under task_completeness', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude');
    } finally {
      restoreStdin();
    }

    const claudePlanChecker = fs.readFileSync(
      path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );
    const opencodeTmpDir = createTempProject();
    const restoreStdin2 = setNonInteractiveStdin();
    try {
      const gsdd2 = await loadGsdd(opencodeTmpDir);
      await gsdd2.cmdInit('--tools', 'opencode');
    } finally {
      restoreStdin2();
    }
    const opencodePlanChecker = fs.readFileSync(
      path.join(opencodeTmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );
    cleanup(opencodeTmpDir);

    // Both adapters render from the same delegate source - verify quality sub-checks must be present
    for (const [label, content] of [['claude', claudePlanChecker], ['opencode', opencodePlanChecker]]) {
      assert.match(content, /Runnable\?/, `${label} checker must include Runnable sub-check`);
      assert.match(content, /Fast\?/, `${label} checker must include Fast sub-check`);
      assert.match(content, /Ordered\?/, `${label} checker must include Ordered sub-check`);
      assert.match(content, /runnable command/, `${label} checker must reference runnable commands`);
      assert.match(content, /watch-mode|watchAll/i, `${label} checker must flag watch-mode`);
    }

    // DRAFT notice must be removed
    assert.doesNotMatch(claudePlanChecker, /DRAFT PAYLOAD/i, 'claude checker must not have DRAFT notice');
    assert.doesNotMatch(opencodePlanChecker, /DRAFT PAYLOAD/i, 'opencode checker must not have DRAFT notice');
  });

  test('codex plan-checker escapes triple quotes in delegate content for TOML safety', async () => {
    // The renderCodexPlanChecker function must escape """ to prevent TOML breakage.
    // We verify by checking the generated TOML doesn't contain unescaped """ inside developer_instructions.
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const codexPlanChecker = fs.readFileSync(
      path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
      'utf-8'
    );

    // Extract content between the opening and closing """ delimiters
    const matches = codexPlanChecker.match(/developer_instructions = """([\s\S]*?)"""/);
    assert.ok(matches, 'Must have developer_instructions block');
    const innerContent = matches[1];
    // Inner content must not contain """ (which would prematurely terminate the TOML string)
    assert.doesNotMatch(innerContent, /"""/, 'Inner TOML content must not contain unescaped triple quotes');
  });

  test('claude approach-explorer agent exists and has correct frontmatter', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude');
    } finally {
      restoreStdin();
    }

    const explorerPath = path.join(tmpDir, '.claude', 'agents', 'gsdd-approach-explorer.md');
    assert.ok(fs.existsSync(explorerPath), 'Claude approach-explorer agent must exist');

    const content = fs.readFileSync(explorerPath, 'utf-8');
    assert.match(content, /^name: gsdd-approach-explorer/m, 'must have name: gsdd-approach-explorer');
    assert.match(content, /AskUserQuestion/, 'must include AskUserQuestion in tools');
    assert.ok(content.length > 100, 'content must be non-trivial (> 100 chars)');
  });

  test('opencode approach-explorer agent exists and is not hidden', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'opencode');
    } finally {
      restoreStdin();
    }

    const explorerPath = path.join(tmpDir, '.opencode', 'agents', 'gsdd-approach-explorer.md');
    assert.ok(fs.existsSync(explorerPath), 'OpenCode approach-explorer agent must exist');

    const content = fs.readFileSync(explorerPath, 'utf-8');
    assert.doesNotMatch(content, /^hidden: true$/m, 'approach-explorer must NOT be hidden (interactive, unlike plan-checker)');
  });

  test('codex approach-explorer TOML agent exists with high reasoning', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const explorerPath = path.join(tmpDir, '.codex', 'agents', 'gsdd-approach-explorer.toml');
    assert.ok(fs.existsSync(explorerPath), 'Codex approach-explorer TOML agent must exist');

    const content = fs.readFileSync(explorerPath, 'utf-8');
    assert.match(content, /^name = "gsdd-approach-explorer"/m, 'must have correct name');
    assert.match(content, /^model_reasoning_effort = "high"/m, 'must have high reasoning effort');
    assert.doesNotMatch(content, /^sandbox_mode = "read-only"/m, 'approach-explorer must NOT be read-only (needs write access unlike checker)');
  });

  test('all native plan surfaces contain the same 14 dimension names', async () => {
    const allDimensions = [
      'requirement_coverage',
      'task_completeness',
      'dependency_correctness',
      'key_link_completeness',
      'scope_sanity',
      'must_have_quality',
      'context_compliance',
      'goal_achievement',
      'scope_boundaries',
      'anti_regression_capture',
      'escalation_integrity',
      'closure_honesty',
      'high_leverage_review',
      'approach_alignment',
    ];

    // Init claude
    const claudeTmpDir = createTempProject();
    const restoreStdin1 = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(claudeTmpDir);
      await gsdd.cmdInit('--tools', 'claude');
    } finally {
      restoreStdin1();
    }
    const claudeSkill = fs.readFileSync(
      path.join(claudeTmpDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    cleanup(claudeTmpDir);

    // Init opencode
    const opencodeTmpDir = createTempProject();
    const restoreStdin2 = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(opencodeTmpDir);
      await gsdd.cmdInit('--tools', 'opencode');
    } finally {
      restoreStdin2();
    }
    const opencodeCommand = fs.readFileSync(
      path.join(opencodeTmpDir, '.opencode', 'commands', 'gsdd-plan.md'),
      'utf-8'
    );
    cleanup(opencodeTmpDir);

    // Init a third dir to get the portable skill (any adapter generates it)
    const portableTmpDir = createTempProject();
    const restoreStdin3 = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(portableTmpDir);
      await gsdd.cmdInit('--tools', 'agents');
    } finally {
      restoreStdin3();
    }
    const portableSkill = fs.readFileSync(
      path.join(portableTmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    cleanup(portableTmpDir);

    const surfaces = [
      ['claude skill', claudeSkill],
      ['opencode command', opencodeCommand],
      ['portable skill', portableSkill],
    ];

    for (const [label, content] of surfaces) {
      for (const dim of allDimensions) {
        assert.ok(content.includes(dim), `${label} must contain dimension: ${dim}`);
      }
    }
  });

  test('delegate content appears in all native checker surfaces', async () => {
    // Read the delegate source
    const delegatePath = path.join(__dirname, '..', 'distilled', 'templates', 'delegates', 'plan-checker.md');
    const delegateContent = fs.readFileSync(delegatePath, 'utf-8');
    // Pick a key phrase that must survive into all native checker surfaces
    const keyPhrase = 'Return JSON only';

    // Init claude
    const claudeTmpDir = createTempProject();
    const restoreStdin1 = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(claudeTmpDir);
      await gsdd.cmdInit('--tools', 'claude');
    } finally {
      restoreStdin1();
    }
    const claudeChecker = fs.readFileSync(
      path.join(claudeTmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );
    cleanup(claudeTmpDir);

    // Init opencode
    const opencodeTmpDir = createTempProject();
    const restoreStdin2 = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(opencodeTmpDir);
      await gsdd.cmdInit('--tools', 'opencode');
    } finally {
      restoreStdin2();
    }
    const opencodeChecker = fs.readFileSync(
      path.join(opencodeTmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );
    cleanup(opencodeTmpDir);

    // Init codex
    const codexTmpDir = createTempProject();
    const restoreStdin3 = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(codexTmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin3();
    }
    const codexChecker = fs.readFileSync(
      path.join(codexTmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
      'utf-8'
    );
    cleanup(codexTmpDir);

    // Verify delegate content appears in all native checker surfaces
    assert.ok(delegateContent.includes(keyPhrase), `delegate source must contain key phrase: ${keyPhrase}`);
    for (const [label, content] of [['claude', claudeChecker], ['opencode', opencodeChecker], ['codex', codexChecker]]) {
      assert.ok(content.includes(keyPhrase), `${label} checker must contain delegate key phrase: ${keyPhrase}`);
    }
  });

  test('runtime-freshness helper catches rendered/generated drift directly', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude');
      const freshness = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'runtime-freshness.mjs')).href}?t=${Date.now()}-${Math.random()}`);
      let report = freshness.evaluateRuntimeFreshness({
        cwd: tmpDir,
        workflows: gsdd.createCliContext(tmpDir).workflows,
      });
      assert.strictEqual(report.issueCount, 0, 'freshly generated surfaces must match current render output');

      fs.appendFileSync(path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md'), '\n<!-- drift -->\n');
      report = freshness.evaluateRuntimeFreshness({
        cwd: tmpDir,
        workflows: gsdd.createCliContext(tmpDir).workflows,
      });
      assert.ok(report.issues.some((entry) => entry.relativePath === '.claude/commands/gsdd-plan.md' && entry.status === 'stale'),
        'helper must detect direct rendered/generated drift on native plan surfaces');
    } finally {
      restoreStdin();
    }
  });
});
