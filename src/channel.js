// The quick way between the user's computers, through the small storage the
// browser itself keeps in sync (about 100 KB). The library is kept there
// whole, squeezed - as long as it fits. When it does not, only its fresh
// part is kept: the pages used most recently, with the pages above them in
// the trees. The rest stays on the computers that have it.
//
// So a snapshot may be a part of a library: what it does not mention, it
// says nothing about. How a snapshot is taken into a library is merge.js's
// to say (takeIn); what this file adds is which earlier snapshot to measure
// it against, and when to write one:
//
// - There is one place for the snapshot, and both computers write it about
//   once a minute: they overwrite each other all the time. So each snapshot
//   carries a clock - how many snapshots of each computer went into it - and
//   a computer keeps the last snapshot it wrote and the last it took in,
//   each with its own clock. A snapshot that arrives is measured against the
//   newer of those two that it was made knowing; against nothing, if it
//   knew neither (then only what is missing here is added).
// - A computer writes when it has something the snapshot there does not
//   say - whoever's that snapshot is. If its own was overwritten by one
//   that did not know it, it says it again.
//
// No work is done twice: pages are grouped by the month they were last
// used, each group is squeezed apart and stored under the name of its
// content. A month nobody touched keeps its name and is not written again.
//
//   in the synced storage:
//     head           { v, version, id, clock: { [device]: n }, top: [name], months: [[name]] }
//                    (`version`: the shape of the library in it, see migrate in model.js)
//     p.<name>       a piece of squeezed text (a group may take several)
//     away.<device>  how many pages that computer keeps to itself
//   kept on this computer (`ch`):
//     { device, clock, head, told, heard, at, met, newer }
//       clock         every snapshot I know of, joined: my next one counts from it
//       head          the id of the snapshot there, as far as I know
//       told, heard   the last snapshot I wrote, the last I took in, each as
//                     { id, clock, seen, gone }: its library (JSON), the deletions it named
//       at            { head, library, hidden } when I last looked whether to write: the snapshot there,
//                     my library (by a short name of its text); nothing changed since, nothing to do
//       met           whether another computer was ever seen there
//       newer         whether the snapshot there is of a shape this version does not know

import { ROOT, VERSION, current, freshOf, goneOf, kidsOf, lettersOf, parentsOf, planOf, quickOf } from './model.js';
import { diff, isEmpty, only, takeIn } from './merge.js';

export const BUDGET = 90_000; // Of the 102,400 bytes the browser allows.
const PIECE = 7000; // The browser allows 8192 per item, its name included.
const MONTH = 30;

export const newState = (device) => ({ device, clock: {} });
/**
 * What an older version kept of the channel, in today's shape. The one place that knows the old ones:
 * they kept one snapshot (`seen`, `gone`) under a clock joined from all they knew, and the one before it.
 */
export function migrate({ seen, gone, before, mine, ...ch }) {
  if (!seen) return { ...newState(ch.device), ...ch };
  const heard = before?.seen ? { clock: before.clock, seen: before.seen, gone: [] } : undefined;
  return { ...ch, told: { id: ch.head, clock: ch.clock, seen, gone: gone ?? [] }, heard };
}

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
  // (The deletions: ids, and apart the time of each, in the same order - so a version that knows only the ids still reads them.)
  const top = { trees, grid: part.grid, gone: Object.keys(gone), goneAt: Object.values(gone), ...(plan.length && { plan }) };
  const head = { v: 1, version: VERSION, top: await store(top, items), months: [] };
  for (const nodes of months.values()) head.months.push(await store(nodes, items));
  head.id = await nameOf(JSON.stringify(head));
  const size = Object.entries(items).reduce((sum, [name, piece]) => sum + name.length + piece.length + 2, JSON.stringify(head).length + 40);
  return { head, items, size, library: part, gone: Object.keys(gone), hidden: Object.keys(library.nodes).length - ids.size };
}

/**
 * The library as it goes to the synced storage: all of it if it fits in
 * `budget` bytes, else as many of its freshest nodes as do.
 */
export async function snapshot(library, budget = BUDGET) {
  const gone = Object.fromEntries(goneOf(library).map((id) => [id, library.gone[id]]));
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

/**
 * The snapshot in the synced storage (`all` is everything there), if it is there in full:
 * { id, clock, library, gone: [id], goneAt: { id: when } } (no `goneAt`, if an older version wrote it).
 */
async function read(all) {
  const { head } = all;
  if (isNewer(head)) return undefined;
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
  const goneAt = top.goneAt && Object.fromEntries(top.gone.map((id, n) => [id, top.goneAt[n]]));
  return { id: head.id, clock: head.clock, library: shaped(library, head.version), gone: top.gone, goneAt };
}

// --- The exchange --------------------------------------------------------------
// `cells` is the synced storage: { get() -> everything, set(items), remove(names) }.

/**
 * A snapshot written by a newer version of the extension: of a shape this
 * one does not know. Nothing is taken from it, and nothing written over it
 * (this version would read it wrong, and spoil it for the one that wrote
 * it); the user is told to update here.
 */
const isNewer = (head) => head?.version > VERSION;

/**
 * A snapshot's library in today's shape, whichever version wrote it. One
 * that does not say (they did not, before version 4 of the extension's
 * snapshots) is of shape 3 if it has what only shape 3 has - a node marked
 * as a group - and else older.
 */
function shaped(library, version = library.version ?? (Object.values(library.nodes).some((node) => node.group) ? 3 : 2)) {
  current(library.nodes, version);
  library.version = VERSION;
  return library;
}

/** What changed from `base` to the snapshot `next`, as far as `next` speaks of it. */
const changes = (base, next) => diff(only(base, new Set(Object.keys(next.nodes))), next);

/** The snapshots I keep, the newer first: the one there as far as I know, then the other. */
const kept = (ch) => (ch.told?.id === ch.head ? [ch.told, ch.heard] : [ch.heard, ch.told]).filter(Boolean);

/**
 * Takes in what another computer wrote, if anything new is there. Changes
 * `library` and returns true if it did.
 */
export async function receive(cells, ch, library, at) {
  const all = await cells.get();
  ch.newer = isNewer(all.head);
  const remote = await read(all);
  if (!remote || remote.id === ch.head) return false;
  // What they changed is measured from a snapshot they knew when they made theirs.
  const base = kept(ch).find((snapshot) => knows(remote.clock, snapshot.clock));
  // (A version that told deletions without their times: those it had not named before are taken as made now.)
  const gone = remote.goneAt ?? Object.fromEntries(remote.gone.filter((id) => !base?.gone.includes(id)).map((id) => [id, at]));
  const was = JSON.stringify(library);
  takeIn(library, base && shaped(JSON.parse(base.seen)), remote.library, gone, at);
  for (const [device, n] of Object.entries(remote.clock ?? {})) ch.clock[device] = Math.max(ch.clock[device] ?? 0, n);
  ch.heard = { id: remote.id, clock: remote.clock, seen: JSON.stringify(remote.library), gone: remote.gone };
  ch.head = remote.id;
  return JSON.stringify(library) !== was;
}

/**
 * Writes this computer's library (see `snapshot`) if it has anything the
 * snapshot there does not say. Returns how many pages do not fit and stay here.
 */
export async function publish(cells, ch, library, budget) {
  const all = await cells.get();
  ch.newer = isNewer(all.head);
  if (ch.newer) return ch.at?.hidden ?? 0;
  // Nothing changed here, and the snapshot there is the one I knew then: nothing to say that was not said.
  const now = { head: all.head?.id, library: await nameOf(JSON.stringify(library)) };
  if (ch.at && now.head === ch.at.head && now.library === ch.at.library) return ch.at.hidden;
  const mine = await snapshot(library, budget);
  const [there] = kept(ch);
  const news = !there || !isEmpty(changes(shaped(JSON.parse(there.seen)), mine.library)) || mine.gone.some((id) => !there.gone.includes(id));
  if (news) {
    // Pieces nobody points at any more go first, to make room; then the new ones, with the head.
    const stale = Object.keys(all).filter((name) => !name.startsWith('away.') && !(name in mine.items));
    const unwritten = Object.fromEntries(Object.entries(mine.items).filter(([name]) => !(name in all)));
    await cells.remove(stale);
    ch.clock = { ...ch.clock, [ch.device]: (ch.clock[ch.device] ?? 0) + 1 };
    await cells.set({ ...unwritten, head: { ...mine.head, clock: ch.clock } });
    ch.told = { id: mine.head.id, clock: ch.clock, seen: JSON.stringify(mine.library), gone: mine.gone };
    ch.head = mine.head.id;
  }
  if (all[`away.${ch.device}`] !== mine.hidden) await cells.set({ [`away.${ch.device}`]: mine.hidden });
  ch.at = { head: news ? ch.head : now.head, library: now.library, hidden: mine.hidden };
  return mine.hidden;
}

/** How many pages another computer keeps to itself (the most any of them does). Notes in `ch.met` that there is another computer. */
export async function awayElsewhere(cells, ch) {
  const all = await cells.get();
  const others = Object.keys(all).filter((name) => name.startsWith('away.') && name !== `away.${ch.device}`);
  if (others.length) ch.met = true;
  return Math.max(0, ...others.map((name) => all[name]));
}
