#!/usr/bin/env node
'use strict';

// One-shot, current-Node, packed terminal-surface proof for Phase 05-10.
// It is deliberately a Node-core runner: no test framework, registry, or
// authenticated/model-backed session is involved.

const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const PACKAGE_NAME = 'workspine';
const ENTRY = 'bin/gsdd.mjs';
const DEVELOPMENT = '--development';
const CATALOG = '--catalog';
const LOOPBACK_REGISTRY = 'http://127.0.0.1:9/closed';
// Spawn the bundled npm CLI through Node. Spawning `npm.cmd` directly is
// EINVAL on current Node for Windows, and every other Phase 05 runner
// already resolves npm this way.
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const REQUIRED_README = [
  'npx -y workspine init', 'npx -y workspine health', 'npx -y workspine update',
  'npx -y workspine install --global', 'Claude Code', 'OpenCode', 'Codex CLI',
  '.work/bin/gsdd.mjs', 'not a second public package CLI',
  'repair or refresh a global install', 'runtime surfaces',
];

class ProofError extends Error {
  constructor(classification, message, details = null) {
    super(message);
    this.classification = classification;
    this.details = details;
  }
}

const fail = (classification, message, details = null) => {
  throw new ProofError(classification, message, details);
};
const must = (condition, classification, message, details = null) => {
  if (!condition) fail(classification, message, details);
};
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const real = (value) => fs.realpathSync(value);
const inside = (root, candidate) => {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!!rel && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};
const text = (value, limit = 12000) => {
  const s = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  return { bytes: Buffer.byteLength(s), sha256: sha256(Buffer.from(s)), text: s.length <= limit ? s : `${s.slice(0, limit / 2)}\n...[truncated]...\n${s.slice(-limit / 2)}`, truncated: s.length > limit };
};
const quoteCmd = (value) => {
  const s = String(value);
  return /[\s"]/.test(s) ? `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"` : s;
};
const quotePs = (value) => `'${String(value).replace(/'/g, "''")}'`;

function command(file, args, options = {}) {
  const started = Date.now();
  const result = cp.spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: file,
    args,
    cwd: options.cwd || process.cwd(),
    exitCode: result.status === null ? -1 : result.status,
    signal: result.signal || null,
    elapsedMs: Date.now() - started,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdout: text(result.stdout || Buffer.alloc(0)),
    stderr: text(result.stderr || Buffer.alloc(0)),
  };
}

function resolveNpx() {
  const dir = path.dirname(real(process.execPath));
  const candidate = path.join(dir, 'npx.cmd');
  must(fs.existsSync(candidate), 'setup_failed', `colocated npx.cmd missing: ${candidate}`);
  const resolved = real(candidate);
  must(path.basename(resolved).toLowerCase() === 'npx.cmd', 'setup_failed', 'npx.cmd realpath is not npx.cmd', { resolved });
  must(path.dirname(resolved).toLowerCase() === dir.toLowerCase(), 'setup_failed', 'npx.cmd is not colocated with Node', { node: dir, npx: resolved });
  return resolved;
}

function resolveShells() {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const shells = {
    powershell: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    cmd: path.join(systemRoot, 'System32', 'cmd.exe'),
  };
  for (const [name, file] of Object.entries(shells)) must(fs.existsSync(file), 'setup_failed', `${name} missing`, { file });
  for (const name of Object.keys(shells)) shells[name] = real(shells[name]);
  return shells;
}

function isolatedEnv(roots, localPrefix) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^npm_config_/i.test(key)) delete env[key];
  env.HOME = roots.home;
  env.USERPROFILE = roots.home;
  env.XDG_CONFIG_HOME = roots.xdg;
  env.npm_config_cache = path.join(roots.npm, 'cache');
  env.npm_config_prefix = localPrefix;
  env.npm_config_userconfig = path.join(roots.npm, 'user.npmrc');
  env.npm_config_globalconfig = path.join(roots.npm, 'global.npmrc');
  env.npm_config_registry = LOOPBACK_REGISTRY;
  env.npm_config_offline = 'true';
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  env.NO_PROXY = '*';
  env.no_proxy = '*';
  env.PATH = `${path.join(localPrefix, 'node_modules', '.bin')};${path.dirname(process.execPath)};${env.PATH || ''}`;
  env.COREPACK_HOME = path.join(roots.runtime, 'corepack');
  env.GIT_CONFIG_GLOBAL = path.join(roots.runtime, 'gitconfig');
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

function snapshot(root) {
  const files = [];
  const visit = (dir, rel = '') => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const next = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) files.push({ path: next, type: 'link', target: fs.readlinkSync(full) });
      else if (st.isDirectory()) { files.push({ path: `${next}/`, type: 'directory' }); visit(full, next); }
      else if (st.isFile()) files.push({ path: next, type: 'file', bytes: st.size, sha256: sha256(fs.readFileSync(full)) });
    }
  };
  visit(root);
  return files;
}

function runNpx(shellName, shellPath, npx, args, cwd, env, provenance) {
  const logical = ['-y', PACKAGE_NAME, ...args];
  let shellArgs;
  let commandLine;
  if (shellName === 'cmd') {
    commandLine = `"${npx}" ${logical.map(quoteCmd).join(' ')}`;
    shellArgs = ['/d', '/s', '/c', commandLine];
  } else {
    commandLine = `& ${quotePs(npx)} ${logical.map(quotePs).join(' ')}`;
    shellArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', commandLine];
  }
  const receipt = command(shellPath, shellArgs, { cwd, env });
  const child = {
    shell: shellName,
    shellExecutable: shellPath,
    shellArgv: shellArgs,
    commandLine,
    logicalArgv: logical,
    cwd,
    provenance,
    networkGuard: {
      registry: LOOPBACK_REGISTRY,
      offline: true,
      audit: false,
      fund: false,
      updateNotifier: false,
      noProxy: '*',
    },
    result: receipt,
  };
  if (receipt.exitCode !== 0 || receipt.error) fail('product_mismatch', `${shellName} ${args.join(' ')} failed`, child);
  return child;
}

function requireFiles(root, relativePaths, label) {
  for (const rel of relativePaths) {
    const full = path.join(root, rel);
    must(inside(root, full), 'containment_failure', `${label} path escaped root`, { rel });
    must(fs.existsSync(full), 'product_mismatch', `${label} missing ${rel}`);
  }
}

function requireManifest(root, rel, label) {
  const full = path.join(root, rel);
  must(fs.existsSync(full), 'product_mismatch', `${label} root manifest missing`, { path: rel });
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  must(parsed && typeof parsed === 'object', 'product_mismatch', `${label} manifest is not an object`);
  return { path: rel, sha256: sha256(fs.readFileSync(full)), keys: Object.keys(parsed).sort() };
}

function catalog() {
  return {
    runner: 'tests/proof/phase05-runtime-windows.cjs',
    modes: ['--catalog', '--development'],
    node: 'current process Node only; no Node-20 acquisition',
    shellOrder: [
      'init --auto --tools claude,opencode,codex', 'health', 'update',
      'install --global --tools claude', 'install --global --tools opencode', 'install --global --tools codex',
      'repeat install --global --tools claude', 'repeat install --global --tools opencode', 'repeat install --global --tools codex',
      'help', 'install --global --help', 'health --help', 'update --help',
    ],
    targets: ['claude', 'opencode', 'codex'],
    exclusions: ['auth/model/billable sessions', 'update-awareness', 'browser', 'P05-07', 'release/public registry', 'Node-20 acquisition'],
    outputRoots: {
      repo: ['.agents/skills/work-*', '.work/bin/gsdd.mjs', '.claude/{skills,commands,agents}', '.opencode/{commands,agents}', '.codex/agents'],
      globalManifests: [
        'HOME/.claude/workspine-file-manifest.json', 'HOME/.agents/workspine-file-manifest.json',
        'XDG_CONFIG_HOME/opencode/workspine-file-manifest.json', 'HOME/.codex/workspine-file-manifest.json',
      ],
    },
  };
}

function development() {
  const major = Number(process.versions.node.split('.')[0]);
  must(Number.isInteger(major) && major >= 20, 'setup_failed', 'current Node is below supported floor', { node: process.version });
  const npx = resolveNpx();
  const shells = resolveShells();
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-05-10-')));
  const disposable = path.join(parent, 'Phase 05-10 disposable root with spaces');
  fs.mkdirSync(disposable);
  const roots = {
    home: path.join(disposable, 'HOME with spaces'),
    xdg: path.join(disposable, 'XDG config with spaces'),
    npm: path.join(disposable, 'npm roots with spaces'),
    runtime: path.join(disposable, 'runtime roots with spaces'),
  };
  Object.values(roots).forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const localPrefix = path.join(disposable, 'isolated local package with spaces');
  fs.mkdirSync(localPrefix, { recursive: true });
  const env = isolatedEnv(roots, localPrefix);
  const result = {
    status: 'running', classification: null, currentNode: process.version,
    npx, shells, roots, localPrefix, packed: null, provenance: [], cases: [],
    cleanup: null, claims: { updateAwareness: 'excluded', authModelSessions: 'excluded', runtimeParity: 'not claimed' },
  };
  try {
    must(fs.existsSync(NPM_CLI), 'setup_failed', 'bundled npm CLI is unavailable', { npmCli: NPM_CLI });
    const pack = command(process.execPath, [NPM_CLI, 'pack', '--ignore-scripts', '--offline', '--pack-destination', disposable], { cwd: REPO, env });
    must(pack.exitCode === 0, 'setup_failed', 'npm pack failed', pack);
    const tgzs = fs.readdirSync(disposable).filter((n) => n.endsWith('.tgz'));
    must(tgzs.length === 1, 'setup_failed', 'packed candidate tarball count is not exactly one', { tgzs });
    const tarball = path.join(disposable, tgzs[0]);
    const tarBytes = fs.readFileSync(tarball);
    const install = command(process.execPath, [NPM_CLI, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--prefix', localPrefix, tarball], { cwd: REPO, env });
    must(install.exitCode === 0, 'setup_failed', 'local packed candidate install failed', install);
    const pkgRoot = path.join(localPrefix, 'node_modules', PACKAGE_NAME);
    // The package is workspine but its bin entry is `gsdd`, so npm writes gsdd.cmd.
    const shim = path.join(localPrefix, 'node_modules', '.bin', 'gsdd.cmd');
    const installedEntry = path.join(pkgRoot, ENTRY);
    must(fs.existsSync(shim) && fs.existsSync(pkgRoot) && fs.existsSync(installedEntry), 'setup_failed', 'isolated npx shim/package/entry missing', { shim, pkgRoot, installedEntry });
    const provenance = {
      npx: real(npx), localShim: real(shim), localPackage: real(pkgRoot), installedEntry: real(installedEntry),
      installedEntrySha256: sha256(fs.readFileSync(installedEntry)), tarball: path.basename(tarball),
      tarballSha256: sha256(tarBytes), tarballBytes: tarBytes.length,
    };
    result.packed = { pack: pack, install: install, ...provenance };
    const readmePath = path.join(pkgRoot, 'README.md');
    must(fs.existsSync(readmePath), 'setup_failed', 'packed README missing');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const missingReadme = REQUIRED_README.filter((needle) => !readme.includes(needle));
    must(missingReadme.length === 0, 'product_mismatch', 'packed README/help comprehension strings missing', { missing: missingReadme });
    must(readme.includes('.agents/skills/') && readme.includes('.work/bin/gsdd.mjs'), 'product_mismatch', 'README does not distinguish workflow entry from internal helper');
    const helpNeedles = ['hooks', 'context monitoring', 'statusline', 'automatic context transfer', 'universal TUI', 'runtime parity'];
    result.readme = { sha256: sha256(Buffer.from(readme)), required: REQUIRED_README, unsupportedClaimsNotAsserted: helpNeedles };
    for (const [shellName, shellPath] of Object.entries(shells)) {
      const fixture = path.join(disposable, `${shellName} repo fixture with spaces`);
      const globalCwd = path.join(disposable, `${shellName} global cwd with spaces`);
      fs.mkdirSync(fixture); fs.mkdirSync(globalCwd);
      const shellReceipt = { shell: shellName, fixture, globalCwd, cases: [], before: { fixture: snapshot(fixture), home: snapshot(roots.home), xdg: snapshot(roots.xdg) } };
      const invoke = (args, cwd) => {
        const child = runNpx(shellName, shellPath, npx, args, cwd, env, provenance);
        shellReceipt.cases.push(child); result.provenance.push(child.provenance);
        return child;
      };
      invoke(['init', '--auto', '--tools', 'claude,opencode,codex'], fixture);
      requireFiles(fixture, ['.work/bin/gsdd.mjs', '.claude/skills', '.claude/commands', '.claude/agents', '.opencode/commands', '.opencode/agents', '.codex/agents'], 'repo-local');
      must(snapshot(path.join(fixture, '.agents', 'skills')).some((e) => e.path.startsWith('work-')), 'product_mismatch', 'repo workflow skills missing');
      invoke(['health'], fixture);
      invoke(['update'], fixture);
      for (const target of ['claude', 'opencode', 'codex']) invoke(['install', '--global', '--tools', target], globalCwd);
      const globalRoots = {
        claude: path.join(roots.home, '.claude'), agents: path.join(roots.home, '.agents'),
        opencode: path.join(roots.xdg, 'opencode'), codex: path.join(roots.home, '.codex'),
      };
      requireManifest(roots.home, path.join('.claude', 'workspine-file-manifest.json'), 'Claude');
      requireManifest(roots.home, path.join('.agents', 'workspine-file-manifest.json'), 'shared agents');
      requireManifest(roots.xdg, path.join('opencode', 'workspine-file-manifest.json'), 'OpenCode');
      requireManifest(roots.home, path.join('.codex', 'workspine-file-manifest.json'), 'Codex');
      requireFiles(globalRoots.claude, ['skills', 'commands', 'agents'], 'Claude global');
      requireFiles(globalRoots.agents, ['skills'], 'shared global');
      requireFiles(globalRoots.opencode, ['commands', 'agents'], 'OpenCode global');
      requireFiles(globalRoots.codex, ['agents'], 'Codex global');
      for (const target of ['claude', 'opencode', 'codex']) invoke(['install', '--global', '--tools', target], globalCwd);
      for (const args of [['help'], ['install', '--global', '--help'], ['health', '--help'], ['update', '--help']]) invoke(args, fixture);
      shellReceipt.after = { fixture: snapshot(fixture), home: snapshot(roots.home), xdg: snapshot(roots.xdg) };
      result.cases.push(shellReceipt);
    }
    result.status = 'passed';
    result.classification = 'development_pass_current_node_model_free';
  } catch (error) {
    result.status = 'stopped';
    result.classification = error.classification || 'harness_failure';
    result.error = { message: error.message, details: error.details || null };
  } finally {
    const cleanup = { root: disposable, validated: inside(parent, disposable), removed: false, error: null };
    if (cleanup.validated) {
      try { fs.rmSync(disposable, { recursive: true, force: true }); cleanup.removed = !fs.existsSync(disposable); }
      catch (error) { cleanup.error = { code: error.code, message: error.message }; }
    } else cleanup.error = { message: 'disposable root validation failed; no cleanup attempted' };
    result.cleanup = cleanup;
  }
  return result;
}

if (process.argv.includes(CATALOG)) {
  console.log(JSON.stringify(catalog(), null, 2));
  process.exit(0);
}
if (!process.argv.includes(DEVELOPMENT)) {
  console.error('Usage: node tests/proof/phase05-runtime-windows.cjs --catalog | --development');
  process.exit(2);
}
const receipt = development();
console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.status === 'passed' ? 0 : 1);
