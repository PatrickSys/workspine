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

    const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
    assert.strictEqual(config.researchDepth, 'balanced');
    assert.strictEqual(config.parallelization, true);
    assert.strictEqual(config.commitDocs, true);
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
    assert.match(mapperTechTemplate, /\.agents\/skills\/gsdd-map-codebase\/SKILL\.md/);
    assert.doesNotMatch(mapperTechTemplate, /active platform skill\/adapter/);
  });

  test('init with explicit tools generates requested adapters', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude,codex,opencode,agents');
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'gsdd-new-project', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'commands', 'gsdd-new-project.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
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

  test('update refreshes previously generated adapters based on detected platforms', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;

    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const codexPath = path.join(tmpDir, '.codex', 'AGENTS.md');
    fs.writeFileSync(codexPath, 'stale adapter\n');

    await gsdd.cmdUpdate();

    const updated = fs.readFileSync(codexPath, 'utf-8');
    assert.doesNotMatch(updated, /^stale adapter$/m);
    assert.match(updated, /GSDD/);
  });

  test('cli entrypoint still runs when invoked through an aliased bin path', async () => {
    const result = await runCliViaJunction(tmpDir, ['help']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Usage: gsdd <command> \[args\]/);
    assert.match(result.output, /Commands:/);
  });
});
