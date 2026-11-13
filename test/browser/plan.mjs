// The plan (what to open next), in a real Chromium with the extension loaded:
// pages get into it from the menu and by dragging, are reordered by dragging,
// and leave it once the user has been at them.
// Run: node test/browser/plan.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const server = http.createServer((req, res) => res.setHeader('content-type', 'text/html').end(`<title>Page ${req.url}</title>`)).listen(0);
const base = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`${os.tmpdir()}/tree-plan-`), {
  executablePath: process.env.TREE_CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = sw.url().split('/')[2];
const errors = [];
sw.on('console', (m) => m.type() === 'error' && errors.push(`worker: ${m.text()}`));
const pages = {};
for (const name of ['a', 'b', 'c', 'd']) {
  pages[name] = await ctx.newPage();
  await pages[name].goto(`${base}/${name}`);
}
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
await panel.setViewportSize({ width: 380, height: 520 });
await panel.goto(`chrome-extension://${id}/src/panel/panel.html`);
await sleep(700);
const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
const row = (text) => panel.locator('.panes .row', { hasText: text }).first();
const menu = (label) => panel.locator('.menu button', { hasText: label }).first().click();
/** The plan as the library has it, by page title. */
const plan = async () => {
  const { library } = await msg({ type: 'get-state' });
  return (library.plan ?? []).map((node) => library.nodes[node].title.replace('Page ', '')).join(' ') || '(nothing)';
};
const strip = async () => (await panel.locator('.plan').count()) ? (await panel.locator('.plan').innerText()).replace(/\s+/g, ' ').trim() : '(no strip)';
const shot = (name) => panel.screenshot({ path: `${os.tmpdir()}/tree-plan-${name}.png` });
/** Drags from the middle of one element to a point of another: `at` is how far down it, 0 to 1. */
async function drag(from, to, at = 0.5, hold) {
  const [a, b] = [await from.boundingBox(), await to.boundingBox()];
  await panel.mouse.move(a.x + 60, a.y + a.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(a.x + 66, a.y + a.height / 2 + 6, { steps: 3 });
  await panel.mouse.move(b.x + 80, b.y + b.height * at, { steps: 6 });
  await sleep(200);
  if (hold) await hold();
  await panel.mouse.up();
  await sleep(400);
}
const look = async (page, ms = 1700) => (await page.bringToFront(), sleep(ms));

console.log('\n== nothing planned:', await strip());
for (const name of ['b', 'c']) {
  await row(`Page /${name}`).click({ button: 'right' });
  await menu('Plan to open next');
  await sleep(300);
}
console.log('== b and c planned from the menu\n   plan:', await plan(), '| strip, folded:', await strip());
await shot('folded');
await panel.click('[data-action="plan-toggle"]'); await sleep(300);
await drag(row('Page /d'), panel.locator('.plan'), 0.95);
console.log('== unfolded; row d dragged onto the end of the strip\n   plan:', await plan(), '| d still in the tree:', await row('Page /d').count());
await drag(panel.locator('.plan .places .place', { hasText: 'Page /d' }), panel.locator('.plan .places .place', { hasText: 'Page /b' }), 0.2);
console.log('== d dragged above b\n   plan:', await plan());
await shot('open');
await panel.emulateMedia({ colorScheme: 'dark' }); await sleep(300);
await shot('open-dark');
await panel.emulateMedia({ colorScheme: 'light' });

await panel.locator('.plan .places .place', { hasText: 'Page /d' }).click(); await sleep(1900);
await look(pages.b, 150); // b only passed...
await look(pages.a); // ...on the way to a.
console.log('\n== clicked d in the plan, stayed; then passed b on the way to a\n   plan:', await plan());
await look(panel, 400);
await shot('with-journal');
await panel.emulateMedia({ colorScheme: 'dark' }); await sleep(300);
await shot('with-journal-dark');
await panel.emulateMedia({ colorScheme: 'light' });
await panel.locator('.plan .places .place', { hasText: 'Page /c' }).hover();
await panel.locator('.plan .places .place', { hasText: 'Page /c' }).locator('[data-action="unplan"]').click(); await sleep(300);
console.log('== took c out with its button\n   plan:', await plan(), '| strip:', await strip());
await row('Page /b').click({ button: 'right' });
await menu('Take out of the plan'); await sleep(300);
console.log('== took b out from the menu\n   plan:', await plan(), '| strip:', await strip());
await drag(row('Page /c'), panel.locator('.bar'), 0.9, async () => {
  // The strip appears once something is dragged: go to it.
  const box = await panel.locator('.plan').boundingBox();
  await panel.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
  await sleep(200);
  console.log('== dragging a row with nothing planned\n   strip:', await strip());
  await shot('empty-dragging');
});
console.log('   dropped there\n   plan:', await plan(), '| strip:', await strip());
await panel.locator('[data-action="undo"]').first().click(); await sleep(400);
console.log('== undo\n   plan:', await plan());
const stored = await panel.evaluate(() => chrome.storage.local.get('library'));
console.log('\n== in the stored library:', 'plan' in stored.library ? stored.library.plan.length : 'no plan');

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await ctx.close();
server.close();
