// The panel's keys, written once. What a key does is in keys.js; here is how
// each is called: the menus' hints, the buttons' tooltips and the list on
// the settings page all read it from this table.

const KEY = {
  newChild: 'Ctrl+Shift+Enter',
  newSibling: 'Ctrl+Enter',
  newGroup: 'Ctrl+G',
  newNote: 'Ctrl+M',
  search: 'Ctrl+F',
  branch: 'Ctrl+B',
  move: '↑ ↓ ← →',
  select: 'Shift+↑ ↓ · Ctrl+A',
  open: 'Enter',
  rename: 'F2',
  indent: 'Tab',
  outdent: 'Shift+Tab',
  duplicate: 'Ctrl+D',
  paste: 'Ctrl+V',
  remove: 'Del',
  deleteEverywhere: 'Shift+Del',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  escape: 'Esc',
};

const mac = navigator.platform.startsWith('Mac');
/** The keys of `name`, as this computer's keyboard has them (on a Mac, ⌘ for Ctrl). */
export const keyOf = (name) => (mac ? KEY[name].replaceAll('Ctrl', '⌘') : KEY[name]);

/**
 * The list for the settings page: [what it does (a text's name), its keys
 * here, the browser-wide command if there is one]. The browser-wide ones can
 * be changed by the user, and are shown as they are set.
 */
export const LISTED = [
  ['actionTitle', [], '_execute_action'],
  ['newChild', ['newChild'], 'new-child'],
  ['newSibling', ['newSibling'], 'new-sibling'],
  ['journalBack', [], 'journal-back'],
  ['newGroup', ['newGroup']],
  ['newNote', ['newNote']],
  ['search', ['search']],
  ['filterBranch', ['branch']],
  ['keysMove', ['move']],
  ['keysSelect', ['select']],
  ['keysOpen', ['open']],
  ['rename', ['rename']],
  ['keysIndent', ['indent', 'outdent']],
  ['duplicate', ['duplicate']],
  ['keysPaste', ['paste']],
  ['remove', ['remove']],
  ['deleteEverywhere', ['deleteEverywhere']],
  ['keysUndo', ['undo', 'redo']],
  ['keysEscape', ['escape']],
];
