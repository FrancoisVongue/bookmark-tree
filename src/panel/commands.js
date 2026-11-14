// What the user can ask for, whichever way they ask: a button, a menu, a key.

import { isGroup, newId, treeFor } from '../model.js';
import { exportTree } from '../ops.js';
import { toHtml, toOutline } from '../bookmarks.js';
import { t } from '../i18n.js';
import { ask } from '../parts.js';
import { askForBookmarks, saveFile } from '../page.js';
import { titleOf } from './view.js';
import { branches, closeOverlay, endRenaming, here, op, openOverlay, pick, picker, refresh, rename, rowOf, saveFilter, say, send, show, ui, under, unsay } from './screen.js';

export const activate = (pane, id, where) =>
  send({ type: 'activate', nodeId: id, treeId: pane.tree, windowId: ui.windowId, where });
export const newTab = (pane, id, as) => send({ type: 'new-tab', windowId: ui.windowId, treeId: pane.tree, nodeId: id, as });
export const toggle = (pane, id) => op('collapse', { tree: pane.tree, id, collapsed: !rowOf(pane, id).collapsed });

/** Back to a place from the journal: its tree is shown, its page opened (again, if it sleeps). */
export function revisit(id, tree) {
  show(here(), treeFor(ui.library, id, tree));
  activate(here(), id);
}

/** Closes the tabs of nodes and of all under them (the nodes stay, asleep); `wake` opens them again. */
export const sleep = (pane, ids) => send({ type: 'sleep', ids, treeId: pane.tree });
export const wake = (pane, ids) => send({ type: 'wake', ids, treeId: pane.tree, windowId: ui.windowId });
/** Closes the tab of one node only. */
export const sleepOne = (id) => send({ type: 'sleep-one', nodeId: id });
/** Takes a page that went elsewhere back to its own address. */
export const goHome = (id) => send({ type: 'go-home', nodeId: id });

export const indent = (pane, ids) => op('indent', { tree: pane.tree, ids });
export const outdent = (pane, ids) => op('outdent', { tree: pane.tree, ids });
export const collapseAll = (pane, collapsed) => op('collapse-all', { tree: pane.tree, collapsed });
export const plan = (ids, planned) => op(planned ? 'plan' : 'unplan', { ids });
export const keep = (ids, kept) => op('keep', { ids, keep: kept });
export const pin = (ids, pinned) => op('pin', { ids, pinned });
export const copyLinks = (ids) => navigator.clipboard.writeText(ids.map((id) => ui.library.nodes[id].url).join('\n'));
/** Opens the table of icons for nodes ({ ids }) or for a tree ({ tree }). */
export const chooseIcon = (what) => openOverlay({ kind: 'icons', ...what });
/** Gives the table of trees another size. */
export const resizeGrid = (size) => op('grid-size', size);

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
  show(here(), id);
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
    say(t('removed', ids.length), true);
  };
  const sure = ids.length === 1 || (everywhere ? ask(t('askDelete', ids.length), t('deleteYes')) : ask(t('askRemove', ids.length, ui.library.trees[pane.tree].name), t('removeYes')));
  return Promise.resolve(sure).then((yes) => yes && go());
}

/** Deletes a tree, once the user has said yes. */
export async function removeTree(treeId) {
  if (!(await ask(t('askDeleteTree', ui.library.trees[treeId].name), t('deleteYes')))) return;
  await op('tree-remove', { tree: treeId });
  say(t('treeDeleted'), true);
}

/**
 * Opens the picker: another tree, to choose nodes from. They will be shown in
 * `pane`'s tree too: under row `id`, or at the end of the tree without one.
 */
export function openPicker(pane, id) {
  pick(Object.keys(ui.library.trees).find((treeId) => treeId !== pane.tree), { pane, id });
}

/** What is chosen in the picker is shown where it was opened for too - or, with `take`, moves there. */
export function addPicked(take) {
  const { tree, sel, into } = picker();
  const { pane, id } = into;
  op('move', { tree: pane.tree, from: tree, ids: [...sel], target: id, position: id ? 'inside' : 'end', take });
  if (id) op('collapse', { tree: pane.tree, id, collapsed: false }); // So what was added is seen.
  closeOverlay();
}

/** New sleeping pages after row `target`, or at the end of the tree. */
export const addPages = (pane, nodes, target) => op('add', { tree: pane.tree, nodes, target, position: target ? 'after' : 'end' });

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

/** Takes the last step back (or, with `again`, makes it again). The notice of what was done goes: its "Undo" was this. */
export function undo(again = false) {
  unsay();
  send({ type: again ? 'redo' : 'undo' });
}

// --- Renaming (typing an address, naming a filter to save) ----------------------

export const startRename = rename;

export function endRename(save) {
  const { renaming, text } = endRenaming();
  if (!renaming || !save) return;
  if (renaming.tree) return op('tree-rename', { tree: renaming.tree, name: text });
  if (renaming.filter) return saveFilter(renaming.filter, text);
  const node = ui.library.nodes[renaming.id];
  if (renaming.field === 'url') {
    if (text !== node.url) op('address', { id: renaming.id, url: text });
  } else if (text !== titleOf(node)) {
    // Typing the page's own title back means "no name of my own".
    op('rename', { id: renaming.id, name: text === node.title ? '' : text });
  }
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
