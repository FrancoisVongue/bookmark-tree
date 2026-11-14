// A table's controls, at the table itself: a "+" along its right edge adds a
// column, a "+" under its last row adds a row, and the row and the column of
// the cell in hand (the one under the pointer, or else the one the cursor is
// in) each have a handle with what can be done to them. They lie over the
// page, beside the text and not in it: nothing moves when they come, and
// nothing of them is in the note.

import { t } from '../i18n.js';
import { el } from './blocks.js';

const DOTS = '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4.5 8.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.5 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.500 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z" /></svg>';
const PLUS = '<svg class="line" viewBox="0 0 20 20" width="14" height="14"><path d="M10 4.500v11M4.500 10h11" /></svg>';
const REACH = 24; // How far from the table the pointer may go and still be at it: the controls stand in that margin.

/** Gives the tables of `editor` their controls; they lie in `main`, which holds the text. */
export function tableTools(editor, main) {
  const layer = el('div', { className: 'table-tools', hidden: true }, main);
  const control = (className, icon, title) => {
    const button = el('button', { type: 'button', className, innerHTML: icon, title, tabIndex: -1 }, layer);
    button.setAttribute('aria-label', title);
    return button;
  };
  const column = control('handle column', DOTS, `${t('noteColumn')} (Alt+C)`);
  const row = control('handle row', DOTS, `${t('noteRow')} (Alt+R)`);
  const addColumn = control('add column', PLUS, t('noteColumnAdd'));
  const addRow = control('add row', PLUS, t('noteRowAdd'));

  let hover; // The cell under the pointer.
  let cell; // The cell in hand.
  let menu; // The open menu of a handle: { element, handle }.

  /** The cell the cursor is in. */
  const own = () => {
    if (!editor.isFocused || !editor.isActive('table')) return undefined;
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    return (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('td, th');
  };
  const put = (element, box) => {
    for (const [side, value] of Object.entries(box)) element.style[side] = `${Math.round(value)}px`;
  };

  /** Puts the controls where the cell in hand is - or away, when no cell is. */
  function place() {
    if (menu) return; // An open menu speaks of the cell it was opened for.
    cell = hover?.isConnected ? hover : own();
    const frame = cell?.closest('.tableWrapper');
    layer.hidden = !frame || !editor.isEditable;
    if (layer.hidden) return;
    const origin = main.getBoundingClientRect();
    const [box, table, at] = [frame, frame.firstElementChild, cell].map((one) => one.getBoundingClientRect());
    // A table wider than the page scrolls in its frame: the controls keep to what is seen of it.
    const left = box.left - origin.left;
    const top = box.top - origin.top;
    const width = Math.min(table.width, box.width);
    const middle = Math.min(Math.max((at.left + at.right) / 2 - origin.left, left + 12), left + width - 12);
    put(column, { left: middle - 12, top: top - 15 });
    put(row, { left: left - 17, top: (at.top + at.bottom) / 2 - origin.top - 12 });
    put(addColumn, { left: left + width + 4, top, height: box.height });
    put(addRow, { left, top: top + box.height + 2, width });
  }

  /** The cursor goes into cell `one`; what is then done there is added to the chain this gives. */
  const into = (one) => editor.chain().focus().setTextSelection(editor.view.posAtDOM(one, 0) + 1);
  /** The last cell of row `index` of the table in hand (of its last row, for -1). */
  const lastCell = (index) => [...cell.closest('table').rows].at(index).lastElementChild;

  // The new row, or column, is where the cursor goes: it is there to be written in.
  addRow.addEventListener('click', () => into(lastCell(-1)).addRowAfter().goToNextCell().run());
  addColumn.addEventListener('click', () => into(lastCell(0)).addColumnAfter().goToNextCell().run());

  const whole = ['-', ['noteTableRemove', (chain) => chain.deleteTable()]];
  const menus = new Map([
    [
      row,
      // The first row is the heading, whichever row that is (see Grid in blocks.js): a row put above it becomes the heading, and so does the second row when the first goes. The only row goes with its table.
      () => [
        ['noteRowAbove', (chain) => chain.addRowBefore()],
        ['noteRowBelow', (chain) => chain.addRowAfter()],
        ['noteRowRemove', (chain, target) => (target.closest('table').rows.length > 1 ? chain.deleteRow() : chain.deleteTable())],
        ...whole,
      ],
    ],
    [
      column,
      () => [
        ['noteColumnLeft', (chain) => chain.addColumnBefore()],
        ['noteColumnRight', (chain) => chain.addColumnAfter()],
        '-',
        ['noteAlignLeft', (chain) => chain.setColumnAlign('left')],
        ['noteAlignCenter', (chain) => chain.setColumnAlign('center')],
        ['noteAlignRight', (chain) => chain.setColumnAlign('right')],
        '-',
        ['noteColumnRemove', (chain) => chain.deleteColumn()],
        ...whole,
      ],
    ],
  ]);

  function close() {
    if (!menu) return;
    menu.element.remove();
    menu.handle.removeAttribute('aria-expanded');
    menu = undefined;
    place();
  }

  function open(handle) {
    const target = cell;
    const element = el('div', { className: 'menu', role: 'menu' }, document.body);
    for (const item of menus.get(handle)().filter(Boolean)) {
      if (item === '-') el('hr', {}, element);
      else el('button', { type: 'button', role: 'menuitem', textContent: t(item[0]), onclick: () => (close(), item[1](into(target), target).run()) }, element);
    }
    const box = handle.getBoundingClientRect();
    put(element, { left: Math.min(box.left, innerWidth - element.offsetWidth - 8), top: box.bottom + 4 });
    handle.setAttribute('aria-expanded', 'true');
    menu = { element, handle };
    // The keyboard is in the menu while it is open: arrows walk it, Esc leaves it for the text.
    element.addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      const items = [...element.querySelectorAll('button')];
      if (step) items.at((items.indexOf(document.activeElement) + step) % items.length).focus();
      else if (event.key === 'Escape') (close(), editor.commands.focus());
      else return;
      event.preventDefault();
    });
    element.querySelector('button').focus();
  }

  // A press beside the open menu closes it - and a press on its own handle does only that: the click that follows must not open it again.
  let shut;
  document.addEventListener(
    'pointerdown',
    (event) => {
      shut = menu && !menu.element.contains(event.target) ? menu.handle : undefined;
      if (shut) close();
    },
    true,
  );
  for (const handle of menus.keys()) handle.addEventListener('click', () => shut === handle || open(handle));
  // From the keyboard, with the cursor in a cell: Alt+R is the row's menu, Alt+C the column's. (By the key's place, whatever letters the keyboard writes.)
  editor.view.dom.addEventListener('keydown', (event) => {
    const handle = event.altKey && !event.ctrlKey && !event.metaKey && { KeyR: row, KeyC: column }[event.code];
    if (!handle || !own()) return;
    event.preventDefault();
    close();
    hover = undefined;
    place();
    open(handle);
  });
  // A press on a control must not take the cursor out of the text.
  layer.addEventListener('mousedown', (event) => event.preventDefault());
  addEventListener('scroll', close);

  const near = ({ clientX: x, clientY: y }) => {
    const box = hover?.closest('.tableWrapper')?.getBoundingClientRect();
    return box && x > box.left - REACH && x < box.right + REACH && y > box.top - REACH && y < box.bottom + REACH;
  };
  const point = (over) => {
    if (over === hover) return;
    hover = over;
    place();
  };
  // The pointer keeps its cell on the way to the controls, which stand a little outside the table.
  main.addEventListener('pointermove', (event) => {
    const over = event.target.closest('.tiptap td, .tiptap th');
    if (over || !(layer.contains(event.target) || near(event))) point(over ?? undefined);
  });
  main.addEventListener('pointerleave', () => point(undefined));

  editor.on('transaction', place);
  editor.on('focus', place);
  editor.on('blur', place);
  addEventListener('resize', place);
  main.addEventListener('scroll', place, true); // A wide table, scrolled in its frame.
}
