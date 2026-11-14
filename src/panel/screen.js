// What is on the screen, and the way to the worker. The panel never changes
// the library itself; it owns only this: which trees are shown and through
// which filter (and the filters saved to choose from), what is selected,
// searched for, typed, dragged, or open on top, and which playing pages the
// user sent away from the stack at the bottom.

import { ROOT, descendantsOf, inTree, isGroup, parentOf, rowsOf } from '../model.js';
import { find } from '../find.js';
import { modeOf, nameFor, narrowedTo, savedWith, stillPicked, topmost, withLeads, withSaved } from './filter.js';
import { stackOf } from './sound.js';
import { t } from '../i18n.js';
import { draw, titleOf } from './view.js';

export const log = (...args) => console.log('[tree panel]', ...args);
export const app = document.getElementById('app');

const kept = JSON.parse(localStorage.getItem('view') ?? '{}');
// The saved filters are kept apart from the view, under a key of their own: every open panel has them, and writes them only when one is saved or taken off the list (see saveFilter, forgetSaved); the others read them again then. (Moved once from where an older version kept them, with the view.)
if (kept.saved && !localStorage.getItem('saved')) localStorage.setItem('saved', JSON.stringify(kept.saved));
const savedKept = () => JSON.parse(localStorage.getItem('saved') ?? '{}');
// A pane: its own id (what it is known by in the page, whatever its place among the panes), the tree it shows, its rows with their places, what of its tree is in sight (`sight`) and which rows are drawn (`from`..`to`, between gaps `before` and `after`: see measure). (Also `count`, `first` and, while searching, `loose`: see rowsFor; and `holder`, the folded row that hides the current tab: see holderOf.)
let panes = 0;
export const newPane = (tree, size = 1) => ({ id: `p${++panes}`, tree, size, rows: [], from: 0, to: 0, sel: new Set() });

export const ui = {
  windowId: undefined,
  library: undefined,
  live: new Set(), // Ids of nodes that have a tab.
  audible: new Set(), // Ids of nodes whose tab is making sound.
  playingTrees: new Set(), // Ids of the trees that hold such a node.
  dismissed: new Set(), // Those of them the user sent away from the stack at the bottom: each stays away until it stops playing.
  sounds: { ids: [], more: 0 }, // What that stack holds: the playing pages whose row is not in sight (see stackOf in sound.js). Worked out with every drawing, in redraw alone.
  shared: new Map(), // Node id -> names of the other trees it is in.
  activeId: undefined, // The node of this window's current tab,
  activeTree: undefined, // and the tree that tab is in.
  trouble: undefined, // What the worker could not do: read the library, or save it.
  journal: [], // Where the user was before this, newest first: [{ node, tree, at }] (see journal.js).
  // Which strips are unfolded to their whole list (see strip in view.js). (Read once from where an older version kept it.)
  open: kept.open ?? { journal: localStorage.getItem('journalOpen') === 'yes', plan: localStorage.getItem('planOpen') === 'yes' },
  unsyncedClosed: kept.unsyncedClosed ?? localStorage.getItem('unsyncedClosed') ?? undefined, // The notice about what is not synced the user closed: 'here' | 'elsewhere'.
  journalQuery: '', // What is searched for in the unfolded journal.
  journalAll: false, // Whether the unfolded journal shows all its places, or only the latest.
  places: { shown: [], more: 0, loose: undefined }, // What the unfolded journal shows (see layJournal).
  // The filter of each tree, on this screen: { [treeId]: { picked: [nodeId], mode, at } } - what is ticked, whether that is shown alone or hidden, and when it was said (see filter.js). Kept with the view, never with the library - and as it was said: what of it counts now is asked when it is read (see filterNow).
  filters: kept.filters ?? {},
  // The filters the user saved, of each tree, to set its filter from: { [treeId]: [{ name, picked, mode }] }, a name once in a tree. Kept as they were said too; only the user takes one off the list.
  saved: savedKept(),
  // While the user ticks them: { tree, ids: Set, mode, anchor } - the whole tree is shown, every row with a tick to set, and the ticks will mean `mode` ('only' | 'hide'); nothing is narrowed until they say so.
  ticking: undefined,
  filtered: undefined, // What the bar says of the focused pane's filter (see filterLine), if it has one or is being ticked.
  notice: undefined, // The one thing to tell the user at the bottom: { id, text, button?: { action, label } } (see noticeOf).
  canUndo: false,
  canRedo: false,
  panes: (kept.panes ?? []).map((pane) => newPane(pane.tree, pane.size)), // The trees shown: { tree, size, rows, sel }.
  focus: undefined, // The pane the user works in (the first, until one is chosen: see here()).
  split: kept.split ?? 'column', // Panes one under another, or 'row': side by side.
  query: '', // What is searched for.
  cursor: undefined, // The row the keyboard is on, in the focused pane.
  // What is being typed in a field in the place of a name: { what, text, ... } - `what` it is, and the `text` the field starts with: 'name' or 'address' of row { id, pane }, the name of a 'tree' { tree }, or the name to save the 'filter' of { tree } under. (What is done with what was typed: see TYPED in commands.js.)
  typing: undefined,
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
// the distance from a parent to its first child. A group at the top level
// is a heading: it stands a little further from what is above it than a row
// does, so that the sections of a tree do not run together.

const ROW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row'));
const SPARE = 12; // Rows drawn beyond each edge of what is seen,
const STEP = 6; // and how many rows the view scrolls before the set of drawn rows changes.
const LEAD = 6; // The room above a group at the top level, over a row's own. (One tile of the guides' mask.)

/** The step between two rows of one level: the row's height at the least, half of it at the most density. */
const tightStep = () => ROW * (1 - Math.min(1, Math.max(0, Number(localStorage.getItem('density')) || 0)) / 2);
// What another page changed: the settings page moved the slider, another panel saved a filter or took one off the list.
addEventListener('storage', (event) => {
  if (event.key === 'saved') ui.saved = savedKept();
  if (['density', 'saved'].includes(event.key) && ui.library) arrange();
});

/** Gives each row of a pane its place: `top`, and `pull` - how much closer than a full step it stands to the row above (further, when less than nothing: a heading). */
function place(pane) {
  ui.tight = tightStep();
  let top = 0;
  pane.rows.forEach((row, at) => {
    const node = ui.library.nodes[row.id];
    const lead = at > 0 && row.depth === 0 && node && isGroup(node) ? LEAD : 0;
    const pull = (at > 0 && row.depth === pane.rows[at - 1].depth ? ROW - ui.tight : 0) - lead;
    top += at > 0 ? ROW - pull : 0;
    Object.assign(row, { top, pull, shift: 0, gap: 0 });
  });
  pane.height = pane.rows.length ? top + ROW : 0;
}

export const paneEl = (pane) => app.querySelector(`.pane[data-pane="${pane.id}"]`);
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

/** The row of a pane at height `y` of the window, drawn or not: the first or the last of them when `y` is above or below them all. */
export function rowUnder(pane, y) {
  const el = paneEl(pane);
  return el && pane.rows[Math.min(pane.rows.length - 1, rowAt(pane, y - el.querySelector('.tree').getBoundingClientRect().top))];
}

/**
 * Sets what of a pane's tree is in sight (`sight`: from..to, in pixels down
 * the tree) from where it is scrolled to; from that, which rows are drawn
 * (`from`..`to`), and how tall the gaps standing for the rest are (`before`,
 * `after`). Says whether the set of rows changed.
 */
function measure(pane) {
  const el = paneEl(pane);
  const [seenFrom, seenTo] = (pane.sight = el ? [scrolled(el), scrolled(el) + el.clientHeight] : [0, innerHeight]);
  const from = Math.max(0, Math.floor(rowAt(pane, seenFrom) / STEP) * STEP - SPARE);
  const to = Math.min(pane.rows.length, Math.ceil(rowAt(pane, seenTo - ROW) / STEP) * STEP + STEP + SPARE);
  const changed = from !== pane.from || to !== pane.to;
  const [first, last] = [pane.rows[from], pane.rows[to - 1]];
  // (The first row drawn still pulls itself up towards the row above, which is not there: the gap makes up for it.)
  Object.assign(pane, { from, to, before: first ? first.top + first.pull : 0, after: last ? pane.height - last.top - ROW : 0 });
  return changed;
}

// What "in sight" means is said here, once: within `sight`, what the pane shows of its tree (see measure).
/** How far the stretch `from`..`to` of a pane's tree (pixels down the tree) is beyond what the pane shows: less than nothing above it, more below, nothing when all of it is in sight. */
const beyond = (pane, from, to) => Math.min(0, from - pane.sight[0]) || Math.max(0, to - pane.sight[1]);
/** Whether a row of a pane is in sight: its middle is. */
const isSeen = (pane, row) => beyond(pane, row.top + ROW / 2, row.top + ROW / 2) === 0;
/** Whether node `id` has a row in sight in some pane (it has none when folded away, or left out by the pane's filter or the search). */
const seenSomewhere = (id) => ui.panes.some((pane) => rowOf(pane, id) && isSeen(pane, rowOf(pane, id)));
/** The playing pages to put in the stack at the bottom, as things stand. */
const soundsNow = () => stackOf([...ui.audible], seenSomewhere, ui.dismissed);

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
    const more = Math.max(0, row.pull) / (end - start || 1); // and how much it opens per pixel, at the pointer itself. (A heading's room is not a squeeze to open.)
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
    measure(pane);
    for (let n = pane.from; n < pane.to; n++) Object.assign(pane.rows[n], { shift: 0, gap: 0 });
  }
  spread();
  for (const pane of ui.panes) pane.line = dropLine(pane);
  ui.sounds = soundsNow();
  draw(app, ui);
  settleFocus();
  room ??= watchRoom();
}

// Scrolling brings other rows in sight - to be drawn, or a playing one, to leave the stack or join it. (The event does not bubble: it is caught on its way down.)
app.addEventListener(
  'scroll',
  (event) => {
    const pane = event.target.classList?.contains('pane') && (paneAt(event.target) ?? picker());
    if (!pane) return;
    const rows = measure(pane);
    const { ids, more } = soundsNow();
    if (rows || more !== ui.sounds.more || ids.join() !== ui.sounds.ids.join()) redraw();
  },
  true,
);
// So does a change of the room the panes have: the window resized, a strip unfolded, a notice come or gone. (And the first drawing, made before there was anything to measure.)
let room; // What watches it, from the first drawing on: the panes are one element ever after.
function watchRoom() {
  const panes = app.querySelector('.panes');
  if (!panes) return undefined;
  const watching = new ResizeObserver(() => redraw());
  watching.observe(panes);
  return watching;
}

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
  measure(pane);
  el.scrollTop += beyond(pane, row.top, row.top + ROW); // All of the row, not its middle only.
  redraw();
}

export const here = () => (ui.panes.includes(ui.focus) ? ui.focus : ui.panes[0]);
export const picker = () => (ui.overlay?.kind === 'picker' ? ui.overlay : undefined);
export const idAt = (el) => el.closest?.('.row')?.dataset.id;
/** The pane of the panel an element is in. (The picker's pane, on top, is not one of them: it has verbs of its own, below.) */
export const paneAt = (el) => {
  const id = el.closest?.('.panes .pane')?.dataset.pane;
  return ui.panes.find((pane) => pane.id === id);
};
/** The row of node `id` in the page, if it is drawn (see measure). */
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
export const onTop = () => ui.menu ?? ui.overlay ?? ui.typing;

/**
 * Puts the keyboard where the screen says it belongs. The one place that
 * decides it, after every drawing: in what is open on top (unless it is
 * there already); else, when nothing in the panel has it, on the row the
 * cursor is on.
 */
function settleFocus() {
  if (document.querySelector('dialog[open]')) return; // A question is asked (see ask in parts.js): the browser keeps the keyboard in it.
  const within = (selector) => app.querySelector(selector)?.contains(document.activeElement);
  if (ui.typing) {
    // The field of what is being typed has it, with all of the name selected and its beginning in sight.
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
  if (!ui.panes.includes(pane) || pane === here()) return;
  for (const other of ui.panes) other.sel.clear();
  ui.focus = pane;
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

// A filter is set by ticking: the funnel shows a tick to set on every row of the tree, and - pressed again - leaves only what was ticked, or all but that.

/** Starts ticking in the focused pane's tree, from what its filter has ticked now and means by it; or, when ticking already, applies it. */
export function tick() {
  if (ui.ticking) return applyTicks();
  const now = filterNow(here().tree);
  ui.ticking = { tree: here().tree, ids: new Set(now?.picked ?? []), mode: modeOf(now), anchor: undefined };
  arrange();
}
/** Says what the ticks being set will mean: 'only' or 'hide'. The ticks stay - that is how a filter is turned inside out. */
export function tickMode(mode) {
  ui.ticking.mode = mode;
  arrange();
}
/** Ticks or unticks row `id` - or, with `range`, ticks every row from the one ticked last to it. */
export function tickRow(pane, id, range) {
  if (range && rowOf(pane, ui.ticking.anchor)) return tickTo(pane, id, true);
  ui.ticking.anchor = id;
  tickTo(pane, id, !ui.ticking.ids.has(id));
}
/** Ticks (`on`) or unticks every row from the one ticked last to row `id` - which is the one ticked last now, and the keyboard's. */
export function tickTo(pane, id, on) {
  const rows = pane.rows.map((row) => row.id);
  const [from, to] = [rows.indexOf(ui.ticking.anchor), rows.indexOf(id)].sort((a, b) => a - b);
  for (const each of rows.slice(from, to + 1)) ui.ticking.ids[on ? 'add' : 'delete'](each);
  ui.ticking.anchor = ui.cursor = id;
  arrange();
}
/** Leaves only what is ticked, or all but that (nothing ticked: no filter) - of what is there to see now: what comes later is shown all the same (see filter.js). */
export function applyTicks() {
  const { tree, ids, mode } = ui.ticking;
  setFilter(tree, [...ids], mode);
}
/** Stops ticking; the filter stays as it was. */
export function stopTicking() {
  ui.ticking = undefined;
  arrange();
}
/** Sets a tree's filter (none, when nothing of `ids` counts); whatever was being ticked, that is over. */
function setFilter(treeId, ids, mode = 'only') {
  const picked = topmost(ui.library.trees[treeId], ids);
  ui.ticking = undefined;
  if (picked.length) ui.filters[treeId] = { picked, mode, at: Date.now() };
  else delete ui.filters[treeId];
  arrange();
}
/** The short way: shows only node `id` and what is under it. The same node again shows the whole tree. */
export function showBranch(treeId, id) {
  const now = filterNow(treeId);
  setFilter(treeId, now?.mode === 'only' && now.picked.length === 1 && now.picked[0] === id ? [] : [id]);
}
/** Its twin: hides node `id` and what is under it - one more branch of those the tree's filter hides, if it is one that hides. */
export function hideBranch(treeId, id) {
  const now = filterNow(treeId);
  setFilter(treeId, [...(now?.mode === 'hide' ? now.picked : []), id], 'hide');
}
export function clearFilters(treeId) {
  setFilter(treeId, []);
}
/** Keeps what a tree's filter has ticked, and what it means by it, under `name`, to be chosen later; a saved filter of that name gives way to it. */
export function saveFilter(treeId, name) {
  const filter = ui.filters[treeId];
  if (!filter || !name.trim()) return;
  ui.saved[treeId] = withSaved(ui.saved[treeId] ?? [], name.trim(), filter);
  keepSaved();
}
/** Writes the saved filters down - the other panels hear of it (see the `storage` listener above) - and shows them. */
function keepSaved() {
  localStorage.setItem('saved', JSON.stringify(ui.saved));
  arrange();
}
/** Sets a tree's filter from the saved one called `name`: ticked now, so what was added since it was saved is shown. */
export function applySaved(treeId, name) {
  const saved = ui.saved[treeId].find((each) => each.name === name);
  setFilter(treeId, saved.picked, modeOf(saved));
}
export function forgetSaved(treeId, name) {
  ui.saved[treeId] = ui.saved[treeId].filter((each) => each.name !== name);
  if (!ui.saved[treeId].length) delete ui.saved[treeId];
  keepSaved();
}

/** In the picker: shows another tree to choose from, and marks or unmarks a row of it. */
export const pickFrom = (treeId) => pick(treeId, picker().into);
export function togglePicked(id) {
  const { sel } = picker();
  if (!sel.delete(id)) sel.add(id);
  redraw();
}

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
  ui.open[name] = !ui.open[name];
  if (name === 'journal') Object.assign(ui, { journalQuery: '', journalAll: false });
  arrange();
}
export function allOfJournal() {
  ui.journalAll = true;
  arrange();
}

/**
 * Closes the notice at the bottom. That not everything is synced is said once: closed, it stays
 * closed until there is something else to say. That the library has no copy elsewhere is the
 * worker's to keep track of: closed, it comes back in a while.
 */
export async function closeNotice() {
  if (['here', 'elsewhere'].includes(ui.notice.id)) ui.unsyncedClosed = ui.notice.id;
  else await send({ type: 'warning-closed' });
  refresh();
}

/** Sends a playing page away from the stack at the bottom, until it stops playing (see take). The page plays on. */
export function dismiss(id) {
  ui.dismissed.add(id);
  redraw();
}

/** Shows a field to type in (see `ui.typing` for what it may be). The field takes the keyboard (see settleFocus). */
export function typeIn(typing) {
  ui.typing = typing;
  redraw();
}
/** Takes the field away: gives what was being typed and what the field held, { typing, text } (nothing, if there was no field). */
export function endTyping() {
  const typing = ui.typing;
  if (!typing) return {};
  const text = app.querySelector('.rename')?.value ?? '';
  ui.typing = undefined;
  if (typing.id) ui.cursor = typing.id; // The keyboard goes back to the row whose name or address it was.
  redraw();
  return { typing, text };
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

/** The filter of a tree as it counts now: { picked, mode, at } with the ticked nodes that are still in the tree; none when not one of them is. (What is kept stays as it was said: a node that comes back is ticked again.) */
function filterNow(treeId) {
  const kept = ui.filters[treeId];
  const picked = stillPicked(ui.library.trees[treeId], kept?.picked);
  return picked.length ? { picked, mode: modeOf(kept), at: kept.at } : undefined;
}
/** The filter a pane's tree is seen through; none while it is being ticked (then all of the tree is there to tick), nor in the picker. */
const filterOf = (pane) => (pane === picker() || ui.ticking?.tree === pane.tree ? undefined : filterNow(pane.tree));

/**
 * The rows a pane shows of its tree: as the tree has them - all of it, or,
 * seen through its filter, the ticked nodes with what is under them and what
 * came after the filter was set, or the tree without the ticked nodes - and,
 * while searching, those of them that answer, with the rows that lead
 * there. Gives { rows, first (the first that answers the search), loose
 * (how a search that nothing answered exactly was read), count: { shown, of } }.
 *
 * The current tab's row is always among them, even where the filter leaves
 * it out: the user must not lose where they are.
 */
function rowsFor(pane) {
  const filter = filterOf(pane);
  const query = pane === picker() ? '' : ui.query;
  const library = filter ? narrowedTo(ui.library, pane.tree, filter) : ui.library;
  const all = rowsOf(library, pane.tree, true);
  const count = { shown: all.length, of: descendantsOf(ui.library.trees[pane.tree], ROOT).length };
  let rows = query ? all : rowsOf(library, pane.tree);
  let first, loose;
  if (query) {
    const { hits, how, as } = find(all, query, (row) => textOf(row.id));
    [first, loose] = [hits[0]?.id, how === 'exact' ? undefined : { how, as }];
    rows = withLeads(all, new Set([...hits.map((row) => row.id), ui.activeId]));
  }
  // The current tab outside what the filter shows (a new tab that landed elsewhere, say) stands under it, on its own.
  const outside = filter && !all.some((row) => row.id === ui.activeId) && inTree(ui.library.trees[pane.tree], ui.activeId);
  if (outside) rows = [...rows, { id: ui.activeId, depth: 0, kids: 0, collapsed: false, hidden: 0 }];
  return { rows, first, loose, count };
}

const JOURNAL_SHOWN = 8; // Places in the unfolded journal at first; "more" shows the rest.
/** What the unfolded journal shows: the latest places, or those that answer the search in it. */
function layJournal() {
  const { hits, how, as } = ui.journalQuery ? find(ui.journal, ui.journalQuery, (entry) => textOf(entry.node)) : { hits: ui.journal, how: 'exact' };
  const shown = ui.journalQuery || ui.journalAll ? hits : hits.slice(0, JOURNAL_SHOWN);
  ui.places = { shown, more: hits.length - shown.length, loose: how === 'exact' ? undefined : { how, as } };
}

/**
 * The one thing to tell the user at the bottom of the panel, if any: the
 * most important of what there is to say, as { id, text, button? }.
 */
function noticeOf(state) {
  const { warning } = state;
  const { here, elsewhere } = state.unsynced;
  const settings = (label) => ({ action: 'settings', label });
  const all = [
    // The library is kept nowhere but here (see safety.js in the worker's code).
    warning?.kind === 'sync' && { id: 'sync', text: t('syncFailing', warning.error), button: settings(t('openSettings')) },
    warning?.kind === 'backup' && { id: 'backup', text: t('backupDue'), button: { action: 'backup-now', label: t('unsyncedBackUp') } },
    // Not all of it fits in the synced storage. Of the two things to say, the one about more pages.
    here > 0 && here >= elsewhere && { id: 'here', text: t('unsyncedHere', here), button: settings(t('unsyncedBackUp')) },
    elsewhere > here && { id: 'elsewhere', text: t('unsyncedElsewhere', elsewhere) },
  ];
  const [first] = all.filter(Boolean);
  return first && ui.unsyncedClosed !== first.id ? first : undefined;
}

function take(state, active) {
  ui.library = state.library;
  ui.trouble = state.trouble;
  ui.journal = state.journal;
  ui.notice = noticeOf(state);
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  ui.live = new Set(Object.values(state.binding).map((bound) => bound.node));
  ui.audible = new Set(state.audible);
  ui.dismissed = new Set(state.audible.filter((id) => ui.dismissed.has(id))); // What has stopped playing is no longer sent away: it may play again.
  ui.playingTrees = new Set(Object.values(state.library.trees).filter((tree) => state.audible.some((id) => inTree(tree, id))).map((tree) => tree.id));
  ui.activeId = state.binding[active?.id]?.node;
  ui.activeTree = state.binding[active?.id]?.tree;
}

/** Each pane's rows; panes, selections and the cursor that point at things now gone are let go. */
function layOut() {
  const { library } = ui;
  const cursorWas = { tree: here()?.tree, at: here()?.rows.findIndex((row) => row.id === ui.cursor) ?? -1 }; // Among the rows as they were.
  ui.panes = ui.panes.filter((pane) => library.trees[pane.tree]);
  if (!ui.panes.length) ui.panes = [newPane(Object.keys(library.trees)[0])];
  ui.focus = here();
  if (picker() && !library.trees[picker().tree]) ui.overlay = undefined;
  if (ui.ticking && !ui.panes.some((pane) => pane.tree === ui.ticking.tree)) ui.ticking = undefined;
  for (const pane of [...ui.panes, picker()]) {
    if (!pane) continue;
    const { rows, first, loose, count } = rowsFor(pane);
    Object.assign(pane, { rows, loose, count, first: first ?? rows[0]?.id, holder: holderOf(pane) });
    // While ticking: what is ticked in this pane, what comes with it (all under a ticked node), and what the ticks will mean.
    const ticks = ui.ticking?.tree === pane.tree && pane !== picker() ? ui.ticking.ids : undefined;
    pane.ticks = ticks && { on: ticks, with: new Set([...ticks].flatMap((id) => descendantsOf(library.trees[pane.tree], id))), mode: ui.ticking.mode };
    place(pane);
    pane.sel = new Set([...pane.sel].filter((id) => rowOf(pane, id)));
  }
  // The cursor's row is gone (removed, folded away): the cursor stays where it was, on the row now there. In another tree it starts from the current tab.
  const same = cursorWas.tree === here().tree && cursorWas.at >= 0;
  if (!rowOf(here(), ui.cursor)) ui.cursor = same ? here().rows[Math.min(cursorWas.at, here().rows.length - 1)]?.id : (rowOf(here(), ui.activeId)?.id ?? here().rows[0]?.id);
  if (ui.typing?.id && !rowOf(ui.typing.pane, ui.typing.id)) ui.typing = undefined;
  ui.filtered = filterLine(here());
  if (ui.typing?.what === 'filter' && !(ui.typing.tree === here().tree && ui.filtered?.save)) ui.typing = undefined; // Nothing to save there any more.
}

/**
 * What the bar says of a pane's filter. While nodes are being ticked:
 * { ticking: true, mode, picked, saved } - what the ticks will mean, how
 * many are ticked, and the tree's saved filters to choose from, each
 * { name, mode }: those that still tick something in it. With a filter on:
 * { by, mode, save, shown, of } - what it is called (as it was saved, or
 * else by the ticked nodes), what its ticks mean, and whether it is there
 * to be saved: not saved yet.
 */
function filterLine(pane) {
  const tree = ui.library.trees[pane.tree];
  const saved = ui.saved[pane.tree] ?? [];
  if (ui.ticking?.tree === pane.tree) {
    const still = saved.filter((each) => stillPicked(tree, each.picked).length);
    return { ticking: true, mode: ui.ticking.mode, picked: ui.ticking.ids.size, saved: still.map((each) => ({ name: each.name, mode: modeOf(each) })) };
  }
  const filter = filterNow(pane.tree);
  if (!filter) return undefined;
  const name = savedWith(tree, saved, filter)?.name;
  return { by: name ?? nameFor(filter.picked.map((id) => titleOf(ui.library.nodes[id]))), mode: filter.mode, save: !name, ...pane.count };
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
  const view = { panes: ui.panes.map(({ tree, size }) => ({ tree, size })), split: ui.split, open: ui.open, unsyncedClosed: ui.unsyncedClosed, filters: ui.filters };
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

/**
 * The row that holds the current tab in a pane: where its own row is hidden
 * in a folded branch, the nearest node above it that has a row. A branch
 * never opens by itself: that row says the tab is in it. None when the tab's
 * own row is there, or the tab is not in the pane's tree.
 */
function holderOf(pane) {
  const tree = ui.library.trees[pane.tree];
  if (rowOf(pane, ui.activeId)) return undefined;
  let id = parentOf(tree, ui.activeId);
  while (id !== undefined && !rowOf(pane, id)) id = parentOf(tree, id);
  return id;
}

/** Brings the current tab's row into sight or, where a folded branch hides it, the row that holds it. */
export function revealActive() {
  for (const pane of ui.panes) reveal(pane, holderOf(pane) ?? ui.activeId);
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
