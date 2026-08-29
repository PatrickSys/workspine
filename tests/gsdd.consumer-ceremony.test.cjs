const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliAsMain,
  setNonInteractiveStdin,
} = require('./gsdd.helpers.cjs');

async function importModule(filePath) {
  return import(`${pathToFileURL(filePath).href}?t=${Date.now()}-${Math.random()}`);
}

async function runWizardInit(tmpDir, { selectedRuntimes = ['claude'], adapterTargets = ['claude'], rigor = 'balanced', cost = 'balanced', commitDocs = true } = {}) {
  const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
  const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
  const models = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'config.mjs'));
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
          rigorProfile: rigor,
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

  return { callLog, config: readJson(path.join(tmpDir, '.work', 'config.json')) };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function runProcess(command, args, cwd) {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    command,
    args,
    cwd,
    exitCode: result.status === null ? -1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function writePlanPathBaseline(filePath, receipt) {
  if (fs.existsSync(filePath)) return;
  const lines = [
    '---',
    `head: ${receipt.head}`,
    `package_sha256: ${receipt.package_sha256}`,
    `generated_skill_sha256: ${receipt.generated_skill_sha256}`,
    `command: ${JSON.stringify(receipt.command)}`,
    `exit: ${receipt.exit}`,
    `disposition: ${receipt.disposition}`,
    ...(receipt.failure_code ? [`failure_code: ${receipt.failure_code}`] : []),
    `output_sha256: ${receipt.output_sha256}`,
    '---',
    '',
    '# Plan path characterization baseline',
    '',
    'The receipt is retained from the first packed-candidate run and is not rewritten by reruns.',
    '',
    '```text',
    receipt.output,
    '```',
    '',
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'), { flag: 'wx' });
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
    assert.ok(!('showCode' in config.workflow));
    assert.ok(!('askBeforeDecide' in config.workflow));
    assert.deepStrictEqual(Object.keys(config.gitProtocol).sort(), ['branch', 'commit', 'pr']);
  });

  test('wizard rigor and cost axes are orthogonal', async () => {
    const { config } = await runWizardInit(tmpDir, { rigor: 'thorough', cost: 'budget' });
    assert.strictEqual(config.researchDepth, 'deep');
    assert.strictEqual(config.workflow.discuss, true);
    assert.strictEqual(config.modelProfile, 'budget');
    assert.strictEqual(config.parallelization, false);
  });

  test('packed work-execute plan identity characterization', () => {
    const packageRoot = path.join(__dirname, '..');
    const packDir = path.join(tmpDir, 'pack');
    const consumerRoot = path.join(tmpDir, 'packed-consumer');
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(consumerRoot, { recursive: true });

    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
    const npmArgs = process.platform === 'win32' ? [npmCli] : [];
    const pack = runProcess(npmCommand, [
      ...npmArgs,
      'pack', '--json', '--ignore-scripts', '--pack-destination', packDir,
    ], packageRoot);
    assert.strictEqual(pack.exitCode, 0, pack.stderr || pack.stdout);
    const packRecords = JSON.parse(pack.stdout);
    assert.strictEqual(packRecords.length, 1);
    const tarballPath = path.join(packDir, packRecords[0].filename);
    const packageSha256 = sha256(fs.readFileSync(tarballPath));

    const install = runProcess(npmCommand, [
      ...npmArgs,
      'install', '--prefix', consumerRoot, tarballPath,
      '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund',
    ], packageRoot);
    assert.strictEqual(install.exitCode, 0, install.stderr || install.stdout);
    assert.strictEqual(runProcess('git', ['init', '--quiet'], consumerRoot).exitCode, 0);

    const initEntry = path.join(consumerRoot, 'node_modules', 'workspine', 'bin', 'gsdd.mjs');
    const init = runProcess(process.execPath, [initEntry, 'init', '--auto', '--tools', 'agents'], consumerRoot);
    assert.strictEqual(init.exitCode, 0, init.stderr || init.stdout);

    const phaseDir = path.join(consumerRoot, '.work', 'phases', '16-packed-consumer');
    const planPath = path.join(phaseDir, '16-10-01-PLAN.md');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(planPath, [
      '---',
      'phase: 16',
      'plan: 10-01',
      'status: approved',
      '---',
      '',
      '# Packed consumer plan',
      '',
      'A real plan artifact used to characterize generated execute guidance.',
      '',
    ].join('\n'));

    const skillPath = path.join(consumerRoot, '.agents', 'skills', 'work-execute', 'SKILL.md');
    const skill = fs.readFileSync(skillPath, 'utf8');
    assert.ok(skill.includes('lifecycle-preflight execute {phase_num} --expects-mutation phase-status'),
      'generated execute skill must retain the positional execute preflight command');
    assert.ok(skill.includes('emitted positional `phases/{phase_dir}` selector'),
      'generated execute skill must retain the emitted positional phase selector guidance');
    assert.doesNotMatch(skill, /--plan phases\//, 'generated execute skill must not emit bare plan paths');
    assert.doesNotMatch(skill, /--artifact phases\//, 'generated execute skill must not emit bare artifact paths');
    const commandMatch = skill.match(/node \.work\/bin\/gsdd\.mjs lifecycle-transition execute --plan \.work\/phases\/\{phase_dir\}\/\{plan_id\}-PLAN\.md --authority workflow --json/);
    assert.ok(commandMatch, 'generated work-execute skill must contain the lifecycle transition command');
    const commandText = commandMatch[0]
      .replace('.work/phases/{phase_dir}/{plan_id}-PLAN.md', '.work/phases/16-packed-consumer/16-10-01-PLAN.md');
    const commandParts = commandText.split(' ');
    const transition = runProcess(process.execPath, [
      path.join(consumerRoot, '.work', 'bin', 'gsdd.mjs'),
      ...commandParts.slice(2),
    ], consumerRoot);
    const summaryPath = path.join(phaseDir, '16-10-01-SUMMARY.md');
    fs.writeFileSync(summaryPath, [
      '---',
      'status: complete',
      '---',
      '',
      '# Packed consumer execution summary',
      '',
      'A substantive execution artifact used to prove the generated verify transition.',
      '',
    ].join('\n'));
    const verifyCommandMatch = skill.match(/node \.work\/bin\/gsdd\.mjs lifecycle-transition verify --plan \.work\/phases\/\{phase_dir\}\/\{plan_id\}-PLAN\.md --artifact \.work\/phases\/\{phase_dir\}\/\{plan_id\}-SUMMARY\.md --authority workflow --json/);
    assert.ok(verifyCommandMatch, 'generated work-execute skill must contain the verify transition command');
    const verifyCommandText = verifyCommandMatch[0]
      .replace('.work/phases/{phase_dir}/{plan_id}-PLAN.md', '.work/phases/16-packed-consumer/16-10-01-PLAN.md')
      .replace('.work/phases/{phase_dir}/{plan_id}-SUMMARY.md', '.work/phases/16-packed-consumer/16-10-01-SUMMARY.md');
    const verifyParts = verifyCommandText.split(' ');
    const verifyTransition = runProcess(process.execPath, [
      path.join(consumerRoot, '.work', 'bin', 'gsdd.mjs'),
      ...verifyParts.slice(2),
    ], consumerRoot);
    assert.strictEqual(verifyTransition.exitCode, 0, `${verifyTransition.stdout}${verifyTransition.stderr}`);

    const output = `${transition.stdout}${transition.stderr}`;
    let parsedOutput = null;
    try {
      parsedOutput = JSON.parse(transition.stdout);
    } catch {
      // The receipt retains the raw output; the assertion below reports malformed output.
    }
    const head = runProcess('git', ['-C', packageRoot, 'rev-parse', 'HEAD'], packageRoot).stdout.trim();
    const receipt = {
      head,
      package_sha256: packageSha256,
      generated_skill_sha256: sha256(Buffer.from(skill)),
      command: commandText,
      exit: transition.exitCode,
      disposition: transition.exitCode === 0 ? 'no_change' : 'reproduced_red',
      ...(parsedOutput?.error_code ? { failure_code: parsedOutput.error_code } : {}),
      output_sha256: sha256(Buffer.from(output)),
      output,
    };
    writePlanPathBaseline(
      path.join(packageRoot, '.work', 'phases', '16-safe-cohesive-first-run', '16-10-01-PLAN-PATH-BASELINE.md'),
      receipt,
    );

    assert.strictEqual(transition.exitCode, 0, output);
    assert.ok(!parsedOutput?.error_code, output);
  });

  test('rigor show exposes the production requested/effective receipt policy', async () => {
    await runWizardInit(tmpDir, { rigor: 'max' });
    const result = await runCliAsMain(tmpDir, ['rigor', 'show']);
    assert.strictEqual(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);

    assert.strictEqual(payload.requested_level, 'max');
    assert.strictEqual(payload.effective_level, 'high');
    assert.deepStrictEqual(payload.effective_levels, { plan: 'high', execute: 'high', verify: 'high' });
    assert.strictEqual(payload.policy.path, 'frontier-alignment-preview-verification');
    assert.strictEqual(payload.policy.headless_missing_interaction, 'unresolved');
    assert.strictEqual(payload.policy.unknown_is_pass, false);
    assert.strictEqual(payload.policy.preview_limit, 2);
    assert.deepStrictEqual(payload.policy.receipt_fields, [
      'schema_version', 'phase', 'task', 'requested_level', 'effective_level',
      'interactive', 'frontier_questions', 'agent_discretion_exemptions',
      'alignment', 'plan_check', 'execution', 'verification', 'claim_limit',
      'terminal_result', 'next_action',
    ]);
  });

  test('wizard resolves all 9 rigor/cost combinations correctly', async () => {
    const models = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'config.mjs'));
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

  test('consumer AGENTS.md stays within 15-27 lines and keeps routing hints', async () => {
    await runWizardInit(tmpDir, { selectedRuntimes: ['cursor'], adapterTargets: ['agents'] });
    const agents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    const lines = agents.split('\n').length;

    assert.ok(lines >= 15 && lines <= 27, `expected 15-27 lines, got ${lines}`);
    for (const token of ['work-new-project', 'work-plan', 'work-execute', 'work-verify', 'work-progress', '/work-plan', '$work-plan', 'npx -y workspine init', 'npx -y workspine health', 'npx -y workspine update']) {
      assert.match(agents, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(agents, /plan-only|execution begins only after an explicit .*work-execute/i);
  });

  test('update preserves content below END GSDD marker', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      const agentsPath = path.join(tmpDir, 'AGENTS.md');
      fs.writeFileSync(agentsPath, `${fs.readFileSync(agentsPath, 'utf8')}\n## Local Notes\nDo not remove.\n`);
      await gsdd.cmdUpdate();
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

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
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
