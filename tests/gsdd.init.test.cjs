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
  const match = content.match(/<task id="N-01">[\s\S]*?<\/task>/);
  assert.ok(match, 'Missing canonical example task');
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

    const planSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.doesNotMatch(planSkill, /AUDIT STATUS: This workflow is a stub/);
    assert.match(planSkill, /How Plan Checking Works/);
    assert.match(planSkill, /independent checker may review it in fresh context/i);
    assert.match(planSkill, /at least one runnable command/i);
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
