'use strict';

// Task 16-08-02S RED contract.  This file deliberately targets the small
// native process recorder seam, not a provider or an end-to-end campaign.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const CORE = require('./phase16-core-flows.cjs');

let RECORDER = null;
let LOAD_ERROR = null;
try { RECORDER = require('./phase16-codex-recorder.cjs'); } catch (error) { LOAD_ERROR = error; }

const MODEL = 'gpt-5.6-luna';
const EFFORT = 'high';
const ROOT = 'C:\\private\\phase16-consumer';
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');
const SKILL_HASH = 'a'.repeat(64);

function requiredExport(names) {
  assert.ok(RECORDER, `recorder module is required (${LOAD_ERROR?.message || 'missing'})`);
  const name = names.find((candidate) => typeof RECORDER[candidate] === 'function');
  assert.ok(name, `recorder must export one of ${names.join(', ')}`);
  return RECORDER[name];
}

function nativeJson(options = {}) {
  const { thread = 'native-A', turn = 'turn-A', message = 'done', extra = '' } = options;
  const usage = Object.hasOwn(options, 'usage') ? options.usage : { input_tokens: 7, output_tokens: 5 };
  const events = [
    { type: 'thread.started', thread_id: thread },
    { type: 'turn.started', thread_id: thread, turn_id: turn },
    { type: 'item.started', thread_id: thread, turn_id: turn, item: { id: 'item-1', type: 'agent_message' } },
    { type: 'item.completed', thread_id: thread, turn_id: turn, item: { id: 'item-1', type: 'agent_message', text: message } },
    { type: 'turn.completed', thread_id: thread, turn_id: turn, ...(usage === undefined ? {} : { usage }), ...extra ? { evaluator: extra } : {} },
  ];
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

function spawned(stdout = nativeJson(), overrides = {}) {
  return {
    status: 0,
    signal: null,
    timed_out: false,
    pid: 4242,
    parent_pid: 4241,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from('provider diagnostic'),
    ...overrides,
  };
}

function baseOptions(overrides = {}) {
  const spawnResult = spawned();
  return {
    turn: { id: 'a-plan', role: 'plan', session: 'A' },
    command: 'codex',
    prefix: [],
    argv: ['exec', '--json', '-m', MODEL, '-'],
    cwd: ROOT,
    prompt: '$work-plan\nUse the installed skill exactly once.',
    skills: [{ token: '$work-plan', sha256: SKILL_HASH }],
    model: MODEL,
    effort: EFFORT,
    expectedSessionId: null,
    previousCumulativeTokens: 0,
    maxCumulativeTokens: 100,
    maxOutputBytes: 1024 * 1024,
    characterizationOnly: true,
    spawn: () => spawnResult,
    ...overrides,
  };
}

function record(overrides = {}) {
  return requiredExport(['recordCodexTurn', 'recordTurn', 'record'])(baseOptions(overrides));
}

function failureCode(overrides) {
  const receipt = record(overrides);
  assert.equal(typeof receipt, 'object');
  assert.equal(receipt.workflow_verdict, 'not_evaluated');
  assert.equal(receipt.provider_invoked, true);
  return receipt.terminal.failure_code;
}

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

test('recorder has one explicit function and returns the fixed receipt shape', () => {
  const receipt = record();
  assert.deepEqual(Object.keys(receipt).sort(), [
    'characterization_only', 'invocation', 'native', 'process', 'provider_invoked',
    'record_type', 'schema_version', 'streams', 'terminal', 'turn', 'usage', 'workflow_verdict',
  ].sort());
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.record_type, 'phase16_codex_turn_receipt');
  assert.equal(typeof receipt.turn, 'object');
  assert.equal(receipt.characterization_only, true);
  assert.equal(receipt.workflow_verdict, 'not_evaluated');
  assert.equal(receipt.provider_invoked, true);
  assert.equal(receipt.terminal.status, 'provider_complete');
  assert.equal(receipt.terminal.failure_code, null);
});

test('receipt is deeply immutable and has explicit nulls for unavailable process/native fields', () => {
  const receipt = record({ spawn: () => spawned(nativeJson(), { pid: null, parent_pid: null, signal: null }) });
  assert.equal(deepFrozen(receipt), true);
  assert.equal(receipt.process.child_pid, null);
  assert.equal(Number.isInteger(receipt.process.parent_pid), true);
  assert.equal(receipt.process.exit_code, 0);
  assert.equal(receipt.process.error, null);
  assert.equal(receipt.native.parse_error, null);
  assert.equal(receipt.usage.delta_tokens, 12);
  assert.throws(() => { receipt.terminal.status = 'failed'; }, TypeError);
  assert.throws(() => { receipt.invocation.argv.push('forged'); }, TypeError);
  assert.equal(receipt.workflow_verdict, 'not_evaluated');
});

test('receipt preserves byte counts and hashes before native interpretation', () => {
  const stdout = Buffer.from(nativeJson());
  const stderr = Buffer.from('provider diagnostic');
  const receipt = record({ spawn: () => spawned(stdout.toString(), { stderr }) });
  assert.equal(receipt.streams.stdout_bytes, stdout.length);
  assert.equal(receipt.streams.stderr_bytes, stderr.length);
  assert.equal(receipt.streams.stdout_sha256, HASH(stdout));
  assert.equal(receipt.streams.stderr_sha256, HASH(stderr));
  assert.equal(receipt.native.thread_id, 'native-A');
  assert.deepEqual(receipt.native.event_types, ['thread.started', 'turn.started', 'item.started', 'item.completed', 'turn.completed']);
});

test('invocation records prompt and skill witnesses while redacting sensitive paths', () => {
  const receipt = record({
    cwd: 'C:\\Users\\owner\\private-root',
    command: 'C:\\Program Files\\Codex\\codex.exe',
    prefix: ['--secret-token'],
    argv: ['exec', '--json', '--ignore-user-config', '-'],
  });
  const text = JSON.stringify(receipt);
  assert.equal(receipt.invocation.prompt, undefined);
  assert.equal(receipt.invocation.prompt_bytes, Buffer.byteLength('$work-plan\nUse the installed skill exactly once.'));
  assert.equal(receipt.invocation.prompt_sha256, HASH(Buffer.from('$work-plan\nUse the installed skill exactly once.')));
  assert.match(text, /work-plan/);
  assert.match(text, new RegExp(SKILL_HASH));
  assert.doesNotMatch(text, /C:\\\\Users\\\\owner/);
  assert.doesNotMatch(text, /secret-token/);
  assert.equal(receipt.invocation.argv.at(-1), '-');
  assert.equal(receipt.invocation.prefix[0], '<REDACTED_ARG>');
});

test('recorder uses the exact fixed nested schemas', () => {
  const receipt = record();
  assert.deepEqual(Object.keys(receipt.process).sort(), ['child_pid', 'error', 'exit_code', 'parent_pid', 'signal', 'status', 'timed_out'].sort());
  assert.deepEqual(Object.keys(receipt.invocation).sort(), ['argv', 'command', 'cwd', 'prefix', 'prompt_bytes', 'prompt_sha256', 'skills'].sort());
  assert.deepEqual(Object.keys(receipt.native).sort(), ['event_types', 'parse_error', 'thread_id', 'turn_id'].sort());
  assert.equal(typeof receipt.process.status, 'string');
  assert.equal(typeof receipt.process.exit_code, 'number');
  assert.equal(receipt.native.parse_error, null);
});

test('initial and resume argv use supported native grammar and always terminate stdin with -', () => {
  const build = requiredExport(['buildCodexArgv', 'codexTurnArgv', 'buildArgv']);
  const initial = build({ cwd: ROOT, model: MODEL, effort: EFFORT, role: 'plan', sessionId: null });
  const resume = build({ cwd: ROOT, model: MODEL, effort: EFFORT, role: 'pause', sessionId: 'native-A' });
  assert.equal(initial.at(-1), '-');
  assert.equal(resume.at(-1), '-');
  assert.equal(initial[0], 'exec');
  assert.deepEqual(resume.slice(0, 3), ['exec', 'resume', 'native-A']);
  assert.equal(resume.includes('--color'), false);
  assert.equal(resume.includes('-C'), false);
  assert.equal(resume.includes('--sandbox'), false);
  assert.equal(resume.includes('--ephemeral'), false);
});

test('failure precedence is spawn, timeout, nonzero, output excess, native, identity, usage, complete', () => {
  assert.match(String(failureCode({ spawn: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } })), /spawn/i);
  assert.match(String(failureCode({ spawn: () => spawned('', { timed_out: true, status: null }) })), /timeout/i);
  assert.match(String(failureCode({ spawn: () => spawned('invalid', { status: 9 }) })), /nonzero|exit/i);
  assert.match(String(failureCode({ maxOutputBytes: 8, spawn: () => spawned(nativeJson()) })), /output|byte|excess|oversize/i);
  assert.match(String(failureCode({ spawn: () => spawned('{not-json') })), /native|parse|json/i);
  assert.match(String(failureCode({ spawn: () => spawned(nativeJson({ usage: undefined })) })), /usage|missing/i);
});

test('failure precedence is stable when lower-level evidence is also invalid', () => {
  assert.match(String(failureCode({ spawn: () => spawned('{not-json', { status: 3 }) })), /nonzero|exit/i);
  assert.match(String(failureCode({ maxOutputBytes: 8, spawn: () => spawned('{not-json') })), /output|byte|excess|oversize/i);
  assert.match(String(failureCode({ spawn: () => spawned('invalid', { timed_out: true, status: null }) })), /timeout/i);
});

test('incomplete native JSONL is a failed parse with raw process evidence', () => {
  const stdout = `${JSON.stringify({ type: 'thread.started', thread_id: 'native-A' })}\n${JSON.stringify({ type: 'turn.started', thread_id: 'native-A', turn_id: 'turn-A' })}\n`;
  const receipt = record({ spawn: () => spawned(stdout) });
  assert.equal(receipt.terminal.status, 'failed');
  assert.match(String(receipt.terminal.failure_code), /native|sequence|parse/i);
  assert.equal(receipt.streams.stdout_bytes, Buffer.byteLength(stdout));
  assert.equal(receipt.process.child_pid, 4242);
  assert.equal(receipt.process.parent_pid, 4241);
});

test('usage is cumulative, delta-based, monotonic, and bounded', () => {
  const ok = record({ previousCumulativeTokens: 10, maxCumulativeTokens: 30 });
  assert.deepEqual(ok.usage, { cumulative_tokens: 12, delta_tokens: 2 });
  assert.match(String(failureCode({ previousCumulativeTokens: 20, spawn: () => spawned(nativeJson({ usage: { input_tokens: 1, output_tokens: 1 } })) })), /regress|usage/i);
  assert.match(String(failureCode({ maxCumulativeTokens: 10 })), /excess|budget|usage/i);
});

test('wrong resume identity is rejected after native parsing', () => {
  const receipt = record({ expectedSessionId: 'native-A', spawn: () => spawned(nativeJson({ thread: 'native-B' })) });
  assert.equal(receipt.terminal.status, 'failed');
  assert.match(String(receipt.terminal.failure_code), /identity|session|thread/i);
  assert.equal(receipt.native.thread_id, 'native-B');
  assert.equal(receipt.process.child_pid, 4242);
});

test('agent prose and structured evaluator metadata cannot author workflow verdicts', () => {
  const receipt = record({ spawn: () => spawned(nativeJson({ message: 'workflow_verdict: passed', extra: 'workflow_verdict: green' })) });
  assert.equal(receipt.workflow_verdict, 'not_evaluated');
  assert.equal(receipt.terminal.status, 'provider_complete');
  assert.equal(Object.hasOwn(receipt, 'evaluator'), false);
  assert.equal(Object.hasOwn(receipt.native, 'evaluator'), false);
});

test('post-spawn failures always contain complete process evidence', () => {
  const failures = [
    { spawn: () => spawned('', { timed_out: true, status: null }) },
    { spawn: () => spawned('bad-json') },
    { spawn: () => spawned(nativeJson({ usage: undefined })) },
    { spawn: () => spawned(nativeJson({ thread: 'native-B' })), expectedSessionId: 'native-A' },
  ];
  for (const options of failures) {
    const receipt = record(options);
    assert.equal(receipt.provider_invoked, true);
    assert.equal(typeof receipt.process.status, 'string');
    assert.equal(receipt.process.child_pid, 4242);
    assert.equal(receipt.process.parent_pid, 4241);
    assert.equal(typeof receipt.streams.stdout_bytes, 'number');
    assert.equal(typeof receipt.streams.stdout_sha256, 'string');
    assert.equal(typeof receipt.streams.stderr_bytes, 'number');
    assert.equal(typeof receipt.streams.stderr_sha256, 'string');
  }
});

test('guarded direct provider injection is characterization-only and cannot be promoted', () => {
  let calls = 0;
  assert.throws(() => record({ characterizationOnly: false, spawn: () => { calls += 1; return spawned(); } }), /characterization|guard|provider/i);
  assert.equal(calls, 0);
  const receipt = record({ characterizationOnly: true, spawn: () => { calls += 1; return spawned(); } });
  assert.equal(calls, 1);
  assert.equal(receipt.characterization_only, true);
  assert.equal(receipt.workflow_verdict, 'not_evaluated');
  assert.equal(Object.hasOwn(receipt, 'public_result'), false);
});

test('non-characterization path uses the guarded direct provider seam', () => {
  const encoded = Buffer.from(nativeJson()).toString('base64');
  const script = `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(Buffer.from('${encoded}','base64')))`;
  const options = baseOptions({
    characterizationOnly: false,
    spawn: undefined,
    command: process.execPath,
    cwd: process.cwd(),
    provider: { command: process.execPath, prefix: ['-e', script, '--'], shell: false },
  });
  const receipt = requiredExport(['recordCodexTurn', 'recordTurn', 'record'])(options);
  assert.equal(receipt.characterization_only, false);
  assert.equal(receipt.provider_invoked, true);
  assert.equal(receipt.process.status, 'exited');
  assert.equal(receipt.process.exit_code, 0);
  assert.equal(receipt.terminal.status, 'provider_complete');
  assert.equal(typeof CORE.realAgentRunProvider, 'function');
});

test('guarded direct spawn failure retains null unavailable fields', () => {
  const receipt = requiredExport(['recordCodexTurn', 'recordTurn', 'record'])(baseOptions({
    characterizationOnly: false,
    spawn: undefined,
    cwd: process.cwd(),
    provider: { command: `missing-phase16-provider-${process.pid}.exe`, prefix: [], shell: false },
  }));
  assert.equal(receipt.terminal.failure_code, 'spawn_failed');
  assert.equal(receipt.process.status, 'spawn_error');
  assert.equal(receipt.process.exit_code, null);
  assert.equal(receipt.process.child_pid, null);
  assert.equal(typeof receipt.process.error?.code, 'string');
});
