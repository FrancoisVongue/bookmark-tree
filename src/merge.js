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
//   d.trees  { [treeId]: { name, renamed, icon, redrawn, added, quick?,
//                          put: [[id, parent, after, moved]],  places, top to bottom
//                          out: [id],                          taken out of the tree
//                          collapsed: { [id]: bool } } }
//   d.felled [treeId]                   trees deleted
//   d.grid   the table of trees, if it changed (taken whole)
//   d.plan, a tree's `quick`   { put: [[id, after]], out: [id] }   a list kept at hand (see model.js), entry by entry:
//                              those put in (or moved), first to last; those taken out. Not there, if nothing changed

import { ROOT, descendantsOf, forgetLoose, goneOf, inTree, kidsOf, moveNode, newTree, parentOf, parentsOf, placeNode, planOf, quickOf, removeNode, removeTree, setCollapsed, setList } from './model.js';

export const EMPTY = { nodes: {}, trees: {}, trash: [] };
const NO_TREE = { children: {}, collapsed: {} };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (...objects) => [...new Set(objects.flatMap((object) => Object.keys(object ?? {})))];

/** Where each node of a tree sits: under which parent, after which sibling. (All at once: a diff asks it of every node.) */
function placesIn(tree) {
  const places = new Map();
  for (const parent in tree.children) {
    tree.children[parent].forEach((id, at, kids) => places.has(id) || places.set(id, { parent, after: kids[at - 1] }));
  }
  return places;
}

function diffTree(was, tree, changed) {
  const [before, after] = [placesIn(was), placesIn(tree)];
  const put = [];
  for (const id of descendantsOf(tree, ROOT)) {
    const now = after.get(id);
    const moved = !same(before.get(id), now);
    // A changed node's place is told too: where it was deleted meanwhile, it comes back there.
    if (moved || changed[id]) put.push([id, now.parent, now.after ?? null, moved]);
  }
  const collapsed = {};
  for (const id of keysOf(was.collapsed, tree.collapsed)) {
    if (!!was.collapsed[id] !== !!tree.collapsed[id]) collapsed[id] = !!tree.collapsed[id];
  }
  const out = descendantsOf(was, ROOT).filter((id) => !after.has(id));
  return { name: tree.name, renamed: tree.name !== was.name, icon: tree.icon, redrawn: tree.icon !== was.icon, put, out, collapsed, quick: diffList(quickOf(was), quickOf(tree)) };
}

/** A list kept at hand, entry by entry: those new or after another entry than before, and those no longer in it. Nothing, if it is the same. */
function diffList(was, list) {
  const put = list.map((id, at) => [id, list[at - 1] ?? null]).filter(([id, after]) => !was.includes(id) || (was[was.indexOf(id) - 1] ?? null) !== after);
  const out = was.filter((id) => !list.includes(id));
  return put.length || out.length ? { put, out } : undefined;
}

/** Makes the changes `d` (see diffList) in `list`; `has` says which ids can be in it here. */
function applyList(list, d, has) {
  list = list.filter((id) => !d.out.includes(id));
  for (const [id, after] of d.put) {
    if (!has(id)) continue;
    list = list.filter((each) => each !== id);
    list.splice(after === null ? 0 : list.indexOf(after) + 1 || list.length, 0, id); // After an entry that is not here: at the end.
  }
  return list;
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
  return { ...library, nodes, trees, trash: [] }; // (The lists kept at hand are read through what is there: see model.js.)
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
    const quiet = !entry.added && !entry.renamed && !entry.redrawn && !entry.put.length && !entry.out.length && !Object.keys(entry.collapsed).length && !entry.quick;
    if (!quiet) d.trees[treeId] = entry;
  }
  if (!same(base.grid, mine.grid)) d.grid = mine.grid;
  const plan = diffList(planOf(base), planOf(mine));
  if (plan) d.plan = plan;
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
    if (changes.quick) setList(tree, 'quick', applyList(quickOf(tree), changes.quick, (id) => inTree(tree, id)));
  }
  for (const treeId of d.felled) removeTree(out, treeId, at);
  if (d.grid) out.grid = structuredClone(d.grid);
  if (d.plan) setList(out, 'plan', applyList(planOf(out), d.plan, (id) => out.nodes[id]));
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
 *
 * A tree they deleted is deleted here if they knew all of it. If nodes were
 * put into it here since `base`, they never saw those: the tree stays, with
 * them and the nodes above them; the rest of it goes, as it would have.
 */
export function takeIn(library, base, theirs, told, at) {
  const deleted = base ? told : [...goneOf(library), ...told];
  const d = diff(only(base ?? EMPTY, new Set(Object.keys(theirs.nodes))), theirs);
  const leaving = []; // [treeId, id]: what goes from the trees that stay.
  const spared = new Set(); // What stays in them: not deleted, though deleting their tree named it so.
  d.felled = d.felled.filter((treeId) => {
    const mine = library.trees[treeId];
    const known = new Set(descendantsOf(base.trees[treeId], ROOT));
    const unseen = mine ? descendantsOf(mine, ROOT).filter((id) => !known.has(id)) : [];
    if (!unseen.length) return true;
    const parents = parentsOf(mine);
    const staying = new Set(unseen);
    for (const id of unseen) for (let up = parents.get(id); up !== ROOT && !staying.has(up); up = parents.get(up)) staying.add(up);
    for (const id of descendantsOf(mine, ROOT)) staying.has(id) ? spared.add(id) : leaving.push([treeId, id]);
    return false;
  });
  apply(library, d, at);
  for (const [treeId, id] of leaving) removeNode(library, treeId, id, at);
  for (const id of deleted) if (!spared.has(id)) for (const tree in library.trees) removeNode(library, tree, id, at);
  return library;
}
