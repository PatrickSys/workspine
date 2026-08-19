/**
 * GSDD CLI Tests - Models
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
  runCliAsMain,
  setNonInteractiveStdin,
  withEnv,
} = require('./gsdd.helpers.cjs');

function writeProjectConfig(projectDir, config) {
  fs.mkdirSync(path.join(projectDir, '.work'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.work', 'config.json'),
    JSON.stringify({
      researchDepth: 'balanced',
      parallelization: true,
      commitDocs: true,
      workflow: { research: true, planCheck: true, verifier: true },
      gitProtocol: { branch: '', commit: '', pr: '' },
      initVersion: 'v1.1',
      ...config,
    }, null, 2)
  );
}

function writeOpenCodeConfig(projectDir, config) {
  fs.writeFileSync(path.join(projectDir, 'opencode.json'), JSON.stringify(config, null, 2));
}

function snapshotTree(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.join(prefix, entry.name).replace(/\\/g, '/');
      return entry.isDirectory()
        ? [{ path: `${relativePath}/`, directory: true }, ...snapshotTree(fullPath, relativePath)]
        : [{ path: relativePath, bytes: fs.readFileSync(fullPath).toString('base64') }];
    });
}

describe('gsdd models and model propagation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe('model profile propagation', () => {
    test('quality profile injects model: opus into Claude plan-checker', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'quality' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: opus$/m);
    });

    test('balanced profile (default --auto) injects model: sonnet into Claude plan-checker', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: sonnet$/m);
    });

    test('budget profile injects model: haiku into Claude plan-checker', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'budget' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: haiku$/m);
    });

    test('OpenCode omits model by default even when runtime config exists', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-opus-4-5' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);
    });

    test('OpenCode runtime override injects exact model id verbatim', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { opencode: { 'plan-checker': 'anthropic/claude-opus-4-6' } },
      });
      writeOpenCodeConfig(tmpDir, { model: 'openai/gpt-5' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: anthropic\/claude-opus-4-6$/m);
    });

    test('OpenCode semantic agent profile alone does not inject runtime model', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        agentModelProfiles: { 'plan-checker': 'quality' },
      });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-sonnet-4-5' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);
    });

    test('OpenCode update re-renders model after runtime override changes', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'openai/gpt-5' });

      let gsdd;
      const restoreStdin = setNonInteractiveStdin();
      try {
        gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      let checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);

      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { opencode: { 'plan-checker': 'openai/gpt-5.2' } },
      });
      await gsdd.cmdUpdate('--tools', 'opencode');

      checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: openai\/gpt-5\.2$/m);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      delete config.runtimeModelOverrides;
      fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), JSON.stringify(config, null, 2));
      await gsdd.cmdUpdate('--tools', 'opencode');

      checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);
    });

    test('Claude semantic agent profile overrides global model profile', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'budget',
        agentModelProfiles: { 'plan-checker': 'quality' },
      });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: opus$/m);
    });

    test('Codex omits model by default (inherits from parent session)', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'codex');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'), 'utf-8');
      assert.doesNotMatch(checker, /^model = /m);
    });

    test('Codex runtime override injects exact model id into plan-checker TOML', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { codex: { 'plan-checker': 'gpt-5-codex' } },
      });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'codex');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'), 'utf-8');
      assert.match(checker, /^model = "gpt-5-codex"$/m);
    });

    test('Codex update re-renders model after runtime override changes', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });

      let gsdd;
      const restoreStdin = setNonInteractiveStdin();
      try {
        gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'codex');
      } finally {
        restoreStdin();
      }

      let checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'), 'utf-8');
      assert.doesNotMatch(checker, /^model = /m);

      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { codex: { 'plan-checker': 'gpt-5-codex' } },
      });
      await gsdd.cmdUpdate('--tools', 'codex');

      checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'), 'utf-8');
      assert.match(checker, /^model = "gpt-5-codex"$/m);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      delete config.runtimeModelOverrides;
      fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), JSON.stringify(config, null, 2));
      await gsdd.cmdUpdate('--tools', 'codex');

      checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'), 'utf-8');
      assert.doesNotMatch(checker, /^model = /m);
    });

    test('Claude runtime override wins over semantic profile', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'quality',
        runtimeModelOverrides: { claude: { 'plan-checker': 'haiku' } },
      });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: haiku$/m);
    });
  });

  describe('models command', () => {
    test('models show reports effective runtime model state', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'quality',
        agentModelProfiles: { 'plan-checker': 'budget' },
        runtimeModelOverrides: { opencode: { 'plan-checker': 'anthropic/claude-opus-4-6' } },
      });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-sonnet-4-5' });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.strictEqual(payload.modelProfile, 'quality');
      assert.strictEqual(payload.agentModelProfiles['plan-checker'], 'budget');
      assert.strictEqual(payload.runtimeModelOverrides.opencode['plan-checker'], 'anthropic/claude-opus-4-6');
      assert.deepStrictEqual(payload.effective.claude['plan-checker'], {
        mode: 'mapped',
        model: 'haiku',
        source: 'agentModelProfile',
      });
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'override',
        model: 'anthropic/claude-opus-4-6',
        runtimeDetectedModel: 'anthropic/claude-sonnet-4-5',
      });
      assert.strictEqual(payload.detectedRuntimeModels.opencode, 'anthropic/claude-sonnet-4-5');
    });

    test('models profile writes global modelProfile', async () => {
      writeProjectConfig(tmpDir, {});
      const result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.modelProfile, 'quality');
    });

    test('rigor max remains a compatibility input but resets to the current high gates', async () => {
      writeProjectConfig(tmpDir, {});
      const result = await runCliAsMain(tmpDir, ['rigor', 'max']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.rigorProfile, 'max');
      assert.strictEqual(config.researchDepth, 'deep');
      assert.deepStrictEqual(config.workflow, {
        research: true,
        discuss: true,
        planCheck: true,
        verifier: true,
      });
    });

    test('rigor show preserves legacy keys while reporting them as ignored no-ops', async () => {
      writeProjectConfig(tmpDir, {
        rigorProfile: 'max',
        workflow: {
          research: true,
          discuss: true,
          planCheck: true,
          verifier: true,
          showCode: true,
          askBeforeDecide: true,
        },
      });
      const configPath = path.join(tmpDir, '.work', 'config.json');
      const before = fs.readFileSync(configPath, 'utf-8');

      const result = await runCliAsMain(tmpDir, ['rigor', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective, { plan: 'high', execute: 'high', verify: 'high' });
      assert.deepStrictEqual(payload.workflow, {
        research: true,
        discuss: true,
        planCheck: true,
        verifier: true,
      });
      assert.deepStrictEqual(payload.deprecatedNoOps, {
        showCode: 'ignored deprecated no-op',
        askBeforeDecide: 'ignored deprecated no-op',
      });
      assert.match(payload.compatibility.max, /uses the current high rigor gates/i);
      assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), before);
    });

    test('explicit rigor reset replaces legacy workflow keys with the canonical active shape', async () => {
      writeProjectConfig(tmpDir, {
        workflow: {
          research: true,
          discuss: true,
          planCheck: true,
          verifier: true,
          showCode: true,
          askBeforeDecide: true,
        },
      });

      const result = await runCliAsMain(tmpDir, ['rigor', 'high']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.deepStrictEqual(config.workflow, {
        research: true,
        discuss: true,
        planCheck: true,
        verifier: true,
      });
    });

    test('rigor <step> <level> writes a per-step override without touching the base level', async () => {
      writeProjectConfig(tmpDir, { rigorProfile: 'medium' });
      const result = await runCliAsMain(tmpDir, ['rigor', 'verify', 'low']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.rigorProfile, 'medium');
      assert.strictEqual(config.rigorOverrides.verify, 'low');
    });

    test('rigor rejects an invalid argument with a nonzero exit', async () => {
      writeProjectConfig(tmpDir, {});
      const result = await runCliAsMain(tmpDir, ['rigor', 'bogus']);
      assert.strictEqual(result.exitCode, 1);
    });

    test('models agent-profile writes semantic agent override', async () => {
      writeProjectConfig(tmpDir, {});
      const result = await runCliAsMain(tmpDir, ['models', 'agent-profile', '--agent', 'plan-checker', '--profile', 'quality']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.agentModelProfiles['plan-checker'], 'quality');
    });

    test('models set writes runtime override and clear removes it', async () => {
      writeProjectConfig(tmpDir, {});
      let result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'opencode', '--agent', 'plan-checker', '--model', 'anthropic/claude-opus-4-6']);
      assert.strictEqual(result.exitCode, 0);

      let config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides.opencode['plan-checker'], 'anthropic/claude-opus-4-6');

      result = await runCliAsMain(tmpDir, ['models', 'clear', '--runtime', 'opencode', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 0);

      config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides, undefined);
    });

    test('models clear-agent-profile removes semantic override only', async () => {
      writeProjectConfig(tmpDir, {});
      await runCliAsMain(tmpDir, ['models', 'agent-profile', '--agent', 'plan-checker', '--profile', 'quality']);
      const result = await runCliAsMain(tmpDir, ['models', 'clear-agent-profile', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.agentModelProfiles, undefined);
    });

    test('models show displays inherited model when no OpenCode override exists', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-sonnet-4-5' });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'inherit',
        model: null,
        runtimeDetectedModel: 'anthropic/claude-sonnet-4-5',
      });
      assert.ok(payload.hints);
      assert.ok(payload.hints.opencode);
      assert.match(payload.hints.opencode, /OpenCode currently inherits its runtime model/);
    });

    test('models show displays no-detection message when no OpenCode config exists', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'inherit',
        model: null,
        runtimeDetectedModel: null,
      });
      assert.ok(payload.hints);
      assert.ok(payload.hints.opencode);
    });

    test('models show omits hints when all OpenCode runtime overrides exist', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { opencode: { 'plan-checker': 'anthropic/claude-opus-4-6', 'approach-explorer': 'anthropic/claude-opus-4-6' } },
      });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'override',
        model: 'anthropic/claude-opus-4-6',
        runtimeDetectedModel: null,
      });
      assert.strictEqual(payload.hints, undefined);
    });

    test('models show detects OpenCode model from OPENCODE_CONFIG', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      const customConfigPath = path.join(tmpDir, 'custom-opencode.json');
      fs.writeFileSync(customConfigPath, JSON.stringify({ model: 'openai/gpt-5.2' }, null, 2));

      const result = await withEnv({ OPENCODE_CONFIG: customConfigPath }, async () => (
        runCliAsMain(tmpDir, ['models', 'show'])
      ));
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'inherit',
        model: null,
        runtimeDetectedModel: 'openai/gpt-5.2',
      });
      assert.strictEqual(payload.detectedRuntimeModels.opencode, 'openai/gpt-5.2');
    });

    test('models show lets OPENCODE_CONFIG_CONTENT override file config', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-sonnet-4-5' });

      const result = await withEnv({
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'openai/gpt-5.2' }),
      }, async () => runCliAsMain(tmpDir, ['models', 'show']));
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'inherit',
        model: null,
        runtimeDetectedModel: 'openai/gpt-5.2',
      });
      assert.strictEqual(payload.detectedRuntimeModels.opencode, 'openai/gpt-5.2');
    });

    test('models show falls back to file config when OPENCODE_CONFIG_CONTENT is malformed', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-sonnet-4-5' });

      const result = await withEnv({
        OPENCODE_CONFIG_CONTENT: '{not valid json',
      }, async () => runCliAsMain(tmpDir, ['models', 'show']));
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'inherit',
        model: null,
        runtimeDetectedModel: 'anthropic/claude-sonnet-4-5',
      });
      assert.strictEqual(payload.detectedRuntimeModels.opencode, 'anthropic/claude-sonnet-4-5');
    });

    test('models show includes codex effective state', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.codex['plan-checker'], {
        mode: 'inherit',
        model: null,
      });
    });

    test('models show includes codex override when set', async () => {
      writeProjectConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { codex: { 'plan-checker': 'gpt-5-codex' } },
      });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.codex['plan-checker'], {
        mode: 'override',
        model: 'gpt-5-codex',
      });
    });

    test('models set/clear works for codex runtime', async () => {
      writeProjectConfig(tmpDir, {});
      let result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'codex', '--agent', 'plan-checker', '--model', 'gpt-5-codex']);
      assert.strictEqual(result.exitCode, 0);

      let config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides.codex['plan-checker'], 'gpt-5-codex');

      result = await runCliAsMain(tmpDir, ['models', 'clear', '--runtime', 'codex', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 0);

      config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides, undefined);
    });

    test('models rejects invalid runtime', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'copilot', '--agent', 'plan-checker', '--model', 'foo']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /Invalid runtime/);
    });

    test('models rejects model IDs with injection characters', async () => {
      const malicious = 'gpt-5"\nfoo = "bar';
      const result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'codex', '--agent', 'plan-checker', '--model', malicious]);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /invalid characters/i);
    });

    test('models accepts valid model IDs with slashes colons and at signs', async () => {
      writeProjectConfig(tmpDir, {});
      const result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'codex', '--agent', 'plan-checker', '--model', 'anthropic/claude-opus-4-6:latest@v2']);
      assert.strictEqual(result.exitCode, 0);
    });

    test('models show falls back to file config when OPENCODE_CONFIG_CONTENT has an unterminated block comment', async () => {
      writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'openai/gpt-5.2' });

      const result = await withEnv({
        OPENCODE_CONFIG_CONTENT: '/* unterminated',
      }, async () => runCliAsMain(tmpDir, ['models', 'show']));
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.opencode['plan-checker'], {
        mode: 'inherit',
        model: null,
        runtimeDetectedModel: 'openai/gpt-5.2',
      });
      assert.strictEqual(payload.detectedRuntimeModels.opencode, 'openai/gpt-5.2');
    });

    test('mutation commands include update reminder', async () => {
      writeProjectConfig(tmpDir, {});
      let result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.match(result.output, /Run gsdd update/);

      result = await runCliAsMain(tmpDir, ['models', 'agent-profile', '--agent', 'plan-checker', '--profile', 'budget']);
      assert.match(result.output, /Run gsdd update/);

      result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'claude', '--agent', 'plan-checker', '--model', 'opus']);
      assert.match(result.output, /Run gsdd update/);

      result = await runCliAsMain(tmpDir, ['models', 'clear', '--runtime', 'claude', '--agent', 'plan-checker']);
      assert.match(result.output, /Run gsdd update/);

      result = await runCliAsMain(tmpDir, ['models', 'clear-agent-profile', '--agent', 'plan-checker']);
      assert.match(result.output, /Run gsdd update/);
    });
  });

  describe('pre-init guard', () => {
    test('models profile rejects when project is not initialized', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /not initialized/);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
    });

    test('models agent-profile rejects pre-init', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'agent-profile', '--agent', 'plan-checker', '--profile', 'quality']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /not initialized/);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
    });

    test('models set rejects pre-init', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'claude', '--agent', 'plan-checker', '--model', 'opus']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /not initialized/);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
    });

    test('models clear rejects pre-init', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'clear', '--runtime', 'claude', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /not initialized/);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
    });

    test('models clear-agent-profile rejects pre-init', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'clear-agent-profile', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /not initialized/);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
    });

    test('models show works without init (graceful fallback)', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);
    });
  });

  test('models and rigor refuse supported legacy and dual roots without changing either tree', async () => {
    const legacyDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(legacyDir);
    const legacyConfig = JSON.stringify({ initVersion: 'v1.1', modelProfile: 'balanced' });
    fs.writeFileSync(path.join(legacyDir, 'config.json'), legacyConfig);
    for (const args of [['models', 'show'], ['rigor', 'show']]) {
      const result = await runCliAsMain(tmpDir, args);
      assert.strictEqual(result.exitCode, 1, result.output);
      assert.match(result.output, /npx -y workspine init --migrate/);
      assert.strictEqual(fs.readFileSync(path.join(legacyDir, 'config.json'), 'utf8'), legacyConfig);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work')), false);
    }

    const workDir = path.join(tmpDir, '.work');
    fs.mkdirSync(workDir);
    fs.writeFileSync(path.join(workDir, 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const result = await runCliAsMain(tmpDir, ['models', 'show']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /Both `\.work\/` and `\.planning\/` exist/);
    assert.strictEqual(fs.readFileSync(path.join(legacyDir, 'config.json'), 'utf8'), legacyConfig);
  });

  test('nested model and rigor mutations refuse legacy and dual root authority without nested writes', async () => {
    const legacyDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ initVersion: 'v1.1', modelProfile: 'balanced' }));
    const nested = path.join(tmpDir, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    let before = snapshotTree(tmpDir);

    let result = await runCliAsMain(nested, ['models', 'profile', 'quality']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /npx -y workspine init --migrate/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);

    writeProjectConfig(tmpDir, { modelProfile: 'balanced' });
    before = snapshotTree(tmpDir);
    result = await runCliAsMain(nested, ['rigor', 'high']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /Both `\.work\/` and `\.planning\/` exist/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
  });

  describe('malformed config handling', () => {
    test('mutation refuses on malformed config.json and preserves file', async () => {
      const garbage = '{not valid json!!!}}}';
      fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), garbage);

      const result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /malformed/i);

      const preserved = fs.readFileSync(path.join(tmpDir, '.work', 'config.json'), 'utf-8');
      assert.strictEqual(preserved, garbage);
    });

    test('models show warns on malformed config.json but succeeds', async () => {
      fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{broken');

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);
      assert.match(result.output, /WARNING.*malformed/i);
    });
  });

  describe('rigor and cost resolvers', () => {
    test('RIGOR_PROFILES has the three canonical levels with only active workflow gates', async () => {
      const models = await import('../bin/lib/config.mjs');
      assert.deepStrictEqual(Object.keys(models.RIGOR_PROFILES), ['low', 'medium', 'high']);
      for (const level of ['low', 'medium', 'high']) {
        const w = models.RIGOR_PROFILES[level].workflow;
        for (const flag of ['research', 'discuss', 'planCheck', 'verifier']) {
          assert.ok(flag in w, `${level}.workflow.${flag} present`);
        }
        assert.ok(!('showCode' in w), `${level}.workflow.showCode is not a current gate`);
        assert.ok(!('askBeforeDecide' in w), `${level}.workflow.askBeforeDecide is not a current gate`);
      }
      assert.strictEqual(models.resolveRigor('max'), models.RIGOR_PROFILES.high);
    });

    test('legacy rigor names alias to the new levels', async () => {
      const models = await import('../bin/lib/config.mjs');
      assert.strictEqual(models.resolveRigor('quick'), models.RIGOR_PROFILES.low);
      assert.strictEqual(models.resolveRigor('balanced'), models.RIGOR_PROFILES.medium);
      assert.strictEqual(models.resolveRigor('thorough'), models.RIGOR_PROFILES.high);
    });

    test('resolveStepRigor honors per-step overrides then the base profile', async () => {
      const models = await import('../bin/lib/config.mjs');
      const config = { rigorProfile: 'low', rigorOverrides: { verify: 'max' } };
      assert.strictEqual(models.resolveStepRigor(config, 'plan'), models.RIGOR_PROFILES.low);
      assert.strictEqual(models.resolveStepRigor(config, 'verify'), models.RIGOR_PROFILES.high);
      assert.strictEqual(models.effectiveRigorLevel(config, 'plan'), 'low');
      assert.strictEqual(models.effectiveRigorLevel(config, 'verify'), 'high');
      assert.strictEqual(models.resolveStepRigor({}, 'plan'), models.RIGOR_PROFILES.medium);
    });

    test('COST_PROFILES has exactly keys budget, balanced, quality', async () => {
      const models = await import('../bin/lib/config.mjs');
      assert.deepStrictEqual(Object.keys(models.COST_PROFILES), ['budget', 'balanced', 'quality']);
    });

    test('resolveRigor unknown returns balanced profile', async () => {
      const models = await import('../bin/lib/config.mjs');
      const result = models.resolveRigor('unknown');
      assert.strictEqual(result.researchDepth, 'balanced');
      assert.strictEqual(result.workflow.research, true);
      assert.strictEqual(result.workflow.verifier, true);
    });

    test('resolveCost unknown returns balanced profile', async () => {
      const models = await import('../bin/lib/config.mjs');
      const result = models.resolveCost('unknown');
      assert.strictEqual(result.modelProfile, 'balanced');
      assert.strictEqual(result.parallelization, true);
    });

    test('every RIGOR_PROFILES entry has workflow.verifier === true', async () => {
      const models = await import('../bin/lib/config.mjs');
      for (const [key, profile] of Object.entries(models.RIGOR_PROFILES)) {
        assert.strictEqual(profile.workflow.verifier, true, `${key} has verifier=true`);
      }
    });

    test('buildDefaultConfig output schema has only current rigor gates', async () => {
      const models = await import('../bin/lib/config.mjs');
      const config = models.buildDefaultConfig();
      assert.ok('researchDepth' in config);
      assert.ok('parallelization' in config);
      assert.ok('commitDocs' in config);
      assert.ok('modelProfile' in config);
      assert.ok('workflow' in config);
      assert.ok('rigorProfile' in config);
      assert.ok('research' in config.workflow);
      assert.ok('discuss' in config.workflow);
      assert.ok('planCheck' in config.workflow);
      assert.ok('verifier' in config.workflow);
      assert.ok(!('showCode' in config.workflow));
      assert.ok(!('askBeforeDecide' in config.workflow));
      assert.ok('gitProtocol' in config);
      assert.ok('initVersion' in config);
      assert.strictEqual(config.workflow.verifier, true);
      assert.strictEqual(config.rigorProfile, 'medium');
    });
  });
});
