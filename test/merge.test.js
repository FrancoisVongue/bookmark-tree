import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, addNode, createLibrary, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import { EMPTY, merge } from '../src/merge.js';

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

test('my moves and renames are made again on top of theirs', () => {
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

test('what they deleted but I changed stays', () => {
  const [base, mine, theirs] = three('a\nb');
  ops.rename(mine, { id: 'b', name: 'Keep me' });
  ops.remove(theirs, { tree: MAIN, ids: ['b'] }, 6);
  const out = merge(base, mine, theirs, 7);
  assert.equal(outline(out), 'a\nb');
  assert.deepEqual(out.trash, []);
});

test('trees made on either side are both there; a first meeting adds everything up', () => {
  const [base, mine, theirs] = three('a');
  ops['tree-add'](mine, { id: 'm', name: 'Mine' });
  ops.move(mine, { tree: 'm', from: MAIN, ids: ['a'], position: 'end' });
  ops['tree-add'](theirs, { id: 't', name: 'Theirs' });
  const out = merge(base, mine, theirs, 1);
  assert.deepEqual(Object.keys(out.trees).sort(), ['m', 'main', 't']);
  assert.equal(outline(out, 'm'), 'a');

  const met = merge(EMPTY, library('x\n  y'), library('p\nq'), 1);
  assert.equal(outline(met), 'x\n  y\np\nq');
});

test('nothing changed on my side: the result is theirs', () => {
  const [base, mine, theirs] = three('a\n  b\nc');
  add(theirs, 't', 'a', 'after');
  ops['collapse-all'](theirs, { tree: MAIN, collapsed: true });
  assert.deepEqual(merge(base, mine, theirs, 1), theirs);
});
