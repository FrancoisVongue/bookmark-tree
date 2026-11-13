// The one owner of the state. It hears what happens to tabs (facts), takes
// commands from the panels, saves the result and tells the panels it changed.
// It only ever asks the browser for three things: open, focus or close a tab.

import { addNode, descendantsOf, expire, isGroup, isNote, migrate, moveNode, newId, problems, stamped, treeFor, validTree } from './model.js';
import { QUIET, ops } from './ops.js';
import { EMPTY, apply, diff, merge } from './merge.js';
import * as github from './github.js';
import * as channel from './channel.js';
import * as core from './core.js';
import { attend, placesOf } from './journal.js';

const log = (...args) => console.log('[tree]', ...args);

let state = core.createState();
// Nothing is saved before the library has been read: an empty one must never replace the user's.
let loaded = false;
// What the user must be told: the library could not be read, or could not be saved.
let trouble;
// The user's changes that can be taken back, newest last: the library before and after each ({ before, after }, JSON).
let undo = [];
let redo = [];
const UNDO_STEPS = 50;
const UNDO_BYTES = 4_000_000;
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
      // Not saved is told to the user (see `trouble`); the answer still goes back.
      await commit(name).catch((error) => console.error('[tree] not saved after', name, error));
      return result;
    })
    .catch((error) => console.error('[tree]', name, error));
  queue = run;
  return run;
}

let saved = { library: '', session: '' };
async function commit(name) {
  const library = JSON.stringify(state.library);
  const { binding, windows, attention, journal } = state;
  const session = JSON.stringify({ binding, windows, attention, journal, undo, redo });
  if (!loaded || (library === saved.library && session === saved.session)) return;
  if (library !== saved.library && problems(state.library).length) {
    // Whatever did this, a damaged library is never saved: back to the one that was.
    log('NOT saved after', name, '- the library would be damaged:', problems(state.library)[0]);
    if (saved.library) state.library = JSON.parse(saved.library);
    return reconcile();
  }
  try {
    if (library !== saved.library) await chrome.storage.local.set({ library: state.library });
    if (session !== saved.session) await chrome.storage.session.set({ session: JSON.parse(session) });
    trouble = undefined;
  } catch (error) {
    trouble = `The last change could not be saved: ${error.message}`;
    throw error;
  }
  saved = { library, session };
  log('saved after', name, `(${Object.keys(state.library.nodes).length} nodes, ${Object.keys(state.binding).length} live)`);
  chrome.runtime.sendMessage({ type: 'changed' }).catch(() => {}); // No panel open.
}

const allTabs = () => chrome.tabs.query({});
const reconcile = async () => core.reconcile(state, await allTabs(), (tab) => windowTree(tab.windowId), Date.now());

async function init() {
  const { library, backups } = await chrome.storage.local.get(['library', 'backups']).catch((error) => {
    trouble = `The saved library could not be read (${error.message}). Nothing is changed until it can.`;
    throw error;
  });
  if (!library && backups?.length) {
    // There was a library here before: this is not a first start.
    trouble = 'The saved library is missing. Nothing is changed until you restore a backup.';
    throw new Error(trouble);
  }
  const { session } = await chrome.storage.session.get('session');
  const found = library ? problems(migrate(library)) : [];
  if (found.length) {
    trouble = `The saved library is damaged (${found[0]}). Nothing is changed until you restore a backup.`;
    throw new Error(trouble);
  }
  if (library) state.library = library;
  loaded = true;
  if (session) ({ binding: state.binding, windows: state.windows, attention: state.attention, journal: state.journal = [], undo, redo } = session);
  saved.library = JSON.stringify(state.library);
  log('init:', library ? 'library loaded' : 'new library', '|', session ? 'same session' : 'new session');
  expire(state.library, Date.now());
  await reconcile();
  await backUp();
  unsynced = (await loadChannel()).unsynced ?? unsynced;
}

// --- Facts from the browser ----------------------------------------------------

// The tab each window shows. A new tab the user opens goes right below its
// node, if that node is in the tree the window's panel shows (see core.js).
const shown = new Map();
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => shown.set(windowId, tabId));

// Where the user looks: the tab in front, in the window in front (see journal.js).
chrome.tabs.onActivated.addListener(({ tabId }) => enqueue('attention', () => attend(state, tabId, Date.now())));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // Another program is in front: the user will be back.
  enqueue('attention', async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    attend(state, tab?.id, Date.now());
  });
});

chrome.tabs.onCreated.addListener((created) => {
  // Right now, before the new tab itself becomes the one shown.
  const beside = created.openerTabId ?? shown.get(created.windowId);
  return enqueue('tab created', async () => {
    // Read it again: the address is often not set yet when the event fires,
    // and the round trip gives the "opened from" report time to arrive.
    const tab = (await chrome.tabs.get(created.id).catch(() => null)) ?? created;
    // A tab that comes from another tab with a page already in it was opened by that page, whichever
    // way the browser tells it: a link (reported apart), or its menu ("search for the selected text").
    // One that comes empty is a new tab the user asked for.
    const arrived = !core.isBlank(tab.pendingUrl || tab.url);
    const source = openedFrom.get(tab.id) ?? (arrived ? created.openerTabId : undefined);
    openedFrom.delete(tab.id);
    const result = core.tabOpened(state, tab, source, windowTree(tab.windowId), Date.now());
    // Its node was made just now: here or, if this event woke the worker, a moment ago,
    // when the worker lined itself up with the open tabs and put it at the end of the tree.
    const late = result === 'known' && state.binding[tab.id].loose;
    if (late && source !== undefined) core.tabOpenedFrom(state, tab.id, source);
    else if (result === 'new' || late) {
      fresh.add(tab.id);
      // Below the page the user was on. (A worker just woken does not know which tab was shown: where the user's attention was says it.)
      core.tabOpenedBeside(state, tab.id, (beside !== tab.id && state.binding[beside]?.node) || state.attention?.node);
    }
    log('tab', tab.id, 'created ->', result, source === undefined ? `(beside tab ${beside})` : `(from tab ${source})`, tab.pendingUrl || tab.url);
  });
});

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
    core.tabClosed(state, tabId, Date.now());
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

/** Keeps a step of undo: one of the user's changes, from the library as it was (`before`, JSON) to as it is. */
function remember(before) {
  undo.push({ before, after: JSON.stringify(state.library) });
  redo = [];
  const size = () => undo.reduce((sum, step) => sum + step.before.length + step.after.length, 0);
  while (undo.length > UNDO_STEPS || size() > UNDO_BYTES) undo.shift();
}

/** Applies one of the user's changes, remembering it. */
async function change(name, args) {
  if (!ops[name]) return log('unknown op', name);
  const before = JSON.stringify(state.library);
  let effect;
  try {
    effect = ops[name](state.library, args, Date.now()) ?? {};
    const found = problems(state.library);
    if (found.length) throw new Error(found[0]);
  } catch (error) {
    // Whatever went wrong, the library stays as it was.
    state.library = JSON.parse(before);
    return log('op', name, 'was not made, it would have damaged the library:', error.message);
  }
  if (!QUIET.has(name) && JSON.stringify(state.library) !== before) remember(before);
  // What the operation asks of the browser (see ops.js).
  if (effect.keepTabs) await reconcile();
  else await settle();
  const tabId = core.tabOf(state, effect.navigate);
  if (tabId !== undefined) await chrome.tabs.update(tabId, { url: state.library.nodes[effect.navigate].url });
}

/**
 * Takes back the last of the user's changes (or, `forward`, makes it again):
 * that change only, on top of everything that has happened since - pages
 * opened, notes written. Open tabs stay open.
 */
async function stepBack(forward = false) {
  const [from, to] = forward ? [redo, undo] : [undo, redo];
  const step = from.pop();
  if (!step) return;
  const [was, will] = forward ? [step.before, step.after] : [step.after, step.before];
  const next = apply(structuredClone(state.library), diff(JSON.parse(was), JSON.parse(will)), Date.now());
  if (problems(next).length) return log('that step can no longer be taken:', problems(next)[0]);
  to.push(step);
  state.library = next;
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

/**
 * Replaces the library; open tabs find their nodes anew. A damaged one is
 * refused. When the user asked for it (`asked`), it is a step they can undo;
 * what comes in by itself from other computers is not.
 */
async function adopt(library, asked = false) {
  const found = problems(library);
  if (found.length) throw new Error(`That library is damaged: ${found[0]}`);
  loaded = true;
  const before = JSON.stringify(state.library);
  state.library = library;
  if (asked) remember(before);
  await reconcile();
}

/**
 * Brings this library and the saved one together: takes theirs, makes my
 * changes again on top (see merge.js), saves the result as the next version.
 * If someone saves in between, it starts over.
 */
async function sync() {
  const settings = await loadSync();
  if (!loaded || !settings?.repo || !settings.token) return;
  try {
    for (let attempt = 1; ; attempt++) {
      const remote = await github.pull(settings);
      const news = remote && remote.version !== settings.version;
      if (news) {
        const base = settings.base ? JSON.parse(settings.base) : EMPTY;
        const merged = merge(base, state.library, migrate(remote.library), Date.now());
        if (JSON.stringify(merged) !== JSON.stringify(state.library)) await adopt(merged);
      }
      const mine = JSON.stringify(core.shared(state.library));
      const saved = remote && mine === (news ? JSON.stringify(remote.library) : settings.base);
      let version = remote?.version;
      try {
        if (!saved) version = await github.push(settings, JSON.parse(mine), version, `Tree: ${new Date().toISOString()}`);
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

// --- Backups on this computer --------------------------------------------------
// Every hour the library is put aside under `backup.last`; the first time in
// a day, under `backup.<day>` too, where it stays: so each of the last few
// days has the library as that day found it, and a mistake made today cannot
// reach them. They guard against our own mistakes, with no setup at all.

const BACKUPS_KEPT = 7;
async function backUp() {
  const day = new Date().toISOString().slice(0, 10);
  const { backups = [] } = await chrome.storage.local.get('backups');
  if (!loaded) return;
  const kept = [...new Set([...backups, day])].slice(-BACKUPS_KEPT);
  const copy = JSON.stringify(core.shared(state.library));
  await chrome.storage.local.set({ 'backup.last': copy, backedUpAt: Date.now(), backups: kept, ...(backups.includes(day) ? {} : { [`backup.${day}`]: copy }) });
  await chrome.storage.local.remove(backups.filter((old) => !kept.includes(old)).map((old) => `backup.${old}`));
  log('backed up as', day);
}

// The quick way between the user's computers (see channel.js), through the
// storage the browser keeps in sync. What this computer knows of it is in
// local storage under `channel`.

const cells = {
  get: () => chrome.storage.sync.get(null),
  set: (items) => chrome.storage.sync.set(items),
  remove: (names) => chrome.storage.sync.remove(names),
};
const loadChannel = async () => (await chrome.storage.local.get('channel')).channel ?? channel.newState(newId());
// How many pages do not fit in the synced storage: those this computer keeps to itself, and another one does.
let unsynced = { here: 0, elsewhere: 0 };
// The library as it was when last told to the others (JSON): telling the same again is skipped.
let told;

/** Takes in what the other computers changed, and tells them what changed here. */
async function exchange() {
  if (!loaded) return; // A library that could not be read must not be told to anyone, nor replaced behind the user's back.
  const ch = { gone: [], ...(await loadChannel()) }; // (`gone`: the state an older version kept had none.)
  try {
    const next = structuredClone(state.library);
    if (await channel.receive(cells, ch, next, Date.now())) {
      await adopt(next);
      await commit('exchange'); // Saved before the snapshot counts as taken in: else a crash here would skip it for good.
      log('took in changes from another computer');
    }
    core.keepFresh(state, Date.now());
    const mine = core.shared(state.library);
    if (JSON.stringify(mine) !== told) unsynced.here = await channel.publish(cells, ch, mine);
    told = JSON.stringify(mine);
    unsynced.elsewhere = await channel.awayElsewhere(cells, ch);
    await chrome.storage.local.set({ channel: { ...ch, unsynced } });
  } catch (error) {
    log('exchange failed', error.message); // Tried again in a minute, from what was known before.
  }
}

/** Opens an empty tab as a new node: top-level, or a child / next sibling of `nodeId`. */
async function newTab({ windowId, treeId, nodeId, as }) {
  treeId = validTree(state.library, treeId);
  const tab = await chrome.tabs.create({ windowId });
  const node = addNode(state.library, treeId, stamped({ id: newId(), url: '', title: '' }, Date.now()));
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
        windows: state.windows,
        audible: audible.map((tab) => state.binding[tab.id]?.node).filter(Boolean),
        trouble,
        unsynced,
        journal: placesOf(state),
        canUndo: undo.length > 0,
        canRedo: redo.length > 0,
      };
    }
    case 'op':
      return change(message.op, message.args);
    case 'undo':
      return stepBack();
    case 'redo':
      return stepBack(true);
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
      core.tabOpened(state, tab, from.id, undefined, Date.now());
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
    case 'exchange':
      return exchange();
    case 'sync-now':
      // Everything at once: the quick exchange, then the full sync.
      await exchange();
      return sync();
    case 'sync-history': {
      // The versions one can go back to: those saved on GitHub, then this computer's daily backups.
      const settings = await loadSync();
      const remote = settings?.repo ? await github.history(settings).catch((error) => (log('history failed', error.message), [])) : [];
      const { backups = [], backedUpAt } = await chrome.storage.local.get(['backups', 'backedUpAt']);
      const last = backedUpAt ? [{ ref: 'local:last', at: backedUpAt, local: true }] : [];
      return [...remote, ...last, ...backups.toReversed().map((day) => ({ ref: `local:${day}`, at: day, local: true }))];
    }
    case 'sync-restore': {
      // Goes back to a saved version. The next sync saves it as the newest.
      const key = `backup.${message.ref.slice('local:'.length)}`;
      const old = message.ref.startsWith('local:')
        ? JSON.parse((await chrome.storage.local.get(key))[key])
        : (await github.pull(await loadSync(), message.ref))?.library;
      if (old) await adopt(migrate(old), true);
      return;
    }
    case 'restore-file':
      // A whole library from a backup file. Says what is wrong with it, if anything.
      return adopt(migrate(message.library), true).catch((error) => error.message);
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
  if (!tab) return;
  enqueue(command, () => {
    if (command === 'journal-back') {
      // Back to where the user was before this.
      const [last] = placesOf(state);
      return last && activate({ nodeId: last.node, treeId: last.tree, windowId: tab.windowId });
    }
    const bound = state.binding[tab.id];
    return newTab({
      windowId: tab.windowId,
      treeId: bound?.tree ?? windowTree(tab.windowId),
      nodeId: bound?.node,
      as: command === 'new-child' ? 'child' : 'sibling',
    });
  });
});

// Once a day the library is synced in full by itself (and whenever the user
// asks); once a minute, and whenever another computer writes something, the
// quick exchange runs.
const TIMERS = { sync: [SYNC_EVERY_MINUTES, sync], exchange: [1, exchange], backup: [60, backUp] };
chrome.alarms.onAlarm.addListener((alarm) => TIMERS[alarm.name] && enqueue(alarm.name, TIMERS[alarm.name][1]));
for (const [name, [minutes]] of Object.entries(TIMERS)) {
  chrome.alarms.get(name).then((alarm) => alarm || chrome.alarms.create(name, { periodInMinutes: minutes }));
}
chrome.storage.onChanged.addListener((changes, area) => area === 'sync' && enqueue('exchange', exchange));

// Clicking the toolbar button shows or hides the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

enqueue('init', init);
