/**
 * GSDD CLI Tests - Init / Update
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliViaJunction,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

function extractSection(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start);
  assert.notStrictEqual(start, -1, `Missing section start: ${startMarker}`);
  assert.notStrictEqual(end, -1, `Missing section end: ${endMarker}`);
  return content.slice(start, end);
}

function extractExampleTask(content) {
  const match = content.match(/<task id="[^"]+" type="auto">[\s\S]*?<\/task>/);
  assert.ok(match, 'Missing canonical example task with an auto task id');
  return match[0];
}

function collectTestPaths(content) {
  return [...content.matchAll(/tests\/[\w.-]+\.test\.[\w]+/g)].map((match) => match[0]);
}

describe('gsdd init and update', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('init creates planning structure, default config, templates, and open-standard skills', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'phases')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'research')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'spec.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-new-project', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'delegates', 'plan-checker.md')));

    const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
    assert.strictEqual(config.researchDepth, 'balanced');
    assert.strictEqual(config.parallelization, true);
    assert.strictEqual(config.commitDocs, true);
    assert.deepStrictEqual(config.gitProtocol, {
      branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
      commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
      pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
    });
    assert.deepStrictEqual(config.workflow, {
      research: true,
      planCheck: true,
      verifier: true,
    });

    const newProjectSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-new-project', 'SKILL.md'),
      'utf-8'
    );
    assert.match(newProjectSkill, /\.agents\/skills\/gsdd-map-codebase\/SKILL\.md/);
    assert.doesNotMatch(newProjectSkill, /active platform skill\/adapter/);

    const mapperTechTemplate = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md'),
      'utf-8'
    );
    assert.match(mapperTechTemplate, /\.planning\/templates\/roles\/mapper\.md/);
    assert.doesNotMatch(mapperTechTemplate, /active platform skill\/adapter/);

    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'mapper.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'researcher.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'synthesizer.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'roadmapper.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'planner.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', 'verifier.md')));

    const synthRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'synthesizer.md'),
      'utf-8'
    );
    assert.match(synthRole, /Mandatory initial read/i);
    assert.match(synthRole, /<execution_flow>/);
    assert.match(synthRole, /<output_format>/);
    assert.match(synthRole, /<structured_returns>/);
    assert.match(synthRole, /<success_criteria>/);
    assert.match(synthRole, /\.planning\/research\/STACK\.md/);
    assert.match(synthRole, /\.planning\/research\/FEATURES\.md/);
    assert.match(synthRole, /\.planning\/research\/ARCHITECTURE\.md/);
    assert.match(synthRole, /\.planning\/research\/PITFALLS\.md/);
    assert.match(synthRole, /If any required file is missing:/);
    assert.match(synthRole, /do not silently continue with a degraded synthesis/i);
    assert.match(synthRole, /Write `\.planning\/research\/SUMMARY\.md`/);
    assert.match(synthRole, /- Sources/);
    assert.match(synthRole, /- Research Flags/);
    assert.match(synthRole, /^sources:$/m);
    assert.match(synthRole, /## SYNTHESIS BLOCKED/);
    assert.match(synthRole, /\*\*Missing files:\*\*/);
    assert.match(synthRole, /<scope_boundary>/);
    assert.match(synthRole, /does not do new web or codebase research/i);
    assert.match(synthRole, /does not write `\.planning\/ROADMAP\.md`/i);
    assert.match(synthRole, /does not own git actions or commit output/i);
    assert.match(synthRole, /```yaml[\s\S]*executive_summary:/);
    assert.doesNotMatch(synthRole, /~\/\.claude\//i);
    assert.doesNotMatch(synthRole, /docs: complete project research/i);
    assert.doesNotMatch(synthRole, /cat \.planning\/research\//i);

    const roadmapperRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'roadmapper.md'),
      'utf-8'
    );
    assert.match(roadmapperRole, /Mandatory initial read/i);
    assert.match(roadmapperRole, /<coverage_validation>/);
    assert.match(roadmapperRole, /<structured_returns>/);
    assert.match(roadmapperRole, /<success_criteria>/);
    assert.match(roadmapperRole, /Write `\.planning\/ROADMAP\.md`/);
    assert.match(roadmapperRole, /## Phases/);
    assert.match(roadmapperRole, /## Phase Details/);
    assert.match(roadmapperRole, /`\*\*Status\*\*` must use one of: `\[ \]`, `\[-\]`, `\[x\]`/);
    assert.match(roadmapperRole, /The `### Phase N:` headers, per-phase `\*\*Status\*\*` markers, and per-phase `\*\*Requirements\*\*` lines are parse-critical/i);
    assert.match(roadmapperRole, /<scope_boundary>/);
    assert.match(roadmapperRole, /does not create or redefine separate state artifacts such as `STATE\.md`/i);
    assert.match(roadmapperRole, /## ROADMAP DRAFT/);
    assert.match(roadmapperRole, /## ROADMAP CREATED/);
    assert.match(roadmapperRole, /## ROADMAP REVISED/);
    assert.match(roadmapperRole, /## ROADMAP BLOCKED/);
    assert.match(roadmapperRole, /\*\*Artifact written:\*\* \.planning\/ROADMAP\.md/);
    assert.match(roadmapperRole, /\*\*Status\*\*: \[ \]/);
    assert.match(roadmapperRole, /revise the roadmap in place rather than rewriting it from scratch/i);
    assert.match(roadmapperRole, /Options:/);
    assert.match(roadmapperRole, /Awaiting:/);
    assert.match(roadmapperRole, /Delete anti-enterprise filler on sight/i);
    assert.match(roadmapperRole, /Write or update the roadmap artifact before returning/i);
    assert.match(roadmapperRole, /```yaml[\s\S]*phase_count:/);
    assert.doesNotMatch(roadmapperRole, /progress\/status tracking expected by the current repo runtime/i);
    assert.doesNotMatch(roadmapperRole, /Initialize STATE\.md/i);
    assert.doesNotMatch(roadmapperRole, /write .*STATE\.md/i);
    assert.doesNotMatch(roadmapperRole, /~\/\.claude\//i);
    assert.doesNotMatch(roadmapperRole, /commit/i);

    const plannerRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'planner.md'),
      'utf-8'
    );
    assert.match(plannerRole, /Mandatory initial read/i);
    assert.match(plannerRole, /<project_context>/);
    assert.match(plannerRole, /<context_fidelity>/);
    assert.match(plannerRole, /<structured_returns>/);
    assert.match(plannerRole, /<success_criteria>/);
    assert.match(plannerRole, /## Step 6: Detect TDD candidates/);
    assert.match(plannerRole, /if you can define the expected input\/output behavior before implementation, the work is a TDD candidate/i);
    assert.match(plannerRole, /Default is `auto`\./);
    assert.match(plannerRole, /Any checkpoint must be justified by the task itself/i);
    assert.match(plannerRole, /`files` must name exact paths/i);
    assert.match(plannerRole, /`verify` must include a runnable automated command with fast feedback/i);
    assert.match(plannerRole, /if no runnable automated check exists yet, add a prior task that creates the missing test or scaffold/i);
    assert.match(plannerRole, /If planning from verification gaps:/);
    assert.match(plannerRole, /use the failed truths, broken artifacts, missing key links, and reported requirement gaps as the planning scope/i);
    assert.match(plannerRole, /<dependency_graph_example>/);
    assert.match(plannerRole, /Wave 1: A/);
    assert.match(plannerRole, /Wave rule:/);
    assert.match(plannerRole, /```yaml[\s\S]*files-modified:/);
    assert.match(plannerRole, /checkpoint:user/);
    assert.doesNotMatch(plannerRole, /type:\s*tdd/i);
    assert.doesNotMatch(plannerRole, /user_setup:/);
    assert.doesNotMatch(plannerRole, /~\/\.claude\//i);
    assert.doesNotMatch(plannerRole, /node ~\/\.claude\/get-shit-done/i);

    const verifierRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'verifier.md'),
      'utf-8'
    );
    assert.match(verifierRole, /Mandatory initial read/i);
    assert.match(verifierRole, /<core_principle>/);
    assert.match(verifierRole, /<output>/);
    assert.match(verifierRole, /<success_criteria>/);
    assert.match(verifierRole, /Discovery protocol:/);
    assert.match(verifierRole, /locate all `\*-PLAN\.md` files for that phase before verifying implementation/i);
    assert.match(verifierRole, /locate the previous `\*-VERIFICATION\.md` report when it exists/i);
    assert.match(verifierRole, /treat this as re-verification/i);
    assert.match(verifierRole, /use each success criterion directly as a truth/i);
    assert.match(verifierRole, /Truth-level status taxonomy:/);
    assert.match(verifierRole, /`VERIFIED`/);
    assert.match(verifierRole, /`FAILED`/);
    assert.match(verifierRole, /`UNCERTAIN`/);
    assert.match(verifierRole, /\| L1 \| exists \|/);
    assert.match(verifierRole, /\| L2 \| substantive \|/);
    assert.match(verifierRole, /\| L3 \| wired \|/);
    assert.match(verifierRole, /component -> API route or server action/);
    assert.match(verifierRole, /API route or server action -> storage or external side effect/);
    assert.match(verifierRole, /form or user interaction -> handler/);
    assert.match(verifierRole, /state or fetched data -> rendered output/);
    assert.match(verifierRole, /Orphaned requirements must be reported/i);
    assert.match(verifierRole, /requirements expected by roadmap scope but claimed by no plan at all/i);
    assert.match(verifierRole, /keep them machine-readable in frontmatter\./i);
    assert.match(verifierRole, /Group related failures before finalizing the report/i);
    assert.doesNotMatch(verifierRole, /frontmatter or an equivalent machine-usable top-level structure/i);
    assert.match(verifierRole, /## Verification Basis/);
    assert.match(verifierRole, /## Requirement Coverage/);
    assert.match(verifierRole, /^re_verification:$/m);
    assert.match(verifierRole, /^gaps:$/m);
    assert.match(verifierRole, /<structured_returns>/);
    assert.match(verifierRole, /Return a concise machine-usable summary to the orchestrator/i);
    assert.match(verifierRole, /^report: "\.planning\/phases\/01-foundation\/01-VERIFICATION\.md"$/m);
    assert.doesNotMatch(verifierRole, /~\/\.claude\//i);
    assert.doesNotMatch(verifierRole, /grep -E/i);
    assert.doesNotMatch(verifierRole, /node ~\/\.claude\/get-shit-done/i);

    const planSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.doesNotMatch(planSkill, /AUDIT STATUS: This workflow is a stub/);
    assert.match(planSkill, /How Plan Checking Works/);
    assert.match(planSkill, /independent checker may review it in fresh context/i);
    assert.match(planSkill, /at least one runnable command/i);
    assert.match(planSkill, /first phase with status `\[ \]` or `\[-\]`/i);
    assert.match(planSkill, /^phase: 01-foundation$/m);
    assert.match(planSkill, /^files-modified:$/m);
    assert.match(planSkill, /^autonomous: true$/m);
    assert.match(planSkill, /^must_haves:$/m);
    assert.match(planSkill, /<task id="01-01" type="auto">/);
    assert.match(planSkill, /checkpoint:user/);
    assert.match(planSkill, /checkpoint:review/);
    assert.doesNotMatch(planSkill, /â|ðŸ|âœ|â†/);
    assert.ok((planSkill.match(/- Run `[^`]+`/g) || []).length >= 3);

    const exampleTask = extractExampleTask(planSkill);
    const exampleFilePaths = collectTestPaths(exampleTask.match(/<files>[\s\S]*?<\/files>/)?.[0] || '');
    const exampleVerifyPaths = collectTestPaths(exampleTask.match(/<verify>[\s\S]*?<\/verify>/)?.[0] || '');
    for (const testPath of exampleVerifyPaths) {
      assert.ok(
        exampleFilePaths.includes(testPath),
        `Example verify path must appear in <files>: ${testPath}`
      );
    }

    const specificitySection = extractSection(planSkill, '### Specificity Rules', '</task_format>');
    // Rows use quoted strings but may have trailing whitespace; filter by backtick
    // presence (from runnable commands) to reliably identify specificity example rows.
    const specificityRows = specificitySection
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .filter((line) => !line.includes('Too Vague'))
      .filter((line) => line.includes('`'));
    assert.ok(specificityRows.length >= 4, 'Expected specificity examples to remain present');
    for (const row of specificityRows) {
      const cells = row.split('|').map((cell) => cell.trim());
      const justRight = cells[2];
      assert.match(justRight, /run `[^`]+`/i, `Specificity example must include a runnable command: ${row}`);
    }

    const planCheckerTemplate = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'delegates', 'plan-checker.md'),
      'utf-8'
    );
    assert.match(planCheckerTemplate, /Return JSON only/);
    assert.match(planCheckerTemplate, /"status": "passed"/);
    assert.match(planCheckerTemplate, /Status must be either `"passed"` or `"issues_found"`\./);
    assert.match(planCheckerTemplate, /Use `"status": "passed"` only when no blockers remain/);
    assert.match(planCheckerTemplate, /Use `"status": "issues_found"`/);

    const executeSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-execute', 'SKILL.md'),
      'utf-8'
    );
    assert.match(executeSkill, /type="checkpoint:user"/);
    assert.match(executeSkill, /type="checkpoint:review"/);
    assert.match(executeSkill, /\[x\] \*\*Phase \{N\}:/);
    assert.match(executeSkill, /DO NOT freelance/);
    assert.match(executeSkill, /Checkpoint tasks are contract boundaries/i);
    assert.match(executeSkill, /stale reference/i);
    assert.doesNotMatch(executeSkill, /MARK DONE in the plan file/i);
    assert.doesNotMatch(executeSkill, /â|ðŸ|âœ|â†/);

    const verifySkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-verify', 'SKILL.md'),
      'utf-8'
    );
    assert.match(verifySkill, /^status: gaps_found$/m);
    assert.match(verifySkill, /^re_verification:$/m);
    assert.match(verifySkill, /^gaps:$/m);
    assert.match(verifySkill, /^human_verification:$/m);
    assert.match(verifySkill, /\*\*Status:\*\* \[passed \| gaps_found \| human_needed\]/);
    assert.match(verifySkill, /treat this as re-verification/i);
    assert.match(verifySkill, /does not claim milestone-wide integration completeness/i);
    assert.doesNotMatch(verifySkill, /â|ðŸ|âœ|â†/);
  });

  test('delegates reference canonical role contracts', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const mapperTech = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'delegates', 'mapper-tech.md'),
      'utf-8'
    );
    assert.match(mapperTech, /\.planning\/templates\/roles\/mapper\.md/);

    const researcherStack = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'delegates', 'researcher-stack.md'),
      'utf-8'
    );
    assert.match(researcherStack, /\.planning\/templates\/roles\/researcher\.md/);

    const synthDelegate = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'delegates', 'researcher-synthesizer.md'),
      'utf-8'
    );
    assert.match(synthDelegate, /\.planning\/templates\/roles\/synthesizer\.md/);

    const mapperRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'mapper.md'),
      'utf-8'
    );
    assert.match(mapperRole, /\.env/);
    assert.match(mapperRole, /Hard stop/);
  });

  test('init with explicit tools generates requested adapters and treats codex as a deprecated no-op', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let output = '';
    const previousLog = console.log;
    console.log = (...parts) => {
      output += `${parts.join(' ')}\n`;
    };
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude,codex,opencode,agents');
    } finally {
      console.log = previousLog;
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'gsdd-new-project', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md')));
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, '.codex', 'AGENTS.md')),
      false,
      '.codex/AGENTS.md should not be generated for deprecated codex tool'
    );
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'commands', 'gsdd-new-project.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.match(output, /--tools codex` is deprecated/i);
    assert.match(output, /Codex CLI uses the default `?\.agents\/skills\/gsdd-\*`? skills/i);

    const claudePlanChecker = fs.readFileSync(
      path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );
    assert.match(claudePlanChecker, /^name: gsdd-plan-checker/m);
    assert.match(claudePlanChecker, /^tools: Read, Grep, Glob/m);
    assert.doesNotMatch(claudePlanChecker, /DRAFT PAYLOAD ONLY/);
    assert.match(claudePlanChecker, /Return JSON only/);

    const claudePlanCommand = fs.readFileSync(
      path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md'),
      'utf-8'
    );
    assert.match(claudePlanCommand, /^argument-hint: \[phase-number\]/m);
    assert.match(claudePlanCommand, /Compatibility alias/);
    assert.match(claudePlanCommand, /\.claude\/skills\/gsdd-plan\/SKILL\.md/);
    assert.doesNotMatch(claudePlanCommand, /Maximum 3 checker cycles total/);

    const opencodePlanChecker = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'),
      'utf-8'
    );
    assert.match(opencodePlanChecker, /^mode: subagent/m);
    assert.match(opencodePlanChecker, /^hidden: true/m);
    assert.match(opencodePlanChecker, /^\s+write: false/m);
    assert.match(opencodePlanChecker, /^\s+edit: false/m);
    assert.match(opencodePlanChecker, /^\s+bash: false/m);
    assert.doesNotMatch(opencodePlanChecker, /DRAFT PAYLOAD ONLY/);
  });

  test('init with --tools codex only does not fall back to detected adapters', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });

    const restoreStdin = setNonInteractiveStdin();
    let output = '';
    const previousLog = console.log;
    console.log = (...parts) => {
      output += `${parts.join(' ')}\n`;
    };

    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      console.log = previousLog;
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, '.codex', 'AGENTS.md')),
      false,
      '.codex/AGENTS.md should not be generated for deprecated codex tool'
    );
    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, '.claude', 'skills')),
      false,
      'explicit --tools codex should not fall back to detected Claude adapters'
    );
    assert.match(output, /--tools codex` is deprecated/i);
  });

  test('init is idempotent and upserts the bounded AGENTS block without duplicating it', async () => {
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      '# Local Rules\n\nKeep my notes.\n\n<!-- BEGIN GSDD -->\nold block\n<!-- END GSDD -->\n'
    );

    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      await gsdd.cmdInit('--tools', 'agents');
    } finally {
      restoreStdin();
    }

    const agents = fs.readFileSync(agentsPath, 'utf-8');
    const beginMatches = agents.match(/<!-- BEGIN GSDD -->/g) || [];
    const endMatches = agents.match(/<!-- END GSDD -->/g) || [];
    assert.strictEqual(beginMatches.length, 1);
    assert.strictEqual(endMatches.length, 1);
    assert.match(agents, /# Local Rules/);
    assert.doesNotMatch(agents, /old block/);
  });

  test('update refreshes previously generated adapters based on detected platforms and leaves codex on the default skill path', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;

    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude,agents');
    } finally {
      restoreStdin();
    }

    const claudeAgentPath = path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md');
    const claudeCommandPath = path.join(tmpDir, '.claude', 'commands', 'gsdd-plan.md');
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(claudeAgentPath, 'stale checker\n');
    fs.writeFileSync(claudeCommandPath, 'stale command\n');
    fs.writeFileSync(agentsPath, '# Local Rules\n\n<!-- BEGIN GSDD -->\nstale block\n<!-- END GSDD -->\n');

    await gsdd.cmdUpdate();

    const updatedClaudeAgent = fs.readFileSync(claudeAgentPath, 'utf-8');
    assert.doesNotMatch(updatedClaudeAgent, /^stale checker$/m);
    assert.match(updatedClaudeAgent, /^name: gsdd-plan-checker/m);

    const updatedClaudeCommand = fs.readFileSync(claudeCommandPath, 'utf-8');
    assert.doesNotMatch(updatedClaudeCommand, /^stale command$/m);
    assert.match(updatedClaudeCommand, /Compatibility alias/);

    const updatedAgents = fs.readFileSync(agentsPath, 'utf-8');
    assert.doesNotMatch(updatedAgents, /stale block/);
    assert.match(updatedAgents, /GSDD/);
  });

  test('update with --tools codex only does not fall back to detected adapters', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;
    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });

    let output = '';
    const previousLog = console.log;
    console.log = (...parts) => {
      output += `${parts.join(' ')}\n`;
    };

    try {
      await gsdd.cmdUpdate('--tools', 'codex');
    } finally {
      console.log = previousLog;
    }

    assert.strictEqual(
      fs.existsSync(path.join(tmpDir, '.claude', 'skills')),
      false,
      'explicit --tools codex update should not fall back to detected Claude adapters'
    );
    assert.match(output, /--tools codex` is deprecated/i);
    assert.match(output, /updated open-standard skills/);
  });

  test('cli entrypoint still runs when invoked through an aliased bin path', async () => {
    const result = await runCliViaJunction(tmpDir, ['help']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Usage: gsdd <command> \[args\]/);
    assert.match(result.output, /Commands:/);
    assert.match(result.output, /claude\s+Generate Claude Code skills .* native agents/);
    assert.match(result.output, /codex\s+Deprecated compatibility alias/);
    assert.match(result.output, /primary Codex CLI surface/);
  });
});
