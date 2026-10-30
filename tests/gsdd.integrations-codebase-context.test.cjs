const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup, readJson, runCliAsMain } = require('./gsdd.helpers.cjs');
const { pathToFileURL } = require('url');

async function importIntegrationModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'integrations', 'codebase-context.mjs')).href}?t=${Date.now()}`);
}

async function importConfigModule() {
  return import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'config.mjs')).href}?t=${Date.now()}`);
}

function initWorkDir(tmp, { enabled = false, command = 'stub-codebase-context' } = {}) {
  const workDir = path.join(tmp, '.work');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'config.json'), `${JSON.stringify({
    rigorProfile: 'medium',
    integrations: { codebaseContext: { enabled, command } },
  }, null, 2)}\n`);
  return workDir;
}

/** Shapes aligned with codebase-context main CLI JSON (SearchResponse / PatternResponse). */
function stubRunner() {
  const calls = [];
  const patternsPayload = {
    status: 'success',
    patterns: {},
    goldenFiles: [],
  };
  const explorePayload = {
    status: 'success',
    searchQuality: { status: 'ok', confidence: 0.42 },
    budget: { mode: 'compact', resultCount: 1 },
    results: [{
      file: 'src/example.ts:1-10',
      summary: "typescript function 'example' in example.ts.",
      score: 0.5,
    }],
  };
  const editPayload = {
    status: 'success',
    searchQuality: { status: 'low_confidence', confidence: 0.17 },
    budget: { mode: 'compact', resultCount: 2 },
    preflight: {
      ready: false,
      abstain: true,
      nextAction: 'Search quality is low. Refine query or add concrete symbols before editing.',
      impact: { coverage: '1/1 callers in results', files: ['src/validate.ts'] },
    },
    results: [{ file: 'src/math.ts:1-3', summary: "typescript function 'add' in math.ts.", score: 0.25 }],
  };
  return {
    calls,
    probeCli: () => true,
    runCli: (_command, args) => {
      calls.push(args);
      if (args[0] === 'patterns') return JSON.stringify(patternsPayload);
      if (args[0] === 'search') {
        const intent = args[args.indexOf('--intent') + 1];
        return JSON.stringify(intent === 'edit' ? editPayload : explorePayload);
      }
      return '{}';
    },
    exists: () => true,
  };
}

test('default config keeps codebase-context integration off', async () => {
  const { buildDefaultConfig } = await importConfigModule();
  const config = buildDefaultConfig();
  assert.equal(config.integrations.codebaseContext.enabled, false);
});

test('plan-context skips when disabled', async () => {
  const tmp = createTempProject();
  try {
    const workDir = initWorkDir(tmp, { enabled: false });
    const { runPlanContext } = await importIntegrationModule();
    const body = runPlanContext({
      workspaceRoot: tmp,
      workDir,
      config: readJson(path.join(workDir, 'config.json')),
      files: ['src/a.ts'],
      json: true,
      runner: stubRunner(),
    });
    assert.equal(body.status, 'disabled');
    assert.ok(body.bridge);
    assert.equal(fs.existsSync(path.join(workDir, 'integrations', 'codebase-context', 'plan-context.json')), false);
  } finally {
    cleanup(tmp);
  }
});

test('plan-context records patterns and per-file explore search when enabled', async () => {
  const tmp = createTempProject();
  try {
    const workDir = initWorkDir(tmp, { enabled: true });
    const runner = stubRunner();
    const { runPlanContext } = await importIntegrationModule();
    const body = runPlanContext({
      workspaceRoot: tmp,
      workDir,
      config: readJson(path.join(workDir, 'config.json')),
      files: ['src/features/a.ts', 'src/features/b.ts'],
      planPath: '.work/phases/01-PLAN.md',
      json: true,
      runner,
    });
    assert.equal(body.status, 'ok');
    assert.ok(body.codebase_context_invocations.some((row) => row.mcpTool === 'get_team_patterns'));
    assert.ok(body.codebase_context_invocations.some((row) => row.mcpTool === 'search_codebase'));
    assert.equal(body.patterns.status, 'success');
    assert.equal(body.file_searches.length, 2);
    assert.equal(body.file_searches[0].response.status, 'success');
    assert.ok(Array.isArray(body.file_searches[0].response.results));
    const artifact = readJson(path.join(workDir, 'integrations', 'codebase-context', 'plan-context.json'));
    assert.equal(artifact.status, 'ok');
  } finally {
    cleanup(tmp);
  }
});

test('edit-preflight records search_codebase preflight when enabled', async () => {
  const tmp = createTempProject();
  try {
    const workDir = initWorkDir(tmp, { enabled: true });
    const runner = stubRunner();
    const { runEditPreflight } = await importIntegrationModule();
    const body = runEditPreflight({
      workspaceRoot: tmp,
      workDir,
      config: readJson(path.join(workDir, 'config.json')),
      files: ['src/a.ts'],
      query: 'add validation helper',
      taskId: 'task-1',
      json: true,
      runner,
    });
    assert.equal(body.status, 'ok');
    assert.equal(body.response.status, 'success');
    assert.equal(typeof body.preflight.ready, 'boolean');
    assert.equal(body.preflight.abstain, true);
    assert.ok(runner.calls.some((args) => args.includes('edit')));
    assert.ok(fs.existsSync(path.join(workDir, 'integrations', 'codebase-context', 'preflight', 'task-1.json')));
  } finally {
    cleanup(tmp);
  }
});

test('integrations show via CLI on fresh project reports disabled', async () => {
  const tmp = createTempProject();
  try {
    initWorkDir(tmp);
    const result = await runCliAsMain(tmp, ['integrations', 'show', '--json']);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.integrations.codebaseContext.enabled, false);
    assert.ok(payload.integrations.codebaseContext.bridge);
  } finally {
    cleanup(tmp);
  }
});

test('e2e against built codebase-context when CC_E2E_BIN is set', { skip: !process.env.CC_E2E_BIN }, async () => {
  const ccBin = process.env.CC_E2E_BIN;
  const tmp = createTempProject();
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'math.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"e2e","type":"module"}\n');
    const { execFileSync } = require('child_process');
    const reindex = ccBin.endsWith('.js')
      ? { file: process.execPath, args: [ccBin, 'reindex', '--no-embeddings'] }
      : { file: ccBin, args: ['reindex', '--no-embeddings'] };
    execFileSync(reindex.file, reindex.args, { cwd: tmp, encoding: 'utf-8', env: { ...process.env, CODEBASE_ROOT: tmp } });

    const workDir = initWorkDir(tmp, { enabled: true, command: ccBin });
    const { runPlanContext, runEditPreflight } = await importIntegrationModule();
    const { createCodebaseContextRunner } = await importIntegrationModule();
    const runner = createCodebaseContextRunner({ execFile: execFileSync });
    const config = readJson(path.join(workDir, 'config.json'));

    const plan = runPlanContext({
      workspaceRoot: tmp,
      workDir,
      config,
      files: ['src/math.ts'],
      json: true,
      runner,
    });
    assert.equal(plan.status, 'ok');
    assert.equal(plan.patterns.status, 'success');

    const preflight = runEditPreflight({
      workspaceRoot: tmp,
      workDir,
      config,
      files: ['src/math.ts'],
      query: 'change add function',
      taskId: 'e2e-task',
      json: true,
      runner,
    });
    assert.equal(preflight.status, 'ok');
    assert.equal(preflight.response.status, 'success');
    assert.ok(preflight.response.preflight);
  } finally {
    cleanup(tmp);
  }
});
