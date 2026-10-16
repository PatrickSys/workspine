const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { cleanup, createTempProject, runCliAsMain, withEnv } = require('./gsdd.helpers.cjs');

const ROOT = path.join(__dirname, '..');
const NPM = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const NPM_PREFIX = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function snapshotTree(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name).replace(/\\/g, '/');
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return [{ path: `${relative}/`, directory: true }, ...snapshotTree(absolute, relative)];
    if (entry.isSymbolicLink()) return [{ path: relative, link: fs.readlinkSync(absolute) }];
    return [{ path: relative, bytes: fs.readFileSync(absolute).toString('base64') }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function runInstalled(entryPath, cwd, args, env = {}) {
  return spawnSync(process.execPath, [entryPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', ...env },
  });
}

function assertRootGuidance(root) {
  const agentsPath = path.join(root, 'AGENTS.md');
  assert.ok(fs.existsSync(agentsPath), 'normal setup must expose Workspine in root AGENTS.md');
  const guidance = fs.readFileSync(agentsPath, 'utf8');
  assert.match(guidance, /\.agents\/skills\/work-\*\/SKILL\.md/);
  assert.match(guidance, /\$work-plan/);
  assert.match(guidance, /\/work-plan/);
  assert.match(guidance, /owner approval/);
  for (const workflow of ['work-plan', 'work-execute', 'work-verify', 'work-progress']) {
    assert.ok(guidance.includes(workflow), `root guidance must route to ${workflow}`);
    assert.ok(fs.existsSync(path.join(root, '.agents', 'skills', workflow, 'SKILL.md')));
  }
  assert.strictEqual((guidance.match(/<!-- BEGIN GSDD -->/g) || []).length, 1);
  return guidance;
}

const BEGIN = '<!-- BEGIN GSDD -->';
const END = '<!-- END GSDD -->';
const MALFORMED_ROOT_BLOCKS = [
  ['duplicate begin', `${BEGIN}\nOwner policy\n${BEGIN}\nOld guide\n${END}\n`],
  ['duplicate end', `${BEGIN}\nOld guide\n${END}\nOwner policy\n${END}\n`],
  ['nested pair', `${BEGIN}\nOwner policy\n${BEGIN}\nOld guide\n${END}\n${END}\n`],
  ['two pairs', `${BEGIN}\nFirst\n${END}\nOwner policy\n${BEGIN}\nSecond\n${END}\n`],
  ['reversed pair', `${END}\nOwner policy\n${BEGIN}\n`],
  ['inline begin', `Owner policy ${BEGIN}\nOld guide\n${END}\n`],
  ['inline end', `${BEGIN}\nOld guide\n${END} Owner policy\n`],
  ['indented marker', `  ${BEGIN}\nOld guide\n${END}\n`],
  ['same line pair', `${BEGIN} Owner policy ${END}\n`],
];

async function createLegacyPortableFixture(root, run = (args) => runCliAsMain(root, args)) {
  const seeded = await run(['setup', '--no-agents', '-y']);
  assert.strictEqual(seeded.exitCode ?? seeded.status, 0, seeded.output || seeded.stderr);
  fs.renameSync(path.join(root, '.work'), path.join(root, '.planning'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.planning', 'generation-manifest.json'), 'utf8'));
  assert.ok(manifest.adapterFiles['.agents/skills/work-plan/SKILL.md']);
  assert.ok(!Object.hasOwn(manifest.adapterFiles, 'AGENTS.md'));
  writeFile(path.join(root, '.planning', 'consumer.bin'), Buffer.from([0, 255, 13, 10, 128]));
  writeFile(path.join(root, 'AGENTS.md'), '# Owner rules\r\n\r\nKeep all bytes.  \r\n');
}

function installPackedEntry() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-packed-'));
  const pack = path.join(root, 'pack');
  const install = path.join(root, 'install');
  fs.mkdirSync(pack, { recursive: true });
  fs.mkdirSync(install, { recursive: true });
  const packed = JSON.parse(execFileSync(NPM, [...NPM_PREFIX, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', pack], { cwd: ROOT, encoding: 'utf8' }));
  assert.strictEqual(packed.length, 1);
  const shipped = new Set(packed[0].files.map((file) => file.path));
  for (const required of ['bin/lib/setup.mjs', 'bin/lib/manifest.mjs', 'bin/lib/rendering.mjs', 'bin/adapters/agents.mjs', 'distilled/templates/agents.block.md', 'distilled/workflows/plan.md']) {
    assert.ok(shipped.has(required), `package missing ${required}`);
  }
  assert.ok(![...shipped].some((file) => file.startsWith('.factory-038-smoke/')), 'local evidence must not ship');
  const tarball = path.join(pack, packed[0].filename);
  writeFile(path.join(install, 'package.json'), '{"name":"packed-setup-consumer","private":true}\n');
  execFileSync(NPM, [...NPM_PREFIX, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', tarball], { cwd: install, stdio: 'pipe' });
  const packageName = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
  const packageRoot = path.join(install, 'node_modules', packageName);
  return { root, install, entry: fs.realpathSync(path.join(packageRoot, 'bin', 'gsdd.mjs')) };
}

async function runPromptedSetup(root, args, setupPromptApi) {
  const [{ createCliContext }, { createCmdSetup }] = await Promise.all([
    import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'cli-context.mjs')).href}?t=${Date.now()}-${Math.random()}`),
    import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'setup.mjs')).href}?t=${Date.now()}-${Math.random()}`),
  ]);
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const lines = [];
  const previousLog = console.log;
  const previousError = console.error;
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  process.chdir(root);
  console.log = (...parts) => lines.push(parts.join(' '));
  console.error = (...parts) => lines.push(parts.join(' '));
  try {
    process.exitCode = 0;
    await createCmdSetup({ ...createCliContext(root), setupPromptApi })(...args);
    return { exitCode: process.exitCode ?? 0, output: lines.join('\n') };
  } finally {
    console.log = previousLog;
    console.error = previousError;
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
    else delete process.stdin.isTTY;
  }
}

describe('gsdd setup facade', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('S8 portable setup hints Claude only when its home exists and no agent was selected', async () => {
    const home = path.join(tmpDir, 'isolated-home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    await withEnv({ GSDD_TEST_HOME: home }, async () => {
      const result = await runCliAsMain(tmpDir, ['setup', '--yes']);
      assert.strictEqual(result.exitCode, 0, result.output);
      assert.match(result.output, /npx -y workspine setup --agent claude --yes/);
      assert.ok(fs.existsSync(path.join(tmpDir, '.agents/skills/work-plan/SKILL.md')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.claude')), 'portable remains the default');
      const claudeRepo = path.join(tmpDir, 'claude-repo');
      fs.mkdirSync(claudeRepo);
      const explicit = await runCliAsMain(claudeRepo, ['setup', '--agent', 'claude', '--yes']);
      assert.strictEqual(explicit.exitCode, 0, explicit.output);
      assert.doesNotMatch(explicit.output, /Claude home detected/);
      assert.ok(fs.existsSync(path.join(claudeRepo, '.claude/skills/work-plan/SKILL.md')));
      assert.ok(fs.existsSync(path.join(claudeRepo, '.claude/agents/work-plan-checker.md')));
    });
    const absentHome = path.join(tmpDir, 'absent-home');
    await withEnv({ GSDD_TEST_HOME: absentHome }, async () => {
      const result = await runCliAsMain(tmpDir, ['setup', '--yes', '--dry-run']);
      assert.doesNotMatch(result.output, /Claude home detected/);
    });
  });

  test('defaults to project scope, creates portable skills, and reruns without writes', async () => {
    const first = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(first.exitCode, 0, first.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'config.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-quick', 'SKILL.md')));
    assertRootGuidance(tmpDir);
    const before = snapshotTree(tmpDir);
    const second = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(second.exitCode, 0, second.output);
    assert.match(second.output, /state already exists/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
  });

  test('setup appends guidance without changing consumer governance bytes and update preserves it', async () => {
    const original = '# Team rules\r\n\r\n\r\nKeep owner approval.  \r\nUse our build command.';
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(agentsPath, original);
    const first = await runCliAsMain(tmpDir, ['setup', '--agent', 'codex', '-y']);
    assert.strictEqual(first.exitCode, 0, first.output);
    const guidance = assertRootGuidance(tmpDir);
    assert.ok(guidance.startsWith(original), 'consumer content must remain byte-for-byte at the start');
    fs.appendFileSync(agentsPath, '\nTeam addition after setup.\r\n');
    const beforeUpdate = fs.readFileSync(agentsPath);
    const update = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(update.exitCode, 0, update.output);
    assert.deepStrictEqual(fs.readFileSync(agentsPath), beforeUpdate);
    assertRootGuidance(tmpDir);
  });

  test('project --no-agents preserves root governance while still installing portable and requested native skills', async () => {
    for (const [index, flags] of [[], ['--agent', 'codex'], ['--all'], ['--agent', 'generic']].entries()) {
      const root = path.join(tmpDir, `opt-out-${index}`);
      fs.mkdirSync(root);
      const original = '# Consumer-only rules\r\nKeep exactly.\r\n';
      if (index % 2) fs.writeFileSync(path.join(root, 'AGENTS.md'), original);
      const result = await runCliAsMain(root, ['setup', '-y', '--no-agents', ...flags]);
      assert.strictEqual(result.exitCode, 0, result.output);
      assert.ok(fs.existsSync(path.join(root, '.agents/skills/work-plan/SKILL.md')));
      if (index % 2) assert.strictEqual(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), original);
      else assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
      if (index === 1 || index === 2) assert.ok(fs.existsSync(path.join(root, '.codex/agents')));
    }
    const before = snapshotTree(tmpDir);
    const global = await runCliAsMain(tmpDir, ['setup', '--global', '--agent', 'codex', '--no-agents', '-y']);
    assert.strictEqual(global.exitCode, 1);
    assert.match(global.output, /--no-agents applies only to project setup/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
  });

  test('setup refuses partial root markers and non-file targets before writing generated surfaces', async () => {
    for (const [index, content] of ['<!-- BEGIN GSDD -->\nunfinished', '<!-- END GSDD -->\norphan', null].entries()) {
      const root = path.join(tmpDir, `unsafe-root-${index}`);
      fs.mkdirSync(root);
      const agentsPath = path.join(root, 'AGENTS.md');
      if (content === null) fs.mkdirSync(agentsPath);
      else fs.writeFileSync(agentsPath, content);
      const before = snapshotTree(root);
      const result = await runCliAsMain(root, ['setup', '-y']);
      assert.strictEqual(result.exitCode, 1, result.output);
      assert.match(result.output, /Refusing adapter update/);
      assert.deepStrictEqual(snapshotTree(root), before);
    }
  });

  for (const [label, malformed] of MALFORMED_ROOT_BLOCKS) {
    test(`malformed root ${label} refuses fresh setup, init and owned update without writes`, async () => {
      for (const mode of ['setup', 'init', 'update']) {
        const root = path.join(tmpDir, mode);
        fs.mkdirSync(root);
        if (mode === 'update') {
          const seeded = await runCliAsMain(root, ['setup', '-y']);
          assert.strictEqual(seeded.exitCode, 0, seeded.output);
        }
        const agentsPath = path.join(root, 'AGENTS.md');
        const original = Buffer.from(`# Owner rules\r\n\r\n${malformed}Keep this policy.  \r\n`);
        fs.writeFileSync(agentsPath, original);
        writeFile(path.join(root, 'consumer.bin'), Buffer.from([0, 255, 128]));
        const before = snapshotTree(root);
        const args = mode === 'setup' ? ['setup', '-y']
          : mode === 'init' ? ['init', '--auto', '--tools', 'agents'] : ['update'];
        const result = await runCliAsMain(root, args);
        // Assert byte preservation first: a nonzero exit after writes is also unsafe.
        assert.deepStrictEqual(fs.readFileSync(agentsPath), original, `${mode}: ${label} changed owner policy`);
        assert.deepStrictEqual(snapshotTree(root), before, `${mode}: ${label} wrote repository bytes`);
        assert.strictEqual(result.exitCode, 1, result.output);
        assert.match(result.output, /Refusing adapter update/);
      }
    });
  }

  test('a single standalone root pair preserves surrounding CRLF bytes through setup and owned update', async () => {
    const prefix = '# Owner rules\r\nKeep before.  \r\n';
    const suffix = '\r\n\r\nKeep after.  \r\n';
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(agentsPath, `${prefix}${BEGIN}\r\nOld guide\r\n${END}${suffix}`);
    const setup = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(setup.exitCode, 0, setup.output);
    let guidance = assertRootGuidance(tmpDir);
    assert.ok(guidance.startsWith(prefix));
    assert.ok(guidance.endsWith(suffix));
    fs.writeFileSync(agentsPath, guidance.replace('## GSDD Governance (Generated)', '## Outdated managed guide'));
    const update = await runCliAsMain(tmpDir, ['update']);
    assert.strictEqual(update.exitCode, 0, update.output);
    guidance = assertRootGuidance(tmpDir);
    assert.ok(guidance.startsWith(prefix));
    assert.ok(guidance.endsWith(suffix));
    assert.match(guidance, /## GSDD Governance \(Generated\)/);
  });

  test('owned legacy root adapter aliases refuse malformed markers before update writes', async () => {
    for (const runtime of ['cursor', 'copilot', 'gemini']) {
      const root = path.join(tmpDir, runtime);
      fs.mkdirSync(root);
      const seeded = await runCliAsMain(root, ['init', '--auto', '--tools', runtime]);
      assert.strictEqual(seeded.exitCode, 0, seeded.output);
      writeFile(path.join(root, 'AGENTS.md'), `${BEGIN}\nOwner policy\n${BEGIN}\nOld guide\n${END}\n`);
      const before = snapshotTree(root);
      const refused = await runCliAsMain(root, ['update']);
      assert.strictEqual(refused.exitCode, 1, refused.output);
      assert.deepStrictEqual(snapshotTree(root), before, `${runtime} update wrote before refusing malformed root markers`);
    }
  });

  test('setup migration refuses unowned root guidance before moving a valid portable generation manifest', async () => {
    await createLegacyPortableFixture(tmpDir);
    const before = snapshotTree(tmpDir);
    const result = await runCliAsMain(tmpDir, ['setup', '--migrate', '-y']);
    assert.strictEqual(result.exitCode, 1, result.output);
    assert.match(result.output, /AGENTS\.md is not generation-manifest-owned/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before, 'refusal must preserve .planning, root policy and every repository byte');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
    const optedOut = await runCliAsMain(tmpDir, ['setup', '--migrate', '--no-agents', '-y']);
    assert.strictEqual(optedOut.exitCode, 0, optedOut.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'migration-receipt.json')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8'), '# Owner rules\r\n\r\nKeep all bytes.  \r\n');
  });

  test('setup migration checks all selected portable and native collisions before renaming legacy state', async () => {
    for (const [index, relativePath] of ['.agents/skills/work-plan/SKILL.md', '.codex/agents/work-plan-checker.toml'].entries()) {
      const root = path.join(tmpDir, `legacy-collision-${index}`);
      writeFile(path.join(root, '.planning', 'config.json'), '{"initVersion":"v1.1"}\n');
      writeFile(path.join(root, '.planning', 'consumer.bin'), Buffer.from([0, 255, 128]));
      writeFile(path.join(root, 'AGENTS.md'), '# Consumer policy\r\nKeep exactly.\r\n');
      writeFile(path.join(root, relativePath), 'Consumer-owned target\r\n');
      const before = snapshotTree(root);
      const result = await runCliAsMain(root, ['setup', '--migrate', '--agent', 'codex', '-y']);
      assert.strictEqual(result.exitCode, 1, result.output);
      assert.match(result.output, /Refusing adapter update/);
      assert.deepStrictEqual(snapshotTree(root), before);
      assert.ok(!fs.existsSync(path.join(root, '.work')));
    }
  });

  test('dry run is zero-write and hidden --dry remains compatible', async () => {
    const before = fs.readdirSync(tmpDir);
    const result = await runCliAsMain(tmpDir, ['setup', '--dry-run']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /dry run/);
    assert.match(result.output, /AGENTS\.md/);
    assert.deepStrictEqual(fs.readdirSync(tmpDir), before);
    const hidden = await runCliAsMain(tmpDir, ['setup', '--dry']);
    assert.strictEqual(hidden.exitCode, 0, hidden.output);
  });

  test('headless setup without consent fails closed', async () => {
    const result = await runCliAsMain(tmpDir, ['setup']);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output, /Non-interactive setup requires/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.work')));
  });

  test('strict setup grammar rejects U/D/M/P errors without writing', async () => {
    for (const args of [
      ['setup', '--auto'],
      ['setup', '-y', '-y'],
      ['setup', '--agent'],
      ['setup', 'unexpected'],
    ]) {
      const before = snapshotTree(tmpDir);
      const result = await runCliAsMain(tmpDir, args);
      assert.strictEqual(result.exitCode, 1, `${args.join(' ')}\n${result.output}`);
      assert.deepStrictEqual(snapshotTree(tmpDir), before, `${args.join(' ')} wrote bytes`);
    }
  });

  test('partial current state is zero-write and routes to update/health', async () => {
    writeFile(path.join(tmpDir, '.work', 'config.json'), '{"initVersion":"v1.1"}\n');
    const before = snapshotTree(tmpDir);
    const result = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /update/);
    assert.match(result.output, /health/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
  });

  test('migration is explicit in headless mode and accepted migration continues setup', async () => {
    writeFile(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const before = snapshotTree(tmpDir);
    const refused = await runCliAsMain(tmpDir, ['setup', '-y']);
    assert.strictEqual(refused.exitCode, 1);
    assert.match(refused.output, /setup --migrate/);
    assert.deepStrictEqual(snapshotTree(tmpDir), before);
    const accepted = await runCliAsMain(tmpDir, ['setup', '--migrate', '-y']);
    assert.strictEqual(accepted.exitCode, 0, accepted.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'migration-receipt.json')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
  });

  test('bare interactive setup defaults to this repo and recommended portable skills with one consent', async () => {
    let consentPrompts = 0;
    const result = await runPromptedSetup(tmpDir, [], {
      chooseSetupScope: async () => { throw new Error('bare setup must not ask for scope'); },
      chooseProjectMode: async () => { throw new Error('bare setup must not ask for a project mode'); },
      selectProjectTargets: async () => { throw new Error('bare setup must not ask for native targets'); },
      confirmSetup: async ({ details }) => {
        consentPrompts += 1;
        assert.match(details.join(' '), /Bounded write set: \.work\//);
        assert.match(details.join(' '), /AGENTS\.md/);
        return true;
      },
    });

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(consentPrompts, 1);
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex')), 'native targets stay explicit');
    assertRootGuidance(tmpDir);
    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.work', 'config.json'), 'utf8'));
    assert.strictEqual(config.rigorProfile, 'high');
    assert.strictEqual(config.researchDepth, 'deep');
    assert.strictEqual(config.workflow.discuss, true);
    assert.doesNotMatch(result.output, /Config summary:/);
    assert.match(result.output, /Configuration: high rigor, balanced models, tracked \.work\/ documents\./);
    assert.match(result.output, /Start with one small planned change/i);
    assert.match(result.output, /work-plan[\s\S]*owner approval[\s\S]*work-execute[\s\S]*work-verify/i);
    assert.ok(result.output.indexOf('work-plan') < result.output.indexOf('work-quick'), 'the trustworthy loop must appear before the shortcut');
  });

  test('interactive explicit target, consent, and migration decline are bounded', async () => {
    const customizedRoot = path.join(tmpDir, 'customized');
    fs.mkdirSync(customizedRoot);
    const declined = await runPromptedSetup(customizedRoot, ['--agent', 'codex'], {
      confirmSetup: async () => false,
    });
    assert.strictEqual(declined.exitCode, 1);
    assert.ok(!fs.existsSync(path.join(customizedRoot, '.work')));

    const accepted = await runPromptedSetup(customizedRoot, ['--agent', 'codex'], {
      confirmSetup: async () => true,
    });
    assert.strictEqual(accepted.exitCode, 0, accepted.output);
    assert.ok(fs.existsSync(path.join(customizedRoot, '.codex', 'agents')));

    const legacyRoot = path.join(tmpDir, 'legacy-interactive');
    writeFile(path.join(legacyRoot, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const legacyBefore = snapshotTree(legacyRoot);
    const migrationDeclined = await runPromptedSetup(legacyRoot, [], {
      confirmLegacyMigration: async () => false,
    });
    assert.strictEqual(migrationDeclined.exitCode, 1);
    assert.deepStrictEqual(snapshotTree(legacyRoot), legacyBefore);

    const migrationConsentRoot = path.join(tmpDir, 'legacy-consent');
    writeFile(path.join(migrationConsentRoot, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
    const migrationConsentBefore = snapshotTree(migrationConsentRoot);
    let migrationPrompts = 0;
    const migrationConsentDeclined = await runPromptedSetup(migrationConsentRoot, [], {
      confirmLegacyMigration: async () => {
        migrationPrompts += 1;
        return true;
      },
      confirmSetup: async ({ details }) => {
        migrationPrompts += 1;
        assert.match(details.join(' '), /Bounded write set: \.work\//);
        return false;
      },
    });
    assert.strictEqual(migrationConsentDeclined.exitCode, 1);
    assert.strictEqual(migrationPrompts, 2, 'migration approval and final write consent are separate prompts');
    assert.deepStrictEqual(snapshotTree(migrationConsentRoot), migrationConsentBefore);
  });

  test('taxonomy, collision refusal, Gitless containment, and global isolation hold', async () => {
    const invalidAgent = await runCliAsMain(tmpDir, ['setup', '--agent', 'copilot', '-y']);
    assert.strictEqual(invalidAgent.exitCode, 1);
    const collisionRoot = path.join(tmpDir, 'collision');
    fs.mkdirSync(collisionRoot, { recursive: true });
    writeFile(path.join(collisionRoot, '.agents', 'skills', 'work-quick', 'SKILL.md'), 'user-owned\n');
    const beforeCollision = snapshotTree(collisionRoot);
    const collision = await runCliAsMain(tmpDir, ['setup', '--workspace-root', collisionRoot, '-y']);
    assert.strictEqual(collision.exitCode, 1, collision.output);
    assert.deepStrictEqual(snapshotTree(collisionRoot), beforeCollision);

    const parent = path.join(tmpDir, 'parent');
    const child = path.join(parent, 'child');
    fs.mkdirSync(child, { recursive: true });
    writeFile(path.join(parent, '.work', 'config.json'), '{"user":"ancestor"}\n');
    const isolated = await runCliAsMain(child, ['setup', '-y']);
    assert.strictEqual(isolated.exitCode, 0, isolated.output);
    assert.ok(fs.existsSync(path.join(child, '.work')));
    assert.deepStrictEqual(fs.readFileSync(path.join(parent, '.work', 'config.json'), 'utf8'), '{"user":"ancestor"}\n');
    assert.ok(!fs.existsSync(path.join(child, '.git')), 'setup must not run git init');

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-home-'));
    try {
      const globalResult = await withEnv({ GSDD_TEST_HOME: home }, () => runCliAsMain(tmpDir, ['setup', '--global', '--agent', 'codex', '-y']));
      assert.strictEqual(globalResult.exitCode, 0, globalResult.output);
      assert.ok(fs.existsSync(path.join(home, '.codex', 'agents')));
      assert.ok(!fs.existsSync(path.join(tmpDir, '.agents')));
    } finally {
      cleanup(home);
    }
  });

  test('project setup binds native adapters to the resolved workspace root, not the invocation cwd', async () => {
    for (const [label, selection, expectedPaths] of [
      ['claude', ['--agent', 'claude'], ['.claude']],
      ['codex', ['--agent', 'codex'], ['.codex']],
      ['all', ['--all'], ['.claude', '.opencode', '.codex', 'AGENTS.md']],
    ]) {
      const invocationRoot = path.join(tmpDir, `foreign-${label}`);
      const targetRoot = path.join(tmpDir, `target-${label}`);
      fs.mkdirSync(invocationRoot, { recursive: true });
      fs.mkdirSync(targetRoot, { recursive: true });
      writeFile(path.join(invocationRoot, 'canary.txt'), `${label}-foreign\n`);
      const invocationBefore = snapshotTree(invocationRoot);

      const result = await runCliAsMain(invocationRoot, [
        'setup',
        '--workspace-root', targetRoot,
        ...selection,
        '-y',
      ]);

      assert.strictEqual(result.exitCode, 0, `${label}\n${result.output}`);
      assert.deepStrictEqual(snapshotTree(invocationRoot), invocationBefore, `${label} wrote outside the selected workspace`);
      assert.ok(fs.existsSync(path.join(targetRoot, '.work', 'config.json')));
      assert.ok(fs.existsSync(path.join(targetRoot, '.agents', 'skills', 'work-plan', 'SKILL.md')));
      for (const relativePath of expectedPaths) {
        assert.ok(fs.existsSync(path.join(targetRoot, relativePath)), `${label} missing ${relativePath} in selected workspace`);
      }
    }

    const gitRoot = path.join(tmpDir, 'git-root');
    const nestedCwd = path.join(gitRoot, 'nested', 'deep');
    fs.mkdirSync(nestedCwd, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: gitRoot });
    writeFile(path.join(nestedCwd, 'canary.txt'), 'nested-foreign\n');
    const nestedBefore = snapshotTree(nestedCwd);

    const nested = await runCliAsMain(nestedCwd, ['setup', '--agent', 'codex', '-y']);

    assert.strictEqual(nested.exitCode, 0, nested.output);
    assert.deepStrictEqual(snapshotTree(nestedCwd), nestedBefore, 'nested invocation cwd received setup writes');
    assert.ok(fs.existsSync(path.join(gitRoot, '.work', 'config.json')));
    assert.ok(fs.existsSync(path.join(gitRoot, '.codex', 'agents')));
  });

  test('global detection auto-selects one home and fails closed on zero or many with -y', async () => {
    const oneHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-one-home-'));
    try {
      fs.mkdirSync(path.join(oneHome, '.claude'));
      const one = await withEnv({ GSDD_TEST_HOME: oneHome }, () => runCliAsMain(tmpDir, ['setup', '--global', '-y']));
      assert.strictEqual(one.exitCode, 0, one.output);
      assert.ok(fs.existsSync(path.join(oneHome, '.claude', 'skills')));
    } finally {
      cleanup(oneHome);
    }
    const manyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-setup-many-home-'));
    try {
      fs.mkdirSync(path.join(manyHome, '.claude'));
      fs.mkdirSync(path.join(manyHome, '.codex'));
      const many = await withEnv({ GSDD_TEST_HOME: manyHome }, () => runCliAsMain(tmpDir, ['setup', '--global', '-y']));
      assert.strictEqual(many.exitCode, 1);
      assert.match(many.output, /Multiple agent homes detected/);
    } finally {
      cleanup(manyHome);
    }
  });

  test('offline packed installed entry covers the setup matrix in one install', async () => {
    const packed = installPackedEntry();
    try {
      const repo = path.join(packed.root, 'repo');
      fs.mkdirSync(repo);
      const first = runInstalled(packed.entry, repo, ['setup', '-y']);
      assert.strictEqual(first.status, 0, first.stderr || first.stdout);
      assert.ok(fs.existsSync(path.join(repo, '.agents', 'skills', 'work-quick', 'SKILL.md')));
      assertRootGuidance(repo);
      const repoBeforeRerun = snapshotTree(repo);
      const second = runInstalled(packed.entry, repo, ['setup', '--yes']);
      assert.strictEqual(second.status, 0, second.stderr || second.stdout);
      assert.match(second.stdout, /state already exists/);
      assert.deepStrictEqual(snapshotTree(repo), repoBeforeRerun);

      const projectCodex = path.join(packed.root, 'project-codex');
      fs.mkdirSync(projectCodex);
      const codex = runInstalled(packed.entry, projectCodex, ['setup', '--agent', 'codex', '--yes']);
      assert.strictEqual(codex.status, 0, codex.stderr || codex.stdout);
      assert.ok(fs.existsSync(path.join(projectCodex, '.codex', 'agents')));
      assertRootGuidance(projectCodex);

      const projectExisting = path.join(packed.root, 'project-existing');
      fs.mkdirSync(projectExisting);
      const original = '# Consumer governance\r\n\r\nKeep this exactly.\r\n';
      writeFile(path.join(projectExisting, 'AGENTS.md'), original);
      const existing = runInstalled(packed.entry, projectExisting, ['setup', '--yes']);
      assert.strictEqual(existing.status, 0, existing.stderr || existing.stdout);
      assert.ok(assertRootGuidance(projectExisting).startsWith(original));

      for (const [index, [label, content]] of MALFORMED_ROOT_BLOCKS.entries()) {
        const malformedRoot = path.join(packed.root, `malformed-${index}`);
        writeFile(path.join(malformedRoot, 'AGENTS.md'), `# Owner rules\r\n${content}Keep this.\r\n`);
        const before = snapshotTree(malformedRoot);
        const refused = runInstalled(packed.entry, malformedRoot, ['setup', '--yes']);
        assert.notStrictEqual(refused.status, 0, label);
        assert.match(refused.stdout + refused.stderr, /Refusing adapter update/);
        assert.deepStrictEqual(snapshotTree(malformedRoot), before, `installed ${label} changed consumer bytes`);
      }

      const ownedLegacy = path.join(packed.root, 'owned-legacy');
      fs.mkdirSync(ownedLegacy);
      const runLegacy = (args) => runInstalled(packed.entry, ownedLegacy, args);
      await createLegacyPortableFixture(ownedLegacy, runLegacy);
      const ownedLegacyBefore = snapshotTree(ownedLegacy);
      const refusedLegacy = runLegacy(['setup', '--migrate', '-y']);
      assert.notStrictEqual(refusedLegacy.status, 0);
      assert.match(refusedLegacy.stdout + refusedLegacy.stderr, /AGENTS\.md is not generation-manifest-owned/);
      assert.deepStrictEqual(snapshotTree(ownedLegacy), ownedLegacyBefore);
      assert.ok(!fs.existsSync(path.join(ownedLegacy, '.work')));

      const projectOptOut = path.join(packed.root, 'project-opt-out');
      fs.mkdirSync(projectOptOut);
      writeFile(path.join(projectOptOut, 'AGENTS.md'), original);
      const optOut = runInstalled(packed.entry, projectOptOut, ['setup', '--no-agents', '--yes']);
      assert.strictEqual(optOut.status, 0, optOut.stderr || optOut.stdout);
      assert.strictEqual(fs.readFileSync(path.join(projectOptOut, 'AGENTS.md'), 'utf8'), original);
      assert.ok(fs.existsSync(path.join(projectOptOut, '.agents/skills/work-plan/SKILL.md')));

      const projectAll = path.join(packed.root, 'project-all');
      fs.mkdirSync(projectAll);
      const all = runInstalled(packed.entry, projectAll, ['setup', '--all', '-y']);
      assert.strictEqual(all.status, 0, all.stderr || all.stdout);
      assert.ok(fs.existsSync(path.join(projectAll, 'AGENTS.md')));
      assert.ok(fs.existsSync(path.join(projectAll, '.claude')));
      assert.ok(fs.existsSync(path.join(projectAll, '.opencode')));
      assert.ok(fs.existsSync(path.join(projectAll, '.codex')));

      for (const [index, args] of [
        ['--auto'],
        ['-y', '-y'],
        ['--agent'],
        ['unexpected'],
      ].entries()) {
        const grammarRoot = path.join(packed.root, `grammar-${index}`);
        fs.mkdirSync(grammarRoot);
        const before = snapshotTree(grammarRoot);
        const invalid = runInstalled(packed.entry, grammarRoot, ['setup', ...args]);
        assert.notStrictEqual(invalid.status, 0, args.join(' '));
        assert.deepStrictEqual(snapshotTree(grammarRoot), before, `${args.join(' ')} wrote bytes`);
      }

      const dryRunRoot = path.join(packed.root, 'dry-run');
      fs.mkdirSync(dryRunRoot);
      const dryBefore = snapshotTree(dryRunRoot);
      for (const flag of ['--dry-run', '--dry']) {
        const dry = runInstalled(packed.entry, dryRunRoot, ['setup', flag]);
        assert.strictEqual(dry.status, 0, dry.stderr || dry.stdout);
        assert.deepStrictEqual(snapshotTree(dryRunRoot), dryBefore, `${flag} wrote bytes`);
      }

      const consentRoot = path.join(packed.root, 'consent');
      fs.mkdirSync(consentRoot);
      const consentBefore = snapshotTree(consentRoot);
      const noConsent = runInstalled(packed.entry, consentRoot, ['setup']);
      assert.notStrictEqual(noConsent.status, 0);
      assert.match(noConsent.stdout + noConsent.stderr, /requires -y/);
      assert.deepStrictEqual(snapshotTree(consentRoot), consentBefore);

      const legacyRoot = path.join(packed.root, 'legacy');
      writeFile(path.join(legacyRoot, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      const legacyBefore = snapshotTree(legacyRoot);
      const legacyRefused = runInstalled(packed.entry, legacyRoot, ['setup', '-y']);
      assert.notStrictEqual(legacyRefused.status, 0);
      assert.match(legacyRefused.stdout + legacyRefused.stderr, /setup --migrate/);
      assert.deepStrictEqual(snapshotTree(legacyRoot), legacyBefore);
      const migrateWithoutConsent = runInstalled(packed.entry, legacyRoot, ['setup', '--migrate']);
      assert.notStrictEqual(migrateWithoutConsent.status, 0);
      assert.deepStrictEqual(snapshotTree(legacyRoot), legacyBefore);
      const migrated = runInstalled(packed.entry, legacyRoot, ['setup', '--migrate', '-y']);
      assert.strictEqual(migrated.status, 0, migrated.stderr || migrated.stdout);
      assert.ok(fs.existsSync(path.join(legacyRoot, '.work', 'migration-receipt.json')));
      assert.ok(!fs.existsSync(path.join(legacyRoot, '.planning')));

      const partialRoot = path.join(packed.root, 'partial');
      writeFile(path.join(partialRoot, '.work', 'config.json'), '{"initVersion":"v1.1"}\n');
      const partialBefore = snapshotTree(partialRoot);
      const partial = runInstalled(packed.entry, partialRoot, ['setup', '-y']);
      assert.strictEqual(partial.status, 0, partial.stderr || partial.stdout);
      assert.match(partial.stdout, /update/);
      assert.match(partial.stdout, /health/);
      assert.deepStrictEqual(snapshotTree(partialRoot), partialBefore);

      const ancestor = path.join(packed.root, 'ancestor');
      const exactCwd = path.join(ancestor, 'exact-cwd');
      const explicitRoot = path.join(ancestor, 'explicit-root');
      fs.mkdirSync(exactCwd, { recursive: true });
      writeFile(path.join(ancestor, '.work', 'config.json'), '{"user":"ancestor"}\n');
      const exact = runInstalled(packed.entry, exactCwd, ['setup', '-y']);
      assert.strictEqual(exact.status, 0, exact.stderr || exact.stdout);
      assert.ok(fs.existsSync(path.join(exactCwd, '.work')));
      assert.ok(!fs.existsSync(path.join(exactCwd, '.git')));
      fs.mkdirSync(explicitRoot, { recursive: true });
      const launcherRoot = path.join(packed.root, 'launcher');
      fs.mkdirSync(launcherRoot);
      writeFile(path.join(launcherRoot, 'canary.txt'), 'packed-foreign\n');
      const launcherBefore = snapshotTree(launcherRoot);
      const explicit = runInstalled(packed.entry, launcherRoot, ['setup', '--workspace-root', explicitRoot, '--agent', 'codex', '--yes']);
      assert.strictEqual(explicit.status, 0, explicit.stderr || explicit.stdout);
      assert.ok(fs.existsSync(path.join(explicitRoot, '.work')));
      assert.ok(fs.existsSync(path.join(explicitRoot, '.codex', 'agents')));
      assert.ok(!fs.existsSync(path.join(explicitRoot, '.git')));
      assert.deepStrictEqual(snapshotTree(launcherRoot), launcherBefore, 'packed explicit-root setup wrote native surfaces into the launcher cwd');
      assert.strictEqual(fs.readFileSync(path.join(ancestor, '.work', 'config.json'), 'utf8'), '{"user":"ancestor"}\n');

      const collisionRoot = path.join(packed.root, 'collision');
      writeFile(path.join(collisionRoot, '.agents', 'skills', 'work-quick', 'SKILL.md'), 'user-owned\n');
      const collisionBefore = snapshotTree(collisionRoot);
      const collision = runInstalled(packed.entry, collisionRoot, ['setup', '-y']);
      assert.notStrictEqual(collision.status, 0);
      assert.deepStrictEqual(snapshotTree(collisionRoot), collisionBefore);

      const globalHome = path.join(packed.root, 'global-agent');
      fs.mkdirSync(globalHome);
      const globalBeforeRepo = snapshotTree(repo);
      const globalAgent = runInstalled(packed.entry, repo, ['setup', '-g', '--agent', 'codex', '--yes'], { GSDD_TEST_HOME: globalHome });
      assert.strictEqual(globalAgent.status, 0, globalAgent.stderr || globalAgent.stdout);
      assert.ok(fs.existsSync(path.join(globalHome, '.codex')));
      assert.ok(fs.existsSync(path.join(globalHome, '.agents', 'skills', 'work-plan', 'SKILL.md')));
      assert.deepStrictEqual(snapshotTree(repo), globalBeforeRepo);
      const globalBeforeAll = snapshotTree(globalHome);
      const globalAll = runInstalled(packed.entry, repo, ['setup', '--global', '--all', '-y'], { GSDD_TEST_HOME: path.join(packed.root, 'global-all') });
      assert.strictEqual(globalAll.status, 0, globalAll.stderr || globalAll.stdout);
      assert.ok(fs.existsSync(path.join(packed.root, 'global-all', '.claude')));
      assert.ok(fs.existsSync(path.join(packed.root, 'global-all', '.copilot')));
      assert.deepStrictEqual(snapshotTree(globalHome), globalBeforeAll);
    } finally {
      cleanup(packed.root);
    }
  });
});
