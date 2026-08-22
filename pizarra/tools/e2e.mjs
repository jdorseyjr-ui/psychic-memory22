// End-to-end walkthrough of La Pizarra against a real browser and a real
// data file. Run with the dev server up:  npm run dev  &&  npm run test:e2e
//
// Covers the flows that had to keep working through the rewrite: both
// flashcard modes feeding one scheduler, paste-import, edit/delete, search,
// the grammar quiz, audio, progress, and persistence across a reload.

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.env.PIZARRA_URL || 'http://localhost:5173';
let step = 0;
const pass = (m) => console.log(`  ok  ${String(++step).padStart(2)} ${m}`);
const fail = (m, e) => { console.error(`FAIL  ${String(++step).padStart(2)} ${m}\n      ${e}`); process.exitCode = 1; };

async function check(label, fn) {
  try { await fn(); pass(label); } catch (e) { fail(label, e.message); }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// The sandbox ships a prebuilt Chromium; point at it rather than downloading one.
const executablePath = process.env.PIZARRA_CHROMIUM
  || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
        : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const ctx = await browser.newContext();

// Headless Chromium has no speech synthesis; stub it so the audio controls
// render and we can see that they fire with the right text and language.
await ctx.addInitScript(() => {
  window.__spoken = [];
  // speechSynthesis is a prototype getter, so plain assignment silently fails
  // and the real implementation rejects a fake utterance. Redefine it, and
  // leave SpeechSynthesisUtterance real so the app builds a genuine one.
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { cancel() {}, speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); } },
  });
});

// Start from a clean slate so the run is repeatable: emptying the store makes
// the app treat the next load as a first run and re-seed.
for (const path of ['/api/vocab', '/api/grammar-scores']) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '[]',
  });
  if (!res.ok) throw new Error(`could not reset ${path}: ${res.status} — is the dev server up at ${BASE}?`);
}

const page = await ctx.newPage();
const requests = [];
page.on('request', (r) => requests.push(r.url()));
page.on('pageerror', (e) => fail('uncaught page error', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.index-card', { timeout: 10000 });

await check('fonts are self-hosted (no Google Fonts request)', async () => {
  const external = requests.filter((u) => u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com'));
  assert(external.length === 0, `expected none, got: ${external.join(', ')}`);
  const woff = requests.filter((u) => u.includes('.woff'));
  assert(woff.length > 0, 'expected self-hosted font files to load');
});

await check('seed vocab loaded and A1 is the starting level', async () => {
  assert(await page.locator('.rung-active').innerText() === 'A1', 'A1 should be active');
  const rows = await page.locator('.vocab-row').count();
  assert(rows === 2, `expected 2 A1 words, got ${rows}`);
});

await check('due-today count is surfaced above the card', async () => {
  const text = await page.locator('.due-line').innerText();
  assert(/2 tarjetas para repasar hoy/.test(text), `got "${text}"`);
});

await check('recognize mode: card flips to reveal the translation', async () => {
  const front = await page.locator('.card-word').innerText();
  await page.locator('.index-card').click();
  const back = await page.locator('.card-word').innerText();
  assert(front !== back, `card did not flip (${front} / ${back})`);
});

await check('audio speaks the Spanish side in es-ES', async () => {
  await page.locator('.index-card').click();
  await page.locator('.card-audio').click();
  const spoken = await page.evaluate(() => window.__spoken);
  assert(spoken.length > 0, 'nothing was spoken');
  assert(spoken.at(-1).lang === 'es-ES', `lang was ${spoken.at(-1).lang}`);
});

await check('recognize grading advances the card and schedules the word', async () => {
  const before = await page.locator('.card-word').innerText();
  await page.locator('.btn-yes').click();
  await page.waitForTimeout(150);
  const after = await page.locator('.card-word').innerText();
  assert(before !== after, 'expected the next card');

  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  const graded = vocab.find((v) => v.es === before);
  assert(graded?.schedule, 'graded word has no schedule');
  assert(graded.schedule.reviewCount === 1, `reviewCount ${graded.schedule.reviewCount}`);
  assert(graded.schedule.interval === 1, `interval ${graded.schedule.interval}`);
  // SM-2's ease delta at quality 4 is exactly zero, so a plain "lo se" holds
  // ease steady; only an easy (q=5) answer raises it.
  assert(graded.schedule.easeFactor === 2.5, `ease should hold at 2.5, got ${graded.schedule.easeFactor}`);
});

await check('recall mode: a correct typed answer is accepted', async () => {
  await page.locator('.mode-btn', { hasText: 'recordar' }).click();
  const english = await page.locator('.card-word').innerText();
  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  const target = vocab.find((v) => v.en === english);
  assert(target, `no vocab row matching "${english}"`);

  await page.locator('.recall-input').fill(target.es);
  await page.locator('.btn-primary-wide', { hasText: 'revisar' }).click();
  const feedback = await page.locator('.recall-feedback').innerText();
  assert(/correcto/.test(feedback), `got "${feedback}"`);
});

await check('recall grading feeds the same scheduler as recognize', async () => {
  const english = await page.locator('.card-word').innerText();
  const before = await (await fetch(`${BASE}/api/vocab`)).json();
  const target = before.find((v) => v.en === english);
  const priorCount = target.schedule?.reviewCount ?? 0;

  await page.locator('.btn-primary-wide', { hasText: 'siguiente' }).click();
  await page.waitForTimeout(150);

  const after = await (await fetch(`${BASE}/api/vocab`)).json();
  const graded = after.find((v) => v.id === target.id);
  assert(graded.schedule.reviewCount === priorCount + 1,
    `reviewCount ${priorCount} -> ${graded.schedule.reviewCount}`);
  assert(graded.schedule.nextReview > new Date().toISOString(),
    'a passed card should be scheduled into the future');
});

await check('a wrong recall answer reveals the word and records a lapse', async () => {
  await page.locator('.recall-input').fill('xxxxx');
  await page.locator('.btn-primary-wide', { hasText: 'revisar' }).click();
  const feedback = await page.locator('.recall-feedback').innerText();
  assert(/la respuesta era:/.test(feedback), `got "${feedback}"`);

  const english = await page.locator('.card-word').innerText();
  await page.locator('.btn-primary-wide', { hasText: 'siguiente' }).click();
  await page.waitForTimeout(150);
  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  const lapsed = vocab.find((v) => v.en === english);
  assert(lapsed.schedule.lapses >= 1, `expected a lapse, got ${lapsed.schedule.lapses}`);
  assert(lapsed.schedule.repetitions === 0, 'a lapse should reset repetitions');
});

await check('paste-import accepts word;translation;tag per line', async () => {
  await page.locator('.btn-small', { hasText: 'importar' }).first().click();
  await page.locator('.import-area').fill('la ventana;the window;casa\nel tejado;the roof;casa\nsin etiqueta;untagged');
  await page.locator('.btn-small.btn-primary', { hasText: 'importar a A1' }).click();
  await page.waitForTimeout(250);

  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  const win = vocab.find((v) => v.es === 'la ventana');
  assert(win, 'la ventana was not imported');
  assert(win.en === 'the window' && win.tag === 'casa', `parsed wrong: ${JSON.stringify(win)}`);
  assert(win.level === 'A1', 'import should land in the active level');
  assert(win.schedule?.reviewCount === 0, 'imported words should enter the scheduler as new');
  const untagged = vocab.find((v) => v.es === 'sin etiqueta');
  assert(untagged.tag === 'importado', `missing tag should default, got ${untagged.tag}`);
});

await check('search filters the list', async () => {
  await page.locator('.search-input').fill('ventana');
  await page.waitForTimeout(150);
  const rows = await page.locator('.vocab-row').count();
  assert(rows === 1, `expected 1 result, got ${rows}`);

  await page.locator('.search-input').fill('zzzzzz');
  await page.waitForTimeout(150);
  assert(await page.locator('.empty.small').isVisible(), 'expected the no-results message');
  await page.locator('.search-input').fill('');
  await page.waitForTimeout(150);
});

await check('edit rewrites a word and persists it', async () => {
  await page.locator('.search-input').fill('tejado');
  await page.waitForTimeout(150);
  await page.locator('.vocab-row [aria-label="editar"]').click();
  const inputs = page.locator('.edit-row input');
  await inputs.nth(1).fill('the rooftop');
  await page.locator('.vocab-row [aria-label="guardar"]').click();
  await page.waitForTimeout(250);

  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  const edited = vocab.find((v) => v.es === 'el tejado');
  assert(edited.en === 'the rooftop', `got "${edited.en}"`);
});

await check('delete removes a word and persists it', async () => {
  await page.locator('.vocab-row [aria-label="eliminar"]').click();
  await page.waitForTimeout(250);
  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  assert(!vocab.some((v) => v.es === 'el tejado'), 'el tejado should be gone');
  await page.locator('.search-input').fill('');
  await page.waitForTimeout(150);
});

await check('grammar quiz marks a correct answer and persists the score', async () => {
  await page.locator('.tab', { hasText: 'Gram' }).click();
  await page.waitForSelector('.grammar-card');
  assert(await page.locator('.grammar-card h3').innerText() === 'Ser vs. Estar', 'wrong A1 grammar card');

  await page.locator('.quiz-option', { hasText: 'soy / estoy' }).click();
  await page.waitForTimeout(250);
  assert(await page.locator('.opt-correct').count() === 1, 'answer should be marked correct');
  assert(await page.locator('.quiz-done').isVisible(), 'expected "practicado"');

  const scores = await (await fetch(`${BASE}/api/grammar-scores`)).json();
  assert(scores.some((s) => s.grammarId === 'g1' && s.correct), `not persisted: ${JSON.stringify(scores)}`);
  assert(scores[0].userId === 'default', 'score should carry a userId');
});

await check('a wrong grammar answer is marked wrong', async () => {
  await page.locator('.tab', { hasText: 'Vocabulario' }).click();
  await page.locator('.rung', { hasText: 'A2' }).click();
  await page.locator('.tab', { hasText: 'Gram' }).click();
  await page.waitForSelector('.grammar-card');
  await page.locator('.quiz-option', { hasText: 'cocin' }).nth(1).click();
  await page.waitForTimeout(200);
  assert(await page.locator('.opt-wrong').count() === 1, 'answer should be marked wrong');
});

await check('grammar example audio plays', async () => {
  await page.evaluate(() => { window.__spoken = []; });
  await page.locator('.example [aria-label="escuchar"]').first().click();
  const spoken = await page.evaluate(() => window.__spoken);
  assert(spoken.length === 1 && spoken[0].lang === 'es-ES', `got ${JSON.stringify(spoken)}`);
});

await check('progress view reflects vocab and grammar per level', async () => {
  await page.locator('.tab', { hasText: 'Progreso' }).click();
  await page.waitForSelector('.progress-row');
  const rows = await page.locator('.progress-row').count();
  assert(rows === 6, `expected A1-C2, got ${rows}`);

  const a1 = await page.locator('.progress-row').first().locator('.progress-nums').innerText();
  assert(/vocab \d+\/4/.test(a1), `A1 should hold 4 words after import/delete, got "${a1}"`);
  assert(/1\/1/.test(a1), `A1 grammar should be 1/1, got "${a1}"`);

  const width = await page.locator('.progress-row').first().locator('.bar-fill').nth(1).evaluate((el) => el.style.width);
  assert(width === '100%', `grammar bar should be full, got ${width}`);
});

await check('CEFR ladder switches levels and swaps content', async () => {
  await page.locator('.tab', { hasText: 'Vocabulario' }).click();
  await page.locator('.rung', { hasText: 'C2' }).click();
  await page.waitForTimeout(200);
  assert(await page.locator('.rung-active').innerText() === 'C2', 'C2 should be active');
  const rows = await page.locator('.vocab-row').count();
  assert(rows === 2, `expected 2 C2 words, got ${rows}`);
  assert(/C2/.test(await page.locator('.card-progress').innerText()), 'card counter should name the level');
});

await check('everything survives a reload (state is on disk, not in memory)', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.index-card', { timeout: 10000 });
  await page.locator('.search-input').fill('ventana');
  await page.waitForTimeout(200);
  const rows = await page.locator('.vocab-row').count();
  assert(rows === 1, `imported word should still be there after reload, got ${rows} rows`);

  await page.locator('.tab', { hasText: 'Gram' }).click();
  await page.waitForSelector('.grammar-card');
  assert(await page.locator('.quiz-done').isVisible(), 'grammar score should survive reload');
});

await check('due-first ordering puts unreviewed cards ahead of scheduled ones', async () => {
  await page.locator('.tab', { hasText: 'Vocabulario' }).click();
  await page.waitForSelector('.index-card');
  const shown = await page.locator('.card-word').innerText();
  const vocab = await (await fetch(`${BASE}/api/vocab`)).json();
  const card = vocab.find((v) => v.es === shown || v.en === shown);
  assert(card, `could not match the shown card "${shown}"`);
  const due = new Date(card.schedule.nextReview) <= new Date();
  assert(due, `the leading card should be due, nextReview=${card.schedule.nextReview}`);
});

await browser.close();
console.log(process.exitCode ? '\nsome steps failed' : `\nall ${step} steps passed`);
