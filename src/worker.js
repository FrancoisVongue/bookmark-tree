// The one owner of the state. It hears what happens to tabs (facts), takes
// commands from the panels, saves the result and tells the panels it changed.
// It only ever asks the browser for three things: open, focus or close a tab.

import { addNode, descendantsOf, isGroup, isNote, migrate, moveNode, newId, treeFor, validTree } from './model.js';
import { QUIET, ops } from './ops.js';
import { EMPTY, merge } from './merge.js';
import * as github from './github.js';
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
  if (library) state.library = migrate(library);
  if (session) ({ binding: state.binding, windows: state.windows, undo, redo } = session);
  log('init:', library ? 'library loaded' : 'new library', '|', session ? 'same session' : 'new session');
  const keepFrom = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
  state.library.trash = state.library.trash.filter((entry) => entry.at > keepFrom);
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
  const effect = ops[name](state.library, args, Date.now()) ?? {};
  if (!QUIET.has(name) && JSON.stringify(state.library) !== before) {
    undo.push(before);
    redo = [];
    while (undo.length > UNDO_STEPS || undo.join('').length > UNDO_BYTES) undo.shift();
  }
  // What the operation asks of the browser (see ops.js).
  if (effect.keepTabs) await reconcile();
  else await settle();
  const tabId = core.tabOf(state, effect.navigate);
  if (tabId !== undefined) await chrome.tabs.update(tabId, { url: state.library.nodes[effect.navigate].url });
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
    const url = isNote(node) ? chrome.runtime.getURL(core.notePath(nodeId)) : node.url;
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

// --- Keeping the library elsewhere ---------------------------------------------
// Settings, in local storage under `sync`:
//   { repo, token, path, api? }   where (see github.js)
//   { version, base }             the version last seen there, and the library as it was then (JSON)
//   { at, error }                 when that was; what went wrong the last time, if anything

const SYNC_EVERY_MINUTES = 24 * 60;
const loadSync = async () => (await chrome.storage.local.get('sync')).sync;
const saveSync = (settings) => chrome.storage.local.set({ sync: settings });

/** Replaces the library, keeping the way back; open tabs find their nodes anew. */
async function adopt(library) {
  undo.push(JSON.stringify(state.library));
  redo = [];
  state.library = library;
  await reconcile();
}

/**
 * Brings this library and the saved one together: takes theirs, makes my
 * changes again on top (see merge.js), saves the result as the next version.
 * If someone saves in between, it starts over.
 */
async function sync() {
  const settings = await loadSync();
  if (!settings?.repo || !settings.token) return;
  try {
    for (let attempt = 1; ; attempt++) {
      const remote = await github.pull(settings);
      const news = remote && remote.version !== settings.version;
      if (news) {
        const base = settings.base ? JSON.parse(settings.base) : EMPTY;
        const merged = merge(base, state.library, migrate(remote.library), Date.now());
        if (JSON.stringify(merged) !== JSON.stringify(state.library)) await adopt(merged);
      }
      const mine = JSON.stringify(state.library);
      const saved = remote && mine === (news ? JSON.stringify(remote.library) : settings.base);
      let version = remote?.version;
      try {
        if (!saved) version = await github.push(settings, state.library, version, `Tree: ${new Date().toISOString()}`);
      } catch (error) {
        if (error instanceof github.Conflict && attempt < 3) continue;
        throw error;
      }
      log('synced', saved ? '(nothing to save)' : '(saved a version)', news ? '(took theirs in)' : '');
      return saveSync({ ...settings, version, base: mine, at: Date.now(), error: undefined });
    }
  } catch (error) {
    log('sync failed', error.message);
    await saveSync({ ...settings, error: error.message });
  }
}

/** Opens an empty tab as a new node: top-level, or a child / next sibling of `nodeId`. */
async function newTab({ windowId, treeId, nodeId, as }) {
  treeId = validTree(state.library, treeId);
  const tab = await chrome.tabs.create({ windowId });
  const node = addNode(state.library, treeId, { id: newId(), url: '', title: '' });
  if (nodeId) moveNode(state.library, treeId, node.id, nodeId, as === 'child' ? 'inside' : 'after');
  state.binding[tab.id] = { node: node.id, tree: treeId };
}

async function handle(message, sender) {
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
        // A group is a heading: nothing to open.
        if (!isGroup(library.nodes[nodeId]) && core.tabOf(state, nodeId) === undefined) {
          await activate({ ...message, nodeId, where: 'background' });
        }
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
    case 'open-link': {
      // A link clicked in a note: a new tab, and a child of the note.
      const from = sender.tab;
      const tab = await chrome.tabs.create({ url: message.url, windowId: from.windowId, index: from.index + 1 });
      core.tabOpened(state, tab, from.id);
      return;
    }
    case 'sync-get': {
      const { token, base, ...shown } = (await loadSync()) ?? {};
      return { ...shown, hasToken: !!token };
    }
    case 'sync-set': {
      // A new place starts from nothing in common; an empty token field keeps the token.
      const old = (await loadSync()) ?? {};
      const moved = old.repo !== message.repo || old.api !== message.api;
      const settings = { ...(moved ? {} : old), repo: message.repo, api: message.api, path: 'tree.json' };
      return saveSync({ ...settings, token: message.token || old.token });
    }
    case 'sync-now':
      return sync();
    case 'sync-history':
      return github.history(await loadSync()).catch((error) => (log('history failed', error.message), []));
    case 'sync-restore': {
      // Goes back to a saved version. The next sync saves it as the newest.
      const old = await github.pull(await loadSync(), message.ref);
      if (old) await adopt(migrate(old.library));
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
  enqueue(message.op ?? message.type, () => handle(message, sender)).then(sendResponse);
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

// Once a day the library is synced by itself (and whenever the user asks).
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === 'sync' && enqueue('sync', sync));
chrome.alarms.get('sync').then((alarm) => alarm || chrome.alarms.create('sync', { periodInMinutes: SYNC_EVERY_MINUTES }));

// Clicking the toolbar button shows or hides the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

enqueue('init', init);
