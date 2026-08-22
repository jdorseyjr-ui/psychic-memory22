import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSchedule, applyReview, reviewWord, ensureSchedule, isDue, sortForStudy,
  dueCount, qualityFor, isMastered, dayStart, addDays, MIN_EASE, DEFAULT_EASE, QUALITY,
  maturity, meanMaturity, isLearning, REPS_TO_MASTER, MASTERY_INTERVAL_DAYS,
} from '../src/lib/sm2.js';

const NOW = new Date('2026-03-10T09:30:00Z');
const day = (d) => dayStart(d).toISOString();

test('a new word is due immediately', () => {
  const s = newSchedule(NOW);
  assert.equal(s.easeFactor, DEFAULT_EASE);
  assert.equal(s.repetitions, 0);
  assert.equal(s.nextReview, day(NOW));
  assert.ok(isDue({ schedule: s }, NOW));
});

test('the SM-2 interval ladder is 1, 6, then interval * ease', () => {
  let s = newSchedule(NOW);
  s = applyReview(s, QUALITY.good, NOW);
  assert.equal(s.interval, 1);
  assert.equal(s.repetitions, 1);

  s = applyReview(s, QUALITY.good, NOW);
  assert.equal(s.interval, 6);
  assert.equal(s.repetitions, 2);

  const easeAfterTwo = s.easeFactor;
  s = applyReview(s, QUALITY.good, NOW);
  assert.equal(s.interval, Math.round(6 * easeAfterTwo));
  assert.equal(s.repetitions, 3);
});

test('nextReview lands interval days after the review', () => {
  const s = applyReview(newSchedule(NOW), QUALITY.good, NOW);
  assert.equal(s.nextReview, addDays(NOW, 1).toISOString());
  assert.equal(s.lastReviewed, day(NOW));
});

test('a lapse resets repetitions and comes back tomorrow', () => {
  let s = newSchedule(NOW);
  s = applyReview(s, QUALITY.good, NOW);
  s = applyReview(s, QUALITY.good, NOW);
  assert.equal(s.interval, 6);

  s = applyReview(s, QUALITY.again, NOW);
  assert.equal(s.repetitions, 0);
  assert.equal(s.interval, 1);
  assert.equal(s.lapses, 1);
});

test('ease rises on easy answers and never falls below the floor', () => {
  let s = applyReview(newSchedule(NOW), QUALITY.easy, NOW);
  assert.ok(s.easeFactor > DEFAULT_EASE, `expected rise, got ${s.easeFactor}`);

  let harsh = newSchedule(NOW);
  for (let i = 0; i < 20; i++) harsh = applyReview(harsh, QUALITY.again, NOW);
  assert.equal(harsh.easeFactor, MIN_EASE);
});

test('applyReview does not mutate the schedule it is given', () => {
  const s = newSchedule(NOW);
  const copy = { ...s };
  applyReview(s, QUALITY.good, NOW);
  assert.deepEqual(s, copy);
});

test('both flashcard modes grade through the same scheduler', () => {
  const word = { id: '1', es: 'el perro', en: 'the dog' };
  // recognition mode self-rates; recall mode reports right/wrong
  const afterRecognize = reviewWord(word, qualityFor('good'), NOW);
  const afterRecall = reviewWord(word, qualityFor(true), NOW);
  assert.deepEqual(afterRecognize.schedule, afterRecall.schedule);

  const wrong = reviewWord(afterRecall, qualityFor(false), NOW);
  assert.equal(wrong.schedule.repetitions, 0);
  assert.equal(wrong.schedule.lapses, 1);
});

test('legacy records are migrated, with mastered words keeping credit', () => {
  const plain = ensureSchedule({ id: '1', es: 'la casa' }, NOW);
  assert.equal(plain.schedule.repetitions, 0);

  const mastered = ensureSchedule({ id: '2', es: 'el gato', mastered: true }, NOW);
  assert.equal(mastered.schedule.repetitions, 1);
  assert.ok(!isDue(mastered, NOW), 'a previously mastered word should not be due today');
});

test('due cards sort ahead of scheduled ones, most overdue first', () => {
  const overdue = { id: 'a', es: 'a', schedule: { ...newSchedule(NOW), nextReview: addDays(NOW, -5).toISOString(), reviewCount: 1 } };
  const dueToday = { id: 'b', es: 'b', schedule: { ...newSchedule(NOW), nextReview: day(NOW), reviewCount: 1 } };
  const later = { id: 'c', es: 'c', schedule: { ...newSchedule(NOW), nextReview: addDays(NOW, 9).toISOString(), reviewCount: 1 } };

  const order = sortForStudy([later, dueToday, overdue], NOW).map((w) => w.id);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(dueCount([later, dueToday, overdue], NOW), 2);
});

test('mastery is earned by reaching a long interval', () => {
  assert.equal(isMastered({ schedule: { interval: 6 } }), false);
  assert.equal(isMastered({ schedule: { interval: 21 } }), true);
});

test('REPS_TO_MASTER is the review that actually crosses the interval threshold', () => {
  let s = newSchedule(NOW);
  for (let i = 1; i < REPS_TO_MASTER; i++) {
    s = applyReview(s, QUALITY.good, NOW);
    assert.ok(s.interval < MASTERY_INTERVAL_DAYS,
      `review ${i} should not yet master, interval ${s.interval}`);
  }
  s = applyReview(s, QUALITY.good, NOW);
  assert.ok(s.interval >= MASTERY_INTERVAL_DAYS,
    `review ${REPS_TO_MASTER} should master, interval ${s.interval}`);
});

test('maturity moves on the first correct answer', () => {
  const word = { id: '1', es: 'el perro' };
  assert.equal(maturity(ensureSchedule(word, NOW)), 0);

  const once = reviewWord(word, QUALITY.good, NOW);
  assert.ok(maturity(once) > 0, 'a correct answer must register immediately');
  assert.equal(maturity(once), 0.25);
  assert.ok(isLearning(once), 'and the word should read as in progress');
});

test('maturity climbs to 1 exactly when the word is mastered', () => {
  let word = { id: '1', es: 'el perro' };
  const seen = [];
  for (let i = 0; i < REPS_TO_MASTER; i++) {
    word = reviewWord(word, QUALITY.good, NOW);
    seen.push(maturity(word));
  }
  assert.deepEqual(seen, [0.25, 0.5, 0.75, 1]);
  assert.ok(isMastered(word));
  assert.ok(!isLearning(word), 'a mastered word is no longer "learning"');
});

test('a lapse pulls maturity back down', () => {
  let word = { id: '1', es: 'el perro' };
  word = reviewWord(word, QUALITY.good, NOW);
  word = reviewWord(word, QUALITY.good, NOW);
  assert.equal(maturity(word), 0.5);

  word = reviewWord(word, QUALITY.again, NOW);
  assert.equal(maturity(word), 0, 'forgetting a word should cost the progress');
});

test('mean maturity is what a progress bar can fill to', () => {
  assert.equal(meanMaturity([]), 0);
  const a = reviewWord({ id: 'a', es: 'a' }, QUALITY.good, NOW);
  const b = ensureSchedule({ id: 'b', es: 'b' }, NOW);
  assert.equal(meanMaturity([a, b]), 0.125);
});
