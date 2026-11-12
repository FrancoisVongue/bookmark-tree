// A scenario in a real Chromium with the extension loaded. It prints what the
// tree looks like after each step, and any errors from the consoles.
// Run: node test/browser/restart.mjs   (needs `npm install`; TREE_CHROME may name the browser)
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
const launch = () => chromium.launchPersistentContext(dir, {
  executablePath: process.env.TREE_CHROME ?? os.homedir() + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});
let ctx = await launch();
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = sw.url().split('/')[2];
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push('worker: ' + m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let a = await ctx.newPage(); await a.goto(base + '/a');
const b = await ctx.newPage(); await b.goto(base + '/b');
const [c] = await Promise.all([ctx.waitForEvent('page'), a.click('#l')]);
await c.waitForLoadState();
let panel = await ctx.newPage();
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
await step('initial', async () => {});
await step('sleep subtree of a (button)', async () => { await row('Page /a').hover(); await row('Page /a').locator('[data-action="sleep"]').click(); });
console.log('open pages:', ctx.pages().map((p) => p.url().replace(base, '')).filter((u) => !u.startsWith('chrome-ext')).join(' | '));
await step('click sleeping child wakes it', async () => { await Promise.all([ctx.waitForEvent('page'), row('child-of').click()]); await sleep(500); await panel.bringToFront(); });
await step('export + import', async () => { await panel.locator('.grid .tab').first().click({ button: 'right' }); const [dl] = await Promise.all([panel.waitForEvent('download'), menu('Export tree')]); const file = dir + '/' + dl.suggestedFilename(); await dl.saveAs(file); console.log('exported', dl.suggestedFilename(), fs.statSync(file).size, 'bytes'); const settings = await openSettings(ctx, panel, errors); console.log('settings say:', await importFile(settings, file)); await settings.close(); await panel.bringToFront(); await sleep(300); console.log('tree tabs:', (await panel.locator('.bar .tab[data-tree]').allTextContents()).map((x) => x.trim())); });
await step('40 notes, then wheel during drag', async () => {
  await panel.locator('.bar .tab[data-tree]').first().click(); await sleep(300);
  for (let i = 0; i < 40; i++) await msg({ type: 'op', op: 'note-add', args: { tree: 'main', id: 'n' + i } });
  for (let i = 0; i < 40; i++) await msg({ type: 'op', op: 'note-text', args: { id: 'n' + i, text: 'note ' + i } });
  await sleep(500);
  const from = await row('Page /b').boundingBox();
  await panel.mouse.move(from.x + 80, from.y + 15); await panel.mouse.down(); await panel.mouse.move(from.x + 90, from.y + 40, { steps: 4 });
  const before = await panel.evaluate(() => document.querySelector('.pane').scrollTop);
  await panel.mouse.wheel(0, 500); await sleep(400);
  const after = await panel.evaluate(() => document.querySelector('.pane').scrollTop);
  console.log('scrollTop during drag (wheel):', before, '->', after);
  await panel.mouse.move(from.x + 90, 690, { steps: 3 }); await sleep(600);
  console.log('scrollTop after holding at bottom edge:', await panel.evaluate(() => document.querySelector('.pane').scrollTop));
  await panel.mouse.move(from.x + 90, 400, { steps: 3 }); await sleep(200);
  console.log('drop on:', await panel.evaluate(() => { const r = document.querySelector('.row[class*="drop-"]'); return r && r.querySelector('.title').textContent + ' / ' + r.className.match(/drop-\w+/)[0]; }));
  await panel.mouse.up();
});
const bRow = await panel.evaluate(() => { const rows = [...document.querySelectorAll('.pane .row .title')].map((x) => x.textContent); const i = rows.indexOf('Page /b'); return rows.slice(Math.max(0, i - 1), i + 2).join(' | '); });
console.log('b now sits:', bRow);
console.log('\n== browser restart');
await ctx.close();
ctx = await launch();
const sw2 = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
sw2.on('console', (m) => (m.text().includes('created') || m.text().includes('init')) && console.log('  worker:', m.text()));
await sleep(800);
a = await ctx.newPage(); await a.goto(base + '/a'); await sleep(500);
panel = await ctx.newPage(); await panel.setViewportSize({ width: 380, height: 700 });
await panel.goto(`chrome-extension://${id}/src/panel/panel.html`); await sleep(800);
console.log(await panel.evaluate(() => [...document.querySelectorAll('.pane .row')].slice(0, 5).map((r) => '  '.repeat(+r.style.getPropertyValue('--depth')) + (r.classList.contains('asleep') ? '(' : '') + r.querySelector('.title').textContent).join('\n')));
console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await ctx.close(); server.close();
