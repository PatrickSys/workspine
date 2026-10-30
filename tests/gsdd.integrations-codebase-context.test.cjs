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

function initWorkDir(tmp, { enabled = false } = {}) {
  const workDir = path.join(tmp, '.work');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'config.json'), `${JSON.stringify({
    rigorProfile: 'medium',
    integrations: { codebaseContext: { enabled, command: 'stub-codebase-context' } },
  }, null, 2)}\n`);
  return workDir;
}

function stubRunner() {
  const calls = [];
  return {
    calls,
    probeCli: () => true,
    runCli: (_command, args) => {
      calls.push(args);
      if (args[0] === 'patterns') return JSON.stringify({ teamPatterns: [{ name: 'Vitest', adoption: 0.9 }] });
      if (args[0] === 'search') {
        const intent = args[args.indexOf('--intent') + 1];
        if (intent === 'edit') {
          return JSON.stringify({ preflight: { ready: true, patterns: { do: ['match repo style'] } }, results: [] });
        }
        return JSON.stringify({ results: [{ filePath: 'src/example.ts' }] });
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
    assert.equal(fs.existsSync(path.join(workDir, 'integrations', 'codebase-context', 'plan-context.json')), false);
  } finally {
    cleanup(tmp);
  }
});

test('plan-context records patterns and scoped search when enabled', async () => {
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
    assert.ok(runner.calls.some((args) => args[0] === 'patterns'));
    assert.ok(runner.calls.some((args) => args[0] === 'search' && args.includes('explore')));
    const artifact = readJson(path.join(workDir, 'integrations', 'codebase-context', 'plan-context.json'));
    assert.equal(artifact.status, 'ok');
    assert.deepEqual(artifact.files, ['src/features/a.ts', 'src/features/b.ts']);
  } finally {
    cleanup(tmp);
  }
});

test('edit-preflight records preflight receipt when enabled', async () => {
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
    assert.equal(body.preflight.ready, true);
    assert.ok(fs.existsSync(path.join(workDir, 'integrations', 'codebase-context', 'preflight', 'task-1.json')));
    assert.ok(fs.existsSync(path.join(workDir, 'integrations', 'codebase-context', 'last-preflight.json')));
    assert.ok(fs.existsSync(path.join(workDir, 'integrations', 'codebase-context', 'preflight-log.jsonl')));
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
  } finally {
    cleanup(tmp);
  }
});
