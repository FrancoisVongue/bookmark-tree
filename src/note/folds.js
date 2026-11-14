// A foldable block, as a note's markdown has it:
//
//     +++open Title
//     whatever the block holds
//     +++
//
// ("+++folded Title" when it is folded.) It is written and found line by
// line, by rules of its own, so that nothing a block holds can break the
// note:
// - a block is one only when its closing line is there. An opening line with
//   no closing line is a line of text, and what follows it is read as usual;
// - the closing line has exactly as many pluses as the opening one, and the
//   block is written with more of them than any line it holds starts with -
//   so no line inside, a block within it included, can be taken for its end;
// - the lines of fenced code are not looked at;
// - only a line that starts at the block's own indent counts: what is set in
//   (an item of a list, code) is the business of what holds it.
//
// Nothing here knows of the editor: `block` reads lines, `write` gives text.

const OPENING = /^(\+{3,})(open|folded)(?: +(.*))?$/;
const CODE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Where the fenced code that opens at line `from` ends (its last line - the last one before `to`, if it is never closed); nothing, if no code opens there. */
function codeEnd(line, from, to) {
  const [, marks, rest] = CODE.exec(line(from) ?? '') ?? [];
  if (!marks || (marks[0] === '`' && rest.includes('`'))) return undefined;
  for (let i = from + 1; i < to; i++) {
    const text = line(i)?.trim();
    if (text === undefined) return i - 1;
    if (text.length >= marks.length && text === marks[0].repeat(text.length)) return i;
  }
  return to - 1;
}

/**
 * The foldable block that opens at line `from`, if a whole one does:
 * { open, title, end } - `end` is its closing line, and its body the lines
 * between. `line(i)` gives line i of the text, or nothing where the text
 * that could hold the block is over; `to` is one past its last line.
 */
export function block(line, from, to) {
  const [, marks, state, title = ''] = OPENING.exec(line(from)?.trimEnd() ?? '') ?? [];
  if (!marks) return undefined;
  let depth = 0; // Blocks with as many pluses, opened inside and not closed yet.
  for (let i = from + 1; i < to; i++) {
    const text = line(i)?.trimEnd();
    if (text === undefined) return undefined;
    const code = codeEnd(line, i, to);
    if (code !== undefined) i = code;
    else if (text === marks && !depth) return { open: state === 'open', title: title.trim(), end: i };
    else if (text === marks) depth--;
    else if (OPENING.exec(text)?.[1] === marks) depth++;
  }
  return undefined;
}

/** A foldable block as text. `title` is one line, `body` is the markdown of what the block holds. */
export function write({ open, title, body }) {
  const longest = Math.max(2, ...[...body.matchAll(/^\+{3,}/gm)].map(([run]) => run.length));
  const marks = '+'.repeat(longest + 1);
  return `${marks}${open ? 'open' : 'folded'}${title ? ` ${title}` : ''}\n${body}${body ? '\n' : ''}${marks}`;
}

/** A line of text that starts with what could open or close a block must be written so that it does not: with this before it. */
export const literal = (text) => (/^\+{3}/.test(text) ? '\\' : '');
