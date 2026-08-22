// SM-2 spaced repetition scheduler.
//
// Each vocab word carries a small schedule record: how easy it has proven to
// be, how many days until it should come back, and when that next review is
// due. Both flashcard modes (recognize and recall) grade through `review()`,
// so a word has one schedule regardless of which way it was drilled.

export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight-anchored day key, so "due today" doesn't depend on the clock time. */
export function dayStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  return new Date(dayStart(date).getTime() + days * DAY_MS);
}

/** A never-reviewed word: due immediately, so new words show up in the queue. */
export function newSchedule(now = new Date()) {
  return {
    easeFactor: DEFAULT_EASE,
    interval: 0,
    repetitions: 0,
    nextReview: dayStart(now).toISOString(),
    lastReviewed: null,
    lapses: 0,
    reviewCount: 0,
  };
}

/** Fills in a schedule for records predating the scheduler (or hand-edited ones). */
export function ensureSchedule(word, now = new Date()) {
  if (word && word.schedule && typeof word.schedule.easeFactor === 'number') {
    return word;
  }
  const base = newSchedule(now);
  // Anything the old mastered/not-mastered toggle had marked as known starts
  // out with one successful review rather than resetting to brand new.
  if (word && word.mastered) {
    return { ...word, schedule: applyReview(base, 4, now) };
  }
  return { ...word, schedule: base };
}

/**
 * The SM-2 update itself. `quality` is 0-5; below 3 counts as a lapse.
 * Returns a new schedule, never mutating the one passed in.
 */
export function applyReview(schedule, quality, now = new Date()) {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  const prev = schedule || newSchedule(now);
  const today = dayStart(now);

  let { easeFactor, interval, repetitions, lapses = 0, reviewCount = 0 } = prev;

  if (q < 3) {
    // Lapse: back to the start of the ladder, reviewed again tomorrow.
    repetitions = 0;
    interval = 1;
    lapses += 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
  }

  // Ease only moves on graded recall, and never below the SM-2 floor.
  easeFactor = Math.max(
    MIN_EASE,
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  return {
    easeFactor: Math.round(easeFactor * 1000) / 1000,
    interval,
    repetitions,
    lapses,
    reviewCount: reviewCount + 1,
    lastReviewed: today.toISOString(),
    nextReview: addDays(today, interval).toISOString(),
  };
}

/** Convenience wrapper: grade a whole word record. */
export function reviewWord(word, quality, now = new Date()) {
  const withSchedule = ensureSchedule(word, now);
  return { ...withSchedule, schedule: applyReview(withSchedule.schedule, quality, now) };
}

export function isDue(word, now = new Date()) {
  const s = ensureSchedule(word, now).schedule;
  return new Date(s.nextReview).getTime() <= dayStart(now).getTime();
}

export function isNew(word) {
  const s = word?.schedule;
  return !s || s.reviewCount === 0;
}

/**
 * Study order for the flashcard view: due cards first (most overdue leading),
 * then everything else by how soon it comes up. New words are due by
 * construction, so they surface alongside the backlog rather than after it.
 */
export function sortForStudy(words, now = new Date()) {
  const today = dayStart(now).getTime();
  return [...words]
    .map((w) => ensureSchedule(w, now))
    .sort((a, b) => {
      const da = new Date(a.schedule.nextReview).getTime();
      const db = new Date(b.schedule.nextReview).getTime();
      const aDue = da <= today;
      const bDue = db <= today;
      if (aDue !== bDue) return aDue ? -1 : 1;
      if (da !== db) return da - db;
      return String(a.es || '').localeCompare(String(b.es || ''));
    });
}

export function dueCount(words, now = new Date()) {
  return words.reduce((n, w) => (isDue(w, now) ? n + 1 : n), 0);
}

/**
 * Maps flashcard UI outcomes onto SM-2 qualities. Recognition mode (flip and
 * self-rate) and recall mode (type the answer) both land here, so the two
 * modes drive one schedule.
 */
export const QUALITY = {
  again: 0,   // didn't know it / typed answer was wrong
  hard: 3,    // recalled, but with effort
  good: 4,    // recalled correctly
  easy: 5,    // instant
};

export function qualityFor(outcome) {
  if (typeof outcome === 'number') return outcome;
  if (typeof outcome === 'boolean') return outcome ? QUALITY.good : QUALITY.again;
  return QUALITY[outcome] ?? QUALITY.good;
}

/** A word counts as "mastered" once it has earned a comfortably long interval. */
export const MASTERY_INTERVAL_DAYS = 21;

/**
 * Successful reviews needed to cross that interval: the ladder runs
 * 1 -> 6 -> 15 -> 38 days, so the fourth correct answer is the one that does
 * it. Kept in step with MASTERY_INTERVAL_DAYS by a test.
 */
export const REPS_TO_MASTER = 4;

export function isMastered(word) {
  const s = word?.schedule;
  return !!s && s.interval >= MASTERY_INTERVAL_DAYS;
}

/** A word that has been answered correctly at least once but isn't mastered. */
export function isLearning(word) {
  const s = word?.schedule;
  return !!s && s.repetitions > 0 && !isMastered(word);
}

/**
 * How far a word has come, from 0 (new or just lapsed) to 1 (mastered).
 *
 * Measured in successful repetitions rather than interval length, so a correct
 * answer moves it immediately. Going by interval alone means the first three
 * correct answers register as 5%, 29%, and 71% of the way there, which reads
 * as nothing happening on the day you actually did the work.
 */
export function maturity(word) {
  if (isMastered(word)) return 1;
  const reps = word?.schedule?.repetitions || 0;
  return Math.min(reps / REPS_TO_MASTER, 1);
}

/** Mean maturity across a set of words — what the progress bar fills to. */
export function meanMaturity(words) {
  if (!words.length) return 0;
  return words.reduce((sum, w) => sum + maturity(w), 0) / words.length;
}
