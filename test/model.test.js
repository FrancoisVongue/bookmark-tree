import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN,
  ROOT,
  addNode,
  createLibrary,
  descendantsOf,
  moveNode,
  parentOf,
  removeNode,
  renameNode,
  rowsOf,
  setCollapsed,
} from '../src/model.js';

/** A library from an outline: two spaces of indentation per level, ids are the names. */
function library(outline) {
  const lib = createLibrary();
  const stack = [];
  for (const line of outline.trim().split('\n')) {
    const depth = line.search(/\S/) / 2;
    const id = line.trim();
    addNode(lib, MAIN, { id, url: `https://${id}/`, title: id }, depth ? stack[depth - 1] : ROOT);
    stack[depth] = id;
  }
  return lib;
}

/** The tree as an outline again. */
const outline = (lib) =>
  rowsOf(lib, MAIN)
    .map((row) => '  '.repeat(row.depth) + row.id)
    .join('\n');

const same = (lib, expected) => assert.equal(outline(lib), expected.trim());

test('nodes are added as the last child', () => {
  const lib = library('a\n  b\nc');
  addNode(lib, MAIN, { id: 'd' }, 'a');
  addNode(lib, MAIN, { id: 'e' });
  same(lib, 'a\n  b\n  d\nc\ne');
});

test('a node added under a missing parent becomes top-level', () => {
  const lib = library('a');
  addNode(lib, MAIN, { id: 'b' }, 'gone');
  same(lib, 'a\nb');
});

test('parentOf and descendantsOf', () => {
  const lib = library('a\n  b\n    c\n  d\ne');
  const tree = lib.trees[MAIN];
  assert.equal(parentOf(tree, 'a'), ROOT);
  assert.equal(parentOf(tree, 'c'), 'b');
  assert.equal(parentOf(tree, 'nope'), undefined);
  assert.deepEqual(descendantsOf(tree, 'a'), ['b', 'c', 'd']);
});

test('moving inside makes it the last child, with its subtree', () => {
  const lib = library('a\n  b\nc\n  d');
  assert.equal(moveNode(lib, MAIN, 'c', 'a', 'inside'), true);
  same(lib, 'a\n  b\n  c\n    d');
});

test('moving first makes it the first child', () => {
  const lib = library('a\n  b\nc');
  moveNode(lib, MAIN, 'c', 'a', 'first');
  same(lib, 'a\n  c\n  b');
});

test('moving before and after places it as a sibling', () => {
  const lib = library('a\n  b\n  c\nd');
  moveNode(lib, MAIN, 'd', 'c', 'before');
  same(lib, 'a\n  b\n  d\n  c');
  moveNode(lib, MAIN, 'b', 'a', 'after');
  same(lib, 'a\n  d\n  c\nb');
});

test('moving among its own siblings', () => {
  const lib = library('a\nb\nc');
  moveNode(lib, MAIN, 'a', 'c', 'after');
  same(lib, 'b\nc\na');
  moveNode(lib, MAIN, 'a', 'b', 'before');
  same(lib, 'a\nb\nc');
});

test('moving to the end makes it the last top-level node', () => {
  const lib = library('a\n  b\n    c\nd');
  moveNode(lib, MAIN, 'b', null, 'end');
  same(lib, 'a\nd\nb\n  c');
});

test('a node cannot move into itself or its own subtree', () => {
  const lib = library('a\n  b\n    c');
  assert.equal(moveNode(lib, MAIN, 'a', 'c', 'inside'), false);
  assert.equal(moveNode(lib, MAIN, 'a', 'a', 'before'), false);
  assert.equal(moveNode(lib, MAIN, 'a', 'gone', 'inside'), false);
  assert.equal(moveNode(lib, MAIN, 'gone', 'a', 'inside'), false);
  same(lib, 'a\n  b\n    c');
});

test('removing a node moves its children up into its place', () => {
  const lib = library('a\nb\n  c\n    d\n  e\nf');
  removeNode(lib, MAIN, 'b');
  same(lib, 'a\nc\n  d\ne\nf');
  assert.equal(lib.nodes.b, undefined);
  assert.equal(lib.trees[MAIN].children.b, undefined);
});

test('a node held by another tree is not forgotten', () => {
  const lib = library('a');
  lib.trees.other = { id: 'other', name: 'Other', children: { [ROOT]: ['a'] }, collapsed: {} };
  removeNode(lib, MAIN, 'a');
  assert.ok(lib.nodes.a);
  removeNode(lib, 'other', 'a');
  assert.equal(lib.nodes.a, undefined);
});

test('a collapsed row hides its subtree and counts it', () => {
  const lib = library('a\n  b\n    c\nd');
  setCollapsed(lib, MAIN, 'a', true);
  assert.deepEqual(rowsOf(lib, MAIN), [
    { id: 'a', depth: 0, kids: 1, collapsed: true, hidden: 2 },
    { id: 'd', depth: 0, kids: 0, collapsed: false, hidden: 0 },
  ]);
  setCollapsed(lib, MAIN, 'a', false);
  same(lib, 'a\n  b\n    c\nd');
});

test('renaming, and clearing the name', () => {
  const lib = library('a');
  renameNode(lib, 'a', '  Mine ');
  assert.equal(lib.nodes.a.name, 'Mine');
  renameNode(lib, 'a', ' ');
  assert.equal('name' in lib.nodes.a, false);
});

test('the library is plain JSON', () => {
  const lib = library('a\n  b');
  setCollapsed(lib, MAIN, 'a', true);
  assert.deepEqual(JSON.parse(JSON.stringify(lib)), lib);
});

test('a folded branch hides what is asleep; open tabs and marked nodes stay in sight right under it', () => {
  const lib = library('a\n  b\n    c\n    d\n  e\nf');
  setCollapsed(lib, MAIN, 'a', true);
  setCollapsed(lib, MAIN, 'b', true); // Folded inside the folded: still one level, the outer one's.
  const shown = (live) => rowsOf(lib, MAIN, false, new Set(live)).map((row) => `${'.'.repeat(row.depth)}${row.id}${row.kept ? '!' : ''}${row.hidden ? `(${row.hidden})` : ''}`).join(' ');
  assert.equal(shown([]), 'a(4) f');
  assert.equal(shown(['d']), 'a(3) .d! f');
  lib.nodes.c.keep = true;
  assert.equal(shown(['e']), 'a(2) .c! .e! f');
  assert.equal(shown(['b', 'c', 'd', 'e']), 'a .b! .c! .d! .e! f');
  // Unfolded, everything is where it is.
  setCollapsed(lib, MAIN, 'a', false);
  assert.equal(shown(['d']), 'a .b ..c! ..d! .e f'); // b is folded too: c is marked, d is open, nothing is left to hide.
  assert.equal(rowsOf(lib, MAIN, true, new Set(['d'])).map((row) => row.id).join(' '), 'a b c d e f');
});
