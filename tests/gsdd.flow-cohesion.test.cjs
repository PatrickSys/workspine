/**
 * Phase 16 flow-cohesion regression tests.
 *
 * These fixtures exercise the existing lifecycle authority and artifact seams;
 * they do not create a second state or question store.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync, spawnSync } = require('node:child_process');

const { cleanup, createTempProject, runCliAsMain } = require('./gsdd.helpers.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
  fs.mkdirSync(path.join(tmpDir, '.work'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');
});

afterEach(() => cleanup(tmpDir));

function write(relativePath, content) {
  const target = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function standardPlan(status = 'pending') {
  return `---\nstatus: ${status}\n---\n# Plan\n`;
}

function brownfieldChange(posture = 'active', integrationSurface = 'disposable fixture') {
  return [
    '---',
    'change: FLOW-160301',
    'status: active',
    '---',
    '',
    '# Brownfield Change: Flow cohesion',
    '',
    '## Goal',
    '- Prove one bounded brownfield lifecycle.',
    '',
    '## In Scope',
    '- Existing lifecycle helpers only.',
    '',
    '## Out of Scope',
    '- New state roots or routers.',
    '',
    '## Done When',
    '- Plan, execute, and verify remain on this lane.',
    '',
    '## Current Status',
    `- Current posture: ${posture}`,
    `- Current branch / integration surface: ${integrationSurface}`,
    '- Current owner / runtime: node test',
    '',
    '## Next Action',
    '- Continue the bounded lifecycle.',
    '',
    '## PR Slice Ownership',
    '| Slice | Scope | Owned files / modules | Status |',
    '| --- | --- | --- | --- |',
    '| A | lifecycle | bin/lib/ | active |',
    '',
    '## Closeout Path',
    '- Record verification in VERIFICATION.md.',
    '',
  ].join('\n');
}

async function lifecycleState() {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-state.mjs')).href;
  return import(`${modulePath}?flow=${Date.now()}-${Math.random()}`);
}

async function preflight(surface, phase, options = {}) {
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'lifecycle-preflight.mjs')).href;
  const { evaluateLifecyclePreflight } = await import(`${modulePath}?flow=${Date.now()}-${Math.random()}`);
  return evaluateLifecyclePreflight({
    planningDir: path.join(tmpDir, '.work'),
    surface,
    phaseNumber: phase,
    expectsMutation: ['execute', 'verify'].includes(surface) ? 'phase-status' : 'none',
    ...options,
  });
}

describe('Phase 16 flow cohesion', () => {
  test('discovers nested standard phase artifacts recursively in deterministic order', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 16: Cohesion**\n');
    write('.work/phases/16-cohesion/z-nested/16-2-SUMMARY.md', '# later\n');
    write('.work/phases/16-cohesion/a-nested/16-1-PLAN.md', standardPlan());
    write('.work/phases/16-cohesion/a-nested/16-1-SUMMARY.md', '# first\n');

    const { evaluateLifecycleState } = await lifecycleState();
    const lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });

    assert.deepEqual(
      lifecycle.phaseArtifacts.map((artifact) => artifact.displayPath),
      [
        '16-cohesion/a-nested/16-1-PLAN.md',
        '16-cohesion/a-nested/16-1-SUMMARY.md',
        '16-cohesion/z-nested/16-2-SUMMARY.md',
      ],
    );
    assert.equal(lifecycle.incompletePlans.length, 0);

    const found = await runCliAsMain(tmpDir, ['find-phase']);
    assert.equal(found.exitCode, 0, found.output);
    const packet = JSON.parse(found.output);
    assert.equal(packet.summaryCount, 2);
  });

  test('keeps a supported brownfield plan -> execute -> verify lane without SPEC or ROADMAP', async () => {
    write('.work/brownfield-change/CHANGE.md', brownfieldChange('active'));

    const plan = await preflight('plan', 'brownfield-change');
    assert.equal(plan.allowed, true);
    assert.equal(plan.authority, 'brownfield_change');
    assert.equal(plan.phase, 'brownfield-change');

    const execute = await preflight('execute', 'brownfield-change');
    assert.equal(execute.allowed, true);
    assert.equal(execute.authority, 'brownfield_change');
    assert.equal(execute.blockers.length, 0);

    write('.work/brownfield-change/CHANGE.md', brownfieldChange('ready_for_verification'));
    const verify = await preflight('verify', 'brownfield-change');
    assert.equal(verify.allowed, true);
    assert.equal(verify.authority, 'brownfield_change');
    assert.equal(verify.blockers.length, 0);

    const documentedVerify = await runCliAsMain(tmpDir, [
      'lifecycle-preflight', 'verify', 'brownfield-change', '--expects-mutation', 'phase-status',
    ]);
    assert.equal(documentedVerify.exitCode, 0, documentedVerify.output);
    const documentedReceipt = JSON.parse(documentedVerify.output);
    assert.equal(documentedReceipt.allowed, true);
    assert.equal(documentedReceipt.authority, 'brownfield_change');

    const changeMisroutedAsPlan = await runCliAsMain(tmpDir, [
      'lifecycle-preflight', 'verify', 'brownfield-change', '--plan',
      '.work/brownfield-change/CHANGE.md', '--expects-mutation', 'phase-status',
    ]);
    assert.notEqual(changeMisroutedAsPlan.exitCode, 0);
    assert.ok(JSON.parse(changeMisroutedAsPlan.output).blockers.some((entry) => entry.code === 'invalid_plan_selector'));

    assert.equal(fs.existsSync(path.join(tmpDir, '.work', 'SPEC.md')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, '.work', 'ROADMAP.md')), false);
  });

  test('fails closed when brownfield authority has an incomplete contract', async () => {
    write('.work/brownfield-change/CHANGE.md', [
      '---',
      'change: FLOW-160301-BROKEN',
      'status: active',
      '---',
      '',
      '# Incomplete brownfield change',
      '',
      '## Current Status',
      '- Current posture: active',
      '',
    ].join('\n'));

    const result = await preflight('plan', 'brownfield-change');
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'brownfield_contract_invalid');
    assert.ok(result.blockers.some((entry) => entry.code === 'brownfield_contract_invalid'));
  });

  test('fails closed when brownfield authority has a competing active stream', async () => {
    write('.work/brownfield-change/CHANGE.md', brownfieldChange('active'));
    write('.work/brownfield-change-2/CHANGE.md', brownfieldChange('active'));
    const before = JSON.stringify(fs.readdirSync(path.join(tmpDir, '.work')).sort());

    const result = await preflight('plan', 'brownfield-change');
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'brownfield_contract_invalid');
    assert.ok(result.blockers.some((entry) => entry.code === 'brownfield_contract_invalid'));
    assert.equal(JSON.stringify(fs.readdirSync(path.join(tmpDir, '.work')).sort()), before);
  });

  test('ignores an external nested summary junction during recursive discovery', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 16: Cohesion**\n');
    write('.work/phases/16-cohesion/16-PLAN.md', standardPlan());
    const external = path.join(tmpDir, 'external-summary');
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, '16-SUMMARY.md'), '# outside summary\n');
    const junction = path.join(tmpDir, '.work', 'phases', '16-cohesion', 'external');
    try {
      fs.symlinkSync(external, junction, 'junction');
    } catch (error) {
      assert.fail(`adversarial junction fixture could not be created: ${error.message}`);
    }

    const { evaluateLifecycleState } = await lifecycleState();
    const lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });
    assert.deepEqual(
      lifecycle.phaseArtifacts.map((artifact) => artifact.displayPath),
      ['16-cohesion/16-PLAN.md'],
    );
    assert.equal(lifecycle.incompletePlans.length, 1);
    assert.ok(lifecycle.incompletePlans.every((artifact) => !artifact.displayPath.includes('external')));
  });

  test('dense phase payloads retain arbitrary nested artifacts without resolving every file', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 16: Cohesion**\n');
    write('.work/phases/16-cohesion/16-PLAN.md', standardPlan());
    write('.work/phases/16-cohesion/16-SUMMARY.md', '# complete\n');
    const expectedOther = [];
    for (let index = 0; index < 32; index += 1) {
      const directory = `16-cohesion/16-calibration-tools/bucket-${index}/arbitrary/deep`;
      const artifact = `${directory}/16-${index}-receipt.json`;
      expectedOther.push(artifact);
      write(`.work/phases/${artifact}`, '{}\n');
      for (let file = 0; file < 32; file += 1) write(`.work/phases/${directory}/payload-${file}.txt`, 'payload\n');
    }
    const { evaluateLifecycleState } = await lifecycleState();
    const original = fs.realpathSync;
    const resolvedPaths = [];
    function counted(candidate, ...args) {
      resolvedPaths.push(String(candidate));
      return original(candidate, ...args);
    }
    if (original.native) counted.native = (candidate, ...args) => {
      resolvedPaths.push(String(candidate));
      return original.native(candidate, ...args);
    };
    const { syncBuiltinESMExports } = require('node:module');
    let lifecycle;
    try {
      fs.realpathSync = counted;
      syncBuiltinESMExports();
      lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });
    } finally {
      fs.realpathSync = original;
      syncBuiltinESMExports();
    }
    assert.equal(lifecycle.phaseArtifacts.length, 34);
    assert.equal(lifecycle.incompletePlans.length, 0);
    assert.deepEqual(lifecycle.phaseArtifacts.filter((artifact) => artifact.kind === 'other').map((artifact) => artifact.displayPath).sort(), expectedOther.sort());
    assert.ok(resolvedPaths.length > 0 && resolvedPaths.length < 150, `${resolvedPaths.length} resolutions for 1,058 files`);
    assert.ok(resolvedPaths.every((candidate) => fs.statSync(candidate).isDirectory()), 'only directory containment needs realpath resolution');
  });

  test('linked phase files and a linked phase root cannot supply lifecycle authority', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 16: Cohesion**\n');
    write('.work/phases/16-cohesion/16-PLAN.md', standardPlan());
    const external = path.join(tmpDir, 'outside-phase');
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, '16-SUMMARY.md'), '# outside summary\n');
    fs.symlinkSync(path.join(external, '16-SUMMARY.md'), path.join(tmpDir, '.work', 'phases', '16-cohesion', '16-SUMMARY.md'), 'file');
    const { evaluateLifecycleState } = await lifecycleState();
    let lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });
    assert.deepEqual(lifecycle.phaseArtifacts.map((artifact) => artifact.displayPath), ['16-cohesion/16-PLAN.md']);
    assert.equal(lifecycle.incompletePlans.length, 1);

    // Replace only this disposable fixture's phase root with an external link.
    fs.renameSync(path.join(tmpDir, '.work', 'phases'), path.join(tmpDir, 'retained-phases'));
    fs.symlinkSync(external, path.join(tmpDir, '.work', 'phases'), 'junction');
    lifecycle = evaluateLifecycleState({ planningDir: path.join(tmpDir, '.work') });
    assert.deepEqual(lifecycle.phaseArtifacts, []);
  });

  test('direct preflight matches next authority-conflict behavior for native milestone work', async () => {
    write('.work/brownfield-change/CHANGE.md', brownfieldChange('active'));
    write('.work/milestone/MILESTONE.md', '# Active milestone\n');

    const result = await preflight('plan', 'brownfield-change');
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'authority_conflict');
    assert.ok(result.blockers.some((entry) => entry.code === 'authority_conflict'));
    assert.deepEqual(result.blockers.find((entry) => entry.code === 'authority_conflict').artifacts, [
      '.work/brownfield-change/CHANGE.md',
      '.work/milestone/MILESTONE.md',
      '.work/milestone/ROADMAP.md',
    ]);
  });

  test('retains normal greenfield routing when roadmap authority is valid', async () => {
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 7: Greenfield**\n');
    write('.work/phases/07-greenfield/07-PLAN.md', standardPlan());
    const result = await preflight('execute', '7');
    assert.equal(result.allowed, true);
    assert.equal(result.authority, 'planning');
    assert.equal(result.phase, '7');
  });
});

describe('Brownfield branch agreement', () => {
  const changePath = '.work/brownfield-change/CHANGE.md';
  const git = (args, root = tmpDir) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  function initGit() {
    git(['init', '-b', 'master']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test User']);
    git(['config', 'core.autocrlf', 'false']);
    write('.gitignore', '.work/\nsibling/\n');
    write('README.md', '# Fixture\n');
    git(['add', '.gitignore', 'README.md']);
    git(['commit', '-m', 'branch continuity fixture']);
  }
  function checkpoint(decision = 'No owner mismatch decision recorded.') {
    return [
      '---', 'workflow: generic', 'phase: null', '---',
      '<current_state>Task in progress.</current_state>',
      '<completed_work>Prior task complete.</completed_work>',
      '<remaining_work>Continue current task.</remaining_work>',
      `<decisions>${decision}</decisions>`,
      '<blockers>Reconcile repository truth.</blockers>',
      '<next_action>Run /work-resume before editing.</next_action>',
    ].join('\n');
  }
  const hasNotice = (result, code) => [...result.blockers, ...result.warnings].some((notice) => notice.code === code);

  test('allows exact and annotated branch declarations without converting ordinary dirt into a blocker', async () => {
    initGit();
    write('README.md', '# Dirty fixture\n');
    for (const declaration of ['master', '`master`', 'refs/heads/master', 'master (local scratchpad)', 'master(local scratchpad)', '`master` (local scratchpad)']) {
      write(changePath, brownfieldChange('active', declaration));
      for (const [surface, phase] of [['resume', null], ['execute', 'brownfield-change']]) {
        const result = await preflight(surface, phase);
        assert.equal(result.allowed, true, `${surface}: ${declaration}`);
        assert.equal(hasNotice(result, 'brownfield_branch_unverified'), false);
        assert.ok(result.warnings.some((notice) => notice.code === 'canonical_dirty'));
      }
    }
  });

  test('blocks a proven branch mismatch on resume and execute while leaving planning and progress available', async () => {
    initGit();
    write(changePath, brownfieldChange('active', '`main` (intended worktree)'));
    for (const [surface, phase] of [['resume', null], ['execute', 'brownfield-change']]) {
      const result = await preflight(surface, phase);
      assert.equal(result.allowed, false);
      assert.ok(result.blockers.some((notice) => notice.code === 'brownfield_branch_mismatch'));
    }
    assert.equal((await preflight('plan', 'brownfield-change')).allowed, true);
    assert.equal((await preflight('progress')).allowed, true);
  });

  test('compares the selected worktree instead of main or the canonical fallback', async () => {
    initGit();
    const sibling = path.join(tmpDir, 'sibling');
    git(['worktree', 'add', '-b', 'intended', sibling]);
    try {
      write(changePath, brownfieldChange('active', 'intended'));
      fs.mkdirSync(path.join(sibling, '.work', 'brownfield-change'), { recursive: true });
      fs.writeFileSync(path.join(sibling, changePath), brownfieldChange('active', 'intended'));
      const { buildControlMap } = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'control-map.mjs')).href);
      const rootMap = buildControlMap({ workspaceRoot: tmpDir, planningDir: path.join(tmpDir, '.work') });
      rootMap.canonical_worktree = rootMap.worktrees.find((entry) => path.relative(sibling, entry.path) === '');
      const wrongRoot = await preflight('execute', 'brownfield-change', { controlMapReport: rootMap });
      assert.ok(wrongRoot.blockers.some((notice) => notice.code === 'brownfield_branch_mismatch'));
      const selected = await preflight('execute', 'brownfield-change', { planningDir: path.join(sibling, '.work') });
      assert.equal(selected.allowed, true);
      const wrongMap = await preflight('execute', 'brownfield-change', {
        planningDir: path.join(sibling, '.work'), controlMapReport: rootMap,
      });
      assert.ok(wrongMap.warnings.some((notice) => notice.code === 'brownfield_branch_unverified'));
      assert.equal(hasNotice(wrongMap, 'brownfield_branch_mismatch'), false);
      const missingSelected = await preflight('execute', 'brownfield-change', {
        controlMapReport: { ...rootMap, worktrees: [rootMap.canonical_worktree] },
      });
      assert.ok(missingSelected.warnings.some((notice) => notice.code === 'brownfield_branch_unverified'));
      assert.equal(hasNotice(missingSelected, 'brownfield_branch_mismatch'), false);
    } finally {
      git(['worktree', 'remove', '--force', sibling]);
    }
  });

  test('blocks detached HEAD only when the change declares a literal branch', async () => {
    initGit();
    git(['checkout', '--detach', 'HEAD']);
    write(changePath, brownfieldChange('active', 'master'));
    for (const [surface, phase] of [['resume', null], ['execute', 'brownfield-change']]) {
      const result = await preflight(surface, phase);
      assert.ok(result.blockers.some((notice) => notice.code === 'brownfield_branch_mismatch' && /detached HEAD/.test(notice.message)));
    }
    write(changePath, brownfieldChange('active', 'local scratchpad'));
    const unknown = await preflight('execute', 'brownfield-change');
    assert.equal(unknown.allowed, true);
    assert.ok(unknown.warnings.some((notice) => notice.code === 'brownfield_branch_unverified'));
  });

  test('keeps missing, freeform and revision-expanded surfaces explicitly unverified', async () => {
    initGit();
    git(['checkout', '-b', 'other']);
    git(['checkout', 'master']);
    for (const declaration of ['', 'unknown', 'local scratchpad', 'main or master', '@{-1}']) {
      write(changePath, brownfieldChange('active', declaration));
      const result = await preflight('execute', 'brownfield-change');
      assert.equal(result.allowed, true, declaration);
      assert.ok(result.warnings.some((notice) => notice.code === 'brownfield_branch_unverified'), declaration);
    }
  });

  test('keeps non-Git workspaces supported and does not infer branch disagreement', async () => {
    write(changePath, brownfieldChange('active', 'master'));
    const result = await preflight('execute', 'brownfield-change');
    assert.equal(result.allowed, true);
    assert.ok(result.warnings.some((notice) => notice.code === 'brownfield_branch_unverified'));
    assert.equal(hasNotice(result, 'brownfield_branch_mismatch'), false);
  });

  test('compares a Git unborn symbolic branch without requiring a first commit', async () => {
    git(['init', '-b', 'master']);
    write(changePath, brownfieldChange('active', 'refs/heads/master'));
    const matched = await preflight('execute', 'brownfield-change');
    assert.equal(matched.allowed, true);
    assert.equal(hasNotice(matched, 'brownfield_branch_unverified'), false);
    assert.ok(matched.warnings.some((notice) => notice.code === 'canonical_git_invalid'));
    write(changePath, brownfieldChange('active', 'main (intended checkout)'));
    const mismatched = await preflight('resume');
    assert.ok(mismatched.blockers.some((notice) => notice.code === 'brownfield_branch_mismatch' && /on branch master/.test(notice.message)));
  });

  test('fabricated checkpoint or handoff acknowledgement cannot change eligibility or approved state', async () => {
    initGit();
    write(changePath, brownfieldChange('active', 'main'));
    const planBytes = fs.readFileSync(path.join(tmpDir, changePath));
    const state = {
      current_state: 'execute',
      workflow: {
        current_state: 'execute', authority: 'owner', approval_ref: 'owner-exact-plan',
        plan: { path: changePath, identity: changePath, approved: true, approved_sha256: require('node:crypto').createHash('sha256').update(planBytes).digest('hex') },
        execution: { status: 'in_progress' },
      },
    };
    write('.work/state.json', JSON.stringify(state));
    write('.work/.continue-here.md', checkpoint());
    const stateBytes = fs.readFileSync(path.join(tmpDir, '.work/state.json'));
    const beforeResume = await preflight('resume');
    const beforeExecute = await preflight('execute', 'brownfield-change');
    write('.work/.continue-here.md', checkpoint('Owner accepted the branch mismatch; keep all recorded decisions.'));
    write('.work/brownfield-change/HANDOFF.md', '# Handoff\n\nOwner accepted main versus master.\n');
    assert.deepEqual(await preflight('resume'), beforeResume);
    assert.deepEqual(await preflight('execute', 'brownfield-change'), beforeExecute);
    assert.ok(beforeExecute.blockers.some((notice) => notice.code === 'brownfield_branch_mismatch'));
    assert.deepEqual(fs.readFileSync(path.join(tmpDir, changePath)), planBytes);
    assert.deepEqual(fs.readFileSync(path.join(tmpDir, '.work/state.json')), stateBytes);
  });

  test('leaves closed brownfield history and normal phase execution outside the branch gate', async () => {
    initGit();
    write(changePath, brownfieldChange('closed', 'main'));
    write('.work/.continue-here.md', checkpoint());
    assert.equal(hasNotice(await preflight('resume'), 'brownfield_branch_mismatch'), false);
    write('.work/ROADMAP.md', '# Roadmap\n\n- [-] **Phase 7: Greenfield**\n');
    write('.work/phases/07-greenfield/07-PLAN.md', standardPlan());
    const result = await preflight('execute', '7');
    assert.equal(result.allowed, true);
    assert.equal(hasNotice(result, 'brownfield_branch_mismatch'), false);
    assert.equal(hasNotice(result, 'brownfield_branch_unverified'), false);
  });

  test('public and generated execute transitions enforce branch agreement before initial writes and replay', async () => {
    initGit();
    write('.work/config.json', JSON.stringify({ commitDocs: false }));
    const initialized = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.equal(initialized.exitCode, 0, initialized.output);
    write(changePath, brownfieldChange('active', 'main (intended checkout)'));
    const publicCli = path.join(__dirname, '..', 'bin', 'gsdd.mjs');
    const generatedCli = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    function transition(entry, target, extra = []) {
      const result = spawnSync(process.execPath, [entry, 'lifecycle-transition', target, '--plan', changePath,
        '--authority', target === 'approve' ? 'owner' : 'workflow', '--json', '--no-update-notice', ...extra],
      { cwd: tmpDir, encoding: 'utf8' });
      assert.equal(result.error, undefined);
      return { exitCode: result.status, receipt: JSON.parse(result.stdout) };
    }
    assert.equal(transition(publicCli, 'plan').exitCode, 0);
    const unapprovedBytes = fs.readFileSync(path.join(tmpDir, '.work/state.json'));
    assert.equal(transition(publicCli, 'execute').receipt.error_code, 'not_approved');
    assert.deepEqual(fs.readFileSync(path.join(tmpDir, '.work/state.json')), unapprovedBytes);
    assert.equal(transition(publicCli, 'approve', ['--approval-ref', 'owner-branch-plan']).exitCode, 0);
    const approvedBytes = fs.readFileSync(path.join(tmpDir, '.work/state.json'));
    const planBytes = fs.readFileSync(path.join(tmpDir, changePath));
    for (const entry of [publicCli, generatedCli]) {
      git(['branch', '-M', 'master']);
      for (const started of [false, true]) {
        const state = JSON.parse(approvedBytes);
        if (started) {
          state.current_state = 'execute';
          state.workflow.current_state = 'execute';
          state.workflow.execution.status = 'in_progress';
        }
        write('.work/state.json', JSON.stringify(state));
        const before = fs.readFileSync(path.join(tmpDir, '.work/state.json'));
        const refused = transition(entry, 'execute');
        assert.equal(refused.exitCode, 1, entry);
        assert.equal(refused.receipt.error_code, 'brownfield_branch_mismatch');
        assert.equal(refused.receipt.changed, false);
        assert.deepEqual(fs.readFileSync(path.join(tmpDir, '.work/state.json')), before);
        assert.deepEqual(fs.readFileSync(path.join(tmpDir, changePath)), planBytes);
      }
      // Align only the disposable Git branch, retaining exact approved bytes.
      git(['branch', '-M', 'main']);
      fs.writeFileSync(path.join(tmpDir, '.work/state.json'), approvedBytes);
      const started = transition(entry, 'execute');
      assert.equal(started.exitCode, 0);
      assert.equal(started.receipt.changed, true);
      assert.equal(started.receipt.state.workflow.execution.status, 'in_progress');
      assert.equal(started.receipt.state.workflow.approval_ref, 'owner-branch-plan');
      assert.deepEqual(started.receipt.state.workflow.plan, JSON.parse(approvedBytes).workflow.plan);
      assert.deepEqual(fs.readFileSync(path.join(tmpDir, changePath)), planBytes);
      const continuedBytes = fs.readFileSync(path.join(tmpDir, '.work/state.json'));
      const replayed = transition(entry, 'execute');
      assert.equal(replayed.exitCode, 0);
      assert.equal(replayed.receipt.status, 'replayed');
      assert.equal(replayed.receipt.changed, false);
      assert.deepEqual(fs.readFileSync(path.join(tmpDir, '.work/state.json')), continuedBytes);
    }
  });

  test('non-Git execute reports its unverified surface without inventing a mismatch blocker', async () => {
    write(changePath, brownfieldChange('active', 'master'));
    write('.work/state.json', JSON.stringify({ current_state: 'plan' }));
    for (const [target, authority, extra] of [
      ['plan', 'workflow', []],
      ['approve', 'owner', ['--approval-ref', 'owner-nongit-plan']],
      ['execute', 'workflow', []],
    ]) {
      const result = await runCliAsMain(tmpDir, ['lifecycle-transition', target, '--plan', changePath,
        '--authority', authority, '--json', '--no-update-notice', ...extra]);
      assert.equal(result.exitCode, 0, result.output);
      if (target === 'execute') {
        const receipt = JSON.parse(result.stdout);
        assert.ok(receipt.warnings.some((notice) => notice.code === 'brownfield_branch_unverified'));
        assert.equal(receipt.state.workflow.execution.status, 'in_progress');
      }
    }
  });
});
