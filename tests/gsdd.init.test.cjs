/**
 * GSDD CLI Tests - Init / Update
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliAsMain,
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

async function importModule(filePath) {
  return import(`${pathToFileURL(filePath).href}?t=${Date.now()}-${Math.random()}`);
}

function createPromptStreams() {
  class FakeInput extends EventEmitter {
    constructor() {
      super();
      this.isTTY = true;
      this.isRaw = false;
      this.resumeCalls = 0;
    }

    setRawMode(value) {
      this.isRaw = value;
    }

    resume() {
      this.resumeCalls += 1;
    }

    pause() {}
  }

  class FakeOutput {
    constructor() {
      this.buffer = '';
      this.columns = 120;
      this.rows = 40;
      this.isTTY = true;
    }

    write(chunk) {
      this.buffer += String(chunk);
      return true;
    }
  }

  return {
    input: new FakeInput(),
    output: new FakeOutput(),
  };
}

function setInteractiveStdin() {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor);
    } else {
      delete process.stdin.isTTY;
    }
  };
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
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'auth-matrix.md')),
      'auth-matrix.md template must be distributed during init');

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
      discuss: false,
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

    const requiredRoles = [
      'mapper.md',
      'researcher.md',
      'synthesizer.md',
      'roadmapper.md',
      'planner.md',
      'verifier.md',
      'executor.md',
    ];
    for (const role of requiredRoles) {
      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'templates', 'roles', role)));
    }

    const executorRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'executor.md'),
      'utf-8'
    );
    for (const token of [
      '<role>',
      '<scope_boundary>',
      '<deviation_rules>',
      '<authentication_gates>',
      '<output>',
      '<tdd_execution>',
      '<success_criteria>',
      '<checkpoint_protocol>',
      '<self_check>',
      '<quality_guarantees>',
      '<anti_patterns>',
      '<execution_loop>',
      '<vendor_hints>',
    ]) {
      assert.match(executorRole, new RegExp(token.replace(/[<>/]/g, '\\$&')));
    }
    assert.match(executorRole, /Mandatory initial read/i);
    assert.match(executorRole, /null pointer/i);
    assert.match(executorRole, /no auth on protected routes/i);
    assert.match(executorRole, /Missing dependency/i);
    assert.match(executorRole, /New DB table/i);
    assert.match(executorRole, /401/);
    assert.match(executorRole, /403/);
    assert.match(executorRole, /```yaml[\s\S]*deviations:/);
    assert.match(executorRole, /key_files:/);
    assert.match(executorRole, /RED/);
    assert.match(executorRole, /GREEN/);
    assert.match(executorRole, /REFACTOR/);
    assert.match(executorRole, /\[ \] Mandatory context files read first/i);
    assert.match(executorRole, /\[ \] All `type="auto"` tasks/i);
    assert.match(executorRole, /\[ \] Authentication gates handled/i);
    assert.match(executorRole, /\[ \] .*SUMMARY\.md.* is written with substantive one-liner/i);
    assert.match(executorRole, /\[ \] Self-check passed/i);
    assert.match(executorRole, /does not own planning, verification, or milestone audit/i);
    assert.match(executorRole, /One-liner must be substantive/i);
    for (const banned of [
      /~\/\.claude\//i,
      /gsd-tools\.cjs/i,
      /node ~\/\.claude/i,
      /\{type\}\(\{phase\}-\{plan\}\):/,
      /agent-history\.json/i,
      /STRUCTURE\.md/i,
      /INTEGRATIONS\.md/i,
      /auto_advance/i,
      /executor_model/i,
    ]) {
      assert.doesNotMatch(executorRole, banned);
    }

    const synthRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'synthesizer.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<execution_flow>/,
      /<output_format>/,
      /<structured_returns>/,
      /<success_criteria>/,
      /\.planning\/research\/STACK\.md/,
      /\.planning\/research\/FEATURES\.md/,
      /\.planning\/research\/ARCHITECTURE\.md/,
      /\.planning\/research\/PITFALLS\.md/,
      /If any required file is missing:/,
      /do not silently continue with a degraded synthesis/i,
      /Write `\.planning\/research\/SUMMARY\.md`/,
      /- Sources/,
      /- Research Flags/,
      /^sources:$/m,
      /## SYNTHESIS BLOCKED/,
      /\*\*Missing files:\*\*/,
      /<scope_boundary>/,
      /does not do new web or codebase research/i,
      /does not write `\.planning\/ROADMAP\.md`/i,
      /does not own git actions or commit output/i,
      /```yaml[\s\S]*executive_summary:/,
    ]) {
      assert.match(synthRole, required);
    }
    for (const banned of [/~\/\.claude\//i, /docs: complete project research/i, /cat \.planning\/research\//i]) {
      assert.doesNotMatch(synthRole, banned);
    }

    const roadmapperRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'roadmapper.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<coverage_validation>/,
      /<structured_returns>/,
      /<success_criteria>/,
      /Write `\.planning\/ROADMAP\.md`/,
      /## Phases/,
      /## Phase Details/,
      /`\*\*Status\*\*` must use one of: `\[ \]`, `\[-\]`, `\[x\]`/,
      /parse-critical/i,
      /<scope_boundary>/,
      /does not create or redefine separate state artifacts such as `STATE\.md`/i,
      /## ROADMAP DRAFT/,
      /## ROADMAP CREATED/,
      /## ROADMAP REVISED/,
      /## ROADMAP BLOCKED/,
      /\*\*Artifact written:\*\* \.planning\/ROADMAP\.md/,
      /\*\*Status\*\*: \[ \]/,
      /revise the roadmap in place rather than rewriting it from scratch/i,
      /Options:/,
      /Awaiting:/,
      /Delete anti-enterprise filler on sight/i,
      /Write or update the roadmap artifact before returning/i,
      /```yaml[\s\S]*phase_count:/,
    ]) {
      assert.match(roadmapperRole, required);
    }
    for (const banned of [
      /progress\/status tracking expected by the current repo runtime/i,
      /Initialize STATE\.md/i,
      /write .*STATE\.md/i,
      /~\/\.claude\//i,
      /commit/i,
    ]) {
      assert.doesNotMatch(roadmapperRole, banned);
    }

    const plannerRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'planner.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<project_context>/,
      /<context_fidelity>/,
      /<structured_returns>/,
      /<success_criteria>/,
      /## Step 6: Detect TDD candidates/,
      /work is a TDD candidate/i,
      /Default is `auto`\./,
      /Any checkpoint must be justified by the task itself/i,
      /`files` must name exact paths/i,
      /`verify` must include a runnable automated command with fast feedback/i,
      /if no runnable automated check exists yet, add a prior task/i,
      /If planning from verification gaps:/,
      /use the failed truths, broken artifacts/i,
      /<dependency_graph_example>/,
      /Wave 1: A/,
      /Wave rule:/,
      /```yaml[\s\S]*files-modified:/,
      /checkpoint:user/,
    ]) {
      assert.match(plannerRole, required);
    }
    for (const banned of [/type:\s*tdd/i, /user_setup:/, /~\/\.claude\//i, /node ~\/\.claude\/get-shit-done/i]) {
      assert.doesNotMatch(plannerRole, banned);
    }

    const verifierRole = fs.readFileSync(
      path.join(tmpDir, '.planning', 'templates', 'roles', 'verifier.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<core_principle>/,
      /<output>/,
      /<success_criteria>/,
      /Discovery protocol:/,
      /locate all `\*-PLAN\.md` files/i,
      /locate the previous `\*-VERIFICATION\.md` report/i,
      /treat this as re-verification/i,
      /use each success criterion directly as a truth/i,
      /Truth-level status taxonomy:/,
      /`VERIFIED`/,
      /`FAILED`/,
      /`UNCERTAIN`/,
      /\| L1 \| exists \|/,
      /\| L2 \| substantive \|/,
      /\| L3 \| wired \|/,
      /component -> API route or server action/,
      /API route or server action -> storage or external side effect/,
      /form or user interaction -> handler/,
      /state or fetched data -> rendered output/,
      /Orphaned requirements must be reported/i,
      /requirements expected by roadmap scope but claimed by no plan at all/i,
      /keep them machine-readable in frontmatter\./i,
      /Group related failures before finalizing the report/i,
      /## Verification Basis/,
      /## Requirement Coverage/,
      /^re_verification:$/m,
      /^gaps:$/m,
      /<structured_returns>/,
      /Return a concise machine-usable summary to the orchestrator/i,
      /^report: "\.planning\/phases\/01-foundation\/01-VERIFICATION\.md"$/m,
    ]) {
      assert.match(verifierRole, required);
    }
    for (const banned of [
      /frontmatter or an equivalent machine-usable top-level structure/i,
      /~\/\.claude\//i,
      /grep -E/i,
      /node ~\/\.claude\/get-shit-done/i,
    ]) {
      assert.doesNotMatch(verifierRole, banned);
    }

    const planSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    for (const required of [
      /How Plan Checking Works/,
      /independent checker reviews it in fresh context/i,
      /at least one runnable command/i,
      /first phase with status `\[ \]` or `\[-\]`/i,
      /^phase: 01-foundation$/m,
      /^runtime: claude-code$/m,
      /^assurance: self_checked$/m,
      /^files-modified:$/m,
      /^autonomous: true$/m,
      /^must_haves:$/m,
      /<assurance_check>/,
      /<checks>/,
      /<plan_check>/,
      /cross_runtime_checked/,
      /<task id="01-01" type="auto">/,
      /checkpoint:user/,
      /checkpoint:review/,
    ]) {
      assert.match(planSkill, required);
    }
    assert.doesNotMatch(planSkill, /AUDIT STATUS: This workflow is a stub/);
    assert.doesNotMatch(planSkill, /Ã¢|Ã°Å¸|Ã¢Å“|Ã¢â€ /);
    assert.ok((planSkill.match(/- Run `[^`]+`/g) || []).length >= 3);

    const exampleTask = extractExampleTask(planSkill);
    const exampleFilePaths = collectTestPaths(exampleTask.match(/<files>[\s\S]*?<\/files>/)?.[0] || '');
    const exampleVerifyPaths = collectTestPaths(exampleTask.match(/<verify>[\s\S]*?<\/verify>/)?.[0] || '');
    for (const testPath of exampleVerifyPaths) {
      assert.ok(exampleFilePaths.includes(testPath), `Example verify path must appear in <files>: ${testPath}`);
    }

    const specificitySection = extractSection(planSkill, '### Specificity Rules', '</task_format>');
    const specificityRows = specificitySection
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .filter((line) => !line.includes('Too Vague'))
      .filter((line) => line.includes('`'));
    assert.ok(specificityRows.length >= 4, 'Expected specificity examples to remain present');
    for (const row of specificityRows) {
      const cells = row.split('|').map((cell) => cell.trim());
      assert.match(cells[2], /run `[^`]+`/i, `Specificity example must include a runnable command: ${row}`);
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
    for (const required of [
      /type="checkpoint:user"/,
      /type="checkpoint:review"/,
      /\[x\] \*\*Phase \{N\}:/,
      /DO NOT freelance/,
      /Checkpoint tasks are contract boundaries/i,
      /factual_discovery/,
      /intent_scope_change/,
      /architecture_risk_conflict/,
      /<handoff>/,
      /<deltas>/,
      /^runtime: codex-cli$/m,
      /^assurance: self_checked$/m,
      /stale reference/i,
      /Mandatory context files read first when provided/i,
      /Authentication gates handled with the auth-gate protocol/i,
    ]) {
      assert.match(executeSkill, required);
    }
    assert.doesNotMatch(executeSkill, /MARK DONE in the plan file/i);
    assert.doesNotMatch(executeSkill, /Ã¢|Ã°Å¸|Ã¢Å“|Ã¢â€ /);

    const verifySkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-verify', 'SKILL.md'),
      'utf-8'
    );
    for (const required of [
      /^runtime: opencode$/m,
      /^assurance: cross_runtime_checked$/m,
      /^status: gaps_found$/m,
      /^re_verification:$/m,
      /^gaps:$/m,
      /^human_verification:$/m,
      /\*\*Status:\*\* \[passed \| gaps_found \| human_needed\]/,
      /## Verification Basis/,
      /Handoff status:/,
      /Deltas reviewed:/,
      /SUMMARY artifact's `<handoff>` and `<deltas>` blocks/i,
      /treat this as re-verification/i,
      /does not claim milestone-wide integration completeness/i,
      /Do not return a flat symptom list/i,
      /requirements expected by roadmap scope but claimed by no plan/i,
      /do not collapse .* into prose-only body text/i,
      /verification basis/i,
      /Orphaned requirements must be reported/i,
    ]) {
      assert.match(verifySkill, required);
    }
    assert.doesNotMatch(verifySkill, /Ã¢|Ã°Å¸|Ã¢Å“|Ã¢â€ /);
  });

  test('generated workflow frontmatter matches mutability', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const verifySkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-verify', 'SKILL.md'),
      'utf-8'
    );
    const progressSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-progress', 'SKILL.md'),
      'utf-8'
    );

    assert.match(verifySkill, /^agent: Code$/m,
      'verify must generate as agent: Code because it writes VERIFICATION.md');
    assert.match(progressSkill, /^agent: Plan$/m,
      'progress must remain agent: Plan because it is the read-only workflow');
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

  test('init with explicit tools generates requested adapters including Codex native adapter', async () => {
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
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-planner.toml')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'commands', 'gsdd-new-project.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.doesNotMatch(output, /--tools codex` is deprecated/i);

    // Portable skill must NOT be polluted with vendor-specific content after --tools all
    const portableSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.doesNotMatch(portableSkill, /Codex-Native/);
    assert.doesNotMatch(portableSkill, /spawn_agent/);
    assert.doesNotMatch(portableSkill, /\.codex\/agents\//);
    // But it MUST have checker invocation (the Codex entry surface)
    assert.match(portableSkill, /Invoking the Checker/);
    assert.match(portableSkill, /gsdd-plan-checker/);

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

    const opencodeApproachExplorer = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'agents', 'gsdd-approach-explorer.md'),
      'utf-8'
    );
    assert.match(opencodeApproachExplorer, /^mode: subagent/m);
    assert.doesNotMatch(opencodeApproachExplorer, /^mode: agent/m);

    const codexPlanChecker = fs.readFileSync(
      path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
      'utf-8'
    );
    assert.match(codexPlanChecker, /^name = "gsdd-plan-checker"/m);
    assert.match(codexPlanChecker, /^sandbox_mode = "read-only"/m);
    assert.match(codexPlanChecker, /^model_reasoning_effort = "high"/m);
    assert.match(codexPlanChecker, /Return JSON only/);
  });

  test('init with --tools codex generates checker agent and portable skill is the entry surface', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });

    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-planner.toml')));
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.claude', 'skills')), false);

    // Portable skill must stay vendor-neutral but include checker invocation
    const portableSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.doesNotMatch(portableSkill, /Codex-Native/);
    assert.doesNotMatch(portableSkill, /spawn_agent/);
    assert.doesNotMatch(portableSkill, /\.codex\/agents\//);
    assert.match(portableSkill, /How Plan Checking Works/);
    assert.match(portableSkill, /Invoking the Checker/);
    assert.match(portableSkill, /Maximum 3 checker cycles total/);
  });

  test('choice list redraws in place on arrow navigation', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Select runtimes',
      hint: 'Space toggles, Enter confirms.',
      multi: true,
      choices: [
        { id: 'claude', label: 'Claude', description: 'Native', selected: true, detected: true },
        { id: 'cursor', label: 'Cursor', description: 'Skills-native', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'down' });
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, ['claude']);
    assert.match(output.buffer, /\x1b\[\d+A/, 'rerender should move the cursor back up before repainting');
  });

  test('choice list resumes stdin before waiting for keypresses', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Select runtimes',
      multi: false,
      choices: [
        { value: 'claude', label: 'Claude', description: 'Native', selected: true, detected: false },
        { value: 'cursor', label: 'Cursor', description: 'Skills-native', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, ['claude']);
    assert.ok(input.resumeCalls >= 1, 'selector should resume stdin before listening for keypresses');
  });

  test('choice list restores raw mode and rejects on Ctrl+C', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Select runtimes',
      multi: true,
      choices: [
        { value: 'claude', label: 'Claude', description: 'Native', selected: true, detected: false },
        { value: 'cursor', label: 'Cursor', description: 'Skills-native', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '\u0003', { ctrl: true, name: 'c' });
    });

    await assert.rejects(selectionPromise, /Prompt cancelled by user/);
    assert.strictEqual(input.isRaw, false, 'Ctrl+C should restore raw mode before rejecting');
  });

  test('single-select confirms the highlighted option on Enter', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Research depth',
      multi: false,
      choices: [
        { value: 'balanced', label: 'balanced', description: 'Recommended', selected: true, detected: false },
        { value: 'fast', label: 'fast', description: 'Faster', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'down' });
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, ['fast']);
  });

  test('choice list accounts for wrapped descriptions when rerendering', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();
    output.columns = 24;

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Planning docs in git',
      multi: false,
      choices: [
        { value: true, label: 'yes', description: 'Track .planning/ in git for history and team recovery.', selected: true, detected: false },
        { value: false, label: 'no', description: 'Keep planning docs local only and out of version control.', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'down' });
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, [false]);
    assert.match(output.buffer, /\x1b\[(1[0-9]|[2-9])A/, 'rerender should move up by the wrapped visual height, not a fixed small count');
  });

  test('interactive wizard can select skills-native runtimes without forcing AGENTS.md', async () => {
    const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
    const ctx = gsddMod.createCliContext(tmpDir);
    ctx.initPromptApi = {
      async runInitWizard() {
        return {
          selectedRuntimes: ['cursor', 'codex'],
          adapterTargets: ['codex'],
          config: {
            researchDepth: 'balanced',
            parallelization: true,
            commitDocs: true,
            modelProfile: 'balanced',
            workflow: { research: true, discuss: false, planCheck: true, verifier: true },
            gitProtocol: {
              branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
              commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
              pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
            },
            initVersion: 'v1.1',
          },
        };
      },
      async promptForConfig() {
        throw new Error('promptForConfig should not run when wizard already returned config');
      },
    };

    let output = '';
    const previousLog = console.log;
    const restoreStdin = setInteractiveStdin();
    console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
    try {
      const cmdInit = initMod.createCmdInit(ctx);
      await cmdInit();
    } finally {
      console.log = previousLog;
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml')));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')),
      'Wizard runtime selection must not write AGENTS.md unless governance was explicitly enabled.');
    assert.match(output, /Cursor:\s+\/gsdd-new-project/);
    assert.match(output, /Codex CLI:\s+\$gsdd-new-project/);
  });

  test('interactive wizard governance opt-in writes AGENTS.md separately from runtime choice', async () => {
    const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
    const ctx = gsddMod.createCliContext(tmpDir);
    ctx.initPromptApi = {
      async runInitWizard() {
        return {
          selectedRuntimes: ['cursor'],
          adapterTargets: ['agents'],
          config: {
            researchDepth: 'balanced',
            parallelization: true,
            commitDocs: true,
            modelProfile: 'balanced',
            workflow: { research: true, discuss: false, planCheck: true, verifier: true },
            gitProtocol: {
              branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
              commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
              pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
            },
            initVersion: 'v1.1',
          },
        };
      },
      async promptForConfig() {
        throw new Error('promptForConfig should not run when wizard already returned config');
      },
    };

    const restoreStdin = setInteractiveStdin();
    try {
      const cmdInit = initMod.createCmdInit(ctx);
      await cmdInit();
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex')),
      'Selecting governance without Codex must not generate unrelated native adapters.');
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
    assert.strictEqual((agents.match(/<!-- BEGIN GSDD -->/g) || []).length, 1);
    assert.strictEqual((agents.match(/<!-- END GSDD -->/g) || []).length, 1);
    assert.match(agents, /# Local Rules/);
    assert.doesNotMatch(agents, /old block/);
  });

  test('legacy --tools cursor still writes AGENTS.md for backward compatibility', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'cursor');
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.claude')));
  });

  test('update refreshes previously generated adapters based on detected platforms', async () => {
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

  test('update with --tools codex regenerates Codex checker agent', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;
    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const checkerPath = path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml');
    fs.writeFileSync(checkerPath, 'stale checker\n');

    await gsdd.cmdUpdate('--tools', 'codex');

    const updatedChecker = fs.readFileSync(checkerPath, 'utf-8');
    assert.doesNotMatch(updatedChecker, /^stale checker$/m);
    assert.match(updatedChecker, /^name = "gsdd-plan-checker"/m);
    assert.match(updatedChecker, /^sandbox_mode = "read-only"/m);
  });

  test('cli entrypoint still runs when invoked through an aliased bin path', async () => {
    const result = await runCliViaJunction(tmpDir, ['help']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Usage: gsdd <command> \[args\]/);
    assert.match(result.output, /Commands:/);
    assert.match(result.output, /claude\s+Generate Claude Code skills .* native agents/);
    assert.match(result.output, /codex\s+Generate Codex CLI native/);
  });

  describe('auto mode', () => {
    test('--auto --tools claude produces config with autoAdvance', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.autoAdvance, true);
      assert.strictEqual(config.researchDepth, 'balanced');
      assert.strictEqual(config.parallelization, true);
      assert.deepStrictEqual(config.workflow, { research: true, discuss: false, planCheck: true, verifier: true });
    });

    test('--auto without --tools sets exitCode 1', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /--tools/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('--auto config has same shape as interactive defaults', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      const expectedKeys = [
        'researchDepth',
        'parallelization',
        'commitDocs',
        'modelProfile',
        'workflow',
        'gitProtocol',
        'initVersion',
        'autoAdvance',
      ];
      for (const key of expectedKeys) {
        assert.ok(key in config, `config.json missing expected key: ${key}`);
      }
      assert.strictEqual(config.initVersion, 'v1.1');
    });

    test('--brief copies file to .planning/PROJECT_BRIEF.md', async () => {
      const briefContent = '# Project Brief\n\nBuild a task manager app.\n';
      fs.writeFileSync(path.join(tmpDir, 'my-brief.md'), briefContent);

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', 'my-brief.md');
      } finally {
        restoreStdin();
      }

      const briefDest = path.join(tmpDir, '.planning', 'PROJECT_BRIEF.md');
      assert.ok(fs.existsSync(briefDest));
      assert.strictEqual(fs.readFileSync(briefDest, 'utf-8'), briefContent);
    });

    test('--brief with absolute path copies file to .planning/PROJECT_BRIEF.md', async () => {
      const briefContent = '# Brief\n\nAbsolute path test.\n';
      const absPath = path.join(tmpDir, 'abs-brief.md');
      fs.writeFileSync(absPath, briefContent);

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', absPath);
      } finally {
        restoreStdin();
      }

      const briefDest = path.join(tmpDir, '.planning', 'PROJECT_BRIEF.md');
      assert.ok(fs.existsSync(briefDest));
      assert.strictEqual(fs.readFileSync(briefDest, 'utf-8'), briefContent);
    });

    test('re-running --auto when config exists preserves existing config', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
        const configPath = path.join(tmpDir, '.planning', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.researchDepth = 'deep';
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        await gsdd.cmdInit('--auto', '--tools', 'claude');
        const reread = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        assert.strictEqual(reread.researchDepth, 'deep', 're-init must not overwrite existing config');
      } finally {
        restoreStdin();
      }
    });

    test('--brief with missing file sets exitCode 1', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', 'nonexistent.md');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /not found/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('--brief followed by another flag sets exitCode 1 and does not write config', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', '--auto');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /--brief requires a file path/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('--tools followed by another flag sets exitCode 1 and does not write config', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', '--brief', 'idea.md');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /--tools requires a value/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });
  });

  describe('partial .planning/ resilience', () => {
    test('init creates phases/ and research/ even when .planning/ already exists', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'phases')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'research')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('init after pre-init guard rejection creates complete structure', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'phases')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'research')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });
  });
});
