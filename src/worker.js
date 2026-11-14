// The one owner of the state. It hears what happens to tabs (facts), takes
// commands from the panels, saves the result and tells the panels it changed.
// What it asks of the browser in return is six things, all in `browser`
// below: open a tab, show one, close some, send one to an address, give one
// a window of its own, silence one. It never reorders tabs.

import { descendantsOf, expire, goneOf, isGroup, isNote, migrate, newId, problems, treeFor, validTree } from './model.js';
import { QUIET, ops } from './ops.js';
import { apply, diff, takeIn } from './merge.js';
import * as github from './github.js';
import * as channel from './channel.js';
import * as core from './core.js';
import { DWELL, attend, placesOf, visited } from './journal.js';
import { warningOf } from './safety.js';

const log = (...args) => console.log('[tree]', ...args);

// Everything the worker asks the browser to do to tabs. (Asking what tabs there are is not doing.)
const browser = {
  /** A new tab: `{ windowId, url?, active?, index? }`; without an address, an empty one. */
  open: (tab) => chrome.tabs.create(tab),
  /** Brings a tab to the front; its window too, if that is not `windowId`. */
  async show(tabId, windowId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== windowId) await chrome.windows.update(tab.windowId, { focused: true });
  },
  close: (tabIds) => chrome.tabs.remove(tabIds),
  navigate: (tabId, url) => chrome.tabs.update(tabId, { url }),
  /** Gives a tab a window of its own. */
  detach: (tabId) => chrome.windows.create({ tabId }),
  /** Silences a tab, or lets it sound again. */
  mute: (tabId, muted) => chrome.tabs.update(tabId, { muted }),
};

let state = core.createState();
// Nothing is saved before the library has been read: an empty one must never replace the user's.
let loaded = false;
// What the user must be told: the library could not be read, or could not be saved.
let trouble;
// The user's changes that can be taken back, newest last. Each is kept as what it changed, both ways
// ({ back, forth }: see diff in merge.js) - not as the libraries before and after it, which are mostly the same.
let undo = [];
let redo = [];
const UNDO_STEPS = 50;
const UNDO_BYTES = 4_000_000;
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
      visited(state, Date.now()); // Whatever this did: where the user is, once that counts, is not in the plan (see journal.js).
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
  if (session) ({ binding: state.binding, windows: state.windows, attention: state.attention, journal: state.journal, undo, redo } = session);
  saved.library = JSON.stringify(state.library);
  log('init:', library ? 'library loaded' : 'new library', '|', session ? 'same session' : 'new session');
  expire(state.library, Date.now());
  await reconcile();
  await backUp();
  const ch = await loadChannel();
  [unsynced, met] = [ch.unsynced ?? unsynced, !!ch.met];
}

// --- Facts from the browser ----------------------------------------------------

// The tab each window shows. A new tab the user opens goes right below its
// node, if that node is in the tree the window's panel shows (see core.js).
const shown = new Map();
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => shown.set(windowId, tabId));

// Where the user looks: the tab in front, in the window in front (see journal.js).
// A moment later, if they are still there, it counts: something is to run then, for `enqueue` to see it.
const look = (tabId) =>
  enqueue('attention', async () => {
    attend(state, await tabId(), Date.now());
    setTimeout(() => enqueue('visited', () => {}), DWELL + 50);
  });
chrome.tabs.onActivated.addListener(({ tabId }) => look(() => tabId));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // Another program is in front: the user will be back.
  look(async () => (await chrome.tabs.query({ active: true, windowId }))[0]?.id);
});

chrome.tabs.onCreated.addListener((created) => {
  // Right now, before the new tab itself becomes the one shown.
  const beside = created.openerTabId ?? shown.get(created.windowId);
  return enqueue('tab created', async () => {
    // Read it again: the address is often not set yet when the event fires,
    // and the round trip gives the "opened from" report time to arrive.
    const tab = (await chrome.tabs.get(created.id).catch(() => null)) ?? created;
    const reported = openedFrom.get(tab.id);
    openedFrom.delete(tab.id);
    // The page the user was on. (A worker just woken does not know which tab was shown: where the user's attention was says it.)
    const shownNode = (beside !== tab.id && state.binding[beside]?.node) || state.attention?.node;
    const born = created.pendingUrl || created.url;
    const result = core.tabCreated(state, tab, { born, opener: created.openerTabId, reported, shownNode, treeId: windowTree(tab.windowId), at: Date.now() });
    log('tab', tab.id, 'created ->', result, `(born ${born || 'with no address'}, opener ${created.openerTabId}, reported ${reported}, beside tab ${beside})`, tab.pendingUrl || tab.url);
  });
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(({ tabId, sourceTabId }) => {
  openedFrom.set(tabId, sourceTabId);
  enqueue('tab opened from page', () => {
    if (state.binding[tabId] === undefined) return; // Not created yet: that handler uses the entry.
    openedFrom.delete(tabId);
    log('tab', tabId, 'was opened from tab', sourceTabId, '-> child:', core.tabOpenedFrom(state, tabId, sourceTabId));
  });
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Sound is not part of the state: the panels just look again.
  if (change.audible !== undefined || change.mutedInfo !== undefined) chrome.runtime.sendMessage({ type: 'changed' }).catch(() => {});
  if (change.url === undefined && change.title === undefined) return;
  enqueue('tab updated', () => core.tabChanged(state, tab));
});

chrome.tabs.onRemoved.addListener((tabId) =>
  enqueue('tab closed', () => {
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
      await browser.open({ windowId });
    }
  }
  await browser.close(ids).catch((error) => log('close failed', error.message));
}

/** After a change to the library: tabs of nodes that are gone close; the rest stay in a tree that holds them. */
const settle = () => closeTabs(core.rebind(state));

/** Keeps a step of undo: one of the user's changes, from the library as it was (`before`, JSON) to as it is. */
function remember(before) {
  const [was, now] = [JSON.parse(before), structuredClone(state.library)];
  undo.push({ back: diff(now, was), forth: diff(was, now) });
  redo = [];
  while (undo.length > UNDO_STEPS || JSON.stringify(undo).length > UNDO_BYTES) undo.shift();
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
  if (tabId !== undefined) await browser.navigate(tabId, state.library.nodes[effect.navigate].url);
}

/**
 * Takes the last of the user's changes `back`, or makes the last one taken
 * back again (`forth`): that change only, on top of everything that has
 * happened since - pages opened, notes written. Open tabs stay open.
 */
async function retrace(way) {
  const [from, to] = way === 'back' ? [undo, redo] : [redo, undo];
  const step = from.pop();
  if (!step) return;
  const next = apply(structuredClone(state.library), step[way], Date.now());
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
    const tab = await browser.open({ windowId, url: core.isBlank(url) ? undefined : url, active: !where });
    tabId = tab.id;
    // Before its "created" event is handled, so no second node appears.
    core.bind(state, tabId, nodeId, tree);
    log('woke node', nodeId, 'as tab', tabId);
  } else if (!where) {
    await browser.show(tabId, windowId);
    core.shownIn(state, tabId, tree);
  }
  if (where === 'window') await browser.detach(tabId);
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
 * Brings this library and the saved one together: takes in what changed
 * there since the last time (see takeIn in merge.js), saves the result as
 * the next version. If someone saves in between, it starts over.
 *
 * It waits for the network outside the queue - tabs go on being heard and
 * the panels answered meanwhile - and queues only what touches the state:
 * taking theirs in, and noting what was saved. One sync runs at a time.
 */
let syncing;
const sync = () => (syncing ??= syncOnce().finally(() => (syncing = undefined)));

async function syncOnce() {
  const settings = await loadSync();
  if (!loaded || !settings?.repo || !settings.token) return;
  try {
    for (let attempt = 1; ; attempt++) {
      const remote = await github.pull(settings);
      const news = remote && remote.version !== settings.version;
      const mine = await enqueue('sync: take in', async () => {
        if (news) {
          const base = settings.base && JSON.parse(settings.base);
          const theirs = migrate(remote.library);
          const told = goneOf(theirs).filter((id) => !(id in (base?.gone ?? {})));
          const next = takeIn(structuredClone(state.library), base, theirs, told, Date.now());
          if (JSON.stringify(next) !== JSON.stringify(state.library)) await adopt(next);
        }
        return JSON.stringify(core.shared(state.library));
      });
      if (mine === undefined) throw new Error('What was saved there could not be taken in.');
      const same = remote && mine === (news ? JSON.stringify(remote.library) : settings.base);
      let version = remote?.version;
      try {
        if (!same) version = await github.push(settings, JSON.parse(mine), version, `Tree: ${new Date().toISOString()}`);
      } catch (error) {
        if (error instanceof github.Conflict && attempt < 3) continue;
        throw error;
      }
      log('synced', same ? '(nothing to save)' : '(saved a version)', news ? '(took theirs in)' : '');
      return await noteSync(settings, { version, base: mine, at: Date.now(), error: undefined });
    }
  } catch (error) {
    log('sync failed', error.message);
    await noteSync(settings, { error: error.message });
  }
}

/** Writes down how a sync went - unless the user pointed the sync elsewhere meanwhile: then it tells nothing about the new place. */
const noteSync = (settings, outcome) =>
  enqueue('sync: note', async () => {
    const now = await loadSync();
    if (now?.repo === settings.repo && now.api === settings.api) await saveSync({ ...now, ...outcome });
  });

/** The versions one can go back to: those saved on GitHub, then this computer's backups. */
async function versions() {
  const settings = await loadSync();
  const remote = settings?.repo ? await github.history(settings).catch((error) => (log('history failed', error.message), [])) : [];
  const { backups = [], backedUpAt } = await chrome.storage.local.get(['backups', 'backedUpAt']);
  const last = backedUpAt ? [{ ref: 'local:last', at: backedUpAt, local: true }] : [];
  return [...remote, ...last, ...backups.toReversed().map((day) => ({ ref: `local:${day}`, at: day, local: true }))];
}

/** Goes back to a saved version. The next sync saves it as the newest. */
async function goBackTo(ref) {
  const key = `backup.${ref.slice('local:'.length)}`;
  const old = ref.startsWith('local:') ? JSON.parse((await chrome.storage.local.get(key))[key]) : (await github.pull(await loadSync(), ref))?.library;
  if (old) await enqueue('sync-restore', () => adopt(migrate(old), true));
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
const loadChannel = async () => {
  const kept = (await chrome.storage.local.get('channel')).channel;
  return kept ? channel.migrate(kept) : channel.newState(newId());
};
// How many pages do not fit in the synced storage: those this computer keeps to itself, and another one does.
let unsynced = { here: 0, elsewhere: 0 };
// Whether another computer has ever been seen in the synced storage: if not, nothing but this one holds the library there.
let met = false;
// The library as it was when last told to the others (JSON): telling the same again is skipped.
let published;

/** Takes in what the other computers changed, and tells them what changed here. */
async function exchange() {
  if (!loaded) return; // A library that could not be read must not be told to anyone, nor replaced behind the user's back.
  const ch = await loadChannel();
  try {
    const next = structuredClone(state.library);
    if (await channel.receive(cells, ch, next, Date.now())) {
      await adopt(next);
      await commit('exchange'); // Saved before the snapshot counts as taken in: else a crash here would skip it for good.
      log('took in changes from another computer');
    }
    core.keepFresh(state, Date.now());
    const mine = core.shared(state.library);
    if (JSON.stringify(mine) !== published) unsynced.here = await channel.publish(cells, ch, mine);
    published = JSON.stringify(mine);
    unsynced.elsewhere = await channel.awayElsewhere(cells, ch);
    met = !!ch.met;
    await chrome.storage.local.set({ channel: { ...ch, unsynced } });
  } catch (error) {
    log('exchange failed', error.message); // Tried again in a minute, from what was known before.
  }
}

/** Opens an empty tab as a new node: top-level, or a child / next sibling of `nodeId`. */
async function newTab({ windowId, treeId, nodeId, as }) {
  treeId = validTree(state.library, treeId);
  const tab = await browser.open({ windowId });
  core.tabAsked(state, tab, { treeId, nodeId, as, at: Date.now() });
}

async function handle(message, sender) {
  const { library } = state;
  switch (message.type) {
    case 'get-state': {
      // The browser's two facts about a tab's sound: it makes some; the user has silenced it.
      const [audible, muted] = await Promise.all([chrome.tabs.query({ audible: true }), chrome.tabs.query({ muted: true })]);
      const nodesOf = (tabs) => tabs.map((tab) => state.binding[tab.id]?.node).filter(Boolean);
      const { sync, savedToFileAt, warningClosedAt } = await chrome.storage.local.get(['sync', 'savedToFileAt', 'warningClosedAt']);
      const safety = { nodes: Object.keys(library.nodes).length, sync, unsynced: unsynced.here, met, savedAt: savedToFileAt, closedAt: warningClosedAt, now: Date.now() };
      return {
        library,
        binding: state.binding,
        windows: state.windows,
        audible: nodesOf(audible),
        muted: nodesOf(muted),
        trouble,
        unsynced,
        warning: loaded ? warningOf(safety) : undefined, // That the library is kept nowhere else (see safety.js).
        journal: placesOf(state),
        canUndo: undo.length > 0,
        canRedo: redo.length > 0,
      };
    }
    case 'op':
      return change(message.op, message.args);
    case 'undo':
      return retrace('back');
    case 'redo':
      return retrace('forth');
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
    case 'mute': {
      const tabId = core.tabOf(state, message.nodeId);
      return tabId === undefined ? undefined : browser.mute(tabId, message.muted);
    }
    case 'go-home':
      // A page returns to the address it first had (see `home` in model.js).
      return change('home', { id: message.nodeId });
    case 'open-link': {
      // A link clicked in a note: a new tab, and a child of the note.
      const from = sender.tab;
      const tab = await browser.open({ url: message.url, windowId: from.windowId, index: from.index + 1 });
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
    case 'restore-file':
      // A whole library from a backup file. Says what is wrong with it, if anything.
      return adopt(migrate(message.library), true).catch((error) => error.message);
    case 'saved-to-file':
      // A page saved the whole library to a file: that is a copy elsewhere.
      return chrome.storage.local.set({ savedToFileAt: Date.now() });
    case 'warning-closed':
      // The user put the warning off. It comes back (see safety.js).
      return chrome.storage.local.set({ warningClosedAt: Date.now() });
    case 'show-tree':
      // The tree this window's panel shows: where its new tabs go.
      state.windows[message.windowId] = message.treeId;
  }
}

// Commands that wait for GitHub do so outside the queue, and queue only what they then do to the state.
const unqueued = {
  // Everything at once: the quick exchange, then the full sync.
  'sync-now': () => enqueue('exchange', exchange).then(sync),
  'sync-history': versions,
  'sync-restore': ({ ref }) => goBackTo(ref),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'changed') return;
  if (message.type !== 'get-state') log('command', message);
  const done = unqueued[message.type]
    ? unqueued[message.type](message).catch((error) => console.error('[tree]', message.type, error))
    : enqueue(message.op ?? message.type, () => handle(message, sender));
  done.then(sendResponse);
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
const TIMERS = { sync: [SYNC_EVERY_MINUTES, sync], exchange: [1, () => enqueue('exchange', exchange)], backup: [60, () => enqueue('backup', backUp)] };
chrome.alarms.onAlarm.addListener((alarm) => TIMERS[alarm.name]?.[1]());
for (const [name, [minutes]] of Object.entries(TIMERS)) {
  chrome.alarms.get(name).then((alarm) => alarm || chrome.alarms.create(name, { periodInMinutes: minutes }));
}
chrome.storage.onChanged.addListener((changes, area) => area === 'sync' && enqueue('exchange', exchange));

// Clicking the toolbar button shows or hides the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

enqueue('init', init);
