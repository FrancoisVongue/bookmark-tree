// The quick way between the user's computers: each one tells the others what
// it changed, through the small storage the browser itself keeps in sync.
// As simple as it can be made:
//
// - A device writes only cells of its own, `<device>.<n>`, numbered from 1,
//   each holding one diff (see merge.js). Nobody else writes them, so
//   nothing is ever overwritten.
// - A device remembers, for every other device, the number of the last cell
//   it took in. It takes the next ones in order.
// - Cells are few and small. A device drops its oldest; a change too big for
//   a cell is not sent, and its cell says so. Whoever finds a number missing,
//   or such a cell, is "out of step" and needs the full library from
//   elsewhere (GitHub). Nothing here tries to recover: it only tells.
//
//   state (kept on this device): { device, seq, published, cursors, lost }
//     published   the library as the others know it from me (JSON)
//     cursors     { [device]: last cell taken in }
//   store: { get() -> all cells, set(cells), remove(keys) }   (chrome.storage.sync)

import { createLibrary } from './model.js';
import { apply, diff, isEmpty } from './merge.js';

const CELL_BYTES = 7500; // The browser allows 8192 per cell, name included.
const CELLS_KEPT = 30; // Per device; the browser allows about 100 KB in all.

// Every device starts from the same empty library, so that is what the others know of a new one.
export const newState = (device) => ({ device, seq: 0, published: JSON.stringify(createLibrary()), cursors: {}, lost: false });

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Tells the others what changed here since the last time. Returns false if it could not be told in full. */
export async function publish(store, state, library, at) {
  const d = diff(JSON.parse(state.published), library);
  if (isEmpty(d)) return true;
  const fits = bytes({ at, d }) <= CELL_BYTES;
  state.seq++;
  state.published = JSON.stringify(library);
  const stale = Array.from({ length: CELLS_KEPT }, (_, i) => `${state.device}.${state.seq - CELLS_KEPT - i}`);
  await store.remove(stale);
  await store.set({ [`${state.device}.${state.seq}`]: fits ? { at, d } : { at, lost: true } });
  return fits;
}

/**
 * Takes in what the others changed. Changes `library`; returns whether this
 * device is out of step. `known(library)` is the part of it the others are told about.
 */
export async function receive(store, state, library, at, known = (all) => all) {
  const cells = await store.get();
  const last = {}; // Device -> its highest cell number.
  for (const key in cells) {
    const [device, n] = key.split('.');
    if (device !== state.device) last[device] = Math.max(last[device] ?? 0, Number(n));
  }
  let lost = false;
  for (const device in last) {
    for (let n = (state.cursors[device] ?? 0) + 1; n <= last[device]; n++) {
      const cell = cells[`${device}.${n}`];
      if (cell?.d) apply(library, cell.d, at);
      else lost = true; // Dropped before we saw it, or too big to send.
    }
    state.cursors[device] = last[device];
  }
  // What came from the others is not news from me.
  state.published = JSON.stringify(known(library));
  return lost;
}
