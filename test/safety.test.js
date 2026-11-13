import test from 'node:test';
import assert from 'node:assert/strict';
import { warningOf } from '../src/safety.js';

const DAY = 24 * 3600 * 1000;
const now = 1000 * DAY;
/** A library nobody else holds, never saved to a file: the case to warn of. Each test changes one thing. */
const alone = { nodes: 200, sync: undefined, unsynced: 0, met: false, now };
const kind = (facts) => warningOf({ ...alone, ...facts })?.kind;

test('a library kept nowhere else, and not saved to a file lately, is warned of', () => {
  assert.equal(kind({}), 'backup');
  assert.equal(kind({ savedAt: now - 15 * DAY }), 'backup');
  assert.equal(kind({ nodes: 20 }), 'backup');
});

test('each thing that keeps it safe is enough to say nothing', () => {
  assert.equal(kind({ nodes: 19 }), undefined); // Not much to lose yet.
  assert.equal(kind({ savedAt: now - 13 * DAY }), undefined); // Saved to a file two weeks ago or less.
  assert.equal(kind({ sync: { repo: 'me/library', at: now - 2 * DAY } }), undefined); // GitHub has it.
  assert.equal(kind({ met: true }), undefined); // Another computer shares it through the browser.
  assert.equal(kind({ closedAt: now - DAY }), undefined); // Told, and put off.
});

test('what looks safe and is not', () => {
  assert.equal(kind({ met: true, unsynced: 300 }), 'backup'); // The browser's storage holds only a part.
  assert.equal(kind({ sync: { repo: 'me/library', at: now - 4 * DAY } }), 'backup'); // GitHub last heard of it four days ago.
  assert.equal(kind({ sync: { repo: 'me/library', at: now - DAY, error: 'GitHub 401' } }), 'backup'); // Failing since yesterday: the file is the answer.
  assert.equal(kind({ closedAt: now - 15 * DAY }), 'backup'); // Put off two weeks ago: it is back.
});

test('GitHub failing for days is said as such, with its error', () => {
  assert.deepEqual(warningOf({ ...alone, sync: { repo: 'me/library', at: now - 4 * DAY, error: 'GitHub 401' } }), { kind: 'sync', error: 'GitHub 401' });
  assert.deepEqual(warningOf({ ...alone, sync: { repo: 'me/library', error: 'GitHub 404' } }), { kind: 'sync', error: 'GitHub 404' }); // Never worked.
  assert.equal(kind({ sync: { repo: 'me/library', at: now - 4 * DAY, error: 'x' }, met: true }), undefined); // The browser has it meanwhile.
});
