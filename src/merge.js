// Bringing together two copies of the library that both changed since they
// were last the same (`base`): mine, on this computer, and theirs, the one
// kept elsewhere. The result is theirs with my changes made again on top.
// Nothing is lost quietly: what only one side has stays, and what one side
// deleted goes to the trash rather than away. Pure: no Chrome here.

import { ROOT, descendantsOf, forgetLoose, inTree, kidsOf, moveNode, parentOf, placeNode, removeNode } from './model.js';

export const EMPTY = { nodes: {}, trees: {}, trash: [] };
const NO_TREE = { children: {}, collapsed: {} };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** One value out of three: mine if I changed it, otherwise theirs. */
const pick = (base, mine, theirs) => (same(mine, base) ? theirs : mine);

/** Field by field. */
function pickEach(base, mine, theirs) {
  const out = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const value = pick(base[key], mine[key], theirs[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Where a node sits: under which parent, after which sibling. */
function placeOf(tree, id) {
  const parent = parentOf(tree, id);
  if (parent === undefined) return undefined;
  const kids = kidsOf(tree, parent);
  return { parent, after: kids[kids.indexOf(id) - 1] };
}

/** Puts `id` under `parent`, right after sibling `after` (first, without one), as far as the tree allows. */
function put(out, treeId, id, { parent, after }) {
  const tree = out.trees[treeId];
  placeNode(out, treeId, id, parent);
  if (parent !== ROOT && !inTree(tree, parent)) return; // My parent is not there: it stays where it is.
  if (after !== undefined && parentOf(tree, after) === parent) moveNode(out, treeId, id, after, 'after');
  else if (after !== undefined) moveNode(out, treeId, id, parent, parent === ROOT ? 'end' : 'inside');
  else if (parent !== ROOT) moveNode(out, treeId, id, parent, 'first');
  else if (kidsOf(tree, ROOT)[0] !== id) moveNode(out, treeId, id, kidsOf(tree, ROOT)[0], 'before');
}

/** Makes my changes to one tree again in the merged library. */
function mergeTree(out, treeId, base, mine, at) {
  const tree = out.trees[treeId];
  // What I added or moved goes where I put it.
  for (const id of descendantsOf(mine, ROOT)) {
    if (!out.nodes[id]) continue; // They deleted it and I never touched it.
    const [was, now] = [placeOf(base, id), placeOf(mine, id)];
    if (inTree(tree, id) && same(was, now)) continue;
    put(out, treeId, id, now);
  }
  // What I took out goes out.
  for (const id of descendantsOf(base, ROOT)) {
    if (!inTree(mine, id) && inTree(tree, id)) removeNode(out, treeId, id, at);
  }
  tree.collapsed = pickEach(base.collapsed, mine.collapsed, tree.collapsed);
  tree.name = pick(base.name, mine.name, tree.name);
}

/** The library that has both my changes and theirs since `base`. `at` stamps what lands in the trash. */
export function merge(base, mine, theirs, at) {
  const out = structuredClone(theirs);

  for (const id of new Set([...Object.keys(mine.nodes), ...Object.keys(theirs.nodes)])) {
    const [was, my, their] = [base.nodes[id], mine.nodes[id], theirs.nodes[id]];
    if (my && their) out.nodes[id] = pickEach(was ?? {}, my, their);
    else if (my && !same(my, was)) out.nodes[id] = structuredClone(my); // New, or changed after they deleted it.
  }

  for (const [treeId, tree] of Object.entries(mine.trees)) {
    const was = base.trees[treeId];
    if (!out.trees[treeId]) {
      if (was && same(tree, was)) continue; // They deleted a tree I left alone.
      out.trees[treeId] = { id: treeId, name: tree.name, children: {}, collapsed: {} };
      mergeTree(out, treeId, NO_TREE, tree, at);
    } else {
      mergeTree(out, treeId, was ?? NO_TREE, tree, at);
    }
  }
  // A tree I deleted goes, unless they changed it meanwhile.
  for (const treeId in base.trees) {
    const untouched = same(theirs.trees[treeId], base.trees[treeId]);
    if (!mine.trees[treeId] && untouched && Object.keys(out.trees).length > 1) delete out.trees[treeId];
  }

  forgetLoose(out, at);
  const binned = new Map([...out.trash, ...mine.trash].map((entry) => [entry.node.id, entry]));
  out.trash = [...binned.values()].filter((entry) => !out.nodes[entry.node.id]).sort((a, b) => a.at - b.at);
  return out;
}
