// A filter: { picked, at } - the nodes the user ticked, to be shown alone,
// each with all that is under it, and when they said so. Here is what that
// means. Pure: no screen here.

import { ROOT, descendantsOf, freshOf, inTree } from '../model.js';

/** Ways to tick many nodes at once: every node that answers one. */
export const QUICK = ['open', 'week', 'sound', 'kept'];

/**
 * Whether a node answers a quick way. `facts`: { live, audible } - the ids
 * of nodes with an open tab and of those making sound - and `day`, today
 * counted from 1970.
 */
export function answers(node, way, { live, audible, day }) {
  if (way === 'open') return live.has(node.id);
  if (way === 'week') return day - freshOf(node) < 7;
  if (way === 'sound') return audible.has(node.id);
  return !!(node.pinned || node.keep);
}

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
