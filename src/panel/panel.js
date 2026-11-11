// The panel: asks the worker for the state, shows it, and turns what the user
// does (mouse, keyboard, dragging) into commands for the worker. It never
// changes the library itself; it only owns what is on screen: which trees
// are shown, what is selected, what is being dragged.

import { descendantsOf, rowsOf } from '../model.js';
import { exportTree } from '../ops.js';
import { t } from '../i18n.js';
import { draw, titleOf } from './view.js';

const log = (...args) => console.log('[tree panel]', ...args);
const app = document.getElementById('app');

let windowId;
const kept = JSON.parse(localStorage.getItem('view') ?? '{}');
const newPane = (tree) => ({ tree, rows: [], sel: new Set() });
const ui = {
  library: undefined,
  live: new Set(), // Ids of nodes that have a tab.
  activeId: undefined, // The node of this window's current tab.
  canUndo: false,
  canRedo: false,
  panes: (kept.panes ?? []).map(newPane), // The trees shown, each { tree, rows, sel }.
  focus: 0, // The pane the user works in.
  split: kept.split ?? 'column', // Panes one under another, or 'row': side by side.
  cursor: undefined, // The row the keyboard is on, in the focused pane.
  renaming: undefined, // { id, pane } or { tree }.
  drag: undefined, // { ids, from, label } while rows are dragged.
  drop: undefined, // { pane, targetId, position } where they would land.
  menu: undefined, // { x, y, items }
  picker: undefined, // A pane in a dialog, to choose nodes of another tree.
  iconsFor: undefined, // Ids getting a new icon.
};

const send = (message) => {
  if (message.type !== 'get-state') log('command', message);
  return chrome.runtime.sendMessage(message).catch((error) => log('command failed', message.type, error.message));
};
const op = (name, args) => send({ type: 'op', op: name, args });

const redraw = () => draw(app, ui);
const here = () => ui.panes[ui.focus];
const idAt = (el) => el.closest?.('.row')?.dataset.id;
const paneAt = (el) => {
  const index = el.closest?.('.pane')?.dataset.pane;
  return index === 'picker' ? ui.picker : ui.panes[index];
};
const rowEl = (pane, id) => app.querySelector(`.pane[data-pane="${ui.panes.indexOf(pane)}"] .row[data-id="${id}"]`);
const rowOf = (pane, id) => pane.rows.find((row) => row.id === id);
/** What an action on row `id` applies to: the whole selection if the row is part of it. */
const targets = (pane, id) => (pane.sel.has(id) ? pane.rows.filter((row) => pane.sel.has(row.id)).map((row) => row.id) : [id]);

let shownTree;
let shownActive;
let generation = 0;
async function refresh() {
  const current = ++generation;
  const [state, [active]] = await Promise.all([
    send({ type: 'get-state' }),
    chrome.tabs.query({ active: true, windowId }).catch(() => []),
  ]);
  if (current !== generation || !state) return;
  const { library } = state;
  ui.library = library;
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  ui.live = new Set(Object.values(state.binding).map((bound) => bound.node));
  ui.activeId = state.binding[active?.id]?.node;

  ui.panes = ui.panes.filter((pane) => library.trees[pane.tree]);
  if (!ui.panes.length) ui.panes = [newPane(Object.keys(library.trees)[0])];
  ui.focus = Math.min(ui.focus, ui.panes.length - 1);
  if (ui.picker && !library.trees[ui.picker.tree]) ui.picker = undefined;
  for (const pane of [...ui.panes, ui.picker]) {
    if (!pane) continue;
    pane.rows = rowsOf(library, pane.tree);
    pane.sel = new Set([...pane.sel].filter((id) => rowOf(pane, id)));
  }
  if (!rowOf(here(), ui.cursor)) ui.cursor = rowOf(here(), ui.activeId)?.id ?? here().rows[0]?.id;
  if (ui.renaming?.id && !rowOf(ui.renaming.pane, ui.renaming.id)) ui.renaming = undefined;

  localStorage.setItem('view', JSON.stringify({ panes: ui.panes.map((pane) => pane.tree), split: ui.split }));
  if (shownTree !== here().tree) {
    shownTree = here().tree;
    send({ type: 'show-tree', windowId, treeId: shownTree });
  }
  redraw();

  // Keep the current tab's row in sight, and the keyboard on the tree.
  if (ui.activeId !== shownActive) {
    shownActive = ui.activeId;
    for (const pane of ui.panes) rowEl(pane, ui.activeId)?.scrollIntoView({ block: 'nearest' });
  }
  const busy = ui.renaming || ui.picker || ui.iconsFor || ui.menu;
  if (!busy && !app.contains(document.activeElement)) rowEl(here(), ui.cursor)?.focus({ preventScroll: true });
}

function setFocus(pane) {
  const index = ui.panes.indexOf(pane);
  if (index === -1 || index === ui.focus) return;
  for (const other of ui.panes) other.sel.clear();
  ui.focus = index;
  ui.cursor = undefined;
}

function focusRow(pane, id) {
  if (id === undefined) return;
  ui.cursor = id;
  redraw();
  rowEl(pane, id)?.focus();
}

// --- Commands ------------------------------------------------------------------

const activate = (pane, id) => send({ type: 'activate', nodeId: id, treeId: pane.tree, windowId });
const newTab = (pane, id, as) => send({ type: 'new-tab', windowId, treeId: pane.tree, nodeId: id, as });

async function newNote(pane, target) {
  const id = crypto.randomUUID();
  await op('note-add', { tree: pane.tree, id, target, position: 'inside' });
  activate(pane, id);
}

async function newTree() {
  const id = crypto.randomUUID();
  await op('tree-add', { id, name: t('newTree') });
  here().tree = id;
  ui.renaming = { tree: id };
  await refresh();
  focusRename();
}

function download(treeId) {
  const data = exportTree(ui.library, treeId);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = `${data.tree.name}.tree.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function upload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!data.nodes || !data.tree?.children) throw new Error('not a tree file');
      const id = crypto.randomUUID();
      await op('import', { id, data });
      here().tree = id;
      refresh();
    } catch (error) {
      log('import failed', error.message);
    }
  };
  input.click();
}

// --- Renaming ------------------------------------------------------------------

function focusRename() {
  const input = app.querySelector('.rename');
  input?.focus();
  input?.select();
}

function startRename(what) {
  ui.renaming = what;
  redraw();
  focusRename();
}

function endRename(save) {
  const renaming = ui.renaming;
  if (!renaming) return;
  const name = app.querySelector('.rename')?.value ?? '';
  ui.renaming = undefined;
  redraw();
  if (renaming.tree) {
    if (save) op('tree-rename', { tree: renaming.tree, name });
    return;
  }
  // Typing the page's own title back means "no name of my own".
  const node = ui.library.nodes[renaming.id];
  if (save && name !== titleOf(node)) op('rename', { id: renaming.id, name: name === node.title ? '' : name });
  rowEl(renaming.pane, renaming.id)?.focus();
}

app.addEventListener('focusout', (event) => {
  if (event.target.closest?.('.rename')) endRename(true);
});

// --- Menus ---------------------------------------------------------------------

const item = (label, run, hint, disabled = false) => ({ label: t(label), hint, disabled, run });

function openMenu(x, y, items) {
  const run = (entry) => () => {
    ui.menu = undefined;
    redraw();
    entry.run();
  };
  ui.menu = { x, y, items: items.filter((entry) => entry !== false && entry !== undefined).map((entry) => entry && { ...entry, run: run(entry) }) };
  redraw();
  // Keep it on screen.
  const el = app.querySelector('.menu');
  const box = el.getBoundingClientRect();
  ui.menu.x = Math.max(4, Math.min(x, innerWidth - box.width - 4));
  ui.menu.y = Math.max(4, Math.min(y, innerHeight - box.height - 4));
  redraw();
}

/** Whether any of the nodes, or anything under them, has a tab. */
const anyLive = (pane, ids) =>
  ids.some((id) => ui.live.has(id) || descendantsOf(ui.library.trees[pane.tree], id).some((kid) => ui.live.has(kid)));

const hasOtherTrees = () => Object.keys(ui.library.trees).length > 1;

/**
 * Opens the picker: another tree, to choose nodes from. They will be shown in
 * `pane`'s tree too: under row `id`, or at the end of the tree without one.
 */
function openPicker(pane, id) {
  const other = Object.keys(ui.library.trees).find((treeId) => treeId !== pane.tree);
  ui.picker = { ...newPane(other), into: { pane, id } };
  refresh();
}

function rowMenu(pane, id) {
  const ids = targets(pane, id);
  const node = ui.library.nodes[id];
  const tree = pane.tree;
  return [
    item('newChild', () => newTab(pane, id, 'child'), 'Ctrl+Shift+Enter'),
    item('newSibling', () => newTab(pane, id, 'sibling'), 'Ctrl+Enter'),
    item('newNote', () => newNote(pane, id)),
    null,
    item('rename', () => startRename({ id, pane }), 'F2'),
    item('changeIcon', () => ((ui.iconsFor = ids), redraw())),
    item('duplicate', () => op('duplicate', { tree, ids }), 'Ctrl+D'),
    node.note === undefined && item(node.home ? 'unpin' : 'pin', () => op('pin', { ids, pinned: !node.home })),
    node.home && node.url !== node.home.url && item('goHome', () => send({ type: 'go-home', nodeId: id })),
    null,
    item('indent', () => op('indent', { tree, ids }), 'Tab'),
    item('outdent', () => op('outdent', { tree, ids }), 'Shift+Tab'),
    null,
    item('addFromTreeHere', () => openPicker(pane, id), '', !hasOtherTrees()),
    null,
    item('sleepShort', () => send({ type: 'sleep', ids, treeId: tree }), '', !anyLive(pane, ids)),
    item('remove', () => op('remove', { tree, ids }), 'Del'),
    item('deleteEverywhere', () => op('delete', { ids }), 'Shift+Del'),
  ];
}

function treeMenu(treeId) {
  return [
    item('rename', () => startRename({ tree: treeId })),
    item('openBeside', () => {
      ui.panes.push(newPane(treeId));
      refresh();
    }),
    item('exportTree', () => download(treeId)),
    null,
    item('deleteTree', () => op('tree-remove', { tree: treeId }), '', Object.keys(ui.library.trees).length < 2),
  ];
}

function mainMenu() {
  return [
    item('undo', () => send({ type: 'undo' }), 'Ctrl+Z', !ui.canUndo),
    item('redo', () => send({ type: 'redo' }), 'Ctrl+Shift+Z', !ui.canRedo),
    null,
    item('newNote', () => newNote(here())),
    item('addFromTree', () => openPicker(here()), '', !hasOtherTrees()),
    ui.panes.length > 1 &&
      item(ui.split === 'row' ? 'splitColumn' : 'splitRow', () => {
        ui.split = ui.split === 'row' ? 'column' : 'row';
        refresh();
      }),
    null,
    item('importTree', upload),
    item('exportTree', () => download(here().tree)),
  ];
}

app.addEventListener('contextmenu', (event) => {
  if (event.target.closest('input')) return;
  event.preventDefault();
  const pane = paneAt(event.target);
  const id = idAt(event.target);
  const treeId = event.target.closest('.tab[data-tree]')?.dataset.tree;
  if (treeId) return openMenu(event.clientX, event.clientY, treeMenu(treeId));
  if (!pane || pane === ui.picker) return;
  setFocus(pane);
  if (!id) return openMenu(event.clientX, event.clientY, mainMenu());
  if (!pane.sel.has(id)) pane.sel = new Set([id]);
  ui.cursor = id;
  openMenu(event.clientX, event.clientY, rowMenu(pane, id));
});

addEventListener(
  'pointerdown',
  (event) => {
    if (!ui.menu || event.target.closest?.('.menu')) return;
    ui.menu = undefined;
    redraw();
  },
  true,
);

// --- Mouse ---------------------------------------------------------------------

function select(pane, id, event) {
  if (pane === ui.picker) {
    if (!pane.sel.delete(id)) pane.sel.add(id);
  } else if (event.ctrlKey || event.metaKey) {
    if (!pane.sel.delete(id)) pane.sel.add(id);
  } else if (event.shiftKey && rowOf(pane, ui.cursor)) {
    const ids = pane.rows.map((row) => row.id);
    const [from, to] = [ids.indexOf(ui.cursor), ids.indexOf(id)].sort((a, b) => a - b);
    pane.sel = new Set(ids.slice(from, to + 1));
    return; // The cursor stays: it is the anchor of the range.
  } else {
    pane.sel = new Set([id]);
  }
  ui.cursor = id;
}

const closeOverlay = () => {
  ui.picker = undefined;
  ui.iconsFor = undefined;
  redraw();
};

const actions = {
  collapse: ({ pane, id }) => op('collapse', { tree: pane.tree, id, collapsed: !rowOf(pane, id).collapsed }),
  sleep: ({ pane, id }) => send({ type: 'sleep', ids: targets(pane, id), treeId: pane.tree }),
  remove: ({ pane, id }) => op('remove', { tree: pane.tree, ids: targets(pane, id) }),
  home: ({ id }) => send({ type: 'go-home', nodeId: id }),
  'new-tab': ({ pane }) => newTab(pane),
  'tree-show': ({ el }) => {
    here().tree = el.dataset.tree;
    here().sel.clear();
    refresh();
  },
  'tree-add': newTree,
  'pane-close': ({ pane }) => {
    ui.panes.splice(ui.panes.indexOf(pane), 1);
    ui.focus = 0;
    refresh();
  },
  more: ({ el }) => {
    const box = el.getBoundingClientRect();
    openMenu(box.right, box.bottom, mainMenu());
  },
  'picker-tree': ({ el }) => {
    ui.picker = { ...newPane(el.dataset.tree), into: ui.picker.into };
    refresh();
  },
  'picker-add': () => {
    const { pane, id } = ui.picker.into;
    op('move', { tree: pane.tree, from: ui.picker.tree, ids: [...ui.picker.sel], target: id, position: id ? 'inside' : 'end' });
    if (id) op('collapse', { tree: pane.tree, id, collapsed: false }); // So what was added is seen.
    closeOverlay();
  },
  icon: ({ el }) => {
    op('icon', { ids: ui.iconsFor, icon: el.dataset.icon });
    closeOverlay();
  },
  'overlay-close': closeOverlay,
};

let justDragged = false;
app.addEventListener('click', (event) => {
  if (justDragged || event.target.closest('input, .menu')) return;
  const el = event.target.closest('[data-action]');
  const pane = paneAt(event.target);
  const id = idAt(event.target);
  if (pane) setFocus(pane);
  // A click inside a dialog lands on the overlay behind it too: that is not "close".
  if (el && !(el.dataset.action === 'overlay-close' && event.target !== el)) {
    return actions[el.dataset.action]?.({ pane, id, el, event });
  }
  if (!id) return;
  select(pane, id, event);
  redraw();
  if (pane !== ui.picker && !event.ctrlKey && !event.metaKey && !event.shiftKey) activate(pane, id);
});

app.addEventListener('dblclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  const treeId = event.target.closest('.bar .tab[data-tree]')?.dataset.tree;
  if (treeId) startRename({ tree: treeId });
  else if (id && pane !== ui.picker && event.target.closest('.title')) startRename({ id, pane });
});

// Middle click closes the tab, as in the tab strip: the node stays, asleep.
// On a node already asleep it removes the node from the tree.
app.addEventListener('auxclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (!id || event.button !== 1 || pane === ui.picker) return;
  if (ui.live.has(id)) send({ type: 'sleep-one', nodeId: id });
  else op('remove', { tree: pane.tree, ids: [id] });
});

// --- Keyboard ------------------------------------------------------------------

addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.target.closest?.('.rename')) {
    if (event.key === 'Enter') endRename(true);
    else if (event.key === 'Escape') endRename(false);
    return;
  }
  if (event.key === 'Escape') {
    if (ui.drag) endDrag();
    ui.menu = undefined;
    return closeOverlay();
  }
  if (ctrl && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    return send({ type: event.shiftKey ? 'redo' : 'undo' });
  }
  if (ctrl && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    return send({ type: 'redo' });
  }

  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (!id || !pane || pane === ui.picker) return;
  const tree = pane.tree;
  const ids = targets(pane, id);
  const index = pane.rows.findIndex((row) => row.id === id);
  const row = pane.rows[index];
  const go = (to) => {
    if (!to) return;
    if (event.shiftKey) pane.sel = new Set([...pane.sel, id, to.id]);
    else pane.sel.clear();
    focusRow(pane, to.id);
  };
  const keys = {
    ArrowDown: () => go(pane.rows[index + 1]),
    ArrowUp: () => go(pane.rows[index - 1]),
    Home: () => go(pane.rows[0]),
    End: () => go(pane.rows.at(-1)),
    ArrowRight: () => {
      if (row.collapsed) op('collapse', { tree, id, collapsed: false });
      else if (row.kids) go(pane.rows[index + 1]);
    },
    ArrowLeft: () => {
      if (row.kids && !row.collapsed) op('collapse', { tree, id, collapsed: true });
      else go(pane.rows.slice(0, index).findLast((above) => above.depth < row.depth));
    },
    Enter: () => {
      if (ctrl) newTab(pane, id, event.shiftKey ? 'child' : 'sibling');
      else activate(pane, id);
    },
    ' ': () => activate(pane, id),
    Delete: () => (event.shiftKey ? op('delete', { ids }) : op('remove', { tree, ids })),
    F2: () => startRename({ id, pane }),
    Tab: () => op(event.shiftKey ? 'outdent' : 'indent', { tree, ids }),
    d: () => ctrl && op('duplicate', { tree, ids }),
    a: () => ctrl && ((pane.sel = new Set(pane.rows.map((each) => each.id))), redraw()),
  };
  const key = keys[event.key] ?? keys[event.key.toLowerCase()];
  if (!key || (event.key.length === 1 && event.key !== ' ' && !ctrl)) return;
  event.preventDefault();
  key();
});

// --- Dragging ------------------------------------------------------------------
// Our own, on pointer events (the browser's drag-and-drop swallows the mouse
// wheel). Drop on a row's middle to make a child, on its top or bottom edge
// to place a sibling, below the tree to make a top-level node. Subtrees come
// along; dropping into a pane that shows another tree shows the nodes there too.

let press; // Where the button went down: { x, y, id, pane }.
let pointer = { x: 0, y: 0 };

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
  const at = pane.rows.findIndex((row) => row.id === id);
  return ui.drag.ids.some((dragId) => {
    const from = pane.rows.findIndex((row) => row.id === dragId);
    if (from === -1 || at < from) return false;
    return pane.rows.slice(from + 1, at + 1).every((row) => row.depth > pane.rows[from].depth);
  });
}

function updateDrop() {
  const paneEl = document.elementFromPoint(pointer.x, pointer.y)?.closest('.panes .pane');
  const pane = paneEl && ui.panes[paneEl.dataset.pane];
  let drop = pane && dropAt(pane, paneEl, pointer.y);
  if (drop?.targetId !== undefined && pane.tree === ui.drag.from && inDragged(pane, drop.targetId)) drop = undefined;
  if (drop?.pane === ui.drop?.pane && drop?.targetId === ui.drop?.targetId && drop?.position === ui.drop?.position) return;
  ui.drop = drop;
  redraw();
}

/** While dragging: scroll the pane near its top and bottom edges, and follow the wheel. */
function dragTick() {
  if (!ui.drag) return;
  const paneEl = document.elementFromPoint(pointer.x, pointer.y)?.closest('.panes .pane');
  if (paneEl) {
    const rect = paneEl.getBoundingClientRect();
    if (pointer.y < rect.top + 36) paneEl.scrollTop -= 8;
    else if (pointer.y > rect.bottom - 36) paneEl.scrollTop += 8;
  }
  updateDrop();
  const ghost = app.querySelector('.ghost');
  if (ghost) ghost.style.transform = `translate(${pointer.x + 12}px, ${pointer.y + 8}px)`;
  requestAnimationFrame(dragTick);
}

function endDrag() {
  press = undefined;
  ui.drag = undefined;
  ui.drop = undefined;
  redraw();
}

app.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, input, .menu, .overlay')) return;
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (id && pane) press = { x: event.clientX, y: event.clientY, id, pane };
});

addEventListener('pointermove', (event) => {
  if (!press) return;
  pointer = { x: event.clientX, y: event.clientY };
  if (ui.drag || Math.hypot(pointer.x - press.x, pointer.y - press.y) < 5) return;
  const ids = targets(press.pane, press.id);
  const title = titleOf(ui.library.nodes[press.id]);
  ui.drag = { ids, from: press.pane.tree, label: ids.length > 1 ? `${title} +${ids.length - 1}` : title };
  app.setPointerCapture(event.pointerId); // Keep hearing the pointer outside the panel.
  redraw();
  dragTick();
});

addEventListener('pointerup', () => {
  const { drag, drop } = ui;
  press = undefined;
  if (!drag) return;
  endDrag();
  // The click that follows this release is not a click on a row.
  justDragged = true;
  setTimeout(() => (justDragged = false));
  if (drop) {
    op('move', { tree: drop.pane.tree, from: drag.from, ids: drag.ids, target: drop.targetId, position: drop.position });
  }
});

addEventListener('pointercancel', endDrag);

// --- Start ---------------------------------------------------------------------

async function main() {
  windowId = (await chrome.windows.getCurrent()).id;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'changed') refresh();
  });
  chrome.tabs.onActivated.addListener((info) => info.windowId === windowId && refresh());
  await refresh();
  log('ready, window', windowId, '|', ui.panes.map((pane) => `${pane.tree}: ${pane.rows.length} rows`).join(', '));
}

main();
