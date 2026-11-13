// The note's toolbar: one click for what typing markdown does too. A tool is
// a command of the editor with a picture; the editor itself says which tools
// are lit and which cannot be used where the cursor stands.

import { t } from '../i18n.js';
import { ask } from '../parts.js';

const svg = (path) => `<svg viewBox="0 0 20 20" width="18" height="18"><path d="${path}" /></svg>`;
const heading = (level) => ({
  title: t('noteHeading', level),
  keys: `Mod+Alt+${level}`,
  icon: `H${level}`,
  run: (chain) => chain.toggleHeading({ level }),
  on: ['heading', { level }],
});

/** Makes a link to `href` (asked for first: see `ask` in the tool). On a link it changes it, and an empty address removes the link. */
function link(chain, editor, href) {
  const old = editor.getAttributes('link').href;
  if (href === undefined) return chain; // Asking only whether it can be done, or the person said no.
  if (!href) return chain.extendMarkRange('link').unsetLink();
  if (old) return chain.extendMarkRange('link').setLink({ href });
  // With nothing selected there is nothing to turn into a link: the address itself becomes one.
  if (editor.state.selection.empty) return chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] });
  return chain.setLink({ href });
}

const groups = [
  [
    { title: t('noteUndo'), keys: 'Mod+Z', icon: svg('M7 5 3.5 8.5 7 12M3.5 8.5H12a4 4 0 0 1 0 8H9'), run: (chain) => chain.undo() },
    { title: t('noteRedo'), keys: 'Mod+Shift+Z', icon: svg('M13 5l3.5 3.5L13 12M16.5 8.5H8a4 4 0 0 0 0 8h3'), run: (chain) => chain.redo() },
  ],
  [
    { title: t('noteBold'), keys: 'Mod+B', icon: '<b>B</b>', run: (chain) => chain.toggleBold(), on: ['bold'] },
    { title: t('noteItalic'), keys: 'Mod+I', icon: '<i>I</i>', run: (chain) => chain.toggleItalic(), on: ['italic'] },
    { title: t('noteStrike'), keys: 'Mod+Shift+S', icon: '<s>S</s>', run: (chain) => chain.toggleStrike(), on: ['strike'] },
    { title: t('noteCode'), keys: 'Mod+E', icon: svg('M7 6l-4 4 4 4M13 6l4 4-4 4'), run: (chain) => chain.toggleCode(), on: ['code'] },
  ],
  [
    heading(1),
    heading(2),
    heading(3),
    { title: t('noteQuote'), keys: 'Mod+Shift+B', icon: svg('M4 5v10M8 7h8M8 10h8M8 13h5'), run: (chain) => chain.toggleBlockquote(), on: ['blockquote'] },
    { title: t('noteCodeBlock'), keys: 'Mod+Alt+C', icon: svg('M3 4h14v12H3zM8 8l-2 2 2 2M12 8l2 2-2 2'), run: (chain) => chain.toggleCodeBlock(), on: ['codeBlock'] },
  ],
  [
    { title: t('noteBulletList'), keys: 'Mod+Shift+8', icon: svg('M8 5h9M8 10h9M8 15h9M4 5h.01M4 10h.01M4 15h.01'), run: (chain) => chain.toggleBulletList(), on: ['bulletList'] },
    { title: t('noteNumberedList'), keys: 'Mod+Shift+7', icon: svg('M8 5h9M8 10h9M8 15h9M3.5 4l1-.7v3.4M3.2 12.3c.3-.9 2-.9 2 .1 0 .8-2 1.4-2 2.6h2.1'), run: (chain) => chain.toggleOrderedList(), on: ['orderedList'] },
    { title: t('noteTaskList'), keys: 'Mod+Shift+9', icon: svg('M3.5 3.5h13v13h-13zM6.5 10l2.5 2.5 4.5-5'), run: (chain) => chain.toggleTaskList(), on: ['taskList'] },
  ],
  [
    { title: t('noteLink'), icon: svg('M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5A3 3 0 0 0 11 4.8l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11A3 3 0 0 0 9 15.2l1-1'), ask: (editor) => ask(t('noteLinkAddress'), t('noteLinkYes'), editor.getAttributes('link').href ?? 'https://').then((href) => href?.trim()), run: link, on: ['link'] },
    { title: t('noteTable'), icon: svg('M3 4h14v12H3zM3 8h14M3 12h14M7.7 4v12M12.3 4v12'), run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  ],
];

// These are only there while the cursor is in a table.
const inTable = [
  { title: t('noteRowAdd'), icon: svg('M3 4h14v5H3zM10 12v5M7.5 14.5h5'), run: (chain) => chain.addRowAfter() },
  { title: t('noteRowRemove'), icon: svg('M3 4h14v5H3zM8 12.5l4 4M12 12.5l-4 4'), run: (chain) => chain.deleteRow() },
  { title: t('noteColumnAdd'), icon: svg('M4 3h5v14H4zM12 10h5M14.5 7.5v5'), run: (chain) => chain.addColumnAfter() },
  { title: t('noteColumnRemove'), icon: svg('M4 3h5v14H4zM12.5 8l4 4M16.5 8l-4 4'), run: (chain) => chain.deleteColumn() },
  { title: t('noteTableRemove'), icon: svg('M4 6h12M8 6V4h4v2M5.5 6l.7 10h7.6l.7-10M8.5 9v4.5M11.5 9v4.5'), run: (chain) => chain.deleteTable() },
];

const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';

/** Fills `bar` with the tools of `editor` and keeps them true to where the cursor is. */
export function toolbar(editor, bar) {
  const buttons = new Map();
  const group = (tools) => {
    const element = bar.appendChild(document.createElement('div'));
    for (const tool of tools) {
      const button = element.appendChild(document.createElement('button'));
      button.type = 'button';
      button.innerHTML = tool.icon;
      button.title = tool.keys ? `${tool.title} (${tool.keys.replace('Mod', mod)})` : tool.title;
      button.setAttribute('aria-label', tool.title);
      // A tool that needs an answer asks for it first; what it then does is one step, as for the others.
      button.addEventListener('click', async () => {
        const answer = await tool.ask?.(editor); // First the answer: the step is made from the text as it is after the question.
        tool.run(editor.chain().focus(), editor, answer).run();
      });
      buttons.set(button, tool);
    }
    return element;
  };
  groups.forEach(group);
  const table = group(inTable);

  // A press on a tool must not take the cursor, or the selection, out of the text.
  bar.addEventListener('mousedown', (event) => event.preventDefault());

  const refresh = () => {
    table.hidden = !editor.isActive('table');
    for (const [button, tool] of buttons) {
      button.disabled = !tool.run(editor.can().chain(), editor).run();
      if (tool.on) button.setAttribute('aria-pressed', editor.isActive(...tool.on));
    }
  };
  editor.on('transaction', refresh);
  refresh();
}
