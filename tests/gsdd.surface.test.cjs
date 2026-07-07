const { spawnSync } = require('node:child_process');
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BANNED_TERMS = [
  'delivery spine',
  'workflow spine',
  'control plane',
  'control layer',
  'orchestration layer',
  'evidence-gated',
  'provenance-aware',
  'bounded block',
  'authority router',
  'assurance ladder',
  'evidence contract',
  'directly validated',
];
const RETIRED_HELP_COMMANDS = [
  'session-fingerprint',
  'ui-proof',
  'control-map',
  'closeout-report',
];
const RETIRED_PUBLIC_DOC_COMMANDS = [
  'session-fingerprint',
  'control-map',
  'closeout-report',
];
const RETIRED_SOURCE_HELPER_PATTERNS = [
  /node \.planning\/bin\/gsdd\.mjs/i,
  /\.planning\/bin/i,
  /\bsession-fingerprint\b/i,
  /\bDirectly validated\b/i,
];
const LEGACY_STATE_MENTION_PATTERN = /\b(legacy|older|retained|old workspace|old workspaces)\b/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const bannedPattern = new RegExp(BANNED_TERMS.map(escapeRegExp).join('|'), 'i');

function runHelp() {
  const result = spawnSync(process.execPath, ['bin/gsdd.mjs', 'help'], {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

function publicDocFiles() {
  return [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'distilled', 'README.md'),
    path.join(ROOT, 'distilled', 'SKILL.md'),
    ...listFiles(path.join(ROOT, 'docs')),
  ];
}

function markdownFiles(dir) {
  return listFiles(dir).filter((file) => file.endsWith('.md'));
}

function generatedSourceFiles() {
  const agentSources = markdownFiles(path.join(ROOT, 'agents'))
    .filter((file) => !path.relative(path.join(ROOT, 'agents'), file).replace(/\\/g, '/').startsWith('_archive/'));
  return [
    ...agentSources,
    ...markdownFiles(path.join(ROOT, 'distilled', 'workflows')),
    ...markdownFiles(path.join(ROOT, 'distilled', 'templates')),
    path.join(ROOT, 'bin', 'lib', 'init-runtime.mjs'),
  ];
}

describe('public surface language gate', () => {
  test('help output has no banned terms or legacy state folder mentions', () => {
    const help = runHelp();
    assert.doesNotMatch(help, bannedPattern);
    assert.doesNotMatch(help, /\.planning/);
  });

  test('public docs have no banned terms and only legacy-labeled .planning mentions', () => {
    for (const file of publicDocFiles()) {
      const relativePath = path.relative(ROOT, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf-8');
      assert.doesNotMatch(content, bannedPattern, `${relativePath} contains a banned public-surface term`);
      for (const command of RETIRED_PUBLIC_DOC_COMMANDS) {
        assert.doesNotMatch(
          content,
          new RegExp(escapeRegExp(command), 'i'),
          `${relativePath} documents retired helper command ${command}`
        );
      }

      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes('.planning')) return;
        assert.match(
          line,
          /legacy/i,
          `${relativePath}:${index + 1} mentions .planning without labeling it legacy`
        );
      });
    }
  });

  test('help output does not expose retired helper commands', () => {
    const help = runHelp();
    for (const command of RETIRED_HELP_COMMANDS) {
      assert.doesNotMatch(help, new RegExp(escapeRegExp(command), 'i'));
    }
  });

  test('consumer source surfaces do not carry retired helper paths or proof overclaims', () => {
    for (const file of generatedSourceFiles()) {
      const relativePath = path.relative(ROOT, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of RETIRED_SOURCE_HELPER_PATTERNS) {
        assert.doesNotMatch(
          content,
          pattern,
          `${relativePath} carries retired helper path, retired helper command, or proof overclaim`
        );
      }
    }
  });

  test('consumer source surfaces do not use .planning as the default state path', () => {
    for (const file of generatedSourceFiles()) {
      const relativePath = path.relative(ROOT, file).replace(/\\/g, '/');
      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes('.planning')) return;
        assert.match(
          line,
          LEGACY_STATE_MENTION_PATTERN,
          `${relativePath}:${index + 1} mentions .planning without framing it as legacy support`
        );
      });
    }
  });
});
