// A note's page: shows the note as formatted text, or lets the user edit its
// markdown. The text lives in the library; this page only sends changes.

import { marked } from '../vendor/marked/marked.js';
import { t } from '../i18n.js';

const log = (...args) => console.log('[tree note]', ...args);
const id = new URLSearchParams(location.search).get('id');
const text = document.getElementById('text');
const shown = document.getElementById('shown');
const toggle = document.getElementById('toggle');
let editing = false;

const send = (message) => chrome.runtime.sendMessage(message).catch((error) => log('failed', message.type, error.message));

/** Markdown as page content, without anything that could run. */
function show(markdown) {
  const page = new DOMParser().parseFromString(marked.parse(markdown), 'text/html');
  for (const el of page.querySelectorAll('script, style, iframe, object, embed, link, meta, form')) el.remove();
  for (const el of page.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      if (name.startsWith('on') || /^\s*javascript:/i.test(value)) el.removeAttribute(name);
    }
  }
  shown.replaceChildren(...page.body.childNodes);
}

function draw() {
  text.hidden = !editing;
  shown.hidden = editing;
  toggle.textContent = t(editing ? 'done' : 'edit');
  if (!editing) show(text.value || t('emptyNote'));
  const title = text.value.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '');
  document.title = title || t('note');
}

async function load() {
  const state = await send({ type: 'get-state' });
  const node = state?.library.nodes[id];
  if (!node) return log('no such note', id);
  if (editing) return; // What is being typed here wins.
  text.value = node.note;
  if (!node.note) editing = true;
  draw();
  if (editing) text.focus();
}

let timer;
const save = () => send({ type: 'op', op: 'note-text', args: { id, text: text.value } });
text.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(save, 400);
});

toggle.addEventListener('click', () => {
  editing = !editing;
  if (!editing) {
    clearTimeout(timer);
    save();
  }
  draw();
  if (editing) text.focus();
});

// Leaving the page must not lose the last words typed.
addEventListener('pagehide', () => editing && save());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'changed') load();
});

load();
