// The table of trees, bookmarks in and out, backups and the guard against a
// damaged library, in a real Chromium with the extension loaded.
// Run: node test/browser/library.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import { importFile, openSettings } from './_settings.js';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const server = http.createServer((req, res) => res.setHeader('content-type', 'text/html').end(`<title>Page ${req.url}</title>`)).listen(0);
const base = `http://localhost:${server.address().port}`;
const dir = fs.mkdtempSync(`${os.tmpdir()}/tree-library-`);
const launch = () =>
  chromium.launchPersistentContext(dir, {
    executablePath: process.env.TREE_CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
  });
const errors = [];
let ctx, panel, id;
async function start() {
  ctx = await launch();
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  id = sw.url().split('/')[2];
  sw.on('console', (m) => /damaged|backed up|could not/i.test(m.text()) && console.log('  worker:', m.text().slice(0, 150)));
  panel = await ctx.newPage();
  panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
  await panel.setViewportSize({ width: 380, height: 700 });
  await panel.goto(`chrome-extension://${id}/src/panel/panel.html`);
  await sleep(800);
}
const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
const menu = (label) => panel.locator('.menu button', { hasText: label }).first().click();
const more = async (label) => (await panel.click('[data-action="more"]'), menu(label));
const grid = async () => {
  const columns = await panel.evaluate(() => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length);
  const cells = await panel.locator('.grid > *').evaluateAll((all) => all.map((el) => (el.dataset.tree ? el.textContent.trim() : '·')));
  return cells.map((cell, at) => cell + ((at + 1) % columns ? ' | ' : '\n    ')).join('').trim();
};
const rows = async () => (await panel.locator('.panes .row').evaluateAll((all) => all.map((r) => '  '.repeat(+r.style.getPropertyValue('--depth')) + r.querySelector('.title').textContent))).join('\n    ');
const step = async (name, run) => {
  try {
    await run();
    await sleep(500);
    console.log(`\n== ${name}\n    ${await grid()}`);
  } catch (error) {
    console.log(`\n== ${name} FAILED: ${error.message.split('\n')[0]}`);
  }
};

await start();
await (await ctx.newPage()).goto(`${base}/a`);
await panel.bringToFront();
await step('start', async () => {});
await step('a tree started in the last cell', async () => { await panel.locator('.grid .cell').last().click(); await sleep(300); await panel.keyboard.type('Work'); await panel.keyboard.press('Enter'); });
await step('add a row, start a tree in its second cell', async () => { await more('add a row'); await sleep(300); await panel.locator('.grid .cell').nth(3).click(); await sleep(300); await panel.keyboard.type('Home'); await panel.keyboard.press('Enter'); });
await step('drag Work onto Main: they change places', async () => {
  const from = await panel.locator('.grid .tab', { hasText: 'Work' }).boundingBox();
  const to = await panel.locator('.grid .tab', { hasText: 'Main' }).boundingBox();
  await panel.mouse.move(from.x + 20, from.y + 10); await panel.mouse.down(); await panel.mouse.move(from.x + 10, from.y + 14, { steps: 3 });
  await panel.mouse.move(to.x + 20, to.y + 10, { steps: 5 }); await sleep(150); await panel.mouse.up();
});
await step('remove a column: nothing falls off', async () => { await more('remove a column'); await sleep(200); await more('remove a column'); });

await panel.locator('.grid .tab', { hasText: 'Main' }).click(); await sleep(300);
await msg({ type: 'op', op: 'note-add', args: { tree: 'main', id: 'g', name: 'Reading' } });
await msg({ type: 'op', op: 'add', args: { tree: 'main', nodes: [{ id: 'x', url: 'https://example.com/x', title: 'X & Y' }], target: 'g', position: 'inside' } });
await sleep(400);
console.log(`\n== Main is\n    ${await rows()}`);
await step('export as a bookmarks file, import it back', async () => {
  await panel.locator('.grid .tab', { hasText: 'Main' }).click({ button: 'right' });
  const [file] = await Promise.all([panel.waitForEvent('download'), menu('Export as a bookmarks file')]);
  const path = `${dir}/${file.suggestedFilename()}`; await file.saveAs(path);
  console.log('  file:', file.suggestedFilename(), '|', fs.readFileSync(path, 'utf8').split('\n')[0]);
  const settings = await openSettings(ctx, panel, errors);
  console.log('  settings say:', await importFile(settings, path));
  await settings.close(); await panel.bringToFront(); await sleep(300);
});
console.log(`    imported tree:\n    ${await rows()}`);
let backup;
await step('back up everything, delete a tree, restore the backup', async () => {
  let settings = await openSettings(ctx, panel, errors);
  const [file] = await Promise.all([settings.waitForEvent('download'), settings.click('[data-action="backup"]')]);
  backup = `${dir}/${file.suggestedFilename()}`; await file.saveAs(backup);
  await settings.close(); await panel.bringToFront();
  await panel.locator('.grid .tab', { hasText: 'Home' }).click({ button: 'right' }); await menu('Delete tree'); await sleep(200); console.log('asked:', await panel.locator('.dialog.ask p').textContent().catch(() => '-')); await panel.click('.dialog.ask .primary'); await sleep(400);
  console.log('    after deleting Home:', (await grid()).replace(/\n\s+/g, ' / '));
  settings = await openSettings(ctx, panel, errors);
  console.log('  settings say:', await importFile(settings, backup));
  await settings.close(); await panel.bringToFront(); await sleep(300);
});
const bad = JSON.parse(fs.readFileSync(backup, 'utf8')); bad.trees.main.children.root.push('nobody');
console.log('\n== a damaged backup is refused:', await msg({ type: 'restore-file', library: bad }));
console.log('== an op that would damage the library is not made:', await msg({ type: 'op', op: 'import', args: { id: 'z', data: { nodes: {}, tree: { name: 'Z', children: { root: ['ghost'] }, collapsed: {} } } } }), '| trees:', (await grid()).replace(/\n\s+/g, ' / '));
let settings = await openSettings(ctx, panel, errors);
console.log('== local backups listed:', await settings.locator('.item:has([data-action="version"]) .title').allTextContents());
await settings.close();

console.log('\n== the stored library gets damaged behind our back; the browser restarts');
const before = (await msg({ type: 'get-state' })).library;
await panel.evaluate((library) => { library.trees.main.children.root.push('nobody'); return chrome.storage.local.set({ library }); }, structuredClone(before));
await ctx.close();
await start();
console.log('  banner:', (await panel.locator('.trouble').textContent().catch(() => 'NONE')).slice(0, 90));
await (await ctx.newPage()).goto(`${base}/new`); await sleep(600);
const stored = await panel.evaluate(() => chrome.storage.local.get('library'));
console.log('  stored library untouched by the new tab:', Object.keys(stored.library.nodes).length === Object.keys(before.nodes).length);
await panel.bringToFront();
settings = await openSettings(ctx, panel, errors, '.trouble button');
console.log('  settings banner:', (await settings.locator('.trouble').textContent().catch(() => 'NONE')).slice(0, 40));
await settings.locator('[data-action="version"]').first().click(); await sleep(1000);
console.log('  settings say:', await settings.locator('.toast span').textContent().catch(() => '-'));
await settings.close(); await panel.bringToFront(); await sleep(400);
console.log('  after restoring the local backup — banner:', await panel.locator('.trouble').count(), '| trees:', (await grid()).replace(/\n\s+/g, ' / '));

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await ctx.close();
server.close();
