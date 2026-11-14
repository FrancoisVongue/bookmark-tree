// Where the current tab is, and how the panel follows it: in a real Chromium
// with the extension loaded. The panel is a page in a window of its own,
// pointed at the window with the tabs, so it stays visible while tabs change.
// Run: node test/browser/wave2.mjs [folder for screenshots]
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
  res.end(`<title>Page ${req.url}</title>${req.url.startsWith('/sound') ? sound : ''}<a id="l" target="_blank" href="/child-of${req.url.replace('/', '-')}">link</a>`);
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`${os.tmpdir()}/tree-wave2-`), {
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
const shot = async (name) => shots && (await panel.screenshot({ path: `${shots}/wave2-${name}.png` }));
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
await say('the current tab is two levels deep');
console.log('  rows above it are marked:', await marks('leads'));
await shot('1-leads');

await row('Page /a').locator('.twisty').click();
await say('its branch folded: the row that holds it is marked, nothing opens by itself');
console.log('  holder:', await marks('holds-active'), '| folded:', await row('Page /a').evaluate((el) => el.classList.contains('collapsed')));
await shot('2-holder');
await row('Page /a').locator('.twisty').click();

await panel.locator('.grid .cell').first().click();
await sleep(300);
await panel.keyboard.type('Other');
await panel.keyboard.press('Enter');
await say('a new empty tree is shown: the tab\'s tree stays marked in the table');
await shot('3-elsewhere');

await panel.click('[data-action="show-active"]');
await say('"show the current tab": back to its tree and row');
console.log('  the row is in sight:', await row('Page /child-of-child-of-a').isVisible());

await panel.locator('.grid .tab', { hasText: 'Other' }).click();
await switchTo(b);
await say('switched to another tab in the browser while the panel showed Other: the panel follows');

await panel.locator('.grid .tab', { hasText: 'Other' }).click();
await sleep(300);
await panel.locator('.grid .tab', { hasText: 'Main' }).click();
await sleep(300);
await panel.locator('.grid .tab', { hasText: 'Other' }).click();
await say('the user looks at Other again (clicks in the panel): the panel stays, new tabs go there');
await open(`${base}/in-other`);
await say('a page opened from the browser');

// The row's buttons: hover a live row; the bin turns red under the pointer.
await panel.bringToFront();
await row('Page /in-other').hover();
await shot('4-row-buttons');
await row('Page /in-other').locator('[data-action="remove"]').hover();
await sleep(200);
console.log('\n== the bin under the pointer:', await row('Page /in-other').locator('[data-action="remove"]').evaluate((el) => getComputedStyle(el).color));
await shot('5-bin-red');
// Putting a page to sleep from the panel: the browser moves to another tab (of Main), the panel stays where the user works.
await row('Page /in-other').locator('[data-action="sleep"]').click();
await say('a page put to sleep from the panel: the panel does not jump to the tab the browser chose');
await switchTo(b);
await panel.locator('.grid .tab', { hasText: 'Other' }).click();
await sleep(300);

// An address the user types in a new tab, which a sleeping page of another tree has.
await b.close();
await say('the current tab closed in the browser: the panel does not follow the tab the browser moved to');
const typed = await open(undefined);
await sleep(400);
await typed.goto(`${base}/b`);
await say('a new tab taken to the address of a page asleep in Main: shown in Other too, at the end');
const state = await msg({ type: 'get-state' });
const bs = Object.values(state.library.nodes).filter((node) => node.url === `${base}/b`);
const holds = (tree) => Object.values(tree.children).flat().includes(bs[0].id);
console.log('  nodes with that address:', bs.length, '| in Main:', holds(state.library.trees.main), '| in Other:', holds(Object.values(state.library.trees).find((tree) => tree.name === 'Other')));

await open(`${base}/sound`);
await sleep(1500);
await panel.bringToFront();
await sleep(500);
console.log('\n== sound: rows with the speaker and the wave:', await panel.locator('.row.playing .snd').count(), '| the wave is drawn:', await panel.locator('.row.playing .wave polyline').evaluate((el) => el.hasAttribute('points')));
await shot('6-sound');

// Sound out of sight: the pages that play stand in a stack at the bottom, and their tree says it in the table.
await open(`${base}/sound-2`);
await open(`${base}/sound-3`);
await sleep(1500);
await panel.bringToFront();
await panel.locator('.grid .cell').first().click();
await sleep(300);
await panel.keyboard.type('Quiet');
await panel.keyboard.press('Enter');
await sleep(600);
const stack = () => panel.locator('.sounds .place .title').allTextContents();
console.log('\n== an empty tree is shown while three pages play: in the stack:', await stack(), '| trees with waves:', (await panel.locator('.grid .tab.playing').allTextContents()).map((name) => name.trim()));
await shot('7-sound-elsewhere');
await panel.locator('.sounds .place', { hasText: 'Page /sound-2' }).hover();
await panel.locator('.sounds .place', { hasText: 'Page /sound-2' }).locator('[data-action="sound-dismiss"]').click();
console.log('  one sent away: in the stack:', await stack());
await panel.locator('.sounds .go').first().click();
await say('a click on the first: its tab, its tree, its row');
console.log('  in the stack:', await stack());

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await ctx.close();
server.close();
