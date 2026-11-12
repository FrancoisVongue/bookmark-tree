// The settings page: where the library is kept and how to get it back -
// sync, versions, files, the trash - and the list of keys. Like the panel,
// it only shows the worker's state and sends it commands.

import { html, render, nothing } from '../vendor/lit-html/lit-html.js';
import { validTree } from '../model.js';
import { fromHtml, fromOutline } from '../bookmarks.js';
import { t } from '../i18n.js';
import { askForBookmarks, pickFile, saveFile } from '../page.js';
import { iconView, titleOf } from '../panel/view.js';

const app = document.getElementById('app');
const send = (message) => chrome.runtime.sendMessage(message).catch((error) => console.log('[tree settings]', message.type, error.message));
const op = (name, args) => send({ type: 'op', op: name, args });
const uuid = () => crypto.randomUUID();

const page = {
  windowId: undefined,
  library: undefined,
  trouble: undefined, // What the worker could not do: read the library, or save it.
  tree: undefined, // The tree this window's panel shows: restored pages go there.
  sync: {}, // { repo, hasToken, at, error, outOfStep }
  versions: undefined, // [{ ref, at, local }], or undefined while they are being fetched.
  keys: {}, // The browser-wide shortcuts as they are set now: { [command]: keys }.
  busy: false,
  said: undefined, // { text, undo } - what was just done, and whether it can be undone.
};

/** What each key does. The browser-wide ones (the third item names the command) can be changed by the user. */
const KEYS = [
  ['', 'actionTitle', '_execute_action'],
  ['Ctrl+Shift+Enter', 'newChild', 'new-child'],
  ['Ctrl+Enter', 'newSibling', 'new-sibling'],
  ['Ctrl+G', 'newGroup'],
  ['Ctrl+M', 'newNote'],
  ['Ctrl+F', 'search'],
  ['↑ ↓ ← →', 'keysMove'],
  ['Shift+↑ ↓ · Ctrl+A', 'keysSelect'],
  ['Enter', 'keysOpen'],
  ['F2', 'rename'],
  ['Tab · Shift+Tab', 'keysIndent'],
  ['Ctrl+D', 'duplicate'],
  ['Ctrl+V', 'keysPaste'],
  ['Del', 'remove'],
  ['Shift+Del', 'deleteEverywhere'],
  ['Ctrl+Z · Ctrl+Shift+Z', 'keysUndo'],
  ['Esc', 'keysEscape'],
];

// --- From the worker's state to the page ---------------------------------------

async function refresh() {
  const [state, sync, commands] = await Promise.all([send({ type: 'get-state' }), send({ type: 'sync-get' }), chrome.commands.getAll()]);
  if (!state) return;
  page.library = state.library;
  page.trouble = state.trouble;
  page.tree = validTree(state.library, state.windows[page.windowId]);
  page.sync = sync ?? {};
  page.keys = Object.fromEntries(commands.map((command) => [command.name, command.shortcut]));
  draw();
}

async function refreshVersions() {
  page.versions = (await send({ type: 'sync-history' })) ?? [];
  draw();
}

let saidTimer;
function say(text, undo = false) {
  clearTimeout(saidTimer);
  page.said = { text, undo };
  draw();
  saidTimer = setTimeout(() => ((page.said = undefined), draw()), 8000);
}

/** Does something that takes a while with the buttons held, then shows everything afresh. */
async function during(task) {
  page.busy = true;
  draw();
  try {
    await task();
  } finally {
    page.busy = false;
    await refresh();
    await refreshVersions();
  }
}

// --- What the buttons do -------------------------------------------------------

/** Adds a tree from `data` ({ nodes, tree }) and says what it is called now. */
async function addTree(data) {
  const id = uuid();
  await op('import', { id, data });
  await refresh();
  if (page.library.trees[id]) say(t('imported', page.library.trees[id].name), true);
  else say(t('importFailed'));
}

/** Takes in a file: a tree of ours, a bookmarks file of any browser, or a backup of the whole library. */
async function importFile() {
  const file = await pickFile('.json,.html,.htm');
  if (!file) return;
  const text = await file.text();
  try {
    if (text.trimStart().startsWith('<')) return await addTree(fromOutline(fromHtml(text), file.name.replace(/(\.bookmarks)?\.[^.]*$/, ''), uuid));
    const data = JSON.parse(text);
    if (data.trees) {
      const refused = await send({ type: 'restore-file', library: data });
      return say(refused ?? t('restored'), !refused);
    }
    if (!data.nodes || !data.tree?.children) throw new Error('not a tree file');
    await addTree(data);
  } catch (error) {
    console.log('[tree settings] import failed', error.message);
    say(t('importFailed'));
  }
}

/** The browser's bookmarks as a new tree. */
async function importBookmarks() {
  if (!(await askForBookmarks())) return;
  const outline = (items) =>
    items.map((item) =>
      item.url
        ? { title: item.title, url: item.url, added: item.dateAdded }
        : { title: item.title || t('untitled'), added: item.dateAdded, children: outline(item.children ?? []) },
    );
  const [root] = await chrome.bookmarks.getTree();
  await addTree(fromOutline(outline(root.children.filter((folder) => folder.children?.length)), t('bookmarks'), uuid));
}

const actions = {
  'sync-save': () =>
    during(async () => {
      const field = (name) => app.querySelector(`[name="${name}"]`).value.trim();
      await send({ type: 'sync-set', repo: field('repo'), token: field('token'), api: page.sync.api });
      await send({ type: 'sync-now' });
    }),
  'sync-now': () => during(() => send({ type: 'sync-now' })),
  version: ({ ref, label }) =>
    during(async () => {
      await send({ type: 'sync-restore', ref });
      say(t('wentToVersion', label), true);
    }),
  'import-file': importFile,
  'import-bookmarks': importBookmarks,
  // The whole library, as a file to keep somewhere safe.
  backup: () => saveFile(`tree-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(page.library), 'application/json'),
  restore: ({ node }) => op('restore', { tree: page.tree, ids: [node] }),
  'trash-empty': async () => {
    await op('trash-empty');
    say(t('trashEmptied'), true);
  },
  'keys-change': () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }),
  undo: () => {
    page.said = undefined;
    send({ type: 'undo' });
  },
};

app.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]({ ...el.dataset });
});

// --- What it looks like --------------------------------------------------------

const button = (action, label, { primary = false, disabled = false } = {}) =>
  html`<button class="button ${primary ? 'primary' : ''}" data-action=${action} ?disabled=${disabled || page.busy}>${label}</button>`;

const when = ({ at, local }) => (local ? `${new Date(at).toLocaleDateString()} · ${t('localBackup')}` : new Date(at).toLocaleString());

function syncView() {
  const { sync, busy } = page;
  const status = sync.error ? html`<p class="hint error">${t('syncError', sync.error)}</p>` : sync.at ? html`<p class="hint">${t('syncLast', when(sync))}</p>` : nothing;
  return html`<section>
    <h2>${t('syncTitle')}</h2>
    <p class="hint">${t('syncHint')}</p>
    <label class="field">${t('syncRepo')}<input name="repo" placeholder="owner/repository" .value=${sync.repo ?? ''} /></label>
    <label class="field">
      ${t('syncToken')}
      <input name="token" type="password" placeholder=${sync.hasToken ? t('syncTokenSaved') : 'github_pat_…'} />
    </label>
    ${status} ${sync.outOfStep ? html`<p class="hint error">${t('outOfStep')}</p>` : nothing}
    <div class="buttons">
      ${button('sync-save', t(busy ? 'syncBusy' : 'syncSave'), { primary: true })} ${button('sync-now', t('syncNow'), { disabled: !sync.repo })}
    </div>
  </section>`;
}

function versionsView() {
  const { versions } = page;
  return html`<section>
    <h2>${t('versions')}</h2>
    <p class="hint">${t(versions?.length === 0 ? 'versionsNone' : 'versionsHint')}</p>
    <div>
      ${(versions ?? []).map(
        (version) => html`<div class="item">
          <span class="title">${when(version)}</span>
          <button class="pill" data-action="version" data-ref=${version.ref} data-label=${when(version)} ?disabled=${page.busy}>
            ${t('goToVersion')}
          </button>
        </div>`,
      )}
    </div>
  </section>`;
}

const filesView = () =>
  html`<section>
    <h2>${t('files')}</h2>
    <p class="hint">${t('filesHint')}</p>
    <div class="buttons">
      ${button('backup', t('backUpAll'))} ${button('import-file', t('importTree'))} ${button('import-bookmarks', t('importBookmarks'))}
    </div>
  </section>`;

function trashView() {
  const trash = page.library.trash.toReversed();
  return html`<section>
    <h2>${t('trash')} (${trash.length})</h2>
    <p class="hint">${t('trashHint', page.library.trees[page.tree].name)}</p>
    <div>
      ${trash.map(
        ({ node, at }) => html`<div class="item" title=${node.url ?? ''}>
          ${iconView(node)}<span class="title">${titleOf(node)}</span>
          <span class="when">${new Date(at).toLocaleDateString()}</span>
          <button class="pill" data-action="restore" data-node=${node.id}>${t('restore')}</button>
        </div>`,
      )}
    </div>
    ${trash.length ? html`<div class="buttons">${button('trash-empty', t('emptyTrash'))}</div>` : nothing}
  </section>`;
}

const keysView = () =>
  html`<section>
    <h2>${t('shortcuts')}</h2>
    <div class="keys">
      ${KEYS.map(([keys, what, command]) => {
        const all = [command && (page.keys[command] || t('keysNotSet')), keys].filter(Boolean);
        return html`<kbd>${all.join(' · ')}</kbd><span>${t(what)}</span>`;
      })}
    </div>
    <div class="buttons">${button('keys-change', t('keysChange'))}</div>
  </section>`;

function draw() {
  if (!page.library) return;
  render(
    html`
      <h1>${t('settingsTitle')}</h1>
      ${page.trouble ? html`<p class="trouble">${page.trouble}</p>` : nothing}
      ${syncView()} ${versionsView()} ${filesView()} ${trashView()} ${keysView()}
      ${page.said
        ? html`<div class="toast">
            <span>${page.said.text}</span>
            ${page.said.undo ? html`<button class="pill" data-action="undo">${t('undo')}</button>` : nothing}
          </div>`
        : nothing}
    `,
    app,
  );
}

async function main() {
  document.title = t('settingsTitle');
  page.windowId = (await chrome.windows.getCurrent()).id;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'changed') refresh();
  });
  await refresh();
  await refreshVersions();
}

main();
