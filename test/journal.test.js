import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, tabOpened } from '../src/core.js';
import { DWELL, attend, placesOf } from '../src/journal.js';

/** Three open tabs, 1 2 3, showing nodes named a b c. */
function browsing() {
  const state = createState();
  for (const [id, name] of [[1, 'a'], [2, 'b'], [3, 'c']]) tabOpened(state, { id, url: `https://${name}.example/`, title: name });
  return state;
}
const places = (state) => placesOf(state).map((entry) => state.library.nodes[entry.node].title).join(' ');
const STAY = DWELL + 1;

test('where the user was, newest first, each place once, without where they are now', () => {
  const state = browsing();
  let at = 0;
  for (const tab of [1, 2, 3, 1, 3]) attend(state, tab, (at += STAY));
  assert.equal(places(state), 'a b'); // At c now; before that a, before that b.
  attend(state, 2, (at += STAY));
  assert.equal(places(state), 'c a'); // b, being where the user is, is not in the list.
  assert.equal(state.journal.length, 3);
  assert.deepEqual(state.journal.map((entry) => entry.at), [at, at - STAY, at - 3 * STAY]);
});

test('tabs flicked through leave no trace', () => {
  const state = browsing();
  attend(state, 1, 0);
  attend(state, 2, STAY); // Left a after a real stay...
  attend(state, 3, STAY + 100); // ...passed b in a tenth of a second...
  attend(state, 1, STAY + 200); // ...and c: back at a.
  assert.equal(places(state), '');
  assert.deepEqual(state.journal.map((entry) => state.library.nodes[entry.node].title), ['a']);
});

test('a tab with no node, or no tab at all, ends the visit; staying on the same node does not', () => {
  const state = browsing();
  attend(state, 1, 0);
  attend(state, 1, 500); // The same tab again (its window came to the front).
  assert.equal(state.attention.since, 0);
  attend(state, 99, STAY); // The settings page, say.
  assert.equal(state.attention, undefined);
  assert.equal(places(state), 'a');
  attend(state, undefined, 2 * STAY);
  attend(state, 2, 3 * STAY);
  assert.equal(places(state), 'a');
});

test('a node that is gone is not a place to go back to', () => {
  const state = browsing();
  attend(state, 1, 0);
  attend(state, 2, STAY);
  delete state.library.nodes[state.binding[1].node];
  assert.equal(places(state), '');
});
