// Two browsers, each with the extension and tabs of its own, syncing through
// a stand-in for GitHub that runs here. Prints both trees after each step.
// Run: node test/browser/sync.mjs   (needs `npm install`; TREE_CHROME may name the browser)
import { chromium } from 'playwright-core';
import { importFile, openSettings } from './_settings.js';
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
  await msg({ type: 'sync-set', repo: 'me/library', token: 'secret', api: base });
  const titles = async () => (await panel.locator('.panes .row .title').allTextContents()).filter((x) => x !== 'about:blank').join(', ');
  return { name, ctx, panel, msg, titles, sync: () => msg({ type: 'sync-now' }) };
}

const A = await browser('A', ['/a', '/b']);
const B = await browser('B', ['/x']);
const show = async (step) => {
  await sleep(500);
  console.log(`\n== ${step}   [${commits.length} versions]\n  A: ${await A.titles()}\n  B: ${await B.titles()}`);
};
const group = (who, name) => who.msg({ type: 'op', op: 'note-add', args: { tree: 'main', id: `${who.name}-${name}`, name } });

await show('before');
await A.sync();
await B.sync();
await show('A synced, then B: B has both');
await A.sync();
await show('A synced again: A has both');
await group(A, 'Work');
await group(B, 'Home');
await A.sync();
await B.sync();
await A.sync();
await show('each added a group, three syncs: both have both');
const b = await A.panel.locator('.panes .row', { hasText: 'Page /b' }).getAttribute('data-id');
await A.msg({ type: 'op', op: 'remove', args: { tree: 'main', ids: [b] } });
await A.sync();
await B.sync();
await show('A removed /b and synced, B synced: gone from B');
console.log('  B trash:', (await B.msg({ type: 'get-state' })).library.trash.map((entry) => entry.node.title).join(', '));
await B.sync();
await show('B synced with nothing new: no new version');

const settings = await openSettings(A.ctx, A.panel, errors);
await sleep(800);
console.log('\n  settings:', (await settings.locator('.hint').nth(1).textContent()).trim().slice(0, 40), '| versions listed:', await settings.locator('[data-action="version"]').count());
await settings.locator('.item:not(:has-text("this computer")) [data-action="version"]').last().click(); // The oldest one on GitHub.
await sleep(1200);
console.log('  settings say:', await settings.locator('.toast span').textContent().catch(() => '-'));
await settings.close();
await A.panel.bringToFront();
await show('A went to the first version');
await A.panel.keyboard.press('Control+z');
await show('A undid that');

console.log('\nERRORS:', errors.length ? `\n${errors.join('\n')}` : 'none');
await A.ctx.close();
await B.ctx.close();
server.close();
