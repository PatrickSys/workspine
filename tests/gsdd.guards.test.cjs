/**
 * GSDD Code-Structure Guards
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GSDD_PATH = path.join(ROOT, 'bin', 'gsdd.mjs');
const MODELS_MODULE = path.join(ROOT, 'bin', 'lib', 'models.mjs');
const MANIFEST_MODULE = path.join(ROOT, 'bin', 'lib', 'manifest.mjs');
const INIT_MODULE = path.join(ROOT, 'bin', 'lib', 'init.mjs');
const TEMPLATES_MODULE = path.join(ROOT, 'bin', 'lib', 'templates.mjs');
const README_MD = path.join(ROOT, 'README.md');
const DISTILLED_README_MD = path.join(ROOT, 'distilled', 'README.md');

function lineCount(filePath) {
  return fs.readFileSync(filePath, 'utf-8').split('\n').length;
}

describe('G9 - Generation Manifest Contract', () => {
  test('bin/lib/manifest.mjs exists', () => {
    assert.ok(fs.existsSync(MANIFEST_MODULE),
      'bin/lib/manifest.mjs must exist. FIX: Create the manifest module.');
  });

  test('manifest module exports required functions', async () => {
    const mod = await import(`file://${MANIFEST_MODULE.replace(/\\/g, '/')}`);
    const required = ['fileHash', 'hashDirectory', 'buildManifest', 'readManifest', 'writeManifest', 'detectModifications'];
    for (const fn of required) {
      assert.strictEqual(typeof mod[fn], 'function',
        `manifest.mjs must export ${fn}. FIX: Add export for ${fn}.`);
    }
  });
});

describe('G10 - CLI Module Boundary', () => {
  test('init module exists and exports command factories', async () => {
    assert.ok(fs.existsSync(INIT_MODULE),
      'bin/lib/init.mjs must exist. FIX: Extract init/update/help logic into bin/lib/init.mjs.');
    const mod = await import(`file://${INIT_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.createCmdInit, 'function',
      'init.mjs must export createCmdInit. FIX: Export createCmdInit from bin/lib/init.mjs.');
    assert.strictEqual(typeof mod.createCmdUpdate, 'function',
      'init.mjs must export createCmdUpdate. FIX: Export createCmdUpdate from bin/lib/init.mjs.');
    assert.strictEqual(typeof mod.cmdHelp, 'function',
      'init.mjs must export cmdHelp. FIX: Export cmdHelp from bin/lib/init.mjs.');
  });

  test('templates module exists and exports sync helpers', async () => {
    assert.ok(fs.existsSync(TEMPLATES_MODULE),
      'bin/lib/templates.mjs must exist. FIX: Extract template sync logic into bin/lib/templates.mjs.');
    const mod = await import(`file://${TEMPLATES_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.installProjectTemplates, 'function',
      'templates.mjs must export installProjectTemplates. FIX: Export installProjectTemplates from bin/lib/templates.mjs.');
    assert.strictEqual(typeof mod.refreshTemplates, 'function',
      'templates.mjs must export refreshTemplates. FIX: Export refreshTemplates from bin/lib/templates.mjs.');
  });

  test('gsdd.mjs imports the extracted modules', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.ok(gsddContent.includes("from './lib/init.mjs'"),
      'gsdd.mjs must import init.mjs. FIX: Add init.mjs import to gsdd.mjs.');
    assert.ok(gsddContent.includes('createCmdInit') && gsddContent.includes('createCmdUpdate'),
      'gsdd.mjs must wire createCmdInit/createCmdUpdate. FIX: Use the extracted init command factories.');
  });

  test('gsdd.mjs keeps FRAMEWORK_VERSION and re-exports command surface', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    assert.ok(gsddContent.includes('FRAMEWORK_VERSION'),
      'gsdd.mjs must define FRAMEWORK_VERSION. FIX: Keep FRAMEWORK_VERSION in the composition root.');
    assert.ok(gsddContent.includes('export') && gsddContent.includes('cmdInit') && gsddContent.includes('cmdUpdate'),
      'gsdd.mjs must export the CLI command surface. FIX: Re-export cmdInit/cmdUpdate from gsdd.mjs.');
  });

  test('help text still documents --templates and --dry', async () => {
    const mod = await import(`file://${INIT_MODULE.replace(/\\/g, '/')}`);
    const previousLog = console.log;
    let output = '';
    console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
    try {
      mod.cmdHelp();
    } finally {
      console.log = previousLog;
    }

    assert.match(output, /--templates/,
      'Help text must document --templates flag. FIX: Add --templates to the extracted cmdHelp output.');
    assert.match(output, /--dry/,
      'Help text must document --dry flag. FIX: Add --dry to the extracted cmdHelp output.');
  });

  test('gsdd.mjs no longer defines extracted command bodies inline', () => {
    const gsddContent = fs.readFileSync(GSDD_PATH, 'utf-8');
    for (const forbidden of [
      'async function cmdInit',
      'function cmdUpdate',
      'function refreshTemplates',
      'function generateOpenStandardSkills',
      'function detectPlatforms',
      'function getAdaptersToUpdate',
    ]) {
      assert.ok(!gsddContent.includes(forbidden),
        `gsdd.mjs must not define ${forbidden} inline. FIX: Keep extracted command logic in bin/lib modules.`);
    }
  });

  test('gsdd.mjs remains a thin facade', () => {
    const lines = lineCount(GSDD_PATH);
    assert.ok(lines <= 140,
      `gsdd.mjs is ${lines} lines (max 140). FIX: Keep the entrypoint as a thin composition root.`);
  });
});

describe('G11 - Codex Doc Contract', () => {
  test('README describes Codex as portable-skill entry plus native checker agent', () => {
    const readme = fs.readFileSync(README_MD, 'utf-8');
    assert.doesNotMatch(readme, /overrides gsdd-plan skill/i,
      'README.md must not claim that Codex overrides the shared gsdd-plan skill.');
    assert.match(readme, /portable .*gsdd-plan.*\.codex\/agents/i,
      'README.md must describe Codex as the portable gsdd-plan entry plus the native checker agent.');
  });

  test('distilled README no longer describes Codex as deprecated', () => {
    const readme = fs.readFileSync(DISTILLED_README_MD, 'utf-8');
    assert.doesNotMatch(readme, /deprecated compatibility only/i,
      'distilled/README.md must not describe --tools codex as deprecated once the native checker adapter exists.');
    assert.match(readme, /\.codex\/agents\/gsdd-plan-checker\.toml/,
      'distilled/README.md must document the generated Codex checker agent.');
  });
});

describe('G13 - Models Pre-Init Safety', () => {
  test('models.mjs exports isProjectInitialized', async () => {
    const mod = await import(`file://${MODELS_MODULE.replace(/\\/g, '/')}`);
    assert.strictEqual(typeof mod.isProjectInitialized, 'function',
      'models.mjs must export isProjectInitialized. FIX: Add isProjectInitialized export.');
  });

  test('all 5 mutation commands check isProjectInitialized', () => {
    const modelsSource = fs.readFileSync(MODELS_MODULE, 'utf-8');
    const mutationFunctions = [
      'cmdModelsProfile',
      'cmdModelsAgentProfile',
      'cmdModelsClearAgentProfile',
      'cmdModelsSetRuntimeOverride',
      'cmdModelsClearRuntimeOverride',
    ];
    for (const fn of mutationFunctions) {
      const fnStart = modelsSource.indexOf(`function ${fn}`);
      assert.notStrictEqual(fnStart, -1, `${fn} must exist in models.mjs`);
      const nextFnStart = modelsSource.indexOf('\nfunction ', fnStart + 1);
      const fnBody = modelsSource.slice(fnStart, nextFnStart > -1 ? nextFnStart : modelsSource.length);
      assert.match(fnBody, /isProjectInitialized/,
        `${fn} must call isProjectInitialized. FIX: Add pre-init guard to ${fn}.`);
    }
  });

  test('mutation commands use loadConfigForMutation instead of ensureProjectConfig', () => {
    const modelsSource = fs.readFileSync(MODELS_MODULE, 'utf-8');
    const mutationFunctions = [
      'cmdModelsProfile',
      'cmdModelsAgentProfile',
      'cmdModelsClearAgentProfile',
      'cmdModelsSetRuntimeOverride',
      'cmdModelsClearRuntimeOverride',
    ];
    for (const fn of mutationFunctions) {
      const fnStart = modelsSource.indexOf(`function ${fn}`);
      const nextFnStart = modelsSource.indexOf('\nfunction ', fnStart + 1);
      const fnBody = modelsSource.slice(fnStart, nextFnStart > -1 ? nextFnStart : modelsSource.length);
      assert.doesNotMatch(fnBody, /ensureProjectConfig/,
        `${fn} must not call ensureProjectConfig. FIX: Use loadConfigForMutation instead.`);
    }
  });
});
