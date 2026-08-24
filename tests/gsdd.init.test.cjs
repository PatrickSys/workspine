/**
 * GSDD CLI Tests - Init / Update
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const {
  cleanup,
  createTempProject,
  loadGsdd,
  readJson,
  runCliAsMain,
  runCliViaJunction,
  setNonInteractiveStdin,
  withEnv,
} = require('./gsdd.helpers.cjs');

function readSupersededPlanContract() {
  const content = fs.readFileSync(path.join(__dirname, '..', 'distilled', 'workflows', 'execute.md'), 'utf-8');
  const match = content.match(/<superseded_plan_contract>[\s\S]*?<\/superseded_plan_contract>/);
  assert.ok(match, 'execute.md must define the superseded PLAN contract.');
  return match[0];
}

function extractSection(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start);
  assert.notStrictEqual(start, -1, `Missing section start: ${startMarker}`);
  assert.notStrictEqual(end, -1, `Missing section end: ${endMarker}`);
  return content.slice(start, end);
}

function extractExampleTask(content) {
  const match = content.match(/<task id="[^"]+" type="auto">[\s\S]*?<\/task>/);
  assert.ok(match, 'Missing canonical example task with an auto task id');
  return match[0];
}

function collectTestPaths(content) {
  return [...content.matchAll(/tests\/[\w.-]+\.test\.[\w]+/g)].map((match) => match[0]);
}

async function importModule(filePath) {
  return import(`${pathToFileURL(filePath).href}?t=${Date.now()}-${Math.random()}`);
}

// A real Git root. An empty `.git` directory is no longer one: `hasGitMarker` now requires what Git
// itself requires -- `HEAD` plus `objects/` or `commondir`. Measured 2026-08-23, a hollow `.git`
// holding only `info/exclude` on the developer's home directory made every non-Git directory beneath
// it look like a project, so commands run there initialised a workspace in the home directory. These
// fixtures previously asserted that a marker Git disowns is a project root; now they use real ones.
function makeRealGitRoot(dir) {
  const created = spawnSync('git', ['init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
  assert.strictEqual(created.status, 0, `git init failed in fixture ${dir}: ${created.stderr}`);
  // Warm the index once so a later read-only `git` call inside the CLI cannot be the first writer
  // to `.git/index` and perturb a byte-identity snapshot taken during setup.
  spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf-8' });
}

function snapshotTree(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(prefix, entry.name);
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        return [{
          path: relativePath.split(path.sep).join('/'),
          link: fs.readlinkSync(fullPath),
        }];
      }
      return entry.isDirectory()
        ? [{ path: `${relativePath.replace(/\\/g, '/')}/`, directory: true }, ...snapshotTree(fullPath, relativePath)]
        : [{ path: relativePath.replace(/\\/g, '/'), bytes: fs.readFileSync(fullPath) }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function runPublicCli(cwd, args) {
  return spawnSync(process.execPath, [
    path.join(__dirname, '..', 'bin', 'gsdd.mjs'),
    ...args,
  ], { cwd, encoding: 'utf-8' });
}

function runGeneratedHelper(workspaceRoot, cwd, args) {
  return spawnSync(process.execPath, [
    path.join(workspaceRoot, '.work', 'bin', 'gsdd.mjs'),
    ...args,
  ], { cwd, encoding: 'utf-8' });
}

function createPromptStreams() {
  class FakeInput extends EventEmitter {
    constructor() {
      super();
      this.isTTY = true;
      this.isRaw = false;
      this.resumeCalls = 0;
    }

    setRawMode(value) {
      this.isRaw = value;
    }

    resume() {
      this.resumeCalls += 1;
    }

    pause() {}
  }

  class FakeOutput {
    constructor() {
      this.buffer = '';
      this.columns = 120;
      this.rows = 40;
      this.isTTY = true;
    }

    write(chunk) {
      this.buffer += String(chunk);
      return true;
    }
  }

  return {
    input: new FakeInput(),
    output: new FakeOutput(),
  };
}

function setInteractiveStdin() {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor);
    } else {
      delete process.stdin.isTTY;
    }
  };
}

describe('gsdd init and update', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('public init honors a command-scoped workspace root from a foreign marked cwd', () => {
    const foreignRoot = createTempProject();
    const targetRoot = createTempProject();
    const foreignCwd = path.join(foreignRoot, 'nested', 'invocation');
    makeRealGitRoot(foreignRoot);
    fs.mkdirSync(foreignCwd, { recursive: true });
    const foreignBefore = snapshotTree(foreignRoot);
    const targetBefore = snapshotTree(targetRoot);

    try {
      const result = runPublicCli(foreignCwd, [
        'init', '--workspace-root', targetRoot, '--auto', '--tools', 'agents',
      ]);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.ok(fs.existsSync(path.join(targetRoot, '.work', 'config.json')));
      assert.strictEqual(fs.existsSync(path.join(targetRoot, '.planning')), false);
      assert.deepStrictEqual(snapshotTree(foreignRoot), foreignBefore,
        'foreign marked workspace must remain byte-identical');
      assert.notDeepStrictEqual(snapshotTree(targetRoot), targetBefore,
        'the explicit target must receive the initialization output');
    } finally {
      cleanup(foreignRoot);
      cleanup(targetRoot);
    }
  });

  test('public init resolves a relative brief from the explicit workspace root', () => {
    const foreignRoot = createTempProject();
    const targetRoot = createTempProject();
    const foreignCwd = path.join(foreignRoot, 'nested', 'invocation');
    const targetBrief = 'Target brief is authoritative.\n';
    makeRealGitRoot(foreignRoot);
    fs.mkdirSync(foreignCwd, { recursive: true });
    fs.writeFileSync(path.join(foreignCwd, 'brief.md'), 'Foreign brief must not be read.\n');
    fs.writeFileSync(path.join(targetRoot, 'brief.md'), targetBrief);
    const foreignBefore = snapshotTree(foreignRoot);

    try {
      const result = runPublicCli(foreignCwd, [
        'init', '--workspace-root', targetRoot, '--brief', 'brief.md', '--auto', '--tools', 'agents',
      ]);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(
        fs.readFileSync(path.join(targetRoot, '.work', 'PROJECT_BRIEF.md'), 'utf-8'),
        targetBrief,
      );
      assert.deepStrictEqual(snapshotTree(foreignRoot), foreignBefore,
        'foreign cwd and its conflicting brief must remain byte-identical');
    } finally {
      cleanup(foreignRoot);
      cleanup(targetRoot);
    }
  });

  test('public init refuses invalid explicit workspace roots before any write', (t) => {
    const foreignRoot = createTempProject();
    const foreignCwd = path.join(foreignRoot, 'nested', 'invocation');
    const invalidParent = createTempProject();
    const absentRoot = path.join(invalidParent, 'absent-root');
    const fileRoot = path.join(invalidParent, 'regular-file-root');
    const realRoot = path.join(invalidParent, 'real-root');
    const linkedRoot = path.join(invalidParent, 'linked-root');
    makeRealGitRoot(foreignRoot);
    fs.mkdirSync(foreignCwd, { recursive: true });
    fs.writeFileSync(fileRoot, 'not a directory\n');
    fs.mkdirSync(realRoot);

    const invalidCases = [
      {
        name: 'missing value',
        args: ['init', '--workspace-root', '--auto', '--tools', 'agents'],
        expected: /Usage: --workspace-root <path>/,
      },
      {
        name: 'absent root',
        args: ['init', '--workspace-root', absentRoot, '--auto', '--tools', 'agents'],
        expected: /Workspace root is not a real directory/,
      },
      {
        name: 'regular-file root',
        args: ['init', '--workspace-root', fileRoot, '--auto', '--tools', 'agents'],
        expected: /Workspace root is not a real directory/,
      },
    ];

    try {
      try {
        fs.symlinkSync(realRoot, linkedRoot, 'junction');
        invalidCases.push({
          name: 'linked root',
          args: ['init', '--workspace-root', linkedRoot, '--auto', '--tools', 'agents'],
          expected: /Workspace root is not a real directory/,
        });
      } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
        t.diagnostic(`linked-root coverage skipped: ${error.code}`);
      }

      for (const invalidCase of invalidCases) {
        const before = new Map([
          [foreignRoot, snapshotTree(foreignRoot)],
          [invalidParent, snapshotTree(invalidParent)],
        ]);
        const result = runPublicCli(foreignCwd, invalidCase.args);

        assert.notStrictEqual(result.status, 0, `${invalidCase.name} unexpectedly succeeded`);
        assert.match(`${result.stdout}\n${result.stderr}`, invalidCase.expected);
        for (const [root, snapshot] of before) {
          assert.deepStrictEqual(snapshotTree(root), snapshot,
            `${invalidCase.name} must not change ${root}`);
        }
      }
    } finally {
      cleanup(foreignRoot);
      cleanup(invalidParent);
    }
  });

  test('generated helper includes the candidate provenance dependency required by phase verification', async () => {
    const result = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(result.exitCode, 0, result.output);
    const helperPath = path.join(tmpDir, '.work', 'bin', 'lib', 'candidate-provenance.mjs');
    assert.ok(fs.existsSync(helperPath));
    assert.match(fs.readFileSync(helperPath, 'utf-8'), /captureGitCandidate/);
  });

  test('init creates planning structure, default config, templates, and open-standard skills', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }
    const supersededPlanContract = readSupersededPlanContract();

    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'phases')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'research')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.cmd')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'spec.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-new-project', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'delegates', 'plan-checker.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'auth-matrix.md')),
      'auth-matrix.md template must be distributed during init');
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'ui-proof.md')),
      'ui-proof.md template must be distributed during init');
    for (const file of ['CHANGE.md', 'HANDOFF.md', 'VERIFICATION.md']) {
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'brownfield-change', file)),
        `brownfield-change/${file} template must be distributed during init`);
    }

    const statePath = path.join(tmpDir, '.work', 'state.json');
    const state = readJson(statePath);
    assert.deepStrictEqual(state.workflow, {
      plan: { approved: false },
      execution: { status: 'not_started' },
      verification: { status: 'not_started' },
      audit: { status: 'not_started' },
      dogfood: { status: 'not_started' },
    });
    const stateBytes = fs.readFileSync(statePath);
    const repeated = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(repeated.exitCode, 0, repeated.output);
    assert.deepStrictEqual(fs.readFileSync(statePath), stateBytes,
      'repeat init must preserve existing workflow state bytes');

    const config = readJson(path.join(tmpDir, '.work', 'config.json'));
    assert.strictEqual(config.researchDepth, 'balanced');
    assert.strictEqual(config.parallelization, true);
    assert.strictEqual(config.commitDocs, true);
    assert.deepStrictEqual(config.gitProtocol, {
      branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
      commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
      pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
    });
    assert.deepStrictEqual(config.workflow, {
      research: true,
      discuss: false,
      planCheck: true,
      verifier: true,
    });

    const launcher = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'), 'utf-8');
    assert.match(launcher, /bootstrapHelperWorkspace\(import\.meta\.url\)/);
    assert.match(launcher, /import \{ cmdFileOp \} from '\.\/lib\/file-ops\.mjs';/);
    assert.doesNotMatch(launcher, /npm(?:\.cmd)?'.*exec.*--package=/s);
    assert.doesNotMatch(launcher, new RegExp(tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(launcher, /Repos[\\/].+get-shit-done-distilled/i);

    const shellShim = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd'), 'utf-8');
    assert.match(shellShim, /exec node "\$SCRIPT_DIR\/gsdd\.mjs" "\$@"/);

    const cmdShim = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd.cmd'), 'utf-8');
    assert.match(cmdShim, /node "%~dp0gsdd\.mjs" %\*/);

    const ps1Shim = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd.ps1'), 'utf-8');
    assert.match(ps1Shim, /Join-Path \$scriptDir 'gsdd\.mjs'/);

    const helperLib = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'lib', 'workspace-root.mjs'), 'utf-8');
    assert.match(helperLib, /resolveWorkspaceContext/);

    const newProjectSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-new-project', 'SKILL.md'),
      'utf-8'
    );
    assert.match(newProjectSkill, /\.agents\/skills\/work-map-codebase\/SKILL\.md/);
    assert.doesNotMatch(newProjectSkill, /active platform skill\/adapter/);

    const mapperTechTemplate = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md'),
      'utf-8'
    );
    assert.match(mapperTechTemplate, /\.work\/templates\/roles\/mapper\.md/);
    assert.doesNotMatch(mapperTechTemplate, /active platform skill\/adapter/);

    const requiredRoles = [
      'mapper.md',
      'researcher.md',
      'synthesizer.md',
      'roadmapper.md',
      'planner.md',
      'verifier.md',
      'executor.md',
    ];
    for (const role of requiredRoles) {
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'templates', 'roles', role)));
    }

    const executorRole = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'roles', 'executor.md'),
      'utf-8'
    );
    for (const token of [
      '<role>',
      '<scope_boundary>',
      '<deviation_rules>',
      '<authentication_gates>',
      '<output>',
      '<tdd_execution>',
      '<success_criteria>',
      '<checkpoint_protocol>',
      '<self_check>',
      '<quality_guarantees>',
      '<anti_patterns>',
      '<execution_loop>',
      '<vendor_hints>',
    ]) {
      assert.match(executorRole, new RegExp(token.replace(/[<>/]/g, '\\$&')));
    }
    assert.match(executorRole, /Tiered context intake/i);
    assert.match(executorRole, /mandatory_now/i);
    assert.match(executorRole, /task_scoped/i);
    assert.match(executorRole, /null pointer/i);
    assert.match(executorRole, /no auth on protected routes/i);
    assert.match(executorRole, /Missing dependency/i);
    assert.match(executorRole, /New DB table/i);
    assert.match(executorRole, /401/);
    assert.match(executorRole, /403/);
    assert.match(executorRole, /```yaml[\s\S]*deviations:/);
    assert.match(executorRole, /key_files:/);
    assert.match(executorRole, /RED/);
    assert.match(executorRole, /GREEN/);
    assert.match(executorRole, /REFACTOR/);
    assert.match(executorRole, /\[ \] Mandatory-now context and task-scoped files read at the correct execution point/i);
    assert.match(executorRole, /\[ \] All `type="auto"` tasks/i);
    assert.match(executorRole, /\[ \] Authentication gates handled/i);
    assert.match(executorRole, /\[ \] .*SUMMARY\.md.* is written with substantive one-liner/i);
    assert.match(executorRole, /\[ \] Self-check passed/i);
    assert.match(executorRole, /does not own planning, verification, or milestone audit/i);
    assert.match(executorRole, /One-liner must be substantive/i);
    assert.ok(executorRole.includes(supersededPlanContract));
    for (const banned of [
      /~\/\.claude\//i,
      /gsd-tools\.cjs/i,
      /node ~\/\.claude/i,
      /\{type\}\(\{phase\}-\{plan\}\):/,
      /agent-history\.json/i,
      /STRUCTURE\.md/i,
      /INTEGRATIONS\.md/i,
      /auto_advance/i,
      /executor_model/i,
    ]) {
      assert.doesNotMatch(executorRole, banned);
    }

    const synthRole = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'roles', 'synthesizer.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<execution_flow>/,
      /<output_format>/,
      /<structured_returns>/,
      /<success_criteria>/,
      /\.work\/research\/STACK\.md/,
      /\.work\/research\/FEATURES\.md/,
      /\.work\/research\/ARCHITECTURE\.md/,
      /\.work\/research\/PITFALLS\.md/,
      /If any required file is missing:/,
      /do not silently continue with a degraded synthesis/i,
      /Write `\.work\/research\/SUMMARY\.md`/,
      /- Sources/,
      /- Research Flags/,
      /^sources:$/m,
      /## SYNTHESIS BLOCKED/,
      /\*\*Missing files:\*\*/,
      /<scope_boundary>/,
      /does not do new web or codebase research/i,
      /does not write `\.work\/ROADMAP\.md`/i,
      /does not own git actions or commit output/i,
      /```yaml[\s\S]*executive_summary:/,
    ]) {
      assert.match(synthRole, required);
    }
    for (const banned of [/~\/\.claude\//i, /docs: complete project research/i, /cat \.work\/research\//i]) {
      assert.doesNotMatch(synthRole, banned);
    }

    const roadmapperRole = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'roles', 'roadmapper.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<coverage_validation>/,
      /<structured_returns>/,
      /<success_criteria>/,
      /Write `\.work\/ROADMAP\.md`/,
      /## Phases/,
      /## Phase Details/,
      /`\*\*Status\*\*` must use one of: `\[ \]`, `\[-\]`, `\[x\]`/,
      /parse-critical/i,
      /<scope_boundary>/,
      /does not create or redefine separate state artifacts such as `STATE\.md`/i,
      /## ROADMAP DRAFT/,
      /## ROADMAP CREATED/,
      /## ROADMAP REVISED/,
      /## ROADMAP BLOCKED/,
      /\*\*Artifact written:\*\* \.work\/ROADMAP\.md/,
      /\*\*Status\*\*: \[ \]/,
      /revise the roadmap in place rather than rewriting it from scratch/i,
      /Options:/,
      /Awaiting:/,
      /Delete anti-enterprise filler on sight/i,
      /Write or update the roadmap artifact before returning/i,
      /```yaml[\s\S]*phase_count:/,
    ]) {
      assert.match(roadmapperRole, required);
    }
    for (const banned of [
      /progress\/status tracking expected by the current repo runtime/i,
      /Initialize STATE\.md/i,
      /write .*STATE\.md/i,
      /~\/\.claude\//i,
      /commit/i,
    ]) {
      assert.doesNotMatch(roadmapperRole, banned);
    }

    const plannerRole = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'roles', 'planner.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<project_context>/,
      /<context_fidelity>/,
      /<structured_returns>/,
      /<success_criteria>/,
      /## Step 6: Detect TDD candidates/,
      /work is a TDD candidate/i,
      /Default is `auto`\./,
      /Any checkpoint must be justified by the task itself/i,
      /`files` must name exact paths/i,
      /`verify` must include a runnable automated command with fast feedback/i,
      /if no runnable automated check exists yet, add a prior task/i,
      /If planning from verification gaps:/,
      /use the failed truths, broken artifacts/i,
      /<dependency_graph_example>/,
      /Wave 1: A/,
      /Wave rule:/,
      /```yaml[\s\S]*files-modified:/,
      /checkpoint:user/,
    ]) {
      assert.match(plannerRole, required);
    }
    for (const banned of [/type:\s*tdd/i, /user_setup:/, /~\/\.claude\//i, /node ~\/\.claude\/get-shit-done/i]) {
      assert.doesNotMatch(plannerRole, banned);
    }

    const verifierRole = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'roles', 'verifier.md'),
      'utf-8'
    );
    for (const required of [
      /Mandatory initial read/i,
      /<core_principle>/,
      /<output>/,
      /<success_criteria>/,
      /Discovery protocol:/,
      /locate all `\*-PLAN\.md` files/i,
      /locate the previous `\*-VERIFICATION\.md` report/i,
      /treat this as re-verification/i,
      /use each success criterion directly as a truth/i,
      /Truth-level status taxonomy:/,
      /`VERIFIED`/,
      /`FAILED`/,
      /`UNCERTAIN`/,
      /\| L1 \| exists \|/,
      /\| L2 \| substantive \|/,
      /\| L3 \| wired \|/,
      /component -> API route or server action/,
      /API route or server action -> storage or external side effect/,
      /form or user interaction -> handler/,
      /state or fetched data -> rendered output/,
      /Orphaned requirements must be reported/i,
      /requirements expected by roadmap scope but claimed by no plan at all/i,
      /keep them machine-readable in frontmatter\./i,
      /Group related failures before finalizing the report/i,
      /## Verification Basis/,
      /## Requirement Coverage/,
      /^re_verification:$/m,
      /^gaps:$/m,
      /<structured_returns>/,
      /Return a concise machine-usable summary to the orchestrator/i,
      /^report: "\.work\/phases\/01-foundation\/01-VERIFICATION\.md"$/m,
    ]) {
      assert.match(verifierRole, required);
    }
    for (const banned of [
      /frontmatter or an equivalent machine-usable top-level structure/i,
      /~\/\.claude\//i,
      /grep -E/i,
      /node ~\/\.claude\/get-shit-done/i,
    ]) {
      assert.doesNotMatch(verifierRole, banned);
    }
    assert.ok(verifierRole.includes(supersededPlanContract));

    const planSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md'),
      'utf-8'
    );
    for (const required of [
      /How Plan Checking Works/,
      /independent checker reviews it in fresh context/i,
      /at least one runnable command/i,
      /first phase with status `\[ \]` or `\[-\]`/i,
      /^phase: 01-foundation$/m,
      /^runtime: claude-code$/m,
      /^assurance: self_checked$/m,
      /^files-modified:$/m,
      /^autonomous: true$/m,
      /^must_haves:$/m,
      /<assurance_check>/,
      /<checks>/,
      /<plan_check>/,
      /cross_runtime_checked/,
      /<task id="01-01" type="auto">/,
      /checkpoint:user/,
      /checkpoint:review/,
    ]) {
      assert.match(planSkill, required);
    }
    assert.doesNotMatch(planSkill, /AUDIT STATUS: This workflow is a stub/);
    assert.doesNotMatch(planSkill, /Ã¢|Ã°Å¸|Ã¢Å“|Ã¢â€ /);
    assert.ok((planSkill.match(/- Run `[^`]+`/g) || []).length >= 3);

    const exampleTask = extractExampleTask(planSkill);
    const exampleFilePaths = collectTestPaths(exampleTask.match(/<files>[\s\S]*?<\/files>/)?.[0] || '');
    const exampleVerifyPaths = collectTestPaths(exampleTask.match(/<verify>[\s\S]*?<\/verify>/)?.[0] || '');
    for (const testPath of exampleVerifyPaths) {
      assert.ok(exampleFilePaths.includes(testPath), `Example verify path must appear in <files>: ${testPath}`);
    }

    const specificitySection = extractSection(planSkill, '### Specificity Rules', '</task_format>');
    const specificityRows = specificitySection
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .filter((line) => !line.includes('Too Vague'))
      .filter((line) => line.includes('`'));
    assert.ok(specificityRows.length >= 4, 'Expected specificity examples to remain present');
    for (const row of specificityRows) {
      const cells = row.split('|').map((cell) => cell.trim());
      assert.match(cells[2], /run `[^`]+`/i, `Specificity example must include a runnable command: ${row}`);
    }

    const planCheckerTemplate = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'delegates', 'plan-checker.md'),
      'utf-8'
    );
    assert.match(planCheckerTemplate, /Return JSON only/);
    assert.match(planCheckerTemplate, /"status": "passed"/);
    assert.match(planCheckerTemplate, /Status must be either `"passed"` or `"issues_found"`\./);
    assert.match(planCheckerTemplate, /Use `"status": "passed"` only when `"issues": \[\]`/);
    assert.match(planCheckerTemplate, /Use `"status": "issues_found"`/);

    const executeSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-execute', 'SKILL.md'),
      'utf-8'
    );
    for (const required of [
      /type="checkpoint:user"/,
      /type="checkpoint:review"/,
      /node \.work\/bin\/gsdd\.mjs phase-status \{N\} done/,
      /DO NOT freelance/,
      /Checkpoint tasks are contract boundaries/i,
      /factual_discovery/,
      /intent_scope_change/,
      /architecture_risk_conflict/,
      /<handoff>/,
      /<deltas>/,
      /^runtime: codex-cli$/m,
      /^assurance: self_checked$/m,
      /stale reference/i,
      /Mandatory-now context and task-scoped files read at the correct execution point/i,
      /next --json/i,
      /Authentication gates handled with the auth-gate protocol/i,
    ]) {
      assert.match(executeSkill, required);
    }
    assert.ok(executeSkill.includes(supersededPlanContract));
    assert.doesNotMatch(executeSkill, /MARK DONE in the plan file/i);
    assert.doesNotMatch(executeSkill, /Ã¢|Ã°Å¸|Ã¢Å“|Ã¢â€ /);

    const verifySkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-verify', 'SKILL.md'),
      'utf-8'
    );
    for (const required of [
      /^runtime: opencode$/m,
      /^assurance: cross_runtime_checked$/m,
      /^status: gaps_found$/m,
      /^re_verification:$/m,
      /^gaps:$/m,
      /^human_verification:$/m,
      /\*\*Status:\*\* \[passed \| gaps_found \| human_needed\]/,
      /## Verification Basis/,
      /Handoff status:/,
      /Deltas reviewed:/,
      /SUMMARY artifact's `<handoff>` and `<deltas>` blocks/i,
      /treat this as re-verification/i,
      /does not claim milestone-wide integration completeness/i,
      /Do not return a flat symptom list/i,
      /requirements expected by roadmap scope but claimed by no plan/i,
      /do not collapse .* into prose-only body text/i,
      /verification basis/i,
      /Orphaned requirements must be reported/i,
    ]) {
      assert.match(verifySkill, required);
    }
    assert.ok(verifySkill.includes(supersededPlanContract));
    assert.doesNotMatch(verifySkill, /Ã¢|Ã°Å¸|Ã¢Å“|Ã¢â€ /);
  });

  test('generated workflow frontmatter matches mutability', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const verifySkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-verify', 'SKILL.md'),
      'utf-8'
    );
    const progressSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-progress', 'SKILL.md'),
      'utf-8'
    );

    assert.match(verifySkill, /^agent: Code$/m,
      'verify must generate as agent: Code because it writes VERIFICATION.md');
    assert.match(progressSkill, /^agent: Plan$/m,
      'progress must remain agent: Plan because it is the read-only workflow');
  });

  test('repo-local helper runtime is generated under .work/bin as a self-contained workspace helper', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const launcherPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const launcher = fs.readFileSync(launcherPath, 'utf-8');

    assert.match(launcher, /import \{ cmdFileOp \} from '\.\/lib\/file-ops\.mjs';/);
    assert.match(launcher, /import \{ cmdLifecyclePreflight(?:, cmdLifecycleTransition)? \} from '\.\/lib\/lifecycle-preflight\.mjs';/);
    assert.match(launcher, /import \{ cmdPhaseStatus, cmdVerify \} from '\.\/lib\/phase\.mjs';/);
    assert.match(launcher, /import \{ createCmdNext \} from '\.\/lib\/next\.mjs';/);
    assert.match(launcher, /import \{ bootstrapHelperWorkspace, consumeWorkspaceRootArg, resolveWorkspaceContext \} from '\.\/lib\/workspace-root\.mjs';/);
    assert.match(launcher, /const helperRoot = bootstrapHelperWorkspace\(import\.meta\.url\);/);
    assert.doesNotMatch(launcher, /from 'workspine'/);
    assert.doesNotMatch(launcher, /from 'gsdd'/);
    assert.match(launcher, /Usage: node \.work\/bin\/gsdd\.mjs \[--workspace-root <path>\] <command> \[args\]/);
    assert.match(launcher, /file-op <copy\|delete\|regex-sub>/);
    assert.match(launcher, /verify <N>\s+Run direct phase artifact checks/);
    assert.doesNotMatch(launcher, /next \[--json\] \[--init\]/);
    assert.match(launcher, /next \[--json\] \[--format auto\|json\|human\]/);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'lib', 'next.mjs')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'lib', 'work-context.mjs')));
    assert.doesNotMatch(launcher, /\.agents\/bin\/gsdd\.mjs/);
    assert.doesNotMatch(launcher, /where\.exe/);
    assert.doesNotMatch(launcher, /gsdd\.cmd/);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.agents', 'bin')), '.agents/bin must not be generated');
  });

  test('generated helper copies and exposes the read-only git-identity check', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--auto', '--tools', 'agents');
    } finally {
      restoreStdin();
    }
    execFileSync('git', ['-C', tmpDir, 'init'], { stdio: 'ignore' });
    execFileSync('git', ['-C', tmpDir, 'config', 'user.name', 'Generated Helper User']);
    execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'generated@company.test']);

    const source = fs.readFileSync(path.join(__dirname, '..', 'bin', 'lib', 'git-identity.mjs'), 'utf-8');
    const copied = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'lib', 'git-identity.mjs'), 'utf-8');
    assert.strictEqual(copied, source, 'generated helper must use the source identity inspector bytes');

    const result = runGeneratedHelper(tmpDir, tmpDir, ['git-identity', 'check']);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(JSON.parse(result.stdout).identity.classification, 'valid');
  });

  test('generated git-identity resolves helper ownership and a top-level workspace override at invocation time', async () => {
    const foreignDir = createTempProject();
    const targetDir = createTempProject();
    try {
      for (const root of [tmpDir, targetDir]) {
        const initialized = await runCliAsMain(root, ['init', '--auto', '--tools', 'agents']);
        assert.strictEqual(initialized.exitCode, 0, initialized.output);
      }
      for (const [root, name, email] of [
        [tmpDir, 'Owner Identity', 'owner@company.test'],
        [foreignDir, 'Foreign Identity', 'foreign@company.test'],
        [targetDir, 'Override Identity', 'override@company.test'],
      ]) {
        execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
        execFileSync('git', ['-C', root, 'config', 'user.name', name]);
        execFileSync('git', ['-C', root, 'config', 'user.email', email]);
      }

      const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
      const before = new Map([
        [tmpDir, snapshotTree(tmpDir)],
        [foreignDir, snapshotTree(foreignDir)],
        [targetDir, snapshotTree(targetDir)],
      ]);

      let result = spawnSync(process.execPath, [helperPath, 'git-identity', 'check'], {
        cwd: foreignDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const ownerReport = JSON.parse(result.stdout);
      assert.strictEqual(ownerReport.repository.worktree, path.resolve(tmpDir).replace(/\\/g, '/'));
      assert.strictEqual(ownerReport.config.name.value, 'Owner Identity');
      assert.match(ownerReport.fingerprint, /^[a-f0-9]{64}$/);

      result = spawnSync(process.execPath, [helperPath, '--workspace-root', targetDir, 'git-identity', 'check'], {
        cwd: foreignDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const overrideReport = JSON.parse(result.stdout);
      assert.strictEqual(overrideReport.repository.worktree, path.resolve(targetDir).replace(/\\/g, '/'));
      assert.strictEqual(overrideReport.config.name.value, 'Override Identity');
      assert.match(overrideReport.fingerprint, /^[a-f0-9]{64}$/);
      assert.notStrictEqual(overrideReport.fingerprint, ownerReport.fingerprint);

      for (const [root, snapshot] of before) {
        assert.deepStrictEqual(snapshotTree(root), snapshot, 'generated identity inspection must not change any selected or foreign repository');
      }
    } finally {
      cleanup(foreignDir);
      cleanup(targetDir);
    }
  });

  test('generated next resolves helper authority read-only and rejects partial bootstrap', async () => {
    const foreignDir = createTempProject();
    const overrideDir = createTempProject();
    try {
      for (const root of [foreignDir, tmpDir, overrideDir]) {
        const initialized = await runCliAsMain(root, ['init', '--auto', '--tools', 'agents']);
        assert.strictEqual(initialized.exitCode, 0, initialized.output);
      }
      const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
      assert.ok(fs.existsSync(helperPath));
      assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work', 'state.json')), true);
      assert.strictEqual(fs.existsSync(path.join(overrideDir, '.work', 'state.json')), true);
      const ownerBefore = snapshotTree(tmpDir);
      const foreignBefore = snapshotTree(foreignDir);
      const overrideBefore = snapshotTree(overrideDir);

      let result = spawnSync(process.execPath, [helperPath, 'next', '--json', '--no-update-notice'], {
        cwd: foreignDir,
        encoding: 'utf-8',
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const helperPacket = JSON.parse(result.stdout);
      assert.strictEqual(helperPacket.operation, 'next');
      assert.strictEqual(helperPacket.continuity.workspace_root, path.resolve(tmpDir).replace(/\\/g, '/'));
      assert.deepStrictEqual(snapshotTree(tmpDir), ownerBefore, 'ordinary helper next must not write the helper-owning repo');
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'ordinary helper next must not write the foreign cwd');
      assert.deepStrictEqual(snapshotTree(overrideDir), overrideBefore, 'ordinary helper next must not write an unrelated target');

      result = spawnSync(process.execPath, [
        helperPath,
        'next',
        '--init',
        '--json',
        '--no-update-notice',
      ], { cwd: foreignDir, encoding: 'utf-8' });
      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const rejected = JSON.parse(result.stdout);
      assert.strictEqual(rejected.status, 'rejected');
      assert.strictEqual(rejected.error_code, 'partial_bootstrap_removed');
      assert.strictEqual(rejected.next_command, 'npx -y workspine init');
      assert.deepStrictEqual(snapshotTree(tmpDir), ownerBefore, 'rejected helper bootstrap must not write the helper-owning repo');
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'rejected helper bootstrap must not write the foreign cwd');
      assert.deepStrictEqual(snapshotTree(overrideDir), overrideBefore, 'rejected helper bootstrap must not write an unrelated target');

      result = spawnSync(process.execPath, [
        helperPath,
        'next',
        '--json',
        '--no-update-notice',
        '--workspace-root',
        overrideDir,
      ], { cwd: foreignDir, encoding: 'utf-8' });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const overridePacket = JSON.parse(result.stdout);
      assert.strictEqual(overridePacket.operation, 'next');
      assert.strictEqual(overridePacket.continuity.workspace_root, path.resolve(overrideDir).replace(/\\/g, '/'));
      assert.deepStrictEqual(snapshotTree(tmpDir), ownerBefore, 'explicit override must not mutate the helper-owning repo');
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'explicit override must not mutate the foreign cwd');
      assert.deepStrictEqual(snapshotTree(overrideDir), overrideBefore, 'ordinary override next must not write its target');

      result = spawnSync(process.execPath, [
        helperPath,
        'next',
        '--init',
        '--json',
        '--no-update-notice',
        '--workspace-root',
        overrideDir,
      ], { cwd: foreignDir, encoding: 'utf-8' });
      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const overrideRejected = JSON.parse(result.stdout);
      assert.strictEqual(overrideRejected.status, 'rejected');
      assert.strictEqual(overrideRejected.error_code, 'partial_bootstrap_removed');
      assert.strictEqual(overrideRejected.next_command, 'npx -y workspine init');
      assert.deepStrictEqual(snapshotTree(tmpDir), ownerBefore, 'rejected override bootstrap must not mutate the helper-owning repo');
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'rejected override bootstrap must not mutate the foreign cwd');
      assert.deepStrictEqual(snapshotTree(overrideDir), overrideBefore, 'rejected override bootstrap must not mutate the target');
    } finally {
      cleanup(foreignDir);
      cleanup(overrideDir);
    }
  });

  test('generated resolver commands preserve an explicit workspace override when chdir fails', async () => {
    const foreignDir = createTempProject();
    const overrideDir = createTempProject();
    try {
      for (const root of [foreignDir, tmpDir, overrideDir]) {
        const initialized = await runCliAsMain(root, ['init', '--auto', '--tools', 'agents']);
        assert.strictEqual(initialized.exitCode, 0, initialized.output);
      }

      const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
      const launcher = fs.readFileSync(helperPath, 'utf-8');
      const launcherWithFailedChdir = launcher.replace(
        '    process.chdir(context.workspaceRoot);',
        "    throw new Error('forced explicit chdir failure');",
      );
      assert.notStrictEqual(launcherWithFailedChdir, launcher, 'fixture must patch the generated override chdir');
      fs.writeFileSync(helperPath, launcherWithFailedChdir);

      const foreignBefore = snapshotTree(foreignDir);
      const helperOwnerBefore = snapshotTree(tmpDir);
      const result = spawnSync(process.execPath, [
        helperPath,
        'remember',
        'Explicit override remains authoritative when chdir fails.',
        '--type',
        'rule',
        '--scope',
        'repo',
        '--workspace-root',
        overrideDir,
      ], { cwd: foreignDir, encoding: 'utf-8' });

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const candidate = JSON.parse(result.stdout);
      const candidateName = `${candidate.record.id}.md`;
      assert.ok(fs.existsSync(path.join(overrideDir, '.work', 'decisions', candidateName)));
      assert.strictEqual(fs.existsSync(path.join(foreignDir, '.work', 'decisions', candidateName)), false);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, '.work', 'decisions', candidateName)), false);
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'explicit override must not mutate the foreign cwd');
      assert.deepStrictEqual(snapshotTree(tmpDir), helperOwnerBefore, 'explicit override must not mutate the helper-owning repo');
    } finally {
      cleanup(foreignDir);
      cleanup(overrideDir);
    }
  });

  test('generated resolver commands preserve helper workspace authority when bootstrap chdir fails', async () => {
    const foreignDir = createTempProject();
    try {
      for (const root of [foreignDir, tmpDir]) {
        const initialized = await runCliAsMain(root, ['init', '--auto', '--tools', 'agents']);
        assert.strictEqual(initialized.exitCode, 0, initialized.output);
      }

      const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
      const workspaceRootModulePath = path.join(tmpDir, '.work', 'bin', 'lib', 'workspace-root.mjs');
      const workspaceRootModule = fs.readFileSync(workspaceRootModulePath, 'utf-8');
      const moduleWithFailedChdir = workspaceRootModule.replace(
        '    process.chdir(helperRoot);',
        "    throw new Error('forced bootstrap chdir failure');",
      );
      assert.notStrictEqual(moduleWithFailedChdir, workspaceRootModule, 'fixture must patch the copied bootstrap chdir');
      fs.writeFileSync(workspaceRootModulePath, moduleWithFailedChdir);

      const foreignBefore = snapshotTree(foreignDir);
      const result = spawnSync(process.execPath, [
        helperPath,
        'remember',
        'Helper workspace remains authoritative when bootstrap chdir fails.',
        '--type',
        'rule',
        '--scope',
        'repo',
      ], { cwd: foreignDir, encoding: 'utf-8' });

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const candidate = JSON.parse(result.stdout);
      const candidateName = `${candidate.record.id}.md`;
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'decisions', candidateName)));
      assert.strictEqual(fs.existsSync(path.join(foreignDir, '.work', 'decisions', candidateName)), false);
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'helper bootstrap must not mutate the foreign cwd');
    } finally {
      cleanup(foreignDir);
    }
  });

  test('generated decision protocol captures candidates and exposes only read-only queries', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
    fs.mkdirSync(nestedDir, { recursive: true });
    const launcherPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const launcher = fs.readFileSync(launcherPath, 'utf-8');

    assert.match(launcher, /import \{ cmdDecisionsQuery, cmdRememberCandidate \} from '\.\/lib\/decision-cli\.mjs';/);
    assert.match(launcher, /remember:\s*cmdRememberCandidate/);
    assert.doesNotMatch(launcher, /remember:\s*cmdRemember(?:\s*[,}])/);
    assert.match(launcher, /decisions:\s*cmdDecisionsQuery/);
    assert.doesNotMatch(launcher, /decisions:\s*cmdDecisions(?:\s*[,}])/);

    let result = runGeneratedHelper(tmpDir, nestedDir, [
      'remember', 'Generated helper candidate remains non-authoritative.', '--type', 'rule', '--scope', 'repo',
    ]);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const candidate = JSON.parse(result.stdout);
    assert.strictEqual(candidate.status, 'candidate');
    const candidatePath = path.join(tmpDir, '.work', 'decisions', `${candidate.record.id}.md`);
    const candidateBytes = fs.readFileSync(candidatePath, 'utf-8');
    assert.match(candidateBytes, /^status: candidate$/m);
    assert.match(candidateBytes, /^source: agent-proposed$/m);

    const rememberByUserBefore = snapshotTree(tmpDir);
    result = runGeneratedHelper(tmpDir, nestedDir, [
      'remember', 'Generated helper cannot activate a candidate.', '--type', 'rule', '--scope', 'repo', '--by-user',
    ]);
    assert.notStrictEqual(result.status, 0, 'generated remember --by-user unexpectedly succeeded');
    const rememberByUserOutput = `${result.stdout}${result.stderr}`;
    assert.match(rememberByUserOutput, /^--by-user was removed; generated remember records agent-proposed candidates only and cannot approve or activate them; use the main CLI with gsdd decisions promote <id> --authority owner --approval-ref <non-sensitive-ref>\.\n$/);
    assert.deepStrictEqual(snapshotTree(tmpDir), rememberByUserBefore, 'generated remember --by-user must not write the workspace');

    const queryBefore = snapshotTree(tmpDir);
    result = runGeneratedHelper(tmpDir, nestedDir, [
      'decisions', 'query', 'Generated helper candidate',
    ]);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^DECISION QUERY RESULTS \(1 record\)/m);
    assert.match(result.stdout, /\[status: candidate\]/);
    assert.match(result.stdout, new RegExp(candidate.record.id));
    assert.deepStrictEqual(snapshotTree(tmpDir), queryBefore, 'successful generated query must not write the workspace');

    result = runGeneratedHelper(tmpDir, nestedDir, ['next', '--json']);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const next = JSON.parse(result.stdout);
    assert.strictEqual(next.decisionsDigest.counts.excluded.candidate, 1);
    assert.ok(!next.decisionsDigest.ids.includes(candidate.record.id));

    const activeCapture = await runCliAsMain(tmpDir, [
      'remember', 'Existing active record proves invalidation refusal.', '--type', 'rule', '--scope', 'repo',
    ]);
    assert.strictEqual(activeCapture.exitCode, 0, activeCapture.output);
    const activeId = JSON.parse(activeCapture.stdout).record.id;
    const promoted = await runCliAsMain(tmpDir, ['decisions', 'promote', activeId, '--authority', 'owner', '--approval-ref', 'owner-review-generated']);
    assert.strictEqual(promoted.exitCode, 0, promoted.output);

    const unreceiptedCapture = await runCliAsMain(tmpDir, [
      'remember', 'Generated helper reads unreceipted classification.', '--type', 'rule', '--scope', 'repo',
    ]);
    assert.strictEqual(unreceiptedCapture.exitCode, 0, unreceiptedCapture.output);
    const malformedCapture = await runCliAsMain(tmpDir, [
      'remember', 'Generated helper reads malformed classification.', '--type', 'rule', '--scope', 'repo',
    ]);
    assert.strictEqual(malformedCapture.exitCode, 0, malformedCapture.output);
    const malformedId = JSON.parse(malformedCapture.stdout).record.id;
    const unreceiptedId = JSON.parse(unreceiptedCapture.stdout).record.id;
    const unreceiptedPath = path.join(tmpDir, '.work', 'decisions', `${unreceiptedId}.md`);
    const malformedPath = path.join(tmpDir, '.work', 'decisions', `${malformedId}.md`);
    fs.writeFileSync(unreceiptedPath, fs.readFileSync(unreceiptedPath, 'utf-8').replace('status: candidate\n', 'status: active\n'));
    fs.writeFileSync(malformedPath, fs.readFileSync(malformedPath, 'utf-8').replace('status: candidate\n', 'status: active\napproval_authority: \n'));

    for (const [terms, authority] of [
      ['Existing active record proves invalidation refusal', 'owner_asserted'],
      ['Generated helper reads unreceipted classification', 'unreceipted_active'],
      ['Generated helper reads malformed classification', 'malformed_assertion'],
    ]) {
      const before = snapshotTree(tmpDir);
      result = runGeneratedHelper(tmpDir, nestedDir, ['decisions', 'query', terms]);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`\\[authority: ${authority}\\]`));
      assert.deepStrictEqual(snapshotTree(tmpDir), before, `generated ${authority} query must not write the workspace`);
    }

    const helperUsage = /Usage: gsdd decisions query "<terms>" \[--path <path>\]/;
    const transitionCases = [
      ['promote', candidate.record.id, '--authority', 'owner', '--approval-ref', 'generated-refusal'],
      ['reject', candidate.record.id],
      ['invalidate', activeId, '--reason', 'Must not be reachable from generated helper'],
    ];
    for (const decisionArgs of transitionCases) {
      const before = snapshotTree(tmpDir);
      result = runGeneratedHelper(tmpDir, nestedDir, ['decisions', ...decisionArgs]);
      assert.notStrictEqual(result.status, 0, `${decisionArgs.join(' ')} unexpectedly succeeded`);
      const output = `${result.stdout}${result.stderr}`;
      assert.match(output, helperUsage);
      assert.doesNotMatch(output, /\b(promote|reject|invalidate)\b/);
      assert.doesNotMatch(output, /"record"\s*:/);
      assert.deepStrictEqual(snapshotTree(tmpDir), before, `${decisionArgs.join(' ')} must not write the workspace`);
    }

    const malformedCases = [
      [],
      ['inspect', candidate.record.id],
      ['query'],
      ['query', 'Generated helper candidate', '--path', 'src', 'unexpected'],
    ];
    for (const decisionArgs of malformedCases) {
      const before = snapshotTree(tmpDir);
      result = runGeneratedHelper(tmpDir, nestedDir, ['decisions', ...decisionArgs]);
      assert.notStrictEqual(result.status, 0, `${decisionArgs.join(' ') || '(missing)'} unexpectedly succeeded`);
      const output = `${result.stdout}${result.stderr}`;
      assert.match(output, helperUsage);
      assert.doesNotMatch(output, /\b(promote|reject|invalidate)\b/);
      assert.deepStrictEqual(snapshotTree(tmpDir), before, `${decisionArgs.join(' ') || '(missing)'} must not write the workspace`);
    }

    result = runGeneratedHelper(tmpDir, nestedDir, ['help']);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Capture an agent-proposed candidate; this is not approval/);
    assert.match(result.stdout, /Query stored decisions read-only; no transition commands/);
    assert.match(result.stdout, /Raw workspace-confined file mutation; outside decision authority protocol/);
    assert.doesNotMatch(result.stdout, /\b(promote|reject|invalidate)\b/);
  });

  test('generated decisions refuse supported legacy and dual roots without changing bytes or members', async () => {
    const init = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(init.exitCode, 0, init.output);
    const workDir = path.join(tmpDir, '.work');
    const planningDir = path.join(tmpDir, '.planning');
    fs.renameSync(workDir, planningDir);
    const helperPath = path.join(planningDir, 'bin', 'gsdd.mjs');
    const beforeLegacy = snapshotTree(tmpDir);

    for (const args of [
      ['remember', 'Refuse legacy authority', '--type', 'rule', '--scope', 'repo'],
      ['decisions', 'query', 'anything'],
    ]) {
      const result = spawnSync(process.execPath, [helperPath, ...args], { cwd: tmpDir, encoding: 'utf-8' });
      assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}${result.stderr}`, /npx -y workspine init --migrate/);
      assert.deepStrictEqual(snapshotTree(tmpDir), beforeLegacy);
    }

    const controlMap = spawnSync(process.execPath, [helperPath, 'control-map'], { cwd: tmpDir, encoding: 'utf-8' });
    assert.strictEqual(controlMap.status, 1, `${controlMap.stdout}\n${controlMap.stderr}`);
    assert.strictEqual(controlMap.stdout, '');
    assert.strictEqual(controlMap.stderr.trim(), 'ERROR: Legacy .planning/ state is not an active Workspine root. Run `npx -y workspine init --migrate`.');
    assert.deepStrictEqual(snapshotTree(tmpDir), beforeLegacy);

    fs.mkdirSync(workDir);
    fs.writeFileSync(path.join(workDir, 'dual-sentinel.bin'), Buffer.from([0, 255]));
    const beforeDual = snapshotTree(tmpDir);
    const result = spawnSync(process.execPath, [helperPath, 'decisions', 'query', 'anything'], { cwd: tmpDir, encoding: 'utf-8' });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /Both `\.work\/` and `\.planning\/` exist/);
    assert.deepStrictEqual(snapshotTree(tmpDir), beforeDual);
  });

  test('fresh repo-local helper projects active decisions from nested cwd without writing', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const nestedDir = path.join(tmpDir, 'src', 'feature');
    fs.mkdirSync(nestedDir, { recursive: true });

    let captured = await runCliAsMain(tmpDir, [
      'remember', 'The generated helper must read active authority.', '--type', 'rule', '--scope', 'repo', '--no-update-notice',
    ]);
    assert.strictEqual(captured.exitCode, 0, captured.output);
    const activeId = JSON.parse(captured.stdout).record.id;
    let promoted = await runCliAsMain(tmpDir, ['decisions', 'promote', activeId, '--authority', 'owner', '--approval-ref', 'owner-review-nested', '--no-update-notice']);
    assert.strictEqual(promoted.exitCode, 0, promoted.output);
    captured = await runCliAsMain(tmpDir, [
      'remember', 'Candidate helper body must remain excluded.', '--type', 'rule', '--scope', 'repo', '--no-update-notice',
    ]);
    assert.strictEqual(captured.exitCode, 0, captured.output);
    const candidateId = JSON.parse(captured.stdout).record.id;
    const before = snapshotTree(path.join(tmpDir, '.work'));

    const packageNext = await runCliAsMain(tmpDir, ['next', '--json', '--no-update-notice']);
    assert.strictEqual(packageNext.exitCode, 0, packageNext.output);
    const packagePacket = JSON.parse(packageNext.output);
    assert.deepStrictEqual(packagePacket.decisionsDigest.ids, [activeId]);
    assert.strictEqual(packagePacket.decisionsDigest.counts.excluded.candidate, 1);
    assert.deepStrictEqual(snapshotTree(path.join(tmpDir, '.work')), before,
      'ordinary next decision digest must not partially bootstrap or write state');

    let result = spawnSync(process.execPath, [
      path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'),
      'next',
      '--json',
      '--no-update-notice',
    ], { cwd: nestedDir, encoding: 'utf-8' });

    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.operation, 'next');
    assert.ok(parsed.next_action);
    assert.ok(parsed.inputs_considered.includes('repo truth: control-map'));
    assert.deepStrictEqual(parsed.decisionsDigest.ids, [activeId]);
    assert.strictEqual(parsed.decisionsDigest.counts.excluded.candidate, 1);
    assert.deepStrictEqual(parsed.decisionsDigest, packagePacket.decisionsDigest);
    assert.ok(parsed.inputs_considered.includes('.work/decisions/*.md'));
    assert.doesNotMatch(JSON.stringify(parsed), new RegExp(candidateId));

    result = spawnSync(process.execPath, [
      path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'),
      'next',
      '--format', 'human',
      '--no-update-notice',
    ], { cwd: nestedDir, encoding: 'utf-8' });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /DECISIONS DIGEST \(1 active\)/);
    assert.match(result.stdout, /The generated helper must read active authority/);
    assert.match(result.stdout, /candidate decision excluded/);
    assert.doesNotMatch(result.stdout, /Candidate helper body must remain excluded/);
    assert.deepStrictEqual(snapshotTree(path.join(tmpDir, '.work')), before);
  });

  test('fresh repo-local helper matches package continuity from nested and explicit workspace roots', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }
    fs.writeFileSync(path.join(tmpDir, '.work', '.continue-here.md'), [
      '---',
      'workflow: generic',
      'phase: null',
      'timestamp: 2026-08-12T10:00:00.000Z',
      'runtime: codex-cli',
      '---',
      '',
      '<current_state>Continuity fixture.</current_state>',
      '<completed_work>Generated helper exists.</completed_work>',
      '<remaining_work>Compare packets.</remaining_work>',
      '<decisions>Prose is not authority.</decisions>',
      '<blockers>None.</blockers>',
      '<next_action>Run next.</next_action>',
    ].join('\n'));
    const nestedDir = path.join(tmpDir, 'src', 'feature');
    fs.mkdirSync(nestedDir, { recursive: true });
    const foreignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsdd-continuity-foreign-'));
    const before = snapshotTree(tmpDir);
    const foreignBefore = snapshotTree(foreignDir);

    try {
      const packageResult = await runCliAsMain(tmpDir, ['next', '--json']);
      assert.strictEqual(packageResult.exitCode, 0, packageResult.output);
      const packagePacket = JSON.parse(packageResult.output);
      const nested = runGeneratedHelper(tmpDir, nestedDir, ['next', '--json']);
      assert.strictEqual(nested.status, 0, `${nested.stdout}\n${nested.stderr}`);
      const explicit = runGeneratedHelper(tmpDir, foreignDir, ['--workspace-root', tmpDir, 'next', '--json']);
      assert.strictEqual(explicit.status, 0, `${explicit.stdout}\n${explicit.stderr}`);

      assert.deepStrictEqual(JSON.parse(nested.stdout).continuity, packagePacket.continuity);
      assert.deepStrictEqual(JSON.parse(explicit.stdout).continuity, packagePacket.continuity);
      assert.deepStrictEqual(snapshotTree(tmpDir), before, 'all continuity reads must preserve generated workspace bytes');
      assert.deepStrictEqual(snapshotTree(foreignDir), foreignBefore, 'explicit workspace-root must not write the foreign current directory');
    } finally {
      cleanup(foreignDir);
    }
  });

  test('repo-local helper supports brownfield-change plan preflight from nested cwd', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    fs.mkdirSync(path.join(tmpDir, '.work', 'brownfield-change'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'SPEC.md'), '# Spec\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'ROADMAP.md'), [
      '# Roadmap',
      '',
      '- [ ] **Phase 425589: Unrelated Roadmap Item** - [OTHER-01]',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, '.work', 'brownfield-change', 'CHANGE.md'), [
      '# Brownfield Change: PBI 425589',
      '',
      '## Goal',
      'Plan the bounded brownfield change.',
      '',
      '## In Scope',
      '- The named bounded change surfaces.',
      '',
      '## Out of Scope',
      '- Roadmap membership and independent streams.',
      '',
      '## Done When',
      '- The bounded change has passing evidence.',
      '',
      '## Current Status',
      '- Current posture: active',
      '',
      '## Next Action',
      '- Plan the bounded change.',
      '',
      '## Closeout Path',
      '- Record evidence in VERIFICATION.md.',
      '- Set CHANGE.md to closed after passed verification.',
      '',
    ].join('\n'));

    const nestedDir = path.join(tmpDir, 'src', 'feature');
    fs.mkdirSync(nestedDir, { recursive: true });

    let result = spawnSync(process.execPath, [
      path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'),
      'lifecycle-preflight',
      'plan',
      'brownfield-change',
    ], { cwd: nestedDir, encoding: 'utf-8' });

    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    let parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.allowed, true);
    assert.strictEqual(parsed.authority, 'brownfield_change');
    assert.ok(!parsed.blockers.some((blocker) => blocker.code === 'missing_phase'));

    fs.writeFileSync(path.join(tmpDir, '.work', 'brownfield-change', 'CHANGE.md'), [
      '# Brownfield Change: Closed PBI',
      '',
      '## Current Status',
      '- Current posture: closed',
      '',
    ].join('\n'));

    result = spawnSync(process.execPath, [
      path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'),
      'lifecycle-preflight',
      'plan',
      'brownfield-change',
    ], { cwd: nestedDir, encoding: 'utf-8' });

    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.authority, 'brownfield_change');
    assert.strictEqual(parsed.reason, 'brownfield_change_closed');
    assert.ok(!parsed.blockers.some((blocker) => blocker.code === 'missing_phase'));
  });

  test('repo-local helper works from nested cwd through helper bootstrap', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const nestedDir = path.join(tmpDir, 'src', 'feature');
    fs.mkdirSync(nestedDir, { recursive: true });

    const result = spawnSync(process.execPath, [
      path.join(tmpDir, '.work', 'bin', 'gsdd.mjs'),
      'file-op',
      'copy',
      '.work/config.json',
      '.planning/config-copy.json',
    ], { cwd: nestedDir, encoding: 'utf-8' });

    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'config-copy.json')));
    assert.ok(!fs.existsSync(path.join(nestedDir, '.planning', 'config-copy.json')));
  });

  test('repo-local lifecycle helpers work from nested cwd with workspace-root before or after subcommand', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const roadmapPath = path.join(tmpDir, '.work', 'ROADMAP.md');
    fs.writeFileSync(roadmapPath, [
      '# Roadmap',
      '',
      '- [ ] **Phase 1: Build helper hardening**',
      '',
      '### Phase 1: Build helper hardening',
      '**Status**: [ ]',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(tmpDir, '.work', 'phases'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '01-PLAN.md'), '# Plan\n');

    const nestedDir = path.join(tmpDir, 'src', 'feature', 'deep');
    fs.mkdirSync(nestedDir, { recursive: true });
    const helperPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');

    const preflight = spawnSync(process.execPath, [
      helperPath,
      '--workspace-root',
      tmpDir,
      'lifecycle-preflight',
      'execute',
      '1',
      '--expects-mutation',
      'phase-status',
    ], { cwd: nestedDir, encoding: 'utf-8' });

    assert.strictEqual(preflight.status, 0, `${preflight.stdout}\n${preflight.stderr}`);
    assert.match(preflight.stdout, /"status": "allowed"/);
    assert.match(preflight.stdout, /"mutationRequest": "phase-status"/);
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '01-SUMMARY.md'), '# Summary\n');
    fs.writeFileSync(path.join(tmpDir, '.work', 'phases', '01-VERIFICATION.md'), '---\nstatus: passed\n---\n# Verification\n');

    const phaseStatus = spawnSync(process.execPath, [
      helperPath,
      'phase-status',
      '1',
      'done',
      '--workspace-root',
      tmpDir,
    ], { cwd: nestedDir, encoding: 'utf-8' });

    assert.strictEqual(phaseStatus.status, 0, `${phaseStatus.stdout}\n${phaseStatus.stderr}`);
    assert.match(phaseStatus.stdout, /"changed": true/);
    const roadmap = fs.readFileSync(roadmapPath, 'utf-8');
    assert.match(roadmap, /- \[x\] \*\*Phase 1: Build helper hardening\*\*/);
    assert.match(roadmap, /\*\*Status\*\*: \[x\]/);
    assert.ok(!fs.existsSync(path.join(nestedDir, '.planning')), 'helper commands must not create a nested workspace');
  });

  test('delegates reference canonical role contracts', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit();
    } finally {
      restoreStdin();
    }

    const mapperTech = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'delegates', 'mapper-tech.md'),
      'utf-8'
    );
    assert.match(mapperTech, /\.work\/templates\/roles\/mapper\.md/);

    const researcherStack = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'delegates', 'researcher-stack.md'),
      'utf-8'
    );
    assert.match(researcherStack, /\.work\/templates\/roles\/researcher\.md/);

    const synthDelegate = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'delegates', 'researcher-synthesizer.md'),
      'utf-8'
    );
    assert.match(synthDelegate, /\.work\/templates\/roles\/synthesizer\.md/);

    const mapperRole = fs.readFileSync(
      path.join(tmpDir, '.work', 'templates', 'roles', 'mapper.md'),
      'utf-8'
    );
    assert.match(mapperRole, /\.env/);
    assert.match(mapperRole, /Hard stop/);
  });

  test('init with explicit tools generates requested adapters including Codex native adapter', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let output = '';
    const previousLog = console.log;
    console.log = (...parts) => {
      output += `${parts.join(' ')}\n`;
    };
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude,codex,opencode,agents');
    } finally {
      console.log = previousLog;
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'work-new-project', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'work-plan.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-planner.toml')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'commands', 'work-new-project.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.doesNotMatch(output, /--tools codex` is deprecated/i);

    // Portable skill must NOT be polluted with vendor-specific content after --tools all
    const portableSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.doesNotMatch(portableSkill, /Codex-Native/);
    assert.doesNotMatch(portableSkill, /spawn_agent/);
    assert.doesNotMatch(portableSkill, /\.codex\/agents\//);
    // But it MUST have checker invocation (the Codex entry surface)
    assert.match(portableSkill, /Invoking the Checker/);
    assert.match(portableSkill, /work-plan-checker/);

    const claudePlanChecker = fs.readFileSync(
      path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md'),
      'utf-8'
    );
    assert.match(claudePlanChecker, /^name: work-plan-checker/m);
    assert.match(claudePlanChecker, /^tools: Read, Grep, Glob/m);
    assert.doesNotMatch(claudePlanChecker, /DRAFT PAYLOAD ONLY/);
    assert.match(claudePlanChecker, /Return JSON only/);

    const claudePlanCommand = fs.readFileSync(
      path.join(tmpDir, '.claude', 'commands', 'work-plan.md'),
      'utf-8'
    );
    assert.match(claudePlanCommand, /^argument-hint: \[phase-number\]/m);
    assert.match(claudePlanCommand, /Compatibility alias/);
    assert.match(claudePlanCommand, /\.claude\/skills\/work-plan\/SKILL\.md/);
    assert.doesNotMatch(claudePlanCommand, /Maximum 3 checker cycles total/);

    const opencodePlanChecker = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md'),
      'utf-8'
    );
    assert.match(opencodePlanChecker, /^mode: subagent/m);
    assert.match(opencodePlanChecker, /^hidden: true/m);
    assert.match(opencodePlanChecker, /^\s+write: false/m);
    assert.match(opencodePlanChecker, /^\s+edit: false/m);
    assert.match(opencodePlanChecker, /^\s+bash: false/m);
    assert.doesNotMatch(opencodePlanChecker, /DRAFT PAYLOAD ONLY/);

    const opencodeApproachExplorer = fs.readFileSync(
      path.join(tmpDir, '.opencode', 'agents', 'work-approach-explorer.md'),
      'utf-8'
    );
    assert.match(opencodeApproachExplorer, /^mode: subagent/m);
    assert.doesNotMatch(opencodeApproachExplorer, /^mode: agent/m);

    const codexPlanChecker = fs.readFileSync(
      path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml'),
      'utf-8'
    );
    assert.match(codexPlanChecker, /^name = "work-plan-checker"/m);
    assert.match(codexPlanChecker, /^sandbox_mode = "read-only"/m);
    assert.match(codexPlanChecker, /^model_reasoning_effort = "high"/m);
    assert.match(codexPlanChecker, /Return JSON only/);
  });

  test('init with --tools codex generates checker agent and portable skill is the entry surface', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });

    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'gsdd-planner.toml')));
    assert.strictEqual(fs.existsSync(path.join(tmpDir, '.claude', 'skills')), false);

    // Portable skill must stay vendor-neutral but include checker invocation
    const portableSkill = fs.readFileSync(
      path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md'),
      'utf-8'
    );
    assert.doesNotMatch(portableSkill, /Codex-Native/);
    assert.doesNotMatch(portableSkill, /spawn_agent/);
    assert.doesNotMatch(portableSkill, /\.codex\/agents\//);
    assert.match(portableSkill, /How Plan Checking Works/);
    assert.match(portableSkill, /Invoking the Checker/);
    assert.match(portableSkill, /Maximum 3 checker cycles total/);
  });

  test('choice list redraws in place on arrow navigation', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Select runtimes',
      hint: 'Space toggles, Enter confirms.',
      multi: true,
      choices: [
        { id: 'claude', label: 'Claude', description: 'Native', selected: true, detected: true },
        { id: 'cursor', label: 'Cursor', description: 'Skills-native', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'down' });
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, ['claude']);
    assert.match(output.buffer, /\x1b\[\d+A/, 'rerender should move the cursor back up before repainting');
  });

  test('choice list resumes stdin before waiting for keypresses', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Select runtimes',
      multi: false,
      choices: [
        { value: 'claude', label: 'Claude', description: 'Native', selected: true, detected: false },
        { value: 'cursor', label: 'Cursor', description: 'Skills-native', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, ['claude']);
    assert.ok(input.resumeCalls >= 1, 'selector should resume stdin before listening for keypresses');
  });

  test('choice list restores raw mode and rejects on Ctrl+C', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Select runtimes',
      multi: true,
      choices: [
        { value: 'claude', label: 'Claude', description: 'Native', selected: true, detected: false },
        { value: 'cursor', label: 'Cursor', description: 'Skills-native', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '\u0003', { ctrl: true, name: 'c' });
    });

    await assert.rejects(selectionPromise, /Prompt cancelled by user/);
    assert.strictEqual(input.isRaw, false, 'Ctrl+C should restore raw mode before rejecting');
  });

  test('single-select confirms the highlighted option on Enter', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Research depth',
      multi: false,
      choices: [
        { value: 'balanced', label: 'balanced', description: 'Recommended', selected: true, detected: false },
        { value: 'fast', label: 'fast', description: 'Faster', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'down' });
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, ['fast']);
  });

  test('choice list accounts for wrapped descriptions when rerendering', async () => {
    const { promptChoiceList } = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const { input, output } = createPromptStreams();
    output.columns = 24;

    const selectionPromise = promptChoiceList({
      input,
      output,
      title: 'Planning docs in git',
      multi: false,
      choices: [
        { value: true, label: 'yes', description: 'Track .work/ in git for history and team recovery.', selected: true, detected: false },
        { value: false, label: 'no', description: 'Keep planning docs local only and out of version control.', selected: false, detected: false },
      ],
    });

    setImmediate(() => {
      input.emit('keypress', '', { name: 'down' });
      input.emit('keypress', '', { name: 'return' });
    });

    const selected = await selectionPromise;
    assert.deepStrictEqual(selected, [false]);
    assert.match(output.buffer, /\x1b\[(1[0-9]|[2-9])A/, 'rerender should move up by the wrapped visual height, not a fixed small count');
  });

  test('interactive wizard can select skills-native runtimes without forcing AGENTS.md', async () => {
    const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
    const ctx = gsddMod.createCliContext(tmpDir);
    ctx.initPromptApi = {
      async runInitWizard() {
        return {
          selectedRuntimes: ['cursor', 'codex'],
          adapterTargets: ['codex'],
          config: {
            researchDepth: 'balanced',
            parallelization: true,
            commitDocs: true,
            modelProfile: 'balanced',
            workflow: { research: true, discuss: false, planCheck: true, verifier: true },
            gitProtocol: {
              branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
              commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
              pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
            },
            initVersion: 'v1.1',
          },
        };
      },
      async promptForConfig() {
        throw new Error('promptForConfig should not run when wizard already returned config');
      },
    };

    let output = '';
    const previousLog = console.log;
    const restoreStdin = setInteractiveStdin();
    console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
    try {
      const cmdInit = initMod.createCmdInit(ctx);
      await cmdInit();
    } finally {
      console.log = previousLog;
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml')));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'AGENTS.md')),
      'Wizard runtime selection must not write AGENTS.md unless governance was explicitly enabled.');
    assert.match(output, /Cursor:\s+\/work-quick .*\/work-plan .*\/work-new-project/);
    assert.match(output, /Codex CLI:\s+\$work-quick .*\$work-plan .*\$work-new-project/);
  });

  test('interactive wizard governance opt-in writes AGENTS.md separately from runtime choice', async () => {
    const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
    const ctx = gsddMod.createCliContext(tmpDir);
    ctx.initPromptApi = {
      async runInitWizard() {
        return {
          selectedRuntimes: ['cursor'],
          adapterTargets: ['agents'],
          config: {
            researchDepth: 'balanced',
            parallelization: true,
            commitDocs: true,
            modelProfile: 'balanced',
            workflow: { research: true, discuss: false, planCheck: true, verifier: true },
            gitProtocol: {
              branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
              commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
              pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
            },
            initVersion: 'v1.1',
          },
        };
      },
      async promptForConfig() {
        throw new Error('promptForConfig should not run when wizard already returned config');
      },
    };

    const restoreStdin = setInteractiveStdin();
    try {
      const cmdInit = initMod.createCmdInit(ctx);
      await cmdInit();
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex')),
      'Selecting governance without Codex must not generate unrelated native adapters.');
  });

  test('interactive --tools path prompts only for config and writes a valid config shape', async () => {
    const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
    const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
    const ctx = gsddMod.createCliContext(tmpDir);
    ctx.initPromptApi = {
      async runInitWizard() {
        throw new Error('runInitWizard should not run when --tools preselects runtimes');
      },
      async promptForConfig() {
        return {
          researchDepth: 'balanced',
          parallelization: true,
          commitDocs: true,
          modelProfile: 'balanced',
          workflow: { research: true, discuss: false, planCheck: true, verifier: true },
          gitProtocol: {
            branch: 'Follow the existing repo or team branching convention. Use a feature branch for significant changes when no convention exists.',
            commit: 'Group changes logically and follow the existing repo conventions. Do not mention phase, plan, or task IDs unless explicitly requested.',
            pr: 'Follow the existing repo or team review workflow. Do not assume PR creation, timing, or naming unless explicitly requested.',
          },
          initVersion: 'v1.1',
        };
      },
    };

    const restoreStdin = setInteractiveStdin();
    try {
      const cmdInit = initMod.createCmdInit(ctx);
      await cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const config = readJson(path.join(tmpDir, '.work', 'config.json'));
    assert.strictEqual(config.researchDepth, 'balanced');
    assert.strictEqual(config.modelProfile, 'balanced');
    assert.strictEqual(config.initVersion, 'v1.1');
    assert.ok(!('selectedRuntimes' in config), 'config must not contain the wizard wrapper shape');
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml')));
  });

  test('init is idempotent and upserts the bounded AGENTS block without duplicating it', async () => {
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      '# Local Rules\n\nKeep my notes.\n\n<!-- BEGIN GSDD -->\nold block\n<!-- END GSDD -->\n'
    );

    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      await gsdd.cmdInit('--tools', 'agents');
    } finally {
      restoreStdin();
    }

    const agents = fs.readFileSync(agentsPath, 'utf-8');
    assert.strictEqual((agents.match(/<!-- BEGIN GSDD -->/g) || []).length, 1);
    assert.strictEqual((agents.match(/<!-- END GSDD -->/g) || []).length, 1);
    assert.match(agents, /# Local Rules/);
    assert.doesNotMatch(agents, /old block/);
  });

  test('repeat init preserves unknown templates without adopting them into generation ownership', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      const unknown = path.join(tmpDir, '.work', 'templates', 'team-notes.md');
      fs.writeFileSync(unknown, '# Team-owned template\n');

      await gsdd.cmdInit('--tools', 'agents');

      assert.strictEqual(fs.readFileSync(unknown, 'utf-8'), '# Team-owned template\n');
      const manifest = readJson(path.join(tmpDir, '.work', 'generation-manifest.json'));
      assert.ok(!Object.hasOwn(manifest.templates.root, 'team-notes.md'));
    } finally {
      restoreStdin();
    }
  });

  for (const [name, setup] of [
    ['config-only', (root) => fs.writeFileSync(path.join(root, '.work', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }))],
    ['phase-only', (root) => fs.writeFileSync(path.join(root, '.work', 'phases', 'notes.md'), '# Existing phase note\n')],
  ]) {
    test(`init bootstraps ${name} .work state without adopting unrelated bytes`, async () => {
      const stateDir = path.join(tmpDir, '.work');
      fs.mkdirSync(path.join(stateDir, 'phases'), { recursive: true });
      setup(tmpDir);
      const unrelated = path.join(stateDir, 'phases', 'notes.md');
      if (!fs.existsSync(unrelated)) fs.writeFileSync(unrelated, '# Existing phase note\n');
      const beforeUnrelated = fs.readFileSync(unrelated, 'utf-8');
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--tools', 'agents');
      } finally {
        restoreStdin();
      }

      const manifest = readJson(path.join(stateDir, 'generation-manifest.json'));
      assert.strictEqual(fs.readFileSync(unrelated, 'utf-8'), beforeUnrelated);
      assert.ok(manifest.templates.delegates['mapper-tech.md']);
      assert.ok(!Object.hasOwn(manifest.templates.root, 'notes.md'));
    });
  }

  test('repeat init reconciles commitDocs false by restoring the configured ignore entry', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      const configPath = path.join(tmpDir, '.work', 'config.json');
      const config = readJson(configPath);
      config.commitDocs = false;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');

      await gsdd.cmdInit('--tools', 'agents');

      assert.match(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8'), /^\.work\/$/m);
    } finally {
      restoreStdin();
    }
  });

  test('repeat init applies default commitDocs semantics to an older partial config', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      fs.writeFileSync(path.join(tmpDir, '.work', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.work/\n');
      const before = snapshotTree(tmpDir);

      const result = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);

      assert.notStrictEqual(result.exitCode, 0, result.output);
      assert.match(result.output, /commitDocs is true/);
      assert.deepStrictEqual(snapshotTree(tmpDir), before);
    } finally {
      restoreStdin();
    }
  });

  test('repeat init refuses an ambiguous commitDocs true ignore entry before any workspace write', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
      const configPath = path.join(tmpDir, '.work', 'config.json');
      const config = readJson(configPath);
      config.commitDocs = true;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n.work/\n');
      const before = snapshotTree(tmpDir);

      const result = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
      assert.notStrictEqual(result.exitCode, 0, result.output);
      assert.match(result.output, /commitDocs is true/);

      assert.deepStrictEqual(snapshotTree(tmpDir), before);
    } finally {
      restoreStdin();
    }
  });

  test('legacy --tools cursor still writes AGENTS.md for backward compatibility', async () => {
    const restoreStdin = setNonInteractiveStdin();
    try {
      const gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'cursor');
    } finally {
      restoreStdin();
    }

    assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.codex')));
    assert.ok(!fs.existsSync(path.join(tmpDir, '.claude')));
  });

  test('update refreshes previously generated adapters based on detected platforms', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;

    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'claude,agents');
    } finally {
      restoreStdin();
    }

    const claudeAgentPath = path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md');
    const claudeCommandPath = path.join(tmpDir, '.claude', 'commands', 'work-plan.md');
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    const launcherPath = path.join(tmpDir, '.work', 'bin', 'gsdd.mjs');
    const shellShimPath = path.join(tmpDir, '.work', 'bin', 'gsdd');
    const cmdShimPath = path.join(tmpDir, '.work', 'bin', 'gsdd.cmd');
    fs.writeFileSync(claudeAgentPath, 'stale checker\n');
    fs.writeFileSync(claudeCommandPath, 'stale command\n');
    fs.writeFileSync(agentsPath, '# Local Rules\n\n<!-- BEGIN GSDD -->\nstale block\n<!-- END GSDD -->\n');
    fs.writeFileSync(launcherPath, 'stale launcher\n');
    fs.writeFileSync(shellShimPath, 'stale shell shim\n');
    fs.writeFileSync(cmdShimPath, 'stale cmd shim\n');

    await gsdd.cmdUpdate();

    const updatedClaudeAgent = fs.readFileSync(claudeAgentPath, 'utf-8');
    assert.doesNotMatch(updatedClaudeAgent, /^stale checker$/m);
    assert.match(updatedClaudeAgent, /^name: work-plan-checker/m);

    const updatedClaudeCommand = fs.readFileSync(claudeCommandPath, 'utf-8');
    assert.doesNotMatch(updatedClaudeCommand, /^stale command$/m);
    assert.match(updatedClaudeCommand, /Compatibility alias/);

    const updatedAgents = fs.readFileSync(agentsPath, 'utf-8');
    assert.doesNotMatch(updatedAgents, /stale block/);
    assert.match(updatedAgents, /GSDD/);

    const updatedLauncher = fs.readFileSync(launcherPath, 'utf-8');
    assert.doesNotMatch(updatedLauncher, /^stale launcher$/m);
    assert.match(updatedLauncher, /bootstrapHelperWorkspace\(import\.meta\.url\)/);

    const updatedPs1Shim = fs.readFileSync(path.join(tmpDir, '.work', 'bin', 'gsdd.ps1'), 'utf-8');
    assert.match(updatedPs1Shim, /Join-Path \$scriptDir 'gsdd\.mjs'/);

    const updatedShellShim = fs.readFileSync(shellShimPath, 'utf-8');
    assert.doesNotMatch(updatedShellShim, /^stale shell shim$/m);
    assert.match(updatedShellShim, /gsdd\.mjs/);

    const updatedCmdShim = fs.readFileSync(cmdShimPath, 'utf-8');
    assert.doesNotMatch(updatedCmdShim, /^stale cmd shim$/m);
    assert.match(updatedCmdShim, /gsdd\.mjs/);
  });

  test('plain update regenerates Codex checker agent', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;
    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'codex');
    } finally {
      restoreStdin();
    }

    const checkerPath = path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml');
    fs.writeFileSync(checkerPath, 'stale checker\n');

    await gsdd.cmdUpdate();

    const updatedChecker = fs.readFileSync(checkerPath, 'utf-8');
    assert.doesNotMatch(updatedChecker, /^stale checker$/m);
    assert.match(updatedChecker, /^name = "work-plan-checker"/m);
    assert.match(updatedChecker, /^sandbox_mode = "read-only"/m);
  });

  test('plain update refreshes templates without rewriting historical phase artifacts', async () => {
    const restoreStdin = setNonInteractiveStdin();
    let gsdd;
    try {
      gsdd = await loadGsdd(tmpDir);
      await gsdd.cmdInit('--tools', 'agents');
    } finally {
      restoreStdin();
    }

    const phaseDir = path.join(tmpDir, '.work', 'phases', '01-history');
    fs.mkdirSync(phaseDir, { recursive: true });
    const historicalPlanPath = path.join(phaseDir, '01-PLAN.md');
    const historicalPlan = [
      '---',
      'ui_proof_slots: []',
      'no_ui_proof_rationale: Historical CLI-only phase; no rendered UI claim.',
      '---',
      '# Phase 1 Plan',
      '',
      'This artifact is historical user work and must not be rewritten by update.',
    ].join('\n');
    fs.writeFileSync(historicalPlanPath, historicalPlan);

    const templatePath = path.join(tmpDir, '.work', 'templates', 'ui-proof.md');
    fs.writeFileSync(templatePath, 'stale template\n');

    await gsdd.cmdUpdate();

    const updatedTemplate = fs.readFileSync(templatePath, 'utf-8');
    assert.doesNotMatch(updatedTemplate, /^stale template$/m);
    assert.match(updatedTemplate, /Browser Proof Observation Template/);
    assert.strictEqual(fs.readFileSync(historicalPlanPath, 'utf-8'), historicalPlan);
  });

  test('cli entrypoint still runs when invoked through an aliased bin path', async () => {
    const result = await runCliViaJunction(tmpDir, ['help']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.match(result.output, /Usage: workspine <command> \[args\]/);
    assert.match(result.output, /Compatibility: gsdd <command> \[args\] remains a supported alias/);
    assert.match(result.output, /Commands:/);
    assert.match(result.output, /claude\s+Generate Claude Code skills .* native agents/);
    assert.match(result.output, /codex\s+Generate Codex CLI native/);
  });

  describe('auto mode', () => {
    test('--auto --tools claude produces config with autoAdvance', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      assert.strictEqual(config.autoAdvance, true);
      assert.strictEqual(config.researchDepth, 'balanced');
      assert.strictEqual(config.parallelization, true);
      assert.deepStrictEqual(config.workflow, { research: true, discuss: false, planCheck: true, verifier: true });
    });

    test('--auto --tools all generates shared, helper, and native runtime surfaces', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'all');
      } finally {
        restoreStdin();
      }

      assert.ok(fs.existsSync(path.join(tmpDir, '.agents', 'skills', 'work-plan', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'work-plan-checker.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.opencode', 'agents', 'work-plan-checker.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'agents', 'work-plan-checker.toml')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'AGENTS.md')));
    });

    test('--auto without --tools sets exitCode 1', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /--tools/);
        assert.match(errorOutput, /npx -y workspine init --auto --tools claude/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('--auto config has same shape as interactive defaults', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      const config = readJson(path.join(tmpDir, '.work', 'config.json'));
      const expectedKeys = [
        'researchDepth',
        'parallelization',
        'commitDocs',
        'modelProfile',
        'workflow',
        'gitProtocol',
        'initVersion',
        'autoAdvance',
      ];
      for (const key of expectedKeys) {
        assert.ok(key in config, `config.json missing expected key: ${key}`);
      }
      assert.strictEqual(config.initVersion, 'v1.1');
    });

    test('--brief copies file to .work/PROJECT_BRIEF.md', async () => {
      const briefContent = '# Project Brief\n\nBuild a task manager app.\n';
      fs.writeFileSync(path.join(tmpDir, 'my-brief.md'), briefContent);

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', 'my-brief.md');
      } finally {
        restoreStdin();
      }

      const briefDest = path.join(tmpDir, '.work', 'PROJECT_BRIEF.md');
      assert.ok(fs.existsSync(briefDest));
      assert.strictEqual(fs.readFileSync(briefDest, 'utf-8'), briefContent);
    });

    test('--brief with absolute path copies file to .work/PROJECT_BRIEF.md', async () => {
      const briefContent = '# Brief\n\nAbsolute path test.\n';
      const absPath = path.join(tmpDir, 'abs-brief.md');
      fs.writeFileSync(absPath, briefContent);

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', absPath);
      } finally {
        restoreStdin();
      }

      const briefDest = path.join(tmpDir, '.work', 'PROJECT_BRIEF.md');
      assert.ok(fs.existsSync(briefDest));
      assert.strictEqual(fs.readFileSync(briefDest, 'utf-8'), briefContent);
    });

    test('re-running --auto when config exists preserves existing config', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
        const configPath = path.join(tmpDir, '.work', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.researchDepth = 'deep';
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        await gsdd.cmdInit('--auto', '--tools', 'claude');
        const reread = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        assert.strictEqual(reread.researchDepth, 'deep', 're-init must not overwrite existing config');
      } finally {
        restoreStdin();
      }
    });

    test('repeat init and update preserve legacy config bytes without rewriting them', async () => {
      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
        const configPath = path.join(tmpDir, '.work', 'config.json');
        const legacy = [
          '{',
          '  "rigorProfile": "max",',
          '  "workflow": { "showCode": true, "askBeforeDecide": true },',
          '  "consumerOwned": "keep-this-byte-shape"',
          '}\n',
        ].join('\n');
        fs.writeFileSync(configPath, legacy);

        await gsdd.cmdInit('--auto', '--tools', 'claude');
        await gsdd.cmdUpdate();

        assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), legacy);
      } finally {
        restoreStdin();
      }
    });

    test('--brief with missing file sets exitCode 1', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', 'nonexistent.md');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /not found/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('--brief followed by another flag sets exitCode 1 and does not write config', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude', '--brief', '--auto');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /--brief requires a file path/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });

    test('--tools followed by another flag sets exitCode 1 and does not write config', async () => {
      const previousExitCode = process.exitCode;
      const previousError = console.error;
      let errorOutput = '';
      console.error = (...parts) => { errorOutput += parts.join(' '); };

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', '--brief', 'idea.md');
        assert.strictEqual(process.exitCode, 1);
        assert.match(errorOutput, /--tools requires a value/);
      } finally {
        restoreStdin();
        console.error = previousError;
        process.exitCode = previousExitCode;
      }

      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'config.json')));
    });
  });

  describe('global install', () => {
    test('resolveGlobalInstallRoots honors explicit non-isolated runtime homes without leaking process env', async () => {
      const previousXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'ambient-config');
      try {
        const { resolveGlobalInstallRoots } = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}`);
        const homeDir = path.join(tmpDir, 'home');
        const env = {
          XDG_CONFIG_HOME: path.join(tmpDir, 'explicit-config'),
          CLAUDE_CONFIG_DIR: path.join(tmpDir, 'explicit-claude'),
          OPENCODE_CONFIG_DIR: path.join(tmpDir, 'explicit-opencode'),
          CODEX_HOME: path.join(tmpDir, 'explicit-codex'),
          COPILOT_HOME: path.join(tmpDir, 'explicit-copilot'),
        };
        const roots = resolveGlobalInstallRoots({ homeDir, env });
        assert.strictEqual(roots.configHome, env.XDG_CONFIG_HOME);
        assert.strictEqual(roots.claude, env.CLAUDE_CONFIG_DIR);
        assert.strictEqual(roots.opencode, env.OPENCODE_CONFIG_DIR);
        assert.strictEqual(roots.codex, env.CODEX_HOME);
        assert.strictEqual(roots.copilot, env.COPILOT_HOME);
        assert.strictEqual(roots.agentSkills, path.join(homeDir, '.agents'));
      } finally {
        if (previousXdg === undefined) {
          delete process.env.XDG_CONFIG_HOME;
        } else {
          process.env.XDG_CONFIG_HOME = previousXdg;
        }
      }
    });

    test('resolveGlobalInstallRoots honors Copilot CLI home override', async () => {
      const { resolveGlobalInstallRoots } = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}`);
      const roots = resolveGlobalInstallRoots({
        homeDir: path.join(tmpDir, 'home'),
        env: {
          COPILOT_HOME: path.join(tmpDir, 'copilot-home'),
          COPILOT_CONFIG_DIR: path.join(tmpDir, 'legacy-copilot-home'),
        },
      });

      assert.strictEqual(roots.copilot, path.join(tmpDir, 'copilot-home'));
    });

    test('install --global --tools all writes global skills and native agent surfaces without bootstrapping the repo', async () => {
      const homeDir = createTempProject();
      try {
        await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
          const gsdd = await loadGsdd(tmpDir);
          await gsdd.cmdInstall('--global', '--tools', 'all');
        });

        assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')),
          'global install must not create repo-local planning state');
        assert.ok(!fs.existsSync(path.join(tmpDir, '.agents')),
          'global install must not create repo-local portable skills');

        const expectedFiles = [
          '.claude/skills/work-plan/SKILL.md',
          '.claude/commands/work-plan.md',
          '.claude/agents/work-plan-checker.md',
          '.claude/agents/work-approach-explorer.md',
          '.config/opencode/commands/work-plan.md',
          '.config/opencode/agents/work-plan-checker.md',
          '.config/opencode/agents/work-approach-explorer.md',
          '.agents/skills/work-plan/SKILL.md',
          '.codex/agents/work-plan-checker.toml',
          '.codex/agents/work-approach-explorer.toml',
          '.copilot/agents/work-plan-checker.agent.md',
          '.copilot/agents/work-approach-explorer.agent.md',
        ];

        for (const rel of expectedFiles) {
          assert.ok(fs.existsSync(path.join(homeDir, rel)), `missing global install file: ${rel}`);
        }

        for (const manifestPath of [
          '.claude/workspine-file-manifest.json',
          '.config/opencode/workspine-file-manifest.json',
          '.agents/workspine-file-manifest.json',
          '.codex/workspine-file-manifest.json',
          '.copilot/workspine-file-manifest.json',
        ]) {
          const manifest = readJson(path.join(homeDir, manifestPath));
          assert.strictEqual(manifest.product, 'Workspine');
          if (manifestPath === '.agents/workspine-file-manifest.json') {
            assert.strictEqual(manifest.runtime, 'agent-skills');
            assert.ok(manifest.files['skills/work-plan/SKILL.md'], `${manifestPath} must track shared work-plan skill`);
          } else if (manifestPath === '.codex/workspine-file-manifest.json') {
            assert.ok(manifest.files['agents/work-plan-checker.toml'], `${manifestPath} must track native Codex agents`);
          } else if (manifestPath === '.copilot/workspine-file-manifest.json') {
            assert.ok(manifest.files['agents/work-plan-checker.agent.md'], `${manifestPath} must track native Copilot agents`);
          } else if (manifestPath === '.config/opencode/workspine-file-manifest.json') {
            assert.ok(manifest.files['commands/work-plan.md'], `${manifestPath} must track native OpenCode commands`);
          } else {
            assert.ok(manifest.files['skills/work-plan/SKILL.md'], `${manifestPath} must track work-plan skill`);
          }
        }
      } finally {
        cleanup(homeDir);
      }
    });

    test('install --global refuses to overwrite unmanaged user files', async () => {
      const homeDir = createTempProject();
      const customSkill = path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md');
      fs.mkdirSync(path.dirname(customSkill), { recursive: true });
      fs.writeFileSync(customSkill, 'user-owned skill\n');

      const previousExitCode = process.exitCode;
      try {
        await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
          const gsdd = await loadGsdd(tmpDir);
          await gsdd.cmdInstall('--global', '--tools', 'claude');
        });
        assert.strictEqual(process.exitCode, 1);
        assert.strictEqual(fs.readFileSync(customSkill, 'utf-8'), 'user-owned skill\n');
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'commands', 'work-plan.md')),
          'blocked global install must not partially write sibling surfaces');
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'agents', 'work-plan-checker.md')),
          'blocked global install must not partially write native agents');
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'workspine-file-manifest.json')),
          'manifest must not claim ownership when unmanaged files block install');
      } finally {
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('install --global without --tools fails in non-interactive shells', async () => {
      const homeDir = createTempProject();
      const previousExitCode = process.exitCode;
      const restoreStdin = setNonInteractiveStdin();
      try {
        await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
          const gsdd = await loadGsdd(tmpDir);
          await gsdd.cmdInstall('--global');
        });
        assert.strictEqual(process.exitCode, 1);
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude')));
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('install --global --auto detects existing agent homes and does not bootstrap the repo', async () => {
      const homeDir = createTempProject();
      const previousExitCode = process.exitCode;
      const restoreStdin = setNonInteractiveStdin();
      try {
        fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
        await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
          const result = await runCliAsMain(tmpDir, ['install', '--global', '--auto']);
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.output, /codex:/);
          assert.match(result.output, /Global install complete/);
        });

        assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'work-plan', 'SKILL.md')));
        assert.ok(fs.existsSync(path.join(homeDir, '.codex', 'agents', 'work-plan-checker.toml')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.copilot')));
        assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')),
          'global --auto must not create repo-local planning state');
        assert.ok(!fs.existsSync(path.join(tmpDir, '.agents')),
          'global --auto must not create repo-local portable skills');
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('install --global --auto --tools keeps explicit target scope', async () => {
      const homeDir = createTempProject();
      const previousExitCode = process.exitCode;
      const restoreStdin = setNonInteractiveStdin();
      try {
        fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
        fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
        await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
          const result = await runCliAsMain(tmpDir, ['install', '--global', '--auto', '--tools', 'codex']);
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.output, /codex:/);
          assert.doesNotMatch(result.output, /claude:/);
        });

        assert.ok(fs.existsSync(path.join(homeDir, '.codex', 'agents', 'work-plan-checker.toml')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md')));
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('install --global --auto without detected agent homes fails closed', async () => {
      const homeDir = createTempProject();
      const previousExitCode = process.exitCode;
      const restoreStdin = setNonInteractiveStdin();
      try {
        await withEnv({ GSDD_TEST_HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, '.config') }, async () => {
          const result = await runCliAsMain(tmpDir, ['install', '--global', '--auto']);
          assert.strictEqual(result.exitCode, 1);
          assert.match(result.output, /No supported agent homes were detected for --auto/);
          const { GLOBAL_AGENT_OPTIONS } = await import(`${pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')).href}?t=${Date.now()}-auto-targets`);
          for (const { id } of GLOBAL_AGENT_OPTIONS) {
            assert.match(result.output, new RegExp(`npx -y workspine install --global --tools ${id}`));
          }
          assert.doesNotMatch(result.output, /Create an agent config home first/);
        });

        assert.ok(!fs.existsSync(path.join(homeDir, '.agents')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.codex')));
        assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('install --global --auto rejects invalid explicit targets before writes', async () => {
      const homeDir = createTempProject();
      const previousExitCode = process.exitCode;
      const restoreStdin = setNonInteractiveStdin();
      try {
        fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
        await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
          const result = await runCliAsMain(tmpDir, ['install', '--global', '--auto', '--tools', 'bogus']);
          assert.strictEqual(result.exitCode, 1);
          assert.match(result.output, /unsupported global install target/);
        });

        assert.ok(!fs.existsSync(path.join(homeDir, '.agents')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.codex', 'agents')));
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('install --global rejects runtime probing flags from the public CLI', async () => {
      const homeDir = createTempProject();
      const previousExitCode = process.exitCode;
      const restoreStdin = setNonInteractiveStdin();
      try {
        for (const flag of ['--verify-runtime', '--live-runtime']) {
          await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
            const result = await runCliAsMain(tmpDir, ['install', '--global', '--tools', 'claude', flag]);
            assert.strictEqual(result.exitCode, 1);
            assert.match(result.output, /runtime probing is not part of the public install command/);
          });
        }
        assert.ok(!fs.existsSync(path.join(homeDir, '.claude')));
      } finally {
        restoreStdin();
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });

    test('interactive global install picker does not preselect every agent home', async () => {
      const homeDir = createTempProject();
      let promptedOptions = null;
      const previousExitCode = process.exitCode;
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
      try {
        Object.defineProperty(process.stdin, 'isTTY', {
          configurable: true,
          value: true,
        });
        await withEnv({ GSDD_TEST_HOME: homeDir }, async () => {
          const [{ createCliContext }, { createCmdInstall }] = await Promise.all([
            importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs')),
            importModule(path.join(__dirname, '..', 'bin', 'lib', 'global-install.mjs')),
          ]);
          const ctx = createCliContext(tmpDir);
          ctx.globalInstallPromptApi = {
            selectGlobalInstallTargets(options) {
              promptedOptions = options;
              return ['claude'];
            },
          };
          await createCmdInstall(ctx)('--global');
        });

        assert.ok(promptedOptions);
        assert.ok(promptedOptions.every((option) => option.selected === false),
          'global install must not default to writing every supported agent home');
        assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'work-plan', 'SKILL.md')));
        assert.ok(!fs.existsSync(path.join(homeDir, '.copilot')));
      } finally {
        if (stdinDescriptor) {
          Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
        } else {
          delete process.stdin.isTTY;
        }
        process.exitCode = previousExitCode;
        cleanup(homeDir);
      }
    });
  });

  describe('partial .planning/ resilience', () => {
    test('unattended init refuses an unsupported partial .planning/ before any write', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      const before = snapshotTree(tmpDir);

      const result = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'claude']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /Legacy \.planning\/ state is unsupported \(missing_config\)/);
      assert.deepStrictEqual(snapshotTree(tmpDir), before);
    });

    test('init after pre-init guard rejection creates complete structure', async () => {
      const result = await runCliAsMain(tmpDir, ['models', 'profile', 'quality']);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')));

      const restoreStdin = setNonInteractiveStdin();
      try {
        const gsdd = await loadGsdd(tmpDir);
        await gsdd.cmdInit('--auto', '--tools', 'claude');
      } finally {
        restoreStdin();
      }

      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'phases')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'research')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'config.json')));
    });

    test('supported legacy state requires --migrate when init is unattended', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1', keep: true }));
      fs.writeFileSync(path.join(tmpDir, '.planning', 'consumer.bin'), Buffer.from([0, 1, 255]));
      const before = snapshotTree(tmpDir);

      const result = await runCliAsMain(tmpDir, ['init', '--auto', '--tools', 'agents']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /Run `npx -y workspine init --migrate`\./);
      assert.deepStrictEqual(snapshotTree(tmpDir), before);
    });

    test('fresh and current roots bypass the legacy migration prompt', async () => {
      const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
      const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
      const configMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'config.mjs'));
      const restoreStdin = setInteractiveStdin();
      const previousExitCode = process.exitCode;
      try {
        for (const current of [false, true]) {
          const root = current ? createTempProject() : tmpDir;
          if (current) {
            fs.mkdirSync(path.join(root, '.work'));
            fs.writeFileSync(path.join(root, '.work', 'sentinel.txt'), 'current');
          }
          let prompted = false;
          const ctx = gsddMod.createCliContext(root);
          ctx.initPromptApi = {
            confirmLegacyMigration: async () => {
              prompted = true;
              throw new Error('migration prompt is not valid for fresh/current state');
            },
            runInitWizard: async () => ({
              selectedRuntimes: [],
              adapterTargets: [],
              config: configMod.buildDefaultConfig(),
            }),
          };
          process.exitCode = undefined;
          try {
            await initMod.createCmdInit(ctx)();
          } finally {
            if (current) cleanup(root);
          }
          assert.strictEqual(process.exitCode, undefined);
          assert.strictEqual(prompted, false);
        }
      } finally {
        process.exitCode = previousExitCode;
        restoreStdin();
      }
    });

    test('interactive legacy migration decline is explicit and byte-preserving', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      fs.writeFileSync(path.join(tmpDir, '.planning', 'consumer.bin'), Buffer.from([0, 1, 255]));
      const before = snapshotTree(tmpDir);
      const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
      const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
      const restoreStdin = setInteractiveStdin();
      const previousExitCode = process.exitCode;
      let prompted = 0;
      try {
        const ctx = gsddMod.createCliContext(tmpDir);
        ctx.initPromptApi = {
          confirmLegacyMigration: async () => {
            prompted += 1;
            return false;
          },
        };
        process.exitCode = undefined;
        await initMod.createCmdInit(ctx)();
        assert.strictEqual(process.exitCode, 1);
        assert.strictEqual(prompted, 1);
        assert.deepStrictEqual(snapshotTree(tmpDir), before);
      } finally {
        process.exitCode = previousExitCode;
        restoreStdin();
      }
    });

    test('interactive legacy migration acceptance moves state before continuing setup', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      fs.writeFileSync(path.join(tmpDir, '.planning', 'nested', 'consumer.bin'), Buffer.from([0, 1, 255]));
      const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
      const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
      const configMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'config.mjs'));
      const restoreStdin = setInteractiveStdin();
      const previousExitCode = process.exitCode;
      let prompted = 0;
      try {
        const ctx = gsddMod.createCliContext(tmpDir);
        ctx.initPromptApi = {
          confirmLegacyMigration: async () => {
            prompted += 1;
            return true;
          },
          runInitWizard: async () => ({
            selectedRuntimes: [],
            adapterTargets: [],
            config: configMod.buildDefaultConfig(),
          }),
        };
        process.exitCode = undefined;
        await initMod.createCmdInit(ctx)();
        assert.strictEqual(process.exitCode, undefined);
        assert.strictEqual(prompted, 1);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.planning')), false);
        assert.strictEqual(fs.readFileSync(path.join(tmpDir, '.work', 'nested', 'consumer.bin'))[2], 255);
        assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'migration-receipt.json')));
      } finally {
        process.exitCode = previousExitCode;
        restoreStdin();
      }
    });

    test('models and rigor commands refuse supported legacy state without writes', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      const before = snapshotTree(tmpDir);
      for (const args of [['models', 'show'], ['rigor', 'show']]) {
        const result = await runCliAsMain(tmpDir, args);
        assert.strictEqual(result.exitCode, 1, result.output);
        assert.match(result.output, /npx -y workspine init --migrate/);
        assert.deepStrictEqual(snapshotTree(tmpDir), before);
      }
    });

    test('init --migrate moves supported legacy bytes, writes receipt, then continues on .work', async () => {
      fs.mkdirSync(path.join(tmpDir, '.planning', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1', keep: true }));
      const consumerBytes = Buffer.from([0, 1, 2, 13, 10, 255]);
      fs.writeFileSync(path.join(tmpDir, '.planning', 'nested', 'consumer.bin'), consumerBytes);

      const result = await runCliAsMain(tmpDir, ['init', '--migrate', '--auto', '--tools', 'agents']);
      assert.strictEqual(result.exitCode, 0, result.output);
      assert.strictEqual(fs.existsSync(path.join(tmpDir, '.planning')), false);
      assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, '.work', 'nested', 'consumer.bin')), consumerBytes);
      const receipt = JSON.parse(fs.readFileSync(path.join(tmpDir, '.work', 'migration-receipt.json'), 'utf8'));
      assert.strictEqual(receipt.signature, 'S2-config-v1');
      assert.strictEqual(receipt.detected_init_version, 'v1.1');
      assert.strictEqual(receipt.method, 'same-parent-rename');
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'bin', 'gsdd.mjs')));
    });

    test('init --migrate refuses legacy decision content and receipt collisions before writes', async () => {
      for (const collision of ['decisions', 'migration-receipt.json']) {
        fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });
        fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
        if (collision === 'decisions') {
          fs.mkdirSync(path.join(tmpDir, '.planning', 'decisions'));
          fs.writeFileSync(path.join(tmpDir, '.planning', 'decisions', 'legacy.md'), 'legacy');
        } else {
          fs.writeFileSync(path.join(tmpDir, '.planning', collision), '{}');
        }
        const before = snapshotTree(tmpDir);
        const result = await runCliAsMain(tmpDir, ['init', '--migrate', '--auto', '--tools', 'agents']);
        assert.strictEqual(result.exitCode, 1, result.output);
        assert.match(result.output, collision === 'decisions' ? /nonempty_legacy_decisions/ : /migration_receipt_exists/);
        assert.deepStrictEqual(snapshotTree(tmpDir), before);
      }
    });

    test('nested migration writes only at the discovered Git root', async () => {
      makeRealGitRoot(tmpDir);
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ initVersion: 'v1.1' }));
      const nested = path.join(tmpDir, 'packages', 'app');
      fs.mkdirSync(nested, { recursive: true });
      const result = await runCliAsMain(nested, ['init', '--migrate', '--auto', '--tools', 'agents']);
      assert.strictEqual(result.exitCode, 0, result.output);
      assert.ok(fs.existsSync(path.join(tmpDir, '.work', 'migration-receipt.json')));
      assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false);
      assert.strictEqual(fs.existsSync(path.join(nested, '.planning')), false);
    });

    test('dual roots refuse init before adapters, prompts, or workspace writes', async () => {
      fs.mkdirSync(path.join(tmpDir, '.work'));
      fs.writeFileSync(path.join(tmpDir, '.work', 'sentinel.txt'), 'work');
      fs.mkdirSync(path.join(tmpDir, '.planning'));
      fs.writeFileSync(path.join(tmpDir, '.planning', 'sentinel.txt'), 'planning');
      const before = snapshotTree(tmpDir);

      const result = await runCliAsMain(tmpDir, ['init', '--migrate', '--auto', '--tools', 'agents']);
      assert.strictEqual(result.exitCode, 1);
      assert.match(result.output, /Both `\.work\/` and `\.planning\/` exist/);
      assert.deepStrictEqual(snapshotTree(tmpDir), before);
    });

    test('interactive split-root state refuses before asking to migrate', async () => {
      fs.mkdirSync(path.join(tmpDir, '.work'));
      fs.writeFileSync(path.join(tmpDir, '.work', 'sentinel.txt'), 'work');
      fs.mkdirSync(path.join(tmpDir, '.planning'));
      fs.writeFileSync(path.join(tmpDir, '.planning', 'sentinel.txt'), 'planning');
      const before = snapshotTree(tmpDir);
      const initMod = await importModule(path.join(__dirname, '..', 'bin', 'lib', 'init.mjs'));
      const gsddMod = await importModule(path.join(__dirname, '..', 'bin', 'gsdd.mjs'));
      const restoreStdin = setInteractiveStdin();
      const previousExitCode = process.exitCode;
      let prompted = false;
      try {
        const ctx = gsddMod.createCliContext(tmpDir);
        ctx.initPromptApi = {
          confirmLegacyMigration: async () => {
            prompted = true;
            throw new Error('split roots must fail before prompting');
          },
        };
        process.exitCode = undefined;
        await initMod.createCmdInit(ctx)();
        assert.strictEqual(process.exitCode, 1);
        assert.strictEqual(prompted, false);
        assert.deepStrictEqual(snapshotTree(tmpDir), before);
      } finally {
        process.exitCode = previousExitCode;
        restoreStdin();
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Root admission and containment. R16-02, R16-03, A15-44.
//
// Every case here was chosen from a measured incident, not from imagination:
//
//   - A hollow `C:/Users/bitaz/.git` holding only `info/exclude` made the developer's home
//     directory look like a Git project. `git rev-parse` refused it three ways; `hasGitMarker`
//     accepted it on `isDirectory()` alone. Every Workspine command run from any non-Git directory
//     beneath it therefore initialised a workspace in the home directory, exit 0, silently. Proven
//     by A/B on 2026-08-23: marker present -> wrote to home and left the invocation directory
//     empty; marker removed -> wrote locally. That is what created the home workspace on
//     2026-08-11 and what recreated it at 22:44:09.
//   - A `.work` sitting exactly at `os.tmpdir()` was captured from a subdirectory despite a
//     sentinel existing for that path, because the sentinel was checked *after* the marker match.
//   - An explicit `--workspace-root` writes a complete workspace into an arbitrary sibling. That
//     is deliberate and retained: the user named the directory. It is pinned here so the write
//     stays confined to the named target and reaches nothing else.
//   - `install --global` targets the real home directory unless `GSDD_TEST_HOME` is set. It is
//     pinned here so a global write is proven to land only under an isolated home.
//
// The observer watches every path `init` is known to write, at every strict ancestor AND every
// sibling of the invocation directory. An earlier `.work`-only, ancestors-only observer reported a
// zero-write result that was true of the directory it looked at and false of the filesystem.
// ---------------------------------------------------------------------------------------------

describe('root admission and containment', () => {
  const WATCHED = ['.work', '.planning', '.agents', '.claude', '.gitignore', 'goal.md', 'AGENTS.md'];
  let sandbox;

  beforeEach(() => { sandbox = createTempProject(); });
  afterEach(() => { cleanup(sandbox); });

  function markerState(target) {
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if (error.code === 'ENOENT') return 'absent';
      throw error;
    }
    if (stat.isSymbolicLink()) return `symlink -> ${fs.readlinkSync(target)}`;
    if (!stat.isDirectory()) return `file bytes=${stat.size}`;
    let newest = 0;
    let count = 0;
    let dirs = 0;
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { dirs += 1; walk(full); continue; }
        count += 1;
        // An entry can vanish or dangle between readdir and stat. Count it and move on rather than
        // letting unrelated churn abort a containment measurement.
        try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch { /* transient */ }
      }
    })(target);
    return `dir files=${count} dirs=${dirs} newest=${newest}`;
  }

  // Presence plus top-level entry count. Enough to prove a workspace was not created or extended
  // at a real filesystem location, without reading anything below it.
  function shallowMarkerState(target) {
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isDirectory()) return `nondirectory bytes=${stat.size}`;
      return `dir entries=${fs.readdirSync(target).length}`;
    } catch (error) {
      if (error.code === 'ENOENT') return 'absent';
      return `unreadable ${error.code}`;
    }
  }

  // Every strict ancestor of `dir` up to the sandbox, plus every sibling directory at each of those
  // levels, plus the two real-world locations a containment escape has actually been measured
  // reaching. The ancestor walk deliberately stops at the sandbox: above it lies the shared OS temp
  // root, whose sibling directories belong to other tests running concurrently and appear and vanish
  // mid-run, which would make this observer report their churn as an escape. The real locations above
  // the sandbox are therefore watched by exact path instead of by enumeration.
  function surroundingState(dir) {
    const root = path.resolve(sandbox);
    const state = new Map();
    const watch = (base) => {
      for (const name of WATCHED) state.set(path.join(base, name), markerState(path.join(base, name)));
    };

    let current = path.resolve(dir);
    while (current !== root && current.startsWith(root + path.sep)) {
      const parent = path.dirname(current);
      watch(parent);
      let entries = [];
      try {
        entries = fs.readdirSync(parent, { withFileTypes: true });
      } catch { entries = []; }
      for (const entry of entries) {
        const sibling = path.join(parent, entry.name);
        if (!entry.isDirectory() || sibling === current) continue;
        watch(sibling);
      }
      current = parent;
    }
    watch(root);

    // Measured escape targets, by exact path. `C:/Users/bitaz/.work` was created by exactly this
    // class of defect on 2026-08-11 and recreated on 2026-08-23. Only the workspace markers are
    // watched here, and only shallowly: a deep walk of a real home directory reads unrelated live
    // trees such as `.claude/`, whose contents change during the run and can contain dangling links.
    for (const base of [os.tmpdir(), os.homedir()]) {
      for (const name of ['.work', '.planning', '.claude', '.agents', '.codex', '.copilot', '.config']) {
        const target = path.join(base, name);
        state.set(target, shallowMarkerState(target));
      }
    }
    return state;
  }

  // `allowed` names the directories this command was legitimately asked to write -- an explicit
  // `--workspace-root` target, or an isolated global-install home. Everything else must be
  // byte-stable. Naming the permitted target explicitly is what keeps this assertion meaningful:
  // a blanket exemption would let the real escape hide behind the intended one.
  function assertNoEscape(before, dir, label, allowed = []) {
    const permitted = allowed.map((entry) => path.resolve(entry));
    const after = surroundingState(dir);
    // The union of both key sets, not just `before`. A write under a directory the command itself
    // created has no prior key, so iterating `before` alone could not see it -- measured in review
    // against a full workspace planted in a brand-new sibling directory.
    for (const target of new Set([...before.keys(), ...after.keys()])) {
      if (permitted.some((base) => target === base || target.startsWith(base + path.sep))) continue;
      const previous = before.has(target) ? before.get(target) : 'absent';
      const now = after.has(target) ? after.get(target) : 'absent';
      assert.strictEqual(now, previous,
        `${label}: escaped to ${target} (was ${previous}, now ${now})`);
    }
  }

  function runIn(cwd, args, env = {}) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gsdd.mjs'), ...args], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0', ...env },
    });
    return { exitCode: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  function makeDir(...segments) {
    const dir = path.join(sandbox, ...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  test('a hollow .git holding only info/ is not a project root and is never written', () => {
    const liar = makeDir('liar-root');
    fs.mkdirSync(path.join(liar, '.git', 'info'), { recursive: true });
    fs.writeFileSync(path.join(liar, '.git', 'info', 'exclude'), '# git init template residue\n');
    const nested = makeDir('liar-root', 'deep', 'work-here');
    const before = surroundingState(nested);

    const result = runIn(nested, ['init', '--auto', '--tools', 'agents']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(fs.existsSync(path.join(liar, '.work')), false,
      'a directory Git itself disowns must never receive a workspace');
    assert.ok(fs.existsSync(path.join(nested, '.work', 'config.json')),
      'the invocation directory must receive the workspace instead');
    assertNoEscape(before, nested, 'hollow .git');
  });

  test('an empty .git directory is not a project root', () => {
    const fake = makeDir('empty-git-root');
    fs.mkdirSync(path.join(fake, '.git'));
    const nested = makeDir('empty-git-root', 'packages', 'app');
    const before = surroundingState(nested);

    const result = runIn(nested, ['init', '--auto', '--tools', 'agents']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(fs.existsSync(path.join(fake, '.work')), false);
    assert.ok(fs.existsSync(path.join(nested, '.work', 'config.json')));
    assertNoEscape(before, nested, 'empty .git');
  });

  test('a gitfile pointing at a directory Git would refuse is not a project root', () => {
    const fake = makeDir('gitfile-root');
    fs.mkdirSync(path.join(fake, 'git-metadata'));
    fs.writeFileSync(path.join(fake, '.git'), 'gitdir: git-metadata\n');
    const nested = makeDir('gitfile-root', 'deep');
    const before = surroundingState(nested);

    const result = runIn(nested, ['init', '--auto', '--tools', 'agents']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(fs.existsSync(path.join(fake, '.work')), false);
    assertNoEscape(before, nested, 'gitfile to refused target');
  });

  test('a real Git root is still discovered from a nested directory', () => {
    const repo = makeDir('real-repo');
    makeRealGitRoot(repo);
    const nested = makeDir('real-repo', 'packages', 'app');

    const result = runIn(nested, ['init', '--auto', '--tools', 'agents']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.ok(fs.existsSync(path.join(repo, '.work', 'config.json')),
      'the repository root must receive the workspace');
    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false,
      'the nested directory must not become a second root');
  });

  test('a real linked worktree is admitted as its own root', () => {
    const main = makeDir('worktree-main');
    makeRealGitRoot(main);
    spawnSync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture',
      'commit', '--allow-empty', '-qm', 'seed'], { cwd: main, encoding: 'utf-8' });
    const linked = path.join(sandbox, 'worktree-linked');
    const added = spawnSync('git', ['worktree', 'add', '-q', linked], { cwd: main, encoding: 'utf-8' });
    assert.strictEqual(added.status, 0, `git worktree add failed: ${added.stderr}`);
    const nested = path.join(linked, 'packages');
    fs.mkdirSync(nested, { recursive: true });

    const result = runIn(nested, ['init', '--auto', '--tools', 'agents']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.ok(fs.existsSync(path.join(linked, '.work', 'config.json')),
      'a linked worktree is a valid root when the probe succeeds');
    assert.strictEqual(fs.existsSync(path.join(main, '.work')), false,
      'the main worktree must not be written by an init inside the linked one');
  });

  test('a .work at exactly os.tmpdir() is not captured from a subdirectory', () => {
    const fakeTmp = makeDir('fake-tmp');
    const env = { TEMP: fakeTmp, TMP: fakeTmp, TMPDIR: fakeTmp };
    // Overriding TMPDIR removes the real temp root's sentinel from this child's walk, so the fixture
    // must supply its own boundary: a real Git root at the sandbox means no walk from inside it can
    // reach the developer's actual home directory even if the sentinel logic regresses. Review
    // measured the unbounded version reaching the real home profile, where it would have adopted a
    // home `.work` had one existed.
    makeRealGitRoot(sandbox);
    // Seed by naming the target, so the seeding call itself performs no upward walk.
    const seeded = runIn(fakeTmp, ['init', '--workspace-root', fakeTmp, '--auto', '--tools', 'agents'], env);
    assert.strictEqual(seeded.exitCode, 0, seeded.output);
    assert.ok(fs.existsSync(path.join(fakeTmp, '.work')), 'fixture must seed a workspace at the temp root');

    const nested = makeDir('fake-tmp', 'below');
    const tmpRootBefore = markerState(path.join(fakeTmp, '.work'));

    const result = runIn(nested, ['init', '--auto', '--tools', 'agents'], env);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(markerState(path.join(fakeTmp, '.work')), tmpRootBefore,
      'the temp-root workspace must not be captured or rewritten from a subdirectory');
    assert.ok(fs.existsSync(path.join(nested, '.work', 'config.json')),
      'the subdirectory must receive its own workspace instead');
  });

  // Pinned baseline, not an endorsement. Owner decision 17 kept `.work` ancestor discovery because
  // eight existing tests treat it as intended monorepo behaviour, and reopened "should `.work` walk
  // at all" as its own question. This test records exactly what is true today so that question is
  // answered against a measurement rather than a memory.
  // The regression this fix was rejected for on its first review. Standing IN `os.tmpdir()` with no
  // marker there, the walk must terminate at the temp root. An earlier version replaced the
  // terminating sentinel with an ancestors-only pre-check, so the walk climbed past the temp root and
  // adopted a workspace above it -- worse than the behaviour it was fixing, and invisible to the
  // teeth proof, which reverted to the old check order and therefore never exercised depth 0.
  test('standing in os.tmpdir() itself does not climb past it to an ancestor workspace', () => {
    makeRealGitRoot(sandbox);
    const homelike = makeDir('homelike');
    const fakeTmp = makeDir('homelike', 'faketmp');
    const env = { TEMP: fakeTmp, TMP: fakeTmp, TMPDIR: fakeTmp };
    const seeded = runIn(sandbox, ['init', '--workspace-root', homelike, '--auto', '--tools', 'agents']);
    assert.strictEqual(seeded.exitCode, 0, seeded.output);
    const ancestorBefore = markerState(path.join(homelike, '.work'));

    const result = runIn(fakeTmp, ['init', '--auto', '--tools', 'agents'], env);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.strictEqual(markerState(path.join(homelike, '.work')), ancestorBefore,
      'the ancestor workspace must not be captured or rewritten from inside the temp root');
    assert.ok(fs.existsSync(path.join(fakeTmp, '.work', 'config.json')),
      'the temp root itself must receive its own workspace instead');
  });

  test('a .work at a non-temp ancestor is still discovered, which is the reopened question', () => {
    const ancestor = makeDir('ancestor-work-root');
    const seeded = runIn(ancestor, ['init', '--auto', '--tools', 'agents']);
    assert.strictEqual(seeded.exitCode, 0, seeded.output);
    const nested = makeDir('ancestor-work-root', 'unrelated', 'deep');

    const result = runIn(nested, ['next', '--json']);

    assert.strictEqual(fs.existsSync(path.join(nested, '.work')), false,
      'the nested directory must not become a second root');
    assert.ok(fs.existsSync(path.join(ancestor, '.work', 'config.json')),
      'documented current behaviour: the ancestor workspace is the resolved root');
    assert.ok(result.output.length > 0, 'the command must produce output rather than fail silently');
  });

  test('an explicit --workspace-root writes only the named target', () => {
    const repo = makeDir('explicit-origin');
    makeRealGitRoot(repo);
    const target = makeDir('explicit-target');
    const before = surroundingState(target);

    const result = runIn(repo, ['init', '--workspace-root', target, '--auto', '--tools', 'agents']);

    assert.strictEqual(result.exitCode, 0, result.output);
    assert.ok(fs.existsSync(path.join(target, '.work', 'config.json')),
      'the named target must receive the workspace');
    assert.strictEqual(fs.existsSync(path.join(repo, '.work')), false,
      'the invocation root must not be written when a target is named');
    assertNoEscape(before, target, 'explicit --workspace-root', [target]);
  });

  for (const target of [
    { name: 'a path that does not exist', make: (root) => path.join(root, 'absent') },
    { name: 'a regular file', make: (root) => { const f = path.join(root, 'a-file'); fs.writeFileSync(f, 'x'); return f; } },
  ]) {
    test(`an explicit --workspace-root refuses ${target.name} before writing`, () => {
      const repo = makeDir('refuse-origin');
      makeRealGitRoot(repo);
      const bad = target.make(sandbox);
      const before = surroundingState(repo);

      const result = runIn(repo, ['init', '--workspace-root', bad, '--auto', '--tools', 'agents']);

      assert.notStrictEqual(result.exitCode, 0, result.output);
      assert.strictEqual(fs.existsSync(path.join(repo, '.work')), false,
        'a refused target must not fall back to writing the invocation root');
      assertNoEscape(before, repo, `refused ${target.name}`);
    });
  }

  test('install --global writes only under an isolated home when GSDD_TEST_HOME is set', () => {
    const repo = makeDir('global-origin');
    makeRealGitRoot(repo);
    const fakeHome = makeDir('fake-home');
    const before = surroundingState(repo);

    // `--global --auto` alone fails closed when no agent home is detected, which an existing test
    // already pins. Name the tools so this case exercises the write path it is here to observe.
    const result = runIn(repo, ['install', '--global', '--tools', 'claude'], {
      GSDD_TEST_HOME: fakeHome,
      XDG_CONFIG_HOME: path.join(fakeHome, '.config'),
    });

    assert.strictEqual(result.exitCode, 0, result.output);
    const wroteSomething = fs.readdirSync(fakeHome).length > 0;
    assert.ok(wroteSomething, 'the isolated home must receive the global install');
    assertNoEscape(before, repo, 'install --global', [fakeHome]);
  });
});
