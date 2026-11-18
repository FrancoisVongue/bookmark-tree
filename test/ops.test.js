import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, expire, goneOf, gridOf, migrate, planOf, problems, quickOf, rowsOf } from '../src/model.js';
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

test('a move that takes: the nodes leave the tree they came from', () => {
  const lib = library('a\n  b\nc');
  ops.move(lib, { from: MAIN, tree: 'other', ids: ['a'], position: 'end', take: true }, 1);
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

test('duplicating copies the branch, under the ids it is given', () => {
  const lib = library('a\n  b\nc');
  ops.duplicate(lib, { tree: MAIN, ids: ['a'], as: { a: 'a2', b: 'b2' } }, 1000);
  assert.equal(outline(lib), 'a\n  b\na2\n  b2\nc');
  assert.deepEqual(problems(lib), []);
});

test('a parent and its child both chosen: the branch is copied once', () => {
  const lib = library('a\n  b\nc');
  ops.duplicate(lib, { tree: MAIN, ids: ['b', 'a', 'c'], as: { a: 'a2', b: 'b2', c: 'c2' } }, 1000);
  assert.equal(outline(lib), 'a\n  b\na2\n  b2\nc\nc2');
  // Twice in the same instant: two copies, not one.
  ops.duplicate(lib, { tree: MAIN, ids: ['c'], as: { c: 'c3' } }, 1000);
  assert.equal(outline(lib), 'a\n  b\na2\n  b2\nc\nc3\nc2');
  // A node the copies were not named for (it appeared meanwhile) is left out.
  ops.duplicate(lib, { tree: MAIN, ids: ['a'], as: { a: 'a4' } }, 1000);
  assert.equal(outline(lib), 'a\n  b\na4\na2\n  b2\nc\nc3\nc2');
});

test('collapse-all folds every parent, and unfolds', () => {
  const lib = library('a\n  b\n    c\nd');
  ops['collapse-all'](lib, { tree: MAIN, collapsed: true });
  assert.deepEqual(Object.keys(lib.trees[MAIN].collapsed).sort(), ['a', 'b']);
  ops['collapse-all'](lib, { tree: MAIN, collapsed: false });
  assert.deepEqual(lib.trees[MAIN].collapsed, {});
});

test('an address typed by hand becomes the page\'s home; pinning is a mark of its own', () => {
  const lib = library('a');
  assert.deepEqual(ops.address(lib, { id: 'a', url: ' https://z/ ' }), { navigate: 'a' });
  assert.equal(lib.nodes.a.home.url, 'https://z/');
  ops.pin(lib, { ids: ['a'], pinned: true });
  assert.equal(lib.nodes.a.pinned, true);
  ops.pin(lib, { ids: ['a'], pinned: false });
  assert.deepEqual([lib.nodes.a.pinned, lib.nodes.a.home.url], [undefined, 'https://z/']); // Unpinned, it still knows the way back.
  // A library from before every page had a home: there, having one meant being pinned.
  const older = { nodes: { p: { id: 'p', url: 'https://x/', home: { url: 'https://p/' } }, q: { id: 'q', url: 'https://q/' } }, trees: lib.trees, trash: [] };
  assert.deepEqual(Object.values(migrate(older).nodes).map((node) => node.pinned), [true, undefined]);
  assert.deepEqual(Object.values(migrate(older).nodes).map((node) => node.pinned), [true, undefined]);
});

test('a deleted tree sends its own nodes to the trash and keeps the tabs', () => {
  const lib = library('a\nb');
  ops.move(lib, { tree: 'other', from: MAIN, ids: ['a'], position: 'end' });
  assert.deepEqual(ops['tree-remove'](lib, { tree: MAIN }, 7), { keepTabs: true });
  assert.deepEqual(Object.keys(lib.nodes), ['a']);
  assert.deepEqual(lib.trash.map((entry) => entry.node.id), ['b']);
  assert.equal(ops['tree-remove'](lib, { tree: 'other' }, 8), undefined); // The last tree stays.
});

test('trees sit in a table: any cell, swapping, resizing', () => {
  const lib = library('a');
  assert.deepEqual(gridOf(lib), { columns: 4, rows: 1, cells: [MAIN, 'other', null, null] });
  ops['grid-move'](lib, { tree: MAIN, cell: 3 });
  ops['grid-move'](lib, { tree: 'other', cell: 3 });
  assert.deepEqual(gridOf(lib).cells, [null, MAIN, null, 'other']); // The one that was there took the place left.
  ops['grid-size'](lib, { columns: 2, rows: 2 });
  assert.deepEqual(gridOf(lib), { columns: 2, rows: 2, cells: ['other', MAIN, null, null] });
  ops['tree-add'](lib, { id: 'third', name: 'Third', cell: 3 });
  ops['grid-size'](lib, { columns: 1, rows: 1 });
  assert.deepEqual(gridOf(lib), { columns: 1, rows: 3, cells: ['other', MAIN, 'third'] }); // Nothing falls off the table.
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
  ops['group-add'](lib, { tree: MAIN, id: 'g', name: 'Work', target: 'b', position: 'after' });
  assert.equal(outline(lib), 'a\nx\ny\nb\ng');
  assert.deepEqual(lib.nodes.g, { id: 'g', group: true, name: 'Work' });
});

test('a sound library has no problems; a damaged one is told apart', () => {
  const lib = library('a\n  b');
  assert.deepEqual(problems(lib), []);
  lib.trees[MAIN].children.b = ['a'];
  assert.ok(problems(lib).length);
  const hole = library('a');
  delete hole.nodes.a;
  assert.equal(problems(hole)[0], 'a in tree main is not a node');
  assert.deepEqual(problems({ nodes: {} }), ['this is not a library']);
});

test('what is added or copied remembers when', () => {
  const library = createLibrary();
  ops.add(library, { tree: MAIN, nodes: [{ id: 'a', url: 'https://a.example/', title: 'A' }] }, 1000);
  ops['note-add'](library, { tree: MAIN, id: 'n' }, 2000);
  ops.duplicate(library, { tree: MAIN, ids: ['a'], as: { a: 'a2' } }, 3000);
  assert.deepEqual(Object.values(library.nodes).map((node) => node.added), [1000, 2000, 3000]);
});

test('taking back one change leaves everything made since in place', async () => {
  const { apply, diff } = await import('../src/merge.js');
  const library = createLibrary();
  ops.add(library, { tree: MAIN, nodes: [{ id: 'a', url: 'https://a.example/', title: 'A' }] }, 1);
  ops['note-add'](library, { tree: MAIN, id: 'n' }, 1);
  const before = structuredClone(library);
  ops.rename(library, { id: 'a', name: 'Renamed' });
  const after = structuredClone(library);
  // Since then: a page kept, a note written.
  ops.add(library, { tree: MAIN, nodes: [{ id: 'b', url: 'https://b.example/', title: 'B' }] }, 2);
  ops['note-text'](library, { id: 'n', text: 'an hour of writing' });
  apply(library, diff(after, before), 3); // Undo the rename.
  assert.equal(library.nodes.a.name, undefined);
  assert.equal(library.nodes.b.title, 'B');
  assert.equal(library.nodes.n.note, 'an hour of writing');
  assert.deepEqual(problems(library), []);
  apply(library, diff(before, after), 4); // And redo it.
  assert.equal(library.nodes.a.name, 'Renamed');
});

test("a tree's quick row: its own nodes kept at hand, in order, each once; what leaves the tree leaves the row", () => {
  const lib = library('a\n  b\nc');
  ops['tree-add'](lib, { id: 'other', name: 'Other' });
  ops.add(lib, { tree: 'other', nodes: [{ id: 'x', url: 'https://x/', title: 'x' }] });
  const [main, other] = [lib.trees[MAIN], lib.trees.other];
  ops.quick(lib, { tree: MAIN, ids: ['c', 'b', 'x', 'nobody', 'c'] }); // x is of another tree.
  assert.deepEqual(quickOf(main), ['c', 'b']);
  assert.deepEqual(quickOf(other), []);
  ops.quick(lib, { tree: MAIN, ids: ['a', 'b'], before: 'c' }); // a comes in, b moves: both before c.
  assert.deepEqual(quickOf(main), ['a', 'b', 'c']);
  ops.remove(lib, { tree: MAIN, ids: ['b'] }, 1);
  assert.deepEqual(quickOf(main), ['a', 'c']);
  ops.unquick(lib, { tree: MAIN, ids: ['a', 'c', 'nobody'] });
  assert.equal('quick' in main, false);
  assert.deepEqual(problems(lib), []);
});

test('the plan: pages in the order to open them, each once; a group is not planned', () => {
  const lib = library('a\nb\nc');
  ops['group-add'](lib, { tree: MAIN, id: 'g', name: 'Group' });
  ops.plan(lib, { ids: ['a', 'b', 'g', 'nobody'] });
  assert.deepEqual(planOf(lib), ['a', 'b']);
  ops.plan(lib, { ids: ['c', 'a'], before: 'b' }); // c comes in, a moves: both before b.
  assert.deepEqual(planOf(lib), ['c', 'a', 'b']);
  ops.delete(lib, { ids: ['a'] }, 1); // A page that is gone drops out by itself...
  assert.deepEqual(planOf(lib), ['c', 'b']);
  ops.restore(lib, { tree: MAIN, ids: ['a'] }); // ...and is planned again when it comes back.
  assert.deepEqual(planOf(lib), ['c', 'a', 'b']);
  ops.unplan(lib, { ids: ['c', 'a', 'b'] });
  assert.equal('plan' in lib, false);
  assert.deepEqual(problems(lib), []);
});

test('a deletion is noted apart from the trash: emptying the trash keeps it, a restore takes it back, a month lets it go', () => {
  const lib = library('a\nb\nc');
  const DAY = 24 * 3600 * 1000;
  ops.delete(lib, { ids: ['a', 'b'] }, 10 * DAY);
  ops.remove(lib, { tree: MAIN, ids: ['c'] }, 20 * DAY);
  assert.deepEqual(lib.gone, { a: 10 * DAY, b: 10 * DAY, c: 20 * DAY });
  ops.restore(lib, { tree: MAIN, ids: ['b'] }, 21 * DAY);
  assert.equal(lib.nodes.b.restored, 21 * DAY); // So other copies can tell it came back after it was deleted.
  ops['trash-empty'](lib);
  assert.deepEqual(goneOf(lib), ['a', 'c']);
  expire(lib, 41 * DAY); // a was deleted 31 days ago, c 21.
  assert.deepEqual(lib.gone, { c: 20 * DAY });
  // A library from before deletions were noted: its trash is what tells of them.
  const older = { nodes: {}, trees: lib.trees, trash: [{ node: { id: 'z' }, at: 20_000 * DAY + 5 }] };
  assert.deepEqual(migrate(older).gone, { z: 20_000 * DAY + 5 });
  // One from when they were noted to the day: as a time, the last moment of that day.
  const byDay = { nodes: {}, trees: lib.trees, trash: [], gone: { y: 20_000 } };
  assert.deepEqual(migrate(byDay).gone, { y: 20_001 * DAY - 1 });
  assert.deepEqual(migrate(byDay).gone, { y: 20_001 * DAY - 1 });
});

test('going home: the page is back at the address it first had, and its tab is asked to go there', () => {
  const lib = library('a');
  assert.equal(ops.home(lib, { id: 'a' }), undefined); // It never left.
  lib.nodes.a.home = { url: 'https://a/', title: 'a' };
  Object.assign(lib.nodes.a, { url: 'https://elsewhere/', title: 'Elsewhere' });
  assert.deepEqual(ops.home(lib, { id: 'a' }), { navigate: 'a' });
  assert.deepEqual([lib.nodes.a.url, lib.nodes.a.title], ['https://a/', 'a']);
});
