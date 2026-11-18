import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, MAIN, VERSION, createLibrary, goneOf, problems, revive, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import { apply, diff } from '../src/merge.js';
import { migrate, newState, publish, receive } from '../src/channel.js';

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
const NOW = 2010 * DAY; // Later than anything in these tests, by days.
const computer = (name) => ({ ch: newState(name), library: createLibrary() });
/** A page added on day `day`. */
const add = (who, id, day = 1000, target) =>
  ops.add(who.library, { tree: MAIN, nodes: [{ id, url: `https://${id}.example/`, title: id }], target, position: target && 'inside' }, day * DAY);
const outline = (who, tree = MAIN) => rowsOf(who.library, tree, true).map((row) => '.'.repeat(row.depth) + row.id).join(' ');
/** One round, as the worker does it: listen, then tell. */
async function exchange(store, who, budget) {
  await receive(store, who.ch, who.library, NOW);
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
  ops.delete(a.library, { ids: ['y'] }, 2000 * DAY);
  ops.rename(a.library, { id: 'x', name: 'Mine' });
  ops.move(b.library, { tree: MAIN, ids: ['z'], target: 'x', position: 'before' });
  await rounds(store, [a, b]);
  assert.equal(outline(b), 'z x');
  assert.equal(outline(a), 'z x');
  assert.equal(b.library.nodes.x.name, 'Mine');
  assert.deepEqual(b.library.trash.map((entry) => entry.node.id), ['y']);
  ops.restore(b.library, { tree: MAIN, ids: ['y'] }, 2001 * DAY);
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
  ops['group-add'](a.library, { tree: MAIN, id: 'folder', name: 'Folder' }, 10 * DAY);
  for (let n = 0; n < 60; n++) add(a, `old${n}`, 10 + n, 'folder');
  add(a, 'fresh', 2000, 'folder');
  for (let n = 0; n < 20; n++) add(a, `new${n}`, 1900 + n);
  const budget = 1400;
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
  ops.delete(a.library, { ids: ['c'] }, 2000 * DAY);
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

// --- Two computers that are both on ----------------------------------------------
// Each has the synced storage as it has reached it; `bring` is the browser
// carrying one's writes to the other, some time later. Both write about once
// a minute (their own tabs see to that), so their snapshots cross all the time.

function pair(ids) {
  const [a, b] = [computer('a'), computer('b')];
  const [atA, atB] = [sharedStore(), sharedStore()];
  for (const id of ids) add(a, id);
  return { a, b, atA, atB };
}
/** The browser brings what one computer wrote to the other: the later write is what stays. */
function bring(from, to) {
  for (const key in to.cells) delete to.cells[key];
  Object.assign(to.cells, structuredClone(from.cells));
}
/** Both in step, to start from. */
async function inStep({ a, b, atA, atB }) {
  for (let n = 0; n < 2; n++) {
    await exchange(atA, a);
    bring(atA, atB);
    await exchange(atB, b);
    bring(atB, atA);
  }
}
/** Time enough for everything to reach everyone. */
const settleDown = (two) => inStep(two);

test('deleted here while the page changed there: it stays deleted, on both', async () => {
  const two = pair(['x', 'y']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  b.library.nodes.x.title = 'A new title'; // x is open in a tab there.
  ops.delete(a.library, { ids: ['x'] }, 2000 * DAY);
  await exchange(atB, b); // b tells of the title; it has not heard of the deletion.
  bring(atB, atA);
  await exchange(atA, a);
  assert.equal(outline(a), 'y');
  await settleDown(two);
  assert.equal(outline(a), 'y');
  assert.equal(outline(b), 'y');
});

test('moved here while a tab opened next to it there: it stays where it was moved', async () => {
  const two = pair(['x', 'y', 'z']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  ops.move(a.library, { tree: MAIN, ids: ['z'], target: 'x', position: 'inside' });
  ops.add(b.library, { tree: MAIN, nodes: [{ id: 'n', url: 'https://n.example/', title: 'n' }], target: 'y', position: 'after' }, 2000 * DAY);
  await exchange(atB, b);
  bring(atB, atA);
  await exchange(atA, a);
  assert.equal(outline(a), 'x .z y n');
  await settleDown(two);
  assert.equal(outline(a), 'x .z y n');
  assert.equal(outline(b), 'x .z y n');
});

test('snapshots that cross, again and again: nothing done here is undone', async () => {
  const two = pair(['x', 'y', 'z', 'd']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  ops.delete(a.library, { ids: ['d'] }, 2000 * DAY);
  ops.move(a.library, { tree: MAIN, ids: ['z'], target: 'x', position: 'inside' });
  ops.rename(a.library, { id: 'y', name: 'Named on a' });
  await exchange(atA, a); // a tells...
  add(b, 'b1', 2000);
  await exchange(atB, b); // ...b, which has not heard, tells too...
  bring(atB, atA); // ...and b's write is the one that stays.
  await exchange(atA, a);
  add(b, 'b2', 2000);
  await exchange(atB, b); // b writes once more before anything of a's reaches it.
  bring(atB, atA);
  await exchange(atA, a);
  assert.equal(outline(a), 'x .z y b1 b2');
  assert.equal(a.library.nodes.y.name, 'Named on a');
  await settleDown(two);
  for (const who of [a, b]) {
    assert.equal(outline(who), 'x .z y b1 b2', who.ch.device);
    assert.equal(who.library.nodes.y.name, 'Named on a');
  }
});

test('my snapshot was replaced by one that did not know it, and nothing changed here since: I say it again', async () => {
  const two = pair(['x', 'y']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  const older = structuredClone(atA.cells); // b's snapshot, as a has it.
  ops.rename(a.library, { id: 'x', name: 'Named on a' });
  ops.delete(a.library, { ids: ['y'] }, 2000 * DAY);
  await exchange(atA, a);
  // The browser settles the two writes its own way: the older one is back.
  for (const key in atA.cells) delete atA.cells[key];
  Object.assign(atA.cells, older);
  await exchange(atA, a);
  bring(atA, atB);
  await exchange(atB, b);
  assert.equal(b.library.nodes.x.name, 'Named on a');
  assert.equal(outline(b), 'x');
  // And then, with nothing new on either side, nothing is written, however often they look.
  await settleDown(two);
  atA.writes.length = atB.writes.length = 0;
  await settleDown(two);
  assert.deepEqual([...atA.writes, ...atB.writes], []);
});

test('a deletion taken back by an undo comes back everywhere', async () => {
  const two = pair(['x', 'y']);
  const { a, b } = two;
  await inStep(two);
  const before = structuredClone(a.library);
  ops.delete(a.library, { ids: ['y'] }, 2000 * DAY);
  await settleDown(two);
  assert.equal(outline(b), 'x');
  // What the worker does for an undo: the change made backwards, and what is back marked as back.
  apply(a.library, diff(a.library, before), 2000 * DAY + 60_000);
  revive(a.library, 2000 * DAY + 60_000);
  await settleDown(two);
  assert.equal(outline(a), 'x y');
  assert.equal(outline(b), 'x y');
  assert.deepEqual([a.library.trash, b.library.trash, goneOf(a.library), goneOf(b.library)], [[], [], [], []]);
});

test('what an older version left is read: its state here, its snapshot there', async () => {
  const two = pair(['x', 'y', 'z']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  // The other computer still runs the older version: its snapshot names deletions without their times.
  ops.delete(b.library, { ids: ['z'] }, 2000 * DAY);
  await exchange(atB, b);
  const through = (data, stream) => new Response(new Blob([data]).stream().pipeThrough(stream));
  const { head } = atB.cells;
  const packed = head.top.map((name) => atB.cells[`p.${name}`]).join('');
  const top = JSON.parse(await through(Uint8Array.from(atob(packed), (char) => char.charCodeAt(0)), new DecompressionStream('deflate-raw')).text());
  delete top.goneAt;
  const bytes = new Uint8Array(await through(JSON.stringify(top), new CompressionStream('deflate-raw')).arrayBuffer());
  atB.cells['p.old'] = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  head.top = ['old'];
  // And this computer has just been updated: what it kept of the channel is in the older shape.
  const { told, heard, at, ...kept } = a.ch;
  a.ch = migrate({ ...kept, seen: told.seen, gone: told.gone, before: heard && { clock: heard.clock, seen: heard.seen }, mine: true });
  bring(atB, atA);
  await exchange(atA, a);
  assert.equal(outline(a), 'x y');
  assert.deepEqual(a.library.trash.map((entry) => entry.node.id), ['z']);
  await settleDown(two);
  assert.equal(outline(a), 'x y');
  assert.equal(outline(b), 'x y');
});

test('too big to sync whole, whatever the room: once the two agree, nothing more is written', async () => {
  for (const budget of [800, 1100, 1400, 1500, 1550, 1700, 2000, 2600]) {
    const store = sharedStore();
    const [a, b] = [computer('a'), computer('b')];
    ops['group-add'](a.library, { tree: MAIN, id: 'folder', name: 'Folder' }, 10 * DAY);
    for (let n = 0; n < 60; n++) add(a, `old${n}`, 10 + n, 'folder');
    add(a, 'fresh', 2000, 'folder');
    for (let n = 0; n < 20; n++) add(a, `new${n}`, 1900 + n);
    for (let n = 0; n < 25; n++) add(b, `theirs${n}`, 500 + n * 60); // b has old pages of its own, and some fresh ones.
    await rounds(store, [a, b], budget);
    await rounds(store, [a, b], budget);
    // A page the other never got is deleted, one it has is renamed, each side adds a page.
    ops.delete(a.library, { ids: ['old0'] }, 2005 * DAY);
    ops.rename(a.library, { id: 'fresh', name: 'Still fresh' });
    add(b, 'late', 2006);
    await rounds(store, [a, b], budget);
    await rounds(store, [a, b], budget);
    assert.equal(b.library.nodes.fresh.name, 'Still fresh', `room for ${budget}`);
    assert.ok(a.library.nodes.late, `room for ${budget}`);
    store.writes.length = 0;
    await rounds(store, [a, b], budget);
    assert.deepEqual(store.writes, [], `room for ${budget}`);
    // Neither lost what does not fit.
    assert.ok(Object.keys(a.library.nodes).length >= 81 && Object.keys(b.library.nodes).length >= 26, `room for ${budget}`);
  }
});

test('a tree deleted there while a page was put into it here: what stays, stays on both, and that is the end of it', async () => {
  const two = pair(['x']);
  const { a, b, atA, atB } = two;
  ops['tree-add'](a.library, { id: 'work', name: 'Work' });
  ops['group-add'](a.library, { tree: 'work', id: 'g', name: 'Group' }, 1000 * DAY);
  ops.add(a.library, { tree: 'work', nodes: [{ id: 'old', url: 'https://old.example/', title: 'old' }], target: 'g', position: 'inside' }, 1000 * DAY);
  await inStep(two);
  ops['tree-remove'](b.library, { tree: 'work' }, 2000 * DAY);
  ops.add(a.library, { tree: 'work', nodes: [{ id: 'new', url: 'https://new.example/', title: 'new' }], target: 'g', position: 'inside' }, 2000 * DAY);
  await exchange(atB, b);
  bring(atB, atA);
  await exchange(atA, a);
  assert.equal(outline(a, 'work'), 'g .new');
  await settleDown(two);
  await settleDown(two);
  assert.equal(outline(a, 'work'), 'g .new');
  assert.equal(outline(b, 'work'), 'g .new');
  atA.writes.length = atB.writes.length = 0;
  await settleDown(two);
  assert.deepEqual([...atA.writes, ...atB.writes], []);
});

test('a snapshot from a newer version is left alone: nothing taken from it, nothing written over it', async () => {
  const two = pair(['x']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  add(b, 'theirs', 2000);
  await exchange(atB, b);
  atB.cells.head.version = VERSION + 1; // The other computer has been updated; this one has not.
  bring(atB, atA);
  ops.rename(a.library, { id: 'x', name: 'Mine' });
  const there = JSON.stringify(atA.cells);
  await exchange(atA, a);
  assert.equal(outline(a), 'x');
  assert.equal(JSON.stringify(atA.cells), there);
  assert.equal(a.ch.newer, true);
  // This one is updated too (the same snapshot, now of a shape it knows): all is as usual.
  atA.cells.head.version = VERSION;
  await exchange(atA, a);
  assert.equal(outline(a), 'x theirs');
  assert.equal(a.ch.newer, false);
  bring(atA, atB);
  await exchange(atB, b);
  assert.equal(b.library.nodes.x.name, 'Mine');
});

test('a snapshot from an older version is read in today\'s shape', async () => {
  const two = pair(['x']);
  const { a, b, atA, atB } = two;
  await inStep(two);
  // As version 2 had it: a group was a note with nothing in it.
  b.library.nodes.g = { id: 'g', note: '', name: 'A group', added: 2000 * DAY };
  b.library.trees[MAIN].children.root.push('g');
  await exchange(atB, b);
  atB.cells.head.version = 2;
  bring(atB, atA);
  await exchange(atA, a);
  assert.deepEqual(a.library.nodes.g, { id: 'g', name: 'A group', added: 2000 * DAY, group: true });
});
