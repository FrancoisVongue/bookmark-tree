// Dragging. Rows are dragged our own way, on pointer events (the browser's
// drag-and-drop swallows the mouse wheel). Drop on a row's middle to make a
// child, on its top or bottom edge to place a sibling, below the tree to make
// a top-level node, on another tree's name in the table of trees to put them
// at the end of that tree. Subtrees come along. Dragging moves: rows dropped
// into another tree leave the one they came from. Rows dropped on the plan
// (the strip at the top) are planned and stay where they are; the plan's
// own entries are dragged within it, to change their order.
//
// A tree is dragged the same way, by its name, to another cell of the table
// of trees. A link dragged in from a page is the browser's own drag (ours
// cannot leave the panel); it shares only the question "where would this land?".

import { descendantsOf } from '../model.js';
import { t } from '../i18n.js';
import { titleOf } from './view.js';
import { app, arrange, idAt, op, paneAt, redraw, rowOf, say, targets, ui } from './screen.js';
import { pagesIn } from './commands.js';

// The gesture in progress, from the button going down to the click after it.
const gesture = {
  // { x, y, id, pane } on a row, { x, y, tree } on a tree's name, { x, y, plan } on an entry of the plan, or { divider } on the line between panes.
  press: undefined,
  pointer: { x: 0, y: 0 },
  unfold: undefined, // A timer: a folded row opens when something is held over it.
  dragged: false, // The button came up after a drag: the click that follows is not a click.
};

/** Whether the click now arriving merely ends a drag. */
export const endsDrag = () => gesture.dragged;

function dropAt(pane, paneEl, y) {
  for (const el of paneEl.querySelectorAll('.row')) {
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

/** The place in the plan to drop rows or one of its own entries at: before the first entry the pointer is above the middle of. */
function planAtPointer() {
  if (!['rows', 'plan'].includes(ui.drag.kind) || !atPointer('.plan')) return;
  const entries = [...app.querySelectorAll('.plan .place')].filter((el) => !ui.drag.ids.includes(el.dataset.node));
  const next = entries.find((el) => gesture.pointer.y < el.getBoundingClientRect().top + el.offsetHeight / 2);
  return { plan: true, before: next?.dataset.node };
}

/** The place in a pane to drop rows or a link at. */
function placeAtPointer() {
  const paneEl = paneElAtPointer();
  const pane = paneEl && ui.panes[paneEl.dataset.pane];
  if (!pane || !['rows', 'link'].includes(ui.drag.kind)) return;
  const drop = dropAt(pane, paneEl, gesture.pointer.y);
  return drop.targetId !== undefined && inDragged(pane, drop.targetId) ? undefined : drop;
}

const same = (a, b) =>
  a?.plan === b?.plan && a?.before === b?.before && a?.cell === b?.cell && a?.pane === b?.pane && a?.targetId === b?.targetId && a?.position === b?.position;

/** Where the dragged thing would land. */
function updateDrop() {
  const drop = cellAtPointer() ?? planAtPointer() ?? placeAtPointer();
  if (same(drop, ui.drop)) return;
  ui.drop = drop;
  clearTimeout(gesture.unfold);
  if (drop?.position === 'inside' && rowOf(drop.pane, drop.targetId).collapsed) {
    gesture.unfold = setTimeout(() => op('collapse', { tree: drop.pane.tree, id: drop.targetId, collapsed: false }), 700);
  }
  redraw();
}

/** Moves the dragged rows to where they were dropped; when that is another tree, says so (with the way back). */
async function moveRows({ ids, from }, { pane, tree = pane.tree, targetId, position = 'end' }) {
  const moved = new Set(ids.flatMap((id) => [id, ...descendantsOf(ui.library.trees[from], id)]));
  await op('move', { tree, from, ids, target: targetId, position, take: true });
  if (tree !== from) say(t('movedTo', ui.library.trees[tree].name, moved.size));
}

/** While dragging: scroll the pane near its top and bottom edges, and follow the wheel. */
function tick() {
  if (!ui.drag) return;
  const paneEl = paneElAtPointer();
  if (paneEl) {
    const rect = paneEl.getBoundingClientRect();
    if (gesture.pointer.y < rect.top + 36) paneEl.scrollTop -= 8;
    else if (gesture.pointer.y > rect.bottom - 36) paneEl.scrollTop += 8;
  }
  updateDrop();
  const ghost = app.querySelector('.ghost');
  if (ghost) ghost.style.transform = `translate(${gesture.pointer.x + 12}px, ${gesture.pointer.y + 8}px)`;
  requestAnimationFrame(tick);
}

function startDrag(drag) {
  ui.drag = drag;
  redraw();
  tick();
}

export function endDrag() {
  clearTimeout(gesture.unfold);
  gesture.press = undefined;
  ui.drag = undefined;
  ui.drop = undefined;
  redraw();
}

/** Dragging the line between two panes gives one more room and the other less. */
function resize(divider) {
  const [before, after] = [ui.panes[divider - 1], ui.panes[divider]];
  const [a, b] = [divider - 1, divider].map((index) => app.querySelector(`.pane[data-pane="${index}"]`).getBoundingClientRect());
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
  const planned = event.target.closest('.plan .place');
  if (event.button === 0 && planned && !event.target.closest('button')) gesture.press = { x: event.clientX, y: event.clientY, plan: planned.dataset.node };
  if (event.button !== 0 || event.target.closest('button, input, .menu, .overlay')) return;
  const divider = event.target.closest('.divider');
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (divider) {
    gesture.press = { divider: Number(divider.dataset.divider) };
    app.setPointerCapture(event.pointerId);
  } else if (id && pane) {
    gesture.press = { x: event.clientX, y: event.clientY, id, pane };
  }
});

addEventListener('pointermove', (event) => {
  const { press } = gesture;
  if (!press) return;
  gesture.pointer = { x: event.clientX, y: event.clientY };
  if (press.divider) return resize(press.divider);
  if (ui.drag || Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) return;
  app.setPointerCapture(event.pointerId); // Keep hearing the pointer outside the panel.
  if (press.tree) return startDrag({ kind: 'tree', tree: press.tree, label: ui.library.trees[press.tree].name });
  if (press.plan) return startDrag({ kind: 'plan', ids: [press.plan], label: titleOf(ui.library.nodes[press.plan]) });
  const ids = targets(press.pane, press.id);
  const title = titleOf(ui.library.nodes[press.id]);
  startDrag({ kind: 'rows', ids, from: press.pane.tree, label: ids.length > 1 ? `${title} +${ids.length - 1}` : title });
});

addEventListener('pointerup', () => {
  const { drag, drop } = ui;
  const resized = gesture.press?.divider;
  gesture.press = undefined;
  if (resized) return arrange(); // Remembers the sizes.
  if (!drag) return;
  endDrag();
  gesture.dragged = true;
  if (!drop) return;
  if (drop.plan) op('plan', { ids: drag.ids, before: drop.before });
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
