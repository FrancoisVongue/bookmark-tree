// What the user can ask for, whichever way they ask: a button, a menu, a key.

import { isGroup, newId, treeFor } from '../model.js';
import { exportTree } from '../ops.js';
import { toHtml, toOutline } from '../bookmarks.js';
import { t } from '../i18n.js';
import { askForBookmarks, saveFile } from '../page.js';
import { titleOf } from './view.js';
import { app, arrange, ask, branches, closeOverlay, here, newPane, op, redraw, refresh, rowEl, rowOf, say, send, setFocus, ui, under } from './screen.js';

export const activate = (pane, id, where) =>
  send({ type: 'activate', nodeId: id, treeId: pane.tree, windowId: ui.windowId, where });
export const newTab = (pane, id, as) => send({ type: 'new-tab', windowId: ui.windowId, treeId: pane.tree, nodeId: id, as });
export const toggle = (pane, id) => op('collapse', { tree: pane.tree, id, collapsed: !rowOf(pane, id).collapsed });

/** Back to a place from the journal: its tree is shown, its page opened (again, if it sleeps). */
export function revisit(id, tree) {
  here().tree = treeFor(ui.library, id, tree);
  activate(here(), id);
  arrange();
}

/** Copies of nodes and of all that is under them, right after them. */
export function duplicate(pane, ids) {
  const copied = ids.flatMap((id) => [id, ...under(pane, id)]);
  return op('duplicate', { tree: pane.tree, ids, as: Object.fromEntries(copied.map((id) => [id, newId()])) });
}

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

/** A new tree, in cell `cell` of the table of trees (or the first free one). */
export async function newTree(cell) {
  const id = crypto.randomUUID();
  await op('tree-add', { id, name: t('newTree'), cell });
  here().tree = id;
  await refresh();
  startRename({ tree: id });
}

/**
 * Takes nodes out of the tree (or, with `everywhere`, out of all trees) and
 * offers the way back. One node goes at once; several are asked about first.
 */
export function remove(pane, id, everywhere = false) {
  const ids = branches(pane, id);
  const go = async () => {
    await (everywhere ? op('delete', { ids }) : op('remove', { tree: pane.tree, ids }));
    say(t('removed', ids.length));
  };
  if (ids.length === 1) return go();
  if (everywhere) ask(t('askDelete', ids.length), t('deleteYes'), go);
  else ask(t('askRemove', ids.length, ui.library.trees[pane.tree].name), t('removeYes'), go);
}

/** Deletes a tree, once the user has said yes. */
export function removeTree(treeId) {
  ask(t('askDeleteTree', ui.library.trees[treeId].name), t('deleteYes'), async () => {
    await op('tree-remove', { tree: treeId });
    say(t('treeDeleted'));
  });
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

/**
 * Opens the picker: another tree, to choose nodes from. They will be shown in
 * `pane`'s tree too: under row `id`, or at the end of the tree without one.
 */
export function openPicker(pane, id) {
  const other = Object.keys(ui.library.trees).find((treeId) => treeId !== pane.tree);
  ui.overlay = { kind: 'picker', ...newPane(other), into: { pane, id } };
  arrange();
}

/** Addresses in a piece of text, one per line, as new sleeping pages. */
export function pagesIn(text) {
  return text
    .split(/\s*\n\s*/)
    .filter((line) => /^https?:\/\/\S+$/.test(line))
    .map((url) => ({ id: crypto.randomUUID(), url, title: '' }));
}

/** Gives what the table of icons was opened for (nodes, or a tree) the first sign of `text` as its icon; none, if empty. */
export function setIcon(text) {
  const { ids, tree } = ui.overlay;
  const icon = [...new Intl.Segmenter().segment(text.trim())][0]?.segment ?? '';
  if (tree) op('tree-icon', { tree, icon });
  else op('icon', { ids, icon });
  closeOverlay();
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

// --- A tree as a file, as bookmarks; the rest is on the settings page ----------

/** Sync, versions, files, the trash, the keys: on a page of their own. */
export const openSettings = () => chrome.runtime.openOptionsPage();

/** One tree, in our own format (everything about its nodes is kept). */
export const download = (treeId) => {
  const data = exportTree(ui.library, treeId);
  saveFile(`${data.tree.name}.tree.json`, JSON.stringify(data, null, 2), 'application/json');
};

/** One tree as a bookmarks file any browser can import. */
export const downloadBookmarks = (treeId) => {
  const { name } = ui.library.trees[treeId];
  saveFile(`${name}.bookmarks.html`, toHtml(toOutline(ui.library, treeId, titleOf), name), 'text/html');
};

/**
 * A tree as a folder among the browser's own bookmarks ("Other bookmarks"),
 * replacing the folder a previous time left. The browser keeps and syncs it
 * by itself, whatever happens to this extension.
 */
export async function saveToBookmarks(treeId) {
  if (!(await askForBookmarks())) return;
  const title = `Tree: ${ui.library.trees[treeId].name}`;
  const [root] = await chrome.bookmarks.getTree();
  const parentId = (root.children[1] ?? root.children[0]).id;
  for (const old of await chrome.bookmarks.getChildren(parentId)) {
    if (!old.url && old.title === title) await chrome.bookmarks.removeTree(old.id);
  }
  const create = async (items, parent) => {
    for (const item of items) {
      const made = await chrome.bookmarks.create({ parentId: parent, title: item.title, url: item.url });
      if (item.children) await create(item.children, made.id);
    }
  };
  const folder = await chrome.bookmarks.create({ parentId, title });
  await create(toOutline(ui.library, treeId, titleOf), folder.id);
  say(t('savedToBookmarks', title));
}
