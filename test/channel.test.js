import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, MAIN, createLibrary, problems, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import { newState, publish, receive } from '../src/channel.js';

/** What the browser keeps in sync between computers, here in memory. `writes` counts the items written. */
function sharedStore() {
  const cells = {};
  const store = {
    cells,
    writes: [],
    get: async () => structuredClone(cells),
    set: async (more) => (store.writes.push(...Object.keys(more)), void Object.assign(cells, structuredClone(more))),
    remove: async (keys) => keys.forEach((key) => delete cells[key]),
  };
  return store;
}
const computer = (name) => ({ ch: newState(name), library: createLibrary() });
/** A page added on day `day`. */
const add = (who, id, day = 1000, target) =>
  ops.add(who.library, { tree: MAIN, nodes: [{ id, url: `https://${id}.example/`, title: id }], target, position: target && 'inside' }, day * DAY);
const outline = (who, tree = MAIN) => rowsOf(who.library, tree, true).map((row) => '.'.repeat(row.depth) + row.id).join(' ');
/** One round, as the worker does it: listen, then tell. */
async function exchange(store, who, budget) {
  await receive(store, who.ch, who.library, 1);
  assert.deepEqual(problems(who.library), []);
  return publish(store, who.ch, who.library, budget);
}
const rounds = async (store, computers, budget) => {
  for (let n = 0; n < 3; n++) for (const who of computers) await exchange(store, who, budget);
};

test('two libraries become one, and then nothing more is written', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  add(a, 'x');
  add(a, 'y', 1000, 'x');
  add(b, 'z');
  ops['tree-add'](a.library, { id: 'work', name: 'Work' });
  ops['tree-icon'](a.library, { tree: 'work', icon: '🔥' });
  ops.collapse(a.library, { tree: MAIN, id: 'x', collapsed: true });
  await rounds(store, [a, b]);
  assert.equal(outline(a), 'x .y z');
  assert.deepEqual(b.library.nodes, a.library.nodes);
  assert.deepEqual(b.library.trees, a.library.trees);
  store.writes.length = 0;
  await rounds(store, [a, b]);
  assert.deepEqual(store.writes, []);
});

test('a removal, a rename and a move arrive; what was restored is not removed again', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  for (const id of ['x', 'y', 'z']) add(a, id);
  await rounds(store, [a, b]);
  ops.delete(a.library, { ids: ['y'] }, 5);
  ops.rename(a.library, { id: 'x', name: 'Mine' });
  ops.move(b.library, { tree: MAIN, ids: ['z'], target: 'x', position: 'before' });
  await rounds(store, [a, b]);
  assert.equal(outline(b), 'z x');
  assert.equal(outline(a), 'z x');
  assert.equal(b.library.nodes.x.name, 'Mine');
  assert.deepEqual(b.library.trash.map((entry) => entry.node.id), ['y']);
  ops.restore(b.library, { tree: MAIN, ids: ['y'] });
  await rounds(store, [a, b]);
  assert.equal(outline(a), 'z x y');
  assert.equal(outline(b), 'z x y');
});

test('both write at once: the changes of both are kept', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  add(a, 'x');
  await rounds(store, [a, b]);
  // Neither has seen the other's change when it writes: b's head replaces a's.
  ops.rename(a.library, { id: 'x', name: 'Renamed' });
  add(b, 'n');
  const before = await store.get();
  await publish(store, a.ch, a.library);
  for (const key in store.cells) delete store.cells[key];
  Object.assign(store.cells, before);
  await publish(store, b.ch, b.library);
  await rounds(store, [a, b]);
  assert.equal(a.library.nodes.x.name, 'Renamed');
  assert.equal(b.library.nodes.x.name, 'Renamed');
  assert.equal(outline(a), 'x n');
});

test('a computer with nothing does not take anything away from one that has much', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  add(a, 'x');
  ops['tree-add'](a.library, { id: 'work', name: 'Work' });
  await exchange(store, a);
  // b, new and empty, writes before it has heard of a: its head replaces a's.
  for (const key in store.cells) delete store.cells[key];
  await exchange(store, b);
  await rounds(store, [a, b]);
  assert.deepEqual(Object.keys(a.library.trees), [MAIN, 'work']);
  assert.equal(outline(a), 'x');
  assert.equal(outline(b), 'x');
  assert.deepEqual(Object.keys(b.library.trees), [MAIN, 'work']);
});

test('too big to sync whole: the fresh part travels with its parents, the rest stays where it is', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  // An old folder with old pages; one page in it is fresh.
  ops['note-add'](a.library, { tree: MAIN, id: 'folder', name: 'Folder' }, 10 * DAY);
  for (let n = 0; n < 60; n++) add(a, `old${n}`, 10 + n, 'folder');
  add(a, 'fresh', 2000, 'folder');
  for (let n = 0; n < 20; n++) add(a, `new${n}`, 1900 + n);
  const budget = 1500;
  const hidden = await exchange(store, a, budget);
  await rounds(store, [a, b], budget);
  assert.ok(hidden > 0 && hidden < 81, `${hidden} stay behind`);
  // b has the freshest, under its old folder; a has lost nothing.
  assert.ok(outline(b).startsWith('folder '), outline(b));
  assert.ok(outline(b).includes('.fresh') && outline(b).includes('new19'));
  assert.equal(Object.keys(b.library.nodes).length, 82 - hidden);
  assert.equal(Object.keys(a.library.nodes).length, 82);
  assert.equal(rowsOf(a.library, MAIN, true).length, 82);
  assert.deepEqual(a.library.trash, []);
  assert.ok(JSON.stringify(store.cells).length < budget * 1.2);
  // A page b never got is deleted on a: b hears nothing of it, and a page b has is renamed: b hears that.
  ops.delete(a.library, { ids: ['old0'] }, 5);
  ops.rename(a.library, { id: 'fresh', name: 'Still fresh' });
  store.writes.length = 0;
  await rounds(store, [a, b], budget);
  assert.equal(b.library.nodes.fresh.name, 'Still fresh');
  assert.equal(Object.keys(a.library.nodes).length, 81);
  store.writes.length = 0;
  await rounds(store, [a, b], budget);
  assert.deepEqual(store.writes, []);
});

test('months nobody touched are not written again', async () => {
  const store = sharedStore();
  const a = computer('a');
  for (let n = 0; n < 40; n++) add(a, `p${n}`, 100 + n * 20); // Spread over many months.
  await exchange(store, a);
  const first = store.writes.filter((name) => name.startsWith('p.')).length;
  store.writes.length = 0;
  add(a, 'today', 3000);
  await exchange(store, a);
  const again = store.writes.filter((name) => name.startsWith('p.')).length;
  assert.ok(first > 20, `${first} pieces at first`);
  assert.equal(again, 2); // The new month, and the trees.
});

test('a computer that was away while the other wrote many times keeps its own changes', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  for (const id of ['x', 'y', 'z']) add(a, id);
  ops['note-add'](a.library, { tree: MAIN, id: 'note' }, 1);
  await rounds(store, [a, b]);
  // b, away, changes things; a writes five snapshots meanwhile.
  ops['note-text'](b.library, { id: 'note', text: 'written on b' });
  ops.rename(b.library, { id: 'x', name: 'Named on b' });
  ops.move(b.library, { tree: MAIN, ids: ['z'], target: 'x', position: 'before' });
  ops['tree-rename'](b.library, { tree: MAIN, name: 'Renamed on b' });
  for (let n = 0; n < 5; n++) {
    add(a, `more${n}`);
    await exchange(store, a);
  }
  ops.rename(a.library, { id: 'y', name: 'Named on a' });
  await exchange(store, a);
  await rounds(store, [a, b]);
  for (const who of [a, b]) {
    assert.equal(who.library.nodes.note.note, 'written on b');
    assert.equal(who.library.nodes.x.name, 'Named on b');
    assert.equal(who.library.nodes.y.name, 'Named on a');
    assert.equal(who.library.trees[MAIN].name, 'Renamed on b');
    assert.ok(outline(who).startsWith('z x y'), outline(who));
    assert.equal(Object.keys(who.library.nodes).length, 9);
  }
});

test('both write several times without hearing each other: still nothing is lost', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  add(a, 'x');
  await rounds(store, [a, b]);
  const apart = sharedStore(); // b's own world while it is cut off.
  Object.assign(apart.cells, await store.get());
  for (let n = 0; n < 3; n++) {
    add(a, `a${n}`);
    await exchange(store, a);
    add(b, `b${n}`);
    await exchange(apart, b);
  }
  ops.rename(a.library, { id: 'x', name: 'Named on a' });
  await exchange(store, a);
  await rounds(store, [a, b]); // b is back: it meets a's snapshots, a meets b's.
  for (const who of [a, b]) {
    assert.equal(Object.keys(who.library.nodes).length, 7);
    assert.equal(who.library.nodes.x.name, 'Named on a');
  }
});

test('the plan goes through the synced storage, in order', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  for (const id of ['x', 'y', 'z']) add(a, id);
  ops.plan(a.library, { ids: ['z', 'x'] });
  await rounds(store, [a, b]);
  assert.deepEqual(b.library.plan, ['z', 'x']);
  ops.unplan(b.library, { ids: ['z'] });
  await rounds(store, [a, b]);
  assert.deepEqual(a.library.plan, ['x']);
  ops.unplan(a.library, { ids: ['x'] });
  await rounds(store, [a, b]);
  assert.equal('plan' in b.library, false);
  // A tree's quick row goes the same way, with its tree.
  ops.quick(a.library, { tree: MAIN, ids: ['y', 'x'] });
  await rounds(store, [a, b]);
  assert.deepEqual(b.library.trees[MAIN].quick, ['y', 'x']);
});

test('what was deleted stays deleted: an emptied trash, a computer back from afar, a copy from before', async () => {
  const store = sharedStore();
  const [a, b] = [computer('a'), computer('b')];
  for (const id of ['x', 'y', 'c']) add(a, id);
  await rounds(store, [a, b]);
  const old = structuredClone(a.library); // A backup from before, still with c.
  // b goes away. a deletes c, empties the trash, and goes on writing.
  ops.delete(a.library, { ids: ['c'] }, 5 * DAY);
  ops['trash-empty'](a.library);
  await exchange(store, a);
  add(a, 'n');
  await exchange(store, a);
  // b comes back, c still in its tree, with a change of its own.
  ops.rename(b.library, { id: 'x', name: 'X' });
  await rounds(store, [b, a]);
  assert.equal(outline(a), 'x y n');
  assert.equal(outline(b), 'x y n');
  assert.equal(a.library.nodes.x.name, 'X');
  assert.deepEqual(a.library.trash, []);
  // A third computer starts from the old backup: nothing in common with what is stored.
  const late = computer('late');
  late.library = old;
  await rounds(store, [late, a]);
  assert.equal(outline(a), 'x y n');
  assert.equal(outline(late), 'x y n');
});
