// The quick way between the user's computers, through the small storage the
// browser itself keeps in sync (about 100 KB). The library is kept there
// whole, squeezed - as long as it fits. When it does not, only its fresh
// part is kept: the pages used most recently, with the pages above them in
// the trees. The rest stays on the computers that have it.
//
// So a snapshot may be a part of a library, and two rules follow:
//
// - What a snapshot does not mention, it says nothing about. A page is
//   deleted elsewhere only when a snapshot says so by name (`gone`).
// - A computer learns what changed elsewhere by comparing a snapshot with
//   one both sides have seen. Each snapshot carries a clock - how many
//   snapshots of each computer went into it - so a computer can tell
//   whether a snapshot was made knowing the one it last saw, however many
//   it has missed since. Without such a common past the two libraries are
//   simply put together.
//
// No work is done twice: pages are grouped by the month they were last
// used, each group is squeezed apart and stored under the name of its
// content. A month nobody touched keeps its name and is not written again.
//
//   in the synced storage:
//     head           { v, id, clock: { [device]: n }, top: [name], months: [[name]] }
//     p.<name>       a piece of squeezed text (a group may take several)
//     away.<device>  how many pages that computer keeps to itself
//   kept on this computer (`ch`):
//     { device, head, clock, seen, gone, before: { clock, seen }, met }
//       head, clock, seen, gone   the snapshot last taken in or written: its id and
//                                 clock, its library (JSON), the deletions it named
//       before                    the last snapshot taken in from elsewhere: what
//                                 my own ones since were made from
//       met                       whether another computer was ever seen there

import { ROOT, freshOf, goneOf, kidsOf, lettersOf, parentsOf, planOf, quickOf } from './model.js';
import { EMPTY, diff, isEmpty, only, takeIn } from './merge.js';

export const BUDGET = 90_000; // Of the 102,400 bytes the browser allows.
const PIECE = 7000; // The browser allows 8192 per item, its name included.
const MONTH = 30;

export const newState = (device) => ({ device, gone: [], clock: {} });
/** What an older version kept of the channel, in today's shape. The one place that knows the old ones. */
export const migrate = ({ mine, ...ch }) => ({ ...newState(ch.device), ...ch });

/** Whether a snapshot with clock `later` was made knowing the one with clock `earlier`. */
const knows = (later, earlier) => Object.entries(earlier ?? {}).every(([device, n]) => (later?.[device] ?? 0) >= n);

// --- Squeezing -----------------------------------------------------------------

const bytes64 = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
const through = (data, stream) => new Response(new Blob([data]).stream().pipeThrough(stream));

const pack = async (text) => bytes64(new Uint8Array(await through(text, new CompressionStream('deflate-raw')).arrayBuffer()));
const unpack = (packed) =>
  through(Uint8Array.from(atob(packed), (char) => char.charCodeAt(0)), new DecompressionStream('deflate-raw')).text();

/** A short name for a text, the same for the same text. */
async function nameOf(text) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return lettersOf(hash.slice(0, 9));
}

/** Squeezes `value` and cuts it into pieces, which go into `items`; gives the pieces' names. */
async function store(value, items) {
  const packed = await pack(JSON.stringify(value));
  const names = [];
  for (let at = 0; at < packed.length; at += PIECE) {
    const piece = packed.slice(at, at + PIECE);
    const name = await nameOf(piece);
    items[`p.${name}`] = piece;
    names.push(name);
  }
  return names;
}

/** The value stored under `names`, or undefined if a piece is missing (it may not have arrived yet). */
async function load(names, all) {
  const pieces = names.map((name) => all[`p.${name}`]);
  return pieces.includes(undefined) ? undefined : JSON.parse(await unpack(pieces.join('')));
}

// --- A snapshot ----------------------------------------------------------------

/** `ids`, and every node above one of them in any tree. */
function withParents(library, ids) {
  const all = new Set(ids);
  for (const tree of Object.values(library.trees)) {
    const parents = parentsOf(tree);
    for (const id of ids) {
      for (let up = parents.get(id); up && up !== ROOT && !all.has(up); up = parents.get(up)) all.add(up);
    }
  }
  return all;
}

/** The nodes `ids` of a library as a head and its pieces. */
async function encode(library, ids, gone) {
  const part = only(library, ids);
  const months = new Map(); // Month -> its nodes; the newest month first, and in each the freshest node first.
  for (const node of Object.values(part.nodes).sort((a, b) => freshOf(b) - freshOf(a) || (a.id < b.id ? -1 : 1))) {
    const month = Math.floor(freshOf(node) / MONTH);
    months.set(month, [...(months.get(month) ?? []), node]);
  }
  // A tree is told as rows, top to bottom: each node by its number in the order above, and its depth.
  const number = new Map([...months.values()].flat().map((node, at) => [node.id, at]));
  const trees = Object.values(part.trees).map((whole) => {
    const { children, collapsed, quick: kept, ...tree } = whole;
    const rows = [];
    const walk = (id, depth) => kidsOf({ children }, id).forEach((kid) => (rows.push(number.get(kid), depth), walk(kid, depth + 1)));
    walk(ROOT, 0);
    const quick = quickOf(whole).map((id) => number.get(id));
    return { ...tree, rows, collapsed: Object.keys(collapsed).map((id) => number.get(id)), ...(quick.length && { quick }) };
  });
  const items = {};
  const plan = planOf(part).map((id) => number.get(id));
  const top = { trees, grid: part.grid, gone, ...(plan.length && { plan }) };
  const head = { v: 1, top: await store(top, items), months: [] };
  for (const nodes of months.values()) head.months.push(await store(nodes, items));
  head.id = await nameOf(JSON.stringify(head));
  const size = Object.entries(items).reduce((sum, [name, piece]) => sum + name.length + piece.length + 2, JSON.stringify(head).length + 40);
  return { head, items, size, library: part, gone, hidden: Object.keys(library.nodes).length - ids.size };
}

/**
 * The library as it goes to the synced storage: all of it if it fits in
 * `budget` bytes, else as many of its freshest nodes as do.
 */
export async function snapshot(library, budget = BUDGET) {
  const gone = goneOf(library);
  const fresh = Object.values(library.nodes)
    .sort((a, b) => freshOf(b) - freshOf(a) || (a.id < b.id ? -1 : 1))
    .map((node) => node.id);
  const first = (count) => encode(library, withParents(library, fresh.slice(0, count)), gone);
  let best = await first(fresh.length);
  if (best.size <= budget) return best;
  let [fits, over] = [0, fresh.length]; // The most nodes known to fit, the fewest known not to.
  best = await first(0);
  while (over - fits > 1) {
    const middle = Math.floor((fits + over) / 2);
    const tried = await first(middle);
    if (tried.size <= budget) [fits, best] = [middle, tried];
    else over = middle;
  }
  return best;
}

/** The snapshot in the synced storage (`all` is everything there): { id, parent, library, gone }, if it is there in full. */
async function read(all) {
  const { head } = all;
  const top = head && (await load(head.top, all));
  const months = head && (await Promise.all(head.months.map((names) => load(names, all))));
  if (!top || months.includes(undefined)) return undefined;
  const nodes = months.flat();
  const trees = top.trees.map(({ rows, collapsed, ...tree }) => {
    const children = {};
    const above = [ROOT]; // The last node seen at each depth, shifted by one: the parent of the next deeper one.
    for (let at = 0; at < rows.length; at += 2) {
      const [id, depth] = [nodes[rows[at]].id, rows[at + 1]];
      (children[above[depth]] ??= []).push(id);
      above[depth + 1] = id;
    }
    return { ...tree, children, collapsed: Object.fromEntries(collapsed.map((n) => [nodes[n].id, true])), ...(tree.quick && { quick: tree.quick.map((n) => nodes[n].id) }) };
  });
  const library = { nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), trees: Object.fromEntries(trees.map((tree) => [tree.id, tree])), trash: [] };
  if (top.grid) library.grid = top.grid;
  if (top.plan) library.plan = top.plan.map((n) => nodes[n].id);
  return { id: head.id, clock: head.clock, library, gone: top.gone };
}

// --- The exchange --------------------------------------------------------------
// `cells` is the synced storage: { get() -> everything, set(items), remove(names) }.

const parsed = (json) => (json ? JSON.parse(json) : EMPTY);
/** What changed from `base` to the snapshot `next`, as far as `next` speaks of it. */
const changes = (base, next) => diff(only(base, new Set(Object.keys(next.nodes))), next);

/**
 * Takes in what another computer wrote, if anything new is there. Changes
 * `library` and returns true if it did.
 */
export async function receive(cells, ch, library, at) {
  const remote = await read(await cells.get());
  if (!remote || remote.id === ch.head) return false;
  // Made knowing the snapshot I have, or at least the last one I took in (we both wrote since)?
  // Else we share no past: a first meeting.
  const base = knows(remote.clock, ch.clock) ? ch.seen : ch.before && knows(remote.clock, ch.before.clock) ? ch.before.seen : undefined;
  const was = JSON.stringify(library);
  takeIn(library, base && JSON.parse(base), remote.library, remote.gone.filter((id) => !ch.gone.includes(id)), at);
  // The clocks join: what I wrote meanwhile is still to be told, on top of this.
  const clock = { ...remote.clock };
  for (const [device, n] of Object.entries(ch.clock)) clock[device] = Math.max(clock[device] ?? 0, n);
  const seen = JSON.stringify(remote.library);
  // Kept twice: what I write next is made from this, and whoever wrote at the same time made theirs from it too.
  Object.assign(ch, { head: remote.id, clock, seen, gone: remote.gone, before: { clock, seen } });
  return JSON.stringify(library) !== was;
}

/**
 * Writes this computer's library (see `snapshot`) if it has anything the
 * snapshot last seen does not. Returns how many pages do not fit and stay here.
 */
export async function publish(cells, ch, library, budget) {
  const mine = await snapshot(library, budget);
  const news = !isEmpty(changes(parsed(ch.seen), mine.library)) || mine.gone.some((id) => !ch.gone.includes(id));
  const all = await cells.get();
  if (news) {
    // Pieces nobody points at any more go first, to make room; then the new ones, with the head.
    const stale = Object.keys(all).filter((name) => !name.startsWith('away.') && !(name in mine.items));
    const unwritten = Object.fromEntries(Object.entries(mine.items).filter(([name]) => !(name in all)));
    await cells.remove(stale);
    const clock = { ...ch.clock, [ch.device]: (ch.clock[ch.device] ?? 0) + 1 };
    await cells.set({ ...unwritten, head: { ...mine.head, clock } });
    Object.assign(ch, { head: mine.head.id, clock, seen: JSON.stringify(mine.library), gone: mine.gone });
  }
  if (all[`away.${ch.device}`] !== mine.hidden) await cells.set({ [`away.${ch.device}`]: mine.hidden });
  return mine.hidden;
}

/** How many pages another computer keeps to itself (the most any of them does). Notes in `ch.met` that there is another computer. */
export async function awayElsewhere(cells, ch) {
  const all = await cells.get();
  const others = Object.keys(all).filter((name) => name.startsWith('away.') && name !== `away.${ch.device}`);
  if (others.length) ch.met = true;
  return Math.max(0, ...others.map((name) => all[name]));
}
