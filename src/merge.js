// Two copies of the library that both changed since they were last the same.
//
//   diff(base, mine)    what I changed since `base`, as plain data: a history
//                       squeezed dry (what was added and then removed is not
//                       in it at all)
//   apply(copy, d)      makes those changes again in another copy, as far as
//                       that copy allows
//   takeIn              = apply(mine, diff(base, theirs)), with care for
//                       what `theirs` does not speak of
//
// Nothing is lost quietly: what only one side has stays, and what one side
// deleted goes to the other's trash rather than away. (One thing is taken
// whole: the table of trees. Of two rearrangements of it made at once, one
// wins.) Pure: no Chrome here.
//
//   d.nodes  { [id]: { node, keys } }   a new or changed node, and which of its fields changed
//   d.trees  { [treeId]: { name, renamed, icon, redrawn, added,
//                          put: [[id, parent, after, moved]],  places, top to bottom
//                          out: [id],                          taken out of the tree
//                          collapsed: { [id]: bool } } }
//   d.felled [treeId]                   trees deleted
//   d.grid   the table of trees, if it changed (taken whole)
//   d.plan   { put: [[id, after]], out: [id] }   entries of the plan put in (or moved), top to bottom; taken out

import { ROOT, descendantsOf, forgetLoose, goneOf, inTree, kidsOf, moveNode, newTree, parentOf, placeNode, planOf, removeNode, removeTree, setCollapsed, setPlan } from './model.js';

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

/** The plan, entry by entry: those new or after another entry than before, and those no longer in it. */
function diffPlan(was, plan) {
  const put = plan.map((id, at) => [id, plan[at - 1] ?? null]).filter(([id, after]) => !was.includes(id) || (was[was.indexOf(id) - 1] ?? null) !== after);
  return { put, out: was.filter((id) => !plan.includes(id)) };
}

/**
 * The part of a library that is about the nodes `ids` (a Set): the others
 * are left out, their children moving up into their place.
 */
export function only(library, ids) {
  const trees = {};
  for (const tree of Object.values(library.trees)) {
    const children = {};
    const walk = (id, under) => {
      for (const kid of kidsOf(tree, id)) {
        if (ids.has(kid)) (children[under] ??= []).push(kid);
        walk(kid, ids.has(kid) ? kid : under);
      }
    };
    walk(ROOT, ROOT);
    const collapsed = Object.fromEntries(Object.entries(tree.collapsed).filter(([id]) => ids.has(id)));
    trees[tree.id] = { ...tree, children, collapsed };
  }
  const nodes = Object.fromEntries(Object.entries(library.nodes).filter(([id]) => ids.has(id)));
  const part = { ...library, nodes, trees, trash: [] };
  if (library.plan) part.plan = planOf(part);
  return part;
}

/** What changed from `base` to `mine`. */
export function diff(base, mine) {
  const d = { nodes: {}, trees: {}, felled: Object.keys(base.trees).filter((id) => !mine.trees[id]) };
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
  const plan = diffPlan(planOf(base), planOf(mine));
  if (plan.put.length || plan.out.length) d.plan = plan;
  return d;
}

export const isEmpty = (d) => !Object.keys(d.nodes).length && !Object.keys(d.trees).length && !d.felled.length && !d.grid && !d.plan;

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
    const tree = (out.trees[treeId] ??= newTree(treeId, changes.name));
    for (const [id, parent, after, moved] of changes.put) {
      if (out.nodes[id] && (moved || !inTree(tree, id))) put(out, treeId, id, parent, after);
    }
    for (const id of changes.out) if (inTree(tree, id)) removeNode(out, treeId, id, at);
    for (const [id, on] of Object.entries(changes.collapsed)) setCollapsed(out, treeId, id, on);
    if (changes.renamed) tree.name = changes.name;
    if (changes.redrawn) tree.icon = changes.icon;
  }
  for (const treeId of d.felled) removeTree(out, treeId, at);
  if (d.grid) out.grid = structuredClone(d.grid);
  if (d.plan) {
    let plan = planOf(out).filter((id) => !d.plan.out.includes(id));
    for (const [id, after] of d.plan.put) {
      if (!out.nodes[id]) continue;
      plan = plan.filter((each) => each !== id);
      plan.splice(after === null ? 0 : plan.indexOf(after) + 1 || plan.length, 0, id); // After an entry that is not here: at the end.
    }
    setPlan(out, plan);
  }
  forgetLoose(out, at);
  out.trash = out.trash.filter((entry) => !out.nodes[entry.node.id]);
  return out;
}

/**
 * Takes into `library` what changed elsewhere: from `base`, the state both
 * sides last knew, to `theirs`. This is the one way two copies come
 * together, whatever carried `theirs` here.
 *
 * `theirs` may be only a part of their library: what it does not mention it
 * says nothing about. So nothing is deleted here for being absent there -
 * only the nodes `told` (ids), which they said they deleted. Without a
 * `base` the two have no past in common and are simply put together; what
 * was deleted here stays deleted even so.
 */
export function takeIn(library, base, theirs, told, at) {
  const deleted = base ? told : [...goneOf(library), ...told];
  apply(library, diff(only(base ?? EMPTY, new Set(Object.keys(theirs.nodes))), theirs), at);
  for (const id of deleted) for (const tree in library.trees) removeNode(library, tree, id, at);
  return library;
}
