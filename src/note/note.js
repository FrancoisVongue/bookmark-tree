// A note's page. The note is written the way it looks: typing markdown
// ("# ", "- ", "[ ] ", "**bold**") turns into formatting at once. The text
// lives in the library as markdown; this page only sends changes.

import { Editor, Link, Markdown, Placeholder, StarterKit, TaskItem, TaskList } from '../vendor/tiptap/tiptap.js';
import { t } from '../i18n.js';

const log = (...args) => console.log('[tree note]', ...args);
const id = new URLSearchParams(location.search).get('id');
const send = (message) => chrome.runtime.sendMessage(message).catch((error) => log('failed', message.type, error.message));

const editor = new Editor({
  element: document.getElementById('note'),
  extensions: [
    StarterKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder: t('notePlaceholder') }),
    Markdown.configure({ linkify: true, transformPastedText: true }),
  ],
  autofocus: 'end',
  onUpdate: () => {
    name();
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  },
});

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
  editor.commands.setContent(node.note, false);
  name();
}

// A link opens in a new tab, which becomes a child of the note in the tree.
document.getElementById('note').addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  event.preventDefault();
  send({ type: 'open-link', url: link.href });
});

// Leaving the page must not lose the last words typed.
addEventListener('pagehide', save);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'changed') load();
});

load();
