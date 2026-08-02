/**
 * Guards the add-ingredient dropdown inside a recipe card on mobile.
 *
 * Two things used to break it: the recipe card clipped the dropdown with
 * `overflow: hidden`, and the height was set in `dvh`, which does not shrink
 * when a phone keyboard opens. A short viewport stands in for "keyboard is
 * covering the bottom half of the screen".
 *
 *   npm start && node tools/e2e-dropdown.mjs
 */

import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://localhost:8080/';
const browser = await chromium.launch();
const errors = [];

const step = async (label, fn) => {
  await fn();
  console.log('✓', label);
};

/** Is the element actually on screen and not clipped away by an ancestor? */
async function visibleBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const styles = getComputedStyle(el);
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      width: rect.width,
      hidden: styles.visibility === 'hidden' || styles.display === 'none',
      /*
       * Hit-test rather than compare geometry: an ancestor's `overflow: hidden`
       * clips what is *painted* while getBoundingClientRect still reports the
       * full box, so geometry alone cannot see the bug this guards.
       */
      clipped: (() => {
        const x = rect.left + rect.width / 2;
        const y = rect.bottom - 4;
        if (y < 0 || y > window.innerHeight || rect.height === 0) return false;
        const hit = document.elementFromPoint(x, y);
        return !(hit && el.contains(hit));
      })(),
    };
  }, selector);
}

async function buildRecipe(page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Create your first list' }).click();
  await page.locator('.sheet input.field').fill('Weekly groceries');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  for (const term of ['milk', 'bread', 'apples', 'chicken breast', 'rice']) {
    await page.locator('.search-input').fill(term);
    await page.waitForSelector('.search-result');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
  }

  await page.getByRole('button', { name: 'Add recipe' }).click();
  await page.locator('.sheet input.field').fill('Salsa');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForSelector('.recipe-card.is-building');

  for (const term of ['tomato', 'onion']) {
    await page.locator('.recipe-card .search-input').fill(term);
    await page.waitForSelector('.recipe-card .search-result');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
  }
}

// A tall phone: plenty of room, dropdown should open downward.
await step('dropdown inside a recipe is visible and unclipped', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await buildRecipe(page);

  await page.locator('.recipe-card .search-input').fill('pepper');
  await page.waitForSelector('.recipe-card .search-results');
  await page.waitForTimeout(200);

  const box = await visibleBox(page, '.recipe-card .search-results');
  if (!box) throw new Error('no dropdown rendered');
  if (box.clipped) throw new Error('dropdown is clipped by an ancestor');
  if (box.height < 40) throw new Error(`dropdown collapsed to ${box.height}px`);
  if (box.bottom > 900) throw new Error(`dropdown runs past the viewport: ${box.bottom}`);
  await page.close();
});

// A short viewport stands in for the keyboard eating the bottom half.
await step('with the keyboard up, the dropdown stays fully on screen', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 380 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await buildRecipe(page);

  await page.locator('.recipe-card .search-input').scrollIntoViewIfNeeded();
  await page.locator('.recipe-card .search-input').fill('pepper');
  await page.waitForSelector('.recipe-card .search-results');
  await page.waitForTimeout(250);

  const box = await visibleBox(page, '.recipe-card .search-results');
  if (!box) throw new Error('no dropdown rendered');
  if (box.clipped) throw new Error('dropdown is clipped by an ancestor');
  if (box.top < -1) throw new Error(`dropdown runs off the top: ${box.top}`);
  if (box.bottom > 381) throw new Error(`dropdown runs off the bottom: ${box.bottom}`);
  if (box.height < 40) throw new Error(`dropdown collapsed to ${box.height}px`);

  // At least one result must be tappable.
  const first = await visibleBox(page, '.recipe-card .search-result');
  if (!first || first.height < 20) throw new Error('no usable result row');
  if (first.bottom > 381) throw new Error('first result is off screen');
  await page.close();
});

await step('a result can still be picked from the flipped dropdown', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 380 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await buildRecipe(page);

  await page.locator('.recipe-card .search-input').fill('pepper');
  await page.waitForSelector('.recipe-card .search-result');
  await page.locator('.recipe-card .search-result').first().click();
  await page.waitForTimeout(150);

  const count = await page.locator('.item-list-nested .item-row').count();
  if (count !== 3) throw new Error(`expected 3 ingredients, got ${count}`);
  await page.close();
});

// The card must sit near the top with room below, or the dropdown flips
// upward and stays inside the card, hiding the clipping bug entirely.
await step('a downward dropdown may escape the recipe card', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Create your first list' }).click();
  await page.locator('.sheet input.field').fill('Weekly groceries');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await page.locator('.sheet input.field').fill('Salsa');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForSelector('.recipe-card.is-building');

  await page.locator('.recipe-card .search-input').fill('pepper');
  await page.waitForSelector('.recipe-card .search-results');
  await page.waitForTimeout(250);

  const opensDown = await page.evaluate(
    () => !document.querySelector('.search').classList.contains('search-above'),
  );
  if (!opensDown) throw new Error('setup wrong: dropdown flipped up, clipping untested');

  const escapes = await page.evaluate(() => {
    const r = document.querySelector('.recipe-card .search-results').getBoundingClientRect();
    const c = document.querySelector('.recipe-card').getBoundingClientRect();
    return r.bottom > c.bottom + 1;
  });
  if (!escapes) throw new Error('setup wrong: dropdown fits inside the card');

  const box = await visibleBox(page, '.recipe-card .search-results');
  if (box.clipped) throw new Error('dropdown is clipped by the recipe card');
  await page.close();
});

await step('the list-level dropdown still works', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await buildRecipe(page);
  await page.getByRole('button', { name: 'End recipe' }).click();
  await page.waitForSelector('.banner-choice');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.locator('.search-input').first().fill('toma');
  await page.waitForSelector('.search-results');
  const box = await visibleBox(page, '.search-results');
  if (box.clipped || box.height < 40) throw new Error('list-level dropdown broken');
  await page.close();
});

if (errors.length) {
  console.error('\nBrowser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nNo console/page errors.');
}

await browser.close();
