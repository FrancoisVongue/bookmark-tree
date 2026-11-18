// Two copies of a library, and what is different between them.
//
// By what changed - for an undo, and to know what an operation touched:
//   diff(base, mine)    what I changed since `base`, as plain data: a history
//                       squeezed dry (what was added and then removed is not
//                       in it at all)
//   apply(copy, d)      makes those changes again in another copy, as far as
//                       that copy allows
//   mark(before, after) stamps what the user changed with the time they did
//
// By time - for two copies of the same library on two computers, or here
// and saved elsewhere:
//   takeIn(mine, theirs)  makes mine what both say, the later word on each
//                         thing; needs no memory of earlier meetings
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

import { KEPT, ROOT, atOf, descendantsOf, forgetLoose, handOf, inTree, kidsOf, moveNode, newTree, parentOf, parentsOf, placeNode, planOf, quickOf, removeNode, removeTree, setCollapsed, setList } from './model.js';

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

const FACTS = ['url', 'title', 'home', 'touched', 'seen']; // What a node's tab says of it; the rest is what the user made of it.
const movedOf = (node) => node?.moved ?? 0;

/**
 * Stamps in `after` what the user changed since `before` with the time `at`
 * they did it: the nodes they edited or folded (`at`), those they moved
 * (`moved`), the trees they named, the table of trees, the plan. What is
 * back is no longer noted as deleted; what is no longer there is, as of
 * then. (What tabs do by themselves is not for this: see `seen` in core.js.)
 */
export function mark(before, after, at) {
  const d = diff(before, after);
  const gone = (after.gone ??= {});
  const stamp = (id, key) => after.nodes[id] && ((after.nodes[id][key] = at), delete gone[id]);
  for (const [id, { keys }] of Object.entries(d.nodes)) {
    stamp(id, 'at');
    if (keys.some((key) => FACTS.includes(key))) stamp(id, 'seen'); // An address typed by hand, say.
  }
  for (const [treeId, changes] of Object.entries(d.trees)) {
    for (const [id, , , moved] of changes.put) if (moved) stamp(id, 'moved');
    for (const id of changes.out) stamp(id, 'moved');
    for (const id in changes.collapsed) stamp(id, 'at');
    if (changes.added || changes.renamed || changes.redrawn || changes.quick) after.trees[treeId].at = at;
    delete gone[treeId];
  }
  for (const id in { ...before.nodes, ...before.trees }) if (!after.nodes[id] && !after.trees[id]) gone[id] ??= at;
  if (d.grid) after.grid.at = at;
  if (d.plan) after.planAt = at;
}

/**
 * Puts node `id` into a tree where it is in `from` (the same tree in another
 * copy; `up`: its parents there): under the same parent, right after the
 * nearest sibling before it there that is its sibling here too; or before
 * the nearest one after it; or, with no sibling in common, at the end.
 */
function seat(library, treeId, from, up, id) {
  const tree = library.trees[treeId];
  const parent = up.get(id);
  placeNode(library, treeId, id, parent);
  if (parent !== ROOT && !inTree(tree, parent)) return; // Its parent is not here: it stays where it is.
  const there = kidsOf(from, parent);
  const here = (each) => each !== id && parentOf(tree, each) === parent;
  const before = there.slice(0, there.indexOf(id)).findLast(here);
  const after = before ?? there.slice(there.indexOf(id) + 1).find(here);
  if (before) moveNode(library, treeId, id, before, 'after');
  else if (after) moveNode(library, treeId, id, after, 'before');
  else if (parent === ROOT) moveNode(library, treeId, id, undefined, 'end');
  else moveNode(library, treeId, id, parent, 'inside');
}

/**
 * Deletes a tree that another copy deleted at time `when` - if they knew all
 * of it. Nodes put into it or changed here since then they never saw: with
 * those the tree stays, and the nodes above them; the rest of it goes, as it
 * would have.
 */
function fell(library, treeId, when) {
  const tree = library.trees[treeId];
  const unseen = descendantsOf(tree, ROOT).filter((id) => handOf(library.nodes[id]) > when);
  if (!unseen.length) return removeTree(library, treeId, when);
  const parents = parentsOf(tree);
  const staying = new Set(unseen);
  for (const id of unseen) for (let up = parents.get(id); up !== ROOT && !staying.has(up); up = parents.get(up)) staying.add(up);
  for (const id of descendantsOf(tree, ROOT)) if (!staying.has(id)) removeNode(library, treeId, id, when);
  // The nodes above them stay too, though deleting the tree named them: as if changed just after. (Not "now": every copy must say the same.)
  for (const id of staying) if (handOf(library.nodes[id]) <= when) library.nodes[id].at = when + 1;
}

/**
 * Makes `library` what it and another copy of it (`theirs`) both say, the
 * later word on each thing. This is the one way two copies come together,
 * whatever carried `theirs` here, and it remembers nothing between one
 * meeting and the next: each thing that can differ says when it was last
 * made so (see model.js). The rules:
 *
 * - A node both have: what the user made of it - name, icon, text, pin,
 *   fold - is taken from the copy where they last did (`at`); its place,
 *   from the copy where they last moved it (`moved`); what its tab made of
 *   it, from the copy where the tab last did (`seen`). Three times, because
 *   these are three things: a title that changed by itself does not make a
 *   node the later one, and a new name does not put it back where it was.
 * - A tree's order starts from the copy where a node of it was moved last,
 *   and has the nodes the other copy moved later than this one knew put in,
 *   oldest move first. So both copies come to the same order, whichever
 *   takes the other in.
 * - Deleted is said by name and time (`gone`: { id: when }, what they know
 *   was deleted; mine is in the library). Between a deletion and a node or a
 *   tree, the later is right: changed or brought back since, it stays, and
 *   their note goes; else it goes, to the trash here. (A tree deleted there
 *   stays here with the nodes its deleter never saw, if there are any.)
 * - What one copy lacks and no deletion names is added. `theirs` may be only
 *   a part of their library: what it does not mention, it says nothing about.
 * - A tree's name, icon and quick row; the table of trees; the plan: each
 *   whole, from the copy that changed it last.
 *
 * The times are the computers' own clocks: if one runs behind, its changes
 * lose to earlier ones made on the other for as long as it is behind by.
 */
export function takeIn(library, theirs, gone, at) {
  library.gone ??= {};
  // (Deletions too old to be kept here are passed over: else whoever still has them would tell them again and again.)
  const told = Object.entries(gone).filter(([, when]) => when > at - KEPT);
  // Trees first: a tree that stays keeps some of the nodes its deletion named.
  for (const [id, when] of told) if (library.trees[id] && when > atOf(library.trees[id])) fell(library, id, when);
  for (const [id, when] of told) {
    if (library.nodes[id] && when > handOf(library.nodes[id])) for (const tree in library.trees) removeNode(library, tree, id, when);
    if (!library.nodes[id] && !library.trees[id]) library.gone[id] = Math.max(library.gone[id] ?? 0, when);
  }
  const mine = structuredClone(library.nodes); // As they were before theirs came in.
  const taken = new Set();
  for (const [id, node] of Object.entries(theirs.nodes)) {
    if (library.gone[id] >= handOf(node)) continue; // Deleted here since they last had a hand in it: it stays deleted, and they will hear.
    delete library.gone[id];
    taken.add(id);
    const here = library.nodes[id] ?? node;
    const made = structuredClone(atOf(node) > atOf(here) ? node : here);
    const tab = (node.seen ?? 0) > (here.seen ?? 0) ? node : here;
    for (const key of FACTS) tab[key] === undefined ? delete made[key] : (made[key] = structuredClone(tab[key]));
    if (Math.max(movedOf(node), movedOf(here))) made.moved = Math.max(movedOf(node), movedOf(here));
    library.nodes[id] = made;
  }
  const leaving = []; // [treeId, id]: taken out only once everything has its place, so nothing is without a tree in between.
  const theirAt = (id) => movedOf(theirs.nodes[id]);
  const myAt = (id) => movedOf(mine[id]);
  for (const other of Object.values(only(theirs, taken).trees)) {
    const had = library.trees[other.id];
    // A tree deleted here comes back only with something its deletion did not know of: its own change, or a node's.
    const since = Math.max(atOf(other), ...descendantsOf(other, ROOT).map((id) => handOf(theirs.nodes[id])));
    if (!had && library.gone[other.id] >= since) continue;
    delete library.gone[other.id];
    const { children, collapsed, ...named } = other;
    const whose = !had || atOf(other) > atOf(had) ? named : had; // Its name, icon, quick row.
    const latest = (tree, when) => Math.max(0, ...descendantsOf(tree, ROOT).map(when));
    // The copy to start from, and the one to put in from: each as { tree, nodes, moved(id) }.
    const [here, there] = [{ tree: had ?? newTree(), nodes: mine, moved: myAt }, { tree: other, nodes: theirs.nodes, moved: theirAt }];
    const [base, from] = had && latest(other, theirAt) <= latest(had, myAt) ? [here, there] : [there, here];
    const tree = (library.trees[other.id] = { ...structuredClone(whose), children: structuredClone(base.tree.children), collapsed: { ...base.tree.collapsed } });
    const [inBase, up] = [parentsOf(base.tree), parentsOf(from.tree)];
    const later = (id) => from.moved(id) > base.moved(id);
    // What the other copy moved later, or has and this one says nothing against: put in, oldest move first.
    const coming = descendantsOf(from.tree, ROOT).filter((id) => library.nodes[id] && (later(id) || (!inBase.has(id) && from.moved(id) >= base.moved(id))));
    for (const id of coming.sort((a, b) => from.moved(a) - from.moved(b))) seat(library, tree.id, from.tree, up, id);
    // Its folds, where the other copy changed the node later.
    for (const id of up.keys()) if (atOf(from.nodes[id]) > atOf(base.nodes[id])) setCollapsed(library, tree.id, id, !!from.tree.collapsed[id]);
    // What the other copy took out of the tree later than this one last moved it. (Only what that copy speaks of at all.)
    for (const id of inBase.keys()) if (id in from.nodes && !up.has(id) && later(id)) leaving.push([tree.id, id]);
  }
  for (const [treeId, id] of leaving) removeNode(library, treeId, id, at);
  if (atOf(theirs.grid) > atOf(library.grid)) library.grid = structuredClone(theirs.grid);
  if ((theirs.planAt ?? 0) > (library.planAt ?? 0)) {
    setList(library, 'plan', theirs.plan ?? []);
    library.planAt = theirs.planAt;
  }
  forgetLoose(library, at);
  library.trash = library.trash.filter((entry) => !library.nodes[entry.node.id]);
  return library;
}

/** Whether a copy `there` would learn anything from `mine`: whether taking mine in would change it. (`gone`: what each knows was deleted.) */
export function hasNews(there, thereGone, mine, mineGone, at) {
  const copy = { ...structuredClone(there), gone: { ...thereGone } };
  const was = JSON.stringify(copy);
  return JSON.stringify(takeIn(copy, mine, mineGone, at)) !== was;
}
