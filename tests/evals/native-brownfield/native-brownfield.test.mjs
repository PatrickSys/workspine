import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import { canonicalStringify, sha256, treeManifest } from './util.mjs';
import { ReceiptChain, projectOutcome, verifySeal } from './seal.mjs';
import {
  classifyProviderResult,
  closeCodexChild,
  codexTurnPolicy,
  findCheckpointWitness,
  findNetworkViolation,
} from './codex.mjs';
import { approvePlan, runJourney, validateTopology } from './journey.mjs';
import {
  assertCandidateBinding,
  assertSyntheticBaseline,
  createIsolatedCodexHome,
} from './prepare.mjs';
import { classifyGrade, evaluateScope, gradeWorkspace, validateGenericReproduction } from './grade.mjs';
import { main } from './cli.mjs';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspine-native-eval-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('canonical serialization sorts object keys without sorting arrays', () => {
  assert.equal(canonicalStringify({ z: 1, a: { y: 2, x: 3 }, rows: [{ b: 2, a: 1 }] }),
    '{"a":{"x":3,"y":2},"rows":[{"a":1,"b":2}],"z":1}');
});

test('public outcome mapping is complete and fail closed', () => {
  assert.deepEqual(projectOutcome('product_green'), { disposition: 'green', failure_domain: null });
  assert.deepEqual(projectOutcome('task_red'), { disposition: 'red', failure_domain: 'task_outcome' });
  assert.deepEqual(projectOutcome('provider_invalid'), { disposition: 'invalid', failure_domain: 'provider' });
  assert.deepEqual(projectOutcome('protocol_invalid'), { disposition: 'invalid', failure_domain: 'evaluator' });
  assert.deepEqual(projectOutcome('evaluator_invalid'), { disposition: 'invalid', failure_domain: 'evaluator' });
  assert.deepEqual(projectOutcome('environment_invalid'), { disposition: 'invalid', failure_domain: 'environment' });
  assert.throws(() => projectOutcome('unknown'), /unsupported outcome/);
});

test('workspine red requires independent generic reproduction', () => {
  assert.throws(() => projectOutcome('workspine_red'), /generic reproduction/);
  assert.deepEqual(projectOutcome('workspine_red', { genericReproductionSha256: 'a'.repeat(64) }),
    { disposition: 'red', failure_domain: 'workspine_contract' });
});

test('product outcomes cannot seal an incomplete receipt prefix', t => {
  const root = tempRoot(t);
  const chain = new ReceiptChain(root, 'run-1');
  chain.append(0, 'manifest', 'manifest', {});
  assert.throws(() => chain.terminal('product_green'), /complete receipt chain/);
});

test('receipt chain creates deterministic links and a terminal seal', t => {
  const root = tempRoot(t);
  const chain = new ReceiptChain(root, 'run-1');
  chain.append(0, 'manifest', 'manifest', { candidate: 'abc' });
  chain.append(10, 'qualification', 'qualification', { status: 'completed' });
  const terminal = chain.terminal('environment_invalid', { failure_code: 'test_fixture' });
  const verified = verifySeal(root);
  assert.equal(verified.terminal.seal_sha256, terminal.seal_sha256);
  assert.equal(verified.public.disposition, 'invalid');
  assert.equal(verified.links.length, 2);
  const manifestBytes = fs.readFileSync(path.join(root, 'receipts', '000-manifest.json'), 'utf8');
  assert.equal(manifestBytes, `${canonicalStringify(JSON.parse(manifestBytes))}\n`);
});

test('receipt chain resumes a validated prefix without adding a second seal layer', t => {
  const root = tempRoot(t);
  const first = new ReceiptChain(root, 'run-1');
  first.append(0, 'manifest', 'manifest', {});
  const resumed = new ReceiptChain(root, 'run-1', { resume: true });
  resumed.append(10, 'qualification', 'qualification', { ok: true });
  resumed.terminal('environment_invalid');
  assert.deepEqual(verifySeal(root).links.map(link => link.sequence), [0, 10]);
});

test('receipt path is create-exclusive', t => {
  const root = tempRoot(t);
  const chain = new ReceiptChain(root, 'run-1');
  chain.append(0, 'manifest', 'manifest', {});
  const replay = new ReceiptChain(root, 'run-1');
  assert.throws(() => replay.append(0, 'manifest', 'manifest', {}), /already exists/);
});

test('seal validation rejects receipt mutation', t => {
  const root = tempRoot(t);
  const chain = new ReceiptChain(root, 'run-1');
  const first = chain.append(0, 'manifest', 'manifest', { value: 1 });
  chain.terminal('environment_invalid', {});
  const file = path.join(root, 'receipts', first.path);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.payload.value = 2;
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  assert.throws(() => verifySeal(root), /hash mismatch/);
});

test('seal validation rejects missing and reordered receipts', t => {
  const root = tempRoot(t);
  const chain = new ReceiptChain(root, 'run-1');
  const first = chain.append(0, 'manifest', 'manifest', {});
  chain.append(100, 'a-plan', 'turn', {});
  chain.terminal('environment_invalid', {});
  fs.rmSync(path.join(root, 'receipts', first.path));
  assert.throws(() => verifySeal(root), /missing receipt/);
});

test('seal validation rejects a self-consistent terminal with reordered links', t => {
  const root = tempRoot(t);
  const chain = new ReceiptChain(root, 'run-1');
  chain.append(0, 'manifest', 'manifest', {});
  chain.append(100, 'a-plan', 'turn', {});
  chain.terminal('environment_invalid');
  const file = path.join(root, 'receipts', '900-terminal-seal.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.payload.links.reverse();
  const { receipt_sha256: _receipt, seal_sha256: _seal, ...body } = value;
  value.receipt_sha256 = sha256(canonicalStringify(body));
  const { seal_sha256: _ignored, ...sealedBody } = value;
  value.seal_sha256 = sha256(canonicalStringify(sealedBody));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  assert.throws(() => verifySeal(root), /reordered/);
});

test('Codex sandbox disables consumer network and limits writable roots', () => {
  const cwd = path.resolve('fixture');
  assert.deepEqual(codexTurnPolicy(cwd), {
    type: 'workspaceWrite',
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  });
});

test('provider results preserve typed invalid domains and null usage', () => {
  assert.equal(classifyProviderResult({ spawnError: { code: 'ENOENT' } }).outcome, 'provider_invalid');
  assert.equal(classifyProviderResult({ timedOut: true }).outcome, 'provider_invalid');
  assert.equal(classifyProviderResult({ exitCode: 1 }).outcome, 'provider_invalid');
  assert.equal(classifyProviderResult({ exitCode: 0, protocolError: { code: 'bad_rpc' }, sessionId: 'A' }).outcome, 'protocol_invalid');
  assert.equal(classifyProviderResult({ exitCode: 0, protocolError: { code: 'provider_invalid' }, sessionId: 'A' }).outcome, 'provider_invalid');
  assert.equal(classifyProviderResult({ exitCode: 0, closeTimedOut: true, sessionId: 'A' }).outcome, 'provider_invalid');
  assert.equal(classifyProviderResult({ exitCode: 0, malformedEvents: 1, sessionId: 'A' }).outcome, 'protocol_invalid');
  assert.equal(classifyProviderResult({ exitCode: 0, sessionId: null }).outcome, 'protocol_invalid');
  assert.deepEqual(classifyProviderResult({ exitCode: 0, sessionId: 'A', totalTokens: null }).usage,
    { total_tokens: 'not_observable' });
});

test('native web-search evidence is rejected independently of sandbox declaration', () => {
  assert.deepEqual(findNetworkViolation([{ method: 'item/started', params: { item: { id: 'web-1', type: 'webSearch' } } }]),
    { event_index: 0, item_id: 'web-1', item_kind: 'websearch' });
  assert.equal(classifyProviderResult({ exitCode: 0, sessionId: 'A', networkViolation: { item_id: 'web-1' } }).outcome,
    'environment_invalid');
  assert.equal(findNetworkViolation([{ method: 'item/completed', params: { item: { id: 'cmd-1', type: 'commandExecution' } } }]), null);
});

test('post-turn child shutdown is bounded even when the child ignores stdin', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32',
  });
  const closed = new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
  const started = Date.now();
  const result = await closeCodexChild(child, closed, { closeGraceMs: 25, killGraceMs: 2_000 });
  assert.equal(result.closeTimedOut, true);
  assert.ok(Date.now() - started < 5_000);
});

function completedRead(root, output) {
  return {
    method: 'item/completed',
    params: { item: {
      id: 'read-checkpoint',
      type: 'commandExecution',
      status: 'completed',
      cwd: root,
      command: 'cmd.exe /c "type .work\\.continue-here.md"',
      aggregatedOutput: output,
    } },
  };
}

function productChange() {
  return {
    method: 'item/completed',
    params: { item: {
      id: 'change-product',
      type: 'fileChange',
      changes: [{ path: 'src/example.js' }],
    } },
  };
}

test('checkpoint witness binds exact output before product mutation', t => {
  const root = tempRoot(t);
  const checkpoint = 'checkpoint bytes\n';
  const witness = findCheckpointWitness([completedRead(root, checkpoint), productChange()], {
    consumerRoot: root,
    checkpointSha256: sha256(checkpoint),
  });
  assert.equal(witness.ok, true);
  assert.equal(witness.event_index, 0);
  assert.equal(witness.product_change_event_index, 1);
  assert.equal(witness.output_sha256, sha256(checkpoint));
});

test('checkpoint witness fails closed when read is late, wrong, or ambiguous', t => {
  const root = tempRoot(t);
  const checkpoint = 'checkpoint bytes\n';
  const options = { consumerRoot: root, checkpointSha256: sha256(checkpoint) };
  assert.equal(findCheckpointWitness([productChange(), completedRead(root, checkpoint)], options).ok, false);
  assert.equal(findCheckpointWitness([completedRead(root, 'wrong')], options).ok, false);
  assert.equal(findCheckpointWitness([completedRead(root, checkpoint), completedRead(root, checkpoint)], options).ok, false);
  assert.equal(findCheckpointWitness([completedRead(root, checkpoint)], options).reason, 'product_change_event_not_observed');
});

test('journey order is plan, pause, approval, fresh B, verify, progress', async () => {
  const calls = [];
  const records = new Map();
  const sessions = {
    'a-plan': 'A', 'a-pause': 'A',
    'b-resume-execute': 'B', 'c-verify': 'C', 'c-progress': 'C',
  };
  const transport = { runTurn: async turn => {
    assert.equal(turn.hardTimeoutMs, 321);
    calls.push(`turn:${turn.id}`);
    return { outcome: 'completed', sessionId: sessions[turn.id], turnId: `${turn.id}-id`, totalTokens: null };
  } };
  const result = await runJourney({
    transport,
    captureCheckpoint: () => ({ path: '.work/.continue-here.md', sha256: 'c'.repeat(64) }),
    approve: ({ checkpoint }) => { calls.push('approval'); return { ok: true, checkpoint_sha256: checkpoint.sha256 }; },
    checkpointWitness: () => ({ ok: true, output_sha256: 'c'.repeat(64) }),
    hardTimeoutMs: 321,
    record: (id, value) => records.set(id, value),
  });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(calls, [
    'turn:a-plan', 'turn:a-pause', 'approval',
    'turn:b-resume-execute', 'turn:c-verify', 'turn:c-progress',
  ]);
  assert.equal(records.get('b-resume-execute').checkpoint_witness.ok, true);
});

test('journey rejects approval checkpoint mutation without dependent turns', async () => {
  const calls = [];
  const transport = { runTurn: async turn => {
    calls.push(turn.id);
    return { outcome: 'completed', sessionId: 'A', turnId: turn.id };
  } };
  const result = await runJourney({
    transport,
    captureCheckpoint: () => ({ path: '.work/.continue-here.md', sha256: 'a'.repeat(64) }),
    approve: () => ({ ok: true, checkpoint_sha256: 'b'.repeat(64) }),
    checkpointWitness: () => ({ ok: true }),
  });
  assert.equal(result.outcome, 'protocol_invalid');
  assert.deepEqual(calls, ['a-plan', 'a-pause']);
});

test('journey stops before approval when session A identity drifts', async () => {
  const calls = [];
  const transport = { runTurn: async turn => {
    calls.push(turn.id);
    return { outcome: 'completed', sessionId: turn.id === 'a-plan' ? 'A' : 'wrong', turnId: turn.id };
  } };
  const result = await runJourney({ transport,
    captureCheckpoint: () => ({ sha256: 'a'.repeat(64) }),
    approve: () => { calls.push('approval'); return { ok: true, checkpoint_sha256: 'a'.repeat(64) }; } });
  assert.equal(result.outcome, 'protocol_invalid');
  assert.deepEqual(calls, ['a-plan', 'a-pause']);
});

test('provider-free approval uses the real generated lifecycle command and persists exact state', t => {
  const root = tempRoot(t), entry = path.resolve('bin', 'gsdd.mjs');
  const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
  let result = run([entry, 'init', '--auto', '--tools', 'agents', '--no-update-notice']);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const changeDir = path.join(root, '.work', 'brownfield-change');
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'CHANGE.md'), [
    '---', 'change: CHANGE-001', 'status: active', 'type: medium_scope_brownfield', '---', '',
    '# Brownfield change', '', '## Goal', 'Repair one frozen user-visible behavior.', '',
    '## Why This Exists', '- The frozen consumer behavior is broken.', '',
    '## In Scope', '- Modify the case-declared path.', '', '## Out of Scope', '- No unrelated cleanup.', '',
    '## Structural Promotion Triggers', '- Promote only if the bounded path no longer contains the work.', '',
    '## Done When', '- The frozen oracle passes.', '', '## Current Status', '- Current posture: active',
    '- Current branch / integration surface: synthetic baseline', '- Current owner / runtime: owner / provider-free test', '',
    '## Next Action', '- Approve and execute the bounded change.', '', '## PR Slice Ownership',
    '| Slice | Scope | Owned files / modules | Status |', '| --- | --- | --- | --- |',
    '| A | Frozen repair | case-declared path | planned |', '', '## Closeout Path',
    '1. Verify the frozen oracle.', '2. Record the normal Workspine verification artifact.', '',
  ].join('\n'));
  result = run([path.join(root, '.work', 'bin', 'gsdd.mjs'), 'lifecycle-transition', 'plan',
    '--plan', '.work/brownfield-change/CHANGE.md', '--authority', 'workflow', '--json', '--no-update-notice']);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const checkpoint = '---\nworkflow: brownfield-change\n---\n\nResume the approved bounded change.\n';
  fs.writeFileSync(path.join(root, '.work', '.continue-here.md'), checkpoint);
  const approval = approvePlan({ consumerRoot: root,
    checkpoint: { sha256: sha256(checkpoint) }, approvalRef: 'owner-frozen-eval-approval' });
  assert.equal(approval.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.work', 'state.json'), 'utf8')).workflow.plan.approved, true);
});

test('topology requires A/B/C fresh identities and within-session reuse', () => {
  assert.equal(validateTopology({ aPlan: 'A', aPause: 'A', b: 'B', cVerify: 'C', cProgress: 'C' }).ok, true);
  assert.equal(validateTopology({ aPlan: 'A', aPause: 'X', b: 'B', cVerify: 'C', cProgress: 'C' }).ok, false);
  assert.equal(validateTopology({ aPlan: 'A', aPause: 'A', b: 'A', cVerify: 'C', cProgress: 'C' }).ok, false);
  assert.equal(validateTopology({ aPlan: 'A', aPause: 'A', b: 'B', cVerify: 'C', cProgress: 'D' }).ok, false);
});

test('isolated Codex home contains auth only and never reports auth hash', t => {
  const root = tempRoot(t);
  const source = path.join(root, 'source');
  const parent = path.join(root, 'isolated');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'auth.json'), '{"secret":"never record"}\n');
  fs.writeFileSync(path.join(source, 'AGENTS.md'), 'global instructions');
  fs.writeFileSync(path.join(source, 'config.toml'), 'model = "other"');
  const result = createIsolatedCodexHome({ sourceHome: source, parent, runId: 'run-1', allowTempForTest: true });
  assert.deepEqual(fs.readdirSync(result.home), ['auth.json']);
  assert.equal(JSON.stringify(result.posture).includes('secret'), false);
  assert.equal(JSON.stringify(result.posture).includes(sha256('{"secret":"never record"}\n')), false);
});

test('qualification restores auth-only posture after Codex runtime temp files', async t => {
  const root = tempRoot(t);
  const source = path.join(root, 'source');
  const parent = path.join(root, 'isolated');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'auth.json'), '{}\n');
  const result = createIsolatedCodexHome({ sourceHome: source, parent, runId: 'run-1', allowTempForTest: true });
  const runtimeTemp = path.join(result.home, 'tmp', 'arg0', 'codex-arg0');
  fs.mkdirSync(runtimeTemp, { recursive: true });
  fs.writeFileSync(path.join(runtimeTemp, 'apply_patch.bat'), 'runtime helper');
  const prepare = await import('./prepare.mjs');

  assert.equal(typeof prepare.restoreIsolatedCodexHomePosture, 'function');
  assert.equal(prepare.restoreIsolatedCodexHomePosture(result.home), true);
  assert.deepEqual(fs.readdirSync(result.home), ['auth.json']);
  fs.writeFileSync(path.join(result.home, 'tmp'), 'not a runtime temp directory');
  assert.throws(() => prepare.restoreIsolatedCodexHomePosture(result.home), /runtime temp path/);
});

test('claim Codex home refuses the system Temp tree', t => {
  const root = tempRoot(t);
  fs.writeFileSync(path.join(root, 'auth.json'), '{}\n');
  assert.throws(() => createIsolatedCodexHome({ sourceHome: root, parent: path.join(root, 'homes'), runId: 'run-1' }), /outside Temp/);
});

test('synthetic baseline requires exactly one commit and no remotes', t => {
  const root = tempRoot(t);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'eval@example.invalid']);
  git(root, ['config', 'user.name', 'Eval']);
  fs.writeFileSync(path.join(root, 'index.js'), 'export const broken = true;\n');
  git(root, ['add', 'index.js']);
  git(root, ['commit', '-m', 'synthetic broken baseline']);
  assert.equal(assertSyntheticBaseline(root).ok, true);
  git(root, ['remote', 'add', 'origin', 'https://example.invalid/repo.git']);
  assert.throws(() => assertSyntheticBaseline(root), /remote/);
});

test('candidate binding rejects head, tree, package, or tarball drift', () => {
  const actual = { head: 'a', tree: 'b', package_name: 'workspine', package_version: '0.32.0', tarball_sha256: 'c' };
  assert.equal(assertCandidateBinding(actual, { ...actual }).ok, true);
  for (const key of Object.keys(actual)) {
    assert.throws(() => assertCandidateBinding(actual, { ...actual, [key]: 'different' }), new RegExp(key));
  }
});

test('scope evaluator supports case-declared artifact layouts', () => {
  assert.equal(evaluateScope(['src/a.js', 'docs/result.md'], ['src/a.js', 'docs/result.md']).ok, true);
  assert.equal(evaluateScope(['src/a.js', 'docs/result.md'], ['src/a.js']).ok, false);
});

test('grade classification separates task outcome from reproduced Workspine contract', () => {
  assert.equal(classifyGrade({ oraclePassed: true, scopePassed: true, workflowPassed: true }), 'product_green');
  assert.equal(classifyGrade({ oraclePassed: false, scopePassed: true, workflowPassed: true }), 'task_red');
  assert.equal(classifyGrade({ oraclePassed: true, scopePassed: true, workflowPassed: false }), 'task_red');
  assert.equal(classifyGrade({ oraclePassed: true, scopePassed: true, workflowPassed: false,
    genericReproduction: { sha256: 'd'.repeat(64) } }), 'task_red');
});

test('Workspine red requires a frozen independently valid reproduction receipt', t => {
  const root = tempRoot(t), file = path.join(root, 'generic-reproduction.json');
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, record_type: 'generic_workspine_reproduction',
    status: 'confirmed', task_independent: true, hidden_witness_used: false, failure_code: 'lifecycle_mismatch',
    evidence_sha256: 'e'.repeat(64) }));
  const genericReproduction = validateGenericReproduction({ path: file, sha256: sha256(fs.readFileSync(file)) });
  assert.equal(classifyGrade({ oraclePassed: true, scopePassed: true, workflowPassed: false, genericReproduction }), 'workspine_red');
  assert.throws(() => validateGenericReproduction({ path: file, sha256: 'f'.repeat(64) }), /binding is invalid/);
});

test('provider-free grade is deterministic for a second declared artifact layout', t => {
  const root = tempRoot(t);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const value = 1;\n');
  const baseline = treeManifest(root);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'result.md'), '# Result\n');
  fs.mkdirSync(path.join(root, '.work', 'brownfield-change'), { recursive: true });
  for (const name of ['CHANGE.md', 'HANDOFF.md', 'VERIFICATION.md']) {
    fs.writeFileSync(path.join(root, '.work', 'brownfield-change', name), `${name}\n`);
  }
  fs.writeFileSync(path.join(root, '.work', 'state.json'), JSON.stringify({ workflow: {
    authority: 'owner', plan: { approved: true }, execution: { status: 'complete' }, verification: { status: 'passed' },
  } }));
  const input = { consumerRoot: root, baselineManifest: baseline, allowedPaths: ['docs/result.md'],
    oracle: { executable: process.execPath, args: ['-e', 'process.exit(0)'] } };
  const first = gradeWorkspace(input);
  const second = gradeWorkspace(input);
  assert.equal(first.outcome, 'product_green');
  assert.equal(second.grade_sha256, first.grade_sha256);
});

test('calibration accepts only baseline-red witness-green mutant-red controls', async t => {
  const root = tempRoot(t);
  const file = path.join(root, 'case.json');
  const payload = { network_accessed: false, baseline: 'red', witness: 'green', mutants: [{ id: 'mutant-1', result: 'red' }] };
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, id: 'dummy', calibration: {
    executable: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`],
  } }));
  const result = await main(['calibrate', '--case', file]);
  assert.equal(result.ok, true);
  assert.equal(result.provider_invoked, false);
  payload.witness = 'red';
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, id: 'dummy', calibration: {
    executable: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`],
  } }));
  await assert.rejects(main(['calibrate', '--case', file]), /calibration controls failed/);
});
