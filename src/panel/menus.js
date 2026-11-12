// The menus: what can be done with a row, a tree, the panel.

import { gridOf, isNote } from '../model.js';
import { t } from '../i18n.js';
import { app, here, newPane, op, redraw, refresh, rowOf, say, send, targets, ui, under } from './screen.js';
import * as cmd from './commands.js';

const item = (label, run, hint, disabled = false) => ({ label: t(label), hint, disabled, run });

/** Shows a menu at a point. `null` is a separator; `false` and `undefined` entries are left out. */
export function openMenu(x, y, items) {
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
const anyLive = (pane, ids, live = true) =>
  ids.some((id) => [id, ...under(pane, id)].some((each) => ui.live.has(each) === live));

export function rowMenu(pane, id) {
  const ids = targets(pane, id);
  const node = ui.library.nodes[id];
  const tree = pane.tree;
  const page = !isNote(node);
  const links = () => ids.map((each) => ui.library.nodes[each].url).join('\n');
  return [
    !page && item('openNote', () => cmd.activate(pane, id)),
    page && !ui.live.has(id) && item('openBackground', () => cmd.activate(pane, id, 'background')),
    page && item('openWindow', () => cmd.activate(pane, id, 'window')),
    item('openAll', () => send({ type: 'wake', ids, treeId: tree, windowId: ui.windowId }), '', !anyLive(pane, ids, false)),
    item('sleepShort', () => send({ type: 'sleep', ids, treeId: tree }), '', !anyLive(pane, ids)),
    null,
    item('newChild', () => cmd.newTab(pane, id, 'child'), 'Ctrl+Shift+Enter'),
    item('newSibling', () => cmd.newTab(pane, id, 'sibling'), 'Ctrl+Enter'),
    item('newGroup', () => cmd.newGroup(pane, id), 'Ctrl+G'),
    item('newNote', () => cmd.newNote(pane, id), 'Ctrl+M'),
    null,
    item('rename', () => cmd.startRename({ id, pane }), 'F2'),
    page && item('editAddress', () => cmd.startRename({ id, pane, field: 'url' })),
    page && item('copyLink', () => navigator.clipboard.writeText(links())),
    item('changeIcon', () => ((ui.overlay = { kind: 'icons', ids }), redraw())),
    item('duplicate', () => op('duplicate', { tree, ids }), 'Ctrl+D'),
    page && item(node.home ? 'unpin' : 'pin', () => op('pin', { ids, pinned: !node.home })),
    node.home && node.url !== node.home.url && item('goHome', () => send({ type: 'go-home', nodeId: id })),
    null,
    item('indent', () => op('indent', { tree, ids }), 'Tab'),
    item('outdent', () => op('outdent', { tree, ids }), 'Shift+Tab'),
    item('addFromTreeHere', () => cmd.openPicker(pane, id), '', !hasOtherTrees()),
    null,
    item(rowOf(pane, id).collapsed ? 'removeBranch' : 'remove', () => cmd.remove(pane, id), 'Del'),
    item('deleteEverywhere', () => cmd.remove(pane, id, true), 'Shift+Del'),
  ];
}

export function treeMenu(treeId) {
  const ids = Object.keys(ui.library.trees);
  const drop = async () => {
    await op('tree-remove', { tree: treeId });
    say(t('treeDeleted'));
  };
  return [
    item('rename', () => cmd.startRename({ tree: treeId })),
    item('changeIcon', () => ((ui.overlay = { kind: 'icons', tree: treeId }), redraw())),
    item('openBeside', () => (ui.panes.push(newPane(treeId)), refresh())),
    null,
    item('saveToBookmarks', () => cmd.saveToBookmarks(treeId)),
    item('exportBookmarks', () => cmd.downloadBookmarks(treeId)),
    item('exportTree', () => cmd.download(treeId)),
    null,
    item('deleteTree', drop, '', ids.length < 2),
  ];
}

export function mainMenu() {
  const tree = here().tree;
  const turn = () => ((ui.split = ui.split === 'row' ? 'column' : 'row'), refresh());
  // The table of trees can grow freely, and shrink while every tree still has a cell.
  const { columns, rows } = gridOf(ui.library);
  const trees = Object.keys(ui.library.trees).length;
  const size = (label, more) => {
    const next = { columns: columns + (more.columns ?? 0), rows: rows + (more.rows ?? 0) };
    return item(label, () => op('grid-size', next), '', next.columns * next.rows < trees || next.columns > 6);
  };
  return [
    item('redo', () => send({ type: 'redo' }), 'Ctrl+Shift+Z', !ui.canRedo),
    null,
    item('collapseAll', () => op('collapse-all', { tree, collapsed: true })),
    item('expandAll', () => op('collapse-all', { tree, collapsed: false })),
    item('addFromTree', () => cmd.openPicker(here()), '', !hasOtherTrees()),
    ui.panes.length > 1 && item(ui.split === 'row' ? 'splitColumn' : 'splitRow', turn),
    null,
    item('newTree', () => cmd.newTree()),
    size('addColumn', { columns: 1 }),
    size('removeColumn', { columns: -1 }),
    size('addRow', { rows: 1 }),
    size('removeRow', { rows: -1 }),
    null,
    item('settings', cmd.openSettings),
  ];
}
