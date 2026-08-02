/**
 * End-to-end walkthrough of the main flows, driven through a real browser.
 *
 * Needs Playwright installed and the app served:
 *   npm start                # in one terminal
 *   node tools/e2e.mjs       # in another
 *
 * Kept out of `npm test` so the default suite stays dependency-free.
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:8080/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const step = async (label, fn) => {
  await fn();
  console.log('✓', label);
};

await page.goto(BASE);
await page.waitForSelector('.empty-state');

await step('create a list', async () => {
  await page.getByRole('button', { name: 'Create your first list' }).click();
  await page.locator('.sheet input.field').fill('Weekly groceries');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForSelector('.search-input');
});

await step('autocomplete adds a db item with its default unit', async () => {
  await page.locator('.search-input').fill('appl');
  await page.waitForSelector('.search-result');
  const first = await page.locator('.search-result-name').first().textContent();
  if (first !== 'Apple') throw new Error(`ranking wrong: ${first}`);
  await page.locator('.search-result').first().click();
  await page.waitForSelector('.item-row');
  const name = await page.locator('.item-row .item-name').first().textContent();
  const unit = await page.locator('.item-row .unit-select').first().inputValue();
  if (name !== 'Apple' || unit !== 'count') throw new Error(`got ${name}/${unit}`);
});

await step('plural query resolves to the same entry', async () => {
  await page.locator('.search-input').fill('eggs');
  await page.waitForSelector('.search-result');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length === 2);
});

await step('quantity edits inline and survives re-render', async () => {
  const qty = page.locator('.item-row').nth(1).locator('.qty-input');
  await qty.fill('12');
  await page.waitForTimeout(120);
  if (await qty.inputValue() !== '12') throw new Error('quantity lost');
  const focused = await page.evaluate(() => document.activeElement?.dataset?.focusKey ?? '');
  if (!focused.endsWith(':qty')) throw new Error(`focus lost after re-render: ${focused}`);
});

await step('custom item prompts for a category and becomes searchable', async () => {
  await page.locator('.search-input').fill('dragonfruit powder');
  await page.waitForSelector('.search-result-new');
  await page.locator('.search-result-new').click();
  await page.waitForSelector('.category-grid');
  await page.getByRole('button', { name: 'Pantry', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.item-row').length === 3);

  await page.locator('.search-input').fill('dragonfruit');
  await page.waitForSelector('.search-result');
  const label = await page.locator('.search-result-category').first().textContent();
  if (!label.includes('Pantry') || !label.includes('yours')) throw new Error(`custom entry label: ${label}`);
  await page.keyboard.press('Escape');
});

await step('recipe building nests items and saves to the library', async () => {
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await page.locator('.sheet input.field').fill('Pancakes');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForSelector('.recipe-card.is-building');

  for (const [term, qty] of [['eggs', '2'], ['flour', '3']]) {
    await page.locator('.recipe-card .search-input').fill(term);
    await page.waitForSelector('.recipe-card .search-result');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    const rows = page.locator('.item-list-nested .item-row');
    await rows.last().locator('.qty-input').fill(qty);
    await page.waitForTimeout(80);
  }

  const nested = await page.locator('.item-list-nested .item-row').count();
  const topLevel = await page.locator('.screen-body > .item-list > .item-row').count();
  if (nested !== 2 || topLevel !== 3) throw new Error(`nesting wrong: ${nested}/${topLevel}`);

  await page.getByRole('button', { name: 'End recipe' }).click();
  await page.waitForSelector('.banner-choice');
  await page.getByRole('button', { name: 'Done' }).click();
});

await step('shopping mode merges duplicates and groups by aisle', async () => {
  await page.getByRole('button', { name: 'Start shopping' }).click();
  await page.waitForSelector('.aisle');

  const aisles = await page.locator('.aisle-name').allTextContents();
  if (JSON.stringify(aisles) !== JSON.stringify(['Produce', 'Dairy & Eggs', 'Pantry'])) {
    throw new Error(`aisle order: ${aisles}`);
  }

  const eggLine = page.locator('.shop-line', { hasText: 'Eggs' });
  const qty = await eggLine.locator('.shop-qty').textContent();
  if (!qty.startsWith('14')) throw new Error(`merge failed: ${qty}`);
  const badge = await eggLine.locator('.shop-merge-badge').textContent();
  if (badge !== '2×') throw new Error(`merge badge: ${badge}`);
  const source = await eggLine.locator('.shop-sources').textContent();
  if (source !== 'Pancakes') throw new Error(`source: ${source}`);
});

await step('checking a merged line checks every underlying item', async () => {
  await page.locator('.shop-line', { hasText: 'Eggs' }).locator('button').click();
  await page.waitForSelector('.shop-line.is-checked');
  const label = await page.locator('.progress-label').textContent();
  if (!label.startsWith('2 of 5')) throw new Error(`progress: ${label}`);
});

await step('checked state survives exiting and re-entering shopping mode', async () => {
  await page.getByRole('button', { name: 'Exit shopping mode' }).click();
  await page.waitForSelector('.search-input');
  await page.getByRole('button', { name: 'Start shopping' }).click();
  await page.waitForSelector('.shop-line.is-checked');
});

await step('everything persists across a reload', async () => {
  await page.goto(BASE);
  await page.waitForSelector('.list-card');
  const meta = await page.locator('.list-card-meta').first().textContent();
  if (!meta.includes('5 items') || !meta.includes('2/5 picked up')) throw new Error(`meta: ${meta}`);
});

await step('recipe library holds the saved recipe, independent of the list', async () => {
  await page.getByRole('button', { name: 'Recipe library' }).click();
  await page.getByRole('heading', { name: 'Recipe Library' }).waitFor();
  const name = await page.locator('.list-card-name').first().textContent();
  if (name !== 'Pancakes') throw new Error(`library: ${name}`);
  await page.locator('.list-card-main').first().click();
  await page.waitForSelector('.item-row');
  const qty = await page.locator('.item-row').first().locator('.qty-input').inputValue();
  if (qty !== '2') throw new Error(`saved ingredient quantity: ${qty}`);
});

await step('deleting a recipe from a list leaves the library entry alone', async () => {
  await page.goto(BASE);
  await page.locator('.list-card-main').first().click();
  await page.waitForSelector('.recipe-card');
  await page.getByRole('button', { name: 'Delete Pancakes' }).click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.recipe-card').length === 0);

  await page.locator('.icon-btn-lg').first().click(); // back to lists
  await page.getByRole('button', { name: 'Recipe library' }).click();
  await page.getByRole('heading', { name: 'Recipe Library' }).waitFor();
  const name = await page.locator('.list-card-name').first().textContent();
  if (name !== 'Pancakes') throw new Error('library entry was removed with the instance');
});

await step('a saved recipe can be re-added to a list, fully populated', async () => {
  await page.goto(BASE);
  await page.locator('.list-card-main').first().click();
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await page.getByRole('button', { name: /Choose from saved/ }).click();
  await page.getByRole('button', { name: /Pancakes/ }).click();
  await page.waitForSelector('.recipe-card');
  const nested = await page.locator('.item-list-nested .item-row').count();
  if (nested !== 2) throw new Error(`re-added ingredients: ${nested}`);
});

if (errors.length) {
  console.error('\nBrowser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nNo console/page errors.');
}

await browser.close();
