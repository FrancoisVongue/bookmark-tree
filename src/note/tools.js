// The note's toolbar: one click for what typing markdown does too. A tool is
// a command of the editor with a picture; the editor itself says which tools
// are lit and which cannot be used where the cursor stands.

import { t } from '../i18n.js';
import { ask } from '../parts.js';
import { keys } from './blocks.js';

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
    { title: t('noteUnderline'), keys: 'Mod+U', icon: '<u>U</u>', run: (chain) => chain.toggleUnderline(), on: ['underline'] },
    { title: t('noteStrike'), keys: 'Mod+Shift+S', icon: '<s>S</s>', run: (chain) => chain.toggleStrike(), on: ['strike'] },
    { title: t('noteMarker'), keys: 'Mod+Shift+H', icon: '<mark>M</mark>', run: (chain) => chain.toggleMarker(), on: ['marker'] },
    { title: t('noteCode'), keys: 'Mod+E', icon: svg('M7 6l-4 4 4 4M13 6l4 4-4 4'), run: (chain) => chain.toggleCode(), on: ['code'] },
  ],
  [
    heading(1),
    heading(2),
    heading(3),
    { title: t('noteQuote'), keys: 'Mod+Shift+B', icon: svg('M8.500 6.500c-2 .8-3 2.300-3 4.500v2.500H9V10H6.500M15.500 6.500c-2 .8-3 2.300-3 4.500v2.500H16V10h-2.500'), run: (chain) => chain.toggleBlockquote(), on: ['blockquote'] },
    { title: t('noteCodeBlock'), keys: 'Mod+Alt+C', icon: svg('M3 4h14v12H3zM8 8l-2 2 2 2M12 8l2 2-2 2'), run: (chain) => chain.toggleCodeBlock(), on: ['codeBlock'] },
    { title: t('noteFold'), keys: '+++', icon: svg('M4 6l3 2.500L4 11M10.500 8.500h6M10.500 12.500h6M10.500 16.500h3.500'), run: (chain) => chain.setFold() },
  ],
  [
    { title: t('noteBulletList'), keys: 'Mod+Shift+8', icon: svg('M8 5h9M8 10h9M8 15h9M4 5h.01M4 10h.01M4 15h.01'), run: (chain) => chain.toggleBulletList(), on: ['bulletList'] },
    { title: t('noteNumberedList'), keys: 'Mod+Shift+7', icon: svg('M8 5h9M8 10h9M8 15h9M3.5 4l1-.7v3.4M3.2 12.3c.3-.9 2-.9 2 .1 0 .8-2 1.4-2 2.6h2.1'), run: (chain) => chain.toggleOrderedList(), on: ['orderedList'] },
    { title: t('noteTaskList'), keys: 'Mod+Shift+9', icon: svg('M3.5 3.5h13v13h-13zM6.5 10l2.5 2.5 4.5-5'), run: (chain) => chain.toggleTaskList(), on: ['taskList'] },
  ],
  [
    { title: t('noteLink'), keys: 'Mod+K', icon: svg('M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5A3 3 0 0 0 11 4.8l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11A3 3 0 0 0 9 15.2l1-1'), ask: (editor) => ask(t('noteLinkAddress'), t('noteLinkYes'), editor.getAttributes('link').href ?? 'https://').then((href) => href?.trim()), run: link, on: ['link'] },
    { title: t('noteTable'), icon: svg('M3 4h14v12H3zM3 8h14M3 12h14M7.7 4v12M12.3 4v12'), run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
    { title: t('noteFootnote'), keys: '[^1]', icon: '<span>a<sup>1</sup></span>', run: (chain) => chain.addFootnote() },
  ],
];

/** Fills `bar` with the tools of `editor` and keeps them true to where the cursor is. */
export function toolbar(editor, bar) {
  const buttons = new Map();
  const group = (tools) => {
    const element = bar.appendChild(document.createElement('div'));
    for (const tool of tools) {
      const button = element.appendChild(document.createElement('button'));
      button.type = 'button';
      button.innerHTML = tool.icon;
      button.title = tool.keys ? `${tool.title} (${keys(tool.keys)})` : tool.title;
      button.setAttribute('aria-label', tool.title);
      // A tool that needs an answer asks for it first; what it then does is one step, as for the others.
      button.addEventListener('click', async () => {
        const answer = await tool.ask?.(editor); // First the answer: the step is made from the text as it is after the question.
        tool.run(editor.chain().focus(), editor, answer).run();
      });
      buttons.set(button, tool);
      // A tool that asks has no key in the editor itself: its key presses the tool. (By the key's place, whatever letters the keyboard writes.)
      if (!tool.ask || !tool.keys) continue;
      const code = `Key${tool.keys.at(-1)}`;
      editor.view.dom.addEventListener('keydown', (event) => {
        if (event.code !== code || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || button.disabled) return;
        event.preventDefault();
        button.click();
      });
    }
  };
  groups.forEach(group);

  // A press on a tool must not take the cursor, or the selection, out of the text.
  bar.addEventListener('mousedown', (event) => event.preventDefault());

  const refresh = () => {
    for (const [button, tool] of buttons) {
      button.disabled = !tool.run(editor.can().chain(), editor).run();
      if (tool.on) button.setAttribute('aria-pressed', editor.isActive(...tool.on));
    }
  };
  editor.on('transaction', refresh);
  refresh();
}
