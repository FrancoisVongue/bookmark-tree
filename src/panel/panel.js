// The panel's entry: the mouse, and the start. It turns what the user does
// into commands for the worker (see screen.js for what the panel itself owns).

import { allOfJournal, app, applySaved, applyTicks, arrange, clearFilters, closeMenu, closeNotice, closeOverlay, closePane, deselect, forgetSaved, here, hush, idAt, log, menuUnder, openMenu, paneAt, pickFrom, picker, pointAt, redraw, refresh, revealActive, rowOf, search, searchJournal, select, setFocus, show, showActiveTree, split, targets, tick, tickRow, togglePicked, toggleStrip, ui, watch } from './screen.js';
import { mainMenu, rowMenu, treeMenu } from './menus.js';
import { endsDrag } from './drag.js';
import { saveBackup } from '../page.js';
import * as cmd from './commands.js';
import './keys.js';

// What the buttons do, by their data-action.
const actions = {
  collapse: ({ pane, id }) => cmd.toggle(pane, id),
  child: ({ pane, id }) => cmd.newTab(pane, id, 'child'),
  sleep: ({ pane, id }) => cmd.sleep(pane, targets(pane, id)),
  remove: ({ pane, id }) => cmd.remove(pane, id),
  home: ({ id }) => cmd.goHome(id),
  undo: () => cmd.undo(),
  // Back to where the current tab is: its tree, its row.
  'show-active': async () => {
    showActiveTree();
    arrange();
    revealActive();
  },
  'new-tab': () => cmd.newTab(here()),
  'new-group': () => cmd.newGroup(here(), rowOf(here(), ui.cursor)?.id),
  'new-note': () => cmd.newNote(here()),
  'tree-show': ({ el }) => show(here(), el.dataset.tree),
  'tree-add': ({ el }) => cmd.newTree(Number(el.dataset.cell)),
  'pane-close': ({ pane }) => closePane(pane),
  more: ({ el }) => menuUnder(el, mainMenu()),
  filter: tick,
  'filter-saved': ({ el }) => applySaved(here().tree, el.dataset.name),
  'filter-forget': ({ el }) => forgetSaved(here().tree, el.dataset.name),
  'filter-save': () => cmd.startRename({ filter: here().tree }),
  'filter-clear': () => clearFilters(here().tree),
  'split-row': () => split('row'),
  'split-column': () => split('column'),
  'picker-tree': ({ el }) => pickFrom(el.dataset.tree),
  'picker-add': ({ el }) => cmd.addPicked('take' in el.dataset),
  icon: ({ el }) => cmd.setIcon(el.dataset.icon),
  settings: cmd.openSettings,
  'notice-close': closeNotice,
  'backup-now': async () => {
    await saveBackup(ui.library);
    refresh();
  },
  'journal-go': ({ el }) => cmd.revisit(el.dataset.node, el.dataset.tree),
  'journal-more': allOfJournal,
  'journal-toggle': () => toggleStrip('journal'),
  'plan-go': ({ el }) => cmd.revisit(el.dataset.node),
  unplan: ({ el }) => cmd.plan([el.closest('.place').dataset.node], false),
  'plan-toggle': () => toggleStrip('plan'),
  // A page that plays out of sight: to its tab - in the tree the user works in, if it is there.
  'sound-go': ({ el }) => cmd.revisit(el.dataset.node, here().tree),
  'sound-hush': ({ el }) => hush(el.closest('.place').dataset.node),
  'overlay-close': closeOverlay,
};

let chosen; // The row that was the one selected before the click now being handled, if it was that row.
app.addEventListener('click', (event) => {
  if (endsDrag() || event.target.closest('input, .menu')) return;
  const el = event.target.closest('[data-action]');
  const pane = paneAt(event.target);
  const id = idAt(event.target);
  if (pane) setFocus(pane);
  // A click inside a dialog lands on the overlay behind it too: that is not "close".
  if (el && !(el.dataset.action === 'overlay-close' && event.target !== el)) {
    return actions[el.dataset.action]?.({ pane, id, el });
  }
  if (id && !pane) return togglePicked(id); // A row of the pane on top, to choose from: a click marks it.
  if (id && ui.ticking?.tree === pane.tree) return tickRow(pane, id, event.shiftKey); // Ticking for the filter: a click ticks, and opens nothing.
  if (!id) {
    // A click on nothing lets go of the selection.
    return pane ? deselect(pane) : redraw();
  }
  // A double click renames - but only a row that was the selected one already: a click on any other row
  // just goes there, at once, with no waiting to see whether a second click follows.
  if (event.detail === 1) chosen = pane.sel.size === 1 && pane.sel.has(id) ? id : undefined;
  select(pane, id, event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'range' : undefined);
  const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey && event.detail === 1;
  if (plain) cmd.open(pane, id);
});

app.addEventListener('dblclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  const treeId = event.target.closest('.bar .tab[data-tree]')?.dataset.tree;
  if (treeId) cmd.startRename({ tree: treeId });
  else if (pane && id && id === chosen && !ui.ticking && event.target.closest('.title')) cmd.startRename({ id, pane });
});

// Middle click, as on a tab: closes a live node's tab (the node stays,
// asleep); on a node that is asleep already, takes it out of the tree.
app.addEventListener('auxclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (!pane || !id || event.button !== 1 || ui.ticking) return;
  if (ui.live.has(id)) cmd.sleepOne(id);
  else cmd.remove(pane, id);
});

app.addEventListener('contextmenu', (event) => {
  if (event.target.closest('input')) return;
  event.preventDefault();
  const pane = paneAt(event.target);
  const id = idAt(event.target);
  const treeId = event.target.closest('.tab[data-tree]')?.dataset.tree;
  if (treeId) return openMenu(event.clientX, event.clientY, treeMenu(treeId));
  if (!pane) return;
  setFocus(pane);
  if (!id) return openMenu(event.clientX, event.clientY, mainMenu());
  if (pane.sel.has(id)) pointAt(id);
  else select(pane, id);
  openMenu(event.clientX, event.clientY, rowMenu(pane, id));
});

// A press anywhere else closes the menu. A press on the button it hangs from
// is that button's to answer (see menuUnder).
addEventListener(
  'pointerdown',
  (event) => {
    if (ui.menu && !event.target.closest?.('.menu') && !ui.menu.opener?.contains(event.target)) closeMenu();
  },
  true,
);

app.addEventListener('focusout', (event) => {
  if (event.target.closest?.('.rename')) cmd.endRename(true);
});

app.addEventListener('input', (event) => {
  if (event.target.closest('.journal-search')) searchJournal(event.target.value);
  else if (event.target.closest('.search')) search(event.target.value);
});

async function main() {
  // (A scenario may open the panel as a page of one window and point it at another.)
  watch(Number(new URLSearchParams(location.search).get('window')) || (await chrome.windows.getCurrent()).id);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'changed') refresh();
  });
  chrome.tabs.onActivated.addListener((info) => info.windowId === ui.windowId && refresh());
  setInterval(() => ui.journal.length && redraw(), 30_000); // "5 min ago" grows old by itself.
  await refresh();
  log('ready, window', ui.windowId, '|', ui.panes.map((pane) => `${pane.tree}: ${pane.rows.length} rows`).join(', '));
}

main();
