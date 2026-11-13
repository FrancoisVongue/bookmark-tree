// Everything the user can do to the library, by name. The one owner of the
// state (the worker) applies them; nobody else changes the library by hand,
// except to follow what tabs do (core.js).
//
// An operation is a function (library, args, at) of nothing else. What it
// cannot work out from those - the ids of new nodes, the time - comes in
// `args` and `at`: so it can be tried with plain values, and gives the same
// result every time it is.
//
// An operation may return what the browser should do next:
//   { keepTabs: true }  tabs whose nodes are gone stay open, as new nodes
//   { navigate: id }    the node's tab, if any, goes to the node's address
// Pure: no Chrome here.

import {
  ROOT,
  addNode,
  descendantsOf,
  forgetLoose,
  gridOf,
  isNote,
  kidsOf,
  moveNode,
  parentOf,
  placeNode,
  planNodes,
  removeNode,
  renameNode,
  setCollapsed,
  stamped,
  unplanNodes,
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

/**
 * A copy of `id` and its subtree, made at time `at`, as the last child of
 * `parent`. `as` names the copies: { [id]: the id of its copy }; a node it
 * does not name is left out, with what is under it.
 */
function copy(library, tree, id, parent, as, at) {
  if (!as[id]) return undefined;
  const node = addNode(library, tree, stamped({ ...structuredClone(library.nodes[id]), id: as[id] }, at), parent);
  for (const kid of kidsOf(library.trees[tree], id)) copy(library, tree, kid, node.id, as, at);
  return node.id;
}

/** `name`, or `name 2`, `name 3`... if a tree is already called that. */
function freeName(library, name) {
  const taken = new Set(Object.values(library.trees).map((tree) => tree.name));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const ops = {
  /**
   * Moves nodes (with subtrees) within `tree`. Coming from another tree, they
   * are shown here too; with `take`, they leave the tree they came from.
   */
  move(library, { tree, from = tree, ids, target, position, take }, at) {
    const source = library.trees[from];
    ids = topmost(source, ids);
    const taken = take && from !== tree ? ids.flatMap((id) => [id, ...descendantsOf(source, id)]) : [];
    if (from !== tree) for (const id of ids) link(library, from, tree, id);
    // Placing one by one right after the target would reverse them.
    for (const id of position === 'after' || position === 'first' ? ids.toReversed() : ids) {
      moveNode(library, tree, id, target, position);
    }
    for (const id of taken) removeNode(library, from, id, at);
  },
  /** New sleeping pages ({ id, url, title }), e.g. links pasted or dropped in. */
  add(library, { tree, nodes, target, position }, at) {
    for (const node of nodes) addNode(library, tree, stamped(node, at));
    if (position) ops.move(library, { tree, ids: nodes.map((node) => node.id), target, position });
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
  remove(library, { tree, ids }, at) {
    for (const id of ids) removeNode(library, tree, id, at);
  },
  /** Takes nodes out of every tree. */
  delete(library, { ids }, at) {
    for (const id of ids) for (const tree in library.trees) removeNode(library, tree, id, at);
  },
  /** Copies nodes, with their subtrees, each copy right after what it copies. `as` gives the copies their ids (see `copy`). */
  duplicate(library, { tree, ids, as }, at) {
    for (const id of topmost(library.trees[tree], ids)) {
      const made = copy(library, tree, id, undefined, as, at);
      if (made) moveNode(library, tree, made, id, 'after');
    }
  },
  collapse(library, { tree, id, collapsed }) {
    setCollapsed(library, tree, id, collapsed);
  },
  'collapse-all'(library, { tree, collapsed }) {
    const t = library.trees[tree];
    t.collapsed = collapsed ? Object.fromEntries(Object.keys(t.children).filter((id) => id !== ROOT).map((id) => [id, true])) : {};
  },
  /** A sleeping page's address, typed by hand. */
  address(library, { id, url }) {
    const node = library.nodes[id];
    if (!node || isNote(node) || !url?.trim()) return;
    node.url = url.trim();
    if (node.home) node.home = { url: node.url, title: node.title };
    return { navigate: id };
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
  /** Keeps nodes in sight when the branch they are in is folded, or lets them be hidden with it. */
  keep(library, { ids, keep }) {
    for (const id of ids) {
      if (!library.nodes[id]) continue;
      if (keep) library.nodes[id].keep = true;
      else delete library.nodes[id].keep;
    }
  },
  /** Pins a page to the address it shows now, or lets it go. */
  pin(library, { ids, pinned }) {
    for (const id of ids) {
      const node = library.nodes[id];
      if (!node || isNote(node)) continue;
      if (pinned) node.home = { url: node.url, title: node.title };
      else delete node.home;
    }
  },
  /** A note; with a `name` and no text it serves as a group heading. */
  'note-add'(library, { tree, id, name, target, position }, at) {
    addNode(library, tree, stamped(name ? { id, note: '', name } : { id, note: '' }, at));
    if (target) moveNode(library, tree, id, target, position);
  },
  'note-text'(library, { id, text }) {
    if (library.nodes[id] && isNote(library.nodes[id])) library.nodes[id].note = text;
  },
  /** Puts pages into the plan of what to open next: at its end, or before its entry `before`. */
  plan(library, { ids, before }) {
    planNodes(library, ids, before);
  },
  unplan(library, { ids }) {
    unplanNodes(library, ids);
  },
  /** A new tree; in cell `cell` of the table of trees, or the first free one. */
  'tree-add'(library, { id, name, cell }) {
    library.trees[id] = { id, name, children: {}, collapsed: {} };
    if (cell !== undefined) ops['grid-move'](library, { tree: id, cell });
  },
  /** Moves a tree to a cell of the table; a tree already there takes the place left. */
  'grid-move'(library, { tree, cell }) {
    const grid = gridOf(library);
    const from = grid.cells.indexOf(tree);
    if (from === -1 || cell < 0 || cell >= grid.cells.length) return;
    [grid.cells[from], grid.cells[cell]] = [grid.cells[cell], tree];
    library.grid = grid;
  },
  /** Gives the table of trees another size. Trees keep their row and column where those still exist. */
  'grid-size'(library, { columns, rows }) {
    const old = gridOf(library);
    const cells = Array(columns * rows).fill(null);
    old.cells.forEach((id, at) => {
      const [row, column] = [Math.floor(at / old.columns), at % old.columns];
      if (id && row < rows && column < columns) cells[row * columns + column] = id;
    });
    library.grid = { columns, rows, cells };
    library.grid = gridOf(library); // Those left without a cell take free ones.
  },
  'tree-rename'(library, { tree, name }) {
    if (name?.trim()) library.trees[tree].name = name.trim();
  },
  'tree-icon'(library, { tree, icon }) {
    if (icon) library.trees[tree].icon = icon;
    else delete library.trees[tree].icon;
  },
  'tree-remove'(library, { tree }, at) {
    if (Object.keys(library.trees).length < 2) return;
    delete library.trees[tree];
    forgetLoose(library, at);
    return { keepTabs: true };
  },
  /** Puts deleted nodes back, at the end of `tree`. */
  restore(library, { tree, ids }) {
    const back = new Set(ids);
    for (const { node } of library.trash.filter((entry) => back.has(entry.node.id))) {
      addNode(library, tree, node);
      delete library.gone?.[node.id];
    }
    library.trash = library.trash.filter((entry) => !back.has(entry.node.id));
  },
  /** Empties the trash. That these nodes were deleted stays known (library.gone). */
  'trash-empty'(library) {
    library.trash = [];
  },
  /** Adds an exported tree ({ nodes, tree }) as a new tree. Nodes we already have stay as they are. */
  import(library, { id, data }) {
    for (const node of Object.values(data.nodes)) library.nodes[node.id] ??= node;
    library.trees[id] = { ...data.tree, id, name: freeName(library, data.tree.name) };
    forgetLoose(library);
  },
};

/** These are not worth a step of undo. */
export const QUIET = new Set(['collapse', 'collapse-all', 'note-text']);

/** One tree with the nodes it holds, as a file to keep or carry elsewhere. */
export function exportTree(library, treeId) {
  const tree = library.trees[treeId];
  const nodes = Object.fromEntries(descendantsOf(tree, ROOT).map((id) => [id, library.nodes[id]]));
  return { nodes, tree };
}
