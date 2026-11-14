// How wide a table's columns are, and how the note's markdown keeps it: in
// the row of dashes under the heading, as the number of dashes -
// "| --- | ------ |" says the second column is twice the first. Any markdown
// reader takes that row as it is, so the widths can break no note. Equal
// dashes say nothing was set: the columns share the width equally.
//
// Widths are shares, not sizes: whole numbers from 1 to 100 that mean
// something only against each other. (This file knows nothing of the editor:
// it is tested on its own.)

const MOST = 100; // The most dashes written for a column, and so the widest a column is against the narrowest.
const PLAIN = 3; // The dashes of a column whose width was not set.

/** `widths` as they are kept for a table of `count` columns: whole shares within bounds - or null, when they say nothing (none, not one per column, not numbers, all equal). */
export function settled(widths, count) {
  if (!Array.isArray(widths) || widths.length !== count || !widths.every((one) => one > 0 && Number.isFinite(one))) return null;
  const shares = widths.map((one) => Math.min(MOST, Math.max(1, Math.round(one))));
  return shares.every((one) => one === shares[0]) ? null : shares;
}

/** The row of dashes for columns set to `aligns` ('left', 'center', 'right' or none), as its cells: the dashes are the `widths`, the colons the sides. */
export function delimiter(widths, aligns) {
  const shares = settled(widths, aligns.length);
  return aligns.map((align, i) => {
    const dashes = '-'.repeat(shares ? shares[i] : PLAIN);
    return `${align === 'left' || align === 'center' ? ':' : ''}${dashes}${align === 'right' || align === 'center' ? ':' : ''}`;
  });
}

/** The widths a row of dashes says - `line` as it stands in the note, set in or quoted as it may be - or null if it says none, or is no such row. */
export function widthsOf(line) {
  const cells = line.replace(/^[\s>]*/, '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  if (!cells.every((cell) => /^:?-+:?$/.test(cell))) return null;
  return settled(cells.map((cell) => cell.replace(/:/g, '').length), cells.length);
}

/** What part of the table each of `count` columns takes, in percent. */
export function percents(widths, count) {
  const shares = settled(widths, count) ?? Array(count).fill(1);
  const sum = shares.reduce((a, b) => a + b, 0);
  return shares.map((one) => (one / sum) * 100);
}

/** The widths to keep for columns that take `parts` percent of the table each: a column is never written with fewer dashes than a plain one. */
export const fromPercents = (parts) => settled(parts.map((one) => Math.max(PLAIN, one)), parts.length);

/** `list` with the thing at `from` moved to stand at `to`. */
export function moved(list, from, to) {
  const all = [...list];
  all.splice(to, 0, ...all.splice(from, 1));
  return all;
}
