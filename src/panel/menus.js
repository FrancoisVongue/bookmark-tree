// What the menus hold: what can be done with a row, a tree, the panel. (Showing a menu is the screen's: see openMenu in screen.js.)

import { gridOf, isGroup, isNote, planOf } from '../model.js';
import { t } from '../i18n.js';
import { here, openBeside, openMenu, rowOf, showBranch, targets, ui, under } from './screen.js';
import * as cmd from './commands.js';
import { keyOf } from './keymap.js';
import { isAway, removeLabel } from './view.js';

const item = (label, run, hint, disabled = false) => ({ label: t(label), hint, disabled, run });

const hasOtherTrees = () => Object.keys(ui.library.trees).length > 1;
/** Whether any of the nodes, or anything under them, is awake (`live`) or asleep. */
const anyLive = (pane, ids, live = true) =>
  ids.some((id) => [id, ...under(pane, id)].some((each) => ui.live.has(each) === live));

export function rowMenu(pane, id) {
  const ids = targets(pane, id);
  const node = ui.library.nodes[id];
  const page = !isNote(node);
  const planned = planOf(ui.library).includes(id);
  return [
    !page && item('openNote', () => cmd.activate(pane, id)),
    page && !ui.live.has(id) && item('openBackground', () => cmd.activate(pane, id, 'background')),
    page && item('openWindow', () => cmd.activate(pane, id, 'window')),
    item('openAll', () => cmd.wake(pane, ids), '', !anyLive(pane, ids, false)),
    item('sleepShort', () => cmd.sleep(pane, ids), '', !anyLive(pane, ids)),
    null,
    item('newChild', () => cmd.newTab(pane, id, 'child'), keyOf('newChild')),
    item('newSibling', () => cmd.newTab(pane, id, 'sibling'), keyOf('newSibling')),
    item('newGroup', () => cmd.newGroup(pane, id), keyOf('newGroup')),
    item('newNote', () => cmd.newNote(pane, id), keyOf('newNote')),
    null,
    item('rename', () => cmd.startTyping({ what: 'name', id, pane }), keyOf('rename')),
    page && item('editAddress', () => cmd.startTyping({ what: 'address', id, pane })),
    page && item('copyLink', () => cmd.copyLinks(ids)),
    item('changeIcon', () => cmd.chooseIcon({ ids })),
    item('duplicate', () => cmd.duplicate(pane, ids), keyOf('duplicate')),
    !isGroup(node) && item(planned ? 'planRemove' : 'planAdd', () => cmd.plan(ids, !planned)),
    page && item(node.pinned ? 'unpin' : 'pin', () => cmd.pin(ids, !node.pinned)),
    isAway(node) && item('goHome', () => cmd.goHome(id)),
    null,
    item('indent', () => cmd.indent(pane, ids), keyOf('indent')),
    item('outdent', () => cmd.outdent(pane, ids), keyOf('outdent')),
    item('filterBranch', () => showBranch(pane.tree, id), keyOf('branch')),
    item('addFromTreeHere', () => cmd.openPicker(pane, id), '', !hasOtherTrees()),
    null,
    item(removeLabel(rowOf(pane, id)), () => cmd.remove(pane, id), keyOf('remove')),
    item('deleteEverywhere', () => cmd.remove(pane, id, true), keyOf('deleteEverywhere')),
  ];
}

export function treeMenu(treeId) {
  const ids = Object.keys(ui.library.trees);
  return [
    item('rename', () => cmd.startTyping({ what: 'tree', tree: treeId })),
    item('changeIcon', () => cmd.chooseIcon({ tree: treeId })),
    item('openBeside', () => openBeside(treeId)),
    null,
    item('saveToBookmarks', () => cmd.saveToBookmarks(treeId)),
    item('exportBookmarks', () => cmd.downloadBookmarks(treeId)),
    item('exportTree', () => cmd.download(treeId)),
    null,
    item('deleteTree', () => cmd.removeTree(treeId), '', ids.length < 2),
  ];
}

export function mainMenu() {
  // The table of trees can grow freely, and shrink while every tree still has a cell.
  const { columns, rows } = gridOf(ui.library);
  const trees = Object.keys(ui.library.trees).length;
  const size = (label, more) => {
    const next = { columns: columns + (more.columns ?? 0), rows: rows + (more.rows ?? 0) };
    return item(label, () => cmd.resizeGrid(next), '', next.columns * next.rows < trees || next.columns > 6);
  };
  return [
    item('redo', () => cmd.undo(true), keyOf('redo'), !ui.canRedo),
    null,
    item('collapseAll', () => cmd.collapseAll(here(), true)),
    item('expandAll', () => cmd.collapseAll(here(), false)),
    item('addFromTree', () => cmd.openPicker(here()), '', !hasOtherTrees()),
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
