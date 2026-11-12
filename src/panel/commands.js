// What the user can ask for, whichever way they ask: a button, a menu, a key.

import { isGroup } from '../model.js';
import { exportTree } from '../ops.js';
import { fromHtml, fromOutline, toHtml, toOutline } from '../bookmarks.js';
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

/** A new tree, in cell `cell` of the table of trees (or the first free one). */
export async function newTree(cell) {
  const id = crypto.randomUUID();
  await op('tree-add', { id, name: t('newTree'), cell });
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

// --- Sync ----------------------------------------------------------------------

/** Opens the sync window: where the library is kept, when it was last synced, the saved versions. */
export async function openSync() {
  ui.overlay = { kind: 'sync', settings: (await send({ type: 'sync-get' })) ?? {}, versions: [], busy: false };
  redraw();
  const versions = await send({ type: 'sync-history' });
  if (ui.overlay?.kind === 'sync') ui.overlay.versions = versions ?? [];
  redraw();
}

/** Does one thing with the sync window showing it is busy, then shows the window afresh. */
async function syncing(task) {
  ui.overlay.busy = true;
  redraw();
  await task();
  if (ui.overlay?.kind === 'sync') await openSync();
}

export const saveSync = () =>
  syncing(async () => {
    const field = (name) => app.querySelector(`.dialog [name="${name}"]`).value.trim();
    await send({ type: 'sync-set', repo: field('repo'), token: field('token'), api: ui.overlay.settings.api });
    await send({ type: 'sync-now' });
  });
export const syncNow = () => syncing(() => send({ type: 'sync-now' }));
export const goToVersion = (ref) => syncing(() => send({ type: 'sync-restore', ref }));

// --- Files and bookmarks -------------------------------------------------------

const uuid = () => crypto.randomUUID();

function saveFile(name, text, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

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

/** The whole library, as a file to keep somewhere safe. */
export const backUpAll = () =>
  saveFile(`tree-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(ui.library), 'application/json');

/** Adds a tree from `data` ({ nodes, tree }) and shows it. */
async function addTree(data) {
  const id = uuid();
  await op('import', { id, data });
  here().tree = id;
  refresh();
}

/** Takes in a file: a tree of ours, a bookmarks file of any browser, or a backup of the whole library. */
export function upload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.html,.htm';
  input.onchange = async () => {
    const [file] = input.files;
    const text = await file.text();
    try {
      if (text.trimStart().startsWith('<')) return addTree(fromOutline(fromHtml(text), file.name.replace(/(\.bookmarks)?\.[^.]*$/, ''), uuid));
      const data = JSON.parse(text);
      if (data.trees) return say((await send({ type: 'restore-file', library: data })) ?? t('restored'));
      if (!data.nodes || !data.tree?.children) throw new Error('not a tree file');
      addTree(data);
    } catch (error) {
      log('import failed', error.message);
      say(t('importFailed'));
    }
  };
  input.click();
}

const askForBookmarks = () => chrome.permissions.request({ permissions: ['bookmarks'] });

/** The browser's bookmarks as a new tree. */
export async function importBookmarks() {
  if (!(await askForBookmarks())) return;
  const outline = (items) =>
    items.map((item) => (item.url ? { title: item.title, url: item.url } : { title: item.title || t('untitled'), children: outline(item.children ?? []) }));
  const [root] = await chrome.bookmarks.getTree();
  addTree(fromOutline(outline(root.children.filter((folder) => folder.children?.length)), t('bookmarks'), uuid));
}

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
