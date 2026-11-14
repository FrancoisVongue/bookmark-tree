import test from 'node:test';
import assert from 'node:assert/strict';
import { block, literal, write } from '../src/note/folds.js';

// The block at line `from` of `text`, with its body as text.
function read(text, from = 0) {
  const lines = text.split('\n');
  const found = block((i) => lines[i], from, lines.length);
  return found && { ...found, body: lines.slice(from + 1, found.end).join('\n') };
}

test('a block is read as it was written, open or folded', () => {
  for (const open of [true, false]) {
    const text = write({ open, title: 'Plan', body: 'one\n\ntwo' });
    assert.deepEqual(read(text), { open, title: 'Plan', body: 'one\n\ntwo', end: 4 });
  }
  assert.equal(write({ open: false, title: 'Plan', body: 'one' }), '+++folded Plan\none\n+++');
});

test('an unclosed block is not a block: its lines stay text', () => {
  assert.equal(read('+++open Plan\none\ntwo'), undefined);
  assert.equal(read('+++open Plan'), undefined);
  // A closing line of another length is not its closing line.
  assert.equal(read('+++open Plan\none\n++++'), undefined);
  // An inner block left open takes the closing line; the outer one is then text, and the inner one a block.
  const text = '+++open Outer\n+++open Inner\none\n+++\nafter';
  assert.equal(read(text), undefined);
  assert.deepEqual(read(text, 1), { open: true, title: 'Inner', body: 'one', end: 3 });
});

test('a damaged opening line is text', () => {
  for (const line of ['+++', '+++ Plan', '++open Plan', '+++opened', '+++openPlan', ' +++open Plan', 'x +++open Plan']) {
    assert.equal(read(`${line}\none\n+++`), undefined, line);
  }
});

test('a block within a block: written with more pluses outside, read whole', () => {
  const inner = write({ open: false, title: 'Inner', body: 'deep' });
  const outer = write({ open: true, title: 'Outer', body: `before\n\n${inner}\n\nafter` });
  assert.equal(outer.split('\n')[0], '++++open Outer');
  const found = read(outer);
  assert.equal(found.body, `before\n\n${inner}\n\nafter`);
  assert.deepEqual(read(found.body, 2), { open: false, title: 'Inner', body: 'deep', end: 4 });
});

test('blocks written by hand with as many pluses close in pairs', () => {
  const text = '+++open Outer\n+++folded Inner\ndeep\n+++\nafter\n+++\nrest';
  assert.deepEqual(read(text), { open: true, title: 'Outer', body: '+++folded Inner\ndeep\n+++\nafter', end: 5 });
});

test('a closing line inside fenced code does not close the block', () => {
  for (const marks of ['```', '~~~', '````']) {
    const body = `${marks}js\n+++\n+++open Not a block\n${marks}`;
    assert.equal(read(`+++open Code\n${body}\n+++\nafter`).body, body);
  }
  // Code never closed runs to the end, as it does for markdown: the block has no closing line then.
  assert.equal(read('+++open Code\n```\n+++'), undefined);
  // Backticks with a backtick after them open no code.
  assert.equal(read('+++open Code\n```a`\n+++').end, 2);
});

test('a line of pluses in the body makes the block write longer marks', () => {
  const body = 'one\n+++\n++++\ntwo';
  const text = write({ open: true, title: '', body });
  assert.equal(text.split('\n')[0], '+++++open');
  assert.equal(read(text).body, body);
});

test('an empty title, an empty body', () => {
  assert.equal(write({ open: true, title: '', body: '' }), '+++open\n+++');
  assert.deepEqual(read('+++open\n+++'), { open: true, title: '', body: '', end: 1 });
  assert.deepEqual(read('+++folded   \n\n+++'), { open: false, title: '', body: '', end: 2 });
});

test('text right after the block is not part of it', () => {
  const found = read('+++open Plan\none\n+++\nafter\n+++');
  assert.equal(found.end, 2);
});

test('lines set in, or of something else, are not the block\'s', () => {
  // The closing line of a block inside an item of a list, and a quoted one.
  const body = '- item\n  +++open In a list\n  x\n  +++\n> +++';
  assert.equal(read(`+++open Plan\n${body}\n+++`).body, body);
});

test('Windows line endings', () => {
  const lines = '+++folded Plan\r\none\r\n+++\r\nafter'.split('\n');
  assert.deepEqual(block((i) => lines[i], 0, lines.length), { open: false, title: 'Plan', end: 2 });
});

test('where the text that could hold the block is over, so is the search', () => {
  const lines = ['+++open Plan', 'one', undefined, '+++'];
  assert.equal(block((i) => lines[i], 0, lines.length), undefined);
});

test('a line of text that starts like a mark is written as text', () => {
  assert.equal(literal('+++open Plan'), '\\');
  assert.equal(literal('+++'), '\\');
  assert.equal(literal('++ two'), '');
  assert.equal(literal('a +++'), '');
});
