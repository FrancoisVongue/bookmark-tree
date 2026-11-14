// A filter: { picked, mode, at } - the nodes the user ticked, each with all
// that is under it, what the ticks mean, and when they said so. The ticked
// are either shown alone ('only') or left out ('hide'): one or the other,
// never both. Here is what that means. A saved filter is such a set of
// ticked nodes and their meaning under a name, { name, picked, mode }:
// something to set the filter from, not a filter of another kind. Both are
// kept as the user said them: a ticked node that is gone is
// left out when the filter is read (stillPicked), never taken out of what is
// kept - so a node that comes back (an undo) is ticked as before.
// Pure: no screen here.

import { ROOT, descendantsOf, inTree } from '../model.js';

/**
 * The ticked nodes that count, in the order of the tree: those still in it,
 * without the ones under another ticked node (they come with it anyway).
 */
export function topmost(tree, ids) {
  const ticked = new Set(ids);
  const under = new Set(ids.flatMap((id) => (inTree(tree, id) ? descendantsOf(tree, id) : [])));
  return descendantsOf(tree, ROOT).filter((id) => ticked.has(id) && !under.has(id));
}

/**
 * Of the nodes a filter keeps as ticked (`picked`: a tree's own filter, or a
 * saved one), those that count in `tree` as it is now. A tree that is gone
 * has none; nor has a filter of a shape an older version kept.
 */
export const stillPicked = (tree, picked) => (tree && picked ? topmost(tree, picked) : []);

/** What the ticks of a filter, or of a saved one, mean: 'hide', or 'only' - which is also what one kept by an older version means, that had no word for it. */
export const modeOf = (filter) => (filter?.mode === 'hide' ? 'hide' : 'only');

/** The saved filter that is `filter`: it ticks, in `tree` as it is now, exactly the same nodes, and means the same by them - if there is one. */
export const savedWith = (tree, saved, { picked, mode }) =>
  saved.find((each) => {
    const its = stillPicked(tree, each.picked);
    return modeOf(each) === mode && its.length === picked.length && its.every((id) => picked.includes(id));
  });

/** A name no saved filter has: `name` itself, or else with the first number that makes it one. */
export function freeName(saved, name) {
  const taken = new Set(saved.map((each) => each.name));
  let [free, n] = [name, 1];
  while (taken.has(free)) free = `${name} ${++n}`;
  return free;
}

/** The saved filters with `filter` kept as `name`: in the place of the one called so, or after them all. */
export function withSaved(saved, name, filter) {
  const at = saved.findIndex((each) => each.name === name);
  return saved.toSpliced(at < 0 ? saved.length : at, 1, { name, picked: [...filter.picked], mode: modeOf(filter) });
}

const short = (text, most = 18) => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);
/** What ticked nodes are called together, from their names: the first two, shortened, and how many more there are. */
export const nameFor = (titles) => `${titles.slice(0, 2).map((title) => short(title)).join(' · ')}${titles.length > 2 ? ` +${titles.length - 2}` : ''}`;

/**
 * What stands at the top of a tree seen through a filter that shows the
 * ticked alone, { picked, at }: the
 * ticked nodes - and every node added after the filter was set (`at`) that
 * is not under one of those already. A filter takes away only what the user
 * saw and did not tick; what was not there then, it never took away.
 */
export function rootsOf(library, treeId, { picked, at }) {
  const tree = library.trees[treeId];
  const ticked = new Set(picked);
  const under = new Set();
  const roots = [];
  for (const id of descendantsOf(tree, ROOT)) {
    if (under.has(id) || !(ticked.has(id) || library.nodes[id].added > at)) continue;
    roots.push(id);
    for (const each of descendantsOf(tree, id)) under.add(each);
  }
  return roots;
}

/**
 * A tree's nodes, each under its parent, without the ticked ones - and so
 * without all that is under them. That is the whole rule of a filter that
 * hides: when it was set plays no part (a node added later is not ticked,
 * so it is there), and the tree keeps its shape.
 */
const withoutPicked = (tree, picked) => {
  const gone = new Set(picked);
  return Object.fromEntries(Object.entries(tree.children).map(([id, kids]) => [id, kids.filter((kid) => !gone.has(kid))]));
};

/**
 * The library as it is seen through a filter. One that shows the ticked
 * alone: in tree `treeId` the nodes of rootsOf stand at the top, each with
 * what is under it, and nothing else is there - nothing of what was above
 * them, so the room that took is given back. One that hides them: the tree
 * as it is, the ticked nodes absent. The rows of this are made as for any
 * tree (rowsOf in model.js) - so a folded row counts only what is left.
 */
export function narrowedTo(library, treeId, filter) {
  const tree = library.trees[treeId];
  const children = modeOf(filter) === 'hide' ? withoutPicked(tree, filter.picked) : { ...tree.children, [ROOT]: rootsOf(library, treeId, filter) };
  return { ...library, trees: { ...library.trees, [treeId]: { ...tree, children } } };
}

/**
 * Of `rows`, those that are `wanted` (a Set of ids) and the rows above them
 * that lead there; these come out marked `lead`, to be shown quieter.
 */
export function withLeads(rows, wanted) {
  const out = [];
  let need = 0; // Walking up: a row shallower than the last one kept leads to it.
  for (const row of rows.toReversed()) {
    const hit = wanted.has(row.id);
    if (!hit && row.depth >= need) continue;
    out.unshift(hit ? row : { ...row, lead: true });
    need = row.depth;
  }
  return out;
}
