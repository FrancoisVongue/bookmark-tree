// The panel: asks the worker for the state, shows it, and turns what the user
// does (mouse, keyboard, dragging) into commands for the worker. It never
// changes the library itself; it only owns what is on screen: which trees
// are shown, what is selected, searched for or being dragged.

import { descendantsOf, rowsOf } from '../model.js';
import { exportTree } from '../ops.js';
import { t } from '../i18n.js';
import { draw, isGroup, isNote, titleOf } from './view.js';

const log = (...args) => console.log('[tree panel]', ...args);
const app = document.getElementById('app');

let windowId;
const kept = JSON.parse(localStorage.getItem('view') ?? '{}');
const newPane = (tree, size = 1) => ({ tree, size, rows: [], sel: new Set() });
const ui = {
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
  drag: undefined, // { ids, from, label } while rows (or a link from a page) are dragged.
  drop: undefined, // { pane, targetId, position } where they would land.
  menu: undefined, // { x, y, items }
  picker: undefined, // A pane in a dialog, to choose nodes of another tree.
  iconsFor: undefined, // Ids getting a new icon.
  dialog: undefined, // 'trash' or 'keys'.
  toast: undefined, // What was just removed, with a way back.
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
const under = (pane, id) => descendantsOf(ui.library.trees[pane.tree], id);
/** What an action on row `id` applies to: the whole selection if the row is part of it. */
const targets = (pane, id) => (pane.sel.has(id) ? pane.rows.filter((row) => pane.sel.has(row.id)).map((row) => row.id) : [id]);
/** The same, plus what collapsed rows hide: a folded branch is handled as one thing. */
const branches = (pane, id) => targets(pane, id).flatMap((each) => (rowOf(pane, each)?.collapsed ? [each, ...under(pane, each)] : [each]));

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
  library.trash ??= [];
  ui.library = library;
  ui.canUndo = state.canUndo;
  ui.canRedo = state.canRedo;
  ui.live = new Set(Object.values(state.binding).map((bound) => bound.node));
  ui.audible = new Set(state.audible);
  ui.activeId = state.binding[active?.id]?.node;

  ui.panes = ui.panes.filter((pane) => library.trees[pane.tree]);
  if (!ui.panes.length) ui.panes = [newPane(Object.keys(library.trees)[0])];
  ui.focus = Math.min(ui.focus, ui.panes.length - 1);
  if (ui.picker && !library.trees[ui.picker.tree]) ui.picker = undefined;
  for (const pane of [...ui.panes, ui.picker]) {
    if (!pane) continue;
    const searching = ui.query && pane !== ui.picker;
    pane.rows = searching ? found(rowsOf(library, pane.tree, true), ui.query) : rowsOf(library, pane.tree);
    pane.sel = new Set([...pane.sel].filter((id) => rowOf(pane, id)));
  }
  if (!rowOf(here(), ui.cursor)) ui.cursor = rowOf(here(), ui.activeId)?.id ?? here().rows[0]?.id;
  if (ui.renaming?.id && !rowOf(ui.renaming.pane, ui.renaming.id)) ui.renaming = undefined;

  // Which nodes sit in more than one tree, and where else.
  const homes = new Map();
  for (const tree of Object.values(library.trees)) {
    for (const id of Object.values(tree.children).flat()) homes.set(id, [...(homes.get(id) ?? []), tree]);
  }
  ui.shared = new Map();
  for (const pane of ui.panes) {
    for (const { id } of pane.rows) {
      const others = homes.get(id).filter((tree) => tree.id !== pane.tree);
      if (others.length) ui.shared.set(id, others.map((tree) => tree.name));
    }
  }

  const view = { panes: ui.panes.map(({ tree, size }) => ({ tree, size })), split: ui.split };
  localStorage.setItem('view', JSON.stringify(view));
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
  const busy = ui.renaming || ui.picker || ui.iconsFor || ui.dialog || ui.menu;
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

const activate = (pane, id, where) => send({ type: 'activate', nodeId: id, treeId: pane.tree, windowId, where });
const newTab = (pane, id, as) => send({ type: 'new-tab', windowId, treeId: pane.tree, nodeId: id, as });
const toggle = (pane, id) => op('collapse', { tree: pane.tree, id, collapsed: !rowOf(pane, id).collapsed });

/** Clicking a node goes to its page. A group has no page: it folds and unfolds. */
function open(pane, id) {
  if (!isGroup(ui.library.nodes[id])) return activate(pane, id);
  if (rowOf(pane, id).kids) toggle(pane, id);
}

/** A new note under row `target` (or at the end), opened to write in. */
async function newNote(pane, target) {
  const id = crypto.randomUUID();
  await op('note-add', { tree: pane.tree, id, target, position: 'inside' });
  activate(pane, id);
}

/** A new group, right in the tree, with its name ready to be typed. */
async function newGroup(pane, target, position = 'after') {
  const id = crypto.randomUUID();
  await op('note-add', { tree: pane.tree, id, name: t('newGroup'), target, position });
  if (target && position === 'inside') await op('collapse', { tree: pane.tree, id: target, collapsed: false });
  await refresh();
  startRename({ id, pane });
}

async function newTree() {
  const id = crypto.randomUUID();
  await op('tree-add', { id, name: t('newTree') });
  here().tree = id;
  await refresh();
  startRename({ tree: id });
}

/** Takes nodes out of the tree (or, with `everywhere`, out of all trees) and offers the way back. */
async function remove(pane, id, everywhere = false) {
  const ids = branches(pane, id);
  await (everywhere ? op('delete', { ids }) : op('remove', { tree: pane.tree, ids }));
  say(t('removed', ids.length));
}

let toastTimer;
function say(text) {
  clearTimeout(toastTimer);
  ui.toast = text;
  redraw();
  toastTimer = setTimeout(() => ((ui.toast = undefined), redraw()), 6000);
}

/** Addresses in a piece of text, one per line, as new sleeping pages. */
function pagesIn(text) {
  return text
    .split(/\s*\n\s*/)
    .filter((line) => /^https?:\/\/\S+$/.test(line))
    .map((url) => ({ id: crypto.randomUUID(), url, title: '' }));
}

function download(treeId) {
  const data = exportTree(ui.library, treeId);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = `${data.tree.name}.tree.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Adds a tree from `data` ({ nodes, tree }) and shows it. */
async function addTree(data) {
  const id = crypto.randomUUID();
  await op('import', { id, data });
  here().tree = id;
  refresh();
}

function upload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!data.nodes || !data.tree?.children) throw new Error('not a tree file');
      addTree(data);
    } catch (error) {
      log('import failed', error.message);
    }
  };
  input.click();
}

/** The browser's bookmarks as a new tree: folders become groups, bookmarks sleeping pages. */
async function importBookmarks() {
  if (!(await chrome.permissions.request({ permissions: ['bookmarks'] }))) return;
  const data = { nodes: {}, tree: { name: t('bookmarks'), children: {}, collapsed: {} } };
  const walk = (item, parent) => {
    const id = crypto.randomUUID();
    data.nodes[id] = item.url ? { id, url: item.url, title: item.title } : { id, note: '', name: item.title || t('untitled') };
    (data.tree.children[parent] ??= []).push(id);
    for (const child of item.children ?? []) walk(child, id);
  };
  const [root] = await chrome.bookmarks.getTree();
  for (const folder of root.children) if (folder.children.length) walk(folder, 'root');
  addTree(data);
}

// --- Renaming (and typing an address) ------------------------------------------

function startRename(what) {
  ui.renaming = what;
  redraw();
  const input = app.querySelector('.rename');
  input?.focus();
  input?.select();
}

function endRename(save) {
  const renaming = ui.renaming;
  if (!renaming) return;
  const text = app.querySelector('.rename')?.value ?? '';
  ui.renaming = undefined;
  redraw();
  if (renaming.tree) {
    if (save) op('tree-rename', { tree: renaming.tree, name: text });
    return;
  }
  const node = ui.library.nodes[renaming.id];
  if (save && renaming.field === 'url') {
    if (text !== node.url) op('address', { id: renaming.id, url: text });
  } else if (save && text !== titleOf(node)) {
    // Typing the page's own title back means "no name of my own".
    op('rename', { id: renaming.id, name: text === node.title ? '' : text });
  }
  rowEl(renaming.pane, renaming.id)?.focus();
}

app.addEventListener('focusout', (event) => {
  if (event.target.closest?.('.rename')) endRename(true);
});

// --- Searching -----------------------------------------------------------------

app.addEventListener('input', (event) => {
  if (!event.target.closest('.search')) return;
  ui.query = event.target.value;
  refresh();
});

// --- Menus ---------------------------------------------------------------------

const item = (label, run, hint, disabled = false) => ({ label: t(label), hint, disabled, run });

function openMenu(x, y, items) {
  const run = (entry) => () => {
    ui.menu = undefined;
    redraw();
    entry.run();
  };
  const shown = items.filter((entry) => entry !== false && entry !== undefined);
  ui.menu = { x, y, items: shown.map((entry) => entry && { ...entry, run: run(entry) }) };
  redraw();
  // Keep it on screen.
  const box = app.querySelector('.menu').getBoundingClientRect();
  ui.menu.x = Math.max(4, Math.min(x, innerWidth - box.width - 4));
  ui.menu.y = Math.max(4, Math.min(y, innerHeight - box.height - 4));
  redraw();
}

const hasOtherTrees = () => Object.keys(ui.library.trees).length > 1;
/** Whether any of the nodes, or anything under them, is awake (`live`) or asleep. */
const anyLive = (pane, ids, live = true) => ids.some((id) => [id, ...under(pane, id)].some((each) => ui.live.has(each) === live));

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
  const live = ui.live.has(id);
  const others = Object.values(ui.library.trees).filter((other) => other.id !== tree);
  return [
    isNote(node) && item('openNote', () => activate(pane, id)),
    !isNote(node) && !live && item('openBackground', () => activate(pane, id, 'background')),
    !isNote(node) && item('openWindow', () => activate(pane, id, 'window')),
    item('openAll', () => send({ type: 'wake', ids, treeId: tree, windowId }), '', !anyLive(pane, ids, false)),
    item('sleepShort', () => send({ type: 'sleep', ids, treeId: tree }), '', !anyLive(pane, ids)),
    null,
    item('newChild', () => newTab(pane, id, 'child'), 'Ctrl+Shift+Enter'),
    item('newSibling', () => newTab(pane, id, 'sibling'), 'Ctrl+Enter'),
    item('newGroup', () => newGroup(pane, id), 'Ctrl+G'),
    item('newNote', () => newNote(pane, id), 'Ctrl+M'),
    null,
    item('rename', () => startRename({ id, pane }), 'F2'),
    !isNote(node) && item('editAddress', () => startRename({ id, pane, field: 'url' })),
    !isNote(node) && item('copyLink', () => navigator.clipboard.writeText(ids.map((each) => ui.library.nodes[each].url).join('\n'))),
    item('changeIcon', () => ((ui.iconsFor = ids), redraw())),
    item('duplicate', () => op('duplicate', { tree, ids }), 'Ctrl+D'),
    !isNote(node) && item(node.home ? 'unpin' : 'pin', () => op('pin', { ids, pinned: !node.home })),
    node.home && node.url !== node.home.url && item('goHome', () => send({ type: 'go-home', nodeId: id })),
    null,
    item('indent', () => op('indent', { tree, ids }), 'Tab'),
    item('outdent', () => op('outdent', { tree, ids }), 'Shift+Tab'),
    item('addFromTreeHere', () => openPicker(pane, id), '', !hasOtherTrees()),
    ...others.map((other) => ({ label: t('moveTo', other.name), run: () => op('move-to', { from: tree, tree: other.id, ids }) })),
    null,
    item(rowOf(pane, id).collapsed ? 'removeBranch' : 'remove', () => remove(pane, id), 'Del'),
    item('deleteEverywhere', () => remove(pane, id, true), 'Shift+Del'),
  ];
}

function treeMenu(treeId) {
  const ids = Object.keys(ui.library.trees);
  return [
    item('rename', () => startRename({ tree: treeId })),
    item('openBeside', () => {
      ui.panes.push(newPane(treeId));
      refresh();
    }),
    item('moveLeft', () => op('tree-move', { tree: treeId, by: -1 }), '', ids[0] === treeId),
    item('moveRight', () => op('tree-move', { tree: treeId, by: 1 }), '', ids.at(-1) === treeId),
    item('exportTree', () => download(treeId)),
    null,
    item(
      'deleteTree',
      async () => {
        await op('tree-remove', { tree: treeId });
        say(t('treeDeleted'));
      },
      '',
      ids.length < 2,
    ),
  ];
}

function mainMenu() {
  const tree = here().tree;
  const show = (dialog) => () => ((ui.dialog = dialog), redraw());
  return [
    item('redo', () => send({ type: 'redo' }), 'Ctrl+Shift+Z', !ui.canRedo),
    null,
    item('collapseAll', () => op('collapse-all', { tree, collapsed: true })),
    item('expandAll', () => op('collapse-all', { tree, collapsed: false })),
    item('addFromTree', () => openPicker(here()), '', !hasOtherTrees()),
    ui.panes.length > 1 &&
      item(ui.split === 'row' ? 'splitColumn' : 'splitRow', () => {
        ui.split = ui.split === 'row' ? 'column' : 'row';
        refresh();
      }),
    null,
    item('importBookmarks', importBookmarks),
    item('importTree', upload),
    item('exportTree', () => download(tree)),
    null,
    { label: `${t('trash')} (${ui.library.trash.length})`, run: show('trash') },
    item('shortcuts', show('keys')),
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
  if (pane === ui.picker || event.ctrlKey || event.metaKey) {
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
  ui.dialog = undefined;
  redraw();
};

// What the buttons do, by their data-action.
const actions = {
  collapse: ({ pane, id }) => toggle(pane, id),
  child: ({ pane, id }) => newTab(pane, id, 'child'),
  sleep: ({ pane, id }) => send({ type: 'sleep', ids: targets(pane, id), treeId: pane.tree }),
  remove: ({ pane, id }) => remove(pane, id),
  home: ({ id }) => send({ type: 'go-home', nodeId: id }),
  undo: () => {
    ui.toast = undefined;
    send({ type: 'undo' });
  },
  'new-tab': () => newTab(here()),
  'new-group': () => newGroup(here(), rowOf(here(), ui.cursor)?.id),
  'new-note': () => newNote(here()),
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
  restore: ({ el }) => op('restore', { tree: here().tree, ids: [el.dataset.node] }),
  'trash-empty': () => op('trash-empty'),
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
  if (!id) {
    // A click on nothing lets go of the selection.
    if (pane) pane.sel.clear();
    return redraw();
  }
  select(pane, id, event);
  redraw();
  const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey && event.detail === 1;
  if (plain && pane !== ui.picker) open(pane, id);
});

app.addEventListener('dblclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  const treeId = event.target.closest('.bar .tab[data-tree]')?.dataset.tree;
  if (treeId) startRename({ tree: treeId });
  else if (id && pane !== ui.picker && event.target.closest('.title')) startRename({ id, pane });
});

// Middle click, as on a tab or a link: closes a live node's tab (the node
// stays, asleep), opens a sleeping one without going to it.
app.addEventListener('auxclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (!id || event.button !== 1 || pane === ui.picker) return;
  if (ui.live.has(id)) send({ type: 'sleep-one', nodeId: id });
  else if (!isGroup(ui.library.nodes[id])) activate(pane, id, 'background');
});

// --- Keyboard ------------------------------------------------------------------

addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  const letter = event.key.toLowerCase();
  if (event.target.closest?.('.rename')) {
    if (event.key === 'Enter') endRename(true);
    else if (event.key === 'Escape') endRename(false);
    return;
  }
  if (event.key === 'Escape') {
    if (ui.drag) endDrag();
    ui.menu = undefined;
    for (const pane of ui.panes) pane.sel.clear();
    if (ui.query) {
      ui.query = '';
      refresh();
    }
    return closeOverlay();
  }
  const everywhere = {
    z: () => send({ type: event.shiftKey ? 'redo' : 'undo' }),
    y: () => send({ type: 'redo' }),
    f: () => app.querySelector('.search input').select(),
    g: () => actions['new-group'](),
    m: () => actions['new-note'](),
  };
  if (ctrl && everywhere[letter]) {
    event.preventDefault();
    return everywhere[letter]();
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
      if (row.collapsed) toggle(pane, id);
      else if (row.kids) go(pane.rows[index + 1]);
    },
    ArrowLeft: () => {
      if (row.kids && !row.collapsed) toggle(pane, id);
      else go(pane.rows.slice(0, index).findLast((above) => above.depth < row.depth));
    },
    Enter: () => {
      if (ctrl) newTab(pane, id, event.shiftKey ? 'child' : 'sibling');
      else open(pane, id);
    },
    ' ': () => open(pane, id),
    Delete: () => remove(pane, id, event.shiftKey),
    F2: () => startRename({ id, pane }),
    Tab: () => op(event.shiftKey ? 'outdent' : 'indent', { tree, ids }),
    d: () => ctrl && op('duplicate', { tree, ids }),
    a: () => ctrl && ((pane.sel = new Set(pane.rows.map((each) => each.id))), redraw()),
  };
  const key = keys[event.key] ?? keys[letter];
  if (!key || (event.key.length === 1 && event.key !== ' ' && !ctrl)) return;
  event.preventDefault();
  key();
});

// Pasting addresses adds them as sleeping pages, after the row the keyboard is on.
addEventListener('paste', (event) => {
  if (event.target.closest?.('input')) return;
  const nodes = pagesIn(event.clipboardData.getData('text'));
  if (!nodes.length) return;
  event.preventDefault();
  const target = rowOf(here(), ui.cursor)?.id;
  op('add', { tree: here().tree, nodes, target, position: target ? 'after' : 'end' });
});

// --- Dragging ------------------------------------------------------------------
// Our own, on pointer events (the browser's drag-and-drop swallows the mouse
// wheel). Drop on a row's middle to make a child, on its top or bottom edge
// to place a sibling, below the tree to make a top-level node. Subtrees come
// along; dropping into a pane that shows another tree shows the nodes there too.

let press; // Where the button went down: { x, y, id, pane }.
let pointer = { x: 0, y: 0 };
let unfold; // A timer: a folded row opens when something is held over it.

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
  clearTimeout(unfold);
  if (drop?.position === 'inside' && rowOf(pane, drop.targetId).collapsed) {
    unfold = setTimeout(() => op('collapse', { tree: pane.tree, id: drop.targetId, collapsed: false }), 700);
  }
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

function startDrag(drag) {
  ui.drag = drag;
  redraw();
  dragTick();
}

function endDrag() {
  clearTimeout(unfold);
  press = undefined;
  ui.drag = undefined;
  ui.drop = undefined;
  redraw();
}

app.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, input, .menu, .overlay')) return;
  const divider = event.target.closest('.divider');
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (divider) press = { divider: Number(divider.dataset.divider) };
  else if (id && pane) press = { x: event.clientX, y: event.clientY, id, pane };
});

/** Dragging the line between two panes gives one more room and the other less. */
function resize({ divider }) {
  const [before, after] = [ui.panes[divider - 1], ui.panes[divider]];
  const [a, b] = [divider - 1, divider].map((index) => app.querySelector(`.pane[data-pane="${index}"]`).getBoundingClientRect());
  const along = ui.split === 'row' ? (pointer.x - a.left) / (b.right - a.left) : (pointer.y - a.top) / (b.bottom - a.top);
  const share = Math.max(0.1, Math.min(0.9, along));
  const total = before.size + after.size;
  [before.size, after.size] = [total * share, total * (1 - share)];
  redraw();
}

addEventListener('pointermove', (event) => {
  if (!press) return;
  pointer = { x: event.clientX, y: event.clientY };
  if (press.divider) return resize(press);
  if (ui.drag || Math.hypot(pointer.x - press.x, pointer.y - press.y) < 5) return;
  const ids = targets(press.pane, press.id);
  const title = titleOf(ui.library.nodes[press.id]);
  app.setPointerCapture(event.pointerId); // Keep hearing the pointer outside the panel.
  startDrag({ ids, from: press.pane.tree, label: ids.length > 1 ? `${title} +${ids.length - 1}` : title });
});

addEventListener('pointerup', () => {
  const { drag, drop } = ui;
  const resized = press?.divider;
  press = undefined;
  if (resized) return refresh(); // Remembers the sizes.
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

// A link dragged in from a page lands as a sleeping page where it is dropped.
// (This one is the browser's own drag: ours cannot leave the panel.)
app.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('text/uri-list')) return;
  event.preventDefault();
  pointer = { x: event.clientX, y: event.clientY };
  if (!ui.drag) startDrag({ ids: [], from: undefined });
});
app.addEventListener('dragleave', (event) => {
  if (ui.drag && !ui.drag.from && !app.contains(event.relatedTarget)) endDrag();
});
app.addEventListener('drop', (event) => {
  const { drop } = ui;
  const nodes = pagesIn(event.dataTransfer.getData('text/uri-list'));
  if (!ui.drag) return;
  event.preventDefault();
  endDrag();
  if (drop && nodes.length) op('add', { tree: drop.pane.tree, nodes, target: drop.targetId, position: drop.position });
});

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
