// Finding things by what the user typed. A query is words; a text answers it
// when it answers every word. There are three ways to answer a word, each
// looser than the one before, and the looser ones are tried only when the
// stricter find nothing at all:
//
//   exact    the word is in the text, anywhere
//   layout   ...or it is, once retyped on the other keyboard layout
//            ("пшерги" was meant to be "github", "ghbdtn" - "привет")
//   near     ...or a word of the text is a typo or two away from it, or
//            begins that way (the user may still be typing)
//
// Pure: no Chrome here.

const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю.';
// Key for key. Where both layouts have the character, the Latin key's meaning wins.
const OTHER = new Map([...[...RU].map((char, at) => [char, EN[at]]), ...[...EN].map((char, at) => [char, RU[at]])]);

/** `text` as it would have come out on the other keyboard layout. */
export const retyped = (text) => Array.from(text, (char) => OTHER.get(char) ?? char).join('');

/** How many typos a word of this length may hold: short words none, or everything is like everything. */
const slack = (word) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/**
 * Whether `word` is at most `most` typos away from `other` or from a
 * beginning of it. A typo is a letter missing, extra or wrong, or two
 * neighbours swapped.
 */
export function near(word, other, most) {
  if (other.length < word.length - most) return false;
  const width = Math.min(other.length, word.length + most);
  // The classic table, three rows at a time: row[j] is how far word's first i letters are from other's first j.
  let [before, row, next] = width < ROWS[0].length ? ROWS : ROWS.map(() => new Uint16Array(width + 1));
  for (let j = 0; j <= width; j++) row[j] = j;
  for (let i = 1; i <= word.length; i++) {
    let best = (next[0] = i);
    for (let j = 1; j <= width; j++) {
      let cost = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (word[i - 1] === other[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && word[i - 1] === other[j - 2] && word[i - 2] === other[j - 1]) cost = Math.min(cost, before[j - 2] + 1);
      next[j] = cost;
      if (cost < best) best = cost;
    }
    if (best > most) return false; // It can only get worse from here.
    [before, row, next] = [row, next, before];
  }
  for (let j = 0; j <= width; j++) if (row[j] <= most) return true;
  return false;
}
// Kept between calls: this runs for every word of every text at every keystroke.
const ROWS = [new Uint16Array(64), new Uint16Array(64), new Uint16Array(64)];

const wordsOf = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The ways to answer a word, strictest first; each also accepts what the ones before it do.
// `words()` gives the words of the text, split only when asked for.
const WAYS = [
  ['exact', ({ word }, text) => text.includes(word)],
  ['layout', ({ other }, text) => text.includes(other)],
  ['near', ({ word, slack }, text, words) => slack > 0 && words().some((each) => near(word, each, slack))],
];

/**
 * Of `items`, those whose text (`textOf(item)`) answers the query in the
 * strictest way that finds any: { hits, how }, where `how` is 'exact',
 * 'layout' or 'near'. With 'layout' comes `as`: the query as it was read.
 */
export function find(items, query, textOf) {
  const asked = query.toLowerCase().split(/\s+/).filter(Boolean).map((word) => ({ word, other: retyped(word), slack: slack(word) }));
  const texts = items.map((item) => textOf(item).toLowerCase());
  const split = [];
  for (let way = 0; way < WAYS.length; way++) {
    const answers = (word, at) => {
      for (let each = 0; each <= way; each++) if (WAYS[each][1](word, texts[at], () => (split[at] ??= wordsOf(texts[at])))) return true;
      return false;
    };
    const hits = items.filter((item, at) => asked.every((word) => answers(word, at)));
    if (hits.length) return { hits, how: WAYS[way][0], as: way === 1 ? retyped(query.toLowerCase()) : undefined };
  }
  return { hits: [], how: 'exact' };
}
