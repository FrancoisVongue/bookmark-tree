// A note's page. The note is written the way it looks: typing markdown
// ("# ", "- ", "[ ] ", "**bold**") turns into formatting at once. The text
// lives in the library as markdown; this page only sends changes.

import { Editor, Link, Markdown, Placeholder, StarterKit, TableRow, TaskItem, TaskList } from '../vendor/tiptap/tiptap.js';
import { t } from '../i18n.js';
import { Cell, Fold, FoldBody, FoldTitle, Footnote, FootnoteRef, Grid, HeaderCell, Words, followFootnote, rules } from './blocks.js';
import { Code } from './code.js';
import { tableTools } from './table.js';
import { toolbar } from './tools.js';

const log = (...args) => console.log('[tree note]', ...args);
const id = new URLSearchParams(location.search).get('id');
const send = (message) => chrome.runtime.sendMessage(message).catch((error) => log('failed', message.type, error.message));

const editor = new Editor({
  element: document.getElementById('note'),
  extensions: [
    StarterKit.configure({ codeBlock: false, text: false }), // The note has its own: see blocks.js.
    Words,
    Code,
    TaskList,
    TaskItem.configure({ nested: true }),
    Grid.configure({ renderWrapper: true }), // The frame a wide table scrolls in.
    TableRow,
    HeaderCell,
    Cell,
    Fold,
    FoldTitle,
    FoldBody,
    FootnoteRef,
    Footnote,
    Link.configure({ openOnClick: false, autolink: true, shouldAutoLink: (url) => /^https?:\/\//i.test(url) }),
    // An empty note says what to do with it, and the empty title of a foldable block what it is. (Which of the empty lines show their words: note.css.)
    Placeholder.configure({
      placeholder: ({ node }) => t(node.type.name === 'foldTitle' ? 'noteFoldTitle' : 'notePlaceholder'),
      includeChildren: true,
      showOnlyCurrent: false,
    }),
    Markdown.configure({ linkify: true, transformPastedText: true }),
  ],
  autofocus: 'end',
  onUpdate: () => {
    name();
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  },
});

// Only what is written with http(s):// is a link: "cr.MK" or "foo.bar" in a
// note is text. Typed, it is the Link extension that decides (above); read
// from markdown or pasted, it is markdown-it's linkify, which is told here
// not to guess links, and to forget the other schemes it knows.
editor.storage.markdown.parser.md.linkify.set({ fuzzyLink: false, fuzzyEmail: false }).add('mailto:', null).add('ftp:', null).add('//', null);
rules(editor.storage.markdown.parser.md);

toolbar(editor, document.getElementById('tools'));
tableTools(editor, document.querySelector('main'));

let timer;
let saved; // The text as the library has it, as far as this page knows.
const text = () => editor.storage.markdown.getMarkdown();

function save() {
  clearTimeout(timer);
  if (text() === saved) return;
  saved = text();
  send({ type: 'op', op: 'note-text', args: { id, text: saved } });
}

/** The tab is called what the note's first line says. */
function name() {
  const first = editor.getText().split('\n').find((line) => line.trim());
  document.title = first || t('note');
}

/** Takes the text from the library, unless it is what this page has already. */
async function load() {
  const state = await send({ type: 'get-state' });
  const node = state?.library.nodes[id];
  if (!node) return log('no such note', id);
  if (node.note === saved || node.note === text()) return;
  saved = node.note;
  // What the library holds is not something the person did here: "Undo" must not take the note back to an empty page.
  editor.chain().setMeta('addToHistory', false).setContent(node.note, false).run();
  name();
}

// A link opens in a new tab, which becomes a child of the note in the tree; a footnote's mark goes to its note.
document.getElementById('note').addEventListener('click', (event) => {
  if (followFootnote(editor, event.target)) return;
  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  send({ type: 'open-link', url: link.href });
});

// Under a block that ends the note - code, a table, a list, a quote - there must still be somewhere to write: a press
// below the last block starts a line there. (Footnotes are the note's end by custom, and stay it.)
editor.view.dom.addEventListener(
  'mousedown',
  (event) => {
    const last = editor.view.dom.lastElementChild;
    const kind = editor.state.doc.lastChild.type.name;
    if (event.target !== editor.view.dom || event.clientY <= last.getBoundingClientRect().bottom || kind === 'paragraph' || kind === 'footnote') return;
    event.preventDefault();
    event.stopImmediatePropagation(); // The editor would put the cursor into the block above.
    editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).focus('end').run();
  },
  true,
);

// Leaving the page must not lose the last words typed.
addEventListener('pagehide', save);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'changed') load();
});

load();
