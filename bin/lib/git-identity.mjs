import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const PLACEHOLDER_NAME = 'test user';
const EXAMPLE_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);
const GIT_READ_COMMANDS = new Set(['rev-parse', 'config', 'var']);

function runGit(args, { cwd, exec = execFileSync } = {}) {
  if (!GIT_READ_COMMANDS.has(args[0])) throw new Error(`Unsupported Git inspection command: ${args[0]}`);
  try {
    return exec('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    throw new Error(stderr || `Git inspection failed: git ${args.join(' ')}`);
  }
}

function parseConfiguredValue(raw) {
  const parts = raw.match(/^(\S+)\s+(\S+)\t([\s\S]*)$/);
  if (!parts) return { value: raw.trim(), scope: null, origin: null };
  return { scope: parts[1], origin: parts[2], value: parts[3] };
}

function readConfiguredValue(key, options) {
  try {
    return parseConfiguredValue(runGit(['config', '--show-origin', '--show-scope', '--get', key], options));
  } catch {
    return { value: '', scope: null, origin: null };
  }
}

function parseIdentity(raw) {
  const match = raw.trim().match(/^(.+)\s+<([^<>]+)>\s+\d+\s+[+-]\d{4}$/);
  if (!match) return { name: null, email: null, raw: raw.trim() };
  return { name: match[1], email: match[2], raw: raw.trim() };
}

function isPlaceholder({ name, email }) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const domain = normalizedEmail.split('@').at(-1);
  return normalizedName === PLACEHOLDER_NAME || EXAMPLE_DOMAINS.has(domain);
}

function isUnusual({ name, email }) {
  return /\b(bot|ci)\b/i.test(`${name || ''} ${email || ''}`);
}

function sameIdentity(left, right) {
  return left.name === right.name && left.email === right.email;
}

function fingerprintFor(report) {
  const stable = {
    repository: report.repository,
    config: report.config,
    author: { name: report.author.name, email: report.author.email },
    committer: { name: report.committer.name, email: report.committer.email },
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function classify(report) {
  const values = [report.config.name.value, report.config.email.value, report.author.name, report.author.email, report.committer.name, report.committer.email];
  if (values.some((value) => !String(value || '').trim())) return 'missing';
  if (isPlaceholder({ name: report.config.name.value, email: report.config.email.value })) return 'placeholder';
  const effective = { name: report.config.name.value, email: report.config.email.value };
  if (!sameIdentity(report.author, effective) || !sameIdentity(report.committer, effective)) return 'mismatch';
  if (isUnusual(effective)) return 'unusual';
  return 'valid';
}

function inspectGitIdentity({ cwd = process.cwd(), exec } = {}) {
  const worktree = runGit(['rev-parse', '--show-toplevel'], { cwd, exec });
  const commonDir = resolve(worktree, runGit(['rev-parse', '--git-common-dir'], { cwd: worktree, exec }));
  const config = {
    name: readConfiguredValue('user.name', { cwd: worktree, exec }),
    email: readConfiguredValue('user.email', { cwd: worktree, exec }),
  };
  const report = {
    repository: { worktree, commonDir },
    config,
    author: parseIdentity(runGit(['var', 'GIT_AUTHOR_IDENT'], { cwd: worktree, exec })),
    committer: parseIdentity(runGit(['var', 'GIT_COMMITTER_IDENT'], { cwd: worktree, exec })),
  };
  report.identity = { classification: classify(report) };
  report.fingerprint = fingerprintFor(report);
  return report;
}

function parseCheckArgs(args) {
  let expect = null;
  let confirm = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if ((flag !== '--expect' && flag !== '--confirm') || index + 1 >= args.length) return { error: 'Usage: git-identity check [--expect <fingerprint>] [--confirm <fingerprint>]' };
    const value = args[++index];
    if (!value || (flag === '--expect' ? expect !== null : confirm !== null)) return { error: 'Usage: git-identity check [--expect <fingerprint>] [--confirm <fingerprint>]' };
    if (flag === '--expect') expect = value;
    else confirm = value;
  }
  return { expect, confirm };
}

function createCmdGitIdentity(context = {}) {
  return (...args) => {
    if (args.shift() !== 'check') {
      console.error('Usage: git-identity check [--expect <fingerprint>] [--confirm <fingerprint>]');
      process.exitCode = 1;
      return;
    }
    const parsed = parseCheckArgs(args);
    if (parsed.error) {
      console.error(parsed.error);
      process.exitCode = 1;
      return;
    }
    let report;
    try {
      report = inspectGitIdentity({ cwd: context.cwd || process.cwd(), exec: context.exec });
    } catch (error) {
      console.error(`Git identity inspection refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (parsed.expect && parsed.expect !== report.fingerprint) report.identity.classification = 'drifted';
    if (parsed.confirm && parsed.confirm !== report.fingerprint) report.identity.classification = 'confirmation_mismatch';
    if (report.identity.classification === 'unusual' && !parsed.confirm) report.identity.classification = 'confirmation_required';
    report.status = report.identity.classification === 'valid' || report.identity.classification === 'unusual' ? 'ok' : 'refused';
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'ok') process.exitCode = 1;
  };
}

export { createCmdGitIdentity, inspectGitIdentity, parseCheckArgs };
