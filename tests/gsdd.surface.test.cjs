const { spawnSync } = require('node:child_process');
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));
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
const RETIRED_CURRENT_EVIDENCE_PATHS = [
  'bin/lib/models.mjs',
  'bin/lib/provenance.mjs',
  'bin/lib/session-fingerprint.mjs',
  'bin/lib/evidence-contract.mjs',
  'bin/lib/closeout-report.mjs',
  'tests/session-fingerprint.test.cjs',
  'tests/gsdd.control-map.test.cjs',
  'tests/gsdd.closeout-report.test.cjs',
];
const RETIRED_CURRENT_COMMAND_PATTERNS = [
  /`gsdd control-map(?:\s|`)/i,
  /`gsdd closeout-report(?:\s|`)/i,
];
const REQUIRED_CURRENT_EVIDENCE_PATHS = [
  'bin/lib/config.mjs',
  'bin/lib/rendering.mjs',
  'bin/lib/control-map.mjs',
  'bin/lib/candidate-provenance.mjs',
  'tests/gsdd.models.test.cjs',
  'tests/gsdd.init.test.cjs',
  'tests/gsdd.surface.test.cjs',
  'tests/phase.test.cjs',
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

async function loadRenderer() {
  const rendererPath = path.join(ROOT, 'bin', 'lib', 'rendering.mjs');
  return import(`${pathToFileURL(rendererPath).href}?surface=${Date.now()}`);
}

function initializeFreshFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-surface-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'bin', 'gsdd.mjs'),
      'init',
      '--auto',
      '--tools',
      'agents',
    ], {
      cwd: fixtureRoot,
      encoding: 'utf-8',
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    return fixtureRoot;
  } catch (error) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
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

  test('design records legacy planning helpers as historical rather than current command authority', () => {
    const design = fs.readFileSync(path.join(ROOT, 'distilled', 'DESIGN.md'), 'utf-8');
    const decisionHeadings = [
      'D51 - Deterministic Runtime Surface Freshness',
      'D58 - Local Workflow Helper Launcher',
      'D64 - Work-Native Continuity Authority',
    ];

    for (const heading of decisionHeadings) {
      const sectionStart = design.indexOf(`## ${heading}`);
      assert.notStrictEqual(sectionStart, -1, `DESIGN must retain ${heading}`);
      const nextSection = design.indexOf('\n## ', sectionStart + heading.length);
      const section = design.slice(sectionStart, nextSection === -1 ? undefined : nextSection);
      const disposition = section.match(/\*\*Current disposition \(2026-08-12\):\*\*([^\n]+)/);

      assert.ok(disposition, `${heading} must contain an explicit current disposition`);
      assert.match(
        disposition[1],
        /\.work\/bin\/gsdd\.mjs.*sole active lifecycle and helper root/i,
        `${heading} must name .work/bin/gsdd.mjs as the sole active lifecycle and helper root`
      );
      assert.match(
        disposition[1],
        /\.planning\/.*(?:legacy|migration|diagnostic)|(?:legacy|migration|diagnostic).*\.planning\//i,
        `${heading} must limit .planning to legacy migration or diagnostic handling`
      );
      assert.match(
        disposition[1],
        /(?:blocks mutation|never .*write|neither select nor write)/i,
        `${heading} must rule out .planning as a current lifecycle write authority`
      );
    }
  });

  test('documents the main and generated helper command boundary from fresh render output', async () => {
    const mainSource = fs.readFileSync(path.join(ROOT, 'bin', 'gsdd.mjs'), 'utf-8');
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf-8');
    const design = fs.readFileSync(path.join(ROOT, 'distilled', 'DESIGN.md'), 'utf-8');
    const evidence = fs.readFileSync(path.join(ROOT, 'distilled', 'EVIDENCE-INDEX.md'), 'utf-8');
    const { renderPlanningCliLauncher } = await loadRenderer();
    const fixtureRoot = initializeFreshFixture();

    try {
      const helper = fs.readFileSync(path.join(fixtureRoot, '.work', 'bin', 'gsdd.mjs'), 'utf-8');
      assert.strictEqual(helper, renderPlanningCliLauncher({ packageName: PACKAGE.name, packageVersion: PACKAGE.version }), 'fresh init must use the versioned renderer output');
      assert.doesNotMatch(mainSource, /['"]control-map['"]\s*:/, 'main package CLI must not register control-map');
      assert.match(helper, /['"]control-map['"]\s*:/, 'generated helper must retain read-only control-map');
      assert.doesNotMatch(helper, /\bannotate\b|\bcloseout-report\b/i, 'generated helper must not expose retired mutation or report commands');
      assert.match(readme, /generated internal workflow plumbing, not a second public package CLI/i);
      assert.match(design, /Current disposition.*generated.*helper.*read-only control-map/is);
      assert.match(evidence, /Current disposition.*generated.*helper.*read-only control-map/is);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('renderer callers bind generated helpers to package metadata and helper policy strips only its flag', async () => {
    const runtimeFreshness = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'runtime-freshness.mjs'), 'utf8');
    const initFlow = fs.readFileSync(path.join(ROOT, 'bin', 'lib', 'init-flow.mjs'), 'utf8');
    assert.match(runtimeFreshness, /packageName:\s*PACKAGE_JSON\.name/);
    assert.match(runtimeFreshness, /packageVersion:\s*PACKAGE_JSON\.version/);
    assert.match(initFlow, /packageName,\s*packageVersion/);
    const updateAwareness = await import(`${pathToFileURL(path.join(ROOT, 'bin', 'lib', 'update-awareness.mjs')).href}?surface-policy=${Date.now()}`);
    assert.deepStrictEqual(updateAwareness.stripUpdateNoticeFlag(['--json', '--no-update-notice', '1', '--no-update-notice']), ['--json', '1']);
    const launcher = (await loadRenderer()).renderPlanningCliLauncher({ packageName: PACKAGE.name, packageVersion: PACKAGE.version });
    assert.match(launcher, /const PACKAGE_VERSION = "0\.32\.0";/);
    assert.doesNotMatch(launcher, /const PACKAGE_VERSION = '0\.32\.0';/);
    for (const command of ['control-map', 'decisions', 'file-op', 'git-identity', 'lifecycle-preflight', 'phase-status', 'remember', 'verify', 'next']) {
      assert.match(launcher, new RegExp(command.replace('-', '\\-')));
    }
  });

  test('public help and owned docs state the bounded update-awareness contract', () => {
    const help = runHelp();
    assert.match(help, /Node >=22/);
    assert.match(help, /--no-update-notice/);
    assert.match(help, /GSDD_UPDATE_AWARENESS=0/);
    assert.match(help, /WORKSPINE_UPDATE_AWARENESS=0/);
    assert.match(help, /health and update remain network-free/);
    assert.match(help, /sequential|best-effort/i);
    assert.match(help, /no lock|no concurrency guarantee/i);
    assert.doesNotMatch(help, /at most once per 24 hours/i);
    // README.md, docs/USER-GUIDE.md and docs/RUNTIME-SUPPORT.md are all fully renamed to the
    // current `workspine` package, so every row pins the package name exactly.
    for (const [relative, updatePattern] of [
      ['README.md', /npx -y workspine update/],
      ['docs/USER-GUIDE.md', /npx -y workspine update/],
      ['docs/RUNTIME-SUPPORT.md', /npx -y workspine update/],
    ]) {
      const content = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      assert.match(content, /GSDD_UPDATE_AWARENESS=0/);
      assert.match(content, updatePattern);
      assert.match(content, /Node >=22|Node `>=22`/);
      assert.match(content, /network-free/);
      assert.doesNotMatch(content, /Runtime floor: Node 20\+|Node 20\+/);
    }
    assert.strictEqual(PACKAGE.engines.node, '>=22');
    assert.strictEqual(require(path.join(ROOT, 'package-lock.json')).packages[''].engines.node, '>=22');
  });

  test('opt-out wording is explicit on the public and generated surfaces', async () => {
    const help = runHelp();
    assert.match(help, /--no-update-notice/);
    assert.match(help, /GSDD_UPDATE_AWARENESS=0/);
    assert.match(help, /WORKSPINE_UPDATE_AWARENESS=0/);
    const { renderPlanningCliLauncher } = await loadRenderer();
    const launcher = renderPlanningCliLauncher({ packageName: PACKAGE.name, packageVersion: PACKAGE.version });
    assert.match(launcher, /Node >=22/);
    assert.match(launcher, /--no-update-notice/);
    assert.match(launcher, /GSDD_UPDATE_AWARENESS=0/);
    assert.match(launcher, /WORKSPINE_UPDATE_AWARENESS=0/);
    assert.match(launcher, /sequential|best-effort/i);
    assert.match(launcher, /no lock|no concurrency guarantee/i);
    assert.doesNotMatch(launcher, /at most once per 24 hours/i);
  });

  test('design and evidence indexes do not present finite retired paths as current evidence', () => {
    for (const relativePath of ['distilled/DESIGN.md', 'distilled/EVIDENCE-INDEX.md']) {
      const content = fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
      for (const retiredPath of RETIRED_CURRENT_EVIDENCE_PATHS) {
        assert.doesNotMatch(
          content,
          new RegExp(escapeRegExp(retiredPath), 'i'),
          `${relativePath} must not present retired path ${retiredPath} as current evidence`
        );
      }
      for (const retiredPattern of RETIRED_CURRENT_COMMAND_PATTERNS) {
        const matchingLines = content.split(/\r?\n/).filter((line) => retiredPattern.test(line));
        for (const line of matchingLines) {
          assert.match(
            line,
            /historical|retired|not (?:a |the )?public|not shipped|must not|does not expose/i,
            `${relativePath} must label retired command token ${retiredPattern} as non-current`
          );
        }
      }
    }
    for (const currentPath of REQUIRED_CURRENT_EVIDENCE_PATHS) {
      assert.ok(fs.existsSync(path.join(ROOT, currentPath)), `current evidence path must exist: ${currentPath}`);
    }
  });
});
