// The keyboard.

import { app, arrange, closeOverlay, focusRow, here, idAt, onTop, op, paneAt, redraw, rowOf, targets, ui } from './screen.js';
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
  // What is open on top has the keys; none of them reaches the rows under it.
  if (ui.menu) return menuKey(event);
  if (ui.overlay) return dialogKey(event);
  if (event.target.closest?.('.search')) return searchKey(event);
  if (event.key === 'Enter' && event.target.closest?.('.journal-search')) {
    // The first place found is the one meant.
    const [first] = ui.places.shown;
    return first && cmd.revisit(first.node, first.tree);
  }
  if (event.key === 'Escape') {
    if (ui.drag) endDrag();
    for (const pane of ui.panes) pane.sel.clear();
    if (ui.query || ui.journalQuery) {
      Object.assign(ui, { query: '', journalQuery: '' });
      arrange();
    }
    return closeOverlay();
  }
  const everywhere = {
    z: () => cmd.undo(event.shiftKey),
    y: () => cmd.undo(true),
    f: () => app.querySelector('.search input').select(),
    g: () => cmd.newGroup(here(), rowOf(here(), ui.cursor)?.id),
    m: () => cmd.newNote(here()),
  };
  if (ctrl && everywhere[letter]) {
    event.preventDefault();
    return everywhere[letter]();
  }

  // (A row scrolled far out of sight is not in the page, and the keys then come from the page itself: they are for the row the keyboard was on.)
  const id = idAt(event.target) ?? (event.target === document.body ? ui.cursor : undefined);
  const pane = paneAt(event.target) ?? here();
  if (!id || !pane || onTop()) return;
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

/** In a menu: the arrows walk its items, Enter and Space are the item's own, Esc closes it. */
function menuKey(event) {
  if (event.key === 'Enter' || event.key === ' ') return;
  event.preventDefault();
  if (event.key === 'Escape') return cmd.closeMenu();
  const items = [...app.querySelectorAll('.menu button:not(:disabled)')];
  const at = items.indexOf(document.activeElement);
  ({ ArrowDown: items[(at + 1) % items.length], ArrowUp: items.at(at - 1 < 0 ? -1 : at - 1), Home: items[0], End: items.at(-1) })[event.key]?.focus();
}

/** In a dialog: Esc closes it, Tab stays inside, Enter in the field of the table of icons takes what was typed. The rest is the dialog's own. */
function dialogKey(event) {
  if (event.key === 'Escape') return closeOverlay();
  if (event.key === 'Enter' && event.target.closest?.('.icons input')) return cmd.setIcon(event.target.value);
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const stops = [...app.querySelectorAll('.dialog button:not(:disabled), .dialog input')];
  const at = stops.indexOf(document.activeElement);
  stops.at(event.shiftKey ? (at < 1 ? -1 : at - 1) : (at + 1) % stops.length)?.focus();
}

/** In the search field: down goes to the first row found, Enter opens it, Esc ends the search; both give the keyboard back to the tree. */
function searchKey(event) {
  const pane = here();
  if (event.key === 'Escape') {
    ui.query = '';
    arrange();
    return focusRow(pane, ui.cursor);
  }
  if (!pane.first || !['ArrowDown', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  focusRow(pane, pane.first);
  if (event.key === 'Enter') cmd.open(pane, pane.first);
}

// Pasting addresses adds them as sleeping pages, after the row the keyboard is on.
addEventListener('paste', (event) => {
  if (event.target.closest?.('input')) return;
  const nodes = cmd.pagesIn(event.clipboardData.getData('text'));
  if (!nodes.length) return;
  event.preventDefault();
  const target = rowOf(here(), ui.cursor)?.id;
  op('add', { tree: here().tree, nodes, target, position: target ? 'after' : 'end' });
});
