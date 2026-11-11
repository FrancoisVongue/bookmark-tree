// Everything the user can do to the library, by name. A change is a record
// { op, args } applied by the one owner (the worker); the same record can be
// logged, undone and replayed. Pure: no Chrome here.

import {
  ROOT,
  addNode,
  descendantsOf,
  inTree,
  kidsOf,
  moveNode,
  newId,
  parentOf,
  placeNode,
  removeNode,
  renameNode,
  setCollapsed,
} from './model.js';

/** `ids` in tree order, without those that sit under another of them. */
function topmost(tree, ids) {
  const chosen = new Set(ids);
  const under = new Set(ids.flatMap((id) => descendantsOf(tree, id)));
  return descendantsOf(tree, ROOT).filter((id) => chosen.has(id) && !under.has(id));
}

/** Shows `id` and its subtree, as arranged in tree `from`, in tree `to` as well. */
function link(library, from, to, id, parent = ROOT) {
  placeNode(library, to, id, parent);
  for (const kid of kidsOf(library.trees[from], id)) link(library, from, to, kid, id);
}

/** Forgets nodes that no tree holds. */
function prune(library) {
  const held = new Set(Object.values(library.trees).flatMap((tree) => Object.values(tree.children).flat()));
  for (const id in library.nodes) if (!held.has(id)) delete library.nodes[id];
}

export const ops = {
  /** Moves nodes (with subtrees) within `tree`; coming from another tree, they are shown here too. */
  move(library, { tree, from = tree, ids, target, position }) {
    ids = topmost(library.trees[from], ids);
    if (from !== tree) for (const id of ids) link(library, from, tree, id);
    // Placing one by one right after the target would reverse them.
    for (const id of position === 'after' || position === 'first' ? ids.toReversed() : ids) {
      moveNode(library, tree, id, target, position);
    }
  },
  link(library, { from, tree, ids }) {
    for (const id of topmost(library.trees[from], ids)) link(library, from, tree, id);
  },
  indent(library, { tree, ids }) {
    const t = library.trees[tree];
    for (const id of topmost(t, ids)) {
      const siblings = kidsOf(t, parentOf(t, id));
      const previous = siblings[siblings.indexOf(id) - 1];
      if (previous) moveNode(library, tree, id, previous, 'inside');
    }
  },
  outdent(library, { tree, ids }) {
    const t = library.trees[tree];
    for (const id of topmost(t, ids).toReversed()) {
      const parent = parentOf(t, id);
      if (parent !== ROOT) moveNode(library, tree, id, parent, 'after');
    }
  },
  /** Takes nodes out of this tree only. */
  remove(library, { tree, ids }) {
    for (const id of ids) removeNode(library, tree, id);
  },
  /** Takes nodes out of every tree. */
  delete(library, { ids }) {
    for (const id of ids) for (const tree in library.trees) removeNode(library, tree, id);
  },
  duplicate(library, { tree, ids }) {
    for (const id of ids) {
      if (!library.nodes[id] || !inTree(library.trees[tree], id)) continue;
      const copy = addNode(library, tree, { ...structuredClone(library.nodes[id]), id: newId() });
      moveNode(library, tree, copy.id, id, 'after');
    }
  },
  collapse(library, { tree, id, collapsed }) {
    setCollapsed(library, tree, id, collapsed);
  },
  rename(library, { id, name }) {
    renameNode(library, id, name);
  },
  icon(library, { ids, icon }) {
    for (const id of ids) {
      if (!library.nodes[id]) continue;
      if (icon) library.nodes[id].icon = icon;
      else delete library.nodes[id].icon;
    }
  },
  /** Pins a page to the address it shows now, or lets it go. */
  pin(library, { ids, pinned }) {
    for (const id of ids) {
      const node = library.nodes[id];
      if (!node || node.note !== undefined) continue;
      if (pinned) node.home = { url: node.url, title: node.title };
      else delete node.home;
    }
  },
  'note-add'(library, { tree, id, target, position }) {
    addNode(library, tree, { id, note: '' });
    if (target) moveNode(library, tree, id, target, position);
  },
  'note-text'(library, { id, text }) {
    if (library.nodes[id]?.note !== undefined) library.nodes[id].note = text;
  },
  'tree-add'(library, { id, name }) {
    library.trees[id] = { id, name, children: {}, collapsed: {} };
  },
  'tree-rename'(library, { tree, name }) {
    if (name?.trim()) library.trees[tree].name = name.trim();
  },
  'tree-remove'(library, { tree }) {
    if (Object.keys(library.trees).length < 2) return;
    delete library.trees[tree];
    prune(library);
  },
  /** Adds an exported tree ({ nodes, tree }) as a new tree. Nodes we already have stay as they are. */
  import(library, { id, data }) {
    for (const node of Object.values(data.nodes)) library.nodes[node.id] ??= node;
    library.trees[id] = { ...data.tree, id };
    prune(library);
  },
};

/** These are not worth a step of undo. */
export const QUIET = new Set(['collapse', 'note-text']);

/** One tree with the nodes it holds, as a file to keep or carry elsewhere. */
export function exportTree(library, treeId) {
  const tree = library.trees[treeId];
  const nodes = Object.fromEntries(descendantsOf(tree, ROOT).map((id) => [id, library.nodes[id]]));
  return { nodes, tree };
}
