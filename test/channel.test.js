import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, createLibrary, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import { newState, publish, receive } from '../src/channel.js';

/** What the browser keeps in sync between devices, here in memory. */
function sharedStore() {
  const cells = {};
  return {
    cells,
    get: async () => structuredClone(cells),
    set: async (more) => void Object.assign(cells, structuredClone(more)),
    remove: async (keys) => keys.forEach((key) => delete cells[key]),
  };
}
const device = (name) => ({ state: newState(name), library: createLibrary() });
const add = (who, id, title = id) => ops.add(who.library, { tree: MAIN, nodes: [{ id, url: `https://${id}/`, title }] });
const outline = (who) => rowsOf(who.library, MAIN, true).map((row) => row.id).join(' ');
/** One round: tell, then listen. */
async function exchange(store, who) {
  const told = await publish(store, who.state, who.library, 1);
  const lost = await receive(store, who.state, who.library, 1);
  return { told, lost };
}

test('changes travel both ways and are not echoed back', async () => {
  const store = sharedStore();
  const [a, b] = [device('a'), device('b')];
  add(a, 'x');
  add(b, 'y');
  await exchange(store, a);
  await exchange(store, b);
  await exchange(store, a);
  // Both have both. (Each put the other's page where the other had it: first.)
  assert.equal(outline(a), 'y x');
  assert.equal(outline(b), 'x y');
  const cells = Object.keys(store.cells).length;
  await exchange(store, a);
  await exchange(store, b);
  assert.equal(Object.keys(store.cells).length, cells); // Nothing new to tell.
});

test('a removal and a rename arrive', async () => {
  const store = sharedStore();
  const [a, b] = [device('a'), device('b')];
  add(a, 'x');
  add(a, 'y');
  await exchange(store, a);
  await exchange(store, b);
  ops.remove(a.library, { tree: MAIN, ids: ['x'] }, 5);
  ops.rename(a.library, { id: 'y', name: 'Mine' });
  await exchange(store, a);
  assert.deepEqual(await exchange(store, b), { told: true, lost: false });
  assert.equal(outline(b), 'y');
  assert.equal(b.library.nodes.y.name, 'Mine');
  assert.deepEqual(b.library.trash.map((entry) => entry.node.id), ['x']);
});

test('added and removed between two tellings leaves no trace', async () => {
  const store = sharedStore();
  const a = device('a');
  add(a, 'x');
  ops.remove(a.library, { tree: MAIN, ids: ['x'] }, 5);
  a.library.trash = [];
  await exchange(store, a);
  assert.deepEqual(Object.keys(store.cells), []);
});

test('a change too big for a cell is not sent, and the others learn they are out of step', async () => {
  const store = sharedStore();
  const [a, b] = [device('a'), device('b')];
  for (let i = 0; i < 200; i++) add(a, `page-${i}`, 'a long title '.repeat(5));
  assert.equal((await exchange(store, a)).told, false);
  assert.equal((await exchange(store, b)).lost, true);
  assert.equal(outline(b), '');
  add(a, 'small');
  await exchange(store, a);
  assert.deepEqual(await exchange(store, b), { told: true, lost: false });
  assert.equal(outline(b), 'small');
});

test('a device away for too long finds cells missing and is out of step', async () => {
  const store = sharedStore();
  const [a, b] = [device('a'), device('b')];
  for (let i = 0; i < 35; i++) {
    add(a, `n${i}`);
    await exchange(store, a);
  }
  assert.equal(Object.keys(store.cells).length, 30);
  assert.equal((await exchange(store, b)).lost, true);
  assert.equal(outline(b).split(' ').length, 30); // It took what was still there.
  add(a, 'next');
  await exchange(store, a);
  assert.equal((await exchange(store, b)).lost, false);
});
