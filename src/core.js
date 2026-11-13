// How the library reacts to what happens in the browser. Pure: no Chrome here.
//
//   state.library   the user's nodes and trees (see model.js); kept for good
//   state.binding   { [tabId]: { node, tree, unplaced? } } - which node each open
//                   tab shows, and in which tree it was opened (links opened
//                   from it become its children there); `unplaced` marks a tab
//                   whose place nobody chose yet: it stands where new tabs go
//                   by default. True only on this computer, for this
//                   browser session
//   state.windows   { [windowId]: treeId } - the tree each window's panel shows
//   state.attention, state.journal   where the user is and was (see journal.js)
//
// A node with a tab is live; one without is asleep. Tabs come and go, nodes
// stay until the user deletes them.

import {
  DAY,
  MAIN,
  ROOT,
  addNode,
  createLibrary,
  freshOf,
  goHome,
  homeHere,
  inTree,
  isGroup,
  isNote,
  kidsOf,
  moveNode,
  newId,
  parentOf,
  placeNode,
  removeNode,
  stamped,
  treeFor,
  validTree,
} from './model.js';

export const createState = () => ({ library: createLibrary(), binding: {}, windows: {}, attention: undefined, journal: [] });

/** The address of the page that shows a note. */
export const notePath = (id) => `src/note/note.html?id=${id}`;

const BLANK = ['', 'about:blank', 'chrome://newtab/', 'chrome://new-tab-page/'];
export const isBlank = (url) => BLANK.includes(url ?? '');

const urlOf = (tab) => tab.pendingUrl || tab.url || '';

const noteIdIn = (url) => url.match(/\/src\/note\/note\.html\?id=([\w-]+)/)?.[1];

/**
 * The library as other computers should see it: without the empty new tabs
 * and notes of this one, which are nobody else's business (and leave no
 * trace here either, once closed).
 */
export function shared(library) {
  const copy = structuredClone(library);
  for (const id in copy.nodes) dropIfEmpty(copy, id);
  return copy;
}

/** The open tab showing `nodeId`, if any. */
export function tabOf(state, nodeId) {
  for (const tabId in state.binding) if (state.binding[tabId].node === nodeId) return Number(tabId);
  return undefined;
}

// --- Which tab shows which node ------------------------------------------------
// The binding is kept here and nowhere else: a tab is tied to a node that
// exists, in a tree that holds it.

/** Ties a tab to a node, shown in `tree`. `unplaced`: nobody chose the node's place yet. */
export function bind(state, tabId, node, tree, unplaced = false) {
  state.binding[tabId] = unplaced ? { node, tree, unplaced } : { node, tree };
}

/** The tree a tab's node is shown in becomes `tree` (the user went to it there). */
export function shownIn(state, tabId, tree) {
  state.binding[tabId].tree = tree;
}

/**
 * After the library changed under the open tabs: each stays tied to its
 * node, in a tree that still holds it. A tab whose node is gone is let go
 * of; the ids of those tabs are returned, for the caller to close them or
 * give them nodes anew.
 */
export function rebind(state) {
  const { library, binding } = state;
  const orphans = [];
  for (const tabId in binding) {
    const bound = binding[tabId];
    if (library.nodes[bound.node]) bound.tree = treeFor(library, bound.node, bound.tree);
    else {
      orphans.push(Number(tabId));
      delete binding[tabId];
    }
  }
  return orphans;
}

const liveIds = (state) => new Set(Object.values(state.binding).map((bound) => bound.node));

/** The extension's own pages (the panel opened as a tab, a second view of a note) are not nodes. */
const isOurs = (url) => /^chrome-extension:\/\/[^/]+\/src\//.test(url);

/** A sleeping node whose address is `url` (for a pinned one, the address it is pinned to). */
function sleeperAt(state, url) {
  if (isBlank(url)) return undefined;
  const live = liveIds(state);
  return Object.values(state.library.nodes).find(
    (node) => !live.has(node.id) && (node.url === url || (node.pinned && node.home?.url === url)),
  );
}

/** Marks a node as used at time `at` (to the day; nothing, when the time is not known). */
function touch(node, at) {
  if (node && at !== undefined) node.touched = Math.floor(at / DAY);
}

/**
 * Pages kept open count as used, however long ago they were opened: once a
 * month each is marked so. (What is used decides what other computers get
 * first when the library is too big to sync whole: see channel.js.)
 */
export function keepFresh(state, at) {
  for (const id of liveIds(state)) {
    const node = state.library.nodes[id];
    if (node && Math.floor(at / DAY) - freshOf(node) >= 30) touch(node, at);
  }
}

/**
 * A new tab or a new note the user did nothing with: no address or text, no
 * name, no children. It leaves no trace. Returns whether it was dropped.
 */
function dropIfEmpty(library, id) {
  const node = library.nodes[id];
  if (!node || node.name || (isNote(node) ? !isGroup(node) : !isBlank(node.url))) return false;
  const trees = Object.values(library.trees).filter((tree) => inTree(tree, id));
  if (trees.some((tree) => kidsOf(tree, id).length)) return false;
  for (const tree of trees) removeNode(library, tree.id, id);
  return true;
}

/**
 * A tab appeared. `sourceTabId` is the tab whose page opened it (a link), if
 * any: then it becomes a child of that tab's node, in that tab's tree.
 * Any other tab goes to `treeId`, the tree the window's panel shows: that,
 * and nothing else, says where the user is.
 * Otherwise it wakes a sleeping node with the same address, or becomes a new
 * top-level node of `treeId`, added at time `at`. Returns 'known', 'child',
 * 'woken', 'new', or 'ours' for the extension's own pages, which are not nodes.
 */
export function tabOpened(state, tab, sourceTabId, treeId = MAIN, at) {
  const { library, binding } = state;
  if (binding[tab.id]) return 'known';
  treeId = validTree(library, treeId);
  const url = urlOf(tab);
  const wake = (id) => {
    bind(state, tab.id, id, treeFor(library, id, treeId));
    touch(library.nodes[id], at);
    return 'woken';
  };

  const noteId = noteIdIn(url);
  if (noteId) {
    if (library.nodes[noteId] && !liveIds(state).has(noteId)) return wake(noteId);
    return 'ours';
  }
  if (isOurs(url)) return 'ours';

  const source = binding[sourceTabId];
  if (source && inTree(library.trees[source.tree], source.node)) {
    const node = addNode(library, source.tree, stamped({ id: newId(), url, title: tab.title ?? '' }, at), source.node);
    bind(state, tab.id, node.id, source.tree);
    return 'child';
  }

  const asleep = sleeperAt(state, url);
  if (asleep) return wake(asleep.id);

  const node = addNode(library, treeId, stamped({ id: newId(), url, title: tab.title ?? '' }, at));
  bind(state, tab.id, node.id, treeId, true);
  return 'new';
}

/**
 * A new tab the user opened while at node `nodeId` goes right below that
 * node. (Inside a folded branch too: an open tab stays in sight there, see
 * rowsOf.) Which tree the tab is in was decided before (the one the window's
 * panel shows) and is not changed here: if the node is not in that tree, the
 * new tab stays at its end.
 */
export function tabOpenedBeside(state, tabId, nodeId) {
  const bound = state.binding[tabId];
  const tree = state.library.trees[bound?.tree];
  if (!tree || !inTree(tree, nodeId)) return false;
  return moveNode(state.library, bound.tree, bound.node, nodeId, 'after');
}

/**
 * An empty tab the user asked for by name - a button of the panel, a key:
 * a new node at the end of `treeId`, or a child or the next sibling of
 * `nodeId`. Its place was chosen.
 */
export function tabAsked(state, tab, { treeId, nodeId, as, at }) {
  const node = addNode(state.library, treeId, stamped({ id: newId(), url: '', title: '' }, at));
  if (nodeId) moveNode(state.library, treeId, node.id, nodeId, as === 'child' ? 'inside' : 'after');
  bind(state, tab.id, node.id, treeId);
}

/**
 * A tab was created: its node is made, or found, and put where the tab came
 * from. What is known of that:
 *   reported   the tab whose page opened it, when the browser said so apart (a link)
 *   opener     the tab it was opened from, as the tab itself says
 *   shownNode  the node the user was at
 *   treeId     the tree the window's panel shows
 * A tab that comes from another tab with a page already in it was opened by
 * that page, whichever way the browser tells it - a link, or its own menu
 * ("search for the selected text") - and is its child. One that comes empty
 * is a new tab the user asked for: it goes below the node they were at.
 * Returns what `tabOpened` does.
 */
export function tabCreated(state, tab, { opener, reported, shownNode, treeId, at }) {
  const source = reported ?? (isBlank(urlOf(tab)) ? undefined : opener);
  const result = tabOpened(state, tab, source, treeId, at);
  // Its node was made just now: here or, if this event woke the worker, a moment ago,
  // when the state was lined up with the open tabs and it was put at the end of the tree.
  const late = result === 'known' && state.binding[tab.id].unplaced;
  if (late && source !== undefined) tabOpenedFrom(state, tab.id, source);
  else if (result === 'new' || late) tabOpenedBeside(state, tab.id, shownNode);
  return result;
}

/**
 * The browser reported, after the fact, that `tabId` was opened from
 * `sourceTabId`'s page: its node moves under that page's. Only if nobody
 * chose its place yet; and now somebody has.
 */
export function tabOpenedFrom(state, tabId, sourceTabId) {
  const { library, binding } = state;
  const bound = binding[tabId];
  const source = binding[sourceTabId];
  if (!bound?.unplaced || !source) return false;
  delete bound.unplaced;
  if (bound.tree !== source.tree) {
    placeNode(library, source.tree, bound.node, source.node);
    removeNode(library, bound.tree, bound.node);
    bound.tree = source.tree;
  }
  return moveNode(library, source.tree, bound.node, source.node, 'inside');
}

/**
 * A tab's page changed: its node follows it. The address the page first had
 * is kept as its home when it leaves it, whether the user went on or the
 * site sent them elsewhere: the saved address is never quietly replaced.
 */
export function tabChanged(state, tab) {
  const { library, binding } = state;
  const bound = binding[tab.id];
  const node = library.nodes[bound?.node];
  if (!node || isNote(node)) return;
  const url = urlOf(tab);
  // An empty new tab taken to the address of a sleeping node wakes that node.
  // (A tab the user placed under another node stays where it was put.) The
  // user is in this tree: if the node lives in another one only, it is
  // shown here too, at the end - the same node, not a copy.
  const adrift = isBlank(node.url) && (bound.unplaced || parentOf(library.trees[bound.tree], node.id) === ROOT);
  const asleep = adrift && sleeperAt(state, url);
  if (asleep && dropIfEmpty(library, node.id)) {
    placeNode(library, bound.tree, asleep.id);
    bind(state, tab.id, asleep.id, bound.tree);
    return tabChanged(state, tab);
  }
  if (isOurs(url) && dropIfEmpty(library, node.id)) {
    delete binding[tab.id];
    return;
  }
  if (url && url !== node.url && !node.home && !isBlank(node.url)) homeHere(node);
  node.url = url || node.url;
  node.title = tab.title ?? node.title;
}

/**
 * A tab closed: its node falls asleep, where it is. A pinned node goes back home; an
 * empty new tab leaves nothing behind.
 */
export function tabClosed(state, tabId, at) {
  const { library, binding } = state;
  const id = binding[tabId]?.node;
  delete binding[tabId];
  const node = library.nodes[id];
  touch(node, at);
  if (node?.pinned) goHome(node);
  dropIfEmpty(library, id);
}

/** The browser swapped one tab id for another (prerendering). */
export function tabReplaced(state, addedId, removedId) {
  if (state.binding[removedId] === undefined) return;
  state.binding[addedId] = state.binding[removedId];
  delete state.binding[removedId];
}

/**
 * Lines the state up with the tabs that are really open: at startup, after
 * the worker slept, after a browser restart (when every tab has a new id),
 * after an undo. `treeOf(tab)` says which tree a new tab's node goes to.
 */
export function reconcile(state, tabs, treeOf = () => MAIN, at) {
  const { library, binding } = state;
  const open = new Set(tabs.map((tab) => String(tab.id)));
  for (const tabId in binding) if (!open.has(tabId)) tabClosed(state, tabId, at);
  rebind(state); // A tab let go of here gets a node anew below.
  // Empty tabs the browser closed without telling us (it quit, or crashed).
  const live = liveIds(state);
  for (const id in library.nodes) if (!live.has(id)) dropIfEmpty(library, id);
  for (const tab of tabs) {
    tabOpened(state, tab, undefined, treeOf(tab), at);
    tabChanged(state, tab);
  }
}
