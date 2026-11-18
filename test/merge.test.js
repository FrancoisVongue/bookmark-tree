import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, goneOf, gridOf, planOf, problems, quickOf, rowsOf } from '../src/model.js';
import { ops, perform } from '../src/ops.js';
import { apply, diff, hasNews, isEmpty, mark, only, takeIn } from '../src/merge.js';

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
const outline = (lib, tree = MAIN) =>
  rowsOf(lib, tree, true)
    .map((row) => '  '.repeat(row.depth) + row.id)
    .join('\n');
/** Two copies of the same library, as two computers have it. */
const two = (text) => [library(text), library(text)];
/** The user does something to a copy, at time `at`. */
const does = (lib, at, name, args) => perform(lib, name, args, at);
const page = (id) => ({ id, url: `https://${id}/`, title: id });
const NOW = 1000;
/** What `mine` is after taking `theirs` in. */
const taking = (mine, theirs, at = NOW) => takeIn(structuredClone(mine), theirs, theirs.gone, at);
/**
 * Each copy takes the other in. They must come to the same, whichever does
 * it first, and taking in again must change nothing. Returns what they come to.
 */
function meet(a, b, at = NOW) {
  const [ra, rb] = [taking(a, b, at), taking(b, a, at)];
  const told = (lib) => JSON.stringify([Object.keys(lib.trees).sort().map((id) => [id, lib.trees[id].name, outline(lib, id), quickOf(lib.trees[id])]), lib.nodes, planOf(lib), goneOf(lib)]);
  const sorted = (lib) => ({ ...lib, nodes: Object.fromEntries(Object.entries(lib.nodes).sort()) });
  assert.equal(told(sorted(ra)), told(sorted(rb)), 'the two come to the same');
  assert.equal(told(sorted(taking(ra, rb, at))), told(sorted(ra)), 'and stay so');
  assert.equal(hasNews(ra, ra.gone, rb, rb.gone, at), false, 'with nothing more to tell');
  assert.deepEqual(problems(ra), []);
  return ra;
}

test('what each side added is all there, each where it was put', () => {
  const [a, b] = two('a\n  b\nc');
  does(a, 10, 'add', { tree: MAIN, nodes: [page('m')], target: 'a', position: 'inside' });
  does(b, 11, 'add', { tree: MAIN, nodes: [page('t')], target: 'c', position: 'before' });
  assert.equal(outline(meet(a, b)), 'a\n  b\n  m\nt\nc');
});

test('a node both changed: the one changed later is taken, name and place', () => {
  const [a, b] = two('a\nb\nc');
  does(a, 10, 'rename', { id: 'a', name: 'First' });
  does(a, 11, 'move', { tree: MAIN, ids: ['c'], target: 'a', position: 'inside' });
  does(b, 20, 'rename', { id: 'a', name: 'Later' });
  does(b, 21, 'move', { tree: MAIN, ids: ['c'], target: 'b', position: 'before' });
  const both = meet(a, b);
  assert.equal(both.nodes.a.name, 'Later');
  assert.equal(outline(both), 'a\nc\nb');
});

test('twenty nodes arranged on one computer, then one thing done on the other before it heard: the arrangement stands', () => {
  const ids = Array.from({ length: 20 }, (_, n) => `n${String(n).padStart(2, '0')}`);
  const [a, b] = two(['folder', ...ids].join('\n'));
  ids.toReversed().forEach((id, n) => does(a, 100 + n, 'move', { tree: MAIN, ids: [id], target: 'folder', position: 'inside' }));
  does(b, 500, 'rename', { id: 'n05', name: 'Renamed, not having heard' });
  does(b, 501, 'move', { tree: MAIN, ids: ['n19'], target: 'n00', position: 'before' });
  const both = meet(a, b);
  // Everything a put into the folder is there, in a's order - the one b only renamed too; the one b moved later is where b put it.
  assert.equal(outline(both), ['folder', ...ids.toReversed().filter((id) => id !== 'n19').map((id) => `  ${id}`), 'n19'].join('\n'));
  assert.equal(both.nodes.n05.name, 'Renamed, not having heard');
});

test('what a tab does to a node does not make it the later one', () => {
  const [a, b] = two('a\nb');
  does(a, 10, 'rename', { id: 'a', name: 'Named by hand' });
  does(a, 10, 'move', { tree: MAIN, ids: ['a'], target: 'b', position: 'after' });
  Object.assign(b.nodes.a, { title: 'A new title', url: 'https://a/elsewhere', seen: 50 }); // Its tab went on, later.
  const both = meet(a, b);
  assert.deepEqual([both.nodes.a.name, both.nodes.a.title, both.nodes.a.url], ['Named by hand', 'A new title', 'https://a/elsewhere']);
  assert.equal(outline(both), 'b\na');
});

test('siblings rearranged on both sides come to one order', () => {
  const [a, b] = two('a\nb\nc');
  does(a, 10, 'move', { tree: MAIN, ids: ['c'], target: 'a', position: 'before' });
  does(b, 11, 'move', { tree: MAIN, ids: ['a'], position: 'end' });
  assert.equal(outline(meet(a, b)), 'b\nc\na'); // c before a, as one said; a last, as the other did.
});

test('deleted and changed: the later of the two is right', () => {
  const [a, b] = two('x\ny\nz');
  does(a, 10, 'delete', { ids: ['x', 'y', 'z'] });
  Object.assign(b.nodes.x, { title: 'Still open there', seen: 50 }); // A tab is not a change of mind.
  does(b, 5, 'rename', { id: 'y', name: 'Named before it was deleted' });
  does(b, 20, 'rename', { id: 'z', name: 'Named after it was deleted' });
  const both = meet(a, b);
  assert.equal(outline(both), 'z');
  assert.deepEqual(goneOf(both), ['x', 'y']);
  // Where they were, they are in the trash, as they were left.
  assert.deepEqual(taking(b, a).trash.map((entry) => entry.node.name ?? entry.node.title), ['Still open there', 'Named before it was deleted']);
});

test('a deletion taken back - from the trash, or by an undo - comes back everywhere', () => {
  const [a, b] = two('x\ny');
  const before = structuredClone(a);
  does(a, 10, 'delete', { ids: ['x', 'y'] });
  const heard = meet(a, b);
  assert.equal(outline(heard), '');
  does(a, 20, 'restore', { tree: MAIN, ids: ['x'] });
  // What the worker does for an undo: the change made backwards, and marked as the user's doing.
  const undone = apply(structuredClone(a), diff(a, { ...before, nodes: { y: before.nodes.y } }), 21);
  mark(a, undone, 21);
  assert.equal(outline(meet(undone, heard)), 'x\ny');
  assert.deepEqual(goneOf(meet(undone, heard)), []);
});

test('a part of a library says nothing about what it leaves out', () => {
  const [a, b] = two('folder\n  x\n  y\nz');
  does(b, 10, 'rename', { id: 'x', name: 'Named there' });
  const part = only(b, new Set(['folder', 'x'])); // All that fits, say.
  const mine = taking(a, part);
  assert.equal(outline(mine), 'folder\n  x\n  y\nz');
  assert.equal(mine.nodes.x.name, 'Named there');
  assert.deepEqual(mine.trash, []);
});

test('trees: made on either side, named by whoever named last, deleted by name and time', () => {
  const [a, b] = two('x');
  does(a, 10, 'tree-add', { id: 'work', name: 'Work' });
  does(a, 11, 'move', { tree: 'work', from: MAIN, ids: ['x'], position: 'end', take: true });
  does(b, 12, 'tree-add', { id: 'home', name: 'Home' });
  does(b, 13, 'add', { tree: 'home', nodes: [page('h')] });
  does(b, 14, 'tree-rename', { tree: MAIN, name: 'Renamed there' });
  let both = meet(a, b);
  assert.deepEqual(Object.keys(both.trees).sort(), ['home', 'main', 'work']);
  assert.deepEqual([outline(both, 'work'), outline(both, 'home'), outline(both), both.trees[MAIN].name], ['x', 'h', '', 'Renamed there']);
  // The tree is deleted on one; the other, not having heard, puts a page into it.
  const [c, d] = [structuredClone(both), structuredClone(both)];
  does(c, 20, 'tree-remove', { tree: 'home' });
  both = meet(c, d);
  assert.deepEqual(Object.keys(both.trees).sort(), ['main', 'work']);
  assert.deepEqual(both.trash.map((entry) => entry.node.id), ['h']);
  does(d, 30, 'add', { tree: 'home', nodes: [page('new')] });
  both = meet(c, d, 40);
  assert.equal(outline(both, 'home'), 'new'); // What its deleter never saw keeps the tree; what they knew of is gone.
  assert.deepEqual(goneOf(both), ['h']);
});

test('the plan, a quick row, the table of trees: each whole, from whoever changed it last', () => {
  const [a, b] = two('x\ny\nz');
  does(a, 10, 'plan', { ids: ['x', 'y'] });
  does(a, 11, 'grid-size', { columns: 2, rows: 3 });
  does(b, 20, 'plan', { ids: ['z'] });
  does(b, 5, 'quick', { tree: MAIN, ids: ['y'] });
  const both = meet(a, b);
  assert.deepEqual(planOf(both), ['z']);
  assert.deepEqual(quickOf(both.trees[MAIN]), ['y']);
  assert.deepEqual([gridOf(both).columns, gridOf(both).rows], [2, 3]);
});

test('an operation stamps what it changed, and only that', () => {
  const lib = library('a\nb\nc');
  does(lib, 10, 'move', { tree: MAIN, ids: ['c'], target: 'a', position: 'before' });
  assert.deepEqual(Object.values(lib.nodes).map((node) => node.moved), [undefined, undefined, 10]); // Not the neighbours it passed.
  does(lib, 11, 'collapse', { tree: MAIN, id: 'a', collapsed: true });
  does(lib, 12, 'address', { id: 'b', url: 'https://typed/' });
  assert.deepEqual([lib.nodes.a.at, lib.nodes.b.at, lib.nodes.b.seen, lib.nodes.a.moved], [11, 12, 12, undefined]);
  does(lib, 13, 'tree-rename', { tree: MAIN, name: 'Named' });
  does(lib, 14, 'delete', { ids: ['a'] });
  assert.deepEqual([lib.trees[MAIN].at, lib.gone], [13, { a: 14 }]);
  does(lib, 15, 'restore', { tree: MAIN, ids: ['a'] });
  assert.deepEqual([lib.nodes.a.at, lib.nodes.a.moved, lib.gone], [15, 15, {}]);
});

/** A sync through a store that keeps whole libraries (GitHub), as the worker does it: take theirs in; save mine if it tells theirs anything. */
function sync(me, cloud, at) {
  if (cloud.library) me.library = taking(me.library, cloud.library, at);
  const news = !cloud.library || hasNews(cloud.library, cloud.library.gone, me.library, me.library.gone, at);
  if (news) cloud.library = structuredClone(me.library);
  return news;
}

test('through a store of whole libraries: changes go both ways, and then nothing more is saved', () => {
  const cloud = {};
  const [a, b] = [{ library: library('x\ny\nc') }, { library: createLibrary() }];
  sync(a, cloud, 1);
  sync(b, cloud, 2);
  assert.equal(outline(b.library), 'x\ny\nc');
  does(a.library, 3, 'delete', { ids: ['c'] });
  does(b.library, 3, 'rename', { id: 'x', name: 'Named on b' });
  sync(a, cloud, 4);
  sync(b, cloud, 5);
  sync(a, cloud, 6);
  assert.deepEqual([outline(a.library), outline(b.library), a.library.nodes.x.name], ['x\ny', 'x\ny', 'Named on b']);
  does(b.library, 7, 'restore', { tree: MAIN, ids: ['c'] });
  sync(b, cloud, 8);
  sync(a, cloud, 9);
  assert.equal(outline(a.library), 'x\ny\nc');
  assert.deepEqual(a.library.trash, []);
  assert.deepEqual([sync(b, cloud, 10), sync(a, cloud, 11), sync(b, cloud, 12)], [false, false, false]);
});

test("a tree's icon travels", () => {
  const [a, b] = two('x');
  does(a, 10, 'tree-icon', { tree: MAIN, icon: '🔥' });
  assert.equal(meet(a, b).trees[MAIN].icon, '🔥');
});

test('a diff is empty when nothing changed; a part of a library leaves a node out of the lists kept at hand too', () => {
  const lib = library('a\nb\nc');
  lib.trees[MAIN].quick = ['c', 'a'];
  lib.plan = ['b', 'a'];
  assert.equal(isEmpty(diff(lib, structuredClone(lib))), true);
  const part = only(lib, new Set(['a', 'b']));
  assert.deepEqual([quickOf(part.trees[MAIN]), planOf(part)], [['a'], ['b', 'a']]);
});
