// Two copies of the library that both changed since they were last the same.
//
//   diff(base, mine)    what I changed since `base`, as plain data: a history
//                       squeezed dry (what was added and then removed is not
//                       in it at all)
//   apply(copy, d)      makes those changes again in another copy, as far as
//                       that copy allows
//   takeIn              brings another copy's changes into mine: theirs since
//                       the base, except where I changed the same thing
//
// Nothing is lost quietly: what only one side has stays, and what one side
// deleted goes to the other's trash rather than away. Pure: no Chrome here.
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

import { ROOT, bornOf, descendantsOf, forgetLoose, inTree, kidsOf, moveNode, newTree, parentOf, parentsOf, placeNode, planOf, quickOf, removeNode, removeTree, setCollapsed, setList } from './model.js';

export const EMPTY = { nodes: {}, trees: {}, trash: [] };
const NO_TREE = { children: {}, collapsed: {} };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (...objects) => [...new Set(objects.flatMap((object) => Object.keys(object ?? {})))];

/**
 * What changed in a tree. A node has moved if it has another parent, or
 * stands otherwise among the siblings that were and still are its siblings.
 * (Not if a neighbour came or went: then every tab opened next to a node
 * on one computer would count as that node moved.)
 */
function diffTree(was, tree, changed) {
  const [before, after] = [parentsOf(was), parentsOf(tree)];
  const stayed = (id, parent) => before.get(id) === parent && after.get(id) === parent;
  /** Each node that kept its parent, with the nearest sibling before it that kept it too. */
  const anchors = ({ children }) => {
    const anchor = new Map();
    for (const parent in children) children[parent].reduce((last, id) => (stayed(id, parent) ? (anchor.set(id, last), id) : last), null);
    return anchor;
  };
  const [anchorWas, anchorNow] = [anchors(was), anchors(tree)];
  const put = [];
  const walk = (parent) =>
    kidsOf(tree, parent).forEach((id, at, kids) => {
      const moved = !stayed(id, parent) || anchorWas.get(id) !== anchorNow.get(id);
      // A changed node's place is told too: a copy that does not have it in the tree puts it there.
      if (moved || changed[id]) put.push([id, parent, kids[at - 1] ?? null, moved]);
      walk(id);
    });
  walk(ROOT);
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

/** Of the changes `theirs` to a list kept at hand, those about entries I did not put, move or take out myself (`mine`). */
function keepMineInList(theirs, mine) {
  if (!theirs || !mine) return theirs;
  const touched = new Set([...mine.put.map(([id]) => id), ...mine.out]);
  const [put, out] = [theirs.put.filter(([id]) => !touched.has(id)), theirs.out.filter((id) => !touched.has(id))];
  return put.length || out.length ? { put, out } : undefined;
}

/**
 * Of the changes `d` made elsewhere, leaves out those to things I changed
 * myself since the same base (`mine`: my own changes, as a diff): my field
 * of a node, my place for it, my fold, my name for a tree, my table of
 * trees. Whoever made `d` did not know of these when they made theirs.
 */
function keepMine(d, mine) {
  for (const [id, change] of Object.entries(d.nodes)) {
    const kept = mine.nodes[id]?.keys ?? [];
    change.keys = change.keys.filter((key) => !kept.includes(key));
  }
  for (const [treeId, theirs] of Object.entries(d.trees)) {
    const here = mine.trees[treeId];
    if (!here) continue;
    const moved = new Set(here.put.filter((entry) => entry[3]).map(([id]) => id));
    const removed = new Set(here.out);
    theirs.put = theirs.put.filter(([id]) => !moved.has(id) && !removed.has(id));
    theirs.out = theirs.out.filter((id) => !moved.has(id));
    for (const id in here.collapsed) delete theirs.collapsed[id];
    theirs.renamed &&= !here.renamed;
    theirs.redrawn &&= !here.redrawn;
    theirs.quick = keepMineInList(theirs.quick, here.quick);
  }
  if (mine.grid) delete d.grid;
  d.plan = keepMineInList(d.plan, mine.plan);
  if (!d.plan) delete d.plan;
}

/**
 * Takes into `library` what changed elsewhere: from `base`, a state both
 * sides knew, to `theirs`. This is the one way two copies come together,
 * whatever carried `theirs` here. Three rules:
 *
 * - What I changed since `base` stays as I made it; of their changes, the
 *   rest is taken. Without a `base` everything here counts as mine: then
 *   only what is missing here is added, and nothing is moved, renamed or
 *   removed. (So a base older than it could be costs nothing but some of
 *   their changes to things I changed too.)
 * - `theirs` may be only a part of their library: what it does not mention
 *   it says nothing about. Nothing is deleted here for being absent there.
 * - A node is deleted by name and time (`gone`: { id: when } - what they
 *   know was deleted). Between a deletion and a node, the later is right:
 *   a node added or restored after it stays or comes back, any other goes -
 *   theirs here, and mine there, by the same rule, whatever is known of a
 *   common past.
 *
 * A tree they deleted is deleted here if they knew all of it. If nodes were
 * put into it here since `base`, they never saw those: the tree stays, with
 * them and the nodes above them; the rest of it goes, as it would have.
 */
export function takeIn(library, base, theirs, gone, at) {
  const spoken = new Set(Object.keys(theirs.nodes));
  const was = only(base ?? EMPTY, spoken);
  const d = diff(was, theirs);
  keepMine(d, diff(was, only(library, spoken)));
  // A node of theirs that is not here: deleted here since it came to be there, or new to me.
  library.gone ??= {};
  for (const id of Object.keys(d.nodes).filter((id) => !library.nodes[id])) {
    if (library.gone[id] >= bornOf(theirs.nodes[id])) delete d.nodes[id];
    else delete library.gone[id];
  }
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
  for (const [id, when] of Object.entries(gone)) {
    const node = library.nodes[id];
    if (spared.has(id) || (node && when <= bornOf(node))) continue;
    if (node) for (const tree in library.trees) removeNode(library, tree, id, at);
    // Noted with the time it was deleted there, not the time I heard: every copy tells the same of it.
    library.gone[id] = node ? when : Math.max(library.gone[id] ?? 0, when);
  }
  return library;
}
