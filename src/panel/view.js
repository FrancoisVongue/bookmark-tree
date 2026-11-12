// What the panel shows, as a function of what it knows. No decisions here.

import { html, render, nothing } from '../vendor/lit-html/lit-html.js';
import { repeat } from '../vendor/lit-html/directives/repeat.js';
import { descendantsOf, isGroup, isNote, parentOf } from '../model.js';
import { t } from '../i18n.js';

const svg = (path) => html`<svg viewBox="0 0 20 20" width="16" height="16"><path d=${path} /></svg>`;
const ICONS = {
  chevron: svg('M7 5l6 5-6 5z'),
  close: svg('M5.3 4.2 10 8.9l4.7-4.7 1.1 1.1L11.1 10l4.7 4.7-1.1 1.1L10 11.1l-4.7 4.7-1.1-1.1L8.9 10 4.2 5.3z'),
  sleep: svg('M11.5 3a7 7 0 1 0 5.5 11.3A6 6 0 0 1 11.5 3z'),
  add: svg('M9.2 4h1.6v5.2H16v1.6h-5.2V16H9.2v-5.2H4V9.2h5.2z'),
  home: svg('M10 3 3 9.2h2V16h3.6v-4h2.8v4H15V9.2h2z'),
  more: svg('M4.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'),
  group: svg('M3 5.5A1.5 1.5 0 0 1 4.5 4h3.3l1.6 1.8h6.1A1.5 1.5 0 0 1 17 7.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z'),
  note: svg('M5 3h7l3 3v11H5zm1.6 1.6v10.8h6.8V7h-2.6V4.6zM8 9h4v1.4H8zm0 2.8h4v1.4H8z'),
  undo: svg('M8.5 4 3.5 8.5l5 4.5V10c3 0 5 1 6.5 4-.3-4.5-2.8-7.3-6.5-7.6z'),
  sound: svg('M4 8v4h2.7L10 15V5L6.7 8zm8-1.2v6.4a3.5 3.5 0 0 0 0-6.4z'),
  search: svg('M8.7 3a5.7 5.7 0 0 1 4.5 9.2l3.6 3.5-1.1 1.1-3.6-3.5A5.7 5.7 0 1 1 8.7 3zm0 1.6a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2z'),
  shared: svg('M7 4h9v9h-2V6H7zM4 7h9v9H4zm1.6 1.6v5.8h5.800V8.6z'),
};

export const EMOJI = [
  ...'⭐ ❤️ 🔥 ✅ ❌ ⚠️ ❓ 💡 📌 📎 🔒 🔑 🔔 🏷️ 🎯 🚀'.split(' '),
  ...'📁 📂 📄 📝 📚 📖 🗂️ 🗒️ 📅 ⏰ ⌛ 📊 📈 💰 🛒 🎁'.split(' '),
  ...'💻 🖥️ 📱 ⚙️ 🔧 🧪 🐞 🧩 🌐 🔗 ✉️ 💬 📷 🎬 🎵 🎮'.split(' '),
  ...'🏠 🏢 🏦 🏥 ✈️ 🚗 🍔 ☕ 🌱 🌙 ☀️ 🌈 🧠 👤 👥 🎓'.split(' '),
];

/** What each key does, for the list of shortcuts. */
const KEYS = [
  ['Alt+T', 'actionTitle'],
  ['Alt+C · Ctrl+Shift+Enter', 'newChild'],
  ['Alt+N · Ctrl+Enter', 'newSibling'],
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

/** Chrome's own icon cache: works for sleeping pages and chrome:// pages too. */
function faviconOf(url) {
  if (!url) return '';
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;
}

const firstLine = (text) => text.split('\n').find((line) => line.trim())?.replace(/^[#>\-*\s[\]x]+/, '').trim();

export const titleOf = (node) =>
  node.name || (isNote(node) ? firstLine(node.note) || t('note') : node.title || node.url || t('untitled'));

/** Away from the address it is pinned to. */
const isAway = (node) => node.home && node.url !== node.home.url;

function iconView(node) {
  if (node.icon) return html`<span class="favicon emoji">${node.icon}</span>`;
  if (isGroup(node)) return html`<span class="favicon glyph">${ICONS.group}</span>`;
  if (isNote(node)) return html`<span class="favicon glyph">${ICONS.note}</span>`;
  return html`<img class="favicon" alt="" draggable="false" src=${faviconOf(node.url)} />`;
}

const act = (action, icon, title, more = '') =>
  html`<button class="act ${more}" data-action=${action} tabindex="-1" title=${title}>${ICONS[icon]}</button>`;

function rowView(row, pane, ui, holder, included) {
  const node = ui.library.nodes[row.id];
  if (!node) return '';
  const picking = pane === ui.overlay;
  const live = ui.live.has(row.id);
  const drop = ui.drop?.pane === pane && ui.drop.targetId === row.id && ui.drop.position;
  const shared = ui.shared.get(row.id);
  const classes = [
    'row',
    live ? 'live' : 'asleep',
    isGroup(node) && 'group',
    row.id === ui.activeId && 'active',
    row.id === holder && 'holds-active',
    pane.sel.has(row.id) && 'selected',
    included?.has(row.id) && 'included',
    row.kids && 'parent',
    row.collapsed && 'collapsed',
    node.home && 'pinned',
    ui.drag?.kind === 'rows' && ui.drag.from === pane.tree && ui.drag.ids.includes(row.id) && 'dragging',
    drop && `drop-${drop}`,
  ];
  const title = titleOf(node);
  const editing = ui.renaming?.id === row.id && ui.renaming.pane === pane && ui.renaming;
  return html`
    <div
      class=${classes.filter(Boolean).join(' ')}
      data-id=${row.id}
      role="treeitem"
      aria-level=${row.depth + 1}
      aria-selected=${pane.sel.has(row.id)}
      tabindex=${pane === ui.panes[ui.focus] && row.id === ui.cursor ? 0 : -1}
      style="--depth:${row.depth}"
      title="${title}${node.url ? `\n${node.url}` : ''}"
    >
      <button class="twisty" data-action="collapse" tabindex="-1" title=${t(row.collapsed ? 'expand' : 'collapse')}>
        ${ICONS.chevron}
      </button>
      ${picking ? html`<span class="check"></span>` : ''} ${iconView(node)}
      ${editing
        ? html`<input class="rename" .value=${editing.field === 'url' ? node.url : title} aria-label=${t('renameHint')} />`
        : html`<span class="title">${title}</span>`}
      ${ui.audible.has(row.id) ? html`<span class="mark" title=${t('playing')}>${ICONS.sound}</span>` : ''}
      ${shared ? html`<span class="mark" title=${t('alsoIn', shared.join(', '))}>${ICONS.shared}</span>` : ''}
      ${row.hidden ? html`<span class="badge">${row.hidden}</span>` : ''}
      ${picking || editing
        ? ''
        : html`
            ${isAway(node) ? act('home', 'home', t('backHome', node.home.title || node.home.url), 'away') : ''}
            ${act('child', 'add', t('newChild'))} ${live ? act('sleep', 'sleep', t('sleep')) : ''}
            ${act('remove', 'close', t(row.collapsed ? 'removeBranch' : 'remove'))}
          `}
    </div>
  `;
}

/** The collapsed row that hides the active node, if any (it never opens by itself, only shows a mark). */
function holderOf(pane, ui) {
  const tree = ui.library.trees[pane.tree];
  const shown = new Set(pane.rows.map((row) => row.id));
  let id = ui.activeId;
  while (id !== undefined && !shown.has(id)) id = parentOf(tree, id);
  return id === ui.activeId ? undefined : id;
}

/** One tree. The same view serves the panes of the panel and the picker. */
function paneView(pane, index, ui) {
  const holder = holderOf(pane, ui);
  const picking = pane === ui.overlay;
  const focused = pane === ui.panes[ui.focus];
  const tree = ui.library.trees[pane.tree];
  // In the picker a chosen node brings its subtree along: show that.
  const included = picking ? new Set([...pane.sel].flatMap((id) => descendantsOf(tree, id))) : undefined;
  return html`
    ${index > 0 ? html`<div class="divider" data-divider=${index}></div>` : ''}
    <section
      class="pane ${focused ? 'focused' : ''} ${ui.drop?.pane === pane && ui.drop.position === 'end' ? 'drop-end' : ''}"
      data-pane=${index}
      style="flex-grow:${pane.size ?? 1}"
    >
      ${ui.panes.length > 1 && !picking
        ? html`<header class="pane-head">
            <span>${tree.name}</span>
            ${focused ? html`<span class="here">${t('newTabsHere')}</span>` : ''}
            ${act('pane-close', 'close', t('closePane'))}
          </header>`
        : ''}
      <div class="tree" role="tree" aria-label=${tree.name}>
        ${repeat(pane.rows, (row) => row.id, (row) => rowView(row, pane, ui, holder, included))}
      </div>
      ${pane.rows.length || picking ? '' : html`<p class="hint">${t(ui.query ? 'nothingFound' : 'emptyTree')}</p>`}
    </section>
  `;
}

function treeTabs(ui, current, action) {
  return Object.values(ui.library.trees).map((tree) =>
    ui.renaming?.tree === tree.id
      ? html`<input class="rename tree-name" .value=${tree.name} aria-label=${t('renameHint')} />`
      : html`<button class="tab ${tree.id === current ? 'current' : ''}" data-action=${action} data-tree=${tree.id}>
          ${tree.name}
        </button>`,
  );
}

function menuView(menu) {
  return html`
    <div class="menu" role="menu" style="left:${menu.x}px; top:${menu.y}px">
      ${menu.items.map((item) =>
        item
          ? html`<button role="menuitem" ?disabled=${item.disabled} @click=${item.run}>
              <span>${item.label}</span><kbd>${item.hint ?? ''}</kbd>
            </button>`
          : html`<hr />`,
      )}
    </div>
  `;
}

const dialog = (content, more = '') =>
  html`<div class="overlay" data-action="overlay-close"><div class="dialog ${more}">${content}</div></div>`;

function pickerView(ui) {
  const picker = ui.overlay;
  const { pane, id } = picker.into;
  const where = id ? t('addInto', titleOf(ui.library.nodes[id])) : t('addToEnd', ui.library.trees[pane.tree].name);
  const sources = { ...ui, library: { ...ui.library, trees: { ...ui.library.trees } } };
  delete sources.library.trees[pane.tree]; // Not from the tree they go to.
  return dialog(html`
    <h2>${where}</h2>
    <div class="tabs">${treeTabs(sources, picker.tree, 'picker-tree')}</div>
    ${paneView(picker, 'picker', ui)}
    <footer>
      <button data-action="overlay-close">${t('cancel')}</button>
      <button class="primary" data-action="picker-add" ?disabled=${!picker.sel.size}>
        ${t('addSelected', picker.sel.size)}
      </button>
    </footer>
  `);
}

const iconsView = () =>
  dialog(
    html`
      ${EMOJI.map((emoji) => html`<button data-action="icon" data-icon=${emoji}>${emoji}</button>`)}
      <button class="wide" data-action="icon" data-icon="">${t('noIcon')}</button>
    `,
    'icons',
  );

function trashView(ui) {
  const trash = ui.library.trash.toReversed();
  return dialog(html`
    <h2>${t('trash')}</h2>
    <div class="list">
      ${trash.length ? '' : html`<p class="hint">${t('trashEmpty')}</p>`}
      ${trash.map(
        ({ node, at }) => html`
          <div class="row asleep" title=${node.url ?? ''}>
            ${iconView(node)}<span class="title">${titleOf(node)}</span>
            <span class="when">${new Date(at).toLocaleDateString()}</span>
            <button class="pill" data-action="restore" data-node=${node.id}>${t('restore')}</button>
          </div>
        `,
      )}
    </div>
    <footer>
      <button data-action="trash-empty" ?disabled=${!trash.length}>${t('emptyTrash')}</button>
      <button class="primary" data-action="overlay-close">${t('done')}</button>
    </footer>
  `);
}

const keysView = () =>
  dialog(html`
    <h2>${t('shortcuts')}</h2>
    <div class="list keys">${KEYS.map(([keys, what]) => html`<kbd>${keys}</kbd><span>${t(what)}</span>`)}</div>
    <footer><button class="primary" data-action="overlay-close">${t('done')}</button></footer>
  `);

function syncView(ui) {
  const { settings, versions, busy } = ui.overlay;
  const when = (time) => new Date(time).toLocaleString();
  const status = settings.error
    ? html`<p class="hint error">${t('syncError', settings.error)}</p>`
    : html`<p class="hint">${settings.at ? t('syncLast', when(settings.at)) : t('syncHint')}</p>`;
  return dialog(html`
    <h2>${t('sync')}</h2>
    <label class="field">${t('syncRepo')}<input name="repo" placeholder="owner/repository" .value=${settings.repo ?? ''} /></label>
    <label class="field">
      ${t('syncToken')}
      <input name="token" type="password" placeholder=${settings.hasToken ? t('syncTokenSaved') : 'github_pat_…'} />
    </label>
    ${status} ${settings.outOfStep ? html`<p class="hint error">${t('outOfStep')}</p>` : ''}
    <div class="list">
      ${versions.map(
        ({ ref, at }) => html`
          <div class="row asleep">
            <span class="title">${when(at)}</span>
            <button class="pill" data-action="sync-restore" data-ref=${ref} ?disabled=${busy}>${t('goToVersion')}</button>
          </div>
        `,
      )}
    </div>
    <footer>
      <button data-action="overlay-close">${t('done')}</button>
      <button data-action="sync-now" ?disabled=${busy || !settings.repo}>${t('syncNow')}</button>
      <button class="primary" data-action="sync-save" ?disabled=${busy}>${t(busy ? 'syncBusy' : 'syncSave')}</button>
    </footer>
  `);
}

const OVERLAYS = { picker: pickerView, icons: iconsView, trash: trashView, keys: keysView, sync: syncView };

/** Draws the panel from `ui` (see screen.js). */
export function draw(container, ui) {
  if (!ui.library) return;
  const tool = (action, icon, title, disabled = false) =>
    html`<button class="act shown" data-action=${action} title=${title} ?disabled=${disabled}>${ICONS[icon]}</button>`;
  render(
    html`
      <header class="bar">
        <div class="tabs">
          ${treeTabs(ui, ui.panes[ui.focus].tree, 'tree-show')}
          <button class="tab" data-action="tree-add" title=${t('newTree')}>${ICONS.add}</button>
        </div>
        <div class="tools">
          <label class="search">
            ${ICONS.search}
            <input type="search" placeholder=${t('search')} .value=${ui.query} aria-label=${t('search')} />
          </label>
          ${tool('new-tab', 'add', t('newTab'))} ${tool('new-group', 'group', `${t('newGroup')} (Ctrl+G)`)}
          ${tool('new-note', 'note', `${t('newNote')} (Ctrl+M)`)}
          ${tool('undo', 'undo', `${t('undo')} (Ctrl+Z)`, !ui.canUndo)} ${tool('more', 'more', t('more'))}
        </div>
      </header>
      <main class="panes split-${ui.split}">${ui.panes.map((pane, index) => paneView(pane, index, ui))}</main>
      ${ui.toast
        ? html`<div class="toast">
            <span>${ui.toast}</span><button class="pill" data-action="undo">${t('undo')}</button>
          </div>`
        : nothing}
      ${ui.drag?.label ? html`<div class="ghost">${ui.drag.label}</div>` : nothing}
      ${ui.overlay ? OVERLAYS[ui.overlay.kind](ui) : nothing}
      ${ui.menu ? menuView(ui.menu) : nothing}
    `,
    container,
  );
}
