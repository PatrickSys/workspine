/**
 * Global install pressure tests.
 *
 * These tests model the consumer loop that matters for #115:
 * install Workspine once into a user-level agent home, then enter several
 * unrelated repos and verify agents can discover usable workflow surfaces
 * without accidental repo-local bootstrap.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  setNonInteractiveStdin,
  withEnv,
} = require('./gsdd.helpers.cjs');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function captureLogs(fn) {
  const previousLog = console.log;
  const previousError = console.error;
  const lines = [];
  console.log = (...parts) => lines.push(parts.join(' '));
  console.error = (...parts) => lines.push(parts.join(' '));
  try {
    await fn();
  } finally {
    console.log = previousLog;
    console.error = previousError;
  }
  return lines.join('\n');
}

function createFixtureRepos() {
  const parent = createTempProject();
  const emptyRepo = path.join(parent, 'empty-repo');
  const nodeRepo = path.join(parent, 'node-cli');
  const nestedRepo = path.join(parent, 'nested-repo');

  fs.mkdirSync(emptyRepo, { recursive: true });
  writeFile(path.join(nodeRepo, 'package.json'), JSON.stringify({ name: 'node-cli', type: 'module' }, null, 2));
  writeFile(path.join(nodeRepo, 'src', 'index.js'), 'export const ok = true;\n');
  writeFile(path.join(nestedRepo, 'packages', 'app', 'README.md'), '# Nested app\n');

  return { parent, repos: [emptyRepo, nodeRepo, nestedRepo] };
}

function assertNoRepoBootstrap(repoDir) {
  assert.ok(!fs.existsSync(path.join(repoDir, '.planning')), `${repoDir} must not get repo-local planning state`);
  assert.ok(!fs.existsSync(path.join(repoDir, '.agents')), `${repoDir} must not get repo-local portable skills`);
}

function assertGlobalAgentSurface(homeDir, target, files) {
  const rootMap = {
    claude: path.join(homeDir, '.claude'),
    opencode: path.join(homeDir, '.config', 'opencode'),
    codex: path.join(homeDir, '.codex'),
    copilot: path.join(homeDir, '.copilot'),
  };
  const root = rootMap[target];
  for (const relativePath of files) {
    assert.ok(fs.existsSync(path.join(root, relativePath)), `${target} missing ${relativePath}`);
  }
  const manifest = readJson(path.join(root, 'workspine-file-manifest.json'));
  assert.strictEqual(manifest.runtime, target);
  assert.ok(manifest.files['skills/gsdd-plan/SKILL.md'], `${target} manifest must track the plan skill`);
}

describe('global install pressure loop', () => {
  test('one global install gives mock agents usable surfaces across unrelated fixture repos', async () => {
    const homeDir = createTempProject();
    const { parent, repos } = createFixtureRepos();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      const installOutput = await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repos[0]);
        return captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'all'));
      });

      assert.match(installOutput, /claude:/);
      assert.match(installOutput, /opencode:/);
      assert.match(installOutput, /codex:/);
      assert.match(installOutput, /copilot:/);
      assert.match(installOutput, /Global install complete/);

      for (const repo of repos) {
        assertNoRepoBootstrap(repo);
      }

      assertGlobalAgentSurface(homeDir, 'claude', [
        'skills/gsdd-plan/SKILL.md',
        'commands/gsdd-plan.md',
        'agents/gsdd-plan-checker.md',
        'agents/gsdd-approach-explorer.md',
      ]);
      assertGlobalAgentSurface(homeDir, 'opencode', [
        'skills/gsdd-plan/SKILL.md',
        'commands/gsdd-plan.md',
        'agents/gsdd-plan-checker.md',
        'agents/gsdd-approach-explorer.md',
      ]);
      assertGlobalAgentSurface(homeDir, 'codex', [
        'skills/gsdd-plan/SKILL.md',
        'agents/gsdd-plan-checker.toml',
        'agents/gsdd-approach-explorer.toml',
      ]);
      assertGlobalAgentSurface(homeDir, 'copilot', [
        'skills/gsdd-plan/SKILL.md',
        'agents/gsdd-plan-checker.agent.md',
        'agents/gsdd-approach-explorer.agent.md',
      ]);

      for (const skillPath of [
        path.join(homeDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'),
        path.join(homeDir, '.config', 'opencode', 'skills', 'gsdd-plan', 'SKILL.md'),
        path.join(homeDir, '.codex', 'skills', 'gsdd-plan', 'SKILL.md'),
        path.join(homeDir, '.copilot', 'skills', 'gsdd-plan', 'SKILL.md'),
      ]) {
        const skill = fs.readFileSync(skillPath, 'utf-8');
        assert.match(skill, /gsdd-plan/);
        assert.match(skill, /Plan a phase|PLAN\.md/i);
      }
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(parent);
    }
  });

  test('mock user can later choose repo-local install in one fixture without changing global install scope', async () => {
    const homeDir = createTempProject();
    const { parent, repos } = createFixtureRepos();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const globalGsdd = await loadGsdd(repos[0]);
        await captureLogs(() => globalGsdd.cmdInstall('--global', '--tools', 'codex'));

        const localGsdd = await loadGsdd(repos[1]);
        await captureLogs(() => localGsdd.cmdInit('--auto', '--tools', 'codex'));
      });

      assertNoRepoBootstrap(repos[0]);
      assert.ok(fs.existsSync(path.join(repos[1], '.planning', 'config.json')));
      assert.ok(fs.existsSync(path.join(repos[1], '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(repos[1], '.codex', 'agents', 'gsdd-plan-checker.toml')));
      assertNoRepoBootstrap(repos[2]);

      assertGlobalAgentSurface(homeDir, 'codex', [
        'skills/gsdd-plan/SKILL.md',
        'agents/gsdd-plan-checker.toml',
        'agents/gsdd-approach-explorer.toml',
      ]);
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude')), 'codex-only global install must not create Claude home');
      assert.ok(!fs.existsSync(path.join(homeDir, '.copilot')), 'codex-only global install must not create Copilot home');
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(parent);
    }
  });

  test('mock user conflict in one global target does not partially install that target', async () => {
    const homeDir = createTempProject();
    const { parent, repos } = createFixtureRepos();
    const customSkill = path.join(homeDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md');
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      writeFile(customSkill, 'custom user skill\n');
      await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
        const gsdd = await loadGsdd(repos[0]);
        const output = await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude'));
        assert.match(output, /skipped|WARN/i);
      });

      assert.strictEqual(process.exitCode, 1);
      assert.strictEqual(fs.readFileSync(customSkill, 'utf-8'), 'custom user skill\n');
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'commands', 'gsdd-plan.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'agents', 'gsdd-plan-checker.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'workspine-file-manifest.json')));
      for (const repo of repos) {
        assertNoRepoBootstrap(repo);
      }
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(parent);
    }
  });
});
