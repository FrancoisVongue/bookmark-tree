// What is on the screen, and the way to the worker. The panel never changes
// the library itself; it owns only this: which trees are shown, what is
// selected, searched for, dragged, or open on top.

import { descendantsOf, migrate, parentOf, rowsOf } from '../model.js';
import { find } from '../find.js';
import { draw, titleOf } from './view.js';

export const log = (...args) => console.log('[tree panel]', ...args);
export const app = document.getElementById('app');

const kept = JSON.parse(localStorage.getItem('view') ?? '{}');
// A pane: the tree it shows, its rows with their places, and which of them are drawn (`from`..`to`, between gaps `before` and `after`: see inSight). (While searching, also `loose`: see found().)
export const newPane = (tree, size = 1) => ({ tree, size, rows: [], from: 0, to: 0, sel: new Set() });

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
  journalQuery: '', // What is searched for in the unfolded journal.
  journalAll: false, // Whether the unfolded journal shows all its places, or only the latest.
  places: { shown: [], more: 0, loose: undefined }, // What the unfolded journal shows (see layJournal).
  planOpen: localStorage.getItem('planOpen') === 'yes', // The same for the plan (the library's `plan`: what to open next).
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
  // What is dragged: { kind: 'rows', ids, from, label }, { kind: 'tree', tree, label }, { kind: 'plan', ids, label } (an entry of the plan) or { kind: 'link' }.
  drag: undefined,
  // Where it would land: { pane, targetId, position } in a pane, { cell, tree } in the table of trees, { plan, before } in the plan.
  drop: undefined,
  menu: undefined, // { x, y, items, opener }: `opener` is the button it hangs from, if any.
  // The one thing open on top of the panel, if any:
  //   { kind: 'picker', into, tree, rows, sel }  a pane to choose nodes of another tree
  //   { kind: 'icons', ids } or { ..., tree }    the table of icons, for nodes or for a tree
  overlay: undefined,
  toast: undefined, // { text, undo }: what was just done, and whether "Undo" would take it back.
  tight: undefined, // The step between two rows of one level, in pixels (see place()).
  pointer: undefined, // { pane, y }: where the pointer is over a tree, in a dense tree (see spread()).
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

// --- Where rows are, and which are drawn --------------------------------------------
// This is the one place that knows the geometry of a tree. A tree may have
// thousands of rows; only those in sight, and a few beyond, are in the page.
// The place of each is known without drawing it: a row is one height, and
// stands a step below the row before it - a full step, or, if the user
// asked for a denser tree (the settings page), a shorter one when both rows
// are of the same level. So what is squeezed is a run of siblings, never
// the distance from a parent to its first child.

const ROW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row'));
const SPARE = 12; // Rows drawn beyond each edge of what is seen,
const STEP = 6; // and how many rows the view scrolls before the set of drawn rows changes.

/** The step between two rows of one level: the row's height at the least, half of it at the most density. */
const tightStep = () => ROW * (1 - Math.min(1, Math.max(0, Number(localStorage.getItem('density')) || 0)) / 2);
addEventListener('storage', (event) => event.key === 'density' && arrange()); // The settings page moved the slider.

/** Gives each row of a pane its place: `top`, and `pull` - how much closer than a full step it stands to the row above. */
function place(pane) {
  ui.tight = tightStep();
  let top = 0;
  pane.rows.forEach((row, at) => {
    const pull = at > 0 && row.depth === pane.rows[at - 1].depth ? ROW - ui.tight : 0;
    top += at > 0 ? ROW - pull : 0;
    Object.assign(row, { top, pull, shift: 0, gap: 0 });
  });
  pane.height = pane.rows.length ? top + ROW : 0;
}

const paneEl = (pane) => app.querySelector(`.pane[data-pane="${pane === picker() ? 'picker' : ui.panes.indexOf(pane)}"]`);
/** How far the top of a pane's tree is above the top of what the pane shows, in pixels (below it: negative). */
const scrolled = (el) => el.getBoundingClientRect().top - el.querySelector('.tree').getBoundingClientRect().top;
/** The first row of a pane whose bottom is below `y` (the number of rows, if none is). */
function rowAt(pane, y) {
  let [low, high] = [0, pane.rows.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (pane.rows[middle].top + ROW > y) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Sets which rows of a pane are drawn (`from`..`to`), from where it is
 * scrolled to, and how tall the gaps standing for the rest are (`before`,
 * `after`). Says whether the set of rows changed.
 */
function inSight(pane) {
  const el = paneEl(pane);
  const [seenFrom, seenTo] = el ? [scrolled(el), scrolled(el) + el.clientHeight] : [0, innerHeight];
  const from = Math.max(0, Math.floor(rowAt(pane, seenFrom) / STEP) * STEP - SPARE);
  const to = Math.min(pane.rows.length, Math.ceil(rowAt(pane, seenTo - ROW) / STEP) * STEP + STEP + SPARE);
  const changed = from !== pane.from || to !== pane.to;
  const [first, last] = [pane.rows[from], pane.rows[to - 1]];
  // (The first row drawn still pulls itself up towards the row above, which is not there: the gap makes up for it.)
  Object.assign(pane, { from, to, before: first ? first.top + first.pull : 0, after: last ? pane.height - last.top - ROW : 0 });
  return changed;
}

/**
 * In a dense tree the rows around the pointer move apart, so that what is
 * looked at is easy to read and to hit - like the middle of the eye. Rows
 * are only shifted, never laid out anew, and by where the pointer is, not
 * by time: what is under the pointer stays under it. The shift of a row is
 * how much the squeezed steps between it and the pointer open up, each the
 * more the nearer it is.
 */
function spread() {
  const { pane, y } = ui.pointer ?? {};
  const el = pane && ui.tight < ROW && !ui.drag && paneEl(pane);
  if (!el) return;
  const at = y - el.querySelector('.tree').getBoundingClientRect().top; // The pointer, measured down the tree.
  const reach = 4.5 * ui.tight;
  const near = (distance) => (Math.abs(distance) < reach ? Math.cos((Math.PI * distance) / (2 * reach)) ** 2 : 0);
  // How much everything above a point has opened up, counted from the top of the rows drawn.
  let opened = 0;
  let atPointer;
  for (let n = pane.from; n < pane.to; n++) {
    const row = pane.rows[n];
    const [start, end] = [n > pane.from ? pane.rows[n - 1].top : row.top, row.top]; // The step that leads to this row,
    const more = row.pull / (end - start || 1); // and how much it opens per pixel, at the pointer itself.
    if (atPointer === undefined && at < end) atPointer = opened + more * near((start + at) / 2 - at) * Math.max(0, at - start);
    opened += more * near((start + end) / 2 - at) * (end - start);
    row.shift = opened;
  }
  atPointer ??= opened;
  for (let n = pane.from; n < pane.to; n++) {
    const row = pane.rows[n];
    row.shift -= atPointer;
    row.gap = n > pane.from ? row.shift - pane.rows[n - 1].shift : 0; // How far it moved from the row above: the guides bridge it.
  }
}

/** Where the line that shows a drop goes in a pane: { top, depth } - under or over the target row, at the level the rows would land on. */
function dropLine(pane) {
  const { targetId, position } = ui.drop?.pane === pane ? ui.drop : {};
  const row = targetId && rowOf(pane, targetId);
  if (!row || position === 'inside') return undefined;
  return { top: row.top + row.shift + (position === 'before' ? 0 : ROW), depth: row.depth + (position === 'first' ? 1 : 0) };
}

export function redraw() {
  for (const pane of [...ui.panes, picker()]) {
    if (!pane) continue;
    inSight(pane);
    for (let n = pane.from; n < pane.to; n++) Object.assign(pane.rows[n], { shift: 0, gap: 0 });
  }
  spread();
  for (const pane of ui.panes) pane.line = dropLine(pane);
  draw(app, ui);
  settleFocus();
}

// Scrolling brings other rows in sight. (The event does not bubble: it is caught on its way down.)
app.addEventListener(
  'scroll',
  (event) => {
    const pane = event.target.classList?.contains('pane') && paneAt(event.target);
    if (pane && inSight(pane)) redraw();
  },
  true,
);
addEventListener('resize', () => redraw());

// Where the pointer is over a tree, for spread(): followed once a frame, and only in a dense tree.
let moved;
function point(event) {
  const pane = event.type === 'pointermove' && event.target.closest?.('.tree') ? paneAt(event.target) : undefined;
  if (!pane && !ui.pointer) return;
  ui.pointer = pane && ui.tight < ROW ? { pane, y: event.clientY } : undefined;
  moved ??= requestAnimationFrame(() => ((moved = undefined), redraw()));
}
app.addEventListener('pointermove', point);
app.addEventListener('pointerleave', point);

/** Scrolls a pane just enough to have row `id` in sight, and draws it: a row far away is not in the page until then. */
export function reveal(pane, id) {
  const row = rowOf(pane, id);
  const el = paneEl(pane);
  if (!row || !el) return;
  const top = row.top - scrolled(el); // Where the row is, from the top of what the pane shows.
  if (top < 0) el.scrollTop += top;
  else if (top + ROW > el.clientHeight) el.scrollTop += top + ROW - el.clientHeight;
  redraw();
}

export const here = () => ui.panes[ui.focus];
export const picker = () => (ui.overlay?.kind === 'picker' ? ui.overlay : undefined);
export const idAt = (el) => el.closest?.('.row')?.dataset.id;
export const paneAt = (el) => {
  const index = el.closest?.('.pane')?.dataset.pane;
  return index === 'picker' ? picker() : ui.panes[index];
};
/** The row of node `id` in the page, if it is drawn (see inSight). */
export const rowEl = (pane, id) => paneEl(pane)?.querySelector(`.row[data-id="${id}"]`);
export const rowOf = (pane, id) => pane.rows.find((row) => row.id === id);
export const under = (pane, id) => descendantsOf(ui.library.trees[pane.tree], id);
/** What an action on row `id` applies to: the whole selection if the row is part of it. */
export const targets = (pane, id) =>
  pane.sel.has(id) ? pane.rows.filter((row) => pane.sel.has(row.id)).map((row) => row.id) : [id];
/** The same, plus what collapsed rows hide: a folded branch is handled as one thing. */
export const branches = (pane, id) =>
  targets(pane, id).flatMap((each) => (rowOf(pane, each)?.collapsed ? [each, ...under(pane, each)] : [each]));

/** What is open on top of the trees, if anything: a menu, a dialog, a name being typed. The keys are its, not the rows'. */
export const onTop = () => ui.menu ?? ui.overlay ?? ui.renaming;

/**
 * Puts the keyboard where the screen says it belongs. The one place that
 * decides it, after every drawing: in what is open on top (unless it is
 * there already); else, when nothing in the panel has it, on the row the
 * cursor is on.
 */
function settleFocus() {
  if (document.querySelector('dialog[open]')) return; // A question is asked (see ask in parts.js): the browser keeps the keyboard in it.
  const within = (selector) => app.querySelector(selector)?.contains(document.activeElement);
  if (ui.renaming) {
    // The field of the name being typed has it, with all of the name selected and its beginning in sight.
    const field = app.querySelector('.rename');
    if (field && document.activeElement !== field) (field.focus(), field.select(), (field.scrollLeft = 0));
    return;
  }
  if (ui.menu) return within('.menu') || app.querySelector('.menu')?.focus();
  // The table of icons waits in its field, a pane to choose from on itself.
  if (ui.overlay) return within('.dialog') || app.querySelector(`.dialog ${ui.overlay.kind === 'icons' ? '.any' : ''}`)?.focus();
  if (!app.contains(document.activeElement) || document.activeElement === app) rowEl(here(), ui.cursor)?.focus({ preventScroll: true });
}

// The frame around the row the keyboard is on is for those who use the keyboard: it shows after a key, and goes with a press of the mouse.
addEventListener('keydown', (event) => ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) || app.classList.add('keys'), true);
addEventListener('pointerdown', () => app.classList.remove('keys'), true);

export function closeOverlay() {
  ui.overlay = undefined;
  redraw();
}

let toastTimer;
/** Tells what was just done, for a few seconds - with a way back (`undo`) when what was done is a step that can be undone. */
export function say(text, undo = false) {
  clearTimeout(toastTimer);
  ui.toast = { text, undo };
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
  reveal(pane, id);
  rowEl(pane, id)?.focus({ preventScroll: true });
}

// --- What the rest of the panel may ask of the screen -------------------------------
// The other parts ask; only this file changes `ui`.

/** Shows a tree in a pane. (A tree just made, which the panel has not heard of yet, appears with the worker's next state.) */
export function show(pane, treeId) {
  pane.tree = treeId;
  pane.sel.clear();
  if (ui.library.trees[treeId]) arrange();
}

/** One more pane, showing tree `treeId`. */
export function openBeside(treeId) {
  ui.panes.push(newPane(treeId));
  arrange();
}

export function closePane(pane) {
  ui.panes.splice(ui.panes.indexOf(pane), 1);
  ui.focus = 0;
  arrange();
}

/**
 * The two split buttons. With one tree shown, either shows a second beside
 * it (the same tree, until another is chosen in the table). With several, the
 * button of the way they lie now leaves only the focused one; the other
 * button turns them.
 */
export function split(way) {
  if (ui.panes.length === 1) {
    ui.panes.push(newPane(here().tree));
    setFocus(ui.panes[1]);
  } else if (ui.split === way) {
    ui.panes = [here()];
    ui.focus = 0;
  }
  ui.split = way;
  arrange();
}

/** Opens something on top of the trees (see `ui.overlay` for what it may be). */
export function openOverlay(overlay) {
  ui.overlay = overlay;
  arrange();
}
/** The pane on top to choose nodes of tree `treeId` from; they go `into` { pane, id }. */
export const pick = (treeId, into) => openOverlay({ kind: 'picker', ...newPane(treeId), into });

/** Shows a menu at a point: items { label, hint, disabled, run }; `null` is a separator, `false` and `undefined` are left out. */
export function openMenu(x, y, items, opener) {
  const run = (entry) => () => {
    closeMenu();
    entry.run();
  };
  const shown = items.filter((entry) => entry !== false && entry !== undefined);
  ui.menu = { x, y, opener, items: shown.map((entry) => entry && { ...entry, run: run(entry) }) };
  redraw();
  // Keep it on screen.
  const box = app.querySelector('.menu').getBoundingClientRect();
  ui.menu.x = Math.max(4, Math.min(x, innerWidth - box.width - 4));
  ui.menu.y = Math.max(4, Math.min(y, innerHeight - box.height - 4));
  redraw();
}

/** A menu hanging from a button. Pressing the button again closes it. */
export function menuUnder(button, items) {
  if (ui.menu?.opener === button) return closeMenu();
  const box = button.getBoundingClientRect();
  openMenu(box.right, box.bottom, items, button);
}

/** Closes the menu; the keyboard goes back to the row. */
export function closeMenu() {
  ui.menu = undefined;
  redraw();
}

/** Selects row `id`: alone, or - `how` - 'toggle' it among the selected, or the 'range' from the cursor to it. The cursor goes there (it stays for a range: it is the range's anchor). */
export function select(pane, id, how) {
  if (how === 'range' && rowOf(pane, ui.cursor)) {
    const ids = pane.rows.map((row) => row.id);
    const [from, to] = [ids.indexOf(ui.cursor), ids.indexOf(id)].sort((a, b) => a - b);
    pane.sel = new Set(ids.slice(from, to + 1));
    return redraw();
  }
  if (how !== 'toggle') pane.sel = new Set([id]);
  else if (!pane.sel.delete(id)) pane.sel.add(id);
  ui.cursor = id;
  redraw();
}
/** Adds rows to the selected (all of a pane's, without `ids`). */
export function selectAlso(pane, ids = pane.rows.map((row) => row.id)) {
  pane.sel = new Set([...pane.sel, ...ids]);
  redraw();
}
/** Lets go of the selection: a pane's, or everywhere. */
export function deselect(pane) {
  for (const each of pane ? [pane] : ui.panes) each.sel.clear();
  redraw();
}
/** Puts the cursor on a row without changing what is selected. */
export function pointAt(id) {
  ui.cursor = id;
}

/** What is typed in the search field, and in the journal's. */
export function search(text) {
  ui.query = text;
  arrange();
}
export function searchJournal(text) {
  ui.journalQuery = text;
  arrange();
}

/** Folds or unfolds the journal or the plan ('journal' | 'plan'). Unfolded anew, the journal starts from its latest places. */
export function toggleStrip(name) {
  ui[`${name}Open`] = !ui[`${name}Open`];
  localStorage.setItem(`${name}Open`, ui[`${name}Open`] ? 'yes' : 'no');
  if (name === 'journal') Object.assign(ui, { journalQuery: '', journalAll: false });
  arrange();
}
export function allOfJournal() {
  ui.journalAll = true;
  arrange();
}

/** The notice about what is not synced stays closed until there is something else to say. */
export function closeNotice() {
  localStorage.setItem('unsyncedClosed', ui.unsynced.kind);
  arrange();
}

/** Starts typing a name: of row { id, pane } (its address, with `field: 'url'`), or of { tree }. The field takes the keyboard (see settleFocus). */
export function rename(what) {
  ui.renaming = what;
  redraw();
}
/** Ends it: gives what was being named and what was typed, { renaming, text } (nothing, if no name was being typed). */
export function endRenaming() {
  const renaming = ui.renaming;
  if (!renaming) return {};
  const text = app.querySelector('.rename')?.value ?? '';
  ui.renaming = undefined;
  if (renaming.id) ui.cursor = renaming.id; // The keyboard goes back to the row that was named.
  redraw();
  return { renaming, text };
}

/** Takes the notice of what was done away. */
export function unsay() {
  clearTimeout(toastTimer);
  ui.toast = undefined;
  redraw();
}

/** What is dragged (see `ui.drag`), or nothing any more; and where it would land. */
export function setDrag(drag) {
  ui.drag = drag;
  if (!drag) ui.drop = undefined;
  redraw();
}
export function setDrop(drop) {
  ui.drop = drop;
  redraw();
}

/** The window whose tabs this panel shows. */
export function watch(windowId) {
  ui.windowId = windowId;
}

// --- From the worker's state to the screen -------------------------------------

/** What a node is searched by: its name, address and text. */
const textOf = (id) => {
  const node = ui.library.nodes[id];
  return `${titleOf(node)} ${node.url ?? ''} ${node.note ?? ''}`;
};

/**
 * The rows that answer the search (see find.js) and the rows above them
 * that lead there; the first of those that answer it; and, when nothing
 * answered it exactly, how it was read: { rows, first, loose: { how, as } | undefined }.
 */
function found(rows, query) {
  const { hits, how, as } = find(rows, query, (row) => textOf(row.id));
  const hit = new Set(hits);
  const out = [];
  let need = 0; // Walking up: a row shallower than the last one kept leads to it.
  for (const row of rows.toReversed()) {
    if (!hit.has(row) && row.depth >= need) continue;
    out.unshift(row);
    need = row.depth;
  }
  return { rows: out, first: out.find((row) => hit.has(row))?.id, loose: how === 'exact' ? undefined : { how, as } };
}

const JOURNAL_SHOWN = 8; // Places in the unfolded journal at first; "more" shows the rest.
/** What the unfolded journal shows: the latest places, or those that answer the search in it. */
function layJournal() {
  const { hits, how, as } = ui.journalQuery ? find(ui.journal, ui.journalQuery, (entry) => textOf(entry.node)) : { hits: ui.journal, how: 'exact' };
  const shown = ui.journalQuery || ui.journalAll ? hits : hits.slice(0, JOURNAL_SHOWN);
  ui.places = { shown, more: hits.length - shown.length, loose: how === 'exact' ? undefined : { how, as } };
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
  const cursorWas = { tree: here()?.tree, at: here()?.rows.findIndex((row) => row.id === ui.cursor) ?? -1 }; // Among the rows as they were.
  ui.panes = ui.panes.filter((pane) => library.trees[pane.tree]);
  if (!ui.panes.length) ui.panes = [newPane(Object.keys(library.trees)[0])];
  ui.focus = Math.min(ui.focus, ui.panes.length - 1);
  if (picker() && !library.trees[picker().tree]) ui.overlay = undefined;
  for (const pane of [...ui.panes, picker()]) {
    if (!pane) continue;
    const searching = ui.query && pane !== picker();
    const { rows, first, loose } = searching ? found(rowsOf(library, pane.tree, true), ui.query) : { rows: rowsOf(library, pane.tree, false, ui.live) };
    Object.assign(pane, { rows, loose, first: first ?? rows[0]?.id });
    place(pane);
    pane.sel = new Set([...pane.sel].filter((id) => rowOf(pane, id)));
  }
  // The cursor's row is gone (removed, folded away): the cursor stays where it was, on the row now there. In another tree it starts from the current tab.
  const same = cursorWas.tree === here().tree && cursorWas.at >= 0;
  if (!rowOf(here(), ui.cursor)) ui.cursor = same ? here().rows[Math.min(cursorWas.at, here().rows.length - 1)]?.id : (rowOf(here(), ui.activeId)?.id ?? here().rows[0]?.id);
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
    reveal(pane, id);
  }
}

// The current tab the panel last went to. The panel follows the user: when
// they switch tabs in the browser, it shows that tab's tree and row. A tab
// that changed because of something asked for in the panel (a page put to
// sleep, say) does not take the panel away from the tree the user works in.
let followed;

/**
 * Lays the screen out anew from what the panel already knows. Enough for
 * what happens on the screen only: typing in the search, showing another
 * tree, folding the journal. Nothing is asked of the worker.
 */
export function arrange() {
  layOut();
  layJournal();
  findShared();
  remember();
  redraw();
}

let coming; // A refresh about to start: all who ask before it does share it.
/** Asks the worker for the state and shows it. Several askings at once (a command's answer, the worker's "changed", a change of tab) make one. */
export function refresh() {
  return (coming ??= new Promise((done) => setTimeout(() => ((coming = undefined), done(pull())))));
}

let generation = 0;
async function pull() {
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
  if (moved && !mine && ui.query && ui.activeId && !find([ui.activeId], ui.query, textOf).hits.length) ui.query = '';
  followed = ui.activeId ?? null;
  arrange();
  if (moved) revealActive();
}
