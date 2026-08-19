import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { relative, resolve, join } from 'path';
import { resolveWorkspaceContext } from './workspace-root.mjs';
import { assertStateAuthority } from './state-dir.mjs';
import { createAtomicFileWriter, writeFileAtomic } from './atomic-write.mjs';

export const UPDATE_ENDPOINT = 'https://registry.npmjs.org/workspine/latest';
export const CACHE_SCHEMA = 1;
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RESPONSE_MAX_BYTES = 64 * 1024;
export const REQUEST_TIMEOUT_MS = 2000;
export const NOTICE_TEXT = 'Update available: workspine {latestVersion} (current {packageVersion}). Run `npx -y workspine update` to repair/refresh generated surfaces.';

// The check caches its result in `.work/.local`, so it is a workspace write.
// Only commands that already mutate the workspace may carry it. Every command
// the CLI documents as read-only stays byte-neutral: no fetch, no cache file,
// and no `.local` directory created as a side effect of reading.
export const PUBLIC_COMMAND_POLICY = Object.freeze({
  init: 'silent', install: 'silent', health: 'silent', update: 'silent', help: 'silent',
  models: 'silent', rigor: 'silent', 'file-op': 'silent', 'lifecycle-preflight': 'silent',
  next: 'silent', verify: 'silent', 'find-phase': 'silent', journey: 'silent',
  decisions: 'silent', 'git-identity': 'silent',
  'phase-status': 'eligible', scaffold: 'eligible', remember: 'eligible',
});

export const GENERATED_HELPER_COMMAND_POLICY = Object.freeze({
  'control-map': 'silent', decisions: 'silent', 'file-op': 'silent', 'git-identity': 'silent',
  'lifecycle-preflight': 'silent', next: 'silent', verify: 'silent',
  'phase-status': 'eligible', remember: 'eligible',
});

const CACHE_KEYS = new Set(['schema', 'checkedAt', 'status', 'latestVersion', 'error']);
const ERROR_CODES = new Set(['timeout', 'network', 'http', 'invalid', 'oversize', 'cache_write']);

function isContained(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith('..') && !/^[A-Za-z]:/.test(rel);
}

function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value ?? ''));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left) || [0, 0, 0];
  const b = parseVersion(right) || [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function validCache(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== CACHE_KEYS.size || keys.some((key) => !CACHE_KEYS.has(key))) return false;
  const checkedAt = Date.parse(value.checkedAt);
  if (value.schema !== CACHE_SCHEMA || typeof value.checkedAt !== 'string' || Number.isNaN(checkedAt)) return false;
  if (new Date(checkedAt).toISOString() !== value.checkedAt) return false;
  if (!['available', 'unavailable'].includes(value.status)) return false;
  if (value.status === 'available' && (typeof value.latestVersion !== 'string' || !parseVersion(value.latestVersion) || value.error !== null)) return false;
  if (value.status === 'unavailable' && (value.latestVersion !== null || !ERROR_CODES.has(value.error))) return false;
  return true;
}

function cacheIsFresh(cache, now) {
  return validCache(cache) && now - Date.parse(cache.checkedAt) >= 0 && now - Date.parse(cache.checkedAt) < CACHE_MAX_AGE_MS;
}

function cacheRecord(now, status, latestVersion, error = null) {
  return { schema: CACHE_SCHEMA, checkedAt: new Date(now).toISOString(), status, latestVersion, error };
}

function cachePaths(planningDir, atomic) {
  if (!planningDir) return null;
  let planningStat;
  try { planningStat = (atomic.lstatSync || lstatSync)(planningDir); } catch { return null; }
  if (!planningStat.isDirectory() || planningStat.isSymbolicLink()) return null;
  const localDir = resolve(planningDir, '.local');
  const cachePath = join(localDir, 'update-awareness.json');
  if (!isContained(planningDir, localDir) || !isContained(planningDir, cachePath)) return null;
  let localStat;
  try { localStat = (atomic.lstatSync || lstatSync)(localDir); }
  catch (error) {
    if (error?.code !== 'ENOENT') return null;
    try { (atomic.mkdirSync || mkdirSync)(localDir, { recursive: true }); localStat = (atomic.lstatSync || lstatSync)(localDir); }
    catch { return null; }
  }
  if (!localStat?.isDirectory() || localStat.isSymbolicLink()) return null;
  try {
    const cacheStat = (atomic.lstatSync || lstatSync)(cachePath);
    if (cacheStat.isSymbolicLink() || !cacheStat.isFile()) return null;
    if (!isContained(planningDir, realpathSync(cachePath))) return null;
  } catch (error) {
    if (error?.code !== 'ENOENT') return null;
  }
  try {
    if (!isContained(realpathSync(planningDir), realpathSync(localDir))) return null;
  } catch { return null; }
  return { localDir, cachePath };
}

function readCache(cachePath, atomic) {
  try {
    const parsed = JSON.parse((atomic.readFileSync || readFileSync)(cachePath, 'utf8'));
    return validCache(parsed) ? parsed : null;
  } catch { return null; }
}

function monotonicNow() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function raceUntil(operation, deadline, clock = monotonicNow, onTimeout = null) {
  const remaining = deadline - clock();
  if (remaining <= 0) {
    try { onTimeout?.(); } catch { /* best effort */ }
    return Promise.resolve({ kind: 'timeout' });
  }
  let timer;
  let settled = false;
  const guarded = Promise.resolve().then(operation).then(
    (value) => ({ kind: 'value', value }),
    (error) => ({ kind: 'error', error }),
  );
  return new Promise((resolve) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { onTimeout?.(); } catch { /* best effort */ }
      resolve({ kind: 'timeout' });
    }, Math.max(0, remaining));
    guarded.then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function cancelBody(response, reader, deadline, clock = monotonicNow) {
  const cancel = reader?.cancel || response?.body?.cancel || reader?.return;
  if (typeof cancel !== 'function') return;
  let pending;
  try { pending = cancel.call(reader || response.body); } catch { return; }
  Promise.resolve(pending).catch(() => {});
  if (deadline - clock() <= 0) return;
  await raceUntil(() => pending, deadline, clock);
}

async function readBoundedBody(response, deadline, clock = monotonicNow) {
  const reader = response?.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const raced = await raceUntil(() => reader.read(), deadline, clock);
        if (raced.kind === 'timeout') {
          await cancelBody(response, reader, deadline, clock);
          return { bytes: null, error: 'timeout' };
        }
        if (raced.kind === 'error') throw raced.error;
        const part = raced.value;
        if (part.done) return { bytes: Buffer.concat(chunks, total), error: null };
        const value = part.value || [];
        const size = typeof value === 'string' ? Buffer.byteLength(value) : (value.byteLength ?? value.length ?? 0);
        if (size > RESPONSE_MAX_BYTES || total + size > RESPONSE_MAX_BYTES) {
          await cancelBody(response, reader, deadline, clock);
          return { bytes: null, error: 'oversize' };
        }
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        total += chunk.length;
      }
    } catch (error) {
      await cancelBody(response, reader, deadline, clock);
      throw error;
    }
  }
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    while (true) {
      const raced = await raceUntil(() => iterator.next(), deadline, clock);
      if (raced.kind === 'timeout') {
        await cancelBody(response, iterator, deadline, clock);
        return { bytes: null, error: 'timeout' };
      }
      if (raced.kind === 'error') {
        await cancelBody(response, iterator, deadline, clock);
        throw raced.error;
      }
      const step = raced.value;
      if (step.done) return { bytes: Buffer.concat(chunks, total), error: null };
      const part = step.value;
      const value = part || [];
      const size = typeof value === 'string' ? Buffer.byteLength(value) : (value.byteLength ?? value.length ?? 0);
      if (size > RESPONSE_MAX_BYTES || total + size > RESPONSE_MAX_BYTES) {
        await cancelBody(response, iterator, deadline, clock);
        return { bytes: null, error: 'oversize' };
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.length;
    }
  }
  return { bytes: null, error: 'invalid' };
}

async function fetchMetadata(fetchImpl) {
  if (typeof fetchImpl !== 'function') return { status: 'unavailable', latestVersion: null, error: 'network' };
  const controller = new AbortController();
  const clock = monotonicNow;
  const deadline = clock() + REQUEST_TIMEOUT_MS;
  try {
    const fetched = await raceUntil(() => fetchImpl(UPDATE_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      credentials: 'omit',
      signal: controller.signal,
    }), deadline, clock, () => controller.abort());
    if (fetched.kind === 'timeout') return { status: 'unavailable', latestVersion: null, error: 'timeout' };
    if (fetched.kind === 'error') throw fetched.error;
    const response = fetched.value;
    if (clock() >= deadline) return { status: 'unavailable', latestVersion: null, error: 'timeout' };
    if (!response || response.url !== UPDATE_ENDPOINT) return { status: 'unavailable', latestVersion: null, error: 'invalid' };
    if (response.status < 200 || response.status >= 300) return { status: 'unavailable', latestVersion: null, error: 'http' };
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_MAX_BYTES) {
      await cancelBody(response, null, deadline, clock);
      return { status: 'unavailable', latestVersion: null, error: 'oversize' };
    }
    const body = await readBoundedBody(response, deadline, clock);
    if (!body.bytes) return { status: 'unavailable', latestVersion: null, error: body.error || 'invalid' };
    const bytes = body.bytes;
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { return { status: 'unavailable', latestVersion: null, error: 'invalid' }; }
    const version = typeof parsed?.version === 'string' ? parseVersion(parsed.version) : null;
    return version ? { status: 'available', latestVersion: version.join('.'), error: null } : { status: 'unavailable', latestVersion: null, error: 'invalid' };
  } catch (error) {
    return { status: 'unavailable', latestVersion: null, error: error?.name === 'AbortError' || clock() >= deadline ? 'timeout' : 'network' };
  }
}

export function stripUpdateNoticeFlag(args = []) { return args.filter((arg) => arg !== '--no-update-notice'); }

export function isCheckerEligible(command, source = 'public-cli') {
  const policy = source === 'generated-helper' ? GENERATED_HELPER_COMMAND_POLICY : PUBLIC_COMMAND_POLICY;
  return policy[command] === 'eligible';
}

function resolveWriter(atomic) {
  if (typeof atomic.writeFileAtomic === 'function') return atomic.writeFileAtomic;
  if (atomic.operations || atomic.createTempPath) return createAtomicFileWriter({ operations: atomic.operations, createTempPath: atomic.createTempPath });
  return writeFileAtomic;
}

export async function maybeShowUpdateNotice({ cwd = process.cwd(), command, args = [], packageVersion, source = 'public-cli', fetchImpl = globalThis.fetch, now = () => new Date(), output = () => {}, env = process.env, atomic = {} } = {}) {
  const forwardedArgs = stripUpdateNoticeFlag(args);
  if (!isCheckerEligible(command, source) || env.GSDD_UPDATE_AWARENESS === '0' || args.includes('--no-update-notice')) return { args: forwardedArgs, checked: false };
  let context;
  try { context = resolveWorkspaceContext(args, { cwd, env }); } catch { return { args: forwardedArgs, checked: false }; }
  if (context.invalid) return { args: forwardedArgs, checked: false };
  try { assertStateAuthority(context.state); } catch { return { args: forwardedArgs, checked: false }; }
  const paths = cachePaths(context.planningDir, atomic);
  if (!paths) return { args: forwardedArgs, checked: false };
  const currentTime = new Date(now()).getTime();
  const previous = readCache(paths.cachePath, atomic);
  if (cacheIsFresh(previous, currentTime)) return { args: forwardedArgs, checked: false, cache: previous };
  const result = await fetchMetadata(fetchImpl);
  const record = cacheRecord(currentTime, result.status, result.latestVersion, result.error);
  try { resolveWriter(atomic)(paths.cachePath, `${JSON.stringify(record)}\n`); } catch { /* cache failure is deliberately nonblocking and retriable */ }
  if (result.status === 'available' && compareVersions(result.latestVersion, packageVersion) > 0) output(NOTICE_TEXT.replace('{latestVersion}', result.latestVersion).replace('{packageVersion}', packageVersion));
  return { args: forwardedArgs, checked: true, cache: record };
}
