import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '../src/model.js';
import { branchOf, narrows, passes, withLeads } from '../src/panel/filter.js';

const rows = (outline) => outline.split(' ').map((word) => ({ id: word.replaceAll('.', ''), depth: word.lastIndexOf('.') + 1 }));
const shown = (list) => list.map((row) => `${'.'.repeat(row.depth)}${row.id}${row.lead ? '~' : ''}`).join(' ');

test('a branch alone: the node and all under it, from depth nothing', () => {
  const all = rows('a .b ..c ..d .e f');
  assert.equal(shown(branchOf(all, 'b')), 'b .c .d');
  assert.equal(shown(branchOf(all, 'a')), 'a .b ..c ..d .e');
  assert.equal(shown(branchOf(all, 'f')), 'f');
  assert.equal(branchOf(all, 'gone'), undefined);
});

test('what is wanted comes with the rows that lead to it, and those are marked', () => {
  const all = rows('a .b ..c ..d .e f');
  assert.equal(shown(withLeads(all, new Set(['d']))), 'a~ .b~ ..d');
  assert.equal(shown(withLeads(all, new Set(['b', 'f']))), 'a~ .b f');
  assert.equal(shown(withLeads(all, new Set())), '');
});

test('conditions hold together', () => {
  const facts = { live: new Set(['open', 'both']), audible: new Set(['both']), day: 1000 };
  const node = (id, more) => ({ id, ...more });
  assert.equal(passes(node('x'), {}, facts), true);
  assert.equal(passes(node('open'), { open: true }, facts), true);
  assert.equal(passes(node('x'), { open: true }, facts), false);
  assert.equal(passes(node('open'), { open: true, sound: true }, facts), false);
  assert.equal(passes(node('both'), { open: true, sound: true }, facts), true);
  // Used this week: the tab opened or closed, or the node added, less than seven days ago.
  assert.equal(passes(node('x', { touched: 994 }), { week: true }, facts), true);
  assert.equal(passes(node('x', { touched: 993 }), { week: true }, facts), false);
  assert.equal(passes(node('x', { added: 999 * DAY }), { week: true }, facts), true);
  assert.equal(passes(node('x'), { week: true }, facts), false);
  assert.equal(passes(node('x', { pinned: true }), { kept: true }, facts), true);
  assert.equal(passes(node('x', { keep: true }), { kept: true }, facts), true);
  assert.equal(passes(node('x'), { kept: true }, facts), false);
  assert.equal(narrows({ branch: 'a' }), false);
  assert.equal(narrows({ branch: 'a', sound: true }), true);
});
