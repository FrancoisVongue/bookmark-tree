// A scenario in a real Chromium with the extension loaded. It prints what the
// tree looks like after each step, and any errors from the consoles.
// Run: node test/browser/basics.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import { importFile, openSettings } from './_settings.js';
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
await step('new group from toolbar', async () => { await row('Page /b').click(); await panel.click('[data-action="new-group"]'); await sleep(400); await panel.keyboard.type('Work'); await panel.keyboard.press('Enter'); });
console.log('group rows:', await panel.locator('.row.group').count(), '| pages:', pages());
await step('search "child"', async () => { await panel.fill('.search input', 'child'); });
await step('clear search (Esc), paste two links', async () => { await panel.keyboard.press('Escape'); await sleep(300); await row('Work').click(); await panel.evaluate((base) => { const dt = new DataTransfer(); dt.setData('text', base + '/pasted1\n' + base + '/pasted2'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, base); });
await step('collapse a, click x -> branch removed', async () => { await row('Page /a').locator('.twisty').click(); await sleep(300); await row('Page /a').hover(); await row('Page /a').locator('[data-action="remove"]').click(); });
console.log('toast:', await panel.locator('.toast span').textContent().catch(() => 'NONE'), '| pages:', pages());
await step('undo from toast', async () => { await panel.click('.toast [data-action="undo"]'); });
await step('open all under a', async () => { await row('Page /a').click({ button: 'right' }); await menu('Open all'); await sleep(800); });
console.log('pages:', pages());
await step('duplicate branch a', async () => { await row('Page /a').click({ button: 'right' }); await menu('Duplicate'); });
await step('delete b everywhere, restore from trash', async () => { await row('Page /b').click({ button: 'right' }); await menu('Delete from all trees'); await sleep(300); const settings = await openSettings(ctx, panel, errors); console.log('trash rows:', await settings.locator('.item:has([data-action="restore"]) .title').allTextContents()); await settings.locator('[data-action="restore"]').first().click(); await sleep(300); await settings.close(); await panel.bringToFront(); });
await step('new tree, new tab in it, delete tree: tab survives', async () => { await panel.click('[data-action="tree-add"]'); await sleep(300); await panel.keyboard.type('Temp'); await panel.keyboard.press('Enter'); await sleep(300); const [p] = await Promise.all([ctx.waitForEvent('page'), panel.click('[data-action="new-tab"]')]); await p.goto(base + '/in-temp'); await panel.bringToFront(); await sleep(400); console.log('Temp tree:', await outline()); await panel.locator('.bar .tab', { hasText: 'Temp' }).click({ button: 'right' }); await menu('Delete tree'); });
console.log('pages:', pages());
let note;
await step('note: live markdown', async () => { [note] = await Promise.all([ctx.waitForEvent('page'), panel.click('[data-action="new-note"]')]); await note.waitForLoadState(); note.on('pageerror', (e) => errors.push('note exception: ' + e.message)); note.on('console', (m) => m.type() === 'error' && errors.push('note: ' + m.text())); await sleep(500); await note.keyboard.type('# Plan'); await note.keyboard.press('Enter'); await note.keyboard.type('[ ] buy milk'); await note.keyboard.press('Enter'); await note.keyboard.type('call **Bob**'); await sleep(700); await note.locator('input[type=checkbox]').first().click(); await sleep(700); console.log('note html:', (await note.innerHTML('.tiptap')).replace(/\s+/g, ' ').slice(0, 330)); await panel.bringToFront(); });
const lib = (await msg({ type: 'get-state' })).library;
console.log('saved markdown:', JSON.stringify(Object.values(lib.nodes).find((n) => n.note)?.note));
await step('note reload keeps text', async () => { await note.reload(); await sleep(700); console.log('after reload:', (await note.innerText('.tiptap')).replace(/\n+/g, ' / ')); await panel.bringToFront(); });
await row('Page /a').first().click({ button: 'right' }); await sleep(200);
console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await ctx.close(); server.close();
