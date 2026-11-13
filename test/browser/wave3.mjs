// A new tab is always in sight, and what a folded branch keeps in sight: in a
// real Chromium with the extension loaded. The panel is a page in a window of its own,
// pointed at the window with the tabs, so it stays visible while tabs change.
// Run: node test/browser/wave3.mjs [folder for screenshots]
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const shots = process.argv[2];
const sound = '<script>const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0.01; o.connect(g).connect(c.destination); o.start(); c.resume();</script>';
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>Page ${req.url}</title>${req.url === '/sound' ? sound : ''}<a id="l" target="_blank" href="/child-of${req.url.replace('/', '-')}">link</a>`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`${os.tmpdir()}/tree-wave3-`), {
  executablePath: process.env.TREE_CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = sw.url().split('/')[2];
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push(`worker: ${m.text()}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = ctx.pages()[0];
await a.goto(`${base}/a`);
const [kid] = await Promise.all([ctx.waitForEvent('page'), a.click('#l')]);
await kid.waitForLoadState();
const [deep] = await Promise.all([ctx.waitForEvent('page'), kid.click('#l')]);
await deep.waitForLoadState();
const windowId = await sw.evaluate(async () => (await chrome.windows.getAll())[0].id);
/** A new tab in the window with the tabs, as Ctrl+T there (the scenario's own new pages would land in the panel's window). */
const open = async (url) => {
  const [page] = await Promise.all([ctx.waitForEvent('page'), sw.evaluate(([windowId, url]) => void chrome.tabs.create({ windowId, url }), [windowId, url])]);
  await page.waitForLoadState();
  return page;
};
const b = await open(`${base}/b`);
const [panel] = await Promise.all([
  ctx.waitForEvent('page'),
  sw.evaluate(([id, windowId]) => void chrome.windows.create({ url: `chrome-extension://${id}/src/panel/panel.html?window=${windowId}`, width: 400, height: 640 }), [id, windowId]),
]);
panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
await panel.setViewportSize({ width: 380, height: 520 });
await sleep(900);

const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
const row = (text) => panel.locator('.panes .row', { hasText: text }).first();
const marks = (cls) => panel.locator(`.panes .row.${cls} .title`).allTextContents();
const tabs = () => panel.locator('.grid .tab').evaluateAll((all) => all.map((el) => el.textContent.trim() + (el.classList.contains('current') ? ' [shown]' : '') + (el.classList.contains('has-active') ? ' [tab is here]' : '')).join(' | '));
const rows = () => panel.locator('.panes .row').evaluateAll((all) => all.map((r) => '  '.repeat(+r.style.getPropertyValue('--depth')) + (r.classList.contains('asleep') ? '(' : '') + r.querySelector('.title').textContent.trim() + (r.classList.contains('active') ? ' *' : '')).join('\n    '));
const shot = async (name) => shots && (await panel.screenshot({ path: `${shots}/wave3-${name}.png` }));
const say = async (name) => {
  await sleep(500);
  console.log(`\n== ${name}\n  trees: ${await tabs()}\n    ${await rows()}`);
};
/** As the user does in the browser's own strip of tabs. */
const switchTo = async (page) => {
  await page.bringToFront();
  await sleep(600);
};

await switchTo(deep);
await say('start: the current tab is two levels deep');

// 1. The worker sleeps; the user opens a tab. (The panel asks for it: the worker cannot be asked while stopped.)
const cdp = await ctx.newCDPSession(panel);
await cdp.send('ServiceWorker.enable');
await sw.evaluate(() => void (globalThis.sameWorker = true));
await cdp.send('ServiceWorker.stopAllWorkers');
await sleep(500);
await panel.evaluate((windowId) => void chrome.tabs.create({ windowId }), windowId);
await sleep(1500);
const workerNow = ctx.serviceWorkers().at(-1);
console.log('\n  (the worker was started anew by that tab:', !(await workerNow.evaluate(() => globalThis.sameWorker).catch(() => 'gone')), ')');
await say('a new tab opened while the worker slept: right below the page the user was on');

// 2. The page the user is on is inside a folded branch.
await switchTo(deep);
await row('Page /a').locator('.twisty').click();
await sleep(300);
await panel.evaluate((windowId) => void chrome.tabs.create({ windowId }), windowId);
await say('a new tab opened while on a page inside a folded branch: right below that page, in sight under the fold');
await shot('1-below-branch');
await row('Page /a').locator('.twisty').click();

// 3. A search is on.
await panel.fill('.search input', 'child-of-child');
await say('searching');
await panel.evaluate((windowId) => void chrome.tabs.create({ windowId, url: 'about:blank#searched' }), windowId);
await say('a new tab opened during a search: the search is over, the tab is seen');
console.log('  search field:', JSON.stringify(await panel.inputValue('.search input')));

// 4. Two panes: the worker hears at once which one the user works in.
await panel.locator('.grid .cell').first().click();
await sleep(300);
await panel.keyboard.type('Other');
await panel.keyboard.press('Enter');
await sleep(300);
await panel.locator('.grid .tab', { hasText: 'Main' }).click();
await panel.click('[data-action="split-column"]');
await sleep(300);
await panel.locator('.grid .tab', { hasText: 'Other' }).click(); // The new pane shows Other.
await sleep(300);
await panel.locator('.pane').first().locator('.pane-head').click(); // Back to the pane with Main...
await sleep(100);
const shownTo = async () => { const state = await msg({ type: 'get-state' }); return state.library.trees[state.windows[windowId]].name; };
console.log('\n== focus moved to the pane with Main; the worker knows:', await shownTo());
await panel.locator('.pane').last().locator('.pane-head').click();
await sleep(100);
console.log('== focus moved to the pane with Other; the worker knows:', await shownTo());

// 5. What a folded branch keeps in sight.
await panel.locator('[data-action="pane-close"]').last().click();
await sleep(300);
await panel.locator('.grid .tab', { hasText: 'Main' }).click();
for (const page of ctx.pages()) if (/newtab|about:blank/.test(page.url())) await page.close();
await sleep(500);
await msg({ type: 'op', op: 'add', args: { tree: 'main', nodes: [{ id: 's1', url: 'https://example.com/1', title: 'Asleep one' }, { id: 's2', url: 'https://example.com/2', title: 'Asleep two, marked' }, { id: 's3', url: 'https://example.com/3', title: 'Asleep three' }], target: await row('Page /child-of-a').getAttribute('data-id'), position: 'inside' } });
await say('before folding: three sleeping pages deep in the branch');
await row('Asleep two').click({ button: 'right' });
await panel.locator('.menu button', { hasText: 'Keep in sight' }).click();
await sleep(300);
await row('Page /a').locator('.twisty').click();
await say('folded: the open tabs and the marked page stay, one step under the branch; the count is of what is hidden');
console.log('  kept rows:', await marks('kept'), '| count on the folded row:', await row('Page /a').locator('.badge').textContent());
await shot('2-kept-light');
await panel.emulateMedia({ colorScheme: 'dark' });
await shot('3-kept-dark');
await panel.emulateMedia({ colorScheme: 'light' });
await kid.close();
await say('one of the open tabs closed: its page is hidden with the rest');
console.log('  count:', await row('Page /a').locator('.badge').textContent());
// Removing the folded branch takes everything in it, kept in sight or not.
const before = Object.keys((await msg({ type: 'get-state' })).library.nodes).length;
await row('Page /a').hover();
await row('Page /a').locator('[data-action="remove"]').click();
await sleep(300);
console.log('\n== removing the folded branch asks:', await panel.locator('.dialog.ask p').textContent().catch(() => 'NOTHING'));
await panel.locator('.dialog .primary').click();
await say('removed');
console.log('  nodes gone:', before - Object.keys((await msg({ type: 'get-state' })).library.nodes).length);

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await ctx.close();
server.close();
