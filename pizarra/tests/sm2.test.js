import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSchedule, applyReview, reviewWord, ensureSchedule, isDue, sortForStudy,
  dueCount, qualityFor, isMastered, dayStart, addDays, MIN_EASE, DEFAULT_EASE, QUALITY,
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
  const word = { id: '1', word: 'el perro', translation: 'the dog' };
  // recognition mode self-rates; recall mode reports right/wrong
  const afterRecognize = reviewWord(word, qualityFor('good'), NOW);
  const afterRecall = reviewWord(word, qualityFor(true), NOW);
  assert.deepEqual(afterRecognize.schedule, afterRecall.schedule);

  const wrong = reviewWord(afterRecall, qualityFor(false), NOW);
  assert.equal(wrong.schedule.repetitions, 0);
  assert.equal(wrong.schedule.lapses, 1);
});

test('legacy records are migrated, with mastered words keeping credit', () => {
  const plain = ensureSchedule({ id: '1', word: 'la casa' }, NOW);
  assert.equal(plain.schedule.repetitions, 0);

  const mastered = ensureSchedule({ id: '2', word: 'el gato', mastered: true }, NOW);
  assert.equal(mastered.schedule.repetitions, 1);
  assert.ok(!isDue(mastered, NOW), 'a previously mastered word should not be due today');
});

test('due cards sort ahead of scheduled ones, most overdue first', () => {
  const overdue = { id: 'a', word: 'a', schedule: { ...newSchedule(NOW), nextReview: addDays(NOW, -5).toISOString(), reviewCount: 1 } };
  const dueToday = { id: 'b', word: 'b', schedule: { ...newSchedule(NOW), nextReview: day(NOW), reviewCount: 1 } };
  const later = { id: 'c', word: 'c', schedule: { ...newSchedule(NOW), nextReview: addDays(NOW, 9).toISOString(), reviewCount: 1 } };

  const order = sortForStudy([later, dueToday, overdue], NOW).map((w) => w.id);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(dueCount([later, dueToday, overdue], NOW), 2);
});

test('mastery is earned by reaching a long interval', () => {
  assert.equal(isMastered({ schedule: { interval: 6 } }), false);
  assert.equal(isMastered({ schedule: { interval: 21 } }), true);
});
