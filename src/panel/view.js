// What the panel shows, as a function of what it knows. No decisions here.

import { html, render, nothing } from '../vendor/lit-html/lit-html.js';
import { repeat } from '../vendor/lit-html/directives/repeat.js';
import { descendantsOf, gridOf, isGroup, isNote, parentOf, planOf } from '../model.js';
import { t } from '../i18n.js';

// One family of icons: lines of one weight on a 20-unit grid. (Two are solid: an arrow that small and three dots have no outline to speak of.)
const line = (path) => html`<svg class="line" viewBox="0 0 20 20" width="16" height="16"><path d=${path} /></svg>`;
const solid = (path) => html`<svg viewBox="0 0 20 20" width="16" height="16"><path d=${path} /></svg>`;
const ICONS = {
  chevron: solid('M7 5l6 5-6 5z'),
  more: solid('M4.5 8.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.5 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.5 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z'),
  close: line('M5.5 5.5l9 9M14.5 5.5l-9 9'),
  sleep: line('M15 11.6A5.8 5.8 0 0 1 8.400 5a5.800 5.800 0 1 0 6.600 6.600z'),
  trash: line('M4.500 6h11M8 6V4.500h4V6M6 6l.6 9.500h6.800L14 6M8.700 9v3.700M11.300 9v3.700'),
  keep: line('M2.500 10S5.500 5.500 10 5.500 17.500 10 17.500 10s-3 4.500-7.500 4.500S2.500 10 2.500 10zM10 8.200a1.800 1.800 0 1 0 0 3.600 1.800 1.800 0 0 0 0-3.600z'),
  locate: line('M10 2.500V5M10 15v2.500M2.500 10H5M15 10h2.500M10 5.500a4.500 4.500 0 1 0 0 9 4.500 4.500 0 0 0 0-9zM10 9.700v.6'),
  add: line('M10 4.500v11M4.500 10h11'),
  home: line('M3.500 9.500 10 4l6.500 5.500M5.500 8.500V16h9V8.500'),
  group: line('M3.500 6A1.500 1.500 0 0 1 5 4.500h2.700l1.600 1.800H15a1.500 1.500 0 0 1 1.500 1.500V14a1.500 1.500 0 0 1-1.500 1.500H5A1.500 1.500 0 0 1 3.500 14z'),
  note: line('M6 3.500h5.500l3 3v10H6zM11.500 3.500v3h3M8.500 10.500h3.500M8.500 13.500h3.500'),
  undo: line('M7.500 5 4 8.500 7.500 12M4 8.500h7.500a3.800 3.800 0 0 1 0 7.600H9.500'),
  next: line('M4.500 10h11M11 5.500l4.500 4.500L11 14.500'),
  clock: line('M10 3.500a6.500 6.500 0 1 0 0 13 6.500 6.500 0 0 0 0-13zM10 6.500V10l2.500 1.500'),
  search: line('M8.800 3.800a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12.500 12.500 16.200 16.200'),
  splitRow: line('M3.500 4.500h13v11h-13zM10 4.500v11'),
  splitColumn: line('M3.500 4.500h13v11h-13zM3.500 10h13'),
  shared: line('M7.500 4.500h8v8M4.500 7.500h8v8h-8z'),
};

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

/** Away from its home: the address it first had, or was pinned to. */
const isAway = (node) => node.home && node.url !== node.home.url;

export function iconView(node) {
  if (node.icon) return html`<span class="favicon emoji">${node.icon}</span>`;
  if (isGroup(node)) return html`<span class="favicon glyph">${ICONS.group}</span>`;
  if (isNote(node)) return html`<span class="favicon glyph">${ICONS.note}</span>`;
  return html`<img class="favicon" alt="" draggable="false" src=${faviconOf(node.url)} />`;
}

const act = (action, icon, title, more = '') =>
  html`<button class="act ${more}" data-action=${action} tabindex="-1" title=${title}>${ICONS[icon]}</button>`;

function rowView(row, pane, ui, { leads, included }, lit) {
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
    row.kept && 'kept',
    leads.has(row.id) && 'leads',
    pane.sel.has(row.id) && 'selected',
    included?.has(row.id) && 'included',
    row.kids && 'parent',
    row.collapsed && 'collapsed',
    node.pinned && 'pinned',
    ui.audible.has(row.id) && 'playing',
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
      style="--depth:${row.depth}; --lit:${lit || 0}; margin-top:${-row.pull}px; transform:translateY(${row.shift}px)"
      title=${[title, node.url, ui.audible.has(row.id) && t('playing'), node.added && t('addedOn', new Date(node.added).toLocaleDateString())].filter(Boolean).join('\n')}
    >
      ${ui.audible.has(row.id) ? html`<span class="sound"></span>` : ''}
      <button class="twisty" data-action="collapse" tabindex="-1" title=${t(row.collapsed ? 'expand' : 'collapse')}>
        ${ICONS.chevron}
      </button>
      ${picking ? html`<span class="check"></span>` : ''} ${iconView(node)}
      ${editing
        ? html`<input class="rename" .value=${editing.field === 'url' ? node.url : title} aria-label=${t('renameHint')} />`
        : html`<span class="title">${title}</span>`}
      ${node.keep ? html`<span class="mark" title=${t('kept')}>${ICONS.keep}</span>` : ''}
      ${shared ? html`<span class="mark" title=${t('alsoIn', shared.join(', '))}>${ICONS.shared}</span>` : ''}
      ${row.hidden ? html`<span class="badge">${row.hidden}</span>` : ''}
      ${picking || editing
        ? ''
        : html`
            ${isAway(node) ? act('home', 'home', t('backHome', node.home.title || node.home.url), node.pinned ? 'away' : '') : ''}
            ${act('child', 'add', t('newChild'))} ${live ? act('sleep', 'sleep', t('sleep')) : ''}
            ${act('remove', 'trash', t(row.collapsed ? 'removeBranch' : 'remove'), 'danger')}
          `}
    </div>
  `;
}

/** The nodes above the current tab's node in a pane's tree. (The node itself is always in sight: see rowsOf.) */
function leadsToActive(pane, ui) {
  const tree = ui.library.trees[pane.tree];
  const leads = new Set();
  for (let id = parentOf(tree, ui.activeId); id !== undefined; id = parentOf(tree, id)) leads.add(id);
  return leads;
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

/** A quiet line over results that are not what was typed, letter for letter: how the search was read instead. */
const looseView = (loose) =>
  loose ? html`<p class="loose">${loose.how === 'layout' ? t('foundAs', loose.as) : t('foundNear')}</p>` : nothing;

/** One tree: its rows in sight, each where screen.js put it (`pull`, `shift`), with gaps as tall as the rows not drawn. The same view serves the panes of the panel and the picker. */
function paneView(pane, index, ui) {
  const way = { leads: leadsToActive(pane, ui) };
  const guide = litGuide(pane.rows, ui.activeId);
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
      ${looseView(pane.loose)}
      <div class="tree ${ui.pointer?.pane === pane ? '' : 'calm'}" role="tree" aria-label=${tree.name} style="--tight:${ui.tight}px">
        <div class="gap" style="height:${pane.before}px"></div>
        ${repeat(
          pane.rows.slice(pane.from, pane.to),
          (row) => row.id,
          (row, at) => rowView(row, pane, ui, way, guide && pane.from + at >= guide.from && pane.from + at < guide.to && guide.level),
        )}
        <div class="gap" style="height:${pane.after}px"></div>
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
      ${ui.journalOpen
        ? html`
            <input class="journal-search" type="search" placeholder=${t('journalSearch')} aria-label=${t('journalSearch')} .value=${ui.journalQuery} />
            ${looseView(ui.places.loose)}
            <div class="places">
              ${ui.places.shown.map(place)}
              ${ui.places.shown.length ? nothing : html`<p class="loose">${t('nothingFound')}</p>`}
              ${ui.places.more ? html`<button class="pill" data-action="journal-more">${t('journalMore', ui.places.more)}</button>` : nothing}
            </div>
          `
        : nothing}
    </footer>
  `;
}

/**
 * The plan, at the top: what to open next, a click away; unfolded, all that
 * is planned, in order (dragging changes it). It is the journal's other
 * half - what is ahead above the tree, what is behind below it - and, like
 * the journal, never holds the page the user is at.
 */
function planView(ui) {
  const ids = planOf(ui.library).filter((id) => id !== ui.activeId);
  // Nothing planned takes no room - until something is dragged that could be.
  if (!ids.length && !['rows', 'plan'].includes(ui.drag?.kind)) return nothing;
  const entry = (id) => html`
    <div
      class="place ${ui.drop?.plan && ui.drop.before === id ? 'drop-before' : ''}"
      role="button"
      data-action="plan-go"
      data-node=${id}
      title=${t('planGo')}
    >
      ${iconView(ui.library.nodes[id])}<span class="title">${titleOf(ui.library.nodes[id])}</span>
      ${act('unplan', 'close', t('planRemove'))}
    </div>
  `;
  const whole = ui.planOpen || !ids.length; // The heading, then the list; else the first entry in the heading's place.
  const fold = ids.length ? act('plan-toggle', 'chevron', t(ui.planOpen ? 'planFold' : 'planUnfold'), 'shown') : nothing;
  return html`
    <section class="journal plan ${ui.planOpen ? 'open' : ''} ${ui.drop?.plan && !ui.drop.before ? 'drop-end' : ''}">
      <div class="journal-head">
        <span class="favicon glyph">${ICONS.next}</span>
        ${whole ? html`<span class="title">${t(ids.length ? 'plan' : 'planDrop')}</span>` : entry(ids[0])}
        ${!whole && ids.length > 1 ? html`<span class="when">+${ids.length - 1}</span>` : nothing} ${fold}
      </div>
      ${whole && ids.length ? html`<div class="places">${ids.map(entry)}</div>` : nothing}
    </section>
  `;
}

/** Draws the panel from `ui` (see screen.js). */
export function draw(container, ui) {
  if (!ui.library) return;
  const tool = (action, icon, title, { disabled = false, place = '' } = {}) =>
    html`<button class="act shown ${place}" data-action=${action} title=${title} ?disabled=${disabled}>${ICONS[icon]}</button>`;
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
        <label class="search">
          ${ICONS.search}
          <input type="search" placeholder=${t('search')} .value=${ui.query} aria-label=${t('search')} />
        </label>
        <div class="tools">
          ${tool('new-tab', 'add', t('newTab'))} ${tool('new-group', 'group', `${t('newGroup')} (Ctrl+G)`)}
          ${tool('new-note', 'note', `${t('newNote')} (Ctrl+M)`)}
          ${tool('undo', 'undo', `${t('undo')} (Ctrl+Z)`, { disabled: !ui.canUndo })}
          ${tool('show-active', 'locate', t('showActive'), { disabled: !ui.activeTree })}
          ${split('row', 'splitRow')} ${split('column', 'splitColumn')} ${tool('more', 'more', t('more'), { place: 'end' })}
        </div>
      </header>
      ${planView(ui)}
      <main class="panes split-${ui.split}">${ui.panes.map((pane, index) => paneView(pane, index, ui))}</main>
      ${journalView(ui)}
      ${ui.notice
        ? html`<footer class="notice">
            <span>${ui.notice.text}</span>
            ${ui.notice.button ? html`<button class="pill" data-action=${ui.notice.button.action}>${ui.notice.button.label}</button>` : nothing}
            ${act('notice-close', 'close', t('closeNotice'), 'shown')}
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
