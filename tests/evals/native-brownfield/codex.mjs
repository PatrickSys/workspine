import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { EvalError, mkdirp, resolveDirectCommand, sha256, toPosix } from './util.mjs';
export function codexTurnPolicy(cwd) { return { type: 'workspaceWrite', writableRoots: [path.resolve(cwd)], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }; }
const WINDOWS_SANDBOX_REFUSAL = 'windows unelevated restricted-token sandbox cannot enforce split writable root sets directly; refusing to run unsandboxed';
export function scanWindowsSandboxRefusal(state, chunk) { const combined = state.tail + String(chunk); state.found ||= combined.includes(WINDOWS_SANDBOX_REFUSAL); state.tail = combined.slice(1 - WINDOWS_SANDBOX_REFUSAL.length); return state; }
export function classifyProviderResult(result, expectedSession = null) {
  let outcome = 'completed';
  let failure_code = null;
  if (result.spawnError) [outcome, failure_code] = ['provider_invalid', 'spawn_error'];
  else if (result.timedOut) [outcome, failure_code] = ['provider_invalid', 'hard_wall_timeout'];
  else if (result.outputExcess) [outcome, failure_code] = ['provider_invalid', 'output_excess'];
  else if (result.closeTimedOut) [outcome, failure_code] = ['provider_invalid', 'post_turn_close_timeout'];
  else if (result.networkViolation) [outcome, failure_code] = ['environment_invalid', 'native_network_event'];
  else if (result.sandboxEnvironmentFailure) [outcome, failure_code] = ['environment_invalid', 'windows_sandbox_unavailable'];
  else if (result.protocolError?.code === 'provider_invalid') [outcome, failure_code] = ['provider_invalid', 'native_provider_failure'];
  else if (result.protocolError) [outcome, failure_code] = ['protocol_invalid', result.protocolError.code || 'app_server_protocol_error'];
  else if (result.malformedEvents) [outcome, failure_code] = ['protocol_invalid', 'malformed_native_event'];
  else if (result.exitCode !== 0) [outcome, failure_code] = ['provider_invalid', 'provider_nonzero'];
  else if (!result.sessionId) [outcome, failure_code] = ['protocol_invalid', 'session_identity_missing'];
  else if (expectedSession && result.sessionId !== expectedSession) [outcome, failure_code] = ['protocol_invalid', 'session_identity_mismatch'];
  return { outcome, failure_code, usage: { total_tokens: Number.isFinite(result.totalTokens) ? result.totalTokens : 'not_observable' } };
}
function productChange(event) { const item = event?.params?.item, actions = Array.isArray(item?.commandActions) ? item.commandActions : [], changes = Array.isArray(item?.changes) ? item.changes : Array.isArray(item?.files) ? item.files : [], command = actions.map(action => String(action?.command || '')).join('\n') || String(item?.command || ''), nativePatch = command.match(/^\s*\$([A-Za-z_]\w*)\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@\s*;\s*(?:\$\1\s*=\s*\$\1\.Trim\(\)\s*;\s*)?&\s*['"]([^'"\r\n]*[\\/]codex\.exe)['"]\s+--codex-run-as-apply-patch\s+\$\1\s*$/i), patchOutput = String(item?.aggregatedOutput || '').replaceAll('\r\n', '\n'), patchPaths = nativePatch ? [...nativePatch[2].matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(([, file]) => toPosix(file)) : [], reportedPaths = [...patchOutput.matchAll(/^[AMD] (.+)$/gm)].map(([, file]) => toPosix(file)), patchAccepted = /^Success\. Updated the following files:\n(?:[AMD] .+\n)+$/.test(patchOutput) && patchPaths.length === reportedPaths.length && patchPaths.every((file, index) => path.posix.normalize(file) === path.posix.normalize(reportedPaths[index])), paths = ['fileChange', 'file_change'].includes(item?.type) ? changes.flatMap(change => { const file = typeof change === 'string' ? change : typeof change?.path === 'string' ? change.path : typeof change?.file === 'string' ? change.file : null; return file?.trim() ? [toPosix(file)] : []; }) : event?.method === 'turn/diff/updated' ? [...String(event.params?.diff || '').matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].flatMap(([, before, after]) => [toPosix(before), toPosix(after)]) : event?.method === 'item/completed' && item?.type === 'commandExecution' && item.status === 'completed' && item.exitCode === 0 && item.source === 'unifiedExecStartup' && item.processId && nativePatch && path.win32.isAbsolute(nativePatch[3]) && patchAccepted ? patchPaths : []; return paths.some(file => { const normalized = path.posix.normalize(file); return normalized && !normalized.startsWith('.work/') && !normalized.startsWith('.agents/') && !normalized.startsWith('inputs/') && !['AGENTS.md', 'goal.md'].includes(normalized); }); }
function workspaceKey(value) { if (typeof value !== 'string' || !value.trim()) return null; const resolved = toPosix(path.resolve(value)); return process.platform === 'win32' ? resolved.replace(/\/AppData\/Local\/Packages\/OpenAI\.Codex_[^/]+\/LocalCache\/Local\//i, '/AppData/Local/').toLowerCase() : resolved; } function firstJson(value) { const source = String(value || '').trimStart(); let depth = 0, quoted = false, escaped = false; for (let index = 0; index < source.length; index++) { const character = source[index]; if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; } else if (character === '"') quoted = true; else if ('{['.includes(character)) depth++; else if ('}]'.includes(character) && --depth === 0) return JSON.parse(source.slice(0, index + 1)); } throw new Error('leading JSON object is incomplete'); }
const CHECKPOINT_FRONTMATTER_FIELDS = ['workflow', 'phase', 'timestamp', 'runtime'], CHECKPOINT_REQUIRED_SECTIONS = ['current_state', 'completed_work', 'remaining_work', 'decisions', 'blockers', 'next_action'], CHECKPOINT_JUDGMENT_SECTIONS = ['active_constraints', 'unresolved_uncertainty', 'decision_posture', 'anti_regression'], CHECKPOINT_NOTICE = '<!-- Historical pause checkpoint, not authority. On conflict, current Git, PLAN.md, SPEC.md, lifecycle artifacts, and current owner instructions outrank this file. -->'; function exactKeys(value, expected) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const keys = Object.keys(value); return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key)); } function checkpointBytes(checkpoint) { const frontmatter = checkpoint?.frontmatter, sections = checkpoint?.sections, judgment = checkpoint?.judgment; if (checkpoint?.path !== '.work/.continue-here.md' || checkpoint.status !== 'valid' || !Array.isArray(checkpoint.errors) || checkpoint.errors.length || !exactKeys(frontmatter, CHECKPOINT_FRONTMATTER_FIELDS) || !exactKeys(sections, CHECKPOINT_REQUIRED_SECTIONS) || !exactKeys(judgment, CHECKPOINT_JUDGMENT_SECTIONS) || !CHECKPOINT_FRONTMATTER_FIELDS.every(key => typeof frontmatter[key] === 'string' && frontmatter[key].trim()) || !CHECKPOINT_REQUIRED_SECTIONS.every(key => typeof sections[key] === 'string') || !CHECKPOINT_JUDGMENT_SECTIONS.every(key => typeof judgment[key] === 'string') || !['phase', 'quick', 'generic'].includes(frontmatter.workflow) || Number.isNaN(Date.parse(frontmatter.timestamp))) return null; return `---\n${CHECKPOINT_FRONTMATTER_FIELDS.map(key => `${key}: ${frontmatter[key].trim()}`).join('\n')}\n---\n\n${CHECKPOINT_NOTICE}\n\n${CHECKPOINT_REQUIRED_SECTIONS.map(key => `<${key}>\n${sections[key]}\n</${key}>`).join('\n\n')}\n\n<judgment>\n${CHECKPOINT_JUDGMENT_SECTIONS.map(key => `<${key}>\n${judgment[key]}\n</${key}>`).join('\n')}\n</judgment>\n`; } function continuityPacket(item, checkpointSha256) { try { const actions = Array.isArray(item?.commandActions) ? item.commandActions : [], checkpoint = firstJson(item?.aggregatedOutput).continuity?.checkpoint, reconstructed = checkpointBytes(checkpoint), nativeNext = actions.length === 1 && /^\s*(?:&\s*)?node(?:\.exe)?\s+['"]?\.work[\\/]bin[\\/]gsdd\.mjs['"]?\s+next\s+--json(?:\s*;|\s*$)/i.test(String(actions[0]?.command || '')); return item?.type === 'commandExecution' && item.status === 'completed' && item.exitCode === 0 && nativeNext && reconstructed && sha256(reconstructed) === checkpointSha256; } catch { return false; } }
export function findCheckpointWitness(rows, { consumerRoot, checkpointSha256 }) {
  const root = path.resolve(consumerRoot), rootKey = workspaceKey(root), candidates = [];
  let firstProductChange = Infinity;
  rows.forEach((row, eventIndex) => {
    const event = row?.parsed || row;
    const item = event?.params?.item;
    if (productChange(event)) firstProductChange = Math.min(firstProductChange, eventIndex);
    const itemKey = workspaceKey(item?.cwd);
    if (event?.method === 'item/completed' && itemKey && itemKey === rootKey && continuityPacket(item, checkpointSha256)) candidates.push({ ok: true, event_index: eventIndex, item_id: item.id || null, cwd: '<CONSUMER_ROOT>', command_sha256: sha256(String(item.command || '')), output_sha256: sha256(String(item.aggregatedOutput || '').replaceAll('\r\n', '\n')), checkpoint_sha256: checkpointSha256 });
    if (event?.method !== 'item/completed' || item?.type !== 'commandExecution'
      || item.status !== 'completed' || item.exitCode !== 0 || !itemKey || itemKey !== rootKey) return;
    const readActions = Array.isArray(item.commandActions) ? item.commandActions : [], readAction = readActions[0];
    if (readActions.length !== 1 || readAction?.type !== 'read' || workspaceKey(readAction.path) !== workspaceKey(path.join(root, '.work', '.continue-here.md')) || !/^(?:type\s+|Get-Content\s+(?:-Raw\s+)?(?:-LiteralPath\s+)?)["']?\.work[\\/]\.continue-here\.md["']?\s*$/i.test(String(readAction.command || '').trim())) return;
    const outputSha = sha256(String(item.aggregatedOutput || '').replaceAll('\r\n', '\n'));
    if (outputSha !== checkpointSha256) return;
    candidates.push({ ok: true, event_index: eventIndex, item_id: item.id || null,
      cwd: '<CONSUMER_ROOT>', command_sha256: sha256(String(item.command || '')),
      output_sha256: outputSha, checkpoint_sha256: checkpointSha256 });
  });
  const valid = candidates.filter(candidate => candidate.event_index < firstProductChange);
  if (!Number.isFinite(firstProductChange)) return { ok: false, reason: 'product_change_event_not_observed' };
  return valid.length === 1 ? { ...valid[0], product_change_event_index: firstProductChange }
    : { ok: false, reason: valid.length ? 'ambiguous_checkpoint_read' : 'checkpoint_read_not_proven' };
}
export function findNetworkViolation(rows) {
  for (let event_index = 0; event_index < rows.length; event_index++) {
    const event = rows[event_index]?.parsed || rows[event_index], item = event?.params?.item || event?.item;
    const kind = String(item?.type || item?.kind || event?.item_type || event?.item_kind || '').replace(/[_-]/g, '').toLowerCase();
    if (kind === 'websearch') return { event_index, item_id: item?.id || event?.item_id || null, item_kind: kind };
  }
  return null;
}
export function buildCodexCommand() {
  const command = resolveDirectCommand('codex', ['-c', 'windows.sandbox="elevated"', '--disable', 'apps', '--disable', 'plugins', 'app-server', '--stdio']);
  if (!fs.existsSync(command.executable)) throw new EvalError('environment_invalid', 'Codex CLI executable is missing');
  return command;
}
async function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') return void spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, timeout: 15_000 });
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
}
function within(promise, timeoutMs) {
  return new Promise(resolve => { const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }); });
}
export async function closeCodexChild(child, closed, { force = false, closeGraceMs = 15_000, killGraceMs = 5_000 } = {}) {
  child.stdin?.end();
  if (force) await killTree(child.pid);
  let exit = await within(closed, force ? killGraceMs : closeGraceMs), closeTimedOut = false;
  if (!exit) { closeTimedOut = true; await killTree(child.pid); exit = await within(closed, killGraceMs); }
  if (!exit) { for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy(); child.unref(); }
  return { ...(exit || { exitCode: null, signal: null }), closeTimedOut };
}
export class CodexTransport {
  constructor({ model = 'gpt-5.6-luna', effort = 'high', env = process.env, maxOutputBytes = 64 * 1024 * 1024 } = {}) {
    Object.assign(this, { model, effort, env, maxOutputBytes });
  }
  async runTurn({ id, cwd, prompt, sessionId = null, runRoot, hardTimeoutMs }) {
    const eventsFile = path.join(runRoot, 'events', `${id}.jsonl`), stderrFile = path.join(runRoot, 'events', `${id}.stderr.log`);
    mkdirp(path.dirname(eventsFile));
    fs.writeFileSync(eventsFile, '', { flag: 'wx' });
    fs.writeFileSync(stderrFile, '', { flag: 'wx' });
    const command = buildCodexCommand();
    const child = spawn(command.executable, command.args, {
      cwd, env: this.env, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    let buffer = '', stdoutBytes = 0, stderrBytes = 0, malformedEvents = 0, eventCount = 0;
    const sandboxScan = { tail: '', found: false };
    let threadId = sessionId, turnId = null, totalTokens = null, timedOut = false, outputExcess = false, spawnError = null, protocolError = null, networkViolation = null;
    let nextId = 1, complete, fail;
    const completion = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    const pending = new Map();
    const parsedEvents = [];
    const record = line => {
      if (!line.trim()) return;
      eventCount++;
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { malformedEvents++; }
      const envelope = { at: new Date().toISOString(), raw: line, parsed };
      fs.appendFileSync(eventsFile, `${JSON.stringify(envelope)}\n`);
      if (!parsed) return;
      parsedEvents.push(parsed);
      const violation = findNetworkViolation([parsed]);
      if (violation && !networkViolation) networkViolation = { ...violation, event_index: parsedEvents.length - 1 };
      if (parsed.id != null && pending.has(parsed.id)) {
        const request = pending.get(parsed.id); pending.delete(parsed.id);
        parsed.error ? request.reject(new EvalError('protocol_invalid', parsed.error.message || 'Codex request failed')) : request.resolve(parsed.result);
      }
      const params = parsed.params || {};
      threadId ||= params.threadId || params.thread?.id || null;
      if (parsed.method === 'turn/started') turnId ||= params.turn?.id || params.turnId || null;
      if (parsed.method === 'turn/completed') {
        turnId ||= params.turn?.id || params.turnId || null;
        const usage = params.turn?.usage || params.usage || {};
        if (Number.isFinite(usage.total_tokens)) totalTokens = usage.total_tokens;
        else if (Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) totalTokens = usage.input_tokens + usage.output_tokens;
        complete();
      }
      if (parsed.method === 'turn/failed') fail(new EvalError('provider_invalid', params.error?.message || 'Codex turn failed'));
    };
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > this.maxOutputBytes) { outputExcess = true; fail(new EvalError('provider_invalid', 'Codex output exceeded cap')); void killTree(child.pid); return; }
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) { const index = buffer.indexOf('\n'); record(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; scanWindowsSandboxRefusal(sandboxScan, chunk.toString('utf8')); fs.appendFileSync(stderrFile, chunk); });
    child.on('error', error => { spawnError = { code: error.code || null, message: error.message }; fail(error); });
    const request = (method, params) => new Promise((resolve, reject) => {
      const requestId = nextId++; pending.set(requestId, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    });
    const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    const closed = new Promise(resolve => child.once('close', (exitCode, signal) => {
      fail(new EvalError('provider_invalid', 'Codex app-server exited before turn completion')); resolve({ exitCode, signal });
    }));
    const timer = setTimeout(() => { timedOut = true; fail(new EvalError('provider_invalid', 'Codex turn timed out')); void killTree(child.pid); }, hardTimeoutMs);
    let exit = { exitCode: null, signal: null };
    try {
      await request('initialize', { clientInfo: { name: 'workspine-native-brownfield', version: '1' }, capabilities: { experimentalApi: true } });
      notify('initialized', {});
      const threadParams = { model: this.model, cwd: path.resolve(cwd), approvalPolicy: 'never', sandbox: 'workspace-write', runtimeWorkspaceRoots: [path.resolve(cwd)] };
      const thread = await request(sessionId ? 'thread/resume' : 'thread/start', sessionId ? { threadId: sessionId, ...threadParams } : threadParams);
      threadId = thread?.thread?.id || thread?.thread?.sessionId || threadId;
      const started = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt }], cwd: path.resolve(cwd), approvalPolicy: 'never', sandboxPolicy: codexTurnPolicy(cwd), model: this.model, effort: this.effort });
      turnId = started?.turn?.id || turnId;
      await completion;
    } catch (error) {
      if (error instanceof EvalError) protocolError = { code: error.code, message: error.message };
      else if (!spawnError) spawnError = { code: error.code || null, message: error.message };
    } finally {
      exit = await closeCodexChild(child, closed, { force: timedOut || outputExcess || Boolean(spawnError || protocolError) });
      clearTimeout(timer);
      if (buffer.trim()) record(buffer);
    }
    const base = { pid: child.pid, ...exit, timedOut, outputExcess, spawnError, protocolError, networkViolation, sandboxEnvironmentFailure: sandboxScan.found, stdoutBytes, stderrBytes, malformedEvents, eventCount, sessionId: threadId, turnId, totalTokens };
    return { id, ...base, ...classifyProviderResult(base, sessionId), eventsFile, stderrFile, events: parsedEvents };
  }
}
