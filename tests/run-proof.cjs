/**
 * Staleness lane for tests/proof/.
 *
 * Deliberately NOT an execution lane, and deliberately NOT part of tests/run-all.cjs.
 * Owner ruling O17, 2026-08-20: proof runners get their own lane rather than widening the
 * `*.test.cjs` glob at tests/run-all.cjs:12, which would make the 208-second suite pay
 * their cost on every run.
 *
 * Why it checks instead of runs. Nine of the ten runners gate on provenance, for example
 * tests/proof/phase05-workspace-authority.cjs:122
 *   if (dev) need(head === CANDIDATE, 'provenance_failure', ...)
 * They are one-shot acceptance proofs bound to a specific candidate commit, and their own
 * headers say they stay outside ordinary test discovery on purpose. Executing them at every
 * gate boundary would be red forever by design, and a permanently red gate teaches everyone
 * to ignore it.
 *
 * What this lane is actually for, in order of value:
 *   1. It states, per runner, whether that runner can ever run again at the current HEAD.
 *      Nothing else in the repository says this, and it is the fact a reader most needs.
 *   2. It fails if a runner stops parsing.
 *   3. It fails if an object a runner pins is no longer in this repository, which is the
 *      observable signature of the history rewrite that R29 forbids.
 *
 * A fourth check was attempted and removed rather than shipped: asserting that each runner
 * names the package its own pinned candidate publishes. Every pinned candidate here predates
 * the rename and publishes `gsdd-cli`, so a grep for retired names is wrong by construction -
 * for these runners the retired name is the correct one. The stronger form, comparing
 * referenced install names against `git show <candidate>:package.json`, was tested against
 * the one historical commit that could have tripped it and did not trip. It was vacuous, and
 * a vacuous check that reads as coverage is worse than no check. The runners already solve
 * this properly by deriving packageName from the candidate's own package.json at runtime.
 *
 * Run it at gate boundaries beside `node tests/run-all.cjs`. It is fast: no packing, no
 * installs, no network.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROOF_DIR = path.join(__dirname, 'proof');
const REPO = path.resolve(__dirname, '..');
const SHA_RE = /'([0-9a-f]{40})'/g;
const PROVENANCE_RE = /provenance_failure|head === CANDIDATE|=== FIXED_CANDIDATE/;

const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf-8' });

const listed = git(['ls-files', 'tests/proof']);
if (listed.status !== 0) {
  console.log('SKIP  git is unavailable, so tracked and untracked runners cannot be told apart');
  process.exit(0);
}
const tracked = new Set(
  listed.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((p) => path.basename(p)),
);

const files = fs.readdirSync(PROOF_DIR).filter((f) => f.endsWith('.cjs')).sort();
const findings = [];
const rows = [];

for (const file of files) {
  const rel = `tests/proof/${file}`;
  const isTracked = tracked.has(file);
  const full = path.join(PROOF_DIR, file);
  const source = fs.readFileSync(full, 'utf-8');

  const check = spawnSync(process.execPath, ['--check', full], { encoding: 'utf-8' });
  if (check.status !== 0) {
    findings.push({ rel, isTracked, what: 'does not parse', detail: (check.stderr || '').trim().split('\n')[0] });
  }

  const shas = [...new Set([...source.matchAll(SHA_RE)].map((m) => m[1]))];
  let commits = 0;
  for (const sha of shas) {
    const t = git(['cat-file', '-t', sha]);
    const kind = t.status === 0 ? t.stdout.trim() : 'missing';
    if (kind === 'missing') {
      findings.push({ rel, isTracked, what: 'orphaned pin', detail: `${sha} is no longer an object in this repository` });
    } else if (kind === 'commit') {
      commits += 1;
    }
  }

  rows.push({
    rel,
    isTracked,
    bound: PROVENANCE_RE.test(source) || commits > 0,
    pins: shas.length,
  });
}

console.log('tests/proof staleness lane\n');
for (const r of rows) {
  const kind = r.bound ? 'candidate-bound, cannot re-run at another HEAD' : 'repeatable against current HEAD';
  console.log(`  ${r.isTracked ? 'tracked  ' : 'untracked'}  ${r.rel}`);
  console.log(`             ${kind}${r.pins ? `, ${r.pins} pinned object(s)` : ''}`);
}

const hard = findings.filter((f) => f.isTracked);
const soft = findings.filter((f) => !f.isTracked);

if (soft.length) {
  console.log('\nUNTRACKED, reported and not failed. These files are not in git, so no sweep, gate');
  console.log('or rename pass can see them, and this lane cannot hold them to a contract either.');
  for (const f of soft) console.log(`  ~ ${f.rel}: ${f.what} - ${f.detail}`);
}

if (hard.length) {
  console.log(`\n${hard.length} finding(s) in tracked proof runners:`);
  for (const f of hard) console.log(`  x ${f.rel}: ${f.what} - ${f.detail}`);
  console.log('\nThese are stale-artifact findings, not test failures. Changing a Phase 05 proof');
  console.log('runner changes what it proves, so each one needs a decision rather than a patch.');
  process.exit(1);
}

const repeatable = rows.filter((r) => !r.bound);
console.log(`\nCLEAN (${rows.length} runners checked, ${rows.length - repeatable.length} candidate-bound, `
  + `${repeatable.length} repeatable)`);
if (repeatable.length) {
  console.log('Repeatable, so runnable by hand at any HEAD:');
  for (const r of repeatable) console.log(`  node ${r.rel}`);
}
process.exit(0);
