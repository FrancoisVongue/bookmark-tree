// What the panel shows, as a function of what it knows. No decisions here.

import { html, render, nothing } from '../vendor/lit-html/lit-html.js';
import { repeat } from '../vendor/lit-html/directives/repeat.js';
import { descendantsOf, parentOf } from '../model.js';
import { t } from '../i18n.js';

const svg = (path) => html`<svg viewBox="0 0 20 20" width="16" height="16"><path d=${path} /></svg>`;
const ICONS = {
  chevron: svg('M7 5l6 5-6 5z'),
  close: svg('M5.3 4.2 10 8.9l4.7-4.7 1.1 1.1L11.1 10l4.7 4.7-1.1 1.1L10 11.1l-4.7 4.7-1.1-1.1L8.9 10 4.2 5.3z'),
  sleep: svg('M11.5 3a7 7 0 1 0 5.5 11.3A6 6 0 0 1 11.5 3z'),
  add: svg('M9.2 4h1.6v5.2H16v1.6h-5.2V16H9.2v-5.2H4V9.2h5.2z'),
  home: svg('M10 3 3 9.2h2V16h3.6v-4h2.8v4H15V9.2h2z'),
  more: svg('M4.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'),
};

export const EMOJI = [
  ...'⭐ ❤️ 🔥 ✅ ❌ ⚠️ ❓ 💡 📌 📎 🔒 🔑 🔔 🏷️ 🎯 🚀'.split(' '),
  ...'📁 📂 📄 📝 📚 📖 🗂️ 🗒️ 📅 ⏰ ⌛ 📊 📈 💰 🛒 🎁'.split(' '),
  ...'💻 🖥️ 📱 ⚙️ 🔧 🧪 🐞 🧩 🌐 🔗 ✉️ 💬 📷 🎬 🎵 🎮'.split(' '),
  ...'🏠 🏢 🏦 🏥 ✈️ 🚗 🍔 ☕ 🌱 🌙 ☀️ 🌈 🧠 👤 👥 🎓'.split(' '),
];

/** Chrome's own icon cache: works for sleeping pages and chrome:// pages too. */
function faviconOf(url) {
  if (!url) return '';
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;
}

const isNote = (node) => node.note !== undefined;
const firstLine = (text) => text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').trim();

export const titleOf = (node) =>
  node.name || (isNote(node) ? firstLine(node.note) || t('note') : node.title || node.url || t('untitled'));

/** Away from the address it is pinned to. */
const isAway = (node) => node.home && node.url !== node.home.url;

function iconView(node) {
  if (node.icon) return html`<span class="favicon emoji">${node.icon}</span>`;
  if (isNote(node)) return html`<span class="favicon emoji">📝</span>`;
  return html`<img class="favicon" alt="" draggable="false" src=${faviconOf(node.url)} />`;
}

function rowView(row, pane, ui, holder, included) {
  const picking = pane === ui.picker;
  const node = ui.library.nodes[row.id];
  if (!node) return '';
  const live = ui.live.has(row.id);
  const drop = ui.drop?.pane === pane && ui.drop.targetId === row.id && ui.drop.position;
  const classes = [
    'row',
    live ? 'live' : 'asleep',
    row.id === ui.activeId && 'active',
    row.id === holder && 'holds-active',
    pane.sel.has(row.id) && 'selected',
    included?.has(row.id) && 'included',
    row.kids && 'parent',
    row.collapsed && 'collapsed',
    node.home && 'pinned',
    ui.drag?.from === pane.tree && ui.drag.ids.includes(row.id) && 'dragging',
    drop && `drop-${drop}`,
  ];
  const title = titleOf(node);
  const renaming = ui.renaming?.id === row.id && ui.renaming.pane === pane;
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
      ${renaming
        ? html`<input class="rename" .value=${title} aria-label=${t('renameHint')} />`
        : html`<span class="title">${title}</span>`}
      ${row.hidden ? html`<span class="badge">${row.hidden}</span>` : ''}
      ${isAway(node) && !picking
        ? html`<button class="act away" data-action="home" tabindex="-1" title=${t('backHome', node.home.title || node.home.url)}>
            ${ICONS.home}
          </button>`
        : ''}
      ${live && !picking
        ? html`<button class="act" data-action="sleep" tabindex="-1" title=${t('sleep')}>${ICONS.sleep}</button>`
        : ''}
      ${picking
        ? ''
        : html`<button class="act" data-action="remove" tabindex="-1" title=${t('remove')}>${ICONS.close}</button>`}
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
  const picking = pane === ui.picker;
  // In the picker a chosen node brings its subtree along: show that.
  const tree = ui.library.trees[pane.tree];
  const included = picking ? new Set([...pane.sel].flatMap((id) => descendantsOf(tree, id))) : undefined;
  return html`
    <section
      class="pane ${pane === ui.panes[ui.focus] ? 'focused' : ''} ${ui.drop?.pane === pane && ui.drop.position === 'end' ? 'drop-end' : ''}"
      data-pane=${index}
    >
      ${ui.panes.length > 1 && !picking
        ? html`<header class="pane-head">
            <span>${ui.library.trees[pane.tree].name}</span>
            <button class="act" data-action="pane-close" title=${t('closePane')}>${ICONS.close}</button>
          </header>`
        : ''}
      <div class="tree" role="tree" aria-label=${ui.library.trees[pane.tree].name}>
        ${repeat(pane.rows, (row) => row.id, (row) => rowView(row, pane, ui, holder, included))}
      </div>
      ${picking
        ? ''
        : html`<button class="new-tab" data-action="new-tab">${ICONS.add}<span>${t('newTab')}</span></button>`}
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

function pickerView(ui) {
  const { pane, id } = ui.picker.into;
  const where = id ? t('addInto', titleOf(ui.library.nodes[id])) : t('addToEnd', ui.library.trees[pane.tree].name);
  const sources = { ...ui, library: { ...ui.library, trees: { ...ui.library.trees } } };
  delete sources.library.trees[pane.tree]; // Not from the tree they go to.
  return html`
    <div class="overlay" data-action="overlay-close">
      <div class="dialog">
        <h2>${where}</h2>
        <div class="tabs">${treeTabs(sources, ui.picker.tree, 'picker-tree')}</div>
        ${paneView(ui.picker, 'picker', ui)}
        <footer>
          <button data-action="overlay-close">${t('cancel')}</button>
          <button class="primary" data-action="picker-add" ?disabled=${!ui.picker.sel.size}>
            ${t('addSelected', ui.picker.sel.size)}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function iconsView() {
  return html`
    <div class="overlay" data-action="overlay-close">
      <div class="dialog icons">
        ${EMOJI.map((emoji) => html`<button data-action="icon" data-icon=${emoji}>${emoji}</button>`)}
        <button class="wide" data-action="icon" data-icon="">${t('noIcon')}</button>
      </div>
    </div>
  `;
}

/** Draws the panel from `ui` (see panel.js). */
export function draw(container, ui) {
  if (!ui.library) return;
  render(
    html`
      <header class="bar">
        <div class="tabs">
          ${treeTabs(ui, ui.panes[ui.focus].tree, 'tree-show')}
          <button class="tab" data-action="tree-add" title=${t('newTree')}>${ICONS.add}</button>
        </div>
        <button class="act shown" data-action="more" title=${t('more')}>${ICONS.more}</button>
      </header>
      <main class="panes split-${ui.split}">${ui.panes.map((pane, index) => paneView(pane, index, ui))}</main>
      ${ui.drag ? html`<div class="ghost">${ui.drag.label}</div>` : nothing}
      ${ui.picker ? pickerView(ui) : nothing}
      ${ui.iconsFor ? iconsView() : nothing}
      ${ui.menu ? menuView(ui.menu) : nothing}
    `,
    container,
  );
}
