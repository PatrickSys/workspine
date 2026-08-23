const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'index.js');

function run(args = []) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

assert.equal(run(), 'Hello, world!\n');
assert.equal(run(['--name', 'Ada']), 'Hello, Ada!\n');

console.log('hello-proof tests passed');
