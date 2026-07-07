/**
 * Runs every tests/*.test.cjs SEQUENTIALLY and reports ALL failures.
 * Replaces the old `a && b && c` chain, which stopped at the first red file
 * and masked every failure after it (bit M0c twice).
 * Known, named debts live in tests/known-failures.json.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.cjs')).sort();
const known = JSON.parse(fs.readFileSync(path.join(testsDir, 'known-failures.json'), 'utf-8')).allowed;
const stripAnsi = (text) => String(text).replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
const parentSuitePattern = /^(?:G|I)\d+[a-z]?\b/;

function parseFailedTests(output) {
  const cleanOutput = stripAnsi(output);
  const failureSummary = cleanOutput.includes('✖ failing tests:')
    ? cleanOutput.split('✖ failing tests:').pop()
    : cleanOutput;
  const names = [
    ...failureSummary.matchAll(/^[^\S\n]*✖ (.+?)(?: \(|$)/gmu),
    ...cleanOutput.matchAll(/^[^\S\n]*not ok \d+ - (.+?)$/gmu),
  ].map((m) => m[1].trim());
  const leafNames = names.filter((name) => !parentSuitePattern.test(name));
  return [...new Set(leafNames.length ? leafNames : names)];
}

let hardFailures = 0;
for (const file of files) {
  const rel = `tests/${file}`;
  const r = spawnSync(process.execPath, [path.join(testsDir, file)], { encoding: 'utf-8' });
  if (r.status === 0) {
    console.log(`PASS ${rel}`);
    continue;
  }
  const combinedOutput = r.stdout + r.stderr;
  const failedTests = parseFailedTests(combinedOutput);
  const unexpected = failedTests.filter((t) => !known.some((k) => k.file === rel && t.includes(k.test)));
  if (failedTests.length > 0 && unexpected.length === 0) {
    console.log(`PASS ${rel} (known failures only: ${failedTests.join('; ')})`);
    continue;
  }
  hardFailures += 1;
  console.log(`FAIL ${rel}`);
  for (const t of (unexpected.length ? unexpected : ['<could not parse failing test names — full output below>'])) console.log(`  ✖ ${t}`);
  if (unexpected.length === 0) console.log(combinedOutput.slice(-2000));
}
console.log(hardFailures === 0 ? `ALL GREEN (${files.length} files; known debts tolerated per known-failures.json)` : `${hardFailures} file(s) with unexpected failures`);
process.exit(hardFailures === 0 ? 0 : 1);
