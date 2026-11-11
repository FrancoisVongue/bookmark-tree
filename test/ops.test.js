import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, rowsOf } from '../src/model.js';
import { exportTree, ops } from '../src/ops.js';

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
  ops['tree-add'](lib, { id: 'other', name: 'Other' });
  return lib;
}

const outline = (lib, tree = MAIN) =>
  rowsOf(lib, tree, true)
    .map((row) => '  '.repeat(row.depth) + row.id)
    .join('\n');

test('moving several nodes keeps their order and leaves out those under another', () => {
  const lib = library('a\n  b\nc\nd\ne');
  ops.move(lib, { tree: MAIN, ids: ['c', 'b', 'a', 'd'], target: 'e', position: 'after' });
  assert.equal(outline(lib), 'e\na\n  b\nc\nd');
  ops.move(lib, { tree: MAIN, ids: ['c', 'd'], target: 'a', position: 'first' });
  assert.equal(outline(lib), 'e\na\n  c\n  d\n  b');
});

test('moving into another tree shows the nodes there too, with their subtrees', () => {
  const lib = library('a\n  b\nc');
  ops.move(lib, { tree: 'other', from: MAIN, ids: ['a'], position: 'end' });
  assert.equal(outline(lib, 'other'), 'a\n  b');
  assert.equal(outline(lib), 'a\n  b\nc');
});

test('move-to takes the nodes out of the tree they came from', () => {
  const lib = library('a\n  b\nc');
  ops['move-to'](lib, { from: MAIN, tree: 'other', ids: ['a'] }, 1);
  assert.equal(outline(lib, 'other'), 'a\n  b');
  assert.equal(outline(lib), 'c');
  assert.deepEqual(lib.trash, []);
});

test('indent and outdent', () => {
  const lib = library('a\nb\nc');
  ops.indent(lib, { tree: MAIN, ids: ['b', 'c'] });
  assert.equal(outline(lib), 'a\n  b\n  c');
  ops.outdent(lib, { tree: MAIN, ids: ['b', 'c'] });
  assert.equal(outline(lib), 'a\nb\nc');
});

test('a removed node goes to the trash once no tree holds it, and can be put back', () => {
  const lib = library('a\nb');
  ops.move(lib, { tree: 'other', from: MAIN, ids: ['a'], position: 'end' });
  ops.remove(lib, { tree: MAIN, ids: ['a', 'b'] }, 42);
  assert.deepEqual(lib.trash.map((entry) => [entry.node.id, entry.at]), [['b', 42]]);
  assert.ok(lib.nodes.a);
  ops.delete(lib, { ids: ['a'] }, 43);
  assert.deepEqual(lib.trash.map((entry) => entry.node.id), ['b', 'a']);
  ops.restore(lib, { tree: MAIN, ids: ['b'] });
  assert.equal(outline(lib), 'b');
  assert.deepEqual(lib.trash.map((entry) => entry.node.id), ['a']);
});

test('duplicating copies the branch, and the same record gives the same ids', () => {
  const [one, two] = [library('a\n  b'), library('a\n  b')];
  ops.duplicate(one, { tree: MAIN, ids: ['a'] }, 1000);
  ops.duplicate(two, { tree: MAIN, ids: ['a'] }, 1000);
  assert.equal(outline(one), 'a\n  b\na-rs\n  b-rs');
  assert.deepEqual(one, two);
});

test('collapse-all folds every parent, and unfolds', () => {
  const lib = library('a\n  b\n    c\nd');
  ops['collapse-all'](lib, { tree: MAIN, collapsed: true });
  assert.deepEqual(Object.keys(lib.trees[MAIN].collapsed).sort(), ['a', 'b']);
  ops['collapse-all'](lib, { tree: MAIN, collapsed: false });
  assert.deepEqual(lib.trees[MAIN].collapsed, {});
});

test('an address typed by hand asks the tab to go there; a pinned node moves its home', () => {
  const lib = library('a');
  ops.pin(lib, { ids: ['a'], pinned: true });
  assert.deepEqual(ops.address(lib, { id: 'a', url: ' https://z/ ' }), { navigate: 'a' });
  assert.equal(lib.nodes.a.home.url, 'https://z/');
  ops.pin(lib, { ids: ['a'], pinned: false });
  assert.equal(lib.nodes.a.home, undefined);
});

test('a deleted tree sends its own nodes to the trash and keeps the tabs', () => {
  const lib = library('a\nb');
  ops.move(lib, { tree: 'other', from: MAIN, ids: ['a'], position: 'end' });
  assert.deepEqual(ops['tree-remove'](lib, { tree: MAIN }, 7), { keepTabs: true });
  assert.deepEqual(Object.keys(lib.nodes), ['a']);
  assert.deepEqual(lib.trash.map((entry) => entry.node.id), ['b']);
  assert.equal(ops['tree-remove'](lib, { tree: 'other' }, 8), undefined); // The last tree stays.
});

test('trees change places', () => {
  const lib = library('a');
  ops['tree-move'](lib, { tree: 'other', by: -1 });
  assert.deepEqual(Object.keys(lib.trees), ['other', MAIN]);
});

test('an exported tree comes back as a new tree with a name of its own', () => {
  const lib = library('a\n  b');
  ops.import(lib, { id: 'again', data: JSON.parse(JSON.stringify(exportTree(lib, MAIN))) });
  assert.equal(lib.trees.again.name, 'Main 2');
  assert.equal(outline(lib, 'again'), 'a\n  b');
});

test('pasted pages land where they were put; a group is a note with a name', () => {
  const lib = library('a\nb');
  ops.add(lib, { tree: MAIN, nodes: [{ id: 'x', url: 'https://x/' }, { id: 'y', url: 'https://y/' }], target: 'a', position: 'after' });
  ops['note-add'](lib, { tree: MAIN, id: 'g', name: 'Work', target: 'b', position: 'after' });
  assert.equal(outline(lib), 'a\nx\ny\nb\ng');
  assert.deepEqual(lib.nodes.g, { id: 'g', note: '', name: 'Work' });
});
