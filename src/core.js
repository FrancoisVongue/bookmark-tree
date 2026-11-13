// How the library reacts to what happens in the browser. Pure: no Chrome here.
//
//   state.library   the user's nodes and trees (see model.js); kept for good
//   state.binding   { [tabId]: { node, tree, loose? } } - which node each open
//                   tab shows, and in which tree it was opened (links opened
//                   from it become its children there); `loose` marks a tab
//                   whose place nobody chose. True only on this computer,
//                   for this browser session
//   state.windows   { [windowId]: treeId } - the tree each window's panel shows
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

export const createState = () => ({ library: createLibrary(), binding: {}, windows: {} });

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

const liveIds = (state) => new Set(Object.values(state.binding).map((bound) => bound.node));

/** The extension's own pages (the panel opened as a tab, a second view of a note) are not nodes. */
const isOurs = (url) => /^chrome-extension:\/\/[^/]+\/src\//.test(url);

/** A sleeping node whose address (current or pinned) is `url`. */
function sleeperAt(state, url) {
  if (isBlank(url)) return undefined;
  const live = liveIds(state);
  return Object.values(state.library.nodes).find(
    (node) => !live.has(node.id) && (node.url === url || node.home?.url === url),
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
    binding[tab.id] = { node: id, tree: treeFor(library, id, treeId) };
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
    binding[tab.id] = { node: node.id, tree: source.tree };
    return 'child';
  }

  const asleep = sleeperAt(state, url);
  if (asleep) return wake(asleep.id);

  const node = addNode(library, treeId, stamped({ id: newId(), url, title: tab.title ?? '' }, at));
  binding[tab.id] = { node: node.id, tree: treeId, loose: true };
  return 'new';
}

/**
 * A new tab the user opened while looking at `besideTabId`'s page goes right
 * below that page. Which tree it is in was decided before (the one the
 * window's panel shows) and is not changed here: if the page is not in that
 * tree, the new tab stays at its end.
 */
export function tabOpenedBeside(state, tabId, besideTabId) {
  const bound = state.binding[tabId];
  const beside = state.binding[besideTabId];
  return !!bound && !!beside && moveNode(state.library, bound.tree, bound.node, beside.node, 'after');
}

/** The browser reported, after the fact, that `tabId` was opened from `sourceTabId`'s page. */
export function tabOpenedFrom(state, tabId, sourceTabId) {
  const { library, binding } = state;
  const bound = binding[tabId];
  const source = binding[sourceTabId];
  if (!bound || !source) return false;
  if (bound.tree !== source.tree) {
    placeNode(library, source.tree, bound.node, source.node);
    removeNode(library, bound.tree, bound.node);
    bound.tree = source.tree;
  }
  return moveNode(library, source.tree, bound.node, source.node, 'inside');
}

/** A tab's page changed: its node follows it. (A pinned node remembers its home.) */
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
  const loose = isBlank(node.url) && (bound.loose || parentOf(library.trees[bound.tree], node.id) === ROOT);
  const asleep = loose && sleeperAt(state, url);
  if (asleep && dropIfEmpty(library, node.id)) {
    placeNode(library, bound.tree, asleep.id);
    binding[tab.id] = { node: asleep.id, tree: bound.tree };
    return tabChanged(state, tab);
  }
  if (isOurs(url) && dropIfEmpty(library, node.id)) {
    delete binding[tab.id];
    return;
  }
  node.url = url || node.url;
  node.title = tab.title ?? node.title;
}

/**
 * A tab closed: its node falls asleep. A pinned node goes back home; an
 * empty new tab leaves nothing behind.
 */
export function tabClosed(state, tabId, at) {
  const { library, binding } = state;
  const id = binding[tabId]?.node;
  delete binding[tabId];
  const node = library.nodes[id];
  touch(node, at);
  if (node?.home) Object.assign(node, node.home);
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
  for (const tabId in binding) {
    const bound = binding[tabId];
    if (!open.has(tabId)) tabClosed(state, tabId, at);
    else if (!library.nodes[bound.node]) delete binding[tabId];
    else bound.tree = treeFor(library, bound.node, bound.tree);
  }
  // Empty tabs the browser closed without telling us (it quit, or crashed).
  const live = liveIds(state);
  for (const id in library.nodes) if (!live.has(id)) dropIfEmpty(library, id);
  for (const tab of tabs) {
    tabOpened(state, tab, undefined, treeOf(tab), at);
    tabChanged(state, tab);
  }
}
