// The journal of attention: the nodes the user was at, one after another,
// newest first. Not what was opened - where they looked: the tab in front,
// in the window in front. Each node is there once, at its latest visit.
//
//   state.attention  { node, tree, since }   where the user is now, if at a node
//   state.journal    [{ node, tree, at }]    where they were before, and when they left
//
// A place counts once the user has stayed a moment (`visited`): tabs flicked
// through on the way somewhere leave no trace. A visit is written down when
// it ends - so the journal never holds the place the user is at, only the
// places to go back to. Like the binding of tabs, it is true for this
// browser session only and is kept apart from the library. One thing it
// does to the library: the page the user is at, once that counts, is not in
// the plan of what to open next. Pure: no Chrome here.

import { listDrop, planOf } from './model.js';

export const DWELL = 1500; // Milliseconds at a node before it counts as having been there.
const KEPT = 100;

/**
 * Whether, at time `at`, the user has been where they are long enough for it
 * to count. Then that page is not something to open next: it leaves the
 * plan here, and nowhere else. To be asked whenever it may have become
 * true - the moment has come, the plan was changed - and before the
 * attention moves on.
 */
export function visited(state, at) {
  const here = state.attention;
  if (!here || at - here.since < DWELL) return false;
  listDrop(state.library, 'plan', planOf(state.library), [here.node]);
  return true;
}

/** The user's attention moved, at time `at`, to tab `tabId` (which may show no node, or be no tab at all). */
export function attend(state, tabId, at) {
  const was = state.attention;
  const now = state.binding[tabId];
  if (was?.node === now?.node) return;
  if (visited(state, at)) {
    const others = state.journal.filter((entry) => entry.node !== was.node);
    state.journal = [{ node: was.node, tree: was.tree, at }, ...others].slice(0, KEPT);
  }
  state.attention = now && { node: now.node, tree: now.tree, since: at };
}

/** The places to go back to, newest first: without the one the user is at, and without nodes that are gone. */
export function placesOf(state) {
  return state.journal.filter((entry) => state.library.nodes[entry.node] && entry.node !== state.attention?.node);
}
