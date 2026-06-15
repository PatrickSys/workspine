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
const { pathToFileURL } = require('url');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliAsMain,
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
    copilot: path.join(homeDir, '.copilot'),
  };

  const rootFor = (relativePath) => {
    if (target === 'codex' && relativePath.startsWith('skills/')) return path.join(homeDir, '.agents');
    if (target === 'codex') return path.join(homeDir, '.codex');
    return rootMap[target];
  };

  for (const relativePath of files) {
    assert.ok(fs.existsSync(path.join(rootFor(relativePath), relativePath)), `${target} missing ${relativePath}`);
  }

  if (target === 'codex') {
    const skillFiles = files.filter((relativePath) => relativePath.startsWith('skills/'));
    const agentFiles = files.filter((relativePath) => relativePath.startsWith('agents/'));
    if (skillFiles.length > 0) {
      const manifest = readJson(path.join(homeDir, '.agents', 'workspine-file-manifest.json'));
      assert.strictEqual(manifest.runtime, 'codex-skills');
      for (const relativePath of skillFiles) {
        assert.ok(manifest.files[relativePath], `codex skill manifest must track ${relativePath}`);
      }
    }
    if (agentFiles.length > 0) {
      const manifest = readJson(path.join(homeDir, '.codex', 'workspine-file-manifest.json'));
      assert.strictEqual(manifest.runtime, 'codex');
      for (const relativePath of agentFiles) {
        assert.ok(manifest.files[relativePath], `codex agent manifest must track ${relativePath}`);
      }
    }
    return;
  }

  const root = rootMap[target];
  const manifest = readJson(path.join(root, 'workspine-file-manifest.json'));
  assert.strictEqual(manifest.runtime, target);
  for (const relativePath of files) {
    assert.ok(manifest.files[relativePath], `${target} manifest must track ${relativePath}`);
  }
}

function displayPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertIncludesDisplayPath(content, filePath) {
  assert.match(content, new RegExp(escapeRegex(displayPath(filePath))));
}

describe('global install pressure loop', () => {
  test('README-driven first-time user loop works through the public CLI surface', async () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf-8');
    assert.match(readme, /npx -y gsdd-cli init/);
    assert.match(readme, /npx -y gsdd-cli install --global --tools claude,opencode,codex,copilot/);

    const homeDir = createTempProject();
    const { parent, repos } = createFixtureRepos();
    const restoreStdin = setNonInteractiveStdin();

    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const globalInstall = await runCliAsMain(repos[0], [
          'install',
          '--global',
          '--tools',
          'claude,opencode,codex,copilot',
        ]);

        assert.strictEqual(globalInstall.exitCode, 0);
        assert.match(globalInstall.output, /Global install complete/);

        for (const repo of repos) {
          assertNoRepoBootstrap(repo);
        }

        for (const [target, files] of Object.entries({
          claude: [
            'skills/gsdd-plan/SKILL.md',
            'commands/gsdd-plan.md',
            'agents/gsdd-plan-checker.md',
          ],
          opencode: [
            'skills/gsdd-plan/SKILL.md',
            'commands/gsdd-plan.md',
            'agents/gsdd-plan-checker.md',
          ],
          codex: [
            'skills/gsdd-plan/SKILL.md',
            'agents/gsdd-plan-checker.toml',
          ],
          copilot: [
            'skills/gsdd-plan/SKILL.md',
            'agents/gsdd-plan-checker.agent.md',
          ],
        })) {
          assertGlobalAgentSurface(homeDir, target, files);
        }

        const localInstall = await runCliAsMain(repos[1], ['init', '--auto', '--tools', 'codex']);
        assert.strictEqual(localInstall.exitCode, 0);
        assert.match(localInstall.output, /GSDD initialized/i);
      });

      assertNoRepoBootstrap(repos[0]);
      assert.ok(fs.existsSync(path.join(repos[1], '.planning', 'config.json')));
      assert.ok(fs.existsSync(path.join(repos[1], '.agents', 'skills', 'gsdd-plan', 'SKILL.md')));
      assertNoRepoBootstrap(repos[2]);
    } finally {
      restoreStdin();
      cleanup(homeDir);
      cleanup(parent);
    }
  });

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
        path.join(homeDir, '.agents', 'skills', 'gsdd-plan', 'SKILL.md'),
        path.join(homeDir, '.copilot', 'skills', 'gsdd-plan', 'SKILL.md'),
      ]) {
        const skill = fs.readFileSync(skillPath, 'utf-8');
        assert.match(skill, /gsdd-plan/);
        assert.match(skill, /Plan a phase|PLAN\.md/i);
      }

      const claudeCommand = fs.readFileSync(path.join(homeDir, '.claude', 'commands', 'gsdd-plan.md'), 'utf-8');
      assertIncludesDisplayPath(claudeCommand, path.join(homeDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'));
      assert.doesNotMatch(claudeCommand, /Read `\.claude\/skills\/gsdd-plan\/SKILL\.md`/);

      const claudePlanSkill = fs.readFileSync(path.join(homeDir, '.claude', 'skills', 'gsdd-plan', 'SKILL.md'), 'utf-8');
      assert.match(claudePlanSkill, /globally installed skill is the canonical Claude-native/);
      assert.doesNotMatch(claudePlanSkill, /\.agents\/skills\/gsdd-plan\/SKILL\.md/);

      const opencodeCommand = fs.readFileSync(path.join(homeDir, '.config', 'opencode', 'commands', 'gsdd-plan.md'), 'utf-8');
      assertIncludesDisplayPath(opencodeCommand, path.join(homeDir, '.config', 'opencode', 'skills', 'gsdd-plan', 'SKILL.md'));
      assert.doesNotMatch(opencodeCommand, /Read `\.agents\/skills\/gsdd-plan\/SKILL\.md`/);
      assert.doesNotMatch(opencodeCommand, /according to `\.agents\/skills\/gsdd-plan\/SKILL\.md`/);

      const globalNewProjectSkill = fs.readFileSync(path.join(homeDir, '.agents', 'skills', 'gsdd-new-project', 'SKILL.md'), 'utf-8');
      assert.match(globalNewProjectSkill, /otherwise use the globally installed `gsdd-map-codebase` skill/);
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

  test('global command files reference custom install roots with Windows-safe display paths', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const claudeRoot = path.join(homeDir, 'Claude Home With Spaces');
    const configHome = path.join(homeDir, 'Config Home With Spaces');
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      await withEnv({
        GSDD_TEST_HOME: homeDir,
        CLAUDE_CONFIG_DIR: claudeRoot,
        XDG_CONFIG_HOME: configHome,
      }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,opencode'));
      });

      const claudeCommand = fs.readFileSync(path.join(claudeRoot, 'commands', 'gsdd-plan.md'), 'utf-8');
      assertIncludesDisplayPath(claudeCommand, path.join(claudeRoot, 'skills', 'gsdd-plan', 'SKILL.md'));

      const opencodeRoot = path.join(configHome, 'opencode');
      const opencodeCommand = fs.readFileSync(path.join(opencodeRoot, 'commands', 'gsdd-plan.md'), 'utf-8');
      assertIncludesDisplayPath(opencodeCommand, path.join(opencodeRoot, 'skills', 'gsdd-plan', 'SKILL.md'));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('OpenCode honors custom config root for commands and agents while keeping documented skill root', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const configHome = path.join(homeDir, 'Config Home With Spaces');
    const opencodeConfigDir = path.join(homeDir, 'OpenCode Config With Spaces');
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      await withEnv({
        GSDD_TEST_HOME: homeDir,
        XDG_CONFIG_HOME: configHome,
        OPENCODE_CONFIG_DIR: opencodeConfigDir,
      }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'opencode'));
      });

      const skillRoot = path.join(configHome, 'opencode');
      assert.ok(fs.existsSync(path.join(skillRoot, 'skills', 'gsdd-plan', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(opencodeConfigDir, 'commands', 'gsdd-plan.md')));
      assert.ok(fs.existsSync(path.join(opencodeConfigDir, 'agents', 'gsdd-plan-checker.md')));
      assert.ok(!fs.existsSync(path.join(opencodeConfigDir, 'skills', 'gsdd-plan', 'SKILL.md')),
        'OPENCODE_CONFIG_DIR is not the documented global skill root');

      const skillsManifest = readJson(path.join(skillRoot, 'workspine-file-manifest.json'));
      const configManifest = readJson(path.join(opencodeConfigDir, 'workspine-file-manifest.json'));
      assert.strictEqual(skillsManifest.runtime, 'opencode-skills');
      assert.strictEqual(configManifest.runtime, 'opencode');
      assert.ok(skillsManifest.files['skills/gsdd-plan/SKILL.md']);
      assert.ok(configManifest.files['commands/gsdd-plan.md']);
      assert.ok(configManifest.files['agents/gsdd-plan-checker.md']);

      const opencodeCommand = fs.readFileSync(path.join(opencodeConfigDir, 'commands', 'gsdd-plan.md'), 'utf-8');
      assertIncludesDisplayPath(opencodeCommand, path.join(skillRoot, 'skills', 'gsdd-plan', 'SKILL.md'));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global install ignores repo-local model overrides', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      writeFile(path.join(repoDir, '.planning', 'config.json'), JSON.stringify({
        modelProfile: 'budget',
        agentModelProfiles: {
          'plan-checker': 'budget',
          'approach-explorer': 'budget',
        },
        runtimeModelOverrides: {
          claude: {
            'plan-checker': 'repo-claude-checker',
            'approach-explorer': 'repo-claude-explorer',
          },
          opencode: {
            'plan-checker': 'vendor/repo-opencode-checker',
            'approach-explorer': 'vendor/repo-opencode-explorer',
          },
          codex: {
            'plan-checker': 'repo-codex-checker',
            'approach-explorer': 'repo-codex-explorer',
          },
        },
      }, null, 2));

      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,opencode,codex'));
      });

      const generated = [
        path.join(homeDir, '.claude', 'agents', 'gsdd-plan-checker.md'),
        path.join(homeDir, '.claude', 'agents', 'gsdd-approach-explorer.md'),
        path.join(homeDir, '.config', 'opencode', 'agents', 'gsdd-plan-checker.md'),
        path.join(homeDir, '.config', 'opencode', 'agents', 'gsdd-approach-explorer.md'),
        path.join(homeDir, '.codex', 'agents', 'gsdd-plan-checker.toml'),
        path.join(homeDir, '.codex', 'agents', 'gsdd-approach-explorer.toml'),
      ].map((filePath) => fs.readFileSync(filePath, 'utf-8')).join('\n');

      assert.doesNotMatch(generated, /repo-claude-checker|repo-claude-explorer/);
      assert.doesNotMatch(generated, /repo-opencode-checker|repo-opencode-explorer/);
      assert.doesNotMatch(generated, /repo-codex-checker|repo-codex-explorer/);
      assert.match(generated, /model: sonnet/);
      assert.match(generated, /model: opus/);
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
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

  test('runtime verification separates layout proof from model-free runtime discovery', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'opencode,codex'));
      });

      const [{ createCliContext }, { resolveGlobalInstallRoots, verifyGlobalRuntimeInstall }] = await Promise.all([
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'gsdd.mjs')).href}?t=${Date.now()}-ctx`),
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-verify`),
      ]);
      const roots = resolveGlobalInstallRoots({
        homeDir,
        env: {
          XDG_CONFIG_HOME: path.join(homeDir, '.config'),
          OPENCODE_CONFIG_DIR: path.join(homeDir, '.config', 'opencode'),
        },
      });
      const ctx = createCliContext(repoDir);
      const calls = [];
      const report = verifyGlobalRuntimeInstall({
        targets: ['opencode', 'codex'],
        roots,
        ctx,
        probeRunner: (command, args, options) => {
          calls.push({ command, args, env: options.env });
          return { status: 0, stdout: '<available_skills><name>gsdd-plan</name></available_skills>', stderr: '' };
        },
      });

      assert.strictEqual(report.failed.length, 0);
      assert.ok(report.checks.some((check) => check.target === 'opencode' && check.check === 'layout' && check.status === 'passed'));
      assert.ok(report.checks.some((check) => check.target === 'opencode' && check.check === 'runtime_discovery' && check.status === 'passed'));
      assert.ok(report.checks.some((check) => check.target === 'codex' && check.check === 'layout' && check.status === 'passed'));
      assert.ok(report.checks.some((check) => check.target === 'codex' && check.check === 'runtime_discovery' && check.status === 'unproven'));
      assert.deepStrictEqual(calls.map((call) => [call.command, call.args.join(' ')]), [['opencode', 'debug skill']]);
      assert.strictEqual(calls[0].env.XDG_CONFIG_HOME, path.join(homeDir, '.config'));
      assert.strictEqual(calls[0].env.OPENCODE_CONFIG_DIR, path.join(homeDir, '.config', 'opencode'));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('live runtime verification is explicit and uses vendor CLI probes', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      await withEnv({
        GSDD_TEST_HOME: homeDir,
        XDG_CONFIG_HOME: path.join(homeDir, '.config'),
        CLAUDE_CONFIG_DIR: path.join(homeDir, '.claude'),
        CODEX_HOME: path.join(homeDir, '.codex'),
        COPILOT_HOME: path.join(homeDir, '.copilot'),
      }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,codex,copilot'));
      });

      const [{ createCliContext }, { resolveGlobalInstallRoots, verifyGlobalRuntimeInstall }] = await Promise.all([
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'gsdd.mjs')).href}?t=${Date.now()}-ctx-live`),
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-verify-live`),
      ]);
      const roots = resolveGlobalInstallRoots({
        homeDir,
        env: {
          XDG_CONFIG_HOME: path.join(homeDir, '.config'),
          CLAUDE_CONFIG_DIR: path.join(homeDir, '.claude'),
          CODEX_HOME: path.join(homeDir, '.codex'),
          COPILOT_HOME: path.join(homeDir, '.copilot'),
        },
      });
      const commands = [];
      const report = verifyGlobalRuntimeInstall({
        targets: ['claude', 'codex', 'copilot'],
        roots,
        ctx: createCliContext(repoDir),
        liveRuntime: true,
        probeRunner: (command, args, options) => {
          commands.push({ command, args, env: options.env });
          return { status: 0, stdout: 'GSDD_SKILL_OK', stderr: '' };
        },
      });

      assert.strictEqual(report.failed.length, 0);
      assert.strictEqual(report.unproven.length, 0);
      assert.deepStrictEqual(commands.map((call) => call.command), ['claude', 'codex', 'copilot']);
      assert.ok(commands[0].args.includes('Read'));
      assert.match(commands[0].args.join('\n'), /^-p\n\/gsdd-plan Verification mode/m);
      assert.ok(!commands[1].args.includes('--ask-for-approval'));
      assert.ok(!commands[1].args.includes('gpt-5.4'));
      assert.ok(!commands[2].args.includes('gpt-5.4'));
      assert.strictEqual(commands[0].env.CLAUDE_CONFIG_DIR, path.join(homeDir, '.claude'));
      assert.strictEqual(commands[1].env.CODEX_HOME, path.join(homeDir, '.codex'));
      assert.strictEqual(commands[2].env.COPILOT_HOME, path.join(homeDir, '.copilot'));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });
});
