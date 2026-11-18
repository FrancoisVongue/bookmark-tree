import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, addNode, createLibrary, newId, problems, rowsOf } from '../src/model.js';
import { ops } from '../src/ops.js';
import { fromHtml, fromOutline, toHtml, toOutline } from '../src/bookmarks.js';

const titleOf = (node) => node.name || node.title;

test('a tree goes out as a bookmarks file and comes back', () => {
  const lib = createLibrary();
  ops['group-add'](lib, { tree: MAIN, id: 'g', name: 'Work & "play"' });
  ops.add(lib, { tree: MAIN, nodes: [{ id: 'a', url: 'https://a/?x=1&y=2', title: 'A <b>' }], target: 'g', position: 'inside' });
  ops.add(lib, { tree: MAIN, nodes: [{ id: 'b', url: 'https://b/', title: 'B' }], target: 'a', position: 'inside' });
  ops.add(lib, { tree: MAIN, nodes: [{ id: 'c', url: 'https://c/', title: 'C' }] });

  const outline = toOutline(lib, MAIN, titleOf);
  assert.deepEqual(outline, [
    { title: 'Work & "play"', children: [{ title: 'A <b>', children: [{ title: 'A <b>', url: 'https://a/?x=1&y=2' }, { title: 'B', url: 'https://b/' }] }] },
    { title: 'C', url: 'https://c/' },
  ]);
  const html = toHtml(outline, 'Main');
  assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
  assert.deepEqual(fromHtml(html), outline);

  let n = 0;
  ops.import(lib, { id: 'back', data: fromOutline(fromHtml(html), 'Back', () => `n${n++}`) });
  assert.deepEqual(problems(lib), []);
  assert.deepEqual(rowsOf(lib, 'back', true).map((row) => [row.depth, titleOf(lib.nodes[row.id])]), [
    [0, 'Work & "play"'],
    [1, 'A <b>'],
    [2, 'A <b>'],
    [2, 'B'],
    [0, 'C'],
  ]);
});

test('a bookmarks file as browsers write it', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/" ADD_DATE="1700000002" ICON="data:image/png;base64,AAAA">Example &amp; co</A>
        <DT><H3 ADD_DATE="1700000003">Empty</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://last.example/">Last</A>
</DL><p>`;
  assert.deepEqual(fromHtml(html), [
    {
      title: 'Bookmarks bar',
      added: 1_700_000_000_000,
      children: [
        { title: 'Example & co', url: 'https://example.com/', added: 1_700_000_002_000 },
        { title: 'Empty', children: [], added: 1_700_000_003_000 },
      ],
    },
    { title: 'Last', url: 'https://last.example/' },
  ]);
});

test('the date a page was added travels through a bookmarks file, to the second', () => {
  const library = createLibrary();
  addNode(library, MAIN, { id: 'a', url: 'https://a.example/', title: 'A', added: 1_700_000_000_000 });
  addNode(library, MAIN, { id: 'b', url: 'https://b.example/', title: 'B' });
  const html = toHtml(toOutline(library, MAIN, (node) => node.title), 'Main');
  assert.match(html, /HREF="https:\/\/a.example\/" ADD_DATE="1700000000">A</);
  const back = Object.values(fromOutline(fromHtml(html), 'Main', newId).nodes);
  assert.deepEqual(back.map((node) => node.added), [1_700_000_000_000, undefined]);
  assert.equal('added' in back[1], false);
});
