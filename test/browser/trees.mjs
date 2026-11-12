// A scenario in a real Chromium with the extension loaded. It prints what the
// tree looks like after each step, and any errors from the consoles.
// Run: node test/browser/trees.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>Page ${req.url}</title><a id="l" target="_blank" href="/child-of${req.url.replace('/', '-')}">link</a>`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const dir = fs.mkdtempSync(os.tmpdir() + '/tree-smoke-');
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: process.env.TREE_CHROME ?? os.homedir() + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = sw.url().split('/')[2];
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push('worker: ' + m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const a = await ctx.newPage(); await a.goto(base + '/a');
const b = await ctx.newPage(); await b.goto(base + '/b');
const [c] = await Promise.all([ctx.waitForEvent('page'), a.click('#l')]);
await c.waitForLoadState();
const panel = await ctx.newPage();
panel.on('console', (m) => (m.type() === 'error' || process.env.V) && errors.push('panel: ' + m.text()));
panel.on('pageerror', (e) => errors.push('panel exception: ' + e.message));
await panel.setViewportSize({ width: 380, height: 700 });
await panel.goto(`chrome-extension://${id}/src/panel/panel.html`);
await sleep(800);
const outline = () => panel.evaluate(() => [...document.querySelectorAll('.pane')].map((p) => [...p.querySelectorAll('.row')].map((r) => '  '.repeat(+r.style.getPropertyValue('--depth')) + (r.classList.contains('asleep') ? '(' : '') + r.querySelector('.title, .rename')?.textContent.trim() + (r.classList.contains('selected') ? ' *' : '')).join('\n')).join('\n-----\n'));
const step = async (name, fn) => { try { await fn(); await sleep(500); console.log(`\n== ${name}\n${await outline()}`); } catch (e) { console.log(`\n== ${name} FAILED: ${e.message.split('\n')[0]}`); } };
const row = (text) => panel.locator('.panes .row', { hasText: text }).first();
const menu = (label) => panel.locator('.menu button', { hasText: label }).first().click();

const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
const pages = () => ctx.pages().map((p) => p.url().replace(base, '')).filter((u) => !u.includes('panel.html')).map((u) => u.replace(/chrome-extension:.*note.html.*/, 'NOTE')).join(' | ');
await step('initial', async () => {});
await step('select 2, Esc clears', async () => { await row('Page /a').click({ modifiers: ['Control'] }); await row('Page /b').click({ modifiers: ['Control'] }); console.log('selected before Esc:', await panel.locator('.row.selected').count()); await panel.keyboard.press('Escape'); });
await step('collapse all', async () => { await panel.click('[data-action="more"]'); await menu('Collapse all'); });
await step('expand all', async () => { await panel.click('[data-action="more"]'); await menu('Expand all'); });
await step('close b, edit its address', async () => { await b.close(); await sleep(400); await row('Page /b').click({ button: 'right' }); await menu('Edit address'); await sleep(200); await panel.keyboard.type(base + '/edited'); await panel.keyboard.press('Enter'); await sleep(300); const [p] = await Promise.all([ctx.waitForEvent('page'), row('Page /b').click()]); await p.waitForLoadState(); await panel.bringToFront(); });
await step('drop a link from a page', async () => { await panel.evaluate((url) => { const el = document.querySelector('.pane'); const r = el.getBoundingClientRect(); const dt = new DataTransfer(); dt.setData('text/uri-list', url); const fire = (type) => document.querySelector('#app').dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.bottom - 20 })); fire('dragover'); return new Promise((done) => setTimeout(() => { fire('dragover'); fire('drop'); done(); }, 200)); }, base + '/dropped'); });
await step('empty new tree shows hint; move a there; shared mark', async () => { await panel.click('[data-action="tree-add"]'); await sleep(300); await panel.keyboard.type('Today'); await panel.keyboard.press('Enter'); await sleep(300); console.log('hint:', (await panel.locator('.pane .hint').textContent()).trim().slice(0, 40)); await panel.locator('.bar .tab', { hasText: 'Main' }).click(); await sleep(300); await row('dropped').click({ button: 'right' }); await menu('Move to the end of'); await sleep(300); await row('Page /a').click({ button: 'right' }); await menu('Add here from'); await sleep(300); await panel.locator('.dialog .row').first().click(); await panel.click('[data-action="picker-add"]'); });
console.log('shared marks:', await panel.locator('.row .mark').count(), '| title:', await panel.locator('.row .mark').first().getAttribute('title').catch(() => '-'));
await step('open Today beside; resize', async () => { console.log('tabs:', (await panel.locator('.bar .tab[data-tree]').allTextContents()).map((x) => x.trim())); await panel.locator('.bar .tab', { hasText: 'Today' }).click({ button: 'right' }); await menu('Open beside'); await sleep(300); const d = await panel.locator('.divider').boundingBox(); await panel.mouse.move(d.x + 100, d.y + 2); await panel.mouse.down(); await panel.mouse.move(d.x + 100, d.y + 120, { steps: 4 }); await panel.mouse.up(); await sleep(300); console.log('pane heights:', await panel.evaluate(() => [...document.querySelectorAll('.panes .pane')].map((p) => Math.round(p.getBoundingClientRect().height)))); });
await step('note link opens a child tab', async () => { const [note] = await Promise.all([ctx.waitForEvent('page'), panel.click('[data-action="new-note"]')]); await note.waitForLoadState(); await sleep(500); await note.keyboard.type('Links ' + base + '/from-note '); await sleep(700); const [opened] = await Promise.all([ctx.waitForEvent('page'), note.locator('.tiptap a').first().click()]); await opened.waitForLoadState(); await sleep(500); console.log('note tab still a note:', note.url().includes('note.html')); await panel.bringToFront(); });
await panel.click('[data-action="more"]'); await menu('Keyboard shortcuts'); await sleep(200);
console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await ctx.close(); server.close();
