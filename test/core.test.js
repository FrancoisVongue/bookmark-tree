import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, ROOT, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import {
  createState,
  keepFresh,
  reconcile,
  tabChanged,
  tabAsked,
  tabClosed,
  tabCreated,
  tabOf,
  tabOpened,
  tabOpenedBeside,
  tabOpenedFrom,
  tabReplaced,
} from '../src/core.js';

const tab = (id, name) => ({ id, url: name ? `https://${name}/` : 'chrome://newtab/', title: name ?? 'New Tab' });

/** The tree as an outline of titles; sleeping nodes are in (brackets). */
function outline(state) {
  return rowsOf(state.library, MAIN)
    .map((row) => {
      const title = state.library.nodes[row.id].title;
      return '  '.repeat(row.depth) + (tabOf(state, row.id) === undefined ? `(${title})` : title);
    })
    .join('\n');
}

test('a tab becomes a top-level node', () => {
  const state = createState();
  assert.equal(tabOpened(state, tab(1, 'a')), 'new');
  assert.equal(tabOpened(state, tab(2, 'b')), 'new');
  assert.equal(tabOpened(state, tab(2, 'b')), 'known');
  assert.equal(outline(state), 'a\nb');
});

test('a tab opened from a page becomes its child', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'));
  assert.equal(tabOpened(state, tab(3, 'c'), 1), 'child');
  assert.equal(tabOpened(state, tab(4, 'd'), 3), 'child');
  assert.equal(outline(state), 'a\n  c\n    d\nb');
});

test('the source can be reported after the tab', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'));
  assert.equal(tabOpenedFrom(state, 2, 1), true);
  assert.equal(outline(state), 'a\n  b');
  assert.equal(tabOpenedFrom(state, 9, 1), false);
});

test('a closed tab leaves its node asleep, where it was', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'), 1);
  tabClosed(state, 1);
  assert.equal(outline(state), '(a)\n  b');
  assert.deepEqual(state.binding, { 2: state.binding[2] });
});

test('an empty new tab leaves nothing behind when it closes', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2));
  tabClosed(state, 2);
  assert.equal(outline(state), 'a');
});

test('an empty tab with children stays when it closes', () => {
  const state = createState();
  tabOpened(state, tab(1));
  tabOpened(state, tab(2, 'b'), 1);
  tabClosed(state, 1);
  assert.equal(outline(state), '(New Tab)\n  b');
});

test('opening the address of a sleeping node wakes it instead of adding one', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'), 1);
  tabClosed(state, 2);
  assert.equal(tabOpened(state, tab(7, 'b')), 'woken');
  assert.equal(outline(state), 'a\n  b');
});

test('a link to the address of a sleeping node still opens as a child', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'));
  tabClosed(state, 2);
  assert.equal(tabOpened(state, tab(3, 'b'), 1), 'child');
  assert.equal(outline(state), 'a\n  b\n(b)');
});

test('a live node is never taken by a second tab with the same address', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  assert.equal(tabOpened(state, tab(2, 'a')), 'new');
  assert.equal(outline(state), 'a\na');
});

test('a node follows its tab to another page', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabChanged(state, tab(1, 'z'));
  assert.equal(outline(state), 'z');
  tabChanged(state, tab(99, 'q')); // Not a tab we know: ignored.
  assert.equal(outline(state), 'z');
});

test('a replaced tab keeps its node', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  const id = state.binding[1];
  tabReplaced(state, 5, 1);
  assert.deepEqual(state.binding, { 5: id });
});

test('after a browser restart tabs find their nodes by address', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'), 1);
  tabOpened(state, tab(3, 'c'), 2);
  // New session: same pages, new tab ids, one page more and one less.
  state.binding = {};
  reconcile(state, [tab(11, 'c'), tab(12, 'a'), tab(13, 'new')]);
  assert.equal(outline(state), 'a\n  (b)\n    c\nnew');
});

test('reconcile drops tabs that are gone and keeps the rest', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'));
  reconcile(state, [tab(2, 'b')]);
  assert.equal(outline(state), '(a)\nb');
});

test('an empty new tab taken to a sleeping node\'s address wakes that node', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'b'), 1);
  tabClosed(state, 2);
  tabOpened(state, tab(3));
  tabChanged(state, tab(3, 'b'));
  assert.equal(outline(state), 'a\n  b');
  assert.equal(tabOf(state, state.binding[3].node), 3);
});

test('empty tabs left asleep by a browser that quit are swept away', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2));
  state.binding = {};
  reconcile(state, []);
  assert.equal(outline(state), '(a)');
});

test('a page keeps the address it first had as its home; only a pinned one goes back there by itself', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  const node = state.library.nodes[state.binding[1].node];
  assert.equal(node.home, undefined); // Still where it started: nothing to go back to.
  tabChanged(state, tab(1, 'b'));
  tabChanged(state, tab(1, 'c'));
  assert.deepEqual(node.home, { url: 'https://a/', title: 'a' });
  tabClosed(state, 1);
  assert.equal(outline(state), '(c)'); // It sleeps where the user left it.
  // Opening the first address anew does not wake it and send it back there: c would be lost.
  assert.equal(tabOpened(state, tab(2, 'a')), 'new');
});

test('a pinned node goes back home when its tab closes', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  const node = state.library.nodes[state.binding[1].node];
  ops.pin(state.library, { ids: [node.id], pinned: true });
  tabChanged(state, tab(1, 'z'));
  assert.equal(outline(state), 'z');
  tabClosed(state, 1);
  assert.equal(outline(state), '(a)');
  assert.equal(tabOpened(state, tab(5, 'a')), 'woken');
});

test('a saved page that sends the browser elsewhere keeps its saved address', () => {
  const state = createState();
  ops.add(state.library, { tree: MAIN, nodes: [{ id: 'saved', url: 'https://bank/', title: 'Bank' }] });
  assert.equal(tabOpened(state, { id: 1, url: 'https://bank/' }), 'woken');
  tabChanged(state, { id: 1, url: 'https://login.bank/?next=home', title: 'Sign in' }); // A redirect.
  assert.deepEqual(state.library.nodes.saved.home, { url: 'https://bank/', title: 'Bank' });
  // An empty new tab taken somewhere has no address to keep before that.
  tabOpened(state, tab(2));
  tabChanged(state, tab(2, 'first'));
  assert.equal(state.library.nodes[state.binding[2].node].home, undefined);
});

test('the extension\'s own pages are not nodes', () => {
  const state = createState();
  assert.equal(tabOpened(state, { id: 1, url: 'chrome-extension://abc/src/panel/panel.html' }), 'ours');
  tabOpened(state, tab(2));
  tabChanged(state, { id: 2, url: 'chrome-extension://abc/src/panel/panel.html', title: 'Tree' });
  assert.equal(outline(state), '');
});

test('a new tab opened while looking at a page goes right below it, and still wakes a sleeping page', () => {
  const state = createState();
  tabOpened(state, { id: 1, url: 'https://a.example/' });
  tabOpened(state, { id: 2, url: 'https://b.example/' }, 1);
  tabOpened(state, { id: 3, url: 'https://c.example/' });
  tabClosed(state, 3);
  assert.equal(tabOpened(state, { id: 4, url: 'chrome://newtab/' }), 'new');
  tabOpenedBeside(state, 4, state.binding[2].node);
  const tree = state.library.trees[MAIN];
  const [a, b, c] = [1, 2].map((id) => state.binding[id].node).concat(tree.children[ROOT][1]);
  assert.deepEqual(tree.children[a], [b, state.binding[4].node]);
  // Taken to the address of the sleeping page, the empty tab becomes that page.
  tabChanged(state, { id: 4, url: 'https://c.example/' });
  assert.equal(state.binding[4].node, c);
  assert.deepEqual(tree.children[a], [b]);
});

test('the tree the panel shows decides where a new tab goes, whatever page the user came from', () => {
  const state = createState();
  state.library.trees.other = { id: 'other', name: 'Other', children: {}, collapsed: {} };
  tabOpened(state, { id: 1, url: 'https://a.example/' });
  // The panel now shows the other, empty tree; the tab of the first is still the current one.
  tabOpened(state, { id: 2, url: 'chrome://newtab/' }, undefined, 'other');
  assert.equal(tabOpenedBeside(state, 2, state.binding[1].node), false);
  assert.deepEqual(state.library.trees.other.children[ROOT], [state.binding[2].node]);
  assert.deepEqual(state.library.trees[MAIN].children[ROOT], [state.binding[1].node]);
  // The next one is opened while looking at that new tab: right below it, in the same tree.
  tabOpened(state, { id: 3, url: 'chrome://newtab/' }, undefined, 'other');
  tabOpenedBeside(state, 3, state.binding[2].node);
  assert.deepEqual(state.library.trees.other.children[ROOT], [2, 3].map((id) => state.binding[id].node));
});

test('a node remembers the day its tab was last opened or closed; one kept open is marked once a month', () => {
  const state = createState();
  const DAY = 24 * 3600 * 1000;
  tabOpened(state, { id: 1, url: 'https://a.example/' }, undefined, MAIN, 10 * DAY);
  const node = state.library.nodes[state.binding[1].node];
  assert.equal(node.touched, undefined);
  keepFresh(state, 39 * DAY);
  assert.equal(node.touched, undefined);
  keepFresh(state, 40 * DAY);
  assert.equal(node.touched, 40);
  tabClosed(state, 1, 50 * DAY);
  assert.equal(node.touched, 50);
  tabOpened(state, { id: 2, url: 'https://a.example/' }, undefined, MAIN, 60 * DAY);
  assert.equal(node.touched, 60);
});

test('an address typed in a new tab that a sleeping node of another tree has: the node is shown in this tree too', () => {
  const state = createState();
  state.library.trees.other = { id: 'other', name: 'Other', children: {}, collapsed: {} };
  tabOpened(state, { id: 1, url: 'https://a.example/' });
  const a = state.binding[1].node;
  tabClosed(state, 1);
  // The panel shows the other tree; a new tab there is taken to that address.
  tabOpened(state, { id: 2, url: 'chrome://newtab/' }, undefined, 'other');
  tabChanged(state, { id: 2, url: 'https://a.example/', title: 'A' });
  assert.deepEqual(state.binding[2], { node: a, tree: 'other' });
  assert.deepEqual(state.library.trees.other.children[ROOT], [a]);
  assert.deepEqual(state.library.trees[MAIN].children[ROOT], [a]);
  assert.equal(Object.keys(state.library.nodes).length, 1);
  // After a restart of the browser (every tab has a new id) the tab finds its node wherever it is, and nothing is added.
  state.binding = {};
  reconcile(state, [{ id: 7, url: 'https://a.example/', title: 'A' }], () => 'other');
  assert.equal(state.binding[7].node, a);
  assert.equal(Object.keys(state.library.nodes).length, 1);
  assert.deepEqual(state.library.trees[MAIN].children[ROOT], [a]);
});

test('a new tab opened while on a page inside a folded branch goes right below that page all the same', () => {
  const state = createState();
  tabOpened(state, { id: 1, url: 'https://a.example/' });
  tabOpened(state, { id: 2, url: 'https://b.example/' }, 1);
  tabOpened(state, { id: 3, url: 'https://c.example/' }, 2);
  tabOpened(state, { id: 4, url: 'https://last.example/' });
  const [a, b, c, last] = [1, 2, 3, 4].map((id) => state.binding[id].node);
  state.library.trees[MAIN].collapsed[a] = true;
  state.library.trees[MAIN].collapsed[b] = true;
  tabOpened(state, { id: 5, url: 'chrome://newtab/' });
  tabOpenedBeside(state, 5, c);
  assert.deepEqual(state.library.trees[MAIN].children[ROOT], [a, last]);
  assert.deepEqual(state.library.trees[MAIN].children[b], [c, state.binding[5].node]);
});

test('where a new tab goes, from what is known of where it came from', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  const a = state.binding[1].node;
  const from = (id, name, known) => tabCreated(state, name ? tab(id, name) : tab(id), { shownNode: a, ...known });
  assert.equal(from(2, 'link', { reported: 1, opener: 1 }), 'child'); // A link: the browser reported the page.
  assert.equal(from(3, 'search', { opener: 1 }), 'child'); // The browser's own menu: it comes with a page, from a tab.
  assert.equal(from(4, undefined, { opener: 1 }), 'new'); // Empty: a new tab the user asked for, below where they were.
  assert.equal(outline(state), 'a\n  link\n  search\nNew Tab');
  // The report that a page opened the tab comes after the tab: its node moves under that page, once.
  assert.equal(tabOpenedFrom(state, 4, 3), true);
  assert.equal(tabOpenedFrom(state, 4, 1), false);
  assert.equal(outline(state), 'a\n  link\n  search\n    New Tab');
  // The worker woke on this very tab and had already lined itself up with it: it is still put where it came from.
  tabOpened(state, tab(5, 'late'));
  assert.equal(from(5, 'late', { opener: 2 }), 'known');
  assert.equal(outline(state), 'a\n  link\n    late\n  search\n    New Tab');
});

test('an empty tab the user placed stays where it was put; one put at the end of the tree is free to become a sleeping page', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  tabOpened(state, tab(2, 'saved'));
  tabClosed(state, 2);
  const a = state.binding[1].node;
  // Asked for as the next sibling of a (a top-level node), then taken to the saved page's address: a page of its own, there.
  tabAsked(state, { id: 3 }, { treeId: MAIN, nodeId: a, as: 'sibling' });
  tabChanged(state, tab(3, 'saved'));
  assert.equal(outline(state), 'a\nsaved\n(saved)');
  // Asked for with no place named: it becomes the saved page.
  tabAsked(state, { id: 4 }, { treeId: MAIN });
  tabChanged(state, tab(4, 'saved'));
  assert.equal(outline(state), 'a\nsaved\nsaved');
});

test('a tab born empty is a new tab, even if it shows a page by the time it is heard of', () => {
  const state = createState();
  tabOpened(state, tab(1, 'a'));
  const a = state.binding[1].node;
  // The worker slept: it lined itself up with the tabs first (the new one already at a page), then heard of the new tab.
  tabOpened(state, tab(2, 'later'));
  assert.equal(tabCreated(state, tab(2, 'later'), { born: 'about:blank', opener: 1, shownNode: a }), 'known');
  // The worker was awake: the tab is heard of as it is born.
  assert.equal(tabCreated(state, tab(3), { born: 'about:blank', opener: 1, shownNode: a }), 'new');
  assert.equal(outline(state), 'a\nNew Tab\nlater'); // Both below the page the user was at; neither its child.
  // Born with a page, from a tab: that page's child, whenever it is heard of.
  tabOpened(state, tab(4, 'search'));
  assert.equal(tabCreated(state, tab(4, 'search'), { born: 'https://search/', opener: 1, shownNode: a }), 'known');
  assert.equal(outline(state), 'a\n  search\nNew Tab\nlater');
});
