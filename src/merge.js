// Two copies of the library that both changed since they were last the same.
//
//   diff(base, mine)    what I changed since `base`, as plain data: a history
//                       squeezed dry (what was added and then removed is not
//                       in it at all)
//   apply(theirs, d)    makes those changes again in another copy, as far as
//                       that copy allows
//   merge               = apply(theirs, diff(base, mine))
//
// Nothing is lost quietly: what only one side has stays, and what one side
// deleted goes to the other's trash rather than away. Pure: no Chrome here.
//
//   d.nodes  { [id]: { node, keys } }   a new or changed node, and which of its fields changed
//   d.trees  { [treeId]: { name, renamed, icon, redrawn, added,
//                          put: [[id, parent, after, moved]],  places, top to bottom
//                          out: [id],                          taken out of the tree
//                          collapsed: { [id]: bool } } }
//   d.gone   [treeId]                   trees deleted
//   d.grid   the table of trees, if it changed (taken whole)

import { ROOT, descendantsOf, forgetLoose, inTree, kidsOf, moveNode, parentOf, placeNode, removeNode } from './model.js';

export const EMPTY = { nodes: {}, trees: {}, trash: [] };
const NO_TREE = { children: {}, collapsed: {} };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (...objects) => [...new Set(objects.flatMap((object) => Object.keys(object ?? {})))];

/** Where a node sits: under which parent, after which sibling. */
function placeOf(tree, id) {
  const parent = parentOf(tree, id);
  if (parent === undefined) return undefined;
  const kids = kidsOf(tree, parent);
  return { parent, after: kids[kids.indexOf(id) - 1] };
}

function diffTree(was, tree, changed) {
  const put = [];
  for (const id of descendantsOf(tree, ROOT)) {
    const now = placeOf(tree, id);
    const moved = !same(placeOf(was, id), now);
    // A changed node's place is told too: where it was deleted meanwhile, it comes back there.
    if (moved || changed[id]) put.push([id, now.parent, now.after ?? null, moved]);
  }
  const collapsed = {};
  for (const id of keysOf(was.collapsed, tree.collapsed)) {
    if (!!was.collapsed[id] !== !!tree.collapsed[id]) collapsed[id] = !!tree.collapsed[id];
  }
  const out = descendantsOf(was, ROOT).filter((id) => !inTree(tree, id));
  return { name: tree.name, renamed: tree.name !== was.name, icon: tree.icon, redrawn: tree.icon !== was.icon, put, out, collapsed };
}

/** What changed from `base` to `mine`. */
export function diff(base, mine) {
  const d = { nodes: {}, trees: {}, gone: Object.keys(base.trees).filter((id) => !mine.trees[id]) };
  for (const [id, node] of Object.entries(mine.nodes)) {
    const was = base.nodes[id];
    if (!same(node, was)) d.nodes[id] = { node, keys: keysOf(node, was).filter((key) => !same(node[key], was?.[key])) };
  }
  for (const [treeId, tree] of Object.entries(mine.trees)) {
    const entry = { ...diffTree(base.trees[treeId] ?? NO_TREE, tree, d.nodes), added: !base.trees[treeId] };
    const quiet = !entry.added && !entry.renamed && !entry.redrawn && !entry.put.length && !entry.out.length && !Object.keys(entry.collapsed).length;
    if (!quiet) d.trees[treeId] = entry;
  }
  if (!same(base.grid, mine.grid)) d.grid = mine.grid;
  return d;
}

export const isEmpty = (d) => !Object.keys(d.nodes).length && !Object.keys(d.trees).length && !d.gone.length && !d.grid;

/** Puts `id` under `parent`, right after sibling `after` (first, without one), as far as the tree allows. */
function put(out, treeId, id, parent, after) {
  const tree = out.trees[treeId];
  placeNode(out, treeId, id, parent);
  if (parent !== ROOT && !inTree(tree, parent)) return; // The parent is not there: it stays where it is.
  if (after !== null && parentOf(tree, after) === parent) moveNode(out, treeId, id, after, 'after');
  else if (after !== null) moveNode(out, treeId, id, parent, parent === ROOT ? 'end' : 'inside');
  else if (parent !== ROOT) moveNode(out, treeId, id, parent, 'first');
  else if (kidsOf(tree, ROOT)[0] !== id) moveNode(out, treeId, id, kidsOf(tree, ROOT)[0], 'before');
}

/** Makes the changes `d` in library `out` (and returns it). `at` stamps what lands in the trash. */
export function apply(out, d, at) {
  for (const [id, { node, keys }] of Object.entries(d.nodes)) {
    const mine = out.nodes[id];
    if (!mine) out.nodes[id] = structuredClone(node);
    else for (const key of keys) node[key] === undefined ? delete mine[key] : (mine[key] = structuredClone(node[key]));
  }
  for (const [treeId, changes] of Object.entries(d.trees)) {
    // A tree that is not here is made if it is new, or if things were put into it.
    if (!out.trees[treeId] && !changes.added && !changes.put.length) continue;
    const tree = (out.trees[treeId] ??= { id: treeId, name: changes.name, children: {}, collapsed: {} });
    for (const [id, parent, after, moved] of changes.put) {
      if (out.nodes[id] && (moved || !inTree(tree, id))) put(out, treeId, id, parent, after);
    }
    for (const id of changes.out) if (inTree(tree, id)) removeNode(out, treeId, id, at);
    for (const [id, on] of Object.entries(changes.collapsed)) on ? (tree.collapsed[id] = true) : delete tree.collapsed[id];
    if (changes.renamed) tree.name = changes.name;
    if (changes.redrawn) tree.icon = changes.icon;
  }
  for (const treeId of d.gone) if (out.trees[treeId] && Object.keys(out.trees).length > 1) delete out.trees[treeId];
  if (d.grid) out.grid = structuredClone(d.grid);
  forgetLoose(out, at);
  out.trash = out.trash.filter((entry) => !out.nodes[entry.node.id]);
  return out;
}

/** The library that has both my changes and theirs since `base`. */
export function merge(base, mine, theirs, at) {
  const out = apply(structuredClone(theirs), diff(base, mine), at);
  const binned = new Map([...out.trash, ...mine.trash].map((entry) => [entry.node.id, entry]));
  out.trash = [...binned.values()].filter((entry) => !out.nodes[entry.node.id]).sort((a, b) => a.at - b.at);
  return out;
}
