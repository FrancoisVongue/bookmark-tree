// The library: pages the user keeps, arranged in trees. Pure data, no Chrome.
//
//   library.nodes  { [nodeId]: { id, url, title, added?, touched?, name?, icon?, keep?, home?, pinned?, note? } }
//                  a page; `added` is when it came into the library,
//                  `touched` the day its tab was last opened or closed, `name`
//                  the user's own title, `icon` an emoji; `keep` says it stays
//                  in sight when the branch it is in is folded. `home`
//                  { url, title } is the address the page first had, kept
//                  once it leaves it: the way back. A `pinned` page goes back
//                  there by itself when its tab closes. A node with `note`
//                  (markdown text) is a note, not a page.
//   library.trees  { [treeId]: { id, name, icon?, children, collapsed } }  where it sits
//   library.grid   { columns, rows, cells: [treeId | null] }  where each tree
//                  sits in the table of trees at the top of the panel
//   library.plan   [nodeId]  what the user means to open next, in order
//   library.trash  [{ node, at }]  nodes the user deleted, newest last; they
//                  are in no tree and can be put back for a while
//   library.gone   { [nodeId]: day }  what was deleted, and the day it was: so
//                  that other computers can be told (see channel.js). It is
//                  not the trash: emptying the trash leaves it as it is.
//   library.version  the shape all this is in: see migrate
//
// A tree stores structure only: `children` maps a parent id (or ROOT) to the
// ordered ids of its children, `collapsed` marks folded nodes. Content lives
// in `nodes`, so one node can sit in several trees. Everything is plain JSON:
// it is saved and backed up as it is, and merged with other copies of itself
// (merge.js) however they reach this computer.
//
// Functions change the library they are given and return what they found.

const VERSION = 2; // Of the shape of a library: see migrate.
export const ROOT = 'root';
export const MAIN = 'main';

/** A tree with nothing in it. */
export const newTree = (id, name) => ({ id, name, children: {}, collapsed: {} });

export function createLibrary() {
  return { version: VERSION, nodes: {}, trees: { [MAIN]: newTree(MAIN, 'Main') }, trash: [], gone: {} };
}

/** A new id: 12 letters, 72 random bits. Short, because ids are most of what does not squeeze. */
export const newId = () => lettersOf(crypto.getRandomValues(new Uint8Array(9)));

/** Bytes as letters that are safe anywhere a name goes: four letters for every three bytes. */
export const lettersOf = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');

export const DAY = 24 * 3600 * 1000;
/** The day (counted from 1970) a node was last used: its tab opened or closed, or else the node added. */
export const freshOf = (node) => node.touched ?? Math.floor((node.added ?? 0) / DAY);

/** `node`, marked as added to the library at time `at` (left as it is when the time is not known). */
export const stamped = (node, at) => (at === undefined ? node : { ...node, added: at });

/** Makes the address a page is at its home: where it belongs. */
export function homeHere(node) {
  node.home = { url: node.url, title: node.title };
}

/** Takes a sleeping page back to its home. */
export function goHome(node) {
  if (node.home) Object.assign(node, node.home);
}

/** What a node is. A note without text is a group: a heading for the nodes under it. */
export const isNote = (node) => node.note !== undefined;
export const isGroup = (node) => isNote(node) && !node.note.trim();

/**
 * What is wrong with a library, in words; nothing, if it is sound. Every node
 * a tree lists must exist and be listed once, within reach of the top, and
 * every node must be in some tree. A library with problems is never saved,
 * taken from elsewhere or merged in: better to stop than to lose pages.
 */
export function problems(library) {
  if (!library?.nodes || !library.trees || !Object.keys(library.trees).length) return ['this is not a library'];
  const found = [];
  const held = new Set();
  for (const tree of Object.values(library.trees)) {
    const seen = new Set();
    const walk = (id) => {
      for (const kid of kidsOf(tree, id)) {
        if (seen.has(kid)) found.push(`${kid} is twice in tree ${tree.id}`);
        else if (!library.nodes[kid]) found.push(`${kid} in tree ${tree.id} is not a node`);
        else (seen.add(kid), held.add(kid), walk(kid));
      }
    };
    walk(ROOT);
    if (Object.values(tree.children).flat().length !== seen.size) found.push(`tree ${tree.id} lists nodes out of reach`);
  }
  for (const id in library.nodes) if (!held.has(id)) found.push(`${id} is in no tree`);
  return found;
}

/**
 * The plan: the nodes to open next, in order. Whatever is stored, each comes
 * out once, and only those that are still nodes.
 */
export const planOf = (library) => [...new Set(library.plan ?? [])].filter((id) => library.nodes[id]);

/** Leaves `ids` in the plan: what is kept of it is what the plan is (no plan, when nothing is). */
export function setPlan(library, ids) {
  if (ids.length) library.plan = ids;
  else delete library.plan;
}

/**
 * Puts pages into the plan, before its entry `before` or (without one) at
 * its end. Those already in it move there. A group has no page to open.
 */
export function planNodes(library, ids, before) {
  const added = ids.filter((id) => library.nodes[id] && !isGroup(library.nodes[id]));
  const rest = planOf(library).filter((id) => !added.includes(id));
  const at = rest.indexOf(before);
  rest.splice(at === -1 ? rest.length : at, 0, ...added);
  setPlan(library, rest);
}

/** Takes nodes out of the plan. */
export function unplanNodes(library, ids) {
  if (library.plan) setPlan(library, planOf(library).filter((id) => !ids.includes(id)));
}

/**
 * The table of trees: { columns, rows, cells }, where `cells` holds a tree id
 * or null for each cell, row by row. Whatever is stored, every tree comes out
 * in exactly one cell: a tree without a place takes the first free one.
 */
export function gridOf(library) {
  const columns = library.grid?.columns ?? 4;
  const stored = library.grid?.cells ?? [];
  const cells = stored.map((id, at) => (library.trees[id] && stored.indexOf(id) === at ? id : null));
  for (const id in library.trees) {
    if (cells.includes(id)) continue;
    const free = cells.indexOf(null);
    if (free === -1) cells.push(id);
    else cells[free] = id;
  }
  const used = cells.findLastIndex(Boolean) + 1;
  const rows = Math.max(library.grid?.rows ?? 1, Math.ceil(used / columns));
  return { columns, rows, cells: Array.from({ length: rows * columns }, (_, at) => cells[at] ?? null) };
}

/** Brings a library saved by an older version to today's shape. The one place that knows old shapes. */
export function migrate(library) {
  library.trash ??= [];
  // Before deletions were kept apart, the trash was all that told of them.
  library.gone ??= Object.fromEntries(library.trash.map((entry) => [entry.node.id, Math.floor(entry.at / DAY)]));
  // Before every page had a home, having one meant being pinned to it.
  if (!library.version) for (const node of Object.values(library.nodes)) if (node.home) node.pinned = true;
  library.version = VERSION;
  return library;
}

/** The children of `id` (or of ROOT), in order. */
export const kidsOf = (tree, id) => tree.children[id] ?? [];

/** The parent of `id` (ROOT for a top-level node), or undefined if it isn't in the tree. */
export function parentOf(tree, id) {
  for (const parent in tree.children) if (tree.children[parent].includes(id)) return parent;
  return undefined;
}

export const inTree = (tree, id) => parentOf(tree, id) !== undefined;

/** `id`'s descendants, depth first. */
export function descendantsOf(tree, id) {
  const out = [];
  for (const kid of kidsOf(tree, id)) out.push(kid, ...descendantsOf(tree, kid));
  return out;
}

function insert(tree, parent, index, ids) {
  const list = (tree.children[parent] ??= []);
  list.splice(index ?? list.length, 0, ...ids);
}

function detach(tree, id) {
  const parent = parentOf(tree, id);
  const list = tree.children[parent];
  const index = list.indexOf(id);
  list.splice(index, 1);
  if (!list.length) delete tree.children[parent];
  return { parent, index };
}

/** Puts a node the library already has into a tree, as the last child of `parent`. */
export function placeNode(library, treeId, id, parent = ROOT) {
  const tree = library.trees[treeId];
  if (inTree(tree, id)) return;
  insert(tree, parent !== ROOT && !inTree(tree, parent) ? ROOT : parent, null, [id]);
}

/** Adds a new node to the library, as the last child of `parent` in the tree. */
export function addNode(library, treeId, node, parent = ROOT) {
  library.nodes[node.id] = node;
  placeNode(library, treeId, node.id, parent);
  return node;
}

/** The tree a node is shown in: `preferred` if it holds the node, else the first that does. */
export function treeFor(library, id, preferred) {
  if (library.trees[preferred] && inTree(library.trees[preferred], id)) return preferred;
  return Object.keys(library.trees).find((treeId) => inTree(library.trees[treeId], id));
}

/** The given tree's id if it exists, else the first tree's. */
export const validTree = (library, treeId) => (library.trees[treeId] ? treeId : Object.keys(library.trees)[0]);

/**
 * Moves `id`, with its subtree, relative to `target`:
 *   before / after  sibling of the target
 *   inside / first  last / first child of the target
 *   end             last top-level node (target is ignored)
 * False when the move is impossible (into itself or its own subtree).
 */
export function moveNode(library, treeId, id, target, position) {
  const tree = library.trees[treeId];
  if (!inTree(tree, id)) return false;
  if (position !== 'end') {
    if (!inTree(tree, target) || target === id || descendantsOf(tree, id).includes(target)) return false;
  }
  detach(tree, id);
  if (position === 'inside') insert(tree, target, null, [id]);
  else if (position === 'first') insert(tree, target, 0, [id]);
  else if (position === 'end') insert(tree, ROOT, null, [id]);
  else {
    const parent = parentOf(tree, target);
    insert(tree, parent, tree.children[parent].indexOf(target) + (position === 'after' ? 1 : 0), [id]);
  }
  return true;
}

/**
 * Forgets nodes that no tree holds. Given the time `at`, the user deleted
 * them: they go to the trash, stamped with it, and are noted as gone.
 * Without it they leave no trace (an empty tab, a node no tree ever held).
 */
export function forgetLoose(library, at) {
  const held = new Set(Object.values(library.trees).flatMap((tree) => Object.values(tree.children).flat()));
  for (const id in library.nodes) {
    if (held.has(id)) continue;
    if (at !== undefined) {
      library.trash.push({ node: library.nodes[id], at });
      (library.gone ??= {})[id] = Math.floor(at / DAY);
    }
    delete library.nodes[id];
  }
}

/** The ids of what was deleted and has not come back, in order. */
export const goneOf = (library) => Object.keys(library.gone ?? {}).filter((id) => !library.nodes[id]).sort();

const KEPT_DAYS = 30;
/**
 * Lets go of what is too old to matter, at time `at`: what has been in the
 * trash for a month, and the notes of deletions a month old (every computer
 * that was to hear of them has, or has been away too long to be believed).
 */
export function expire(library, at) {
  library.trash = library.trash.filter((entry) => entry.at > at - KEPT_DAYS * DAY);
  library.gone = Object.fromEntries(goneOf(library).filter((id) => library.gone[id] > Math.floor(at / DAY) - KEPT_DAYS).map((id) => [id, library.gone[id]]));
}

/**
 * Takes `id` out of the tree; its children move up into its place. Once no
 * tree holds the node it goes to the trash, stamped `at` (or, without a
 * time, is gone for good).
 */
export function removeNode(library, treeId, id, at) {
  const tree = library.trees[treeId];
  if (!inTree(tree, id)) return false;
  const kids = kidsOf(tree, id);
  const { parent, index } = detach(tree, id);
  if (kids.length) insert(tree, parent, index, kids);
  delete tree.children[id];
  delete tree.collapsed[id];
  if (!Object.values(library.trees).some((t) => inTree(t, id))) forgetLoose(library, at);
  return true;
}

/**
 * Deletes a tree, at time `at`; the nodes no other tree holds go to the
 * trash. The last tree stays: there is always one. Says whether it did.
 */
export function removeTree(library, treeId, at) {
  if (!library.trees[treeId] || Object.keys(library.trees).length < 2) return false;
  delete library.trees[treeId];
  forgetLoose(library, at);
  return true;
}

export function setCollapsed(library, treeId, id, collapsed) {
  const tree = library.trees[treeId];
  if (collapsed) tree.collapsed[id] = true;
  else delete tree.collapsed[id];
}

/** Gives a node the user's own name; an empty name goes back to the page title. */
export function renameNode(library, id, name) {
  const node = library.nodes[id];
  if (!node) return;
  if (name?.trim()) node.name = name.trim();
  else delete node.name;
}

/**
 * The rows a tree shows, top to bottom: { id, depth, kids, collapsed, hidden, kept }.
 *
 * A collapsed row hides the nodes under it - except those kept in sight:
 * the ones with an open tab (`live`, a Set of ids) and the ones the user
 * marked (`node.keep`). These stay as rows right under the collapsed one,
 * one step deeper, in the order of the tree, however deep they really are
 * (`kept` marks such a row). `hidden` is how many nodes the row really hides.
 * With `open`, nothing is treated as collapsed.
 */
export function rowsOf(library, treeId, open = false, live = new Set()) {
  const tree = library.trees[treeId];
  const rows = [];
  const walk = (id, depth) => {
    const kids = kidsOf(tree, id).length;
    const row = { id, depth, kids, collapsed: !open && kids > 0 && !!tree.collapsed[id], hidden: 0 };
    rows.push(row);
    if (!row.collapsed) return kidsOf(tree, id).forEach((kid) => walk(kid, depth + 1));
    for (const under of descendantsOf(tree, id)) {
      if (live.has(under) || library.nodes[under]?.keep) rows.push({ id: under, depth: depth + 1, kids: 0, collapsed: false, hidden: 0, kept: true });
      else row.hidden++;
    }
  };
  for (const id of kidsOf(tree, ROOT)) walk(id, 0);
  return rows;
}
