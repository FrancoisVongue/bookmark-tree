// Dragging. Rows are dragged our own way, on pointer events (the browser's
// drag-and-drop swallows the mouse wheel). Drop on a row's middle to make a
// child, on its top or bottom edge to place a sibling, below the tree to make
// a top-level node, on another tree's name in the table of trees to put them
// at the end of that tree. Subtrees come along. Dragging moves: rows dropped
// into another tree leave the one they came from. Rows dropped on a list
// kept at hand - the plan (the strip at the top), the quick row of their
// own tree - are put into it and stay where they are; a list's own entries
// are dragged within it, to change their order.
//
// While rows are ticked for the filter they are not dragged: a press on a
// row ticks it (or unticks it), and the rows the pointer then passes over,
// button held, take the same - ticks are swept on like paint.
//
// A tree is dragged the same way, by its name, to another cell of the table
// of trees. A link dragged in from a page is the browser's own drag (ours
// cannot leave the panel); it shares only the question "where would this land?".

import { descendantsOf } from '../model.js';
import { t } from '../i18n.js';
import { titleOf } from './view.js';
import { setStripHeight, app, arrange, idAt, op, paneAt, paneEl, redraw, rowOf, rowUnder, say, setDrag, setDrop, setFocus, targets, tickRow, tickTo, ui } from './screen.js';
import { pagesIn, plannable } from './commands.js';

// The gesture in progress, from the button going down to the click after it.
const gesture = {
  // { x, y, id, pane } on a row, { x, y, tree } on a tree's name, { x, y, entry, list, pane } on an entry of a list kept at hand, or { divider } on the line between panes.
  // On a row while ticking for the filter: { x, y, sweep: { pane, on, going } } - the rows passed take the tick the first one got (`on`); `going` once the pointer has moved.
  press: undefined,
  pointer: { x: 0, y: 0 },
  unfold: undefined, // A timer: a folded row opens when something is held over it.
  dragged: false, // The button came up after a drag, or went down to tick a row: the click that follows is not a click.
};

/** Whether the click now arriving merely ends a drag, or a press that ticked. */
export const endsDrag = () => gesture.dragged;

function dropAt(pane, within, y) {
  for (const el of within.querySelectorAll('.row')) {
    const rect = el.getBoundingClientRect();
    if (y >= rect.bottom) continue;
    const row = rowOf(pane, el.dataset.id);
    const ratio = (y - rect.top) / rect.height;
    if (ratio < 0.25) return { pane, targetId: row.id, position: 'before' };
    if (ratio <= 0.75) return { pane, targetId: row.id, position: 'inside' };
    // Between an open parent and its first child means "first child".
    return { pane, targetId: row.id, position: row.kids && !row.collapsed ? 'first' : 'after' };
  }
  return { pane, targetId: undefined, position: 'end' };
}

/** Whether row `id` is one of the dragged rows or under one (where they can't be dropped). */
function inDragged(pane, id) {
  if (ui.drag.kind !== 'rows' || pane.tree !== ui.drag.from) return false;
  const at = pane.rows.findIndex((row) => row.id === id);
  return ui.drag.ids.some((dragId) => {
    const from = pane.rows.findIndex((row) => row.id === dragId);
    if (from === -1 || at < from) return false;
    return pane.rows.slice(from + 1, at + 1).every((row) => row.depth > pane.rows[from].depth);
  });
}

const atPointer = (selector) => document.elementFromPoint(gesture.pointer.x, gesture.pointer.y)?.closest(selector);
const paneElAtPointer = () => atPointer('.panes .pane');

/** The cell of the table of trees to drop on: any cell for a tree, the cell of another tree for rows. */
function cellAtPointer() {
  const el = ['rows', 'tree'].includes(ui.drag.kind) && atPointer('.grid [data-cell]');
  if (!el) return;
  const { cell, tree } = el.dataset;
  if (ui.drag.kind === 'rows' && (!tree || tree === ui.drag.from)) return;
  return { cell: Number(cell), tree };
}

/**
 * The place in a list kept at hand to drop rows or one of its own entries
 * at: before the first entry the pointer has not passed the middle of
 * (down the plan, along a quick row). Over a list that would take nothing of
 * what is dragged - false: it lands nowhere, not in the tree under the list.
 */
function listAtPointer() {
  const el = atPointer('[data-list]');
  if (!el || !['rows', 'entry'].includes(ui.drag.kind)) return;
  const { list } = el.dataset;
  const pane = paneAt(el);
  // The plan takes pages that can be planned; a quick row, nodes of its own tree. An entry stays in its list.
  const fits = list === 'plan' ? ui.drag.plan.length : pane.tree === ui.drag.from;
  if (!fits || (ui.drag.kind === 'entry' && ui.drag.list !== list)) return false;
  const [at, start, size] = list === 'plan' ? [gesture.pointer.y, 'top', 'height'] : [gesture.pointer.x, 'left', 'width'];
  const entries = [...el.querySelectorAll('[data-entry]')].filter((entry) => !ui.drag.ids.includes(entry.dataset.entry));
  const next = entries.find((entry) => at < entry.getBoundingClientRect()[start] + entry.getBoundingClientRect()[size] / 2);
  return { list, pane, before: next?.dataset.entry };
}

/** The place in a pane to drop rows or a link at. */
function placeAtPointer() {
  const el = paneElAtPointer();
  const pane = el && paneAt(el);
  if (!pane || !['rows', 'link'].includes(ui.drag.kind)) return;
  const drop = dropAt(pane, el, gesture.pointer.y);
  return drop.targetId !== undefined && inDragged(pane, drop.targetId) ? undefined : drop;
}

const same = (a, b) =>
  a?.list === b?.list && a?.before === b?.before && a?.cell === b?.cell && a?.pane === b?.pane && a?.targetId === b?.targetId && a?.position === b?.position;

/** Where the dragged thing would land. */
function updateDrop() {
  const drop = (cellAtPointer() ?? listAtPointer() ?? placeAtPointer()) || undefined;
  if (same(drop, ui.drop)) return;
  setDrop(drop);
  clearTimeout(gesture.unfold);
  if (drop?.position === 'inside' && rowOf(drop.pane, drop.targetId).collapsed) {
    gesture.unfold = setTimeout(() => op('collapse', { tree: drop.pane.tree, id: drop.targetId, collapsed: false }), 700);
  }
}

/** Moves the dragged rows to where they were dropped; when that is another tree, says so (with the way back). */
async function moveRows({ ids, from }, { pane, tree = pane.tree, targetId, position = 'end' }) {
  const moved = new Set(ids.flatMap((id) => [id, ...descendantsOf(ui.library.trees[from], id)]));
  await op('move', { tree, from, ids, target: targetId, position, take: true });
  if (tree !== from) say(t('movedTo', ui.library.trees[tree].name, moved.size), true);
}

/** Scrolls a pane while the pointer is near its top or bottom edge. */
function scrollAtEdge(el) {
  const rect = el.getBoundingClientRect();
  if (gesture.pointer.y < rect.top + 36) el.scrollTop -= 8;
  else if (gesture.pointer.y > rect.bottom - 36) el.scrollTop += 8;
}

/** While dragging: scroll the pane near its top and bottom edges, and follow the wheel. */
function tick() {
  if (!ui.drag) return;
  const el = paneElAtPointer();
  if (el) scrollAtEdge(el);
  updateDrop();
  const ghost = app.querySelector('.ghost');
  // (Kept inside the panel: near the right edge the label stays whole and the pointer runs along it.)
  if (ghost) ghost.style.transform = `translate(${Math.min(gesture.pointer.x + 12, innerWidth - ghost.offsetWidth - 4)}px, ${gesture.pointer.y + 8}px)`;
  requestAnimationFrame(tick);
}

/**
 * While sweeping ticks on: the row the pointer is at now takes the tick,
 * with every row since the one ticked last (see tickTo), so a fast pointer
 * skips none; the pane scrolls at its edges as it does under dragged rows.
 * The row is found by where it stands, not in the page: only rows in sight
 * are there.
 */
function sweep() {
  const { pane, on } = gesture.press?.sweep ?? {};
  const el = pane && ui.ticking && paneEl(pane);
  if (!el) return;
  scrollAtEdge(el);
  const row = rowUnder(pane, gesture.pointer.y);
  if (row && row.id !== ui.ticking.anchor) tickTo(pane, row.id, on);
  requestAnimationFrame(sweep);
}

function startDrag(drag) {
  setDrag(drag);
  tick();
}

export function endDrag() {
  clearTimeout(gesture.unfold);
  gesture.press = undefined;
  setDrag(undefined);
}

/** Dragging the line between two panes gives one more room and the other less. */
function resize(divider) {
  const [before, after] = [ui.panes[divider - 1], ui.panes[divider]];
  const [a, b] = [before, after].map((pane) => paneEl(pane).getBoundingClientRect());
  const { x, y } = gesture.pointer;
  const along = ui.split === 'row' ? (x - a.left) / (b.right - a.left) : (y - a.top) / (b.bottom - a.top);
  const share = Math.max(0.1, Math.min(0.9, along));
  const total = before.size + after.size;
  [before.size, after.size] = [total * share, total * (1 - share)];
  redraw();
}

app.addEventListener('pointerdown', (event) => {
  gesture.dragged = false;
  const tab = event.target.closest('.grid .tab[data-tree]');
  if (event.button === 0 && tab) gesture.press = { x: event.clientX, y: event.clientY, tree: tab.dataset.tree };
  // An entry of a list kept at hand is dragged by all of it but its own small button.
  const entry = event.target.closest('[data-list] [data-entry]');
  if (event.button === 0 && entry && !event.target.closest('.act')) {
    gesture.press = { x: event.clientX, y: event.clientY, entry: entry.dataset.entry, list: entry.closest('[data-list]').dataset.list, pane: paneAt(entry) };
  }
  if (event.button !== 0 || event.target.closest('button, input, .menu, .overlay')) return;
  const divider = event.target.closest('.divider');
  const grip = event.target.closest('.grip');
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (divider) {
    gesture.press = { divider: Number(divider.dataset.divider) };
    app.setPointerCapture(event.pointerId);
  } else if (grip) {
    // The edge of an unfolded strip: dragging it makes the strip taller or lower. (`from`: the pointer and the height at the press.)
    gesture.press = { grip: grip.dataset.grip, from: { y: event.clientY, height: grip.parentElement.offsetHeight } };
    app.setPointerCapture(event.pointerId);
  } else if (id && pane && ui.ticking) {
    // Ticking for the filter: the press itself ticks, and nothing is dragged - in the tree being ticked or beside it.
    if (ui.ticking.tree !== pane.tree) return;
    gesture.dragged = true;
    setFocus(pane);
    tickRow(pane, id, event.shiftKey);
    if (!event.shiftKey) gesture.press = { x: event.clientX, y: event.clientY, sweep: { pane, on: ui.ticking.ids.has(id) } };
  } else if (id && pane) {
    gesture.press = { x: event.clientX, y: event.clientY, id, pane };
  }
});

addEventListener('pointermove', (event) => {
  const { press } = gesture;
  if (!press) return;
  gesture.pointer = { x: event.clientX, y: event.clientY };
  if (press.divider) return resize(press.divider);
  // The journal's edge is its top (up is taller); the plan, at the top of the panel, has its edge at the bottom.
  if (press.grip) return setStripHeight(press.grip, press.from.height + (press.grip === 'plan' ? 1 : -1) * (event.clientY - press.from.y));
  if (ui.drag || press.sweep?.going || Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) return;
  app.setPointerCapture(event.pointerId); // Keep hearing the pointer outside the panel.
  if (press.sweep) return (press.sweep.going = true), sweep();
  if (press.tree) return startDrag({ kind: 'tree', tree: press.tree, label: ui.library.trees[press.tree].name });
  if (press.entry) return startDrag({ kind: 'entry', list: press.list, from: press.pane?.tree, ids: [press.entry], plan: press.list === 'plan' ? [press.entry] : [], label: titleOf(ui.library.nodes[press.entry]) });
  const ids = targets(press.pane, press.id);
  const title = titleOf(ui.library.nodes[press.id]);
  // (`plan`: those of them the plan would take.)
  startDrag({ kind: 'rows', ids, from: press.pane.tree, plan: plannable(ids), label: ids.length > 1 ? `${title} +${ids.length - 1}` : title });
});

addEventListener('pointerup', () => {
  const { drag, drop } = ui;
  const resized = gesture.press?.divider || gesture.press?.grip;
  gesture.press = undefined;
  if (resized) return arrange(); // Remembers the sizes.
  if (!drag) return;
  endDrag();
  gesture.dragged = true;
  if (!drop) return;
  if (drop.list === 'plan') op('plan', { ids: drag.plan, before: drop.before });
  else if (drop.list === 'quick') op('quick', { tree: drop.pane.tree, ids: drag.ids, before: drop.before });
  else if (drag.kind === 'tree') op('grid-move', { tree: drag.tree, cell: drop.cell });
  else moveRows(drag, drop);
});

addEventListener('pointercancel', endDrag);

// A link from a page lands as a sleeping page where it is dropped.
app.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('text/uri-list')) return;
  event.preventDefault();
  gesture.pointer = { x: event.clientX, y: event.clientY };
  if (!ui.drag) startDrag({ kind: 'link' });
});
app.addEventListener('dragleave', (event) => {
  if (ui.drag?.kind === 'link' && !app.contains(event.relatedTarget)) endDrag();
});
app.addEventListener('drop', (event) => {
  if (ui.drag?.kind !== 'link') return;
  const { drop } = ui;
  const nodes = pagesIn(event.dataTransfer.getData('text/uri-list'));
  event.preventDefault();
  endDrag();
  if (drop && nodes.length) op('add', { tree: drop.pane.tree, nodes, target: drop.targetId, position: drop.position });
});
