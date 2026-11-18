import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, MAIN, ROOT, addNode, createLibrary, goneOf, gridOf, handOf, migrate, planOf, problems, quickOf, rowsOf } from '../src/model.js';
import { ops, perform } from '../src/ops.js';
import { apply, diff, hasNews, mark, only, takeIn } from '../src/merge.js';

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
const taking = (mine, theirs, at = NOW) => takeIn(structuredClone(mine), theirs, at);
/**
 * Each copy takes the other in. They must come to the same, whichever does
 * it first, and taking in again must change nothing. Returns what they come to.
 */
function meet(a, b, at = NOW) {
  const [ra, rb] = [taking(a, b, at), taking(b, a, at)];
  assert.equal(told(ra), told(rb), 'the two come to the same');
  assert.equal(told(taking(ra, rb, at)), told(ra), 'and stay so');
  assert.equal(hasNews(ra, rb, at), false, 'with nothing more to tell');
  assert.deepEqual(problems(ra), []);
  return ra;
}
/** What a library says, in one order whatever order it was put together in. */
function told(lib) {
  const trees = Object.keys(lib.trees).sort().map((id) => [id, lib.trees[id].name, outline(lib, id), quickOf(lib.trees[id]), Object.keys(lib.trees[id].collapsed).sort()]);
  const nodes = Object.keys(lib.nodes).sort().map((id) => Object.entries(lib.nodes[id]).sort());
  return JSON.stringify([trees, nodes, planOf(lib), goneOf(lib)]);
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
  does(d, 30, 'add', { tree: 'home', nodes: [page('new')], target: 'h', position: 'inside' });
  both = meet(c, d, 40);
  assert.equal(outline(both, 'home'), 'new'); // What its deleter never saw keeps the tree; what they knew of is gone, as they said.
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
  assert.deepEqual([lib.trees[MAIN].folded, lib.nodes.a.at, lib.nodes.b.at, lib.nodes.b.seen, lib.nodes.a.moved], [11, undefined, 12, 12, undefined]); // A fold is the tree's, not the node's.
  does(lib, 13, 'tree-rename', { tree: MAIN, name: 'Named' });
  does(lib, 14, 'delete', { ids: ['a'] });
  assert.deepEqual([lib.trees[MAIN].at, lib.gone], [13, { a: 14 }]);
  does(lib, 15, 'restore', { tree: MAIN, ids: ['a'] });
  assert.deepEqual([lib.nodes.a.at, lib.nodes.a.moved, goneOf(lib)], [15, 15, []]);
});

/** A sync through a store that keeps whole libraries (GitHub), as the worker does it: take theirs in; save mine if it tells theirs anything. */
function sync(me, cloud, at) {
  if (cloud.library) me.library = taking(me.library, cloud.library, at);
  const news = !cloud.library || hasNews(cloud.library, me.library, at);
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

test('a part of a library leaves a node out of the lists kept at hand too; taking it in leaves mine as they are for the rest', () => {
  const [a, b] = two('a\nb\nc');
  does(a, 5, 'quick', { tree: MAIN, ids: ['c', 'a'] });
  does(a, 6, 'plan', { ids: ['b', 'c'] });
  does(a, 7, 'collapse', { tree: MAIN, id: 'c', collapsed: true });
  const whole = taking(b, a);
  does(a, 10, 'quick', { tree: MAIN, ids: ['b'] });
  does(a, 11, 'unplan', { ids: ['b'] });
  does(a, 12, 'plan', { ids: ['a'] });
  does(a, 13, 'collapse', { tree: MAIN, id: 'a', collapsed: true });
  const part = only(a, new Set(['a', 'b']));
  assert.deepEqual([quickOf(part.trees[MAIN]), planOf(part), part.trees[MAIN].collapsed], [['a', 'b'], ['a'], { a: true }]);
  const mine = taking(whole, part);
  assert.deepEqual([quickOf(mine.trees[MAIN]), planOf(mine), mine.trees[MAIN].collapsed], [['a', 'b', 'c'], ['a', 'c'], { c: true, a: true }]);
});

test('a page put into a group that was then moved stays in it, whatever the other computer moved later', () => {
  const [a, b] = two('a\nb');
  does(a, 10, 'group-add', { tree: MAIN, id: 'g', name: 'Group' });
  does(a, 20, 'add', { tree: MAIN, nodes: [page('x')], target: 'g', position: 'inside' });
  does(a, 30, 'move', { tree: MAIN, ids: ['g'], target: 'a', position: 'before' });
  does(b, 40, 'move', { tree: MAIN, ids: ['b'], target: 'a', position: 'before' });
  assert.equal(outline(meet(a, b)), 'b\ng\n  x\na');
});

test('folding is not a change to the node: a name given elsewhere before, and not heard of, stays', () => {
  const [a, b] = two('a\n  x\nb\n  y');
  does(b, 10, 'rename', { id: 'a', name: 'Named there' });
  does(b, 11, 'collapse', { tree: MAIN, id: 'b', collapsed: true });
  does(a, 20, 'collapse', { tree: MAIN, id: 'a', collapsed: true });
  const both = meet(a, b);
  assert.equal(both.nodes.a.name, 'Named there');
  assert.deepEqual(both.trees[MAIN].collapsed, { a: true }); // The folds of a tree are one thing: as they were left where it was folded last.
});

test('a library kept by the version before this one, with no times in it: read, and what is done from now on wins', () => {
  const old = () => ({ ...library('a\nb\nc'), version: 3, gone: { d: 5 }, trash: [] });
  const [a, b] = [migrate(old()), migrate(old())];
  b.nodes.b.restored = 7; // As that version marked a node brought back.
  migrate(Object.assign(b, { version: 3 }));
  assert.equal(b.nodes.b.at, 7);
  does(a, 2100 * DAY, 'move', { tree: MAIN, ids: ['c'], target: 'a', position: 'before' });
  does(a, 2100 * DAY + 1, 'delete', { ids: ['b'] });
  const both = meet(a, b, 2100 * DAY + 2);
  assert.equal(outline(both), 'c\na');
});

// Whatever is done on two computers, and whenever one hears of the other: they come to the same, and nothing
// is lost that nobody deleted - nor by taking in a part of a library, which says nothing of the rest.
test('any two histories come to the same, whichever copy takes the other in', () => {
  let seed = 7;
  const random = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  const pick = (list) => list[random(list.length)];
  for (let run = 0; run < 1000; run++) {
    let [a, b] = two('p\n  q\n  r\ns\nt\n  u');
    let [clock, made] = [10, 0];
    const act = (lib) => {
      const at = (clock += 1 + random(3));
      const trees = Object.keys(lib.trees);
      const tree = pick(trees);
      const here = rowsOf(lib, tree, true).map((row) => row.id);
      const [id, target] = [pick(here), pick(here)];
      const all = [
        () => does(lib, at, 'add', { tree, nodes: [page(`n${made++}`)], target, position: target && pick(['inside', 'before', 'after']) }),
        () => id && does(lib, at, 'move', { tree, ids: [id], target, position: pick(['inside', 'before', 'after', 'first', 'end']) }),
        () => id && does(lib, at, 'move', { tree: pick(trees), from: tree, ids: [id], position: 'end', take: random(2) === 0 }),
        () => id && does(lib, at, 'rename', { id, name: `name ${at}` }),
        () => id && does(lib, at, 'delete', { ids: [id] }),
        () => id && does(lib, at, 'remove', { tree, ids: [id] }),
        () => id && does(lib, at, 'indent', { tree, ids: [id] }),
        () => id && does(lib, at, 'collapse', { tree, id, collapsed: random(2) === 0 }),
        () => id && does(lib, at, 'quick', { tree, ids: [id] }),
        () => id && does(lib, at, 'plan', { ids: [id] }),
        () => lib.trash.length && does(lib, at, 'restore', { tree, ids: [pick(lib.trash).node.id] }),
        () => does(lib, at, 'tree-add', { id: `t${made++}`, name: `Tree ${at}` }),
        () => does(lib, at, 'tree-rename', { tree, name: `Tree ${at}` }),
        () => trees.length > 1 && does(lib, at, 'tree-remove', { tree }),
        () => id && Object.assign(lib.nodes[id], { title: `title ${at}`, seen: at }), // Its tab.
      ];
      pick(all)();
      assert.deepEqual(problems(lib), []);
    };
    for (let step = random(12); step > 0; step--) act(pick([a, b]));
    for (let round = random(4); round > 0; round--) {
      if (random(2)) a = taking(a, b, clock);
      else b = taking(b, a, clock);
      for (let step = random(8); step > 0; step--) act(pick([a, b]));
    }
    const both = meet(a, b, clock + 100);
    for (const id in a.nodes) if (b.nodes[id]) assert.ok(both.nodes[id], `${id}, which neither deleted, is there`);
    const part = only(b, new Set(Object.keys(b.nodes).filter(() => random(3))));
    const mine = taking(a, part, clock + 100);
    assert.deepEqual(problems(mine), []);
    for (const id in a.nodes) assert.ok(mine.nodes[id] || (!b.nodes[id] && b.gone[id] >= handOf(a.nodes[id])), `${id}, which they did not delete, is there`);
    assert.equal(hasNews(mine, part, clock + 100), false);
  }
});
