// Trees as bookmarks, the way every browser understands them: folders and
// links. An outline is the common shape: [{ title, url?, added?, children? }],
// where an item with children is a folder and `added` is when it was kept.
// Pure: no Chrome here.
//
// Our nodes are richer than bookmarks in one way: a page can have pages
// under it. Such a page becomes a folder with the page itself as its first
// link. A note becomes a folder; its text does not travel.

import { ROOT, isPage, kidsOf, stamped } from './model.js';

/** A tree as an outline. `titleOf(node)` names a node. */
export function toOutline(library, treeId, titleOf) {
  const tree = library.trees[treeId];
  const walk = (id) => {
    const node = library.nodes[id];
    const { added } = node;
    const title = titleOf(node);
    const children = kidsOf(tree, id).map(walk);
    if (!isPage(node)) return stamped({ title, children }, added);
    const link = stamped({ title, url: node.url }, added);
    return children.length ? stamped({ title, children: [link, ...children] }, added) : link;
  };
  return kidsOf(tree, ROOT).map(walk);
}

/** An outline as a tree to import ({ nodes, tree }): folders become groups, links sleeping pages. */
export function fromOutline(items, name, newId) {
  const data = { nodes: {}, tree: { name, children: {}, collapsed: {} } };
  const walk = (item, parent) => {
    const id = newId();
    data.nodes[id] = stamped(item.children ? { id, group: true, name: item.title } : { id, url: item.url, title: item.title }, item.added);
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

/** An outline as a bookmarks file (the "Netscape" format all browsers import and export; its dates are in seconds). */
export function toHtml(items, name) {
  const date = (item) => (item.added ? ` ADD_DATE="${Math.floor(item.added / 1000)}"` : '');
  const lines = (list, indent) =>
    list.flatMap((item) =>
      item.children
        ? [`${indent}<DT><H3${date(item)}>${escape(item.title)}</H3>`, `${indent}<DL><p>`, ...lines(item.children, `${indent}    `), `${indent}</DL><p>`]
        : [`${indent}<DT><A HREF="${escape(item.url)}"${date(item)}>${escape(item.title)}</A>`],
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
  const added = (attributes) => {
    const seconds = Number(attributes.match(/ADD_DATE="(\d+)"/i)?.[1]);
    return seconds ? seconds * 1000 : undefined;
  };
  for (const [, folderIs, folder, linkIs, title, list, end] of text.matchAll(
    /<H3([^>]*)>(.*?)<\/H3>|<A\s([^>]*)>(.*?)<\/A>|(<DL>)|(<\/DL>)/gis,
  )) {
    const url = linkIs?.match(/HREF="([^"]*)"/i)?.[1];
    if (folder !== undefined) {
      pending = stamped({ title: unescape(folder), children: [] }, added(folderIs));
      open.at(-1).push(pending);
    } else if (url !== undefined) {
      open.at(-1).push(stamped({ title: unescape(title.replace(/<[^>]*>/g, '')) || unescape(url), url: unescape(url) }, added(linkIs)));
    } else if (list) {
      open.push(pending?.children ?? open.at(-1));
      pending = undefined;
    } else if (end && open.length > 1) {
      open.pop();
    }
  }
  return top;
}
