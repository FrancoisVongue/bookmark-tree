// A table's controls, at the table itself: a "+" along its right edge adds a
// column, a "+" under its last row adds a row, and the row and the column of
// the cell in hand (the one under the pointer, or else the one the cursor is
// in) each have a handle with what can be done to them: put one in beside it,
// move it, sort by it, set it to a side, delete it - and a handle is dragged
// to move its row or column. The line between two columns is dragged to make
// one wider and the other narrower. They lie over the
// page, beside the text and not in it: nothing moves when they come, and
// nothing of them is in the note.

import { t } from '../i18n.js';
import { NARROWEST, el } from './blocks.js';
import { fromPercents } from './widths.js';

const DOTS = '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4.5 8.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.5 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.500 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z" /></svg>';
const PLUS = '<svg class="line" viewBox="0 0 20 20" width="14" height="14"><path d="M10 4.500v11M4.500 10h11" /></svg>';
const NEAR = 5; // How close to the line between two columns the pointer takes hold of it, in px.
const TRAVEL = 5; // How far a handle goes before it is being dragged and not pressed.
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

  const divider = el('div', { className: 'divider', hidden: true }, layer); // The line between two columns, in hand.
  const drop = el('div', { className: 'drop', hidden: true }, layer); // Where what is dragged will land.

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

  addRow.addEventListener('click', () => into(lastCell(-1)).addRowAfter().goToNextCell().run());
  addColumn.addEventListener('click', () => into(lastCell(0)).addColumnAfter().columnChanged(cell.parentElement.cells.length, true).goToNextCell().run());

  // What a handle offers: [words, what it does, whether it cannot be done here]. What is put in - a row, a column - is
  // where the cursor goes: it is there to be written in. What is moved takes the cursor along.
  const whole = ['-', ['noteTableRemove', (chain) => chain.deleteTable()]];
  const menus = new Map([
    [
      row,
      // The first row is the heading, whichever row that is (see Grid in blocks.js): a row put above it becomes the heading, and so does the second row when the first goes. The only row goes with its table. The heading itself does not move.
      ({ r, c, rows }) => [
        ['noteRowAbove', (chain) => chain.addRowBefore().goToCell(r, c)],
        ['noteRowBelow', (chain) => chain.addRowAfter().goToCell(r + 1, c)],
        '-',
        ['noteRowUp', (chain) => chain.moveRow(-1), r < 2],
        ['noteRowDown', (chain) => chain.moveRow(1), !r || r === rows - 1],
        '-',
        ['noteRowRemove', (chain) => (rows > 1 ? chain.deleteRow() : chain.deleteTable())],
        ...whole,
      ],
    ],
    [
      column,
      ({ r, c, rows, columns }) => [
        ['noteSortAsc', (chain) => chain.sortColumn(1), rows < 3],
        ['noteSortDesc', (chain) => chain.sortColumn(-1), rows < 3],
        '-',
        ['noteColumnLeft', (chain) => chain.addColumnBefore().columnChanged(c, true).goToCell(r, c)],
        ['noteColumnRight', (chain) => chain.addColumnAfter().columnChanged(c + 1, true).goToCell(r, c + 1)],
        '-',
        ['noteColumnMoveLeft', (chain) => chain.moveColumn(-1), !c],
        ['noteColumnMoveRight', (chain) => chain.moveColumn(1), c === columns - 1],
        '-',
        ['noteAlignLeft', (chain) => chain.setColumnAlign('left')],
        ['noteAlignCenter', (chain) => chain.setColumnAlign('center')],
        ['noteAlignRight', (chain) => chain.setColumnAlign('right')],
        '-',
        ['noteColumnRemove', (chain) => chain.columnChanged(c, false).deleteColumn()],
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
    const where = { r: target.parentElement.rowIndex, c: target.cellIndex, rows: target.closest('table').rows.length, columns: target.parentElement.cells.length };
    for (const item of menus.get(handle)(where)) {
      if (item === '-') el('hr', {}, element);
      else el('button', { type: 'button', role: 'menuitem', textContent: t(item[0]), disabled: Boolean(item[2]), onclick: () => (close(), item[1](into(target)).run()) }, element);
    }
    const box = handle.getBoundingClientRect();
    put(element, { left: Math.min(box.left, innerWidth - element.offsetWidth - 8), top: box.bottom + 4 });
    handle.setAttribute('aria-expanded', 'true');
    menu = { element, handle };
    // The keyboard is in the menu while it is open: arrows walk it, Esc leaves it for the text.
    element.addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      const items = [...element.querySelectorAll('button:enabled')];
      if (step) items.at((items.indexOf(document.activeElement) + step) % items.length).focus();
      else if (event.key === 'Escape') (close(), editor.commands.focus());
      else return;
      event.preventDefault();
    });
    element.querySelector('button:enabled').focus();
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
  let dragged; // The press that ended a drag is not a press on the handle.
  for (const handle of menus.keys()) handle.addEventListener('click', () => shut === handle || dragged || open(handle));

  /**
   * A handle is dragged along its table to move its column (`across`) or its row: a line shows between which two it
   * will land, and letting go moves it there in one step. The handle goes with the pointer. The heading row does not
   * move, and nothing lands above it.
   */
  const drag = (handle, across) =>
    handle.addEventListener('pointerdown', (event) => {
      dragged = false;
      if (event.button || menu || !cell) return;
      const target = cell;
      const table = target.closest('table');
      const from = across ? target.cellIndex : target.parentElement.rowIndex;
      if (!across && !from) return;
      const where = (e) => (across ? e.clientX : e.clientY);
      const start = where(event);
      let to;
      const move = (e) => {
        if (to === undefined && Math.abs(where(e) - start) < TRAVEL) return;
        const boxes = (across ? [...table.rows[0].cells] : [...table.rows]).map((one) => one.getBoundingClientRect());
        const lines = across ? [boxes[0].left, ...boxes.map((box) => box.right)] : [boxes[0].top, ...boxes.map((box) => box.bottom)];
        const first = across ? 0 : 1;
        const line = lines.reduce((best, at, i) => (i >= first && Math.abs(at - where(e)) < Math.abs(lines[best] - where(e)) ? i : best), first);
        to = line > from ? line - 1 : line;
        const [origin, box] = [main, table].map((one) => one.getBoundingClientRect());
        put(drop, across ? { left: lines[line] - origin.left - 1, top: box.top - origin.top, width: 2, height: box.height } : { left: box.left - origin.left, top: lines[line] - origin.top - 1, width: box.width, height: 2 });
        drop.hidden = to === from;
        handle.style.translate = across ? `${where(e) - start}px 0` : `0 ${where(e) - start}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.style.translate = '';
        drop.hidden = true;
        dragged = to !== undefined;
        if (dragged && to !== from) into(target)[across ? 'moveColumn' : 'moveRow'](to - from).run();
      };
      handle.setPointerCapture(event.pointerId);
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  drag(column, true);
  drag(row, false);

  // The line between two columns. Near it the pointer takes hold of it: dragged, it makes the column on its left wider
  // and the one on its right narrower, or the other way - the two share what they had, and the table stays as wide as
  // it was. Pressed twice, it fits the left column to what is written in it, as in a spreadsheet.
  let resizing;
  const columnsOf = (table) => [...table.querySelectorAll(':scope > colgroup > col')];
  const partsOf = (table) => columnsOf(table).map((one) => parseFloat(one.style.width));
  /** The least a column of `table` may take, in percent of the table. */
  const least = (table, pair) => Math.min((NARROWEST / table.getBoundingClientRect().width) * 100, pair / 2);
  /** The columns of `table` take `parts` percent of it each: seen at once, and kept in the note if `keep`. */
  const widen = (table, parts, keep) => {
    columnsOf(table).forEach((one, i) => (one.style.width = `${parts[i]}%`));
    if (keep) editor.commands.setColumnWidths(editor.view.posAtDOM(table.tBodies[0], 0) - 1, fromPercents(parts.map((part) => (part * table.dataset.sum) / 100)));
  };
  function seek(event) {
    if (resizing || menu) return;
    const table = cell?.closest('table');
    const frame = table?.parentElement.getBoundingClientRect();
    const box = table?.getBoundingClientRect();
    const lines = table ? [...table.rows[0].cells].slice(0, -1).map((one) => one.getBoundingClientRect().right) : [];
    const index = lines.findIndex((x) => Math.abs(x - event.clientX) <= NEAR && x > frame.left && x < frame.right);
    divider.hidden = index < 0 || event.clientY < box.top || event.clientY > box.bottom;
    if (divider.hidden) return;
    const origin = main.getBoundingClientRect();
    Object.assign(divider, { table, index });
    put(divider, { left: lines[index] - origin.left - NEAR, top: box.top - origin.top, height: box.height });
  }
  divider.addEventListener('pointerdown', (event) => {
    if (event.button) return;
    const { table, index } = divider;
    const was = partsOf(table);
    const pair = was[index] + was[index + 1];
    const width = table.getBoundingClientRect().width;
    const [start, left] = [event.clientX, parseFloat(divider.style.left)];
    let now;
    const move = (e) => {
      const part = Math.min(Math.max(was[index] + ((e.clientX - start) / width) * 100, least(table, pair)), pair - least(table, pair));
      now = was.map((one, i) => (i === index ? part : i === index + 1 ? pair - part : one));
      widen(table, now);
      divider.style.left = `${left + ((part - was[index]) / 100) * width}px`;
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', up);
      resizing = false;
      if (now) widen(table, now, true);
    };
    resizing = true;
    divider.setPointerCapture(event.pointerId);
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
  });
  divider.addEventListener('dblclick', () => {
    const { table, index } = divider;
    const was = partsOf(table);
    const pair = was[index] + was[index + 1];
    const cells = [...table.rows].map((one) => one.cells[index]);
    // What the column's cells would take with nothing in them broken into lines.
    columnsOf(table)[index].style.width = '1px';
    cells.forEach((one) => (one.style.whiteSpace = 'nowrap'));
    const needed = Math.max(...cells.map((one) => one.scrollWidth)) + 2;
    cells.forEach((one) => (one.style.whiteSpace = ''));
    const part = Math.min(Math.max((needed / table.getBoundingClientRect().width) * 100, least(table, pair)), pair - least(table, pair));
    widen(table, was.map((one, i) => (i === index ? part : i === index + 1 ? pair - part : one)), true);
    divider.hidden = true;
  });
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
    seek(event);
  });
  main.addEventListener('pointerleave', () => point(undefined));

  editor.on('transaction', place);
  editor.on('focus', place);
  editor.on('blur', place);
  addEventListener('resize', place);
  main.addEventListener('scroll', place, true); // A wide table, scrolled in its frame.
}
