// A scenario in a real Chromium with the extension loaded. It prints what the
// tree looks like after each step, and any errors from the consoles.
// Run: node test/browser/details.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import { importFile, openSettings } from './_settings.js';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>Page ${req.url}</title>${req.url === '/sound' ? '<script>const c = new AudioContext(); const o = c.createOscillator(); o.connect(c.destination); o.start(); c.resume();</script>' : ''}<a id="l" target="_blank" href="/child-of${req.url.replace('/', '-')}">link</a>`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const dir = fs.mkdtempSync(os.tmpdir() + '/tree-smoke-');
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: process.env.TREE_CHROME ?? os.homedir() + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
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
const count = () => ctx.pages().filter((p) => !p.url().includes('panel.html')).length;
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await step('initial', async () => {});
await step('copy link', async () => { await row('Page /b').click({ button: 'right' }); await menu('Copy link'); await sleep(200); console.log('clipboard:', (await panel.evaluate(() => navigator.clipboard.readText())).replace(base, '')); });
await step('sound mark', async () => { const p = await ctx.newPage(); await p.goto(base + '/sound'); await sleep(1500); await panel.bringToFront(); await sleep(500); console.log('sound marks:', await panel.locator('.mark[title="Playing sound"]').count()); await p.close(); });
await step('sleep b; double click renames without opening', async () => { await b.close(); await sleep(400); const before = count(); await row('Page /b').locator('.title').dblclick(); await sleep(500); console.log('opened by double click:', count() - before, '| rename input:', await panel.locator('.rename').count()); await panel.keyboard.press('Escape'); });
await step('single click opens the sleeping page', async () => { const before = count(); await row('Page /b').click(); await sleep(900); console.log('opened by click:', count() - before); await panel.bringToFront(); await ctx.pages().find((p) => p.url().endsWith('/b')).close(); await sleep(400); });
await step('open in background / new window', async () => { const before = count(); await row('Page /b').click({ button: 'right' }); await menu('Open in the background'); await sleep(700); console.log('opened:', count() - before, '| panel still in front:', await panel.evaluate(() => document.visibilityState)); await row('Page /b').click({ button: 'right' }); await menu('Open in a new window'); await sleep(700); console.log('windows:', (await panel.evaluate(() => chrome.windows.getAll())).length); });
await step('middle click: a live node falls asleep, a sleeping one leaves the tree, undo brings it back', async () => { const before = count(); await row('Page /b').click({ button: 'middle' }); await sleep(600); console.log('tabs closed:', before - count(), '| still in the tree:', await row('Page /b').count()); await row('Page /b').click({ button: 'middle' }); await sleep(500); console.log('in the tree after the second:', await row('Page /b').count(), '| toast:', await panel.locator('.toast span').textContent().catch(() => '-')); await panel.click('.toast [data-action="undo"]'); await sleep(500); console.log('after undo:', await row('Page /b').count()); for (const page of ctx.pages()) if (/^chrome:\/\/new-?tab/.test(page.url())) await page.close(); /* Chrome would show the settings in that empty tab instead of a new one. */ await panel.bringToFront(); });
await step('drag over a folded row unfolds it', async () => { await row('Page /a').locator('.twisty').click(); await sleep(300); const from = await row('about:blank').boundingBox(); const to = await row('Page /a').boundingBox(); await panel.mouse.move(from.x + 80, from.y + 15); await panel.mouse.down(); await panel.mouse.move(from.x + 90, from.y + 22, { steps: 3 }); await panel.mouse.move(to.x + 90, to.y + 15, { steps: 4 }); await sleep(1100); console.log('unfolded while holding:', await panel.locator('.panes .row', { hasText: 'child-of' }).count()); await panel.mouse.up(); });
await step('Ctrl+M makes a note; closing it empty leaves nothing', async () => { await row('Page /b').focus(); const [note] = await Promise.all([ctx.waitForEvent('page'), panel.keyboard.press('Control+m')]); await note.waitForLoadState(); await sleep(500); await panel.bringToFront(); await sleep(300); console.log('note rows while open:', await panel.locator('.panes .row', { hasText: 'Note' }).count()); await note.close(); await sleep(500); console.log('note rows after closing:', await panel.locator('.panes .row', { hasText: 'Note' }).count()); });
await step('export, import: name is unique', async () => { await panel.locator('.grid .tab').first().click({ button: 'right' }); const [dl] = await Promise.all([panel.waitForEvent('download'), menu('Export tree')]); const file = dir + '/' + dl.suggestedFilename(); await dl.saveAs(file); const settings = await openSettings(ctx, panel, errors); console.log('settings say:', await importFile(settings, file)); await settings.close(); await panel.bringToFront(); await sleep(300); console.log('tree tabs:', (await panel.locator('.bar .tab[data-tree]').allTextContents()).map((x) => x.trim())); });
await step('bookmarks import', async () => { await panel.evaluate(() => new Promise((r) => chrome.permissions.contains({ permissions: ['bookmarks'] }, r))).then((has) => console.log('bookmarks permission before:', has)); const settings = await openSettings(ctx, panel, errors); await settings.click('[data-action="import-bookmarks"]'); await sleep(1200); console.log('settings say:', await settings.locator('.toast span').textContent().catch(() => '-')); await settings.close(); await panel.bringToFront(); await sleep(300); console.log('tree tabs:', (await panel.locator('.bar .tab[data-tree]').allTextContents()).map((x) => x.trim())); });
await panel.locator('.bar .tab[data-tree]').first().click({ button: 'right' }); await menu('Open beside'); await sleep(300);
console.log('\nERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await ctx.close(); server.close();
