// What the panel shows, as a function of what it knows. No decisions here.

import { html, render, nothing } from '../vendor/lit-html/lit-html.js';
import { repeat } from '../vendor/lit-html/directives/repeat.js';
import { descendantsOf, gridOf, isGroup, isNote, parentOf } from '../model.js';
import { t } from '../i18n.js';

const svg = (path) => html`<svg viewBox="0 0 20 20" width="16" height="16"><path fill-rule="evenodd" d=${path} /></svg>`;
const ICONS = {
  chevron: svg('M7 5l6 5-6 5z'),
  close: svg('M5.3 4.2 10 8.9l4.7-4.7 1.1 1.1L11.1 10l4.7 4.7-1.1 1.1L10 11.1l-4.7 4.7-1.1-1.1L8.9 10 4.2 5.3z'),
  sleep: svg('M11.2 4.4a5.6 5.6 0 1 0 4.4 9A4.8 4.8 0 0 1 11.2 4.4z'),
  trash: svg('M8 3.5h4l.8 1.3H16v1.5H4V4.8h3.2zM5.2 7.6h9.6l-.7 7.9a1.5 1.5 0 0 1-1.5 1.4H7.4a1.5 1.5 0 0 1-1.5-1.4zm1.6 1.5.6 6.3h5.2l.6-6.3z'),
  locate: svg('M9.25 2h1.5v2.6a5.5 5.5 0 0 1 4.65 4.65H18v1.5h-2.6a5.5 5.5 0 0 1-4.65 4.65V18h-1.5v-2.6a5.5 5.5 0 0 1-4.65-4.65H2v-1.5h2.6A5.5 5.5 0 0 1 9.25 4.6zM10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z'),
  add: svg('M9.2 4h1.6v5.2H16v1.6h-5.2V16H9.2v-5.2H4V9.2h5.2z'),
  home: svg('M10 3 3 9.2h2V16h3.6v-4h2.8v4H15V9.2h2z'),
  more: svg('M4.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'),
  group: svg('M3 5.5A1.5 1.5 0 0 1 4.5 4h3.3l1.6 1.8h6.1A1.5 1.5 0 0 1 17 7.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z'),
  note: svg('M5 3h7l3 3v11H5zm1.6 1.6v10.8h6.8V7h-2.6V4.6zM8 9h4v1.4H8zm0 2.8h4v1.4H8z'),
  undo: svg('M8.5 4 3.5 8.5l5 4.5V10c3 0 5 1 6.5 4-.3-4.5-2.8-7.3-6.5-7.6z'),
  clock: svg('M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 1.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8zm-.7 2h1.4v3.1l2.3 1.4-.7 1.2-3-1.8z'),
  search: svg('M8.7 3a5.7 5.7 0 0 1 4.5 9.2l3.6 3.5-1.1 1.1-3.6-3.5A5.7 5.7 0 1 1 8.7 3zm0 1.6a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2z'),
  splitRow: svg('M3 4h14v12H3zm1.5 1.5v9h4.7v-9zm6.3 0v9h4.7v-9z'),
  splitColumn: svg('M3 4h14v12H3zm1.5 1.5v3.7h11V5.5zm0 5.3v3.7h11v-3.7z'),
  shared: svg('M7 4h9v9h-2V6H7zM4 7h9v9H4zm1.6 1.6v5.8h5.800V8.6z'),
};

// Sound, said quietly: waves, not a loudspeaker.
const WAVES = html`<svg class="waves" viewBox="0 0 20 20" width="16" height="16">
  <path d="M6.5 8.2a2.6 2.6 0 0 1 0 3.6M9.6 6.2a5.4 5.4 0 0 1 0 7.6M12.7 4.2a8.2 8.2 0 0 1 0 11.6" />
</svg>`;

// The icons offered, eight to a row. No table fits everyone's work, so two
// rows are about no subject at all (marks, colours), and the dialog takes
// any emoji or letter typed by hand.
export const EMOJI = [
  '⭐ ❤️ 🔥 ✅ ❌ ⚠️ ❓ 💡', // marks
  '🔴 🟠 🟡 🟢 🔵 🟣 🟤 🟥', // colours
  '📌 🔒 🔑 🔔 🎯 🚀 📅 ⏰', // what matters, and when
  '📁 📄 📝 📚 🎓 🔍 📰 🧠', // reading and study
  '💼 📊 💰 💳 🛒 📦 🧾 ⚖️', // work, money, law
  '💻 📱 ⚙️ 🔧 🐞 🧪 🤖 🌐', // making software, science
  '🎨 ✏️ 📷 🎬 🎵 🎮 ✉️ 💬', // making things, play, talk
  '🏠 👥 💊 ✈️ 🚗 🍔 ⚽ 🌱', // life away from the screen
].flatMap((row) => row.split(' '));

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

export function iconView(node) {
  if (node.icon) return html`<span class="favicon emoji">${node.icon}</span>`;
  if (isGroup(node)) return html`<span class="favicon glyph">${ICONS.group}</span>`;
  if (isNote(node)) return html`<span class="favicon glyph">${ICONS.note}</span>`;
  return html`<img class="favicon" alt="" draggable="false" src=${faviconOf(node.url)} />`;
}

const act = (action, icon, title, more = '') =>
  html`<button class="act ${more}" data-action=${action} tabindex="-1" title=${title}>${ICONS[icon]}</button>`;

function rowView(row, pane, ui, { holder, leads, included }, lit) {
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
    leads.has(row.id) && 'leads',
    pane.sel.has(row.id) && 'selected',
    included?.has(row.id) && 'included',
    row.kids && 'parent',
    row.collapsed && 'collapsed',
    node.home && 'pinned',
    lit && 'lit',
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
      style="--depth:${row.depth}; --lit:${lit || 0}"
      title=${[title, node.url, node.added && t('addedOn', new Date(node.added).toLocaleDateString())].filter(Boolean).join('\n')}
    >
      <button class="twisty" data-action="collapse" tabindex="-1" title=${t(row.collapsed ? 'expand' : 'collapse')}>
        ${ICONS.chevron}
      </button>
      ${picking ? html`<span class="check"></span>` : ''} ${iconView(node)}
      ${editing
        ? html`<input class="rename" .value=${editing.field === 'url' ? node.url : title} aria-label=${t('renameHint')} />`
        : html`<span class="title">${title}</span>`}
      ${ui.audible.has(row.id) ? html`<span class="mark" title=${t('playing')}>${WAVES}</span>` : ''}
      ${shared ? html`<span class="mark" title=${t('alsoIn', shared.join(', '))}>${ICONS.shared}</span>` : ''}
      ${row.hidden ? html`<span class="badge">${row.hidden}</span>` : ''}
      ${picking || editing
        ? ''
        : html`
            ${isAway(node) ? act('home', 'home', t('backHome', node.home.title || node.home.url), 'away') : ''}
            ${act('child', 'add', t('newChild'))} ${live ? act('sleep', 'sleep', t('sleep')) : ''}
            ${act('remove', 'trash', t(row.collapsed ? 'removeBranch' : 'remove'), 'danger')}
          `}
    </div>
  `;
}

/**
 * Where the current tab's node is in a pane: `leads` are the nodes above it,
 * `holder` the collapsed row that hides it, if any (a branch never opens by
 * itself: the row that holds the node shows a mark instead).
 */
function wayToActive(pane, ui) {
  const tree = ui.library.trees[pane.tree];
  const shown = new Set(pane.rows.map((row) => row.id));
  const leads = new Set();
  for (let id = parentOf(tree, ui.activeId); id !== undefined; id = parentOf(tree, id)) leads.add(id);
  const holder = shown.has(ui.activeId) ? undefined : [...leads].find((id) => shown.has(id));
  return { leads, holder };
}

/**
 * The guide to light up: the one the row of the current tab hangs on, along
 * all the rows that hang on it. { level, from, to }; none for a top-level row.
 */
function litGuide(rows, id) {
  const at = rows.findIndex((row) => row.id === id);
  const level = rows[at]?.depth;
  if (!level) return;
  let [from, to] = [at, at + 1];
  while (rows[from - 1]?.depth >= level) from--;
  while (rows[to]?.depth >= level) to++;
  return { level, from, to };
}

/** One tree. The same view serves the panes of the panel and the picker. */
function paneView(pane, index, ui) {
  const way = wayToActive(pane, ui);
  const guide = litGuide(pane.rows, way.holder ?? ui.activeId);
  const picking = pane === ui.overlay;
  const focused = pane === ui.panes[ui.focus];
  const tree = ui.library.trees[pane.tree];
  // In the picker a chosen node brings its subtree along: show that.
  way.included = picking ? new Set([...pane.sel].flatMap((id) => descendantsOf(tree, id))) : undefined;
  return html`
    ${index > 0 ? html`<div class="divider" data-divider=${index}></div>` : ''}
    <section
      class="pane ${focused ? 'focused' : ''} ${ui.drop?.pane === pane && ui.drop.position === 'end' ? 'drop-end' : ''}"
      data-pane=${index}
      style="flex-grow:${pane.size ?? 1}"
    >
      ${ui.panes.length > 1 && !picking
        ? html`<header class="pane-head">
            <span>${treeLabel(tree)}</span>
            ${focused ? html`<span class="here">${t('newTabsHere')}</span>` : ''}
            ${act('pane-close', 'close', t('closePane'))}
          </header>`
        : ''}
      <div class="tree" role="tree" aria-label=${tree.name}>
        ${repeat(
          pane.rows,
          (row) => row.id,
          (row, index) => rowView(row, pane, ui, way, guide && index >= guide.from && index < guide.to && guide.level),
        )}
      </div>
      ${pane.rows.length || picking ? '' : html`<p class="hint">${t(ui.query ? 'nothingFound' : 'emptyTree')}</p>`}
    </section>
  `;
}

const treeLabel = (tree) => (tree.icon ? `${tree.icon} ${tree.name}` : tree.name);

function treeTabs(ui, current, action) {
  return Object.values(ui.library.trees).map((tree) =>
    ui.renaming?.tree === tree.id
      ? html`<input class="rename tree-name" .value=${tree.name} aria-label=${t('renameHint')} />`
      : html`<button class="tab ${tree.id === current ? 'current' : ''}" data-action=${action} data-tree=${tree.id}>
          ${treeLabel(tree)}
        </button>`,
  );
}

/** The table of trees: each in its cell, to click, drag to another cell, or (an empty cell) to start a tree in. */
function treeGrid(ui) {
  const { columns, cells } = gridOf(ui.library);
  const current = ui.panes[ui.focus].tree;
  const cellView = (id, cell) => {
    const drop = ui.drop?.cell === cell ? 'drop' : '';
    if (!id) return html`<button class="cell ${drop}" data-action="tree-add" data-cell=${cell} title=${t('newTree')}>${ICONS.add}</button>`;
    const tree = ui.library.trees[id];
    if (ui.renaming?.tree === id) return html`<input class="rename tree-name" .value=${tree.name} aria-label=${t('renameHint')} />`;
    // The tree of the current tab is marked wherever the panel is looking.
    const state = `${id === current ? 'current' : ''} ${id === ui.activeTree ? 'has-active' : ''} ${ui.drag?.tree === id ? 'dragging' : ''} ${drop}`;
    return html`<button class="tab ${state}" data-action="tree-show" data-tree=${id} data-cell=${cell}>${treeLabel(tree)}</button>`;
  };
  return html`<div class="grid" style="grid-template-columns:repeat(${columns}, minmax(0, 1fr))">${cells.map(cellView)}</div>`;
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
      <button data-action="picker-add" ?disabled=${!picker.sel.size}>${t('addSelected', picker.sel.size)}</button>
      <button class="primary" data-action="picker-add" data-take ?disabled=${!picker.sel.size}>
        ${t('moveSelected', picker.sel.size)}
      </button>
    </footer>
  `);
}

/** A question with two answers. The settings page asks the same way. */
export const askView = ({ question, yes }) =>
  dialog(
    html`
      <p>${question}</p>
      <footer>
        <button data-action="overlay-close">${t('cancel')}</button>
        <button class="primary" data-action="yes">${yes}</button>
      </footer>
    `,
    'ask',
  );

const iconsView = () =>
  dialog(
    html`
      ${EMOJI.map((emoji) => html`<button data-action="icon" data-icon=${emoji}>${emoji}</button>`)}
      <input class="any" placeholder=${t('anyIcon')} aria-label=${t('anyIcon')} />
      <button class="wide" data-action="icon" data-icon="">${t('noIcon')}</button>
    `,
    'icons',
  );

const OVERLAYS = { picker: pickerView, icons: iconsView, ask: (ui) => askView(ui.overlay) };

const AGO = new Intl.RelativeTimeFormat(undefined, { style: 'narrow' });
/** How long ago, in a word or two. */
function ago(at) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return t('justNow');
  if (minutes < 60) return AGO.format(-minutes, 'minute');
  return minutes < 24 * 60 ? AGO.format(-Math.round(minutes / 60), 'hour') : AGO.format(-Math.round(minutes / 1440), 'day');
}

/**
 * The journal of attention, at the bottom: the place the user was at before
 * this one, a click away; unfolded, all the places before it.
 */
function journalView(ui) {
  if (!ui.journal.length) return nothing;
  const place = ({ node, tree, at }) => html`
    <button class="place" data-action="journal-go" data-node=${node} data-tree=${tree} title=${t('journalGo')}>
      ${iconView(ui.library.nodes[node])}<span class="title">${titleOf(ui.library.nodes[node])}</span>
      <span class="when">${ago(at)}</span>
    </button>
  `;
  const fold = act('journal-toggle', 'chevron', t(ui.journalOpen ? 'journalFold' : 'journalUnfold'), 'shown');
  return html`
    <footer class="journal ${ui.journalOpen ? 'open' : ''}">
      <div class="journal-head">
        <span class="favicon glyph">${ICONS.clock}</span>
        ${ui.journalOpen ? html`<span class="title">${t('journal')}</span>` : place(ui.journal[0])} ${fold}
      </div>
      ${ui.journalOpen ? html`<div class="places">${ui.journal.map(place)}</div>` : nothing}
    </footer>
  `;
}

/** Draws the panel from `ui` (see screen.js). */
export function draw(container, ui) {
  if (!ui.library) return;
  const tool = (action, icon, title, disabled = false) =>
    html`<button class="act shown" data-action=${action} title=${title} ?disabled=${disabled}>${ICONS[icon]}</button>`;
  // A split button looks pressed while the trees lie its way.
  const split = (way, icon) =>
    html`<button class="act shown" data-action="split-${way}" title=${t(icon)} aria-pressed=${ui.panes.length > 1 && ui.split === way}>
      ${ICONS[icon]}
    </button>`;
  render(
    html`
      <header class="bar">
        ${ui.trouble ? html`<p class="trouble">${ui.trouble}<button data-action="settings">${t('restoreBackup')}</button></p>` : nothing}
        ${treeGrid(ui)}
        <div class="tools">
          <label class="search">
            ${ICONS.search}
            <input type="search" placeholder=${t('search')} .value=${ui.query} aria-label=${t('search')} />
          </label>
          ${tool('show-active', 'locate', t('showActive'), !ui.activeTree)} ${tool('new-tab', 'add', t('newTab'))}
          ${tool('new-group', 'group', `${t('newGroup')} (Ctrl+G)`)}
          ${tool('new-note', 'note', `${t('newNote')} (Ctrl+M)`)}
          ${tool('undo', 'undo', `${t('undo')} (Ctrl+Z)`, !ui.canUndo)} ${split('row', 'splitRow')}
          ${split('column', 'splitColumn')} ${tool('more', 'more', t('more'))}
        </div>
      </header>
      <main class="panes split-${ui.split}">${ui.panes.map((pane, index) => paneView(pane, index, ui))}</main>
      ${journalView(ui)}
      ${ui.unsynced
        ? html`<footer class="unsynced">
            <span>${t(ui.unsynced.kind === 'here' ? 'unsyncedHere' : 'unsyncedElsewhere', ui.unsynced.count)}</span>
            ${ui.unsynced.kind === 'here' ? html`<button class="pill" data-action="settings">${t('unsyncedBackUp')}</button>` : nothing}
            ${act('unsynced-close', 'close', t('closeNotice'), 'shown')}
          </footer>`
        : nothing}
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
