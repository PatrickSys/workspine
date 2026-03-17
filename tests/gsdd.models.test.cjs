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

function writePlanningConfig(projectDir, config) {
  fs.mkdirSync(path.join(projectDir, '.planning'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.planning', 'config.json'),
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
      writePlanningConfig(tmpDir, { modelProfile: 'quality' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
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

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: sonnet$/m);
    });

    test('budget profile injects model: haiku into Claude plan-checker', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'budget' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: haiku$/m);
    });

    test('OpenCode omits model by default even when runtime config exists', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'anthropic/claude-opus-4-5' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);
    });

    test('OpenCode runtime override injects exact model id verbatim', async () => {
      writePlanningConfig(tmpDir, {
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

      const checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: anthropic\/claude-opus-4-6$/m);
    });

    test('OpenCode semantic agent profile alone does not inject runtime model', async () => {
      writePlanningConfig(tmpDir, {
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

      const checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);
    });

    test('OpenCode update re-renders model after runtime override changes', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
      writeOpenCodeConfig(tmpDir, { model: 'openai/gpt-5' });

      let gsdd;
      const restoreStdin = setNonInteractiveStdin();
      try {
        gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'opencode');
      } finally {
        restoreStdin();
      }

      let checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);

      writePlanningConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { opencode: { 'plan-checker': 'openai/gpt-5.2' } },
      });
      await gsdd.cmdUpdate('--tools', 'opencode');

      checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: openai\/gpt-5\.2$/m);

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      delete config.runtimeModelOverrides;
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify(config, null, 2));
      await gsdd.cmdUpdate('--tools', 'opencode');

      checker = fs.readFileSync(path.join(tmpDir, '.opencode', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.doesNotMatch(checker, /^model:/m);
    });

    test('Claude semantic agent profile overrides global model profile', async () => {
      writePlanningConfig(tmpDir, {
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

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: opus$/m);
    });

    test('Codex omits model by default (inherits from parent session)', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'codex');
      } finally {
        restoreStdin();
      }

      const checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'utf-8');
      assert.doesNotMatch(checker, /^model = /m);
    });

    test('Codex runtime override injects exact model id into plan-checker TOML', async () => {
      writePlanningConfig(tmpDir, {
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

      const checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'utf-8');
      assert.match(checker, /^model = "gpt-5-codex"$/m);
    });

    test('Codex update re-renders model after runtime override changes', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });

      let gsdd;
      const restoreStdin = setNonInteractiveStdin();
      try {
        gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'codex');
      } finally {
        restoreStdin();
      }

      let checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'utf-8');
      assert.doesNotMatch(checker, /^model = /m);

      writePlanningConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { codex: { 'plan-checker': 'gpt-5-codex' } },
      });
      await gsdd.cmdUpdate('--tools', 'codex');

      checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'utf-8');
      assert.match(checker, /^model = "gpt-5-codex"$/m);

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      delete config.runtimeModelOverrides;
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify(config, null, 2));
      await gsdd.cmdUpdate('--tools', 'codex');

      checker = fs.readFileSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-plan-checker.toml'), 'utf-8');
      assert.doesNotMatch(checker, /^model = /m);
    });

    test('Claude runtime override wins over semantic profile', async () => {
      writePlanningConfig(tmpDir, {
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

      const checker = fs.readFileSync(path.join(tmpDir, '.claude', 'agents', 'gsdd-plan-checker.md'), 'utf-8');
      assert.match(checker, /^model: haiku$/m);
    });
  });

  describe('models command', () => {
    test('models show reports effective runtime model state', async () => {
      writePlanningConfig(tmpDir, {
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
      const result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.modelProfile, 'quality');
    });

    test('models agent-profile writes semantic agent override', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'agent-profile', '--agent', 'plan-checker', '--profile', 'quality']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.agentModelProfiles['plan-checker'], 'quality');
    });

    test('models set writes runtime override and clear removes it', async () => {
      let result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'opencode', '--agent', 'plan-checker', '--model', 'anthropic/claude-opus-4-6']);
      assert.strictEqual(result.exitCode, 0);

      let config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides.opencode['plan-checker'], 'anthropic/claude-opus-4-6');

      result = await runCliAsMain(tmpDir, ['models', 'clear', '--runtime', 'opencode', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 0);

      config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides, undefined);
    });

    test('models clear-agent-profile removes semantic override only', async () => {
      await runCliAsMain(tmpDir, ['models', 'agent-profile', '--agent', 'plan-checker', '--profile', 'quality']);
      const result = await runCliAsMain(tmpDir, ['models', 'clear-agent-profile', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 0);

      const config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.agentModelProfiles, undefined);
    });

    test('models show displays inherited model when no OpenCode override exists', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
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
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });

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

    test('models show omits hints when OpenCode runtime override exists', async () => {
      writePlanningConfig(tmpDir, {
        modelProfile: 'balanced',
        runtimeModelOverrides: { opencode: { 'plan-checker': 'anthropic/claude-opus-4-6' } },
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
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
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
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
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
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
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
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });

      const result = await runCliAsMain(tmpDir, ['models', 'show']);
      assert.strictEqual(result.exitCode, 0);

      const payload = JSON.parse(result.output);
      assert.deepStrictEqual(payload.effective.codex['plan-checker'], {
        mode: 'inherit',
        model: null,
      });
    });

    test('models show includes codex override when set', async () => {
      writePlanningConfig(tmpDir, {
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
      let result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'codex', '--agent', 'plan-checker', '--model', 'gpt-5-codex']);
      assert.strictEqual(result.exitCode, 0);

      let config = readJson(path.join(tmpDir, '.planning', 'config.json'));
      assert.strictEqual(config.runtimeModelOverrides.codex['plan-checker'], 'gpt-5-codex');

      result = await runCliAsMain(tmpDir, ['models', 'clear', '--runtime', 'codex', '--agent', 'plan-checker']);
      assert.strictEqual(result.exitCode, 0);

      config = readJson(path.join(tmpDir, '.planning', 'config.json'));
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
      const result = await runCliAsMain(tmpDir, ['models', 'set', '--runtime', 'codex', '--agent', 'plan-checker', '--model', 'anthropic/claude-opus-4-6:latest@v2']);
      assert.strictEqual(result.exitCode, 0);
    });

    test('models show falls back to file config when OPENCODE_CONFIG_CONTENT has an unterminated block comment', async () => {
      writePlanningConfig(tmpDir, { modelProfile: 'balanced' });
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
});
