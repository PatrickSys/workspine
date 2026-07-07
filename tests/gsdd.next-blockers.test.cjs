/**
 * gsdd next must surface control-map blockers (dirty + behind upstream)
 * instead of reporting blocked_by: [] while preflight blocks. (SPEC 14.3)
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTempProject, cleanup, runCliAsMain } = require('./gsdd.helpers.cjs');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

describe('next --json consumes control-map blockers', () => {
  let tmp; let remote; let clone;
  beforeEach(() => { tmp = createTempProject(); remote = null; clone = null; });
  afterEach(() => {
    cleanup(tmp);
    if (remote) fs.rmSync(remote, { recursive: true, force: true });
    if (clone) fs.rmSync(clone, { recursive: true, force: true });
  });

  test('dirty tracked file while behind upstream -> blocked_by names the risk', async () => {
    git(tmp, ['init', '-b', 'main']);
    git(tmp, ['config', 'user.email', 'test@example.com']);
    git(tmp, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(tmp, 'tracked.txt'), 'v1\n');
    git(tmp, ['add', 'tracked.txt']);
    git(tmp, ['commit', '-m', 'initial']);
    remote = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-next-remote-'));
    git(remote, ['init', '--bare', '-b', 'main', '.']);
    git(tmp, ['remote', 'add', 'origin', remote]);
    git(tmp, ['push', '-u', 'origin', 'main']);
    clone = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-next-clone-'));
    git(clone, ['clone', remote, '.']);
    git(clone, ['config', 'user.email', 'test@example.com']);
    git(clone, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(clone, 'tracked.txt'), 'v2\n');
    git(clone, ['add', 'tracked.txt']);
    git(clone, ['commit', '-m', 'remote change']);
    git(clone, ['push']);
    git(tmp, ['fetch', 'origin']);
    fs.writeFileSync(path.join(tmp, 'tracked.txt'), 'local dirty\n');

    const init = await runCliAsMain(tmp, ['next', '--init', '--json']);
    assert.strictEqual(init.exitCode, 0);
    const result = await runCliAsMain(tmp, ['next', '--json']);
    assert.strictEqual(result.exitCode, 0);
    const packet = JSON.parse(result.output);
    assert.ok(packet.blocked_by.includes('canonical_dirty_behind_upstream'),
      `blocked_by must carry the control-map block risk; got ${JSON.stringify(packet.blocked_by)}`);
    assert.ok(packet.repo_warnings.length > 0,
      'repo_warnings must not be empty when the checkout is dirty and behind upstream');
  });
});
