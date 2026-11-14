import test from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, fromPercents, moved, percents, settled, widthsOf } from '../src/note/widths.js';

const row = (widths, aligns) => `| ${delimiter(widths, aligns).join(' | ')} |`;

test('widths are written as dashes and read back', () => {
  assert.equal(row([3, 6], [null, null]), '| --- | ------ |');
  assert.deepEqual(widthsOf('| --- | ------ |'), [3, 6]);
  for (const widths of [[10, 40, 25, 25], [1, 3], [100, 3, 7]]) assert.deepEqual(widthsOf(row(widths, widths.map(() => null))), widths);
});

test('the colons of a side stay, and are not counted', () => {
  assert.equal(row([4, 8, 5, 3], ['left', 'center', 'right', null]), '| :---- | :--------: | -----: | --- |');
  assert.deepEqual(widthsOf('| :---- | :--------: | -----: | --- |'), [4, 8, 5, 3]);
  assert.equal(row(null, ['left', 'center', 'right', null]), '| :--- | :---: | ---: | --- |');
});

test('equal dashes, however many, say that no width was set', () => {
  assert.equal(widthsOf('| --- | --- |'), null);
  assert.equal(widthsOf('|-----|-----|'), null);
  assert.equal(widthsOf('| :-: | - |'), null);
  assert.equal(row([7, 7, 7], [null, null, null]), '| --- | --- | --- |');
});

test('one column has no width to speak of', () => {
  assert.equal(widthsOf('| ---------- |'), null);
  assert.equal(row([40], ['right']), '| ---: |');
  assert.deepEqual(percents([40], 1), [100]);
});

test('absurd numbers are held within bounds', () => {
  assert.deepEqual(widthsOf(`| ${'-'.repeat(5000)} | --- |`), [100, 3]);
  assert.deepEqual(settled([1e9, 0.2, 3], 3), [100, 1, 3]);
  assert.equal(settled([5, -1], 2), null);
  assert.equal(settled([5, NaN], 2), null);
  assert.equal(settled([5, Infinity], 2), null);
  assert.equal(settled([5, 6, 7], 2), null); // Not one for each column.
  assert.equal(settled('3,6', 2), null);
  assert.equal(row([5, 0], [null, null]), '| --- | --- |');
});

test('a line that is not a row of dashes says nothing', () => {
  assert.equal(widthsOf('| a | b |'), null);
  assert.equal(widthsOf(''), null);
  assert.equal(widthsOf('| --- | -- x |'), null);
});

test('a table in a quote or set in keeps its widths', () => {
  assert.deepEqual(widthsOf('> > | --- | ------ |'), [3, 6]);
  assert.deepEqual(widthsOf('    --- | ------'), [3, 6]);
});

test('widths become parts of the table, and parts become widths', () => {
  assert.deepEqual(percents([1, 3], 2), [25, 75]);
  assert.deepEqual(percents(null, 4), [25, 25, 25, 25]);
  assert.deepEqual(fromPercents([10.2, 39.8, 25, 25]), [10, 40, 25, 25]);
  assert.deepEqual(fromPercents([1, 99]), [3, 99]); // Never fewer dashes than a plain column.
  assert.equal(fromPercents([25, 25, 25, 25]), null);
});

test('a column moves, and the others close up', () => {
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
});
