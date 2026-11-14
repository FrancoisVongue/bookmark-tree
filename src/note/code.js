// A block of code. It is another material than the text around it: it lies
// on a dark ground and is read by colour. The colours come from its language
// - the one chosen for it or, when none is, the one it looks like - and the
// block's corner says which, and is where it is chosen: from a list, by
// typing a few letters of it. Beside it, "Copy". In the block the keys do
// what they do in a code editor.

import { CodeBlock, Decoration, DecorationSet, Plugin, languages, lowlight } from '../vendor/tiptap/tiptap.js';
import { t } from '../i18n.js';
import { el, step } from './blocks.js';

const GUESSED = languages.filter((one) => one.guessed).map((one) => one.id);
const SURE = 3; // How much of a language must be seen in the code for it to be called that language.
const SAMPLE = 4000; // A language is guessed from the code's start: a long block is not read forty times over.
const INDENT = '  ';
const CHECK = '<svg class="line" viewBox="0 0 20 20" width="14" height="14"><path d="M5 10.500l3.500 3.500L15 6.500" /></svg>';
const DOWN = '<svg class="line" viewBox="0 0 20 20" width="12" height="12"><path d="M5.500 8l4.500 4.500L14.500 8" /></svg>';

/** The language known under `name` - its own or another of its names. */
const known = (name) => languages.find((one) => one.id === name.toLowerCase() || one.aliases.includes(name.toLowerCase()));

// What was read of a block: { guess, spans }. A block that did not change is not read again.
const readings = new WeakMap();

/** Reads the code of `node`: the language it looks like, if none is chosen and one can be told, and its coloured pieces as [from, to, classes]. */
function read(node) {
  let reading = readings.get(node);
  if (reading) return reading;
  const text = node.textContent;
  const chosen = node.attrs.language;
  let language = chosen && known(chosen)?.id;
  let tree;
  if (!chosen && text.trim()) {
    tree = lowlight.highlightAuto(text.slice(0, SAMPLE), { subset: GUESSED });
    language = tree.data.relevance >= SURE ? tree.data.language : undefined;
    if (text.length > SAMPLE) tree = undefined;
  }
  if (language) tree ??= lowlight.highlight(language, text);
  const spans = [];
  let at = 0;
  const walk = (parts, classes) => {
    for (const part of parts) {
      if (part.type === 'element') walk(part.children, `${classes} ${part.properties.className.join(' ')}`);
      else if (classes) spans.push([at, (at += part.value.length), classes.trim()]);
      else at += part.value.length;
    }
  };
  if (language) walk(tree.children, '');
  reading = { guess: chosen ? undefined : language, spans };
  readings.set(node, reading);
  return reading;
}

/** The colours of every block of code in `doc`. */
function colours(doc) {
  const all = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return !node.isTextblock;
    for (const [from, to, classes] of read(node).spans) all.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: classes }));
    return false;
  });
  return DecorationSet.create(doc, all);
}

/**
 * The list a language is chosen from, under `anchor`: a field to type a few
 * letters in, "Auto" first, the language in use ticked. Arrows walk it, Enter
 * takes the one in hand, Esc leaves things as they were. A name nothing in the
 * list fits can still be given - the code is then kept under it, uncoloured.
 * `choose` gets the language's name (null for "Auto"); `done` is called when
 * the list goes, whatever was done.
 */
function pick(anchor, { chosen, guess }, choose, done) {
  const menu = el('div', { className: 'menu picker' }, document.body);
  const field = el('input', { placeholder: t('noteLanguage'), spellcheck: false, autocapitalize: 'off' }, menu);
  field.setAttribute('aria-label', t('noteLanguage'));
  const list = el('div', { role: 'listbox' }, menu);
  const current = chosen ? (known(chosen)?.id ?? chosen) : null;
  let options = [];
  let hand = 0;

  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('scroll', close);
    done();
  };
  const outside = (event) => menu.contains(event.target) || close();
  const take = (option) => (close(), choose(option.id));
  const point = (index) => {
    hand = index;
    options.forEach((option, i) => option.element.setAttribute('aria-selected', i === hand));
    options[hand]?.element.scrollIntoView({ block: 'nearest' });
  };

  const show = () => {
    const words = field.value.trim().toLowerCase();
    const fits = (one) => !words || [one.id, one.name, ...one.aliases].some((name) => name.toLowerCase().includes(words));
    // A name that starts with the letters typed comes first, then another name of the language that does, then what only holds them.
    const rank = (one) => (one.name.toLowerCase().startsWith(words) ? 0 : [one.id, ...one.aliases].some((name) => name.startsWith(words)) ? 1 : 2);
    options = languages.filter(fits).sort((a, b) => rank(a) - rank(b));
    const auto = { id: null, name: t('noteAuto'), hint: guess && known(guess).name };
    if (!words || auto.name.toLowerCase().startsWith(words)) options.unshift(auto);
    if (!options.length) options.push({ id: field.value.trim(), name: field.value.trim(), hint: t('noteLanguageAsIs') });
    list.replaceChildren();
    options.forEach((option, index) => {
      option.element = el('button', { type: 'button', role: 'option', tabIndex: -1, onclick: () => take(option), onpointermove: () => index === hand || point(index) }, list);
      el('span', { textContent: option.name }, option.element);
      if (option.hint) el('kbd', { textContent: option.hint }, option.element);
      if (option.id === current) el('span', { className: 'tick', innerHTML: CHECK }, option.element);
    });
    // The keyboard starts on the language in use; once letters are typed, on the best of what fits.
    point(words ? 0 : Math.max(0, options.findIndex((option) => option.id === current)));
  };

  field.addEventListener('input', show);
  field.addEventListener('keydown', (event) => {
    const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (by) point((hand + by + options.length) % options.length);
    else if (event.key === 'Enter') options[hand] && take(options[hand]);
    else if (event.key === 'Escape') close();
    else return;
    event.preventDefault();
  });
  menu.addEventListener('mousedown', (event) => event.target === field || event.preventDefault()); // The keyboard stays in the field.
  document.addEventListener('pointerdown', outside, true);
  addEventListener('scroll', close);

  show();
  const box = anchor.getBoundingClientRect();
  // Under the corner - or over it, where the page ends too soon; there it stands on the corner while the list grows shorter.
  const over = box.bottom + 4 + menu.offsetHeight > innerHeight && box.top > innerHeight - box.bottom;
  menu.style.left = `${Math.max(8, Math.min(box.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  if (over) menu.style.bottom = `${innerHeight - box.top + 4}px`;
  else menu.style.top = `${box.bottom + 4}px`;
  field.focus();
}

/** Where the lines the selection touches start, in the block of code it is in: positions in the text, last line first. */
function lineStarts({ $from, $to }) {
  const start = $from.start();
  const text = $from.parent.textContent;
  const starts = [];
  for (let at = text.lastIndexOf('\n', $from.parentOffset - 1) + 1; at <= $to.parentOffset && at >= 0; at = text.indexOf('\n', at) + 1 || -1) starts.unshift(start + at);
  return starts;
}

export const Code = CodeBlock.extend({
  priority: 150, // Its keys come before a list's: Tab in a block of code is the code's.

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = el('div', { className: 'code' });
      const pre = el('pre', {}, dom);
      const content = el('code', {}, pre);
      const corner = el('div', { className: 'corner', contentEditable: 'false' }, dom);
      const copy = el('button', { type: 'button', className: 'copy', tabIndex: -1, textContent: t('noteCopy') }, corner);
      const language = el('button', { type: 'button', className: 'language', tabIndex: -1, title: `${t('noteLanguage')} (Alt+L)` }, corner);
      language.setAttribute('aria-haspopup', 'listbox');

      // The corner says what colours the code: the language chosen, by its name, or "Auto" and what the code was taken for.
      const show = () => {
        const { language: chosen } = node.attrs;
        const { guess } = read(node);
        const name = chosen ? (known(chosen)?.name ?? chosen) : guess ? `${t('noteAuto')} · ${known(guess).name}` : t('noteAuto');
        language.innerHTML = `<span></span>${DOWN}`;
        language.firstChild.textContent = name;
      };
      const open = () => {
        if (language.hasAttribute('aria-expanded')) return; // The press that closed the list must not open it again.
        language.setAttribute('aria-expanded', 'true');
        pick(
          language,
          { chosen: node.attrs.language, guess: read(node).guess },
          (name) => editor.chain().focus().command(step((tr) => tr.setNodeAttribute(getPos(), 'language', name))).run(),
          () => (setTimeout(() => language.removeAttribute('aria-expanded')), editor.commands.focus()),
        );
      };
      corner.addEventListener('mousedown', (event) => event.preventDefault()); // The cursor stays in the code.
      language.addEventListener('click', open);
      dom.addEventListener('pick-language', open);

      let timer;
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

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        state: {
          init: (_, { doc }) => colours(doc),
          apply: (tr, was) => (tr.docChanged ? colours(tr.doc) : was),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    const inCode = () => editor.state.selection.$from.parent.type === this.type && editor.state.selection.$from.sameParent(editor.state.selection.$to);
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      // Tab sets the line in - every line of a selection - and Shift+Tab out; neither leaves the block.
      Tab: () => {
        if (!inCode()) return false;
        const { selection } = editor.state;
        return editor.commands.command(step((tr) => (selection.empty ? tr.insertText(INDENT) : lineStarts(selection).forEach((at) => tr.insertText(INDENT, at)))));
      },
      'Shift-Tab': () => {
        if (!inCode()) return false;
        const { selection, doc } = editor.state;
        return editor.commands.command(
          step((tr) => {
            for (const at of lineStarts(selection)) {
              const width = /^(\t| {1,2})?/.exec(doc.textBetween(at, Math.min(at + INDENT.length, selection.$from.end())))[0].length;
              if (width) tr.delete(at, at + width);
            }
          }),
        );
      },
      // A new line starts where the line above does. (Three Enters at the end still leave the block: that is the editor's own.)
      Enter: (props) => {
        if (parent.Enter?.(props)) return true;
        if (!inCode()) return false;
        const { $from } = editor.state.selection;
        const before = $from.parent.textContent.slice(0, $from.parentOffset);
        const indent = /^[ \t]*/.exec(before.slice(before.lastIndexOf('\n') + 1))[0];
        return indent ? editor.commands.command(step((tr) => tr.insertText(`\n${indent}`))) : false;
      },
      // "Select all" takes the block's code first, and the whole note the second time.
      'Mod-a': () => {
        const { $from, from, to } = editor.state.selection;
        if (!inCode() || (from === $from.start() && to === $from.end())) return false;
        return editor.commands.setTextSelection({ from: $from.start(), to: $from.end() });
      },
      // The list of languages, from the keyboard. (By the key's place, as the table's Alt+R and Alt+C are: see table.js.)
      'Alt-l': () => {
        if (!inCode()) return false;
        editor.view.domAtPos(editor.state.selection.from).node.parentElement.closest('.code')?.dispatchEvent(new Event('pick-language'));
        return true;
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        // The fence is longer than any run of backticks in the code, so the code cannot end it. It names the language only if one was chosen: a guess is not the note's.
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
