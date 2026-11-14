import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, rowsOf, setCollapsed } from '../src/model.js';
import { freeName, modeOf, nameFor, narrowedTo, savedWith, stillPicked, topmost, withLeads, withSaved } from '../src/panel/filter.js';

/** A library from an outline: a dot per level, ids are the names. */
function library(outline) {
  const lib = createLibrary();
  const above = [];
  for (const word of outline.split(' ')) {
    const depth = word.lastIndexOf('.') + 1;
    const id = word.slice(depth);
    addNode(lib, MAIN, { id, url: `https://${id}/`, title: id }, depth ? above[depth - 1] : ROOT);
    above[depth] = id;
  }
  return lib;
}
const shown = (rows) => rows.map((row) => `${'.'.repeat(row.depth)}${row.id}${row.lead ? '~' : ''}${row.hidden ? `(${row.hidden})` : ''}`).join(' ');
const through = (lib, picked, at = Infinity) => shown(rowsOf(narrowedTo(lib, MAIN, { picked, at }), MAIN));
const hiding = (lib, picked) => shown(rowsOf(narrowedTo(lib, MAIN, { picked, mode: 'hide', at: Infinity }), MAIN));

test('hidden nodes are absent, each with what is under it, and the tree keeps its shape', () => {
  const lib = library('a .b ..c ..d .e f g .h');
  assert.equal(hiding(lib, ['b', 'f']), 'a .e g .h');
  assert.equal(hiding(lib, ['d', 'g']), 'a .b ..c .e f');
  setCollapsed(lib, MAIN, 'a', true);
  assert.equal(hiding(lib, ['b']), 'a(1) f g .h'); // A folded row counts what is left under it.
  assert.equal(modeOf({ picked: ['b'], at: 0 }), 'only'); // A filter kept before there were two meanings.
});

test('ticked nodes are shown alone, each with what is under it, from depth nothing', () => {
  const lib = library('a .b ..c ..d .e f g .h');
  assert.equal(through(lib, ['b']), 'b .c .d');
  assert.equal(through(lib, ['h', 'b']), 'b .c .d h'); // In the order of the tree, whatever the order of ticking.
  assert.equal(through(lib, ['a', 'c']), 'a .b ..c ..d .e'); // One under another ticked one comes with it, once.
  assert.equal(through(lib, ['gone', 'f']), 'f');
  assert.equal(through(lib, []), '');
});

test('seen through a filter, a tree folds as it always does', () => {
  const lib = library('a .b ..c ..d .e f');
  setCollapsed(lib, MAIN, 'b', true);
  assert.equal(through(lib, ['a']), 'a .b(2) .e');
  assert.equal(through(lib, ['b']), 'b(2)');
  // The library itself is not touched.
  assert.deepEqual(lib.trees[MAIN].children[ROOT], ['a', 'f']);
});

test('the ticked nodes that count', () => {
  const { trees } = library('a .b ..c .d e');
  assert.deepEqual(topmost(trees[MAIN], ['e', 'c', 'b', 'nobody']), ['b', 'e']);
});

test('what is wanted comes with the rows that lead to it, and those are marked', () => {
  const rows = rowsOf(library('a .b ..c ..d .e f'), MAIN, true);
  assert.equal(shown(withLeads(rows, new Set(['d']))), 'a~ .b~ ..d');
  assert.equal(shown(withLeads(rows, new Set(['b', 'f']))), 'a~ .b f');
  assert.equal(shown(withLeads(rows, new Set())), '');
});

test('what a filter ticked counts while it is in the tree', () => {
  const { trees } = library('a .b ..c .d e');
  assert.deepEqual(stillPicked(trees[MAIN], ['c', 'gone', 'b']), ['b']);
  assert.deepEqual(stillPicked(trees[MAIN], ['gone']), []);
  assert.deepEqual(stillPicked(trees[MAIN], ['e', 'a']), ['a', 'e']);
  assert.deepEqual(stillPicked(undefined, ['e']), []); // The tree itself is gone.
  assert.deepEqual(stillPicked(trees[MAIN], undefined), []); // A filter of an older shape.
});

test('a filter survives the removal and return of its node', () => {
  const picked = ['b', 'e']; // As the user said it: kept so, whatever happens to the tree.
  const whole = library('a .b ..c e');
  const without = library('a e'); // b is removed, with what is under it,
  assert.deepEqual(stillPicked(without.trees[MAIN], picked), ['e']);
  assert.equal(shown(rowsOf(narrowedTo(without, MAIN, { picked, at: 0 }), MAIN)), 'e');
  // and brought back (an undo): it is ticked as before, for nothing was taken out of the filter.
  assert.deepEqual(stillPicked(whole.trees[MAIN], picked), ['b', 'e']);
  assert.equal(shown(rowsOf(narrowedTo(whole, MAIN, { picked, at: 0 }), MAIN)), 'b .c e');
  assert.deepEqual(picked, ['b', 'e']);
});

test('saving a filter, and knowing a saved one', () => {
  let saved = withSaved([], 'work', { picked: ['a', 'b'] });
  saved = withSaved(saved, 'read', { picked: ['c'], mode: 'hide' });
  assert.deepEqual(saved.map((each) => each.name), ['work', 'read']);
  const { trees } = library('a b c d');
  const only = (picked) => ({ picked, mode: 'only' });
  assert.equal(savedWith(trees[MAIN], saved, only(['b', 'a'])).name, 'work'); // The same nodes, in whatever order.
  assert.equal(savedWith(trees[MAIN], saved, only(['a'])), undefined);
  assert.equal(savedWith(trees[MAIN], saved, only(['a', 'b', 'c'])), undefined);
  assert.equal(savedWith(library('a c').trees[MAIN], saved, only(['a'])).name, 'work'); // By what it ticks now: b is gone.
  // The same nodes hidden are another filter than the same nodes shown alone.
  assert.equal(savedWith(trees[MAIN], saved, only(['c'])), undefined);
  assert.equal(savedWith(trees[MAIN], saved, { picked: ['c'], mode: 'hide' }).name, 'read');
  // The name offered for a new one is not a name taken.
  assert.equal(freeName(saved, 'play'), 'play');
  assert.equal(freeName(saved, 'work'), 'work 2');
  assert.equal(freeName([...saved, { name: 'work 2', picked: [] }], 'work'), 'work 3');
  // The same name again takes its place.
  saved = withSaved(saved, 'work', { picked: ['d'] });
  assert.deepEqual(saved, [{ name: 'work', picked: ['d'], mode: 'only' }, { name: 'read', picked: ['c'], mode: 'hide' }]);
});

test('what ticked nodes are called together', () => {
  assert.equal(nameFor(['Inbox']), 'Inbox');
  assert.equal(nameFor(['Inbox', 'A very long title of a page somewhere']), 'Inbox · A very long title…');
  assert.equal(nameFor(['a', 'b', 'c', 'd']), 'a · b +2');
});

test('what came after the filter was set is always shown: the filter took away only what was there to see', () => {
  const lib = library('a .b ..c .d e');
  for (const node of Object.values(lib.nodes)) node.added = 100;
  // Added later: a page under a ticked one, one under a page that was not ticked, one at the top, and one under that.
  addNode(lib, MAIN, { id: 'n1', url: 'https://n1/', title: 'n1', added: 300 }, 'b');
  addNode(lib, MAIN, { id: 'n2', url: 'https://n2/', title: 'n2', added: 300 }, 'd');
  addNode(lib, MAIN, { id: 'n3', url: 'https://n3/', title: 'n3', added: 300 });
  addNode(lib, MAIN, { id: 'n4', url: 'https://n4/', title: 'n4', added: 300 }, 'n3');
  assert.equal(through(lib, ['b'], 200), 'b .c .n1 n2 n3 .n4'); // In the order of the tree, each new one a top of its own.
  assert.equal(through(lib, ['b'], 300), 'b .c .n1'); // Ticked anew: what is there now was seen.
  // A page without the day it was added is an old one.
  delete lib.nodes.n2.added;
  assert.equal(through(lib, ['b'], 200), 'b .c .n1 n3 .n4');
});
