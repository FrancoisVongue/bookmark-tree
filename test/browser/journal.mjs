// The journal of attention, in a real Chromium with the extension loaded:
// where the user was, newest first; a click goes back there.
// Run: node test/browser/journal.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const server = http.createServer((req, res) => res.setHeader('content-type', 'text/html').end(`<title>Page ${req.url}</title>`)).listen(0);
const base = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`${os.tmpdir()}/tree-journal-`), {
  executablePath: process.env.TREE_CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = sw.url().split('/')[2];
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push(`worker: ${m.text()}`));
const open = async (path) => {
  const page = await ctx.newPage();
  await page.goto(base + path);
  return page;
};
const [a, b, c] = [await open('/a'), await open('/b'), await open('/c')];
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
await panel.setViewportSize({ width: 380, height: 560 });
await panel.goto(`chrome-extension://${id}/src/panel/panel.html`);
await sleep(600);
const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
/** The journal as the worker has it, by page title. (Asked without bringing the panel to the front.) */
const journal = async () => {
  const state = await msg({ type: 'get-state' });
  return state.journal.map((entry) => state.library.nodes[entry.node].title.replace('Page ', '')).join(' ');
};
const stay = 1700; // Longer than a place needs to count.
const look = async (page, ms = stay) => (await page.bringToFront(), sleep(ms));
const shot = (name) => panel.screenshot({ path: `${os.tmpdir()}/tree-journal-${name}.png` });

await look(a); await look(b); await look(c); await look(a);
console.log('\n== looked at a, b, c, a; now at a\n   places to go back to:', await journal());
await look(b, 150); await look(c, 150); await look(a);
console.log('== flicked through b and c in passing\n   places to go back to:', await journal());

await look(panel, 600);
console.log('\n== the panel, folded\n   line:', (await panel.locator('.journal .place').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim()));
await shot('folded');
await panel.click('[data-action="journal-toggle"]'); await sleep(300);
console.log('== unfolded\n   list:', (await panel.locator('.journal .places .place .title').allTextContents()).join(' | '));
await shot('open');

// A new tree with nothing in it is shown; going back to b shows b's tree again.
await panel.locator('.grid .cell').first().click(); await sleep(300);
await panel.keyboard.type('Empty'); await panel.keyboard.press('Enter'); await sleep(400);
await panel.locator('.journal .place', { hasText: 'Page /b' }).click(); await sleep(700);
console.log('\n== clicked b in the journal while another tree was shown');
console.log('   tab in front:', (await panel.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }))).map((tab) => tab.title).join(' '));
console.log('   tree shown:', (await panel.locator('.grid .tab.current').textContent()).trim(), '| rows:', await panel.locator('.panes .row').count());

// A sleeping page from the journal opens again.
await c.close(); await sleep(500);
await look(panel, 300);
const before = ctx.pages().length;
await panel.locator('.journal .place', { hasText: 'Page /c' }).click(); await sleep(900);
console.log('\n== closed c, clicked it in the journal\n   tabs opened:', ctx.pages().length - before, '| c is live again:', await panel.locator('.panes .row.live', { hasText: 'Page /c' }).count());

// The key: back to where the user was before.
await look(a);
await look(b);
const keys = await panel.evaluate(() => chrome.commands.getAll());
console.log('\n== the key, as the browser took it:', keys.find((key) => key.name === 'journal-back')?.shortcut || 'NOT SET');
console.log('   at b; back should be:', (await journal()).split(' ')[0]);

// The journal lives as long as the session: a restarted worker still has it.
await sw.evaluate(() => chrome.storage.session.get('session')).then(({ session }) => console.log('\n== kept with the session:', session.journal.length, 'places'));

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await ctx.close();
server.close();
