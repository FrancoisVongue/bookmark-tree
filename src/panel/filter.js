// What a filter lets through. A filter narrows what a pane shows of its
// tree: { branch?, open?, week?, sound?, kept? } - a node to show alone with
// all under it, and conditions that hold together. Pure: no screen here.

import { freshOf } from '../model.js';

/** The conditions, in the order they are offered. */
export const CONDITIONS = ['open', 'week', 'sound', 'kept'];
export const narrows = (filter) => CONDITIONS.some((name) => filter[name]);

/**
 * Whether a node answers every condition of `filter` that is on. `facts`:
 * { live, audible } - the ids of nodes with an open tab and of those making
 * sound - and `day`, today counted from 1970.
 */
export function passes(node, filter, { live, audible, day }) {
  if (filter.open && !live.has(node.id)) return false;
  if (filter.week && day - freshOf(node) >= 7) return false;
  if (filter.sound && !audible.has(node.id)) return false;
  if (filter.kept && !(node.pinned || node.keep)) return false;
  return true;
}

/**
 * The rows of one branch: row `id` and all under it, the branch's own row
 * at depth 0 - nothing of what is above it, so the room that took is given
 * back. Nothing, if the row is not among `rows`.
 */
export function branchOf(rows, id) {
  const at = rows.findIndex((row) => row.id === id);
  if (at === -1) return undefined;
  const top = rows[at].depth;
  let end = at + 1;
  while (end < rows.length && rows[end].depth > top) end++;
  return rows.slice(at, end).map((row) => ({ ...row, depth: row.depth - top }));
}

/**
 * Of `rows`, those that are `wanted` (a Set of ids) and the rows above them
 * that lead there; these come out marked `lead`, to be shown quieter.
 */
export function withLeads(rows, wanted) {
  const out = [];
  let need = 0; // Walking up: a row shallower than the last one kept leads to it.
  for (const row of rows.toReversed()) {
    const hit = wanted.has(row.id);
    if (!hit && row.depth >= need) continue;
    out.unshift(hit ? row : { ...row, lead: true });
    need = row.depth;
  }
  return out;
}
