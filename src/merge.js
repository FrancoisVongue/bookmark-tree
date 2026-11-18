// Two copies of a library, and what is different between them.
//
// Two computers of one person, or this computer and what is saved elsewhere:
//   takeIn(mine, theirs)  makes mine what both say, by three rules (see there);
//                         it needs no memory of earlier meetings
//   hasNews(there, mine)  whether the other copy would learn anything from mine
//   mark(before, after)   stamps what the user changed with the time they did
//
// One change, to make it again in another copy - an undo:
//   diff(base, mine)    what I changed since `base`, as plain data: a history
//                       squeezed dry (what was added and then removed is not
//                       in it at all)
//   apply(copy, d)      makes those changes in another copy, as far as that
//                       copy allows
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

import { KEPT, ROOT, descendantsOf, forgetLoose, goneOf, handOf, inTree, kidsOf, moveNode, newTree, parentOf, parentsOf, placeNode, placedOf, planOf, quickOf, removeNode, removeTree, setCollapsed, setList } from './model.js';

const NO_TREE = { children: {}, collapsed: {} };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (...objects) => [...new Set(objects.flatMap((object) => Object.keys(object ?? {})))];

/** The entries of `list` that are out of step with the rest: the fewest that, taken out and put back, give this order from the rising one. (`rank`: each entry's place in that order.) */
function outOfStep(list, rank) {
  // The longest run of entries already in rising order stays; the classic way to find it.
  const tails = []; // tails[n]: index in `list` of the last entry of the best rising run of length n + 1.
  const before = [];
  list.forEach((id, at) => {
    let [low, high] = [0, tails.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rank(list[tails[middle]]) < rank(id)) low = middle + 1;
      else high = middle;
    }
    before[at] = low ? tails[low - 1] : -1;
    tails[low] = at;
  });
  const moved = new Set(list);
  for (let at = tails.at(-1) ?? -1; at !== -1; at = before[at]) moved.delete(list[at]);
  return moved;
}

/**
 * What changed in a tree. A node has moved if it has another parent, or was
 * taken out of its place among the siblings that were and still are its
 * siblings and put elsewhere among them. (Not if a neighbour came, went or
 * was moved past it: then every tab opened next to a node on one computer
 * would count as that node moved.)
 */
function diffTree(was, tree, changed) {
  const [before, after] = [parentsOf(was), parentsOf(tree)];
  const moved = new Set();
  for (const parent in tree.children) {
    const stayed = tree.children[parent].filter((id) => before.get(id) === parent);
    for (const id of tree.children[parent]) if (before.get(id) !== parent) moved.add(id);
    const rank = new Map(kidsOf(was, parent).map((id, at) => [id, at]));
    if (stayed.some((id, at) => at && rank.get(stayed[at - 1]) > rank.get(id))) for (const id of outOfStep(stayed, (each) => rank.get(each))) moved.add(id);
  }
  const put = [];
  const walk = (parent) =>
    kidsOf(tree, parent).forEach((id, at, kids) => {
      // A changed node's place is told too: a copy that does not have it in the tree puts it there.
      if (moved.has(id) || changed[id]) put.push([id, parent, kids[at - 1] ?? null, moved.has(id)]);
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
 * are left out, their children moving up into their place. Of the rest it
 * says nothing - nor that it was deleted: what was, in the whole, is noted.
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
  const gone = Object.fromEntries(goneOf(library).map((id) => [id, library.gone[id]]));
  return { ...library, nodes, trees, trash: [], gone }; // (The lists kept at hand are read through what is there: see model.js.)
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

const FACTS = ['url', 'title', 'home', 'touched', 'seen']; // What a node's tab says of it; the rest is what the user made of it.

/**
 * Stamps in `after` what the user changed since `before` with the time `at`
 * they did it (the times are told in model.js). What is no longer there is
 * noted as deleted then. Every change of theirs passes here - an operation,
 * an undo, a library put back - so no operation stamps anything itself.
 * (What tabs do by themselves is not the user's: see `seen` in core.js.)
 */
export function mark(before, after, at) {
  const d = diff(before, after);
  const stamp = (id, key) => after.nodes[id] && (after.nodes[id][key] = at);
  for (const [id, { keys }] of Object.entries(d.nodes)) {
    stamp(id, 'at');
    if (keys.some((key) => FACTS.includes(key))) stamp(id, 'seen'); // An address typed by hand, say.
  }
  for (const [treeId, changes] of Object.entries(d.trees)) {
    for (const [id, , , moved] of changes.put) if (moved) stamp(id, 'moved');
    for (const id of changes.out) stamp(id, 'moved');
    if (changes.added || changes.renamed || changes.redrawn || changes.quick) after.trees[treeId].at = at;
    if (Object.keys(changes.collapsed).length) after.trees[treeId].folded = at;
  }
  for (const id in { ...before.nodes, ...before.trees }) if (!after.nodes[id] && !after.trees[id]) (after.gone ??= {})[id] = at;
  if (d.grid) after.grid.at = at;
  if (d.plan) after.planAt = at;
}

/** Whether their copy of a thing was changed later than mine (`time`: the field of it that says when). */
const newer = (mine, theirs, time = 'at') => (theirs?.[time] ?? 0) > (mine?.[time] ?? 0);

/** Makes `mine` say what `theirs` says under each of `keys`. */
function say(mine, theirs, keys) {
  for (const key of keys) theirs[key] === undefined ? delete mine[key] : (mine[key] = structuredClone(theirs[key]));
}

/** When the user last changed a tree, or anything in it (`library`: the copy it is in). A deletion older than that did not know of it. */
const sinceOf = (library, tree) => Math.max(tree.at ?? 0, ...descendantsOf(tree, ROOT).map((id) => handOf(library.nodes[id])));

/**
 * Puts node `id` where it is in `from` (the same tree in another copy): under
 * the same parent, right after the nearest sibling before it there that is
 * its sibling here too; or before the nearest one after it; or, with no
 * sibling in common, last.
 */
function seat(library, treeId, from, id) {
  const tree = library.trees[treeId];
  const parent = parentOf(from, id);
  placeNode(library, treeId, id, parent);
  if (parent !== ROOT && !inTree(tree, parent)) return; // Its parent is not here: it stays where it is.
  const there = kidsOf(from, parent);
  const here = (each) => each !== id && parentOf(tree, each) === parent;
  const before = there.slice(0, there.indexOf(id)).findLast(here);
  const after = there.slice(there.indexOf(id) + 1).find(here);
  if (before) moveNode(library, treeId, id, before, 'after');
  else if (after) moveNode(library, treeId, id, after, 'before');
  else moveNode(library, treeId, id, parent, parent === ROOT ? 'end' : 'inside');
}

/**
 * Makes `library` what it and another copy of it (`theirs`) both say. This
 * is the one way two copies come together, whatever carried `theirs` here.
 * Nothing is remembered from one meeting to the next: each thing says when
 * the user last changed it (see model.js), and that is all it takes.
 *
 * 1. Of two copies of a thing, the one changed later is taken. A node is
 *    three things, each with its time: what the user made of it, its place,
 *    what its tab made of it. A tree's name, icon and quick row; its folds;
 *    the table of trees; the plan: each is one thing.
 * 2. Deleted is said by name and time (`gone`). Between a deletion and a
 *    node or a tree, the later is right: changed or brought back since, it
 *    stays; else it goes, to the trash here.
 * 3. What one copy lacks and no deletion names is added. `theirs` may be
 *    only a part of their library (see `only`): what it does not mention,
 *    it says nothing about.
 *
 * The order in a tree is no node's alone, so "the later place" is told so:
 * it starts from the copy where a node of the tree was placed last, and
 * each node the other copy placed later than this one did is put where that
 * copy has it. So both copies come to the same order, whichever takes the
 * other in.
 *
 * The times are the computers' own clocks: if one runs behind, its changes
 * lose to earlier ones made on the other for as long as it is behind by.
 * (`at`: now.)
 */
export function takeIn(library, theirs, at) {
  library.gone ??= {};
  // (A deletion too old to be kept - see expire in model.js - is not taken either: else whoever still has it would tell it again and again.)
  const told = goneOf(theirs).map((id) => [id, theirs.gone[id]]).filter(([, when]) => when > at - KEPT);
  // 2. What they deleted since I last had a hand in it goes; what I deleted since they last had, is not taken.
  for (const [id, when] of told) if (library.nodes[id] && when >= handOf(library.nodes[id])) for (const treeId in library.trees) removeNode(library, treeId, id, when);
  const dead = (id, since) => !library.nodes[id] && !library.trees[id] && library.gone[id] >= since;
  const taken = new Set(Object.keys(theirs.nodes).filter((id) => !dead(id, handOf(theirs.nodes[id]))));
  // Trees before nodes: the places go by the times of the nodes as each copy has them.
  const leaving = []; // [treeId, id]: taken out only once everything has its place, so nothing is without a tree in between.
  for (const other of Object.values(only(theirs, taken).trees)) {
    const tree = library.trees[other.id];
    if (!tree) {
      if (!dead(other.id, sinceOf(theirs, other))) library.trees[other.id] = structuredClone(other); // 3.
      continue;
    }
    const [mine, their] = [{ tree: { children: tree.children }, nodes: library.nodes }, { tree: other, nodes: theirs.nodes }];
    const latest = (copy) => Math.max(0, ...descendantsOf(copy.tree, ROOT).map((id) => placedOf(copy.nodes[id])));
    const [base, from] = latest(their) > latest(mine) ? [their, mine] : [mine, their];
    const [inBase, inFrom] = [parentsOf(base.tree), parentsOf(from.tree)];
    const later = (id) => placedOf(from.nodes[id]) - placedOf(base.nodes[id]); // Above 0: the other copy placed it later.
    tree.children = structuredClone(base.tree.children);
    // Top to bottom: so each finds its parent, and the siblings before it, already there. (What only the other copy has in the tree comes too.)
    for (const id of descendantsOf(from.tree, ROOT)) if (later(id) > 0 || (later(id) === 0 && !inBase.has(id))) seat(library, tree.id, from.tree, id);
    for (const id of inBase.keys()) if (later(id) > 0 && !inFrom.has(id)) leaving.push([tree.id, id]);
    if (newer(tree, other)) {
      say(tree, other, ['name', 'icon', 'at']);
      setList(tree, 'quick', withUnsaid(quickOf(other), quickOf(tree), theirs));
    }
    if (newer(tree, other, 'folded')) {
      const now = parentsOf(tree);
      for (const id of parentsOf(other).keys()) if (now.has(id)) setCollapsed(library, tree.id, id, !!other.collapsed[id]);
      tree.folded = other.folded;
    }
  }
  // 2, for trees: one they deleted goes, if nothing in it is later than that. (Only now: there is always a tree, and theirs are here.)
  for (const [id, when] of told) {
    if (library.trees[id] && when >= sinceOf(library, library.trees[id])) removeTree(library, id, when);
    if (!library.nodes[id] && !library.trees[id]) library.gone[id] = Math.max(library.gone[id] ?? 0, when);
  }
  for (const id of taken) {
    const [node, here] = [theirs.nodes[id], library.nodes[id]];
    if (!here) library.nodes[id] = structuredClone(node); // 3.
    else {
      if (newer(here, node, 'seen')) say(here, node, FACTS);
      if (newer(here, node, 'moved')) say(here, node, ['moved']);
      if (newer(here, node)) say(here, node, keysOf(here, node).filter((key) => !FACTS.includes(key) && key !== 'moved'));
    }
  }
  for (const [treeId, id] of leaving) removeNode(library, treeId, id, at);
  if (newer(library.grid, theirs.grid)) library.grid = structuredClone(theirs.grid);
  if (newer(library, theirs, 'planAt')) {
    setList(library, 'plan', withUnsaid(planOf(theirs), planOf(library), theirs));
    library.planAt = theirs.planAt;
  }
  forgetLoose(library, at);
  library.trash = library.trash.filter((entry) => !library.nodes[entry.node.id]);
  return library;
}

/** Their list kept at hand, and after it the entries of mine they say nothing about (theirs may be a part of a library). */
const withUnsaid = (list, mine, theirs) => [...list, ...mine.filter((id) => !theirs.nodes[id])];

/** Whether a copy `there` would learn anything from `mine`: whether taking mine in would change it. */
export function hasNews(there, mine, at) {
  const copy = { gone: {}, ...structuredClone(there) };
  const was = JSON.stringify(copy);
  return JSON.stringify(takeIn(copy, mine, at)) !== was;
}
