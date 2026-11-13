// For the scenarios: opens the settings page the way the user does ("⋯" →
// Settings, or the button `via` names) and gives the page. Close it when done:
// the browser shows an open settings page again rather than opening another.
export async function openSettings(ctx, panel, errors, via) {
  if (!via) await panel.click('[data-action="more"]');
  const button = via ? panel.locator(via) : panel.locator('.menu button', { hasText: 'Settings' });
  const [page] = await Promise.all([ctx.waitForEvent('page'), button.click()]);
  page.on('pageerror', (error) => errors.push(`settings: ${error.message}`));
  await page.waitForSelector('h1');
  await new Promise((done) => setTimeout(done, 700)); // The versions arrive after the rest.
  return page;
}

/** Chooses `file` in the settings page's "Import a file", and gives what the page then says. */
export async function importFile(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action="import-file"]')]);
  await chooser.setFiles(file);
  await new Promise((done) => setTimeout(done, 500));
  // A backup of the whole library asks before it replaces everything.
  if (await page.locator('.dialog .primary').count()) await page.click('.dialog .primary');
  await new Promise((done) => setTimeout(done, 700));
  return page.locator('.toast span').textContent().catch(() => '-');
}
