import test from 'node:test';
import assert from 'node:assert/strict';
import { find, near, retyped } from '../src/find.js';

const PAGES = [
  'GitHub: Where the world builds software https://github.com/',
  'JavaScript reference - MDN https://developer.mozilla.org/docs/Web/JavaScript',
  'Привет, мир - блог https://example.ru/privet',
  'Cat pictures https://cats.example/',
  'Car rental https://cars.example/',
];
const found = (query) => {
  const { hits, how, as } = find(PAGES, query, (page) => page);
  return [how, hits.map((page) => page.split(' ')[0]).join(' '), as].filter(Boolean).join(' | ');
};

test('every word must be in the text, anywhere in it, whatever the case', () => {
  assert.equal(found('git'), 'exact | GitHub:');
  assert.equal(found('MDN script'), 'exact | JavaScript');
  assert.equal(found('script github'), 'exact');
  assert.equal(found('example'), 'exact | Привет, Cat Car');
});

test('typed on the other keyboard layout', () => {
  assert.equal(retyped('пшерги'), 'github');
  assert.equal(retyped('ghbdtn'), 'привет');
  assert.equal(found('пшерги'), 'layout | GitHub: | github');
  assert.equal(found('ghbdtn'), 'layout | Привет, | привет');
  assert.equal(found('ьвт script'), 'layout | JavaScript | mdn ыскшзе'); // One word right, one not.
});

test('a typo or two, counted by the length of the word', () => {
  assert.equal(found('githb'), 'near | GitHub:'); // A letter missing.
  assert.equal(found('gihtub'), 'near | GitHub:'); // Two neighbours swapped.
  assert.equal(found('javscript'), 'near | JavaScript');
  assert.equal(found('jvascrpt'), 'near | JavaScript'); // Two typos, in a long word.
  assert.equal(found('javscr'), 'near | JavaScript'); // Still being typed, and already wrong.
  assert.equal(found('gxthxb'), 'exact'); // Two typos in a short word: nothing.
  assert.equal(found('cot'), 'exact'); // Three letters allow none: or cat is car is cot.
});

test('the looser ways are tried only when the stricter find nothing', () => {
  assert.equal(found('cars'), 'exact | Car'); // Not "cats" as well.
  assert.equal(found('cats'), 'exact | Cat');
  assert.equal(found('carz'), 'near | Car'); // One typo from "cars"; two from "cats".
});

test('how far apart two words are', () => {
  assert.equal(near('github', 'github', 0), true);
  assert.equal(near('git', 'github', 0), true); // A beginning.
  assert.equal(near('hub', 'github', 0), false); // Not an end.
  assert.equal(near('gihtub', 'github', 1), true);
  assert.equal(near('githubbb', 'github', 1), false);
  assert.equal(near('gothic', 'github', 2), false);
});
