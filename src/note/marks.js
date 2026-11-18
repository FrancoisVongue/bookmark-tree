// Two ways to mark text that markdown itself has no word for: gone over with
// a marker, and underlined. How each is kept in the note's markdown was
// chosen for one thing: that the text reads as text wherever else the note
// is opened.
//
//   ==marked==       as Obsidian and many others write it; where it is not
//                    known, two signs stand at either end of the words
//   <u>underlined</u>  markdown may hold HTML, and this is the tag browsers
//                    and readers have always had for it; where it is not
//                    allowed, the tag is dropped and the words stay

import { Mark, markInputRule, markPasteRule } from '../vendor/tiptap/tiptap.js';

/**
 * Reads ==these words== as marked; what is between the signs is read as
 * markdown in its turn. The signs must touch the words they hold and stand
 * free of the words around them, so that text which only has two equals
 * signs in it - "a == b", "x==y==z" - stays the text it is.
 */
function marked(state, silent) {
  const { src, pos: start, posMax: max } = state;
  const word = (char) => char !== undefined && /[\p{L}\p{N}=]/u.test(char);
  if (!src.startsWith('==', start) || word(src[start - 1]) || !/\S/.test(src[start + 2] ?? ' ')) return false;
  let end = start + 2;
  for (;;) {
    end = src.indexOf('==', end + 1);
    if (end < 0 || end + 2 > max) return false;
    if (/\S/.test(src[end - 1]) && !word(src[end + 2])) break;
  }
  if (!silent) {
    state.pos = start + 2;
    state.posMax = end;
    state.push('mark_open', 'mark', 1);
    state.md.inline.tokenize(state);
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  state.posMax = max;
  return true;
}

// Both stand outside bold, italic and the rest when written down: ==**so**==, not **==so==**, and a marker over several kinds of text stays one.
const OUTER = 1100;

const typed = /(?:^|\s)(==(?!\s)([^=]+?)(?<!\s)==)$/;
const pasted = /(?:^|\s)(==(?!\s)([^=]+?)(?<!\s)==)/g;

/** Text gone over with a marker. */
export const Marker = Mark.create({
  name: 'marker',
  priority: OUTER,
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: () => ['mark', 0],
  addCommands() {
    return { toggleMarker: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMarker() };
  },
  addInputRules() {
    return [markInputRule({ find: typed, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: pasted, type: this.type })];
  },
  addStorage() {
    return {
      markdown: {
        serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
        parse: { setup: (md) => md.inline.ruler.before('emphasis', 'marked', marked) },
      },
    };
  },
});

/** Underlined text. Read back from the note's markdown as the HTML it is written as. */
export const Underline = Mark.create({
  name: 'underline',
  priority: OUTER,
  parseHTML: () => [{ tag: 'u' }],
  renderHTML: () => ['u', 0],
  addCommands() {
    return { toggleUnderline: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleUnderline() };
  },
  addStorage() {
    return { markdown: { serialize: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true }, parse: {} } };
  },
});
