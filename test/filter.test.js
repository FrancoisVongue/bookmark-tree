import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, MAIN, ROOT, addNode, createLibrary, rowsOf, setCollapsed } from '../src/model.js';
import { answers, narrowedTo, topmost, withLeads } from '../src/panel/filter.js';

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

test('the quick ways to tick', () => {
  const facts = { live: new Set(['open']), audible: new Set(['loud']), day: 1000 };
  const node = (id, more) => ({ id, ...more });
  assert.equal(answers(node('open'), 'open', facts), true);
  assert.equal(answers(node('x'), 'open', facts), false);
  assert.equal(answers(node('loud'), 'sound', facts), true);
  // Used this week: the tab opened or closed, or the node added, less than seven days ago.
  assert.equal(answers(node('x', { touched: 994 }), 'week', facts), true);
  assert.equal(answers(node('x', { touched: 993 }), 'week', facts), false);
  assert.equal(answers(node('x', { added: 999 * DAY }), 'week', facts), true);
  assert.equal(answers(node('x'), 'week', facts), false);
  assert.equal(answers(node('x', { pinned: true }), 'kept', facts), true);
  assert.equal(answers(node('x', { keep: true }), 'kept', facts), true);
  assert.equal(answers(node('x'), 'kept', facts), false);
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
