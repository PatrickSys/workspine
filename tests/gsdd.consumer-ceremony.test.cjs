const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

async function importModule(filePath) {
  return import(`${pathToFileURL(filePath).href}?t=${Date.now()}-${Math.random()}`);
}

async function runWizardInit(tmpDir, { selectedRuntimes = ['claude'], adapterTargets = ['claude'], rigor = 'balanced', cost = 'balanced', commitDocs = true } = {}) {
  const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
  const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
  const models = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'models.mjs'));
  const ctx = gsddMod.createCliContext(tmpDir);
  const callLog = [];

  ctx.initPromptApi = {
    async runInitWizard() {
      callLog.push('runtimes');
      callLog.push('agentsGovernance');
      callLog.push('rigor');
      callLog.push('cost');
      callLog.push('commitDocs');
      return {
        selectedRuntimes,
        adapterTargets,
        config: {
          ...models.resolveRigor(rigor),
          ...models.resolveCost(cost),
          commitDocs,
          gitProtocol: { ...models.DEFAULT_GIT_PROTOCOL },
          initVersion: 'v1.1',
        },
      };
    },
    async promptForConfig() {
      throw new Error('promptForConfig should not run when wizard already returned config');
    },
  };

  const restoreStdin = (() => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    return () => {
      if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
      else delete process.stdin.isTTY;
    };
  })();

  try {
    const cmdInit = initMod.createCmdInit(ctx);
    await cmdInit();
  } finally {
    restoreStdin();
  }

  return { callLog, config: readJson(path.join(tmpDir, '.planning', 'config.json')) };
}

describe('consumer ceremony reduction', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('wizard init uses exactly five visible prompts and balanced defaults', async () => {
    const { callLog, config } = await runWizardInit(tmpDir);

    assert.deepStrictEqual(callLog, ['runtimes', 'agentsGovernance', 'rigor', 'cost', 'commitDocs']);
    assert.strictEqual(config.researchDepth, 'balanced');
    assert.strictEqual(config.modelProfile, 'balanced');
    assert.strictEqual(config.parallelization, true);
    assert.strictEqual(config.workflow.research, true);
    assert.strictEqual(config.workflow.discuss, false);
    assert.strictEqual(config.workflow.planCheck, true);
    assert.strictEqual(config.workflow.verifier, true);
    assert.deepStrictEqual(Object.keys(config.gitProtocol).sort(), ['branch', 'commit', 'pr']);
  });

  test('wizard rigor and cost axes are orthogonal', async () => {
    const { config } = await runWizardInit(tmpDir, { rigor: 'thorough', cost: 'budget' });
    assert.strictEqual(config.researchDepth, 'deep');
    assert.strictEqual(config.workflow.discuss, true);
    assert.strictEqual(config.modelProfile, 'budget');
    assert.strictEqual(config.parallelization, false);
  });

  test('wizard resolves all 9 rigor/cost combinations correctly', async () => {
    const models = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'models.mjs'));
    for (const rigor of Object.keys(models.RIGOR_PROFILES)) {
      for (const cost of Object.keys(models.COST_PROFILES)) {
        const comboDir = createTempProject();
        try {
          const { config } = await runWizardInit(comboDir, { rigor, cost });
          assert.strictEqual(config.researchDepth, models.RIGOR_PROFILES[rigor].researchDepth, `${rigor}/${cost} researchDepth`);
          assert.deepStrictEqual(config.workflow, models.RIGOR_PROFILES[rigor].workflow, `${rigor}/${cost} workflow`);
          assert.strictEqual(config.modelProfile, models.COST_PROFILES[cost].modelProfile, `${rigor}/${cost} modelProfile`);
          assert.strictEqual(config.parallelization, models.COST_PROFILES[cost].parallelization, `${rigor}/${cost} parallelization`);
        } finally {
          cleanup(comboDir);
        }
      }
    }
  });

  test('consumer AGENTS.md stays within 15-25 lines and keeps routing hints', async () => {
    await runWizardInit(tmpDir, { selectedRuntimes: ['cursor'], adapterTargets: ['agents'] });
    const agents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    const lines = agents.split('\n').length;

    assert.ok(lines >= 15 && lines <= 25, `expected 15-25 lines, got ${lines}`);
    for (const token of ['gsdd-new-project', 'gsdd-plan', 'gsdd-execute', 'gsdd-verify', 'gsdd-progress', '/gsdd-plan', '$gsdd-plan']) {
      assert.match(agents, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(agents, /plan-only|execution begins only after an explicit .*gsdd-execute/i);
  });

  test('update preserves content below END GSDD marker', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      const agentsPath = path.join(tmpDir, 'AGENTS.md');
      fs.writeFileSync(agentsPath, `${fs.readFileSync(agentsPath, 'utf8')}\n## Local Notes\nDo not remove.\n`);
      await gsdd.cmdUpdate('--tools', 'agents');
      const updated = fs.readFileSync(agentsPath, 'utf8');
      assert.match(updated, /## Local Notes/);
      assert.match(updated, /Do not remove\./);
    } finally {
      restoreStdin();
    }
  });

  for (const runtime of ['claude', 'opencode', 'codex']) {
    test(`auto init for ${runtime} writes complete config schema`, async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', runtime);
      } finally {
        restoreStdin();
      }

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.ok('researchDepth' in config);
      assert.ok('parallelization' in config);
      assert.ok('commitDocs' in config);
      assert.ok('modelProfile' in config);
      assert.ok('workflow' in config);
      assert.ok('research' in config.workflow);
      assert.ok('discuss' in config.workflow);
      assert.ok('planCheck' in config.workflow);
      assert.ok('verifier' in config.workflow);
      assert.ok('gitProtocol' in config);
      assert.ok('branch' in config.gitProtocol);
      assert.ok('commit' in config.gitProtocol);
      assert.ok('pr' in config.gitProtocol);
      assert.ok('initVersion' in config);
      assert.strictEqual(config.workflow.verifier, true);
    });
  }
});
