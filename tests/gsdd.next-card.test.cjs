/**
 * GSDD next-card snapshot
 * Locks the plain boxed `gsdd next` card to a golden fixture.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const NEXT_MJS = path.join(__dirname, '..', 'bin', 'lib', 'next.mjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'next-card-plan.txt');

function readGolden() {
  return fs.readFileSync(FIXTURE, 'utf-8').replace(/\r\n/g, '\n').replace(/\n$/, '');
}

describe('next card snapshot', () => {
  test('renderNextCard matches the golden plain card for a fixed plan packet', async () => {
    const { renderNextCard } = await import(pathToFileURL(NEXT_MJS).href);
    const packet = {
      state: 'plan',
      reason: 'A goal exists but there is no plan yet.',
      next_action: { type: 'workflow_skill', skill_id: 'work-plan' },
      next_command: 'work-plan',
      requires_user: false,
    };
    assert.strictEqual(renderNextCard(packet), readGolden());
  });
});
