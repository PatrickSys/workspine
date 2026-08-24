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
const { createHash } = require('crypto');
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

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
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
    if (['codex', 'opencode', 'copilot'].includes(target) && relativePath.startsWith('skills/')) return path.join(homeDir, '.agents');
    if (target === 'codex') return path.join(homeDir, '.codex');
    return rootMap[target];
  };

  for (const relativePath of files) {
    assert.ok(fs.existsSync(path.join(rootFor(relativePath), relativePath)), `${target} missing ${relativePath}`);
  }

  if (['codex', 'opencode', 'copilot'].includes(target)) {
    const skillFiles = files.filter((relativePath) => relativePath.startsWith('skills/'));
    const agentFiles = files.filter((relativePath) => relativePath.startsWith('agents/'));
    if (skillFiles.length > 0) {
      const manifest = readJson(path.join(homeDir, '.agents', 'workspine-file-manifest.json'));
      assert.strictEqual(manifest.runtime, 'agent-skills');
      for (const relativePath of skillFiles) {
        assert.ok(manifest.files[relativePath], `${target} shared skill manifest must track ${relativePath}`);
      }
    }
    if (agentFiles.length > 0 && target !== 'opencode' && target !== 'copilot') {
      const manifest = readJson(path.join(homeDir, '.codex', 'workspine-file-manifest.json'));
      assert.strictEqual(manifest.runtime, target);
      for (const relativePath of agentFiles) {
        assert.ok(manifest.files[relativePath], `${target} agent manifest must track ${relativePath}`);
      }
    } else if (agentFiles.length > 0) {
      const manifest = readJson(path.join(rootMap[target], 'workspine-file-manifest.json'));
      assert.strictEqual(manifest.runtime, target);
      for (const relativePath of agentFiles) {
        assert.ok(manifest.files[relativePath], `${target} native manifest must track ${relativePath}`);
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

function snapshotTree(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push([`${path.relative(rootDir, absolutePath).replace(/\\/g, '/')}/`, null]);
        visit(absolutePath);
      } else if (entry.isSymbolicLink()) {
        files.push([path.relative(rootDir, absolutePath).replace(/\\/g, '/'), `symlink:${fs.readlinkSync(absolutePath)}`]);
      } else {
        files.push([path.relative(rootDir, absolutePath).replace(/\\/g, '/'), fs.readFileSync(absolutePath)]);
      }
    }
  };
  visit(rootDir);
  return files.sort(([left], [right]) => left.localeCompare(right));
}

describe('global install pressure loop', () => {
  test('README-driven first-time user loop works through the public CLI surface', async () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf-8');
    assert.match(readme, /npx -y workspine init/);
    assert.match(readme, /npx -y workspine install --global --tools claude,opencode,codex,copilot/);

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
            'skills/work-plan/SKILL.md',
            'commands/work-plan.md',
            'agents/work-plan-checker.md',
          ],
          opencode: [
            'skills/work-plan/SKILL.md',
            'commands/work-plan.md',
            'agents/work-plan-checker.md',
          ],
          codex: [
            'skills/work-plan/SKILL.md',
            'agents/work-plan-checker.toml',
          ],
          copilot: [
            'skills/work-plan/SKILL.md',
            'agents/work-plan-checker.agent.md',
          ],
        })) {
          assertGlobalAgentSurface(homeDir, target, files);
        }

        const localInstall = await runCliAsMain(repos[1], ['init', '--auto', '--tools', 'codex']);
        assert.strictEqual(localInstall.exitCode, 0);
        assert.match(localInstall.output, /Workspine initialized/i);
      });

      assertNoRepoBootstrap(repos[0]);
      assert.ok(fs.existsSync(path.join(repos[1], '.work', 'config.json')));
      assert.ok(fs.existsSync(path.join(repos[1], '.agents', 'skills', 'work-plan', 'SKILL.md')));
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
        'skills/work-plan/SKILL.md',
        'commands/work-plan.md',
        'agents/work-plan-checker.md',
        'agents/work-approach-explorer.md',
      ]);
      assertGlobalAgentSurface(homeDir, 'opencode', [
        'skills/work-plan/SKILL.md',
        'commands/work-plan.md',
        'agents/work-plan-checker.md',
        'agents/work-approach-explorer.md',
      ]);
      assertGlobalAgentSurface(homeDir, 'codex', [
        'skills/work-plan/SKILL.md',
        'agents/work-plan-checker.toml',
        'agents/work-approach-explorer.toml',
      ]);
      assertGlobalAgentSurface(homeDir, 'copilot', [
        'skills/work-plan/SKILL.md',
        'agents/work-plan-checker.agent.md',
        'agents/work-approach-explorer.agent.md',
      ]);

      for (const skillPath of [
        path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md'),
        path.join(homeDir, '.agents', 'skills', 'work-plan', 'SKILL.md'),
      ]) {
        const skill = fs.readFileSync(skillPath, 'utf-8');
        assert.match(skill, /work-plan/);
        assert.match(skill, /Plan a phase|PLAN\.md/i);
      }
      assert.ok(!fs.existsSync(path.join(homeDir, '.config', 'opencode', 'skills', 'work-plan', 'SKILL.md')),
        'OpenCode should use the shared agent-compatible skill root instead of a duplicate private skill copy');
      assert.ok(!fs.existsSync(path.join(homeDir, '.copilot', 'skills', 'work-plan', 'SKILL.md')),
        'Copilot should use the shared agent-compatible skill root instead of a duplicate private skill copy');

      const claudeCommand = fs.readFileSync(path.join(homeDir, '.claude', 'commands', 'work-plan.md'), 'utf-8');
      assertIncludesDisplayPath(claudeCommand, path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md'));
      assert.doesNotMatch(claudeCommand, /Read `\.claude\/skills\/work-plan\/SKILL\.md`/);

      const claudePlanSkill = fs.readFileSync(path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md'), 'utf-8');
      assert.match(claudePlanSkill, /globally installed skill is the canonical Claude-native/);
      assert.doesNotMatch(claudePlanSkill, /\.agents\/skills\/work-plan\/SKILL\.md/);

      const opencodeCommand = fs.readFileSync(path.join(homeDir, '.config', 'opencode', 'commands', 'work-plan.md'), 'utf-8');
      assertIncludesDisplayPath(opencodeCommand, path.join(homeDir, '.agents', 'skills', 'work-plan', 'SKILL.md'));

      const globalNewProjectSkill = fs.readFileSync(path.join(homeDir, '.agents', 'skills', 'work-new-project', 'SKILL.md'), 'utf-8');
      assert.match(globalNewProjectSkill, /otherwise use the globally installed `work-map-codebase` skill/);
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(parent);
    }
  });

  test('auto global install detects existing agent homes across unrelated fixture repos', async () => {
    const homeDir = createTempProject();
    const { parent, repos } = createFixtureRepos();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
      const installOutput = await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repos[0]);
        return captureLogs(() => gsdd.cmdInstall('--global', '--auto'));
      });

      assert.match(installOutput, /codex:/);
      assert.doesNotMatch(installOutput, /claude:/);
      assert.match(installOutput, /Global install complete/);

      for (const repo of repos) {
        assertNoRepoBootstrap(repo);
      }

      assertGlobalAgentSurface(homeDir, 'codex', [
        'skills/work-plan/SKILL.md',
        'agents/work-plan-checker.toml',
      ]);
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude')),
        'auto global install must not create undetected Claude home');
      assert.ok(!fs.existsSync(path.join(homeDir, '.copilot')),
        'auto global install must not create undetected Copilot home');
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
      assert.ok(fs.existsSync(path.join(repos[1], '.work', 'config.json')));
      assert.ok(fs.existsSync(path.join(repos[1], '.agents', 'skills', 'work-plan', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(repos[1], '.codex', 'agents', 'work-plan-checker.toml')));
      assertNoRepoBootstrap(repos[2]);

      assertGlobalAgentSurface(homeDir, 'codex', [
        'skills/work-plan/SKILL.md',
        'agents/work-plan-checker.toml',
        'agents/work-approach-explorer.toml',
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

  test('global command files reference isolated roots with Windows-safe display paths', async () => {
    const parentDir = createTempProject();
    const homeDir = path.join(parentDir, 'Home With Spaces');
    const repoDir = createTempProject();
    const claudeRoot = path.join(homeDir, '.claude');
    const configHome = path.join(homeDir, '.config');
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,opencode'));
      });

      const claudeCommand = fs.readFileSync(path.join(claudeRoot, 'commands', 'work-plan.md'), 'utf-8');
      assertIncludesDisplayPath(claudeCommand, path.join(claudeRoot, 'skills', 'work-plan', 'SKILL.md'));

      const opencodeRoot = path.join(configHome, 'opencode');
      const opencodeCommand = fs.readFileSync(path.join(opencodeRoot, 'commands', 'work-plan.md'), 'utf-8');
      assertIncludesDisplayPath(opencodeCommand, path.join(homeDir, '.agents', 'skills', 'work-plan', 'SKILL.md'));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(parentDir);
      cleanup(repoDir);
    }
  });

  test('an isolated global install ignores every inherited runtime-home redirect', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const ambientDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const ambientHomes = {
      XDG_CONFIG_HOME: path.join(ambientDir, 'xdg-config'),
      CLAUDE_CONFIG_DIR: path.join(ambientDir, 'claude'),
      OPENCODE_CONFIG_DIR: path.join(ambientDir, 'opencode'),
      CODEX_HOME: path.join(ambientDir, 'codex'),
      COPILOT_HOME: path.join(ambientDir, 'copilot-home'),
      COPILOT_CONFIG_DIR: path.join(ambientDir, 'copilot-config'),
    };

    try {
      for (const directory of Object.values(ambientHomes)) {
        writeFile(path.join(directory, 'sentinel.txt'), `ambient:${directory}`);
      }
      const before = snapshotTree(ambientDir);

      const output = await withEnv({ GSDD_TEST_HOME: homeDir, ...ambientHomes }, async () => {
        const gsdd = await loadGsdd(repoDir);
        return captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'all'));
      });

      assert.match(output, /Global install complete/);
      assert.deepStrictEqual(snapshotTree(ambientDir), before,
        'GSDD_TEST_HOME must contain every managed root even when runtime homes are inherited');
      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.config', 'opencode', 'commands', 'work-plan.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.codex', 'agents', 'work-plan-checker.toml')));
      assert.ok(fs.existsSync(path.join(homeDir, '.copilot', 'agents', 'work-plan-checker.agent.md')));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
      cleanup(ambientDir);
    }
  });

  test('fresh --auto refuses without writes and prints one exact explicit command per supported target', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();

    try {
      const before = snapshotTree(homeDir);
      const [{ GLOBAL_AGENT_OPTIONS }, result] = await Promise.all([
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-targets`),
        withEnv({ GSDD_TEST_HOME: homeDir }, async () => runCliAsMain(repoDir, [
        'install', '--global', '--auto',
        ])),
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /No supported agent homes were detected for --auto/);
      for (const { id: target } of GLOBAL_AGENT_OPTIONS) {
        assert.match(result.output, new RegExp(`npx -y workspine install --global --tools ${target}`));
      }
      assert.deepStrictEqual(snapshotTree(homeDir), before,
        'fresh --auto must remain a marker-free zero-write refusal');
    } finally {
      restoreStdin();
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('a later selected-target conflict preflights the whole set before any target writes', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const conflictingCodexAgent = path.join(homeDir, '.codex', 'agents', 'work-plan-checker.toml');

    try {
      writeFile(conflictingCodexAgent, 'user-owned codex agent\n');
      const before = snapshotTree(homeDir);
      const output = await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
        const gsdd = await loadGsdd(repoDir);
        return captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,codex'));
      });

      assert.strictEqual(process.exitCode, 1);
      assert.match(output, /work-plan-checker\.toml/);
      assert.deepStrictEqual(snapshotTree(homeDir), before,
        'a preflight conflict in a later target must prevent earlier selected-target writes');
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('OpenCode honors custom config root for commands and agents while keeping shared skill root', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const configHome = path.join(homeDir, 'Config Home With Spaces');
    const opencodeConfigDir = path.join(homeDir, 'OpenCode Config With Spaces');
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;

    try {
      const [{ createCliContext }, { createCmdInstall }] = await Promise.all([
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'gsdd.mjs')).href}?t=${Date.now()}-custom-root-ctx`),
        import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-custom-root-install`),
      ]);
      const ctx = createCliContext(repoDir);
      ctx.globalInstallRootOptions = {
        homeDir,
        env: {
          XDG_CONFIG_HOME: configHome,
          OPENCODE_CONFIG_DIR: opencodeConfigDir,
        },
      };
      await captureLogs(() => createCmdInstall(ctx)('--global', '--tools', 'opencode'));

      const skillRoot = path.join(homeDir, '.agents');
      assert.ok(fs.existsSync(path.join(skillRoot, 'skills', 'work-plan', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(opencodeConfigDir, 'commands', 'work-plan.md')));
      assert.ok(fs.existsSync(path.join(opencodeConfigDir, 'agents', 'work-plan-checker.md')));
      assert.ok(!fs.existsSync(path.join(opencodeConfigDir, 'skills', 'work-plan', 'SKILL.md')),
        'OPENCODE_CONFIG_DIR is not the shared agent-compatible skill root');
      assert.ok(!fs.existsSync(path.join(configHome, 'opencode', 'skills', 'work-plan', 'SKILL.md')),
        'OpenCode should not get a duplicate private skill copy when the shared root is available');

      const skillsManifest = readJson(path.join(skillRoot, 'workspine-file-manifest.json'));
      const configManifest = readJson(path.join(opencodeConfigDir, 'workspine-file-manifest.json'));
      assert.strictEqual(skillsManifest.runtime, 'agent-skills');
      assert.strictEqual(configManifest.runtime, 'opencode');
      assert.ok(skillsManifest.files['skills/work-plan/SKILL.md']);
      assert.ok(configManifest.files['commands/work-plan.md']);
      assert.ok(configManifest.files['agents/work-plan-checker.md']);

      const opencodeCommand = fs.readFileSync(path.join(opencodeConfigDir, 'commands', 'work-plan.md'), 'utf-8');
      assertIncludesDisplayPath(opencodeCommand, path.join(skillRoot, 'skills', 'work-plan', 'SKILL.md'));
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global install prunes stale Workspine-managed private skill copies after shared-root migration', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const oldSkill = 'old Workspine-managed duplicate skill\n';

    try {
      const staleOpenCodeSkill = path.join(homeDir, '.config', 'opencode', 'skills', 'work-plan', 'SKILL.md');
      const staleCopilotSkill = path.join(homeDir, '.copilot', 'skills', 'work-plan', 'SKILL.md');
      writeFile(staleOpenCodeSkill, oldSkill);
      writeFile(staleCopilotSkill, oldSkill);
      writeFile(path.join(homeDir, '.config', 'opencode', 'workspine-file-manifest.json'), JSON.stringify({
        product: 'Workspine',
        runtime: 'opencode',
        files: {
          'skills/work-plan/SKILL.md': sha256(oldSkill),
        },
      }, null, 2));
      writeFile(path.join(homeDir, '.copilot', 'workspine-file-manifest.json'), JSON.stringify({
        product: 'Workspine',
        runtime: 'copilot',
        files: {
          'skills/work-plan/SKILL.md': sha256(oldSkill),
        },
      }, null, 2));

      const output = await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        return captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'opencode,copilot'));
      });

      assert.match(output, /stale removed/);
      assert.ok(!fs.existsSync(staleOpenCodeSkill), 'old OpenCode private skill copy should be pruned');
      assert.ok(!fs.existsSync(staleCopilotSkill), 'old Copilot private skill copy should be pruned');
      assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'work-plan', 'SKILL.md')));
      assert.ok(!readJson(path.join(homeDir, '.config', 'opencode', 'workspine-file-manifest.json')).files['skills/work-plan/SKILL.md']);
      assert.ok(!readJson(path.join(homeDir, '.copilot', 'workspine-file-manifest.json')).files['skills/work-plan/SKILL.md']);
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global install refuses to prune user-modified stale private skill copies', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const oldSkill = 'old Workspine-managed duplicate skill\n';
    const modifiedSkill = 'user edited duplicate skill\n';

    try {
      const staleOpenCodeSkill = path.join(homeDir, '.config', 'opencode', 'skills', 'work-plan', 'SKILL.md');
      writeFile(staleOpenCodeSkill, modifiedSkill);
      writeFile(path.join(homeDir, '.config', 'opencode', 'workspine-file-manifest.json'), JSON.stringify({
        product: 'Workspine',
        runtime: 'opencode',
        files: {
          'skills/work-plan/SKILL.md': sha256(oldSkill),
        },
      }, null, 2));

      const output = await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        return captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'opencode'));
      });

      assert.match(output, /stale Workspine-managed file was modified by the user/);
      assert.strictEqual(process.exitCode, 1);
      assert.strictEqual(fs.readFileSync(staleOpenCodeSkill, 'utf-8'), modifiedSkill);
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
        path.join(homeDir, '.claude', 'agents', 'work-plan-checker.md'),
        path.join(homeDir, '.claude', 'agents', 'work-approach-explorer.md'),
        path.join(homeDir, '.config', 'opencode', 'agents', 'work-plan-checker.md'),
        path.join(homeDir, '.config', 'opencode', 'agents', 'work-approach-explorer.md'),
        path.join(homeDir, '.codex', 'agents', 'work-plan-checker.toml'),
        path.join(homeDir, '.codex', 'agents', 'work-approach-explorer.toml'),
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
    const customSkill = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
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
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'commands', 'work-plan.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'agents', 'work-plan-checker.md')));
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
          return { status: 0, stdout: '<available_skills><name>work-plan</name></available_skills>', stderr: '' };
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
      assert.strictEqual(calls[0].env.HOME, homeDir);
      assert.strictEqual(calls[0].env.USERPROFILE, homeDir);
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
      assert.match(commands[0].args.join('\n'), /^-p\n\/work-plan Verification mode/m);
      assert.ok(!commands[1].args.includes('--ask-for-approval'));
      assert.ok(!commands[1].args.includes('gpt-5.4'));
      assert.ok(!commands[2].args.includes('gpt-5.4'));
      assert.strictEqual(commands[0].env.CLAUDE_CONFIG_DIR, path.join(homeDir, '.claude'));
      assert.strictEqual(commands[1].env.CODEX_HOME, path.join(homeDir, '.codex'));
      assert.strictEqual(commands[1].env.HOME, homeDir);
      assert.strictEqual(commands[1].env.USERPROFILE, homeDir);
      assert.strictEqual(commands[2].env.COPILOT_HOME, path.join(homeDir, '.copilot'));
      assert.strictEqual(commands[2].env.HOME, homeDir);
      assert.strictEqual(commands[2].env.USERPROFILE, homeDir);
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global update reconciles every owned target without a selector', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const claudeSkill = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,codex'));
        const beforeRepo = snapshotTree(repoDir);
        const cleanUpdate = await captureLogs(() => gsdd.cmdGlobalUpdate());
        assert.match(cleanUpdate, /claude:/);
        assert.match(cleanUpdate, /codex:/);
        assert.strictEqual(process.exitCode, undefined);
        fs.writeFileSync(claudeSkill, 'user edit that should be recovered\n');
        const output = await captureLogs(() => gsdd.cmdGlobalUpdate());
        assert.match(output, /claude:/);
        assert.match(output, /codex:/);
        assert.strictEqual(process.exitCode, 1, 'modified owned global bytes must refuse before any target writes');
        assert.strictEqual(fs.readFileSync(claudeSkill, 'utf-8'), 'user edit that should be recovered\n');
        assert.deepStrictEqual(snapshotTree(repoDir), beforeRepo, 'global update must not touch the invoking repo');
      });
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global update repairs missing files across every owned target', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const missingFiles = [
      path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md'),
      path.join(homeDir, '.codex', 'agents', 'work-plan-checker.toml'),
    ];
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,codex'));
        for (const filePath of missingFiles) fs.unlinkSync(filePath);
        const output = await captureLogs(() => gsdd.cmdGlobalUpdate());
        assert.strictEqual(process.exitCode, undefined);
        assert.match(output, /claude:/);
        assert.match(output, /codex:/);
        for (const filePath of missingFiles) assert.ok(fs.existsSync(filePath), `${filePath} must be reconciled`);
      });
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global update dry-run preserves modified owned bytes and refuses', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const claudeSkill = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude,codex'));
        const original = fs.readFileSync(claudeSkill, 'utf-8');
        const manifest = JSON.parse(fs.readFileSync(path.join(homeDir, '.claude', 'workspine-file-manifest.json'), 'utf-8'));
        fs.writeFileSync(claudeSkill, original.replace('work-plan', 'work-plan updated source'));
        // Keep the refusal contract explicit: an owned byte drift is never silently overwritten.
        const output = await captureLogs(() => gsdd.cmdGlobalUpdate('--dry-run'));
        assert.strictEqual(process.exitCode, 1);
        assert.match(output, /modified by the user/);
        assert.ok(manifest.files['skills/work-plan/SKILL.md']);
      });
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global update refuses linked, colliding, and corrupt selected targets without writes', async () => {
    const cases = [
      {
        name: 'linked',
        mutate: (homeDir) => {
          const target = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
          const external = path.join(homeDir, 'user-owned-skill.md');
          fs.writeFileSync(external, 'user-owned bytes\n');
          fs.unlinkSync(target);
          fs.symlinkSync(external, target, 'file');
        },
      },
      {
        name: 'linked-manifest',
        mutate: (homeDir) => {
          const manifest = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
          fs.unlinkSync(manifest);
          fs.symlinkSync(path.join(homeDir, 'missing-manifest.json'), manifest, 'file');
        },
      },
      {
        name: 'collision',
        mutate: (homeDir) => {
          const target = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
          fs.unlinkSync(target);
          fs.mkdirSync(target, { recursive: true });
        },
      },
      {
        name: 'corrupt',
        mutate: (homeDir) => {
          fs.writeFileSync(path.join(homeDir, '.claude', 'workspine-file-manifest.json'), '{not-json');
        },
      },
      {
        name: 'unowned',
        mutate: (homeDir) => {
          const manifestPath = path.join(homeDir, '.claude', 'workspine-file-manifest.json');
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          delete manifest.files['skills/work-plan/SKILL.md'];
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        },
      },
    ];

    for (const scenario of cases) {
      const homeDir = createTempProject();
      const repoDir = createTempProject();
      const restoreStdin = setNonInteractiveStdin();
      const previousExitCode = process.exitCode;
      try {
        await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
          const gsdd = await loadGsdd(repoDir);
          await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude'));
          scenario.mutate(homeDir);
          const before = snapshotTree(homeDir);
          const output = await captureLogs(() => gsdd.cmdGlobalUpdate());
          assert.strictEqual(process.exitCode, 1, `${scenario.name} must refuse`);
          const expectedReason = scenario.name === 'corrupt' ? 'corrupt' : scenario.name === 'linked-manifest' ? 'linked' : scenario.name;
          assert.match(output, new RegExp(expectedReason));
          assert.deepStrictEqual(snapshotTree(homeDir), before, `${scenario.name} refusal must be zero-write`);
        });
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
        cleanup(repoDir);
      }
    }
  });

  test('global update leaves unknown unowned files untouched while reconciling owned files', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    const unknown = path.join(homeDir, '.claude', 'user-owned.txt');
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'claude'));
        fs.writeFileSync(unknown, 'do not touch\n');
        const before = fs.readFileSync(unknown);
        const output = await captureLogs(() => gsdd.cmdGlobalUpdate());
        assert.strictEqual(process.exitCode, undefined);
        assert.match(output, /claude:/);
        assert.deepStrictEqual(fs.readFileSync(unknown), before);
      });
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global ownership discovery does not infer native ownership from shared agent-skills manifest', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const gsdd = await loadGsdd(repoDir);
        await captureLogs(() => gsdd.cmdInstall('--global', '--tools', 'opencode'));
        fs.unlinkSync(path.join(homeDir, '.config', 'opencode', 'workspine-file-manifest.json'));
        fs.rmSync(path.join(homeDir, '.config', 'opencode', 'commands'), { recursive: true, force: true });
        const { getManifestOwnedGlobalTargets, resolveGlobalInstallRoots } = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-shared-discovery`);
        const roots = resolveGlobalInstallRoots({ homeDir, env: { XDG_CONFIG_HOME: path.join(homeDir, '.config') } });
        const ownedTargets = getManifestOwnedGlobalTargets({ roots });
        assert.deepStrictEqual(ownedTargets, [], 'shared ownership must not imply a native target');
        const before = snapshotTree(homeDir);
        const output = await captureLogs(() => gsdd.cmdGlobalUpdate());
        assert.strictEqual(process.exitCode, 1, output);
        assert.match(output, /no manifest-owned global install targets/);
        assert.doesNotMatch(output, /codex|copilot|opencode/);
        assert.deepStrictEqual(snapshotTree(homeDir), before, 'missing native manifest and files must refuse without writes');
      });
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });

  test('global OpenCode-only ownership reconciles only OpenCode split roots', async () => {
    const homeDir = createTempProject();
    const repoDir = createTempProject();
    const restoreStdin = setNonInteractiveStdin();
    const previousExitCode = process.exitCode;
    try {
      await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
        const install = await runCliAsMain(repoDir, ['install', '--global', '--tools', 'opencode']);
        assert.strictEqual(install.exitCode, 0, install.output);
        const { getManifestOwnedGlobalTargets, resolveGlobalInstallRoots } = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-opencode-only`);
        const roots = resolveGlobalInstallRoots({ homeDir, env: { XDG_CONFIG_HOME: path.join(homeDir, '.config') } });
        assert.deepStrictEqual(getManifestOwnedGlobalTargets({ roots }), ['opencode']);
        const beforeUpdateCodex = snapshotTree(path.join(homeDir, '.codex'));
        const beforeUpdateCopilot = snapshotTree(path.join(homeDir, '.copilot'));
        const beforeUpdateRepo = snapshotTree(repoDir);
        const update = await runCliAsMain(repoDir, ['update', '-g']);
        assert.strictEqual(update.exitCode, 0, update.output);
        assert.match(update.output, /opencode:/);
        assert.doesNotMatch(update.output, /codex|copilot/);
        assert.deepStrictEqual(snapshotTree(repoDir), beforeUpdateRepo, 'global update must not touch the invoking repo');
        assert.deepStrictEqual(snapshotTree(path.join(homeDir, '.codex')), beforeUpdateCodex, 'OpenCode-only update must not write Codex home');
        assert.deepStrictEqual(snapshotTree(path.join(homeDir, '.copilot')), beforeUpdateCopilot, 'OpenCode-only update must not write Copilot home');

        const beforeHealthHome = snapshotTree(homeDir);
        const beforeHealthRepo = snapshotTree(repoDir);
        const health = await runCliAsMain(repoDir, ['health', '-g', '--json']);
        assert.strictEqual(health.exitCode, 0, health.output);
        const report = JSON.parse(health.output);
        assert.strictEqual(report.status, 'healthy');
        const healthMessages = [...report.errors, ...report.warnings, ...report.info].map((entry) => entry.message).join('\n');
        assert.match(healthMessages, /opencode/);
        assert.doesNotMatch(healthMessages, /codex|copilot/);
        assert.deepStrictEqual(snapshotTree(homeDir), beforeHealthHome, 'global health must be read-only');
        assert.deepStrictEqual(snapshotTree(repoDir), beforeHealthRepo, 'global health must not touch the invoking repo');
        assert.ok(!fs.existsSync(path.join(homeDir, '.codex')), 'OpenCode-only global update must not create Codex home');
        assert.ok(!fs.existsSync(path.join(homeDir, '.copilot')), 'OpenCode-only global update must not create Copilot home');
      });
    } finally {
      restoreStdin();
      process.exitCode = previousExitCode;
      cleanup(homeDir);
      cleanup(repoDir);
    }
  });
});
