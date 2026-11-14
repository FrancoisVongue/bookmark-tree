import test from 'node:test';
import assert from 'node:assert/strict';
import { stackOf } from '../src/panel/sound.js';

const stack = (playing, seen = '', dismissed = '') => stackOf([...playing], (id) => seen.includes(id), new Set(dismissed));

test('a playing page is in the stack while its row is not in sight', () => {
  assert.deepEqual(stack('abc', 'b'), { ids: ['a', 'c'], more: 0 });
  assert.deepEqual(stack('abc', 'abc'), { ids: [], more: 0 });
  assert.deepEqual(stack(''), { ids: [], more: 0 });
});

test('one the user sent away stays away, in sight or not', () => {
  assert.deepEqual(stack('abc', '', 'a'), { ids: ['b', 'c'], more: 0 });
  assert.deepEqual(stack('abc', 'b', 'ac'), { ids: [], more: 0 });
});

test('the stack has five lines at the most: the last one counts the rest', () => {
  assert.deepEqual(stack('abcde'), { ids: [...'abcde'], more: 0 });
  assert.deepEqual(stack('abcdef'), { ids: [...'abcd'], more: 2 });
  assert.deepEqual(stack('abcdefgh', 'a', 'b'), { ids: [...'cdef'], more: 2 });
});
