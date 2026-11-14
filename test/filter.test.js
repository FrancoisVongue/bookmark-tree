import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, rowsOf, setCollapsed } from '../src/model.js';
import { alive, nameFor, narrowedTo, savedAs, topmost, withLeads, withSaved } from '../src/panel/filter.js';

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
const through = (lib, picked, live, at = Infinity) => shown(rowsOf(narrowedTo(lib, MAIN, { picked, at }), MAIN, false, new Set(live)));

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
  assert.equal(through(lib, ['a'], ['d']), 'a .b(1) ..d .e'); // An open tab stays in sight under a folded row.
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

test('a saved filter lives while something it ticked is in the tree', () => {
  const { trees } = library('a .b ..c .d e');
  const saved = [{ name: 'one', picked: ['c', 'gone', 'b'] }, { name: 'none', picked: ['gone'] }, { name: 'two', picked: ['e'] }];
  assert.deepEqual(alive(trees[MAIN], saved), [{ name: 'one', picked: ['b'] }, { name: 'two', picked: ['e'] }]);
  assert.deepEqual(alive(undefined, saved), []); // The tree itself is gone.
  assert.deepEqual(alive(trees[MAIN], [{ picked: ['e', 'a'], at: 5 }]), [{ picked: ['a', 'e'], at: 5 }]); // A tree's own filter, the same way.
});

test('saving a filter, and knowing a saved one', () => {
  let saved = withSaved([], 'work', ['a', 'b']);
  saved = withSaved(saved, 'read', ['c']);
  assert.deepEqual(saved.map((each) => each.name), ['work', 'read']);
  assert.equal(savedAs(saved, ['b', 'a']).name, 'work'); // The same nodes, in whatever order.
  assert.equal(savedAs(saved, ['a']), undefined);
  assert.equal(savedAs(saved, ['a', 'b', 'c']), undefined);
  // The same name again takes its place.
  saved = withSaved(saved, 'work', ['d']);
  assert.deepEqual(saved, [{ name: 'work', picked: ['d'] }, { name: 'read', picked: ['c'] }]);
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
  assert.equal(through(lib, ['b'], [], 200), 'b .c .n1 n2 n3 .n4'); // In the order of the tree, each new one a top of its own.
  assert.equal(through(lib, ['b'], [], 300), 'b .c .n1'); // Ticked anew: what is there now was seen.
  // A page without the day it was added is an old one.
  delete lib.nodes.n2.added;
  assert.equal(through(lib, ['b'], [], 200), 'b .c .n1 n3 .n4');
});
