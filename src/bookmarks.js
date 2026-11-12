// Trees as bookmarks, the way every browser understands them: folders and
// links. An outline is the common shape: [{ title, url?, children? }], where
// an item with children is a folder. Pure: no Chrome here.
//
// Our nodes are richer than bookmarks in one way: a page can have pages
// under it. Such a page becomes a folder with the page itself as its first
// link. A note becomes a folder; its text does not travel.

import { ROOT, isNote, kidsOf } from './model.js';

/** A tree as an outline. `titleOf(node)` names a node. */
export function toOutline(library, treeId, titleOf) {
  const tree = library.trees[treeId];
  const walk = (id) => {
    const node = library.nodes[id];
    const title = titleOf(node);
    const children = kidsOf(tree, id).map(walk);
    if (isNote(node)) return { title, children };
    return children.length ? { title, children: [{ title, url: node.url }, ...children] } : { title, url: node.url };
  };
  return kidsOf(tree, ROOT).map(walk);
}

/** An outline as a tree to import ({ nodes, tree }): folders become groups, links sleeping pages. */
export function fromOutline(items, name, newId) {
  const data = { nodes: {}, tree: { name, children: {}, collapsed: {} } };
  const walk = (item, parent) => {
    const id = newId();
    data.nodes[id] = item.children ? { id, note: '', name: item.title } : { id, url: item.url, title: item.title };
    (data.tree.children[parent] ??= []).push(id);
    for (const child of item.children ?? []) walk(child, id);
  };
  for (const item of items) walk(item, ROOT);
  return data;
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char]);
const unescape = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (entity) => Object.keys(ENTITIES).find((char) => ENTITIES[char] === entity) ?? "'");

/** An outline as a bookmarks file (the "Netscape" format all browsers import and export). */
export function toHtml(items, name) {
  const lines = (list, indent) =>
    list.flatMap((item) =>
      item.children
        ? [`${indent}<DT><H3>${escape(item.title)}</H3>`, `${indent}<DL><p>`, ...lines(item.children, `${indent}    `), `${indent}</DL><p>`]
        : [`${indent}<DT><A HREF="${escape(item.url)}">${escape(item.title)}</A>`],
    );
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${escape(name)}</TITLE>`,
    `<H1>${escape(name)}</H1>`,
    '<DL><p>',
    ...lines(items, '    '),
    '</DL><p>',
    '',
  ].join('\n');
}

/** A bookmarks file as an outline. */
export function fromHtml(text) {
  const top = [];
  const open = [top]; // The lists we are inside of, outermost first.
  let pending; // A folder whose list has not opened yet.
  for (const [, folder, url, title, list, end] of text.matchAll(
    /<H3[^>]*>(.*?)<\/H3>|<A\s[^>]*?HREF="([^"]*)"[^>]*>(.*?)<\/A>|(<DL>)|(<\/DL>)/gis,
  )) {
    if (folder !== undefined) {
      pending = { title: unescape(folder), children: [] };
      open.at(-1).push(pending);
    } else if (url !== undefined) {
      open.at(-1).push({ title: unescape(title.replace(/<[^>]*>/g, '')) || unescape(url), url: unescape(url) });
    } else if (list) {
      open.push(pending?.children ?? open.at(-1));
      pending = undefined;
    } else if (end && open.length > 1) {
      open.pop();
    }
  }
  return top;
}
