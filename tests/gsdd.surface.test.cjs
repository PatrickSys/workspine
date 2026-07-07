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
];
const RETIRED_HELP_COMMANDS = [
  'session-fingerprint',
  'ui-proof',
  'control-map',
  'closeout-report',
];

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
    ...listFiles(path.join(ROOT, 'docs')),
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
});
