// A filter: { picked, at } - the nodes the user ticked, to be shown alone,
// each with all that is under it, and when they said so. Here is what that
// means. A saved filter is such a set of ticked nodes under a name,
// { name, picked }: something to set the filter from, not a filter of another
// kind. Both are kept as the user said them: a ticked node that is gone is
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

/** The saved filter that ticks, in `tree` as it is now, exactly the nodes `picked`, if there is one. */
export const savedWith = (tree, saved, picked) =>
  saved.find((each) => {
    const its = stillPicked(tree, each.picked);
    return its.length === picked.length && its.every((id) => picked.includes(id));
  });

/** A name no saved filter has: `name` itself, or else with the first number that makes it one. */
export function freeName(saved, name) {
  const taken = new Set(saved.map((each) => each.name));
  let [free, n] = [name, 1];
  while (taken.has(free)) free = `${name} ${++n}`;
  return free;
}

/** The saved filters with `picked` kept as `name`: in the place of the one called so, or after them all. */
export function withSaved(saved, name, picked) {
  const at = saved.findIndex((each) => each.name === name);
  return saved.toSpliced(at < 0 ? saved.length : at, 1, { name, picked: [...picked] });
}

const short = (text, most = 18) => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);
/** What ticked nodes are called together, from their names: the first two, shortened, and how many more there are. */
export const nameFor = (titles) => `${titles.slice(0, 2).map((title) => short(title)).join(' · ')}${titles.length > 2 ? ` +${titles.length - 2}` : ''}`;

/**
 * What stands at the top of a tree seen through a filter { picked, at }: the
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
 * The library as it is seen through a filter: in tree `treeId` the nodes of
 * rootsOf stand at the top, each with what is under it, and nothing else is
 * there - nothing of what was above them, so the room that took is given
 * back. The rows of this are made as for any tree (rowsOf in model.js).
 */
export function narrowedTo(library, treeId, filter) {
  const tree = library.trees[treeId];
  return { ...library, trees: { ...library.trees, [treeId]: { ...tree, children: { ...tree.children, [ROOT]: rootsOf(library, treeId, filter) } } } };
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
