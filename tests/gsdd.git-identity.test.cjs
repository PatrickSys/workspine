const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  cleanup,
  createTempProject,
  runCliAsMain,
} = require('./gsdd.helpers.cjs');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function runPublicCli(cwd, args, env = process.env) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gsdd.mjs'), ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

function snapshotTree(root) {
  const entries = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) entries.push([relativePath, fs.readFileSync(fullPath).toString('base64')]);
    }
  };
  visit(root);
  return entries.sort((left, right) => left[0].localeCompare(right[0]));
}

function initializeRepository(tmpDir, { name = 'Reliable User', email = 'reliable@company.test' } = {}) {
  git(tmpDir, ['init']);
  git(tmpDir, ['config', 'user.name', name]);
  git(tmpDir, ['config', 'user.email', email]);
}

test('git-identity check inspects a valid exact worktree through the public CLI', async (t) => {
  const tmpDir = createTempProject();
  t.after(() => cleanup(tmpDir));
  initializeRepository(tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'nested'));

  const result = await runCliAsMain(path.join(tmpDir, 'nested'), ['git-identity', 'check']);

  assert.strictEqual(result.exitCode, 0, result.output);
  const report = JSON.parse(result.output);
  assert.strictEqual(report.status, 'ok');
  assert.strictEqual(report.repository.worktree, path.resolve(tmpDir).replace(/\\/g, '/'));
  assert.strictEqual(report.identity.classification, 'valid');
  assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
});

test('git-identity refuses missing, placeholder, mismatched, drifted, and malformed identity checks without writes', async (t) => {
  const tmpDir = createTempProject();
  t.after(() => cleanup(tmpDir));
  git(tmpDir, ['init']);
  const emptyGlobal = path.join(tmpDir, 'empty.gitconfig');
  fs.writeFileSync(emptyGlobal, '');
  const isolatedGit = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobal };

  for (const [configure, cleanupIdentity] of [
    [() => {}, false],
    [() => { git(tmpDir, ['config', 'user.name', 'Test User']); git(tmpDir, ['config', 'user.email', 'test@example.com']); }, true],
  ]) {
    configure();
    const before = snapshotTree(tmpDir);
    const result = runPublicCli(tmpDir, ['git-identity', 'check'], isolatedGit);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(snapshotTree(tmpDir), before, 'identity refusal must not change the repository');
    if (cleanupIdentity) {
      git(tmpDir, ['config', '--unset-all', 'user.name']);
      git(tmpDir, ['config', '--unset-all', 'user.email']);
    }
  }

  initializeRepository(tmpDir);
  const accepted = runPublicCli(tmpDir, ['git-identity', 'check']);
  assert.strictEqual(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  const fingerprint = JSON.parse(accepted.stdout).fingerprint;

  const mismatchBefore = snapshotTree(tmpDir);
  const mismatch = runPublicCli(tmpDir, ['git-identity', 'check'], {
    ...process.env,
    GIT_AUTHOR_NAME: 'Another User',
    GIT_AUTHOR_EMAIL: 'another@company.test',
  });
  assert.notStrictEqual(mismatch.status, 0, `${mismatch.stdout}\n${mismatch.stderr}`);
  assert.match(mismatch.stdout, /"classification": "mismatch"/);
  assert.deepStrictEqual(snapshotTree(tmpDir), mismatchBefore, 'mismatch refusal must not change the repository');

  git(tmpDir, ['config', 'user.email', 'changed@company.test']);
  const driftBefore = snapshotTree(tmpDir);
  const drift = runPublicCli(tmpDir, ['git-identity', 'check', '--expect', fingerprint]);
  assert.notStrictEqual(drift.status, 0, `${drift.stdout}\n${drift.stderr}`);
  assert.match(drift.stdout, /"classification": "drifted"/);
  assert.deepStrictEqual(snapshotTree(tmpDir), driftBefore, 'drift refusal must not change the repository');

  const malformedBefore = snapshotTree(tmpDir);
  for (const { args, expected } of [
    { args: ['git-identity'], expected: /Usage: git-identity check/ },
    { args: ['git-identity', 'check', '--expect'], expected: /Usage: git-identity check/ },
    { args: ['git-identity', 'check', '--confirm', 'one', '--confirm', 'two'], expected: /Usage: git-identity check/ },
    { args: ['git-identity', 'check', '--confirm', 'not-the-current-fingerprint'], expected: /"classification": "confirmation_mismatch"/ },
    { args: ['git-identity', 'check', '--unknown', 'value'], expected: /Usage: git-identity check/ },
  ]) {
    const result = runPublicCli(tmpDir, args);
    assert.notStrictEqual(result.status, 0, `${args.join(' ')} unexpectedly passed`);
    assert.match(`${result.stdout}${result.stderr}`, expected);
    assert.deepStrictEqual(snapshotTree(tmpDir), malformedBefore, 'malformed flags must not change the repository');
  }
});

test('git-identity accepts global identity, requires fingerprint-bound bot confirmation, and resolves linked worktrees', async (t) => {
  const tmpDir = createTempProject();
  const linkedDir = createTempProject();
  t.after(() => cleanup(tmpDir));
  t.after(() => cleanup(linkedDir));
  const globalConfig = path.join(tmpDir, 'global.gitconfig');
  fs.writeFileSync(globalConfig, '[user]\n\tname = Global User\n\temail = global@company.test\n');
  git(tmpDir, ['init']);
  const globalResult = runPublicCli(tmpDir, ['git-identity', 'check'], {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
  });
  assert.strictEqual(globalResult.status, 0, `${globalResult.stdout}\n${globalResult.stderr}`);
  const globalReport = JSON.parse(globalResult.stdout);
  assert.strictEqual(globalReport.config.name.scope, 'global');
  assert.match(globalReport.config.name.origin, /global\.gitconfig/);

  initializeRepository(tmpDir, { name: 'release-bot', email: 'release-bot@company.test' });
  fs.writeFileSync(path.join(tmpDir, 'tracked.txt'), 'fixture\n');
  git(tmpDir, ['add', 'tracked.txt']);
  git(tmpDir, ['commit', '-m', 'fixture']);
  fs.rmSync(linkedDir, { recursive: true, force: true });
  git(tmpDir, ['worktree', 'add', linkedDir, '-b', 'identity-linked']);
  const before = snapshotTree(tmpDir);
  const unconfirmed = runPublicCli(linkedDir, ['git-identity', 'check']);
  assert.notStrictEqual(unconfirmed.status, 0, `${unconfirmed.stdout}\n${unconfirmed.stderr}`);
  const unconfirmedReport = JSON.parse(unconfirmed.stdout);
  assert.strictEqual(unconfirmedReport.identity.classification, 'confirmation_required');
  assert.strictEqual(unconfirmedReport.repository.worktree, path.resolve(linkedDir).replace(/\\/g, '/'));
  assert.deepStrictEqual(snapshotTree(tmpDir), before, 'linked worktree inspection must not change the primary repository');

  const confirmed = runPublicCli(linkedDir, ['git-identity', 'check', '--confirm', unconfirmedReport.fingerprint]);
  assert.strictEqual(confirmed.status, 0, `${confirmed.stdout}\n${confirmed.stderr}`);
});
