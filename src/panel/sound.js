// Sound must be findable. A page that plays shows it on its row; when the
// row is not in sight, the page stands in a small stack at the bottom of the
// panel instead, a click away. Here is which pages those are. Pure: no screen here.

/** How many lines the stack has at the most. */
export const LINES = 5;

/**
 * What the stack holds: of the pages `playing` (ids, in their order), those
 * whose row is not `inSight` (a question about an id) and that the user has
 * not sent away (`hushed`, a Set). { ids, more }: all of them while they fit
 * in the stack's lines; else one line fewer, and how many `more` there are -
 * the last line says that.
 */
export function outOfSight(playing, inSight, hushed, lines = LINES) {
  const all = playing.filter((id) => !hushed.has(id) && !inSight(id));
  const ids = all.length > lines ? all.slice(0, lines - 1) : all;
  return { ids, more: all.length - ids.length };
}
