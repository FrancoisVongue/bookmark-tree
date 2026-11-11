// What the user can ask for, whichever way they ask: a button, a menu, a key.

import { isGroup } from '../model.js';
import { exportTree } from '../ops.js';
import { t } from '../i18n.js';
import { titleOf } from './view.js';
import { app, branches, here, log, newPane, op, redraw, refresh, rowEl, rowOf, say, send, ui } from './screen.js';

export const activate = (pane, id, where) =>
  send({ type: 'activate', nodeId: id, treeId: pane.tree, windowId: ui.windowId, where });
export const newTab = (pane, id, as) => send({ type: 'new-tab', windowId: ui.windowId, treeId: pane.tree, nodeId: id, as });
export const toggle = (pane, id) => op('collapse', { tree: pane.tree, id, collapsed: !rowOf(pane, id).collapsed });

/** Clicking a node goes to its page. A group has no page: it folds and unfolds. */
export function open(pane, id) {
  if (!isGroup(ui.library.nodes[id])) return activate(pane, id);
  if (rowOf(pane, id).kids) toggle(pane, id);
}

/** A new note under row `target` (or at the end), opened to write in. */
export async function newNote(pane, target) {
  const id = crypto.randomUUID();
  await op('note-add', { tree: pane.tree, id, target, position: 'inside' });
  activate(pane, id);
}

/** A new group, right in the tree after row `target`, with its name ready to be typed. */
export async function newGroup(pane, target) {
  const id = crypto.randomUUID();
  await op('note-add', { tree: pane.tree, id, name: t('newGroup'), target, position: 'after' });
  await refresh();
  startRename({ id, pane });
}

export async function newTree() {
  const id = crypto.randomUUID();
  await op('tree-add', { id, name: t('newTree') });
  here().tree = id;
  await refresh();
  startRename({ tree: id });
}

/** Takes nodes out of the tree (or, with `everywhere`, out of all trees) and offers the way back. */
export async function remove(pane, id, everywhere = false) {
  const ids = branches(pane, id);
  await (everywhere ? op('delete', { ids }) : op('remove', { tree: pane.tree, ids }));
  say(t('removed', ids.length));
}

/**
 * Opens the picker: another tree, to choose nodes from. They will be shown in
 * `pane`'s tree too: under row `id`, or at the end of the tree without one.
 */
export function openPicker(pane, id) {
  const other = Object.keys(ui.library.trees).find((treeId) => treeId !== pane.tree);
  ui.overlay = { kind: 'picker', ...newPane(other), into: { pane, id } };
  refresh();
}

/** Addresses in a piece of text, one per line, as new sleeping pages. */
export function pagesIn(text) {
  return text
    .split(/\s*\n\s*/)
    .filter((line) => /^https?:\/\/\S+$/.test(line))
    .map((url) => ({ id: crypto.randomUUID(), url, title: '' }));
}

// --- Renaming (and typing an address) ------------------------------------------

export function startRename(what) {
  ui.renaming = what;
  redraw();
  const input = app.querySelector('.rename');
  input?.focus();
  input?.select();
}

export function endRename(save) {
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

// --- Files ---------------------------------------------------------------------

export function download(treeId) {
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

export function upload() {
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
export async function importBookmarks() {
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
