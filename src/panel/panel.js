// The panel's entry: the mouse, and the start. It turns what the user does
// into commands for the worker (see screen.js for what the panel itself owns).

import { app, arrange, closeOverlay, here, idAt, log, newPane, op, paneAt, picker, redraw, refresh, revealActive, rowOf, send, setFocus, showActiveTree, targets, ui } from './screen.js';
import { mainMenu, menuUnder, openMenu, rowMenu, treeMenu } from './menus.js';
import { endsDrag } from './drag.js';
import * as cmd from './commands.js';
import './keys.js';

// What the buttons do, by their data-action.
const actions = {
  collapse: ({ pane, id }) => cmd.toggle(pane, id),
  child: ({ pane, id }) => cmd.newTab(pane, id, 'child'),
  sleep: ({ pane, id }) => send({ type: 'sleep', ids: targets(pane, id), treeId: pane.tree }),
  remove: ({ pane, id }) => cmd.remove(pane, id),
  home: ({ id }) => send({ type: 'go-home', nodeId: id }),
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
  'tree-show': ({ el }) => {
    here().tree = el.dataset.tree;
    here().sel.clear();
    arrange();
  },
  'tree-add': ({ el }) => cmd.newTree(Number(el.dataset.cell)),
  'pane-close': ({ pane }) => {
    ui.panes.splice(ui.panes.indexOf(pane), 1);
    ui.focus = 0;
    arrange();
  },
  more: ({ el }) => menuUnder(el, mainMenu()),
  'split-row': () => cmd.split('row'),
  'split-column': () => cmd.split('column'),
  'picker-tree': ({ el }) => {
    ui.overlay = { kind: 'picker', ...newPane(el.dataset.tree), into: picker().into };
    arrange();
  },
  // What is chosen in the picker is shown here too, or (the "move" button) moves here.
  'picker-add': ({ el }) => {
    const { tree, sel, into } = picker();
    const { pane, id } = into;
    op('move', { tree: pane.tree, from: tree, ids: [...sel], target: id, position: id ? 'inside' : 'end', take: 'take' in el.dataset });
    if (id) op('collapse', { tree: pane.tree, id, collapsed: false }); // So what was added is seen.
    closeOverlay();
  },
  icon: ({ el }) => cmd.setIcon(el.dataset.icon),
  settings: cmd.openSettings,
  // The notice stays closed until there is something else to say.
  'unsynced-close': () => {
    localStorage.setItem('unsyncedClosed', ui.unsynced.kind);
    arrange();
  },
  'journal-go': ({ el }) => cmd.revisit(el.dataset.node, el.dataset.tree),
  'journal-more': () => {
    ui.journalAll = true;
    arrange();
  },
  'journal-toggle': () => {
    ui.journalOpen = !ui.journalOpen;
    Object.assign(ui, { journalQuery: '', journalAll: false }); // Unfolded anew, it starts from the latest places.
    localStorage.setItem('journalOpen', ui.journalOpen ? 'yes' : 'no');
    arrange();
  },
  'plan-go': ({ el }) => cmd.revisit(el.dataset.node),
  unplan: ({ el }) => op('unplan', { ids: [el.closest('.place').dataset.node] }),
  'plan-toggle': () => {
    ui.planOpen = !ui.planOpen;
    localStorage.setItem('planOpen', ui.planOpen ? 'yes' : 'no');
    redraw();
  },
  'overlay-close': closeOverlay,
  yes: () => {
    const { run } = ui.overlay;
    closeOverlay();
    run();
  },
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
    return actions[el.dataset.action]?.({ pane, id, el, event });
  }
  if (!id) {
    // A click on nothing lets go of the selection.
    if (pane) pane.sel.clear();
    return redraw();
  }
  // A double click renames - but only a row that was the selected one already: a click on any other row
  // just goes there, at once, with no waiting to see whether a second click follows.
  if (event.detail === 1) chosen = pane.sel.size === 1 && pane.sel.has(id) ? id : undefined;
  select(pane, id, event);
  redraw();
  const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey && event.detail === 1;
  if (plain && pane !== picker()) cmd.open(pane, id);
});

function select(pane, id, event) {
  if (pane === picker() || event.ctrlKey || event.metaKey) {
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

app.addEventListener('dblclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  const treeId = event.target.closest('.bar .tab[data-tree]')?.dataset.tree;
  if (treeId) cmd.startRename({ tree: treeId });
  else if (id && id === chosen && pane !== picker() && event.target.closest('.title')) cmd.startRename({ id, pane });
});

// Middle click, as on a tab: closes a live node's tab (the node stays,
// asleep); on a node that is asleep already, takes it out of the tree.
app.addEventListener('auxclick', (event) => {
  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (!id || event.button !== 1 || pane === picker()) return;
  if (ui.live.has(id)) send({ type: 'sleep-one', nodeId: id });
  else cmd.remove(pane, id);
});

app.addEventListener('contextmenu', (event) => {
  if (event.target.closest('input')) return;
  event.preventDefault();
  const pane = paneAt(event.target);
  const id = idAt(event.target);
  const treeId = event.target.closest('.tab[data-tree]')?.dataset.tree;
  if (treeId) return openMenu(event.clientX, event.clientY, treeMenu(treeId));
  if (!pane || pane === picker()) return;
  setFocus(pane);
  if (!id) return openMenu(event.clientX, event.clientY, mainMenu());
  if (!pane.sel.has(id)) pane.sel = new Set([id]);
  ui.cursor = id;
  openMenu(event.clientX, event.clientY, rowMenu(pane, id));
});

// A press anywhere else closes the menu. A press on the button it hangs from
// is that button's to answer (see menuUnder).
addEventListener(
  'pointerdown',
  (event) => {
    if (!ui.menu || event.target.closest?.('.menu') || ui.menu.opener?.contains(event.target)) return;
    ui.menu = undefined;
    redraw();
  },
  true,
);

app.addEventListener('focusout', (event) => {
  if (event.target.closest?.('.rename')) cmd.endRename(true);
});

app.addEventListener('input', (event) => {
  if (event.target.closest('.journal-search')) ui.journalQuery = event.target.value;
  else if (event.target.closest('.search')) ui.query = event.target.value;
  else return;
  arrange();
});

async function main() {
  // (A scenario may open the panel as a page of one window and point it at another.)
  ui.windowId = Number(new URLSearchParams(location.search).get('window')) || (await chrome.windows.getCurrent()).id;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'changed') refresh();
  });
  chrome.tabs.onActivated.addListener((info) => info.windowId === ui.windowId && refresh());
  setInterval(() => ui.journal.length && redraw(), 30_000); // "5 min ago" grows old by itself.
  await refresh();
  log('ready, window', ui.windowId, '|', ui.panes.map((pane) => `${pane.tree}: ${pane.rows.length} rows`).join(', '));
}

main();
