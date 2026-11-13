// Two browsers exchanging changes the quick way (see src/channel.js). The
// browser's own syncing of storage is played by copying the cells across.
// Run: node test/browser/channel.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// The stand-in: one file with versions, as the GitHub contents API serves it.
const commits = []; // Newest first: { sha, date, content }
const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', '*');
  res.setHeader('content-type', 'text/html');
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)));
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (!url.pathname.startsWith('/repos/')) return res.end(`<title>Page ${req.url}</title>`);
  if (url.pathname.endsWith('/commits')) return json(200, commits.map((c) => ({ sha: c.sha, commit: { committer: { date: c.date } } })));
  if (req.method === 'GET') {
    const found = url.searchParams.get('ref') ? commits.find((c) => c.sha === url.searchParams.get('ref')) : commits[0];
    return found ? json(200, { content: found.content, sha: found.sha }) : json(404, {});
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const { content, sha } = JSON.parse(body);
  if (commits.length && sha !== commits[0].sha) return json(409, {});
  commits.unshift({ sha: `v${commits.length + 1}`, date: new Date().toISOString(), content });
  json(200, { content: { sha: commits[0].sha } });
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const errors = [];
async function browser(name, paths) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`${os.tmpdir()}/tree-sync-${name}-`), {
    executablePath: process.env.TREE_CHROME ?? `${os.homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  sw.on('console', (m) => (m.type() === 'error' || m.text().includes('sync')) && console.log(`  ${name} worker:`, m.text()));
  for (const path of paths) await (await ctx.newPage()).goto(base + path);
  const panel = await ctx.newPage();
  panel.on('pageerror', (e) => errors.push(`${name} panel: ${e.message}`));
  await panel.setViewportSize({ width: 380, height: 700 });
  await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/src/panel/panel.html`);
  await sleep(700);
  const msg = (m) => panel.evaluate((m) => chrome.runtime.sendMessage(m), m);
  const titles = async () => (await panel.locator('.panes .row .title').allTextContents()).filter((x) => x !== 'about:blank').join(', ');
  return { name, ctx, panel, msg, titles, sync: () => msg({ type: 'sync-now' }) };
}

const A = await browser('A', ['/a', '/b']);
const B = await browser('B', ['/x']);
const show = async (step) => {
  await sleep(600);
  const cells = Object.keys(await A.panel.evaluate(() => chrome.storage.sync.get(null))).sort().join(' ');
  console.log(`\n== ${step}\n  A: ${await A.titles()}\n  B: ${await B.titles()}\n  cells at A: ${cells}`);
};
/** What the browser would do by itself: the cells of one become the cells of the other. */
const carry = async (from, to) => {
  const cells = await from.panel.evaluate(() => chrome.storage.sync.get(null));
  await to.panel.evaluate((cells) => chrome.storage.sync.set(cells), cells);
  await sleep(500);
};
const round = async () => {
  await A.msg({ type: 'exchange' });
  await carry(A, B);
  await B.msg({ type: 'exchange' });
  await carry(B, A);
  await A.msg({ type: 'exchange' });
};

await show('before');
await round();
await show('one round: both have both');
const b = await A.panel.locator('.panes .row', { hasText: 'Page /b' }).getAttribute('data-id');
await A.msg({ type: 'op', op: 'remove', args: { tree: 'main', ids: [b] } });
await B.msg({ type: 'op', op: 'note-add', args: { tree: 'main', id: 'g', name: 'Home' } });
await round();
await show('A removed /b, B added a group, one round');
await round();
await show('a round with nothing new: no new cells');
console.log('  kept back:', JSON.stringify((await A.msg({ type: 'get-state' })).unsynced), JSON.stringify((await B.msg({ type: 'get-state' })).unsynced));

// Too much to sync whole: 2000 pages with long random addresses. The browser's own limits apply here.
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(45)), (byte) => byte.toString(16).padStart(2, '0')).join('');
const many = Array.from({ length: 2000 }, (_, n) => ({ id: `m${n}`, url: `https://example.com/${random()}`, title: `Page number ${n}` }));
await A.msg({ type: 'op', op: 'add', args: { tree: 'main', nodes: many } });
const before = Date.now();
await round();
await sleep(500);
const [atA, atB] = [await A.msg({ type: 'get-state' }), await B.msg({ type: 'get-state' })];
const stored = await A.panel.evaluate(() => chrome.storage.sync.getBytesInUse(null));
console.log(`\n== 2000 more pages at A, one round (${Date.now() - before} ms)`);
console.log('  nodes at A:', Object.keys(atA.library.nodes).length, '| at B:', Object.keys(atB.library.nodes).length, '| synced storage:', stored, 'bytes in', Object.keys(await A.panel.evaluate(() => chrome.storage.sync.get(null))).length, 'items');
console.log('  kept back:', JSON.stringify(atA.unsynced), JSON.stringify(atB.unsynced));
for (const who of [A, B]) {
  await who.panel.reload(); await sleep(900);
  console.log(`  notice at ${who.name}:`, await who.panel.locator('.unsynced span').textContent().catch(() => 'NONE'));
}
await A.panel.screenshot({ path: `${os.tmpdir()}/tree-unsynced.png` });
await A.panel.click('[data-action="unsynced-close"]'); await sleep(400);
console.log('  after closing it at A:', await A.panel.locator('.unsynced').count());
await round();
console.log('  another round: nodes at A still', Object.keys((await A.msg({ type: 'get-state' })).library.nodes).length);

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await A.ctx.close();
await B.ctx.close();
server.close();
