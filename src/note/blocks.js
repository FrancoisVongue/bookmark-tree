// What a note is made of beyond plain text, where the editor's own parts are
// not enough: a block that folds, footnotes, a table that markdown can hold,
// code with its language and a "copy". Each part says what it is in the
// editor, how it looks there, and how the note's markdown has it - and
// `rules` teaches the markdown reader the two that are not markdown's own.

import { CodeBlock, InputRule, Node as Part, Plugin, Table, TableCell, TableHeader, Text } from '../vendor/tiptap/tiptap.js';
import { t } from '../i18n.js';
import { block, literal, write } from './folds.js';

const mac = navigator.platform.startsWith('Mac');
/** A key as the person's keyboard has it. */
export const keys = (text) => text.replace('Mod', mac ? '⌘' : 'Ctrl');

/** A new element with `props`, put at the end of `parent` if one is named. */
export function el(tag, props, parent) {
  const made = Object.assign(document.createElement(tag), props);
  parent?.appendChild(made);
  return made;
}
/** How deep the innermost `name` around a place is; 0 if there is none. */
function depthOf($pos, name) {
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === name) return depth;
  return 0;
}
/** One step that changes the text through `change(tr)`, for a chain. (Asked only whether it can be done, it changes nothing.) */
const step = (change) => ({ tr, dispatch }) => (dispatch && change(tr), true);

// --- Text ------------------------------------------------------------------------

/** Text, written down so that a line of it is never taken for the marks of a foldable block. */
export const Words = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const text = node.text.replace(/</g, '&lt;').replace(/>/g, '&gt;'); // The note's markdown may hold HTML; its text is not that.
          if (state.atBlockStart || state.atBlank()) state.write(literal(text));
          state.text(text);
        },
      },
    };
  },
});

// --- A block that folds ----------------------------------------------------------
// A title to type in, the tree's own sign for folding, and under them any
// blocks. (How the markdown has it, and why that cannot break: folds.js.)

const CHEVRON = '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M7 5l6 5-6 5z" /></svg>';

export const Fold = Part.create({
  name: 'fold',
  group: 'block',
  content: 'foldTitle foldBody',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-fold') !== 'folded',
        renderHTML: ({ open }) => ({ 'data-fold': open ? 'open' : 'folded' }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div[data-fold]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes, 0],

  // The sign is the editor's, not the note's: it is not in the text, and a press on it is not typing.
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = el('div', { className: 'fold' });
      const twisty = el('button', { type: 'button', className: 'twisty', contentEditable: 'false', tabIndex: -1, innerHTML: CHEVRON }, dom);
      const content = el('div', {}, dom);
      const show = () => {
        dom.dataset.fold = node.attrs.open ? 'open' : 'folded';
        twisty.title = `${t(node.attrs.open ? 'collapse' : 'expand')} (${keys('Mod+Enter')})`;
        twisty.setAttribute('aria-expanded', node.attrs.open);
      };
      twisty.addEventListener('mousedown', (event) => event.preventDefault()); // The cursor stays where it is.
      twisty.addEventListener('click', () => editor.commands.toggleFold(getPos()));
      show();
      return {
        dom,
        contentDOM: content,
        update(next) {
          if (next.type !== node.type) return false;
          node = next;
          show();
          return true;
        },
        stopEvent: (event) => twisty.contains(event.target),
        ignoreMutation: (mutation) => !content.contains(mutation.target),
      };
    };
  },

  addCommands() {
    return {
      /** The blocks the selection is in become the body of a new foldable block, and the cursor goes to its title. */
      setFold: () => ({ state, chain }) => {
        const { fold, foldTitle, foldBody } = state.schema.nodes;
        const range = state.selection.$from.blockRange(state.selection.$to);
        if (!range?.parent.canReplaceWith(range.startIndex, range.endIndex, fold)) return false;
        const body = state.doc.slice(range.start, range.end).content;
        return chain()
          .command(step((tr) => tr.replaceWith(range.start, range.end, fold.create(null, [foldTitle.create(), foldBody.create(null, body)]))))
          .setTextSelection(range.start + 2)
          .run();
      },
      /** Folds or unfolds the block at `pos` - or, with none named, the innermost one the cursor is in. */
      toggleFold: (pos) => ({ state, chain }) => {
        const { $from, to } = state.selection;
        const depth = depthOf($from, 'fold');
        const at = pos ?? (depth ? $from.before(depth) : undefined);
        const node = at === undefined ? null : state.doc.nodeAt(at);
        if (node?.type.name !== 'fold') return false;
        const steps = chain().command(step((tr) => tr.setNodeAttribute(at, 'open', !node.attrs.open)));
        // The cursor does not stay in what is hidden: it goes to the end of the title.
        const titleEnd = at + node.firstChild.nodeSize;
        const hidden = node.attrs.open && to > titleEnd && $from.pos < at + node.nodeSize;
        return (hidden ? steps.setTextSelection(titleEnd) : steps).run();
      },
    };
  },

  addKeyboardShortcuts() {
    // Where the cursor stands in the innermost foldable block around it.
    const here = () => {
      const { $from, empty } = this.editor.state.selection;
      const depth = depthOf($from, 'fold');
      if (!empty || !depth) return undefined;
      const pos = $from.before(depth);
      const fold = $from.node(depth);
      return { $from, pos, fold, body: pos + 1 + fold.firstChild.nodeSize, inTitle: $from.depth === depth + 1, depth };
    };
    const { paragraph } = this.editor.schema.nodes;
    return {
      'Mod-Enter': () => this.editor.commands.toggleFold(),
      Enter: () => {
        const at = here();
        if (!at) return false;
        const { $from, pos, fold, body } = at;
        // On the title, Enter goes on to the first line of the block (opening it): a new line, unless an empty one is there.
        if (at.inTitle) {
          const first = fold.lastChild.firstChild;
          const blank = first.type === paragraph && !first.childCount;
          return this.editor
            .chain()
            .command(step((tr) => (blank ? tr : tr.insert(body + 1, paragraph.create())).setNodeAttribute(pos, 'open', true)))
            .setTextSelection(body + 2)
            .run();
        }
        // On an empty last line of the block, Enter takes the line out of it - as it does out of a list.
        const last = $from.depth === at.depth + 2 && $from.index(at.depth + 1) === fold.lastChild.childCount - 1;
        if (!last || $from.parent.type !== paragraph || $from.parent.childCount || fold.lastChild.childCount < 2) return false;
        const after = pos + fold.nodeSize - 2; // Where the block ends once the line is gone.
        return this.editor
          .chain()
          .command(step((tr) => tr.delete($from.before(), $from.after()).insert(after, paragraph.create())))
          .setTextSelection(after + 1)
          .run();
      },
      // Backspace at the start of the title takes the block apart: its title is a line again, and its lines follow.
      Backspace: () => {
        const at = here();
        if (!at?.inTitle || at.$from.parentOffset) return false;
        const { pos, fold } = at;
        const lines = [paragraph.create(null, fold.firstChild.content)];
        fold.lastChild.forEach((line) => lines.push(line));
        return this.editor
          .chain()
          .command(step((tr) => tr.replaceWith(pos, pos + fold.nodeSize, lines)))
          .setTextSelection(pos + 1)
          .run();
      },
    };
  },

  // "+++ " at the start of a line makes the line a foldable block.
  addInputRules() {
    return [
      new InputRule({
        find: /^\+\+\+ $/,
        handler: ({ range, chain, can }) => (can().setFold() ? chain().deleteRange(range).setFold().run() : null),
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        // The title and the body are written down apart, as text of their own, so that the marks around them can be chosen to fit.
        serialize(state, node) {
          const { serializer } = this.editor.storage.markdown;
          const { doc, paragraph } = node.type.schema.nodes;
          const title = serializer.serialize(doc.create(null, paragraph.create(null, node.firstChild.content)));
          state.text(write({ open: node.attrs.open, title, body: serializer.serialize(node.lastChild) }), false);
          state.closeBlock(node);
        },
      },
    };
  },
});

export const FoldTitle = Part.create({
  name: 'foldTitle',
  content: 'text*',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-fold-title]' }],
  renderHTML: () => ['div', { 'data-fold-title': '' }, 0],
});

export const FoldBody = Part.create({
  name: 'foldBody',
  content: 'block+',
  parseHTML: () => [{ tag: 'div[data-fold-body]' }],
  renderHTML: () => ['div', { 'data-fold-body': '' }, 0],
});

/** Markdown's reader meets a foldable block: its title is a line of text, its body is read as any text is. */
function foldRule(state, start, end, silent) {
  // A line counts only at the indent of what is being read; a line set out of it ends the search.
  const line = (i) => {
    if (state.isEmpty(i)) return '';
    if (state.sCount[i] < state.blkIndent) return undefined;
    return ' '.repeat(state.sCount[i] - state.blkIndent) + state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]);
  };
  const found = block(line, start, end);
  if (!found) return false;
  if (silent) return true;
  state.push('fold_open', 'div', 1).attrSet('data-fold', found.open ? 'open' : 'folded');
  state.push('fold_title_open', 'div', 1).attrSet('data-fold-title', '');
  Object.assign(state.push('inline', '', 0), { content: found.title, map: [start, start + 1], children: [] });
  state.push('fold_title_close', 'div', -1);
  state.push('fold_body_open', 'div', 1).attrSet('data-fold-body', '');
  // The body's last paragraph must not run on into the closing line.
  const { lineMax, parentType } = state;
  Object.assign(state, { lineMax: found.end, parentType: 'fold' });
  state.md.block.tokenize(state, start + 1, found.end);
  Object.assign(state, { lineMax, parentType, line: found.end + 1 });
  state.push('fold_body_close', 'div', -1);
  state.push('fold_close', 'div', -1);
  return true;
}

// --- Footnotes -------------------------------------------------------------------
// "text[^1]" in a line, and "[^1]: the note" on a line of its own - by custom
// at the end. The mark is a small raised label that goes to its note; the
// note is a block, set smaller, that says whose it is.

export const FootnoteRef = Part.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return { label: { default: '', parseHTML: (element) => element.getAttribute('data-footnote-ref'), renderHTML: ({ label }) => ({ 'data-footnote-ref': label }) } };
  },
  parseHTML: () => [{ tag: 'sup[data-footnote-ref]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['sup', HTMLAttributes, node.attrs.label],
  renderText: ({ node }) => `[^${node.attrs.label}]`,

  // Typing "[^1]" makes the mark.
  addInputRules() {
    return [
      new InputRule({
        find: /\[\^([^\]\s]+)\]$/,
        handler: ({ state, range, match }) => void state.tr.replaceWith(range.from, range.to, this.type.create({ label: match[1] })),
      }),
    ];
  },

  addStorage() {
    return { markdown: { serialize: (state, node) => state.write(`[^${node.attrs.label}]`) } };
  },
});

export const Footnote = Part.create({
  name: 'footnote',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return { label: { default: '', parseHTML: (element) => element.getAttribute('data-footnote'), renderHTML: ({ label }) => ({ 'data-footnote': label }) } };
  },
  parseHTML: () => [{ tag: 'div[data-footnote]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes, 0],

  addCommands() {
    return {
      /** A mark where the cursor is, under the first number that is free, and its note at the end of the text - where the cursor goes, to write it. */
      addFootnote: () => ({ state, chain }) => {
        const taken = new Set();
        state.doc.descendants((node) => void (node.attrs.label && taken.add(node.attrs.label)));
        let label = 1;
        while (taken.has(String(label))) label++;
        const { footnote, paragraph } = state.schema.nodes;
        let end;
        return chain()
          .insertContent({ type: 'footnoteRef', attrs: { label: String(label) } })
          .command(step((tr) => tr.insert((end = tr.doc.content.size), footnote.create({ label: String(label) }, paragraph.create()))))
          .command(({ commands }) => commands.setTextSelection(end + 2))
          .scrollIntoView()
          .run();
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        // What follows the note's first line is set in by four spaces: that is how its end is known.
        serialize: (state, node) => state.wrapBlock('    ', `[^${node.attrs.label}]: `, node, () => state.renderContent(node)),
      },
    };
  },
});

/**
 * A press on a footnote's mark goes to its note, and a press on the note's
 * label - which is all of the note that is not its text - back to the first
 * mark of that label: the cursor stands after it. Says whether `target` was either.
 */
export function followFootnote(editor, target) {
  const mark = target.closest('sup[data-footnote-ref]');
  const note = !mark && target.matches('[data-footnote]') && target;
  const first = (attribute, label) => editor.view.dom.querySelector(`[${attribute}="${CSS.escape(label)}"]`);
  const to = mark ? first('data-footnote', mark.dataset.footnoteRef) : note && first('data-footnote-ref', note.dataset.footnote);
  if (to) editor.chain().focus().setTextSelection(editor.view.posAtDOM(to, 0) + 1).scrollIntoView().run();
  return Boolean(mark || note);
}

const LABEL = /^\[\^([^\]\s]+)\]/;

/** Markdown's reader meets "[^1]: …": the note is what follows the colon and the lines set in under it. */
function footnoteRule(state, start, end, silent) {
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const from = state.bMarks[start] + state.tShift[start];
  const found = LABEL.exec(state.src.slice(from, state.eMarks[start]));
  if (!found || state.src[from + found[0].length] !== ':') return false;
  if (silent) return true;
  state.push('footnote_open', 'div', 1).attrSet('data-footnote', found[1]);
  // The first line is read from after the colon, as if it too were set in.
  const was = { bMark: state.bMarks[start], tShift: state.tShift[start], sCount: state.sCount[start], blkIndent: state.blkIndent, parentType: state.parentType };
  const text = from + found[0].length + 1;
  state.bMarks[start] = text;
  state.tShift[start] = state.src.slice(text, state.eMarks[start]).search(/\S|$/);
  state.blkIndent += 4;
  state.sCount[start] = state.blkIndent;
  state.parentType = 'footnote';
  state.md.block.tokenize(state, start, end);
  state.bMarks[start] = was.bMark;
  state.tShift[start] = was.tShift;
  state.sCount[start] = was.sCount;
  state.blkIndent = was.blkIndent;
  state.parentType = was.parentType;
  state.push('footnote_close', 'div', -1);
  return true;
}

/** Markdown's reader meets "[^1]" in a line. */
function footnoteRefRule(state, silent) {
  if (state.src[state.pos] !== '[') return false;
  const found = LABEL.exec(state.src.slice(state.pos, state.posMax));
  if (!found) return false;
  if (!silent) state.push('footnote_ref', '', 0).meta = found[1];
  state.pos += found[0].length;
  return true;
}

/** Teaches markdown's reader `md` the foldable block and the footnotes. */
export function rules(md) {
  const breaks = { alt: ['paragraph', 'reference', 'blockquote', 'list'] }; // They need no empty line before them.
  md.block.ruler.before('fence', 'fold', foldRule, breaks);
  md.block.ruler.before('reference', 'footnote', footnoteRule, breaks);
  md.inline.ruler.before('link', 'footnote_ref', footnoteRefRule);
  md.renderer.rules.footnote_ref = (tokens, i) => `<sup data-footnote-ref="${md.utils.escapeHtml(tokens[i].meta)}"></sup>`;
}

// --- Tables ----------------------------------------------------------------------
// A table is what markdown's table can hold, and no more: lines of text in a
// cell, a column that is set left, right or in the middle, no cell that
// spans others. So what is seen is what is kept.

const ALIGN = { left: ':---', center: ':---:', right: '---:' };

const cell = (Cell) =>
  Cell.extend({
    content: 'paragraph+',
    addAttributes() {
      const one = { default: 1, parseHTML: () => 1 }; // A pasted table's merged cells come apart.
      return {
        ...this.parent?.(),
        colspan: one,
        rowspan: one,
        align: {
          default: null,
          parseHTML: (element) => element.style.textAlign || null,
          renderHTML: ({ align }) => (align ? { style: `text-align: ${align}` } : {}),
        },
      };
    },
  });
export const Cell = cell(TableCell);
export const HeaderCell = cell(TableHeader);

export const Grid = Table.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      /** Sets the column the cursor is in to a side: 'left', 'center', 'right', or to none. */
      setColumnAlign: (align) => ({ state, tr, dispatch }) => {
        const { $from } = state.selection;
        const depth = depthOf($from, 'table');
        if (!depth) return false;
        const column = $from.index(depth + 1);
        const start = $from.start(depth);
        if (dispatch) {
          $from.node(depth).forEach((row, offset) => {
            let pos = start + offset + 1;
            row.forEach((one, _, index) => {
              if (index === column) tr.setNodeMarkup(pos, null, { ...one.attrs, align });
              pos += one.nodeSize;
            });
          });
        }
        return true;
      },
    };
  },

  // Whatever was done to a table - a row put above its heading, the heading deleted, a row added, a table pasted - it is set right
  // in the same step: its first row is the heading and no other row is, and every cell of a column is set to the column's side.
  addProseMirrorPlugins() {
    const settle = (transactions, _, state) => {
      if (!transactions.some((one) => one.docChanged)) return null;
      const { tableHeader, tableCell } = state.schema.nodes;
      const { tr } = state;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'table') return !node.isTextblock;
        const sides = [];
        node.forEach((row) => row.forEach((one, __, column) => (sides[column] ??= one.attrs.align ?? undefined)));
        node.forEach((row, offset, index) => {
          let at = pos + offset + 2;
          row.forEach((one, __, column) => {
            const type = index ? tableCell : tableHeader;
            const align = sides[column] ?? null;
            if (one.type !== type || one.attrs.align !== align) tr.setNodeMarkup(at, type, { ...one.attrs, align });
            at += one.nodeSize;
          });
        });
        return false;
      });
      return tr.steps.length ? tr : null;
    };
    return [...(this.parent?.() ?? []), new Plugin({ appendTransaction: settle })];
  },

  addStorage() {
    return {
      markdown: {
        // The first row is the heading. In a cell a "|" is escaped, and a new line is a <br>.
        serialize(state, node) {
          state.inTable = true;
          node.forEach((row, _, index) => {
            if (index) state.ensureNewLine();
            state.write('| ');
            row.forEach((one, __, column) => {
              if (column) state.out += ' | ';
              const from = state.out.length;
              one.forEach((line, ___, i) => {
                if (i) state.out += '<br>';
                state.renderInline(line, false);
              });
              state.out = state.out.slice(0, from) + state.out.slice(from).replace(/\|/g, '\\|').replace(/\n/g, ' ');
            });
            state.out += ' |';
            if (index) return;
            const sides = [];
            row.forEach((one) => sides.push(ALIGN[one.attrs.align] ?? '---'));
            state.ensureNewLine();
            state.write(`| ${sides.join(' | ')} |`);
          });
          state.inTable = false;
          state.closeBlock(node);
        },
      },
    };
  },
});

// --- Code ------------------------------------------------------------------------

/** A block of code says its language in its corner - a field, so the language can be set there - and beside it, under the pointer, offers to copy the code. */
export const Code = CodeBlock.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = el('div', { className: 'code' });
      const pre = el('pre', {}, dom);
      const content = el('code', {}, pre);
      const corner = el('div', { className: 'corner', contentEditable: 'false' }, dom);
      const copy = el('button', { type: 'button', tabIndex: -1, textContent: t('noteCopy') }, corner);
      const language = el('input', { placeholder: t('noteLanguage'), spellcheck: false, autocapitalize: 'off' }, corner);
      language.setAttribute('aria-label', t('noteLanguage'));
      const show = () => (language.value = node.attrs.language ?? '');
      // Enter, or leaving the field, sets the language (none, if the field is empty); Esc leaves it as it was. Both give the keyboard back to the text.
      language.addEventListener('change', () => editor.commands.command(step((tr) => tr.setNodeAttribute(getPos(), 'language', language.value.trim() || null))));
      language.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        if (event.key === 'Escape') show();
        event.preventDefault();
        language.blur();
        editor.commands.focus();
      });
      let timer;
      copy.addEventListener('mousedown', (event) => event.preventDefault());
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(node.textContent);
        copy.textContent = t('noteCopied');
        clearTimeout(timer);
        timer = setTimeout(() => (copy.textContent = t('noteCopy')), 1500);
      });
      show();
      return {
        dom,
        contentDOM: content,
        update(next) {
          if (next.type !== node.type) return false;
          node = next;
          show();
          return true;
        },
        stopEvent: (event) => corner.contains(event.target),
        ignoreMutation: (mutation) => !pre.contains(mutation.target),
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        // The fence is longer than any run of backticks in the code, so the code cannot end it.
        serialize(state, node) {
          const fence = '`'.repeat(Math.max(2, ...(node.textContent.match(/`{3,}/g) ?? []).map((run) => run.length)) + 1);
          state.write(`${fence}${node.attrs.language ?? ''}\n`);
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write(fence);
          state.closeBlock(node);
        },
      },
    };
  },
});
