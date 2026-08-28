'use strict';

// The recorder is deliberately boring: one guarded native invocation in and
// one immutable evidence record out. It never grades the workflow.
const crypto = require('node:crypto');
const CORE = require('./phase16-core-flows.cjs');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const bytes = (value) => Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value ?? ''), 'utf8');
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

function redact(value, options) {
  let text = String(value ?? '');
  for (const token of [options.cwd, options.root, process.env.HOME, process.env.USERPROFILE]) {
    if (token) text = text.split(String(token)).join('<REDACTED_PATH>');
  }
  return text.replace(/(?:--[^\s=]*?(?:secret|token|password|key)[^\s=]*)(?:=[^\s]*)?/ig, '<REDACTED_ARG>');
}

function processEvidence(result, stdout, stderr, options) {
  const error = result?.error ? { code: result.error.code ?? null, message: redact(result.error.message, options) } : null;
  return {
    status: result?.timed_out ? 'timed_out' : result?.error ? 'spawn_error' : 'exited',
    exit_code: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal == null ? null : String(result.signal),
    timed_out: result?.timed_out === true,
    child_pid: Number.isInteger(result?.pid) ? result.pid : null,
    parent_pid: Number.isInteger(result?.parent_pid) ? result.parent_pid : process.pid,
    error,
  };
}

function failure(code, message) {
  return { code: String(code || 'recorder_failure'), message: String(message || code || 'native turn failed') };
}

function recordCodexTurn(options = {}) {
  const characterizationOnly = options.characterizationOnly === true;
  if (typeof options.spawn === 'function' && !characterizationOnly) {
    throw new Error('direct provider injection is characterization-only');
  }
  if (!options.turn || !Array.isArray(options.argv) || typeof options.command !== 'string') {
    throw new Error('recorder invocation is incomplete');
  }
  for (const item of options.skills || []) if (!/^\$work-[a-z0-9-]+$/.test(String(item?.token ?? ''))) throw new Error('invalid skill witness token');
  const stdoutEmpty = Buffer.alloc(0);
  const stderrEmpty = Buffer.alloc(0);
  let result;
  let spawnFailure = null;
  const input = String(options.prompt ?? '');
  try {
    result = typeof options.spawn === 'function'
      ? options.spawn(options.command, options.argv, { cwd: options.cwd, env: options.env, input, timeout: options.timeout, shell: false })
      : CORE.realAgentRunProvider(options.provider, options.argv, { cwd: options.cwd, env: options.env, input, timeout: options.timeout, shell: false });
  } catch (error) {
    spawnFailure = failure('spawn_failed', error.message);
    result = { status: null, signal: null, timed_out: false, pid: null, parent_pid: null, stdout: stdoutEmpty, stderr: stderrEmpty, error: { code: error.code || 'SPAWN_FAILED', message: error.message } };
  }
  if (!spawnFailure && result?.error) spawnFailure = failure('spawn_failed', result.error.message);
  // Normalize and hash streams immediately after spawn, before interpreting
  // native JSON. This preserves evidence for every attempted provider turn.
  const stdout = bytes(result?.stdout);
  const stderr = bytes(result?.stderr);
  const process = processEvidence(result || {}, stdout, stderr, options);
  const invocation = {
    command: redact(options.command, options),
    prefix: (options.prefix || []).map((value) => redact(value, options)),
    argv: options.argv.map((value) => redact(value, options)),
    cwd: '<CONSUMER_ROOT>',
    prompt_sha256: sha256(bytes(input)),
    prompt_bytes: bytes(input).length,
    skills: (options.skills || []).map((item) => ({ token: String(item?.token ?? ''), sha256: String(item?.sha256 ?? '') })),
  };
  const nativeBase = { event_types: [], item_kinds: [], thread_id: null, turn_id: null, parse_error: null };
  let native = nativeBase;
  let parsedNative = null;
  let problem = spawnFailure;
  if (!problem && result?.timed_out === true) problem = failure('timeout', 'native provider turn timed out');
  if (!problem && result?.status !== 0) problem = failure('nonzero_exit', `native provider exited with status ${result?.status}`);
  if (!problem && stdout.length + stderr.length > Number(options.maxOutputBytes ?? 1024 * 1024)) problem = failure('output_excess', 'native provider output exceeded retained byte limit');
  if (!problem) {
    try {
      const parsed = CORE.liveParseCodex(stdout.toString('utf8'), options.model, options.argv, { requireUsage: true });
      parsedNative = parsed;
      native = { event_types: parsed.event_types, item_kinds: parsed.item_kinds || [], thread_id: parsed.thread_id, turn_id: parsed.turn_id, parse_error: null };
    } catch (error) {
      problem = failure(error.code || 'native_parse_failed', error.message);
      native = { ...nativeBase, parse_error: { code: error.code || 'native_parse_failed', message: redact(error.message, options) } };
      try {
        const parsed = JSON.parse(stdout.toString('utf8').split(/\r?\n/).find(Boolean) || '{}');
        native.thread_id = parsed.thread_id || null;
      } catch {}
    }
  }
  const usageValue = parsedNative?.usage?.total_tokens;
  const prior = Number(options.previousCumulativeTokens ?? 0);
  const cumulative = Number.isSafeInteger(usageValue) ? usageValue : null;
  // Native usage is the current turn's counted usage. The recorder carries
  // the caller's prior total forward, while still rejecting a raw value that
  // moves backwards against that prior bound.
  const delta = cumulative == null ? null : cumulative - prior;
  if (!problem && options.expectedSessionId != null && native.thread_id !== options.expectedSessionId) problem = failure('identity_mismatch', 'native resume session identity differs from the expected session');
  if (!problem && cumulative == null) problem = failure('usage_missing', 'native cumulative usage is missing');
  if (!problem && delta < 0) problem = failure('usage_regression', 'native cumulative usage regressed');
  if (!problem && delta > Number(options.maxCumulativeTokens ?? Number.MAX_SAFE_INTEGER)) problem = failure('usage_excess', 'native cumulative usage exceeded the turn budget');
  const receipt = {
    schema_version: 1,
    record_type: 'phase16_codex_turn_receipt',
    characterization_only: characterizationOnly,
    invocation,
    native,
    process,
    provider_invoked: true,
    streams: { stdout_bytes: stdout.length, stdout_sha256: sha256(stdout), stderr_bytes: stderr.length, stderr_sha256: sha256(stderr) },
    terminal: { status: problem ? 'failed' : 'provider_complete', failure_code: problem?.code || null, message: problem?.message || 'native provider turn completed' },
    turn: options.turn,
    usage: { cumulative_tokens: cumulative, delta_tokens: delta },
    workflow_verdict: 'not_evaluated',
  };
  return deepFreeze(receipt);
}

function buildCodexArgv({ cwd, model, effort, role, sessionId = null }) {
  const base = sessionId ? ['exec', '--approve-for-me', 'resume', sessionId] : ['exec', '--approve-for-me', '-C', cwd];
  return [...base, '--ignore-user-config', '--json', ...(sessionId ? [] : ['--color', 'never']), '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-'];
}

module.exports = { recordCodexTurn, buildCodexArgv, deepFreeze };
