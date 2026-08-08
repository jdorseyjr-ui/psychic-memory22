/**
 * Checks that sync failures are legible on a phone.
 *
 * Setup happens on a phone with no console, so "it didn't work" has to arrive
 * as a status code and a server message on screen, not a toast that vanishes.
 * Two cases are simulated:
 *   - the schema was never applied  -> the RPC 404s
 *   - the device is offline         -> the request never lands
 *
 *   npm start && node tools/e2e-sync-errors.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:8080/';
// The mock server 404s any path outside /rest/v1/rpc/*, so pointing at a bogus
// prefix reproduces what a Supabase project with no functions installed does.
// (A plain static file server is no good here: it answers 501 to POST, not 404.)
const NO_SCHEMA_URL = process.env.NO_SCHEMA_URL ?? 'http://localhost:8787/no-schema';

const browser = await chromium.launch();
const errors = [];

const step = async (label, fn) => {
  await fn();
  console.log('✓', label);
};

async function openApp(syncUrl, { offline = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.addInitScript((url) => {
    window.__SHOPPING_LIST_CONFIG__ = { supabaseUrl: url, supabaseAnonKey: 'test-key' };
  }, syncUrl);

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Create your first list' }).click();
  await page.locator('.sheet input.field').fill('Weekly groceries');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.search-input').fill('milk');
  await page.waitForSelector('.search-result');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);

  if (offline) await context.setOffline(true);
  return page;
}

await step('a missing schema reports its status code on screen', async () => {
  const page = await openApp(NO_SCHEMA_URL);

  await page.getByRole('button', { name: 'Share this list' }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  await page.waitForSelector('.sheet-message');

  const title = await page.locator('.sheet-title').textContent();
  const message = await page.locator('.sheet-message').textContent();

  if (!/Couldn’t create the share link/.test(title)) throw new Error(`title: ${title}`);
  if (!message.includes('HTTP 404')) throw new Error(`message lacks the status code: ${message}`);
  console.log('   reported:', message.replace(/\s+/g, ' ').trim().slice(0, 90));

  // The failure must not have half-shared the list.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(200);
  const badge = await page.locator('.sync-badge').count();
  if (badge !== 0) throw new Error('list was marked shared despite the failure');
  await page.close();
});

await step('being offline reports a connection problem, not a status code', async () => {
  const page = await openApp(NO_SCHEMA_URL, { offline: true });

  await page.getByRole('button', { name: 'Share this list' }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  await page.waitForSelector('.sheet-message');

  const message = await page.locator('.sheet-message').textContent();
  if (!/No connection/.test(message)) throw new Error(`message: ${message}`);
  if (!/saved on this device/.test(message)) throw new Error('should reassure that data is safe');
  console.log('   reported:', message.replace(/\s+/g, ' ').trim().slice(0, 90));
  await page.close();
});

await step('a failed share leaves the list intact and usable', async () => {
  const page = await openApp(NO_SCHEMA_URL);
  await page.getByRole('button', { name: 'Share this list' }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  await page.waitForSelector('.sheet-message');
  await page.getByRole('button', { name: 'Done' }).click();

  const names = await page.locator('.item-name').allTextContents();
  if (JSON.stringify(names) !== JSON.stringify(['Milk'])) throw new Error(`items: ${names}`);

  // And the app still works locally.
  await page.locator('.search-input').fill('bread');
  await page.waitForSelector('.search-result');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  if ((await page.locator('.item-row').count()) !== 2) throw new Error('list broke after a sync failure');
  await page.close();
});

if (errors.length) {
  console.error('\nBrowser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nNo page errors.');
}

await browser.close();
