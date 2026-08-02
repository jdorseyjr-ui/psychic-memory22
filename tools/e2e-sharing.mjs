/**
 * Two-device sharing walkthrough, driven through two real browser contexts
 * with separate storage — the closest thing to two phones without two phones.
 *
 * Needs the app served, the mock sync server running, and Playwright:
 *   npm start                    # :8080
 *   node tools/mock-server.mjs   # :8787
 *   node tools/e2e-sharing.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:8080/';
const SYNC_URL = process.env.SYNC_URL ?? 'http://localhost:8787';

const browser = await chromium.launch();
const errors = [];

/** A fresh browser context is a fresh device: its own localStorage. */
async function openPhone(label) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.addInitScript((syncUrl) => {
    window.__SHOPPING_LIST_CONFIG__ = {
      supabaseUrl: syncUrl,
      supabaseAnonKey: 'test-anon-key',
    };
  }, SYNC_URL);

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
  });
  return page;
}

const step = async (label, fn) => {
  await fn();
  console.log('✓', label);
};

/** Poll until a condition holds, so tests follow sync latency rather than guess. */
async function waitFor(page, fn, { timeout = 15000, message = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${message}`);
    await page.waitForTimeout(250);
  }
}

const mine = await openPhone('phone-A');
const hers = await openPhone('phone-B');

let shareUrl = null;

await step('phone A builds a list and shares it', async () => {
  await mine.goto(BASE);
  await mine.getByRole('button', { name: 'Create your first list' }).click();
  await mine.locator('.sheet input.field').fill('Weekly groceries');
  await mine.getByRole('button', { name: 'Create', exact: true }).click();

  for (const term of ['milk', 'bread']) {
    await mine.locator('.search-input').fill(term);
    await mine.waitForSelector('.search-result');
    await mine.keyboard.press('Enter');
    await mine.waitForTimeout(80);
  }

  await mine.getByRole('button', { name: 'Share this list' }).click();
  await mine.getByRole('button', { name: 'Create link' }).click();
  await mine.waitForSelector('.sheet-message');

  const message = await mine.locator('.sheet-message').textContent();
  shareUrl = message.match(/https?:\/\/\S+/)?.[0];
  if (!shareUrl) throw new Error(`no share link in sheet: ${message}`);

  await mine.getByRole('button', { name: 'Done' }).click();
});

await step('the shared list shows a sync badge', async () => {
  await mine.waitForSelector('.sync-badge');
  const text = await mine.locator('.sync-badge').textContent();
  if (!text.includes('Shared')) throw new Error(`badge says: ${text}`);
});

await step('phone B opens the link and receives the list', async () => {
  await hers.goto(shareUrl);
  await waitFor(
    hers,
    () => document.querySelectorAll('.item-row').length === 2,
    { message: 'both items to arrive on phone B' },
  );

  const names = await hers.locator('.item-name').allTextContents();
  if (JSON.stringify(names.sort()) !== JSON.stringify(['Bread', 'Milk'])) {
    throw new Error(`phone B got: ${names}`);
  }
});

await step('an item added on phone B appears on phone A', async () => {
  await hers.locator('.search-input').fill('apples');
  await hers.waitForSelector('.search-result');
  await hers.keyboard.press('Enter');

  await waitFor(
    mine,
    () => [...document.querySelectorAll('.item-name')].some((el) => el.textContent === 'Apple'),
    { message: "phone A to see phone B's addition" },
  );
});

await step('a custom item reaches the other phone in the right aisle', async () => {
  // Her grocery database never learns of my custom entry, so the item has to
  // carry its own aisle — otherwise it lands in "Other" on her phone.
  await mine.locator('.search-input').fill('dragonfruit powder');
  await mine.waitForSelector('.search-result-new');
  await mine.locator('.search-result-new').click();
  await mine.waitForSelector('.category-grid');
  await mine.getByRole('button', { name: 'Pantry', exact: true }).click();

  await waitFor(
    hers,
    () => [...document.querySelectorAll('.item-name')]
      .some((el) => el.textContent === 'Dragonfruit Powder'),
    { message: 'the custom item to reach phone B' },
  );

  const aisle = await hers.evaluate(() => {
    const row = [...document.querySelectorAll('.item-row')]
      .find((r) => r.querySelector('.item-name')?.textContent === 'Dragonfruit Powder');
    return row?.querySelector('.item-category')?.textContent;
  });
  if (aisle !== 'Pantry') throw new Error(`phone B filed it under: ${aisle}`);
});

await step('check-offs sync both ways in shopping mode', async () => {
  await mine.getByRole('button', { name: 'Start shopping' }).click();
  await mine.waitForSelector('.shop-line');
  await hers.getByRole('button', { name: 'Start shopping' }).click();
  await hers.waitForSelector('.shop-line');

  // A checks off Milk; B checks off Bread — simultaneously, different rows.
  await mine.locator('.shop-line', { hasText: 'Milk' }).locator('button').click();
  await hers.locator('.shop-line', { hasText: 'Bread' }).locator('button').click();

  const bothChecked = () => {
    const rows = [...document.querySelectorAll('.shop-line')];
    const checked = rows.filter((r) => r.classList.contains('is-checked'));
    return checked.length === 2;
  };

  await waitFor(mine, bothChecked, { message: 'phone A to see both check-offs' });
  await waitFor(hers, bothChecked, { message: 'phone B to see both check-offs' });
});

await step('neither check-off was clobbered by the other', async () => {
  for (const [label, page] of [['A', mine], ['B', hers]]) {
    const checked = await page.evaluate(() =>
      [...document.querySelectorAll('.shop-line.is-checked .shop-name')]
        .map((el) => el.textContent)
        .sort(),
    );
    if (JSON.stringify(checked) !== JSON.stringify(['Bread', 'Milk'])) {
      throw new Error(`phone ${label} shows checked: ${checked}`);
    }
  }
});

await step('a delete on phone A removes the item on phone B', async () => {
  await mine.getByRole('button', { name: 'Exit shopping mode' }).click();
  await mine.waitForSelector('.item-row');
  await mine.getByRole('button', { name: 'Delete Apple' }).click();

  await waitFor(
    hers,
    () => ![...document.querySelectorAll('.shop-name')].some((el) => el.textContent === 'Apple'),
    { message: 'the delete to reach phone B' },
  );
});

await step('the deleted item stays gone after another round', async () => {
  // Guards the tombstone-resurrection bug through the real UI.
  await mine.reload();
  await mine.waitForSelector('.item-row');
  await mine.waitForTimeout(3000);

  const onA = await mine.locator('.item-name').allTextContents();
  if (onA.includes('Apple')) throw new Error(`Apple came back on phone A: ${onA}`);
});

await step('edits made offline reach the other phone on reconnect', async () => {
  await hers.context().setOffline(true);
  await hers.getByRole('button', { name: 'Exit shopping mode' }).click();
  await hers.waitForSelector('.search-input');
  await hers.locator('.search-input').fill('bananas');
  await hers.waitForSelector('.search-result');
  await hers.keyboard.press('Enter');
  await hers.waitForTimeout(500);

  const offlineNames = await hers.locator('.item-name').allTextContents();
  if (!offlineNames.includes('Banana')) throw new Error('offline edit was not saved locally');

  await hers.context().setOffline(false);
  await waitFor(
    mine,
    () => [...document.querySelectorAll('.item-name')].some((el) => el.textContent === 'Banana'),
    { timeout: 25000, message: "phone A to receive phone B's offline edit" },
  );
});

if (errors.length) {
  console.error('\nBrowser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nNo console/page errors.');
}

await browser.close();
