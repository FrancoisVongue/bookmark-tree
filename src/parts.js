// Two small parts every page of the extension shares: a question, and the
// notice of what was just done. (Their styles are in base.css.)

import { html, nothing } from './vendor/lit-html/lit-html.js';
import { t } from './i18n.js';

/**
 * Asks a question in a dialog on top of the page and gives the answer:
 * whether the person said yes (the button named `yes`) - or, when a `value`
 * to start from is given, the text they typed (nothing, if they said no).
 * The browser's own dialog does the rest: it holds the keyboard inside,
 * Esc says no, and so does a press beside it.
 */
export function ask(question, yes, value) {
  const dialog = document.body.appendChild(document.createElement('dialog'));
  dialog.className = 'dialog ask';
  const text = dialog.appendChild(document.createElement('p'));
  text.textContent = question;
  const field = value === undefined ? undefined : dialog.appendChild(document.createElement('input'));
  if (field) field.value = value;
  const buttons = dialog.appendChild(document.createElement('footer'));
  const button = (label, answer, primary) => {
    const el = buttons.appendChild(document.createElement('button'));
    el.textContent = label;
    el.className = primary ? 'primary' : '';
    el.addEventListener('click', () => dialog.close(answer));
  };
  button(t('cancel'), '');
  button(yes, 'yes', true);
  // In a field Enter says yes; without one the keyboard waits on "yes" itself.
  field?.addEventListener('keydown', (event) => event.key === 'Enter' && dialog.close('yes'));
  dialog.addEventListener('click', (event) => event.target === dialog && dialog.close(''));
  dialog.showModal();
  (field ?? buttons.lastChild).focus();
  field?.select();
  return new Promise((answer) => {
    dialog.addEventListener('close', () => {
      const said = dialog.returnValue === 'yes';
      dialog.remove();
      answer(field ? (said ? field.value : undefined) : said);
    });
  });
}

/** The notice of what was just done: { text, undo } - with an "Undo" (data-action="undo") when it can be undone. (Where it stands is said by what holds it: `.toasts`, on each page.) */
export const toastView = ({ text, undo }) => html`
  <div class="bubble toast">
    <span>${text}</span>
    ${undo ? html`<button class="pill" data-action="undo">${t('undo')}</button>` : nothing}
  </div>
`;
