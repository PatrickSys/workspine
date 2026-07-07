/**
 * D-47: interactive prompts must clean up completely — no leaked keypress
 * listeners, raw mode restored, input paused — so init can never hang after
 * the last answer.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const path = require('path');
const { pathToFileURL } = require('url');

function fakeTtyInput() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.rawModeHistory = [];
  input.paused = false;
  input.resumed = false;
  input.setRawMode = (v) => { input.isRaw = v; input.rawModeHistory.push(v); };
  input.resume = () => { input.resumed = true; input.paused = false; };
  input.pause = () => { input.paused = true; };
  return input;
}
const fakeOutput = () => ({ write() {}, columns: 80 });

describe('D-47 prompt lifecycle', () => {
  test('promptChoiceList resolves on enter and cleans up stdin state', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'init-prompts.mjs')).href);
    const input = fakeTtyInput();
    const p = mod.promptChoiceList({
      input,
      output: fakeOutput(),
      title: 'pick',
      choices: [
        { id: 'a', label: 'A', description: 'a', selected: true },
        { id: 'b', label: 'B', description: 'b' },
      ],
      multi: false,
    });
    setImmediate(() => input.emit('keypress', '', { name: 'return' }));
    const values = await p;
    assert.deepStrictEqual(values, ['a']);
    assert.strictEqual(input.listenerCount('keypress'), 0, 'keypress listener must be removed');
    assert.strictEqual(input.isRaw, false, 'raw mode must be restored');
    assert.strictEqual(input.paused, true, 'input must be paused so the event loop can drain');
  });

  test('promptChoiceList cleans up on ctrl-c rejection too', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'lib', 'init-prompts.mjs')).href);
    const input = fakeTtyInput();
    const p = mod.promptChoiceList({
      input,
      output: fakeOutput(),
      title: 'pick',
      choices: [{ id: 'a', label: 'A', description: 'a', selected: true }],
      multi: false,
    });
    setImmediate(() => input.emit('keypress', '', { ctrl: true, name: 'c' }));
    await assert.rejects(p, /cancelled/i);
    assert.strictEqual(input.listenerCount('keypress'), 0);
    assert.strictEqual(input.isRaw, false);
    assert.strictEqual(input.paused, true);
  });
});
