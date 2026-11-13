// What is on the screen, and the way to the worker. The panel never changes
// the library itself; it owns only this: which trees are shown, what is
// selected, searched for, dragged, or open on top.

import { descendantsOf, migrate, parentOf, rowsOf } from '../model.js';
import { draw, titleOf } from './view.js';

export const log = (...args) => console.log('[tree panel]', ...args);
export const app = document.getElementById('app');

const kept = JSON.parse(localStorage.getItem('view') ?? '{}');
export const newPane = (tree, size = 1) => ({ tree, size, rows: [], sel: new Set() });

export const ui = {
  windowId: undefined,
  library: undefined,
  live: new Set(), // Ids of nodes that have a tab.
  audible: new Set(), // Ids of nodes whose tab is making sound.
  shared: new Map(), // Node id -> names of the other trees it is in.
  activeId: undefined, // The node of this window's current tab,
  activeTree: undefined, // and the tree that tab is in.
  trouble: undefined, // What the worker could not do: read the library, or save it.
  journal: [], // Where the user was before this, newest first: [{ node, tree, at }] (see journal.js).
  journalOpen: localStorage.getItem('journalOpen') === 'yes', // The whole list, or only its first line.
  // Pages that do not fit in the synced storage: { kind: 'here' | 'elsewhere', count }, unless the user closed that notice.
  unsynced: undefined,
  canUndo: false,
  canRedo: false,
  panes: (kept.panes ?? []).map((pane) => newPane(pane.tree, pane.size)), // The trees shown: { tree, size, rows, sel }.
  focus: 0, // The pane the user works in.
  split: kept.split ?? 'column', // Panes one under another, or 'row': side by side.
  query: '', // What is searched for.
  cursor: undefined, // The row the keyboard is on, in the focused pane.
  renaming: undefined, // { id, pane, field? } or { tree }.
  drag: undefined, // { kind: 'rows', ids, from, label }, { kind: 'tree', tree, label } or { kind: 'link' } while something is dragged.
  drop: undefined, // Where it would land: { pane, targetId, position } in a pane, { cell, tree } in the table of trees.
  menu: undefined, // { x, y, items, opener }: `opener` is the button it hangs from, if any.
  // The one thing open on top of the panel, if any:
  //   { kind: 'picker', into, tree, rows, sel }  a pane to choose nodes of another tree
  //   { kind: 'icons', ids } or { ..., tree }    the table of icons, for nodes or for a tree
  //   { kind: 'ask', question, yes, run }        a question before something is lost
  overlay: undefined,
  toast: undefined, // What was just done, with a way back.
};

// Commands on their way to the worker, and whether one has just come back:
// what changes meanwhile was asked for here, in the panel. (`asked` is also
// set when the current tab is closed: the tab the browser then moves to is
// not one the user chose.)
let asking = 0;
let asked = false;
let activeTab; // The id of this window's current tab.
chrome.tabs.onRemoved.addListener((tabId) => (asked ||= tabId === activeTab));
const QUIET = ['get-state', 'show-tree']; // Asking what there is, and telling what is shown, change nothing.

export async function send(message) {
  if (QUIET.includes(message.type)) return chrome.runtime.sendMessage(message).catch((error) => log('failed', message.type, error.message));
  log('command', message);
  asking++;
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    log('command failed', message.type, error.message);
  } finally {
    asking--;
    asked = true;
    refresh();
  }
}
export const op = (name, args) => send({ type: 'op', op: name, args });

export const redraw = () => draw(app, ui);
export const here = () => ui.panes[ui.focus];
export const picker = () => (ui.overlay?.kind === 'picker' ? ui.overlay : undefined);
export const idAt = (el) => el.closest?.('.row')?.dataset.id;
export const paneAt = (el) => {
  const index = el.closest?.('.pane')?.dataset.pane;
  return index === 'picker' ? picker() : ui.panes[index];
};
export const rowEl = (pane, id) => app.querySelector(`.pane[data-pane="${ui.panes.indexOf(pane)}"] .row[data-id="${id}"]`);
export const rowOf = (pane, id) => pane.rows.find((row) => row.id === id);
export const under = (pane, id) => descendantsOf(ui.library.trees[pane.tree], id);
/** What an action on row `id` applies to: the whole selection if the row is part of it. */
export const targets = (pane, id) =>
  pane.sel.has(id) ? pane.rows.filter((row) => pane.sel.has(row.id)).map((row) => row.id) : [id];
/** The same, plus what collapsed rows hide: a folded branch is handled as one thing. */
export const branches = (pane, id) =>
  targets(pane, id).flatMap((each) => (rowOf(pane, each)?.collapsed ? [each, ...under(pane, each)] : [each]));

/** Keeps the keyboard on the tree when nothing else has it. */
function holdKeys() {
  const busy = ui.renaming || ui.overlay || ui.menu;
  if (!busy && !app.contains(document.activeElement)) rowEl(here(), ui.cursor)?.focus({ preventScroll: true });
}

export function closeOverlay() {
  ui.overlay = undefined;
  redraw();
  holdKeys();
}

/** Asks before something is lost: `run` happens only on a yes (the button named `yes`). */
export function ask(question, yes, run) {
  ui.overlay = { kind: 'ask', question, yes, run };
  redraw();
  app.querySelector('.dialog .primary').focus(); // So Enter says yes.
}

let toastTimer;
/** Tells what was just done, for a few seconds, with a way back. */
export function say(text) {
  clearTimeout(toastTimer);
  ui.toast = text;
  redraw();
  toastTimer = setTimeout(() => ((ui.toast = undefined), redraw()), 6000);
}

export function setFocus(pane) {
  const index = ui.panes.indexOf(pane);
  if (index === -1 || index === ui.focus) return;
  for (const other of ui.panes) other.sel.clear();
  ui.focus = index;
  ui.cursor = undefined;
  remember(); // New tabs go to the tree of the pane the user works in: the worker hears of it at once.
}

export function focusRow(pane, id) {
  if (id === undefined) return;
  ui.cursor = id;
  redraw();
  rowEl(pane, id)?.focus();
}

// --- From the worker's state to the screen -------------------------------------

/** The rows that match the search, and the rows above them that lead there. */
/** Whether node `id` has every word of the search in its name, address or text. */
function matches(id, query) {
  const node = ui.library.nodes[id];
  const text = `${titleOf(node)} ${node.url ?? ''} ${node.note ?? ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

function found(rows, query) {
  const out = [];
  let need = 0; // Walking up: a row shallower than the last one kept leads to it.
  for (const row of rows.toReversed()) {
    if (!matches(row.id, query) && row.depth >= need) continue;
    out.unshift(row);
    need = row.depth;
  }
  return out;
}

function take(state, active) {
  ui.library = migrate(state.library);
  ui.trouble = state.trouble;
  ui.journal = state.journal;
  // Of the two things to say, the one about more pages.
  const { here, elsewhere } = state.unsynced;
  const kind = here + elsewhere === 0 ? undefined : here >= elsewhere ? 'here' : 'elsewhere';
  ui.unsynced = kind && localStorage.getItem('unsyncedClosed') !== kind ? { kind, count: state.unsynced[kind] } : undefined;
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  ui.live = new Set(Object.values(state.binding).map((bound) => bound.node));
  ui.audible = new Set(state.audible);
  ui.activeId = state.binding[active?.id]?.node;
  ui.activeTree = state.binding[active?.id]?.tree;
}

/** Each pane's rows; panes, selections and the cursor that point at things now gone are let go. */
function layOut() {
  const { library } = ui;
  ui.panes = ui.panes.filter((pane) => library.trees[pane.tree]);
  if (!ui.panes.length) ui.panes = [newPane(Object.keys(library.trees)[0])];
  ui.focus = Math.min(ui.focus, ui.panes.length - 1);
  if (picker() && !library.trees[picker().tree]) ui.overlay = undefined;
  for (const pane of [...ui.panes, picker()]) {
    if (!pane) continue;
    const searching = ui.query && pane !== picker();
    pane.rows = searching ? found(rowsOf(library, pane.tree, true), ui.query) : rowsOf(library, pane.tree, false, ui.live);
    pane.sel = new Set([...pane.sel].filter((id) => rowOf(pane, id)));
  }
  if (!rowOf(here(), ui.cursor)) ui.cursor = rowOf(here(), ui.activeId)?.id ?? here().rows[0]?.id;
  if (ui.renaming?.id && !rowOf(ui.renaming.pane, ui.renaming.id)) ui.renaming = undefined;
}

/** Which of the shown nodes sit in other trees too, and in which. */
function findShared() {
  const homes = new Map();
  for (const tree of Object.values(ui.library.trees)) {
    for (const id of Object.values(tree.children).flat()) homes.set(id, [...(homes.get(id) ?? []), tree]);
  }
  ui.shared = new Map();
  for (const pane of ui.panes) {
    for (const { id } of pane.rows) {
      const others = homes.get(id).filter((tree) => tree.id !== pane.tree);
      if (others.length) ui.shared.set(id, others.map((tree) => tree.name));
    }
  }
}

let shownTree;
/** Remembers the layout for next time, and tells the worker which tree new tabs of this window go to. */
function remember() {
  const view = { panes: ui.panes.map(({ tree, size }) => ({ tree, size })), split: ui.split };
  localStorage.setItem('view', JSON.stringify(view));
  if (shownTree === here().tree) return;
  shownTree = here().tree;
  send({ type: 'show-tree', windowId: ui.windowId, treeId: shownTree });
}

/** Shows the tree of the current tab, unless a pane shows it already. */
export function showActiveTree() {
  if (!ui.activeTree || ui.panes.some((pane) => pane.tree === ui.activeTree)) return;
  if (!here()) ui.panes = [newPane(ui.activeTree)];
  here().tree = ui.activeTree;
  here().sel.clear();
}

/** Brings the current tab's row into sight or, where a folded branch hides it, the row that holds it. */
export function revealActive() {
  for (const pane of ui.panes) {
    const tree = ui.library.trees[pane.tree];
    let id = ui.activeId;
    while (id !== undefined && !rowOf(pane, id)) id = parentOf(tree, id);
    rowEl(pane, id)?.scrollIntoView({ block: 'nearest' });
  }
}

// The current tab the panel last went to. The panel follows the user: when
// they switch tabs in the browser, it shows that tab's tree and row. A tab
// that changed because of something asked for in the panel (a page put to
// sleep, say) does not take the panel away from the tree the user works in.
let followed;

let generation = 0;
/** Asks the worker for the state and shows it. */
export async function refresh() {
  const current = ++generation;
  const [state, [active]] = await Promise.all([
    send({ type: 'get-state' }),
    chrome.tabs.query({ active: true, windowId: ui.windowId }).catch(() => []),
  ]);
  if (current !== generation || !state) return;
  take(state, active);
  activeTab = active?.id;
  const moved = ui.activeId !== followed;
  const mine = followed !== undefined && (asking > 0 || asked);
  asked = false;
  if (moved && !mine) showActiveTree();
  // The user went to a tab the search would hide (a new one, say): the search is over.
  if (moved && !mine && ui.query && ui.activeId && !matches(ui.activeId, ui.query)) ui.query = '';
  followed = ui.activeId ?? null;
  layOut();
  findShared();
  remember();
  redraw();
  if (moved) revealActive();
  holdKeys();
}
