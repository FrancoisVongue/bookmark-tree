import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, goneOf, planOf, problems, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import { apply, diff, isEmpty, only, takeIn } from '../src/merge.js';

/** My library after taking in theirs, as the worker does it for GitHub: what they deleted since `base` is told by their `gone`. */
const merge = (base, mine, theirs, at) =>
  takeIn(structuredClone(mine), base, theirs, goneOf(theirs).filter((id) => !(id in (base?.gone ?? {}))), at);

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
const add = (lib, id, target, position) => ops.add(lib, { tree: MAIN, nodes: [{ id, url: `https://${id}/`, title: id }], target, position });
const three = (text) => [library(text), library(text), library(text)];

test('what each side added is all there, each where it was put', () => {
  const [base, mine, theirs] = three('a\n  b\nc');
  add(mine, 'm', 'a', 'inside');
  add(theirs, 't', 'c', 'before');
  assert.equal(outline(merge(base, mine, theirs, 1)), 'a\n  b\n  m\nt\nc');
});

test('my moves and renames stay when theirs are taken in', () => {
  const [base, mine, theirs] = three('a\nb\nc');
  ops.move(mine, { tree: MAIN, ids: ['c'], target: 'a', position: 'inside' });
  ops.rename(mine, { id: 'a', name: 'Mine' });
  theirs.nodes.a.title = 'new title';
  theirs.nodes.b.title = 'B';
  const out = merge(base, mine, theirs, 1);
  assert.equal(outline(out), 'a\n  c\nb');
  assert.deepEqual([out.nodes.a.name, out.nodes.a.title, out.nodes.b.title], ['Mine', 'new title', 'B']);
});

test('a deletion on either side holds, and lands in the trash', () => {
  const [base, mine, theirs] = three('a\nb\nc');
  ops.remove(mine, { tree: MAIN, ids: ['a'] }, 5);
  ops.remove(theirs, { tree: MAIN, ids: ['c'] }, 6);
  const out = merge(base, mine, theirs, 7);
  assert.equal(outline(out), 'b');
  assert.deepEqual(out.trash.map((entry) => entry.node.id), ['a', 'c']);
});

test('what they deleted goes to my trash even if I changed it: as I left it, to be put back', () => {
  const [base, mine, theirs] = three('a\nb');
  ops.rename(mine, { id: 'b', name: 'Keep me' });
  ops.remove(theirs, { tree: MAIN, ids: ['b'] }, 6);
  const out = merge(base, mine, theirs, 7);
  assert.equal(outline(out), 'a');
  assert.deepEqual(out.trash.map((entry) => entry.node.name), ['Keep me']);
});

test('both renamed the same node: theirs is taken, whatever carried it here', () => {
  const [base, mine, theirs] = three('a');
  ops.rename(mine, { id: 'a', name: 'Mine' });
  ops.rename(theirs, { id: 'a', name: 'Theirs' });
  assert.equal(merge(base, mine, theirs, 1).nodes.a.name, 'Theirs');
});

/** A sync through a store that keeps whole libraries (GitHub), as the worker does it: take theirs in, save mine. */
function sync(me, cloud, at) {
  if (cloud.library) me.library = merge(me.base, me.library, structuredClone(cloud.library), at);
  me.base = structuredClone(me.library);
  cloud.library = structuredClone(me.library);
}

test('through a store of whole libraries: a deletion arrives, a restore from the trash brings the node back to both', () => {
  const cloud = {};
  const [a, b] = [{ library: library('x\ny\nc') }, { library: createLibrary() }];
  sync(a, cloud, 1);
  sync(b, cloud, 2);
  assert.equal(outline(b.library), 'x\ny\nc');
  ops.delete(a.library, { ids: ['c'] }, 3);
  sync(a, cloud, 4);
  sync(b, cloud, 5);
  assert.equal(outline(b.library), 'x\ny');
  assert.deepEqual(b.library.trash.map((entry) => entry.node.id), ['c']);
  // b wants it back.
  ops.restore(b.library, { tree: MAIN, ids: ['c'] });
  sync(b, cloud, 6);
  sync(a, cloud, 7);
  assert.equal(outline(a.library), 'x\ny\nc');
  assert.deepEqual(a.library.trash, []);
  // And it stays, on both, however many times they sync.
  for (let at = 8; at < 12; at++) sync(at % 2 ? b : a, cloud, at);
  assert.equal(outline(a.library), 'x\ny\nc');
  assert.equal(outline(b.library), 'x\ny\nc');
  // A deletion with the trash emptied still arrives.
  ops.delete(b.library, { ids: ['y'] }, 12);
  ops['trash-empty'](b.library);
  sync(b, cloud, 13);
  sync(a, cloud, 14);
  assert.equal(outline(a.library), 'x\nc');
});

test('trees made on either side are both there; a first meeting adds everything up', () => {
  const [base, mine, theirs] = three('a');
  ops['tree-add'](mine, { id: 'm', name: 'Mine' });
  ops.move(mine, { tree: 'm', from: MAIN, ids: ['a'], position: 'end' });
  ops['tree-add'](theirs, { id: 't', name: 'Theirs' });
  const out = merge(base, mine, theirs, 1);
  assert.deepEqual(Object.keys(out.trees).sort(), ['m', 'main', 't']);
  assert.equal(outline(out, 'm'), 'a');

  const met = merge(undefined, library('x\n  y'), library('p\nq'), 1);
  assert.equal(outline(met), 'p\nq\nx\n  y'); // Theirs first: it is their arrangement that is taken in.
});

test('nothing changed on my side: the result is theirs', () => {
  const [base, mine, theirs] = three('a\n  b\nc');
  add(theirs, 't', 'a', 'after');
  ops['collapse-all'](theirs, { tree: MAIN, collapsed: true });
  assert.deepEqual(merge(base, mine, theirs, 1), theirs);
});

test("a tree's icon travels", () => {
  const base = createLibrary();
  const mine = structuredClone(base);
  mine.trees[MAIN].icon = '🔥';
  assert.equal(merge(base, mine, structuredClone(base), 1).trees[MAIN].icon, '🔥');
});

test('the plan is merged entry by entry: a visit here does not undo what was planned there', () => {
  const base = createLibrary();
  for (const id of ['a', 'b', 'c']) addNode(base, MAIN, { id, url: `https://${id}/`, title: id });
  base.plan = ['a'];
  const mine = structuredClone(base);
  delete mine.plan; // I have been at a.
  const theirs = structuredClone(base);
  theirs.plan = ['a', 'b']; // Meanwhile b was planned elsewhere.
  assert.deepEqual(planOf(merge(base, mine, theirs, 1)), ['b']);
  assert.deepEqual(planOf(merge(base, theirs, mine, 1)), ['b']);
  // Both add, one reorders: all entries are there, each once.
  mine.plan = ['c', 'a'];
  assert.deepEqual(planOf(merge(base, mine, theirs, 1)), ['c', 'a', 'b']);
  // A page one side does not have is not in its plan.
  ops.delete(theirs, { ids: ['a'] }, 1);
  assert.deepEqual(planOf(merge(base, mine, theirs, 2)), ['b', 'c']);
  // Nothing planned on either side: nothing to tell.
  assert.equal(isEmpty(diff(base, structuredClone(base))), true);
  assert.deepEqual(planOf(only(mine, new Set(['a']))), ['a']);
});

test('a tree deleted elsewhere takes with it only what its deleter knew of', () => {
  // Both know the tree Work: a group with a page in it, and a page beside.
  const base = library('x');
  ops['tree-add'](base, { id: 'work', name: 'Work' });
  ops['note-add'](base, { tree: 'work', id: 'g', name: 'Group' });
  for (const [id, target] of [['old', 'g'], ['other', undefined]]) {
    ops.add(base, { tree: 'work', nodes: [{ id, url: `https://${id}/`, title: id }], target, position: target && 'inside' });
  }
  const [mine, theirs] = [structuredClone(base), structuredClone(base)];
  ops['tree-remove'](theirs, { tree: 'work' }, 5);

  // Nothing new here: the tree goes, its nodes to the trash.
  const gone = merge(base, mine, theirs, 6);
  assert.deepEqual(Object.keys(gone.trees), [MAIN]);
  assert.deepEqual(gone.trash.map((entry) => entry.node.id).sort(), ['g', 'old', 'other']);

  // A page was added here meanwhile, inside the group: the tree stays with it and the group above it.
  ops.add(mine, { tree: 'work', nodes: [{ id: 'new', url: 'https://new/', title: 'new' }], target: 'g', position: 'inside' });
  const kept = merge(base, mine, theirs, 6);
  assert.equal(outline(kept, 'work'), 'g\n  new');
  assert.deepEqual(kept.trash.map((entry) => entry.node.id).sort(), ['old', 'other']);
  assert.deepEqual(problems(kept), []);
  // And a tree deleted here, by an undo say, is deleted whole: this rule is about what comes from elsewhere.
  assert.deepEqual(Object.keys(apply(structuredClone(mine), diff(base, theirs), 7).trees), [MAIN]);
});
