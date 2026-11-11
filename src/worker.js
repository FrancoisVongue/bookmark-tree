// The one owner of the state. It hears what happens to tabs (facts), takes
// commands from the panels, saves the result and tells the panels it changed.
// It only ever asks the browser for three things: open, focus or close a tab.

import { addNode, descendantsOf, moveNode, newId, treeFor, validTree } from './model.js';
import { QUIET, ops } from './ops.js';
import * as core from './core.js';

const log = (...args) => console.log('[tree]', ...args);

let state = core.createState();
// The library as it was before each of the user's changes, newest last (JSON).
let undo = [];
let redo = [];
const UNDO_STEPS = 50;
const UNDO_BYTES = 4_000_000;
const TRASH_DAYS = 30;
// Tabs whose node was just made top-level: if the browser then reports the
// page that opened them, the node moves under it.
const fresh = new Set();
// Tab -> the tab whose page opened it. The browser reports this right around
// the tab's creation, in either order.
const openedFrom = new Map();

const windowTree = (windowId) => validTree(state.library, state.windows[windowId]);

// --- One thing at a time -------------------------------------------------------
// Every event and command runs after the one before it has finished and been
// saved, so none of them ever sees a half-made change.

let queue = Promise.resolve();
function enqueue(name, task) {
  const run = queue
    .then(task)
    .then(async (result) => {
      await commit(name);
      return result;
    })
    .catch((error) => console.error('[tree]', name, error));
  queue = run;
  return run;
}

let saved = { library: '', session: '' };
async function commit(name) {
  const library = JSON.stringify(state.library);
  const session = JSON.stringify({ binding: state.binding, windows: state.windows, undo, redo });
  if (library === saved.library && session === saved.session) return;
  if (library !== saved.library) await chrome.storage.local.set({ library: state.library });
  if (session !== saved.session) await chrome.storage.session.set({ session: JSON.parse(session) });
  saved = { library, session };
  log('saved after', name, `(${Object.keys(state.library.nodes).length} nodes, ${Object.keys(state.binding).length} live)`);
  chrome.runtime.sendMessage({ type: 'changed' }).catch(() => {}); // No panel open.
}

const allTabs = () => chrome.tabs.query({});
const reconcile = async () => core.reconcile(state, await allTabs(), (tab) => windowTree(tab.windowId));

async function init() {
  const { library } = await chrome.storage.local.get('library');
  const { session } = await chrome.storage.session.get('session');
  if (library) state.library = library;
  if (session) ({ binding: state.binding, windows: state.windows, undo, redo } = session);
  log('init:', library ? 'library loaded' : 'new library', '|', session ? 'same session' : 'new session');
  const keepFrom = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
  state.library.trash = (state.library.trash ?? []).filter((entry) => entry.at > keepFrom);
  await reconcile();
}

// --- Facts from the browser ----------------------------------------------------

chrome.tabs.onCreated.addListener((created) =>
  enqueue('tab created', async () => {
    // Read it again: the address is often not set yet when the event fires,
    // and the round trip gives the "opened from" report time to arrive.
    const tab = (await chrome.tabs.get(created.id).catch(() => null)) ?? created;
    const source = openedFrom.get(tab.id);
    openedFrom.delete(tab.id);
    const result = core.tabOpened(state, tab, source, windowTree(tab.windowId));
    if (result === 'new') fresh.add(tab.id);
    log('tab', tab.id, 'created ->', result, source === undefined ? '' : `(from tab ${source})`, tab.pendingUrl || tab.url);
  }),
);

chrome.webNavigation.onCreatedNavigationTarget.addListener(({ tabId, sourceTabId }) => {
  openedFrom.set(tabId, sourceTabId);
  enqueue('tab opened from page', () => {
    if (state.binding[tabId] === undefined) return; // Not created yet: that handler uses the entry.
    openedFrom.delete(tabId);
    if (!fresh.delete(tabId)) return;
    log('tab', tabId, 'was opened from tab', sourceTabId, '-> child:', core.tabOpenedFrom(state, tabId, sourceTabId));
  });
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Sound is not part of the state: the panels just look again.
  if (change.audible !== undefined) chrome.runtime.sendMessage({ type: 'changed' }).catch(() => {});
  if (change.url === undefined && change.title === undefined) return;
  enqueue('tab updated', () => core.tabChanged(state, tab));
});

chrome.tabs.onRemoved.addListener((tabId) =>
  enqueue('tab closed', () => {
    fresh.delete(tabId);
    openedFrom.delete(tabId);
    log('tab', tabId, 'closed, node', state.binding[tabId]?.node);
    core.tabClosed(state, tabId);
  }),
);

chrome.tabs.onReplaced.addListener((addedId, removedId) =>
  enqueue('tab replaced', () => core.tabReplaced(state, addedId, removedId)),
);

// --- Commands ------------------------------------------------------------------

/** Closes tabs. A window about to lose its last tab gets a new one first, so it stays open. */
async function closeTabs(ids) {
  if (!ids.length) return;
  const closing = new Set(ids);
  const all = await allTabs();
  const windows = new Set(all.filter((tab) => closing.has(tab.id)).map((tab) => tab.windowId));
  for (const windowId of windows) {
    if (all.filter((tab) => tab.windowId === windowId).every((tab) => closing.has(tab.id))) {
      await chrome.tabs.create({ windowId });
    }
  }
  await chrome.tabs.remove(ids).catch((error) => log('close failed', error.message));
}

/** After a change to the library: tabs of nodes that are gone close; the rest stay in a tree that holds them. */
async function settle() {
  const gone = [];
  for (const [tabId, bound] of Object.entries(state.binding)) {
    if (state.library.nodes[bound.node]) bound.tree = treeFor(state.library, bound.node, bound.tree);
    else {
      gone.push(Number(tabId));
      delete state.binding[tabId];
    }
  }
  await closeTabs(gone);
}

/** Applies one of the user's changes, remembering the library as it was. */
async function change(name, args) {
  if (!ops[name]) return log('unknown op', name);
  const before = JSON.stringify(state.library);
  ops[name](state.library, args);
  if (!QUIET.has(name) && JSON.stringify(state.library) !== before) {
    undo.push(before);
    redo = [];
    while (undo.length > UNDO_STEPS || undo.join('').length > UNDO_BYTES) undo.shift();
  }
  // A deleted tree takes its nodes along, but not the tabs: they become nodes of another tree.
  if (name === 'tree-remove') await reconcile();
  else await settle();
  if (name === 'address') {
    const tabId = core.tabOf(state, args.id);
    if (tabId !== undefined) await chrome.tabs.update(tabId, { url: state.library.nodes[args.id].url });
  }
}

/** Steps the library back (or forward again). Open tabs stay open and find their nodes anew. */
async function stepBack(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(state.library));
  state.library = JSON.parse(from.pop());
  await reconcile();
}

/**
 * Goes to a node's tab, opening one if the node is asleep. `where` is the
 * panel's window by default, 'background' (open without going there) or
 * 'window' (a window of its own).
 */
async function activate({ nodeId, treeId, windowId, where }) {
  const node = state.library.nodes[nodeId];
  if (!node) return;
  const tree = treeFor(state.library, nodeId, treeId);
  let tabId = core.tabOf(state, nodeId);
  if (tabId === undefined) {
    const url = node.note !== undefined ? chrome.runtime.getURL(`${core.NOTE_PAGE}?id=${nodeId}`) : node.url;
    const tab = await chrome.tabs.create({ windowId, url: core.isBlank(url) ? undefined : url, active: !where });
    tabId = tab.id;
    // Before its "created" event is handled, so no second node appears.
    state.binding[tabId] = { node: nodeId, tree };
    log('woke node', nodeId, 'as tab', tabId);
  } else if (!where) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== windowId) await chrome.windows.update(tab.windowId, { focused: true });
    state.binding[tabId].tree = tree;
  }
  if (where === 'window') await chrome.windows.create({ tabId });
}

/** Opens an empty tab as a new node: top-level, or a child / next sibling of `nodeId`. */
async function newTab({ windowId, treeId, nodeId, as }) {
  treeId = validTree(state.library, treeId);
  const tab = await chrome.tabs.create({ windowId });
  const node = addNode(state.library, treeId, { id: newId(), url: '', title: '' });
  if (nodeId) moveNode(state.library, treeId, node.id, nodeId, as === 'child' ? 'inside' : 'after');
  state.binding[tab.id] = { node: node.id, tree: treeId };
}

async function handle(message) {
  const { library } = state;
  switch (message.type) {
    case 'get-state': {
      const audible = await chrome.tabs.query({ audible: true });
      return {
        library,
        binding: state.binding,
        audible: audible.map((tab) => state.binding[tab.id]?.node).filter(Boolean),
        canUndo: undo.length > 0,
        canRedo: redo.length > 0,
      };
    }
    case 'op':
      return change(message.op, message.args);
    case 'undo':
      return stepBack(undo, redo);
    case 'redo':
      return stepBack(redo, undo);
    case 'activate':
      return activate(message);
    case 'new-tab':
      return newTab(message);
    case 'sleep': {
      // The nodes and everything under them: frees their memory, keeps them in the tree.
      const tree = library.trees[message.treeId];
      const ids = message.ids.flatMap((id) => [id, ...descendantsOf(tree, id)]);
      return closeTabs(ids.map((id) => core.tabOf(state, id)).filter((id) => id !== undefined));
    }
    case 'wake': {
      // The opposite: opens the sleeping ones among the nodes and everything under them.
      const tree = library.trees[message.treeId];
      const ids = message.ids.flatMap((id) => [id, ...descendantsOf(tree, id)]);
      for (const nodeId of new Set(ids)) {
        const node = library.nodes[nodeId];
        const group = node.note !== undefined && !node.note.trim(); // A heading: nothing to open.
        if (!group && core.tabOf(state, nodeId) === undefined) await activate({ ...message, nodeId, where: 'background' });
      }
      return;
    }
    case 'sleep-one': {
      const tabId = core.tabOf(state, message.nodeId);
      return closeTabs(tabId === undefined ? [] : [tabId]);
    }
    case 'go-home': {
      // A pinned node returns to its address.
      const node = library.nodes[message.nodeId];
      const tabId = core.tabOf(state, message.nodeId);
      if (!node?.home) return;
      if (tabId === undefined) Object.assign(node, node.home);
      else await chrome.tabs.update(tabId, { url: node.home.url });
      return;
    }
    case 'show-tree':
      // The tree this window's panel shows: where its new tabs go.
      state.windows[message.windowId] = message.treeId;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'changed') return;
  if (message.type !== 'get-state') log('command', message);
  enqueue(message.op ?? message.type, () => handle(message)).then(sendResponse);
  return true;
});

// Keyboard shortcuts that work while a page has the focus.
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab || !['new-child', 'new-sibling'].includes(command)) return;
  enqueue(command, () => {
    const bound = state.binding[tab.id];
    return newTab({
      windowId: tab.windowId,
      treeId: bound?.tree ?? windowTree(tab.windowId),
      nodeId: bound?.node,
      as: command === 'new-child' ? 'child' : 'sibling',
    });
  });
});

// Clicking the toolbar button shows or hides the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

enqueue('init', init);
