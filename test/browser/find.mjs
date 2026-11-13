// Searching, in a real Chromium with the extension loaded: the main search
// falls back to the other keyboard layout and to typos; the journal keeps a
// hundred places, shows the latest, more on request, and can be searched.
// Run: node test/browser/find.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const TITLES = { 3: 'GitHub mirror', 7: 'Team calendar' };
const server = http.createServer((req, res) => res.setHeader('content-type', 'text/html').end(`<title>${TITLES[req.url.slice(2)] ?? `Page ${req.url}`}</title>`)).listen(0);
const base = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`${os.tmpdir()}/tree-find-`), {
  executablePath: process.env.TREE_CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push(`worker: ${m.text()}`));
const panel = ctx.pages()[0];
panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
await panel.setViewportSize({ width: 380, height: 620 });
await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/src/panel/panel.html`);
await sleep(700);
const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
const shot = (name) => panel.screenshot({ path: `${os.tmpdir()}/tree-find-${name}.png` });

// A library: a few named pages, and 2000 more to search among.
const named = ['GitHub: Where the world builds software|https://github.com/', 'JavaScript reference - MDN|https://developer.mozilla.org/docs/Web/JavaScript', 'Привет, мир|https://example.ru/privet', 'Team calendar|https://calendar.example/team'];
const words = 'react hooks guide docs issue pull request review python deploy server client design system pricing blog release notes changelog api tutorial video channel music playlist weather news article research paper summary'.split(' ');
const pick = (n) => Array.from({ length: n }, () => words[Math.floor(Math.random() * words.length)]).join(' ');
const nodes = [
  ...named.map((line, n) => ({ id: `n${n}`, title: line.split('|')[0], url: line.split('|')[1] })),
  ...Array.from({ length: 2000 }, (_, n) => ({ id: `m${n}`, title: pick(6), url: `https://${pick(1)}.example.com/${n}?id=${Math.random().toString(16).slice(2)}` })),
];
await msg({ type: 'op', op: 'add', args: { tree: 'main', nodes } });
await sleep(1500);
const search = async (query) => {
  await panel.fill('.search input', query);
  await sleep(700);
  const loose = await panel.locator('.pane .loose').textContent().catch(() => '');
  const titles = await panel.locator('.panes .row .title').allTextContents();
  return `${titles.length} rows${titles.length && titles.length < 4 ? `: ${titles.join(' | ')}` : ''}${loose ? `   [${loose.trim()}]` : ''}`;
};
console.log('\n== the main search, among', nodes.length, 'pages');
for (const query of ['github', 'пшерги', 'githb', 'javscript', 'ghbdtn', 'calendr team', 'zzzzqqqq']) console.log(`   ${query.padEnd(14)} ${await search(query)}`);
await search('пшерги'); await shot('layout');
await search('javscript'); await shot('near');
await panel.emulateMedia({ colorScheme: 'dark' }); await sleep(300); await shot('near-dark'); await panel.emulateMedia({ colorScheme: 'light' });

// How long the panel takes to show the answer to a keystroke, with 2000 pages in the tree.
const timing = await panel.evaluate(async () => {
  const input = document.querySelector('.search input');
  const type = (text) =>
    new Promise((done) => {
      const start = performance.now();
      const seen = new MutationObserver(() => (seen.disconnect(), requestAnimationFrame(() => done(Math.round(performance.now() - start)))));
      seen.observe(document.querySelector('.panes'), { childList: true, subtree: true, characterData: true });
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const out = {};
  for (const text of ['calendar', 'calendr teem', 'ьвт куаукутсу', 'react', 'reactt hokks']) out[text] = await type(text).then((ms) => new Promise((done) => setTimeout(() => done(ms), 400)));
  return out;
});
console.log('   from a keystroke to the answer on the screen (ms):', JSON.stringify(timing));
await panel.fill('.search input', ''); await sleep(600);

// Fourteen real pages, looked at one after another: a journal of fourteen places.
const opened = [];
for (let n = 0; n < 14; n++) {
  opened.push(await ctx.newPage());
  await opened[n].goto(`${base}/p${n}`);
}
for (const page of opened) (await page.bringToFront(), await sleep(1650));
await panel.bringToFront(); await sleep(700);
const places = async () => `${await panel.locator('.journal .places .place').count()} places${(await panel.locator('[data-action="journal-more"]').count()) ? `, "${(await panel.locator('[data-action="journal-more"]').textContent()).trim()}"` : ''}`;
await panel.click('[data-action="journal-toggle"]'); await sleep(400);
console.log('\n== the journal, unfolded:', await places());
await shot('journal');
await panel.click('[data-action="journal-more"]'); await sleep(400);
console.log('   after "more":', await places(), '| the list scrolls:', await panel.locator('.journal .places').evaluate((el) => el.scrollHeight > el.clientHeight));
await panel.fill('.journal-search', 'пшерги'); await sleep(600);
console.log('   searched for пшерги:', await places(), '|', (await panel.locator('.journal .loose').textContent().catch(() => '')).trim(), '|', (await panel.locator('.journal .places .place .title').allTextContents()).join(' | '));
await shot('journal-search');
await panel.emulateMedia({ colorScheme: 'dark' }); await sleep(300); await shot('journal-search-dark'); await panel.emulateMedia({ colorScheme: 'light' });
await panel.fill('.journal-search', 'nothing like this'); await sleep(600);
console.log('   searched for nonsense:', await places(), '|', (await panel.locator('.journal .places .loose').textContent().catch(() => '')).trim());
await panel.fill('.journal-search', 'calendr'); await sleep(600);
await panel.press('.journal-search', 'Enter'); await sleep(1000);
console.log('   "calendr" + Enter went to:', (await panel.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }))).map((tab) => tab.title).join(' '));

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await ctx.close();
server.close();
