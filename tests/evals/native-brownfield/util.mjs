import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
export class EvalError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'EvalError'; this.code = code; this.details = details;
  }
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortValue(value[key])]));
}
export const canonicalStringify = value => JSON.stringify(sortValue(value));
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const fileSha256 = file => sha256(fs.readFileSync(file));
export const mkdirp = dir => fs.mkdirSync(dir, { recursive: true });
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const toPosix = value => String(value).replaceAll('\\', '/');
export function resolveDirectCommand(executable, args) {
  if (process.platform !== 'win32') return { executable, args };
  const nodeRoot = path.dirname(process.execPath);
  if (executable === 'npm') return { executable: process.execPath, args: [path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args] };
  if (executable === 'codex') return { executable: process.execPath, args: [path.join(nodeRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), ...args] };
  return { executable, args };
}
export function writeExclusiveJson(file, value) {
  mkdirp(path.dirname(file));
  let handle;
  try {
    handle = fs.openSync(file, 'wx');
    fs.writeFileSync(handle, `${canonicalStringify(value)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } catch (error) {
    if (error.code === 'EEXIST') throw new EvalError('receipt_exists', `receipt already exists: ${file}`);
    throw error;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}
export function command(executable, args, options = {}) {
  const resolved = resolveDirectCommand(executable, args.map(String));
  const result = spawnSync(resolved.executable, resolved.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    input: options.input ?? null,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeoutMs || 120_000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
  });
  if (result.error?.code === 'ETIMEDOUT') throw new EvalError('environment_invalid', `${executable} timed out`, { args });
  if (result.error) throw new EvalError('environment_invalid', result.error.message, { args });
  if (result.status !== 0 && !options.allowFailure) {
    throw new EvalError('environment_invalid', `${executable} exited ${result.status}`, {
      args,
      stdout: String(result.stdout || '').slice(-4000),
      stderr: String(result.stderr || '').slice(-4000),
    });
  }
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}
export function treeManifest(root, ignore = () => false) {
  const rows = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      const relative = toPosix(path.relative(root, file));
      if (ignore(relative, entry)) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) rows.push({ path: relative, bytes: fs.statSync(file).size, sha256: fileSha256(file) });
      else if (entry.isSymbolicLink()) rows.push({ path: relative, link: fs.readlinkSync(file) });
    }
  };
  walk(root);
  return { files: rows, sha256: sha256(canonicalStringify(rows)) };
}
