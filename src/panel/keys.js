// The keyboard.

import { app, closeOverlay, focusRow, here, idAt, op, paneAt, picker, redraw, refresh, rowOf, send, targets, ui } from './screen.js';
import { endDrag } from './drag.js';
import * as cmd from './commands.js';

addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  const letter = event.key.toLowerCase();
  if (event.target.closest?.('.rename')) {
    if (event.key === 'Enter') cmd.endRename(true);
    else if (event.key === 'Escape') cmd.endRename(false);
    return;
  }
  if (event.target.closest?.('.dialog input') && event.key !== 'Escape') {
    // Typing in a form; in the table of icons, Enter takes what was typed.
    if (event.key === 'Enter' && event.target.closest('.icons')) cmd.setIcon(event.target.value);
    return;
  }
  if (event.key === 'Escape') {
    if (ui.overlay?.kind === 'ask') return closeOverlay(); // "No" to a question, and nothing else.
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
    g: () => cmd.newGroup(here(), rowOf(here(), ui.cursor)?.id),
    m: () => cmd.newNote(here()),
  };
  if (ctrl && everywhere[letter]) {
    event.preventDefault();
    return everywhere[letter]();
  }

  const id = idAt(event.target);
  const pane = paneAt(event.target);
  if (!id || !pane || pane === picker()) return;
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
      if (row.collapsed) cmd.toggle(pane, id);
      else if (row.kids) go(pane.rows[index + 1]);
    },
    ArrowLeft: () => {
      if (row.kids && !row.collapsed) cmd.toggle(pane, id);
      else go(pane.rows.slice(0, index).findLast((above) => above.depth < row.depth));
    },
    Enter: () => {
      if (ctrl) cmd.newTab(pane, id, event.shiftKey ? 'child' : 'sibling');
      else cmd.open(pane, id);
    },
    ' ': () => cmd.open(pane, id),
    Delete: () => cmd.remove(pane, id, event.shiftKey),
    F2: () => cmd.startRename({ id, pane }),
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
  const nodes = cmd.pagesIn(event.clipboardData.getData('text'));
  if (!nodes.length) return;
  event.preventDefault();
  const target = rowOf(here(), ui.cursor)?.id;
  op('add', { tree: here().tree, nodes, target, position: target ? 'after' : 'end' });
});
