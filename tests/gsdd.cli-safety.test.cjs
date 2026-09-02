/**
 * CLI safety — A15-44.
 *
 * Black-box proof, through the real package entry in a real child process, that:
 *   - help and version are successful and write nothing,
 *   - unknown, duplicated, and value-less flags are rejected before a mutating handler runs.
 *
 * Every case snapshots the working tree before and after and asserts it is byte-identical, because
 * the defect these tests close was `init --nonsense-flag` exiting 0 after writing four paths.
 *
 * Commands with their own richer usage output (`next`, `lifecycle-transition`) keep it; that is
 * asserted here as a regression guard rather than left implicit.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createHash } = require('crypto');
const { createTempProject, cleanup } = require('./gsdd.helpers.cjs');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'gsdd.mjs');
const HELP_MARKER = 'workspine - Workspine CLI';
const VERSION_PATTERN = /^workspine \d+\.\d+\.\d+/;

// Mutating commands that now carry an accepted-flag set. Kept in one place so a new entry in
// COMMAND_FLAGS without a test here is visible as a gap.
const GATED_COMMANDS = ['init', 'update', 'install', 'scaffold', 'file-op', 'lifecycle-transition'];

// Commands that render their own usage for --help and must not be overridden by the root help.
const OWN_HELP_COMMANDS = ['next', 'lifecycle-transition'];

function snapshot(dir) {
  const entries = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push(`dir  ${relative}`);
        walk(absolute, relative);
      } else {
        entries.push(`file ${relative} ${createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`);
      }
    }
  };
  walk(dir, '');
  return entries.join('\n');
}

function runEntry(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, WORKSPINE_UPDATE_AWARENESS: '0', GSDD_UPDATE_AWARENESS: '0' },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

// Every strict ancestor of `dir`, nearest first. Used to prove a zero-write claim is not blind to a
// containment escape: measured 2026-08-23, `init` inside a bare temp subdirectory walked up and
// initialised a workspace in the ancestor instead, so a snapshot of the invocation directory alone
// reported "no writes" while 72 files were created outside it.
function ancestorWorkStates(dir) {
  const states = new Map();
  let current = path.dirname(path.resolve(dir));
  while (true) {
    const candidate = path.join(current, '.work');
    let state = 'absent';
    if (fs.existsSync(candidate)) {
      let files = 0;
      let newest = 0;
      const walk = (at) => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
          const absolute = path.join(at, entry.name);
          if (entry.isDirectory()) walk(absolute);
          else {
            files += 1;
            newest = Math.max(newest, fs.statSync(absolute).mtimeMs);
          }
        }
      };
      try { walk(candidate); } catch { /* a racing temp cleaner is not this test's business */ }
      state = `present files=${files} newest=${newest}`;
    }
    states.set(candidate, state);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return states;
}

function assertNoAncestorEscape(before, dir, args) {
  const after = ancestorWorkStates(dir);
  for (const [candidate, state] of after) {
    assert.equal(state, before.get(candidate), `${args.join(' ')} wrote outside its directory, to ${candidate}`);
  }
}

// Runs the CLI and asserts nothing was written, inside the invocation directory OR above it.
function runZeroWrite(cwd, args) {
  const before = snapshot(cwd);
  const ancestorsBefore = ancestorWorkStates(cwd);
  const result = runEntry(cwd, args);
  assert.equal(snapshot(cwd), before, `${args.join(' ')} wrote to the working tree`);
  assertNoAncestorEscape(ancestorsBefore, cwd, args);
  return result;
}

// A verified Git root, so the CLI is contained by the admission path a real user has. Without it the
// CLI escapes to an ancestor and every containment assertion below would be measuring the wrong tree.
function createTempRepo() {
  const dir = createTempProject();
  const init = spawnSync('git', ['init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
  assert.equal(init.status, 0, `git init failed in the fixture: ${init.stderr}`);
  return dir;
}

test.describe('CLI safety: help and version are zero-write information paths', () => {
  let tmpDir;
  test.beforeEach(() => { tmpDir = createTempRepo(); });
  test.afterEach(() => { cleanup(tmpDir); });

  for (const token of ['--help', '-h', 'help']) {
    test(`\`${token}\` succeeds, prints help, and writes nothing`, () => {
      const result = runZeroWrite(tmpDir, [token]);
      assert.equal(result.exitCode, 0, result.output);
      assert.ok(result.stdout.includes(HELP_MARKER), result.output);
    });
  }

  for (const token of ['--version', '-v', '-V', 'version']) {
    test(`\`${token}\` prints one version line and writes nothing`, () => {
      const result = runZeroWrite(tmpDir, [token]);
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.stdout.trim(), VERSION_PATTERN, result.output);
      assert.equal(result.stdout.trim().split('\n').length, 1, result.output);
      assert.equal(result.stderr, '', result.output);
      assert.ok(!result.stdout.includes(HELP_MARKER), 'version printed the help text instead of a version');
    });
  }

  test('help output remains identifiable after information flags are behavior-tested', () => {
    const result = runZeroWrite(tmpDir, ['help']);
    assert.match(result.stdout, /workspine - Workspine CLI/, result.output);
  });

  test('an unknown command still fails, prints help, and writes nothing', () => {
    const result = runZeroWrite(tmpDir, ['definitely-not-a-command']);
    assert.equal(result.exitCode, 1, result.output);
    assert.ok(result.stdout.includes(HELP_MARKER), result.output);
  });

  test('no command at all prints help and succeeds', () => {
    const result = runZeroWrite(tmpDir, []);
    assert.equal(result.exitCode, 0, result.output);
    assert.ok(result.stdout.includes(HELP_MARKER), result.output);
  });

  for (const command of GATED_COMMANDS) {
    test(`\`${command} --version\` is a zero-write information path`, () => {
      const result = runZeroWrite(tmpDir, [command, '--version']);
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.stdout.trim(), VERSION_PATTERN, result.output);
    });
  }

  for (const command of GATED_COMMANDS.filter((name) => !OWN_HELP_COMMANDS.includes(name))) {
    test(`\`${command} --help\` is a zero-write information path`, () => {
      const result = runZeroWrite(tmpDir, [command, '--help']);
      assert.equal(result.exitCode, 0, result.output);
      assert.ok(result.stdout.includes(HELP_MARKER), result.output);
    });
  }

  for (const command of OWN_HELP_COMMANDS) {
    test(`\`${command} --help\` keeps its own usage rather than the root help`, () => {
      const result = runZeroWrite(tmpDir, [command, '--help']);
      assert.equal(result.exitCode, 0, result.output);
      assert.ok(!result.stdout.includes(HELP_MARKER), `${command} --help was overridden by the root help`);
    });
  }

  test('a positional argument reading "help" is not mistaken for a help request', () => {
    // `remember` is not flag-gated and writes only on a valid record; the point here is that the
    // bare word never short-circuits into the help text.
    const result = runZeroWrite(tmpDir, ['remember', 'help', '--type', 'lesson']);
    assert.ok(!result.stdout.includes(HELP_MARKER), result.output);
  });
});

test.describe('CLI safety: invalid flags are rejected before any write', () => {
  let tmpDir;
  test.beforeEach(() => { tmpDir = createTempRepo(); });
  test.afterEach(() => { cleanup(tmpDir); });

  for (const command of GATED_COMMANDS) {
    test(`\`${command}\` rejects an unknown flag with exit 1 and no writes`, () => {
      const result = runZeroWrite(tmpDir, [command, '--definitely-not-a-flag']);
      assert.equal(result.exitCode, 1, result.output);
      assert.match(result.output, /Unknown flag/, result.output);
    });
  }

  test('init rejects a duplicated flag', () => {
    const result = runZeroWrite(tmpDir, ['init', '--auto', '--auto']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /Duplicate flag/, result.output);
  });

  test('init reports its own specific message when a flag value is missing', () => {
    const result = runZeroWrite(tmpDir, ['init', '--tools']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /requires a value/, result.output);
  });

  test('init rejects a flag whose value was swallowed by the next flag', () => {
    const result = runZeroWrite(tmpDir, ['init', '--tools', '--auto']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /requires a value/, result.output);
  });

  test('update rejects a flag misplaced from another command', () => {
    const result = runZeroWrite(tmpDir, ['update', '--migrate']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /Unknown flag/, result.output);
  });

  test('the exact regression: init with an unknown flag no longer initialises a workspace', () => {
    const result = runZeroWrite(tmpDir, ['init', '--nonsense-flag']);
    assert.equal(result.exitCode, 1, result.output);
    for (const leaked of ['.work', '.agents', '.gitignore', 'goal.md']) {
      assert.ok(!fs.existsSync(path.join(tmpDir, leaked)), `init --nonsense-flag created ${leaked}`);
    }
  });
});

test.describe('CLI safety: every mutator rejects all malformed classes before update awareness', () => {
  let tmpDir;
  test.beforeEach(() => { tmpDir = createTempRepo(); });
  test.afterEach(() => { cleanup(tmpDir); });

  const malformedByFamily = {
    init: {
      unknown: ['init', '--bad'], duplicate: ['init', '--auto', '--auto'],
      missing: ['init', '--tools'], positional: ['init', 'trailing'],
    },
    install: {
      unknown: ['install', '--bad'], duplicate: ['install', '-g', '-g'],
      missing: ['install', '--tools'], positional: ['install', '--global', 'trailing'],
    },
    update: {
      unknown: ['update', '--bad'], duplicate: ['update', '--dry-run', '--dry-run'],
      missing: ['update', '--workspace-root'], positional: ['update', 'trailing'],
    },
    'file-op': {
      unknown: ['file-op', 'delete', 'target', '--bad'], duplicate: ['file-op', 'delete', 'target', '--missing', 'ok', '--missing', 'fail'],
      missing: ['file-op', 'delete', 'target', '--missing'], positional: ['file-op', 'copy', 'source', 'destination', 'trailing'],
    },
    'lifecycle-preflight': {
      unknown: ['lifecycle-preflight', 'progress', '--bad'], duplicate: ['lifecycle-preflight', 'progress', '--expects-mutation', 'one', '--expects-mutation', 'two'],
      missing: ['lifecycle-preflight', 'progress', '--expects-mutation'], positional: ['lifecycle-preflight', 'progress', 'phase', 'trailing'],
    },
    'lifecycle-transition': {
      unknown: ['lifecycle-transition', 'execute', '--bad'], duplicate: ['lifecycle-transition', 'execute', '--authority', 'owner', '--authority', 'owner'],
      missing: ['lifecycle-transition', 'execute', '--plan'], positional: ['lifecycle-transition', 'execute', 'trailing'],
    },
    scaffold: {
      unknown: ['scaffold', 'phase', '1', '--bad'], duplicate: ['scaffold', 'phase', '1', '--workspace-root', 'one', '--workspace-root', 'two'],
      missing: ['scaffold', 'phase', '1', '--workspace-root'], positional: ['scaffold', 'phase', '1', 'name', 'extra'],
    },
    'phase-status': {
      unknown: ['phase-status', '1', 'done', '--bad'], duplicate: ['phase-status', '1', 'done', '--workspace-root', 'one', '--workspace-root', 'two'],
      missing: ['phase-status', '1', 'done', '--workspace-root'], positional: ['phase-status', '1', 'done', 'extra'],
    },
    remember: {
      unknown: ['remember', 'candidate', '--bad'], duplicate: ['remember', 'candidate', '--type', 'rule', '--type', 'lesson'],
      missing: ['remember', 'candidate', '--type'], positional: ['remember', 'candidate', 'extra'],
    },
    decisions: {
      unknown: ['decisions', 'query', 'terms', '--bad'], duplicate: ['decisions', 'query', 'terms', '--path', 'one', '--path', 'two'],
      missing: ['decisions', 'invalidate', 'id', '--reason'], positional: ['decisions', 'query', 'terms', 'extra'],
    },
    next: {
      unknown: ['next', 'graph', 'rebuild', '--bad'], duplicate: ['next', 'question', 'add', '--id', 'q1', '--id', 'q2', '--prompt', 'Question'],
      missing: ['next', 'question', 'add', '--id'], positional: ['next', 'graph', 'rebuild', 'extra'],
    },
    models: {
      unknown: ['models', 'set', '--bad'], duplicate: ['models', 'set', '--runtime', 'codex', '--runtime', 'claude', '--agent', 'plan-checker', '--model', 'model'],
      missing: ['models', 'set', '--runtime'], positional: ['models', 'set', 'extra'],
    },
    rigor: {
      unknown: ['rigor', 'high', '--bad'], duplicate: ['rigor', 'plan', 'high', 'high'],
      missing: ['rigor', 'plan'], positional: ['rigor', 'high', 'extra'],
    },
  };

  for (const [family, cases] of Object.entries(malformedByFamily)) {
    test(`${family} rejects unknown, duplicate, missing-value, and positional malformed input without writing`, () => {
      for (const [kind, args] of Object.entries(cases)) {
        const result = runZeroWrite(tmpDir, args);
        assert.equal(result.exitCode, 1, `${family}/${kind}: ${result.output}`);
        assert.match(result.output, /Unknown flag|Duplicate flag|requires a value|Malformed/, `${family}/${kind}: ${result.output}`);
      }
    });
  }

  test('a missing workspace-root value is not swallowed by --version', () => {
    const result = runZeroWrite(tmpDir, ['init', '--workspace-root', '--version']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /requires a value/, result.output);
  });

  const crossOperationFlags = [
    ['file-op', ['file-op', 'copy', 'source', 'destination', '--flags', 'i']],
    ['lifecycle-transition', ['lifecycle-transition', 'approve', '--question', 'wrong operation']],
    ['next', ['next', 'graph', 'rebuild', '--prompt', 'wrong operation']],
    ['models', ['models', 'set', '--runtime', 'codex', '--agent', 'plan-checker', '--model', 'model', '--profile', 'quality']],
  ];
  for (const [family, args] of crossOperationFlags) {
    test(`${family} rejects a flag owned by a different operation without writing`, () => {
      const result = runZeroWrite(tmpDir, args);
      assert.equal(result.exitCode, 1, result.output);
      assert.match(result.output, /not valid for this .* operation/, result.output);
    });
  }

  test('next preserves its JSON error envelope for operation-specific grammar rejection', () => {
    const result = runZeroWrite(tmpDir, ['next', 'graph', 'rebuild', '--prompt', 'wrong operation', '--json']);
    assert.equal(result.exitCode, 1, result.output);
    const body = JSON.parse(result.stdout);
    assert.equal(body.operation, 'next');
    assert.equal(body.status, 'error');
  });

  test('next graph rebuild retains its documented --format selector', () => {
    const result = runZeroWrite(tmpDir, ['next', 'graph', 'rebuild', '--format', 'json']);
    assert.ok(!/not valid for this next operation/.test(result.output), result.output);
  });

  test('lifecycle-transition preserves its JSON error envelope for operation-specific grammar rejection', () => {
    const result = runZeroWrite(tmpDir, ['lifecycle-transition', 'approve', '--question', 'wrong operation', '--json']);
    assert.equal(result.exitCode, 1, result.output);
    const body = JSON.parse(result.stdout);
    assert.equal(body.operation, 'lifecycle-transition');
    assert.equal(body.status, 'error');
    assert.equal(body.error_code, 'invalid_arguments');
    assert.deepEqual(body.evidence, []);
    assert.equal(body.changed, false);
  });

  test('lifecycle-preflight retains the packed consumer --json route', () => {
    const result = runZeroWrite(tmpDir, ['lifecycle-preflight', 'progress', '--json']);
    assert.ok(!/Unknown flag/.test(result.output), result.output);
  });
});

test.describe('CLI safety: existing contracts are preserved', () => {
  let tmpDir;
  test.beforeEach(() => { tmpDir = createTempRepo(); });
  test.afterEach(() => { cleanup(tmpDir); });

  test('install still accepts its -g short flag rather than rejecting it as unknown', () => {
    const result = runEntry(tmpDir, ['install', '-g', '--dry', '--tools', 'claude']);
    assert.ok(!/Unknown flag/.test(result.output), result.output);
  });

  test('install keeps its specific message for the recognised-but-refused --local', () => {
    const result = runZeroWrite(tmpDir, ['install', '--local']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /local project installation is/, result.output);
    assert.ok(!/Unknown flag/.test(result.output), 'a specific refusal was replaced by the generic one');
  });

  test('install keeps its specific message for the recognised-but-refused runtime probes', () => {
    const result = runZeroWrite(tmpDir, ['install', '--global', '--verify-runtime']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /runtime probing is not part of the public install command/, result.output);
  });

  test('install without --global keeps its own guidance', () => {
    const result = runZeroWrite(tmpDir, ['install']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /install currently requires --global/, result.output);
  });

  test('read-only commands are not flag-gated and still run', () => {
    // `health` accepts --json and is absent from COMMAND_FLAGS; gating it would be scope creep.
    const result = runZeroWrite(tmpDir, ['health', '--json']);
    assert.ok(!/Unknown flag/.test(result.output), result.output);
  });

  test('the legacy rigor alias set still resolves', () => {
    for (const alias of ['quick', 'balanced', 'thorough']) {
      const result = runZeroWrite(tmpDir, ['rigor', alias]);
      assert.ok(!/Malformed rigor command shape/.test(result.output), `${alias}: ${result.output}`);
      assert.ok(!/Invalid rigor argument/.test(result.output), `${alias}: ${result.output}`);
    }
  });
});

// `update` only reaches its adapter-writing path in a workspace that is already initialised. A bare
// temp directory always short-circuits on "no adapters found", which hid a real defect: a malformed
// `--tools` fell through as an empty list and regenerated whatever was installed. These cases pay the
// cost of a real init so the write path is actually exercised.
test.describe('CLI safety: an initialised workspace still refuses malformed mutating flags', () => {
  let tmpDir;

  test.beforeEach(() => {
    tmpDir = createTempRepo();
    const initialised = runEntry(tmpDir, ['init', '--auto', '--tools', 'claude']);
    assert.equal(initialised.exitCode, 0, initialised.output);
    assert.ok(fs.existsSync(path.join(tmpDir, '.work')), 'fixture init did not create .work');
  });

  test.afterEach(() => { cleanup(tmpDir); });

  test('update retires the --tools selector before any write', () => {
    const result = runZeroWrite(tmpDir, ['update', '--tools', '--evil-unknown']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /Unknown flag.*--tools/, result.output);
  });

  test('update rejects the retired --tools selector with no value, and writes nothing', () => {
    const result = runZeroWrite(tmpDir, ['update', '--tools']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /Unknown flag.*--tools/, result.output);
  });

  test('update still refuses an unknown flag once a workspace exists', () => {
    const result = runZeroWrite(tmpDir, ['update', '--definitely-not-a-flag']);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /Unknown flag/, result.output);
  });

  test('a valid plain update in the same workspace is still permitted', () => {
    const result = runEntry(tmpDir, ['update']);
    assert.equal(result.exitCode, 0, result.output);
    assert.ok(!/Unknown flag|requires a value/.test(result.output), result.output);
  });
});
