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
    const init = await runCliAsMain(tmp, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(init.exitCode, 0, init.output);
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

    const result = await runCliAsMain(tmp, ['next', '--json']);
    assert.strictEqual(result.exitCode, 0);
    const packet = JSON.parse(result.output);
    assert.ok(packet.blocked_by.includes('canonical_dirty_behind_upstream'),
      `blocked_by must carry the control-map block risk; got ${JSON.stringify(packet.blocked_by)}`);
    assert.ok(packet.repo_warnings.length > 0,
      'repo_warnings must not be empty when the checkout is dirty and behind upstream');
  });

  test('many worktrees and dense discovery preserve checkpoint readback and malformed resume refusal', async () => {
    git(tmp, ['init', '-b', 'main']);
    git(tmp, ['config', 'user.email', 'test@example.com']);
    git(tmp, ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(tmp, 'tracked.txt'), 'initial\n');
    git(tmp, ['add', 'tracked.txt']);
    git(tmp, ['commit', '-m', 'fixture']);
    for (let index = 0; index < 6; index += 1) {
      git(tmp, ['worktree', 'add', '-b', `fixture-${index}`, path.join(tmp, 'worktrees', `fixture-${index}`)]);
    }
    const work = path.join(tmp, '.work');
    const dense = path.join(work, 'phases', '16-continuity', 'arbitrary', 'nested');
    fs.mkdirSync(dense, { recursive: true });
    fs.writeFileSync(path.join(work, 'config.json'), '{}\n');
    fs.writeFileSync(path.join(work, 'ROADMAP.md'), '# Roadmap\n\n- [-] **Phase 16: Continuity**\n');
    fs.writeFileSync(path.join(dense, '16-PLAN.md'), '---\nstatus: pending\n---\n# Plan\n');
    for (let index = 0; index < 256; index += 1) fs.writeFileSync(path.join(dense, `payload-${index}.txt`), 'payload\n');
    const checkpoint = [
      '---', 'workflow: generic', 'phase: null', 'timestamp: 2026-10-03T00:00:00Z', 'runtime: claude-code', '---',
      '<current_state>Paused with multiple worktrees.</current_state>',
      '<completed_work>Preserved current task.</completed_work>',
      '<remaining_work>Resume the bounded task.</remaining_work>',
      '<decisions>Keep the owner approval and exact plan identity.</decisions>',
      '<blockers>Reconcile live Git before edits.</blockers>',
      '<next_action>Run /work-resume before continuing edits.</next_action>',
    ].join('\n');
    const checkpointPath = path.join(work, '.continue-here.md');
    fs.writeFileSync(checkpointPath, checkpoint);
    const before = fs.readFileSync(checkpointPath);
    const { pathToFileURL } = require('node:url');
    const { buildControlMap } = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'control-map.mjs')).href);
    const map = buildControlMap({ workspaceRoot: tmp, planningDir: work });
    assert.strictEqual(map.worktrees.length, 7);
    const result = await runCliAsMain(tmp, ['next', '--json']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const packet = JSON.parse(result.output);
    assert.strictEqual(packet.continuity.checkpoint.status, 'valid');
    assert.strictEqual(packet.continuity.checkpoint.sections.next_action, 'Run /work-resume before continuing edits.');
    assert.deepStrictEqual(fs.readFileSync(checkpointPath), before);

    fs.writeFileSync(checkpointPath, checkpoint.replace('</next_action>', '</decisions>'));
    const malformed = fs.readFileSync(checkpointPath);
    const refused = await runCliAsMain(tmp, ['lifecycle-preflight', 'resume']);
    const refusal = JSON.parse(refused.output);
    assert.strictEqual(refusal.allowed, false);
    assert.ok(refusal.blockers.some((blocker) => blocker.code === 'malformed_checkpoint'));
    assert.deepStrictEqual(fs.readFileSync(checkpointPath), malformed);
  });
});
