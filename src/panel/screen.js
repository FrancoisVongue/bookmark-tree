// What is on the screen, and the way to the worker. The panel never changes
// the library itself; it owns only this: which trees are shown, what is
// selected, searched for, dragged, or open on top.

import { descendantsOf, migrate, rowsOf } from '../model.js';
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
  activeId: undefined, // The node of this window's current tab.
  canUndo: false,
  canRedo: false,
  panes: (kept.panes ?? []).map((pane) => newPane(pane.tree, pane.size)), // The trees shown: { tree, size, rows, sel }.
  focus: 0, // The pane the user works in.
  split: kept.split ?? 'column', // Panes one under another, or 'row': side by side.
  query: '', // What is searched for.
  cursor: undefined, // The row the keyboard is on, in the focused pane.
  renaming: undefined, // { id, pane, field? } or { tree }.
  drag: undefined, // { kind: 'rows', ids, from, label } or { kind: 'link' } while something is dragged.
  drop: undefined, // { pane, targetId, position } where it would land.
  menu: undefined, // { x, y, items }
  // The one thing open on top of the panel, if any:
  //   { kind: 'picker', into, tree, rows, sel }  a pane to choose nodes of another tree
  //   { kind: 'icons', ids } | { kind: 'trash' } | { kind: 'keys' } | { kind: 'sync', ... }
  overlay: undefined,
  toast: undefined, // What was just removed, with a way back.
};

export const send = (message) => {
  if (message.type !== 'get-state') log('command', message);
  return chrome.runtime.sendMessage(message).catch((error) => log('command failed', message.type, error.message));
};
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

export function closeOverlay() {
  ui.overlay = undefined;
  redraw();
}

let toastTimer;
/** Tells what was just removed, for a few seconds, with a way back. */
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
}

export function focusRow(pane, id) {
  if (id === undefined) return;
  ui.cursor = id;
  redraw();
  rowEl(pane, id)?.focus();
}

// --- From the worker's state to the screen -------------------------------------

/** The rows that match the search, and the rows above them that lead there. */
function found(rows, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (id) => {
    const node = ui.library.nodes[id];
    const text = `${titleOf(node)} ${node.url ?? ''} ${node.note ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const out = [];
  let need = 0; // Walking up: a row shallower than the last one kept leads to it.
  for (const row of rows.toReversed()) {
    if (!matches(row.id) && row.depth >= need) continue;
    out.unshift(row);
    need = row.depth;
  }
  return out;
}

function take(state, active) {
  ui.library = migrate(state.library);
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  ui.live = new Set(Object.values(state.binding).map((bound) => bound.node));
  ui.audible = new Set(state.audible);
  ui.activeId = state.binding[active?.id]?.node;
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
    pane.rows = searching ? found(rowsOf(library, pane.tree, true), ui.query) : rowsOf(library, pane.tree);
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

let shownActive;
/** Keeps the current tab's row in sight, and the keyboard on the tree. */
function follow() {
  if (ui.activeId !== shownActive) {
    shownActive = ui.activeId;
    for (const pane of ui.panes) rowEl(pane, ui.activeId)?.scrollIntoView({ block: 'nearest' });
  }
  const busy = ui.renaming || ui.overlay || ui.menu;
  if (!busy && !app.contains(document.activeElement)) rowEl(here(), ui.cursor)?.focus({ preventScroll: true });
}

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
  layOut();
  findShared();
  remember();
  redraw();
  follow();
}
